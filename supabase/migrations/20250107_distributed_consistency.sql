-- ============================================
-- DISTRIBUTED CONSISTENCY MIGRATION
-- LearnixQuizz Production Architecture
-- ============================================

-- 1. IDEMPOTENCY TABLE
-- Stores mutation idempotency keys for deduplication

CREATE TABLE IF NOT EXISTS public.mutation_idempotency_keys (
  key TEXT PRIMARY KEY,
  mutation_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  operation TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_mutation_keys_created 
  ON public.mutation_idempotency_keys(created_at);

-- Cleanup old keys (keep 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_idempotency_keys()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.mutation_idempotency_keys
  WHERE created_at < NOW() - INTERVAL '24 hours';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup every hour
SELECT cron.schedule('cleanup-idempotency-keys', '0 * * * *', 
  'SELECT cleanup_old_idempotency_keys()');

-- ============================================
-- 2. VERSION CONTROL FOR OPTIMISTIC LOCKING
-- Add version columns to key tables

-- Add version to quizzes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'quizzes' AND column_name = 'version') THEN
    ALTER TABLE public.quizzes 
      ADD COLUMN version INTEGER DEFAULT 1,
      ADD COLUMN last_modified_at TIMESTAMPTZ DEFAULT NOW(),
      ADD COLUMN last_modified_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Trigger to auto-increment version
CREATE OR REPLACE FUNCTION increment_quiz_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = COALESCE(OLD.version, 1) + 1;
  NEW.last_modified_at = NOW();
  NEW.last_modified_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_increment_quiz_version ON public.quizzes;
CREATE TRIGGER trigger_increment_quiz_version
  BEFORE UPDATE ON public.quizzes
  FOR EACH ROW EXECUTE FUNCTION increment_quiz_version();

-- Add version to questions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'questions' AND column_name = 'version') THEN
    ALTER TABLE public.questions 
      ADD COLUMN version INTEGER DEFAULT 1;
  END IF;
END $$;

-- ============================================
-- 3. AI JOB QUEUE TABLE
-- Tracks AI jobs for stuck job detection

CREATE TABLE IF NOT EXISTS public.ai_job_queue (
  job_id TEXT PRIMARY KEY,
  edge_function_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('translate', 'extract', 'generate')),
  entity_id TEXT NOT NULL,
  target_language TEXT,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_job_status ON public.ai_job_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_job_user ON public.ai_job_queue(user_id, status);

-- Cleanup function for stuck jobs
CREATE OR REPLACE FUNCTION cleanup_stuck_ai_jobs()
RETURNS TABLE(job_id TEXT, reason TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    j.job_id,
    CASE 
      WHEN j.started_at < NOW() - INTERVAL '10 minutes' THEN 'TIMEOUT'
      WHEN j.heartbeat_at < NOW() - INTERVAL '2 minutes' THEN 'HEARTBEAT_LOST'
      ELSE 'UNKNOWN'
    END as reason
  FROM public.ai_job_queue j
  WHERE j.status = 'running'
    AND (
      j.started_at < NOW() - INTERVAL '10 minutes'
      OR j.heartbeat_at < NOW() - INTERVAL '2 minutes'
    );
  
  -- Mark stuck jobs as failed
  UPDATE public.ai_job_queue
  SET 
    status = 'failed',
    error = 'Job timeout or heartbeat lost',
    completed_at = NOW()
  WHERE status = 'running'
    AND (
      started_at < NOW() - INTERVAL '10 minutes'
      OR heartbeat_at < NOW() - INTERVAL '2 minutes'
    );
END;
$$ LANGUAGE plpgsql;

-- Schedule stuck job cleanup every 5 minutes
SELECT cron.schedule('cleanup-ai-jobs', '*/5 * * * *', 
  'SELECT cleanup_stuck_ai_jobs()');

-- ============================================
-- 4. RPC FUNCTIONS FOR CONSISTENCY

-- Check idempotency
CREATE OR REPLACE FUNCTION check_idempotency(
  p_key TEXT,
  p_user_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_existing JSONB;
BEGIN
  SELECT jsonb_build_object(
    'exists', true,
    'result', result,
    'created_at', created_at
  ) INTO v_existing
  FROM public.mutation_idempotency_keys
  WHERE key = p_key AND user_id = p_user_id;
  
  RETURN COALESCE(v_existing, jsonb_build_object('exists', false));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Record idempotency
CREATE OR REPLACE FUNCTION record_idempotency(
  p_key TEXT,
  p_mutation_id TEXT,
  p_user_id UUID,
  p_operation TEXT,
  p_entity_id TEXT,
  p_result JSONB
) RETURNS VOID AS $$
BEGIN
  INSERT INTO public.mutation_idempotency_keys (
    key, mutation_id, user_id, operation, entity_id, result
  ) VALUES (
    p_key, p_mutation_id, p_user_id, p_operation, p_entity_id, p_result
  )
  ON CONFLICT (key) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic reorder with version check
CREATE OR REPLACE FUNCTION atomic_reorder_questions(
  p_quiz_id UUID,
  p_new_orderings JSONB, -- [{"question_id": "...", "new_order": 1}, ...]
  p_expected_version INTEGER,
  p_mutation_id TEXT
) RETURNS JSONB AS $$
DECLARE
  v_current_version INTEGER;
  v_question RECORD;
  v_ordering JSONB;
BEGIN
  -- Get current version with lock
  SELECT version INTO v_current_version
  FROM public.quizzes
  WHERE id = p_quiz_id
  FOR UPDATE;
  
  -- Version check
  IF v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'VERSION_CONFLICT',
      'current_version', v_current_version
    );
  END IF;
  
  -- Apply reorderings
  FOR v_ordering IN SELECT * FROM jsonb_array_elements(p_new_orderings)
  LOOP
    UPDATE public.questions
    SET question_order = (v_ordering->>'new_order')::INTEGER
    WHERE id = (v_ordering->>'question_id')::UUID
      AND quiz_id = p_quiz_id;
  END LOOP;
  
  -- Return updated questions
  RETURN jsonb_build_object(
    'success', true,
    'new_version', v_current_version + 1,
    'questions', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'question_order', question_order
        ) ORDER BY question_order
      )
      FROM public.questions
      WHERE quiz_id = p_quiz_id
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get events since (for missed event recovery)
CREATE OR REPLACE FUNCTION get_events_since(
  p_table TEXT,
  p_since TIMESTAMPTZ
) RETURNS JSONB AS $$
BEGIN
  RETURN CASE p_table
    WHEN 'quizzes' THEN (
      SELECT jsonb_agg(to_jsonb(q.*))
      FROM public.quizzes q
      WHERE q.updated_at > p_since
    )
    WHEN 'translations' THEN (
      SELECT jsonb_agg(to_jsonb(t.*))
      FROM public.translations t
      WHERE t.updated_at > p_since
    )
    ELSE '[]'::jsonb
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get quiz with translations (N+1 elimination)
CREATE OR REPLACE FUNCTION get_quiz_with_translations(
  p_quiz_id UUID,
  p_language TEXT
) RETURNS JSONB AS $$
DECLARE
  v_quiz JSONB;
  v_questions JSONB;
  v_translation JSONB;
BEGIN
  -- Get quiz
  SELECT to_jsonb(q.*) INTO v_quiz
  FROM public.quizzes q
  WHERE q.id = p_quiz_id;
  
  IF v_quiz IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Get quiz translation
  SELECT to_jsonb(t.content) INTO v_translation
  FROM public.translations t
  WHERE t.quiz_id = p_quiz_id
    AND t.language = p_language
    AND t.question_id IS NULL
    AND t.status = 'approved'
  LIMIT 1;
  
  -- Get questions with translations
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', qu.id,
      'type', qu.type,
      'question_order', qu.question_order,
      'text', qu.text,
      'options', qu.options,
      'correct_answer_index', qu.correct_answer_index,
      'explanation', qu.explanation,
      'marks', qu.marks,
      'translation', (
        SELECT to_jsonb(t.content)
        FROM public.translations t
        WHERE t.question_id = qu.id
          AND t.language = p_language
          AND t.status = 'approved'
        LIMIT 1
      )
    ) ORDER BY qu.question_order
  ) INTO v_questions
  FROM public.questions qu
  WHERE qu.quiz_id = p_quiz_id;
  
  RETURN jsonb_build_object(
    'quiz', v_quiz,
    'questions', COALESCE(v_questions, '[]'::jsonb),
    'quiz_translation', v_translation
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- 5. INDEXES FOR PERFORMANCE

CREATE INDEX IF NOT EXISTS idx_quizzes_version ON public.quizzes(version);
CREATE INDEX IF NOT EXISTS idx_quizzes_modified ON public.quizzes(last_modified_at);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_order ON public.questions(quiz_id, question_order);

-- ============================================
-- 6. RLS POLICY UPDATES

-- Allow users to see their own idempotency keys
CREATE POLICY "Users can view their own idempotency keys"
  ON public.mutation_idempotency_keys FOR SELECT
  USING (user_id = auth.uid());

-- Allow users to see their own AI jobs
CREATE POLICY "Users can view their own AI jobs"
  ON public.ai_job_queue FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own AI jobs"
  ON public.ai_job_queue FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own AI jobs"
  ON public.ai_job_queue FOR UPDATE
  USING (user_id = auth.uid());
