/// <reference types="vite/client" />
import { Question, EssayGrade } from '../types';

// ─── Config ─────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = (
  import.meta.env.VITE_GEMINI_API_KEY ||
  (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '')
) as string;

const USE_API_ROUTE =
  typeof window !== 'undefined' && window.location.hostname !== 'localhost';

// ─── Core API ───────────────────────────────────────────────────────────────

async function callGemini(prompt: string, maxTokens = 8192): Promise<string> {
  if (USE_API_ROUTE) {
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const txt = await res.text();
      throw new Error(`Server trả về định dạng không hợp lệ: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API request failed');
    return data.text as string;
  }

  if (!GEMINI_API_KEY) {
    throw new Error('Thiếu VITE_GEMINI_API_KEY — vui lòng kiểm tra biến môi trường');
  }

  // Use stable Gemini 1.5 models (3.1 and 2.5 are beta/preview with rate limits)
  const MODELS = [
  'gemini-3-pro',        // Ưu tiên 1: Thông minh nhất, xử lý logic phức tạp
  'gemini-3-flash',      // Ưu tiên 2: Cân bằng giữa tốc độ và độ thông minh
  'gemini-3.1-flash-lite', // Ưu tiên 3: Cực nhanh, quota thường nới lỏng hơn
  'gemini-2.5-pro',      // Ưu tiên 4: Bản cũ ổn định, dùng làm phương án dự phòng cuối
  'gemini-2.5-flash'     // Ưu tiên 5: Tốc độ cao, ít tốn tài nguyên
];
  let lastError = '';

  for (const model of MODELS) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 45_000);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
          }),
          signal: ctrl.signal,
        }
      );
      clearTimeout(tid);

      if (res.status === 429) { lastError = `${model}: quota exceeded`; continue; }
      if (res.status === 404) { lastError = `${model}: model not found`; continue; }
      if (!res.ok) { lastError = `${model}: ${res.status}`; continue; }

      const data = await res.json();
      const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
      lastError = `${model}: empty response`;
    } catch (err: any) {
      lastError = err.name === 'AbortError' ? `${model}: timeout` : `${model}: ${err.message}`;
    }
  }
  throw new Error(`Gemini API lỗi: ${lastError}`);
}

// ─── JSON recovery ─────────────────────────────────────────────────────────

/**
 * Aggressively extracts a JSON array from raw AI output.
 * Handles: markdown fences, control chars, trailing commas,
 * truncated arrays (adds closing bracket if missing).
 */
function recoverJsonArray(raw: string): unknown[] {
  // Strip markdown fences
  let text = raw
    .replace(/^```json\s*/gim, '')
    .replace(/^```\s*/gim, '')
    .trim();

  // Remove non-printable control characters (keep \n \t)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  // Find the outermost [ ... ]
  const start = text.indexOf('[');
  if (start === -1) throw new Error('No JSON array found in response');
  text = text.slice(start);

  // If array is truncated (AI ran out of tokens), close it properly
  const end = text.lastIndexOf(']');
  if (end === -1) {
    // Remove the last incomplete object then close the array
    const lastComma = text.lastIndexOf(',');
    const lastOpen = text.lastIndexOf('{');
    // If the last '{' comes after the last complete '}', the last object is incomplete
    const lastClose = text.lastIndexOf('}');
    if (lastOpen > lastClose) {
      text = text.slice(0, lastComma === -1 ? lastOpen : Math.min(lastComma, lastOpen)) + ']';
    } else {
      text = text + ']';
    }
  } else {
    text = text.slice(0, end + 1);
  }

  // Fix trailing commas: ,] or ,}
  text = text.replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(text) as unknown[];
}

// ─── Validation & normalisation ─────────────────────────────────────────────

/**
 * Post-process questions to normalize AI output variations
 * Ensures consistent results across multiple runs
 */
function postProcessQuestions(questions: Question[]): Question[] {
  return questions.map((q, index) => {
    // Deep clone to avoid mutations
    const processed = { ...q };
    
    // Ensure consistent ID assignment
    processed.id = q.id || `q-${index}-${Date.now()}`;
    
    // Clean up text - remove extra whitespace, normalize newlines
    processed.text = q.text
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Remove answer letter from question text (e.g., "A. answer" at end)
    const answerLetterPattern = /\s*[A-D][\.\)]\s*\S+$/i;
    processed.text = processed.text.replace(answerLetterPattern, '').trim();
    
    // Clean up options
    if (processed.options && processed.options.length > 0) {
      processed.options = processed.options.map(opt => 
        opt.replace(/^\s*[A-D][\.\)]\s*/i, '').trim()
      );
      
      // Remove duplicate options
      processed.options = [...new Set(processed.options)];
    }
    
    // Ensure type is consistent based on options
    if (processed.options && processed.options.length >= 2) {
      const optTexts = processed.options.map(o => o.toLowerCase().trim());
      const isTrueFalse = processed.options.length === 2 && 
        (optTexts.includes('true') && optTexts.includes('false'));
      
      processed.type = isTrueFalse ? 'true-false' : 'multiple-choice';
    } else {
      processed.type = 'essay';
      processed.options = [];
      processed.correctAnswerIndex = 0;
    }
    
    // Clamp correctAnswerIndex
    if (processed.options.length > 0) {
      processed.correctAnswerIndex = Math.min(
        Math.max(0, processed.correctAnswerIndex || 0),
        processed.options.length - 1
      );
    }
    
    // Clean up explanation and sampleAnswer
    if (processed.explanation) {
      processed.explanation = processed.explanation.trim();
    }
    if (processed.sampleAnswer) {
      processed.sampleAnswer = processed.sampleAnswer.trim();
    }
    
    return processed;
  }).filter(q => q.text.length > 0); // Remove empty questions
}

function isValidRaw(q: unknown): q is Record<string, unknown> {
  if (!q || typeof q !== 'object') return false;
  const item = q as Record<string, unknown>;
  if (typeof item.text !== 'string' || !item.text.trim()) return false;
  const type = item.type as string;
  return ['multiple-choice', 'true-false', 'essay'].includes(type);
}

function normalise(raw: Record<string, unknown>): Omit<Question, 'id'> {
  let type = raw.type as Question['type'];
  const options = Array.isArray(raw.options)
    ? (raw.options as unknown[]).map(String)
    : [];

  // AUTO-CORRECT: Force type based on options (AI sometimes misclassifies)
  if (options.length >= 2) {
    // Check for true-false pattern
    const optTexts = options.map(o => o.toLowerCase().trim());
    const hasTrueFalse = optTexts.includes('true') && optTexts.includes('false') ||
                         optTexts.includes('đúng') && optTexts.includes('sai');
    
    if (options.length === 2 && hasTrueFalse) {
      type = 'true-false';
    } else {
      // 2+ options = multiple-choice (even if AI says essay)
      type = 'multiple-choice';
    }
  } else if (options.length === 0) {
    // No options = essay
    type = 'essay';
  }

  // Clamp correctAnswerIndex to valid range
  const maxIdx = options.length > 0 ? options.length - 1 : 0;
  const rawIdx =
    typeof raw.correctAnswerIndex === 'number' ? Math.round(raw.correctAnswerIndex) : 0;
  const correctAnswerIndex = Math.max(0, Math.min(rawIdx, maxIdx));

  return {
    type,
    text: String(raw.text).trim(),
    options,
    correctAnswerIndex,
    explanation:
      typeof raw.explanation === 'string' ? raw.explanation.trim() : '',
    sampleAnswer:
      typeof raw.sampleAnswer === 'string' && raw.sampleAnswer.trim()
        ? raw.sampleAnswer.trim()
        : undefined,
  };
}

// ─── Generate quiz from topic ───────────────────────────────────────────────

export async function generateQuizAI(
  topic: string,
  numQuestions: number,
  difficulty: string,
  language: string
): Promise<Question[]> {
  const isVi = language !== 'en';
  const lang = isVi ? 'Vietnamese' : 'English';
  const tfOptions = isVi ? '["Đúng","Sai"]' : '["True","False"]';

  const prompt = `You are an expert quiz author. Create EXACTLY ${numQuestions} quiz questions about "${topic}".
Difficulty: ${difficulty}. Respond in ${lang}.

Rules:
- Mostly multiple-choice. Optionally 1-2 true-false or essay.
- Each question must be factually correct and educationally useful.
- Multiple-choice: EXACTLY 4 options, one clearly correct.
- True-false: options must be ${tfOptions}.
- Essay: options = [], provide a sampleAnswer.
- Keep explanation to 1-2 sentences.

Return ONLY a valid JSON array, no markdown, no text before or after:
[
  {"type":"multiple-choice","text":"Question?","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"...","sampleAnswer":""},
  {"type":"true-false","text":"Statement.","options":${tfOptions},"correctAnswerIndex":0,"explanation":"...","sampleAnswer":""},
  {"type":"essay","text":"Explain...","options":[],"correctAnswerIndex":0,"explanation":"","sampleAnswer":"Reference answer here."}
]`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await callGemini(
        attempt === 0
          ? prompt
          : `Create ${numQuestions} ${difficulty} quiz questions about "${topic}" in ${lang}. Return ONLY JSON array:
[{"type":"multiple-choice","text":"...","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"...","sampleAnswer":""}]`,
        4096
      );
      const parsed = recoverJsonArray(raw);
      const valid = parsed
        .filter(isValidRaw)
        .map((q) => normalise(q as Record<string, unknown>)) as Question[];
      if (valid.length > 0) return valid;
    } catch (err: any) {
      console.warn(`[generateQuizAI] attempt ${attempt + 1}:`, err.message);
      if (attempt === 2) throw new Error('Không tạo được câu hỏi — vui lòng thử lại.');
    }
  }
  throw new Error('Không tạo được câu hỏi — vui lòng thử lại.');
}

// ─── Extract questions from document content ────────────────────────────────

/**
 * Pre-scan content to find all question boundaries (numbered lines).
 * Returns an array of {lineIndex, questionNumber, rawLine} for each detected question start.
 */
interface QBoundary {
  lineIndex: number;
  questionNumber: number; // extracted number, e.g. "Câu 3." → 3
  rawLine: string;
}

function detectQuestionBoundaries(lines: string[]): QBoundary[] {
  const boundaries: QBoundary[] = [];
  // Match: "1.", "1)", "Câu 1.", "Câu 1:", "Question 1." etc.
  const QUESTION_RE = /^(?:câu\s+|question\s+|q\.?\s*)?(\d+)\s*[.):\-]\s*.+/i;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.length < 4) continue;
    const m = trimmed.match(QUESTION_RE);
    if (m) {
      boundaries.push({
        lineIndex: i,
        questionNumber: parseInt(m[1], 10),
        rawLine: trimmed,
      });
    }
  }
  return boundaries;
}

/**
 * Split lines into groups where each group = one question + its options.
 * Guarantees NO question is ever split across two chunks.
 */
function groupLinesByQuestion(lines: string[]): string[][] {
  const boundaries = detectQuestionBoundaries(lines);
  if (boundaries.length === 0) return [lines]; // no detectable structure → single chunk

  const groups: string[][] = [];

  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b].lineIndex;
    const end =
      b + 1 < boundaries.length ? boundaries[b + 1].lineIndex : lines.length;
    groups.push(lines.slice(start, end));
  }

  return groups;
}

/**
 * Pack question groups into chunks ≤ maxChars each.
 * A single question group is NEVER split.
 */
function packIntoChunks(groups: string[][], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const group of groups) {
    const block = group.join('\n');
    // If this single group already exceeds maxChars, send it alone
    if (block.length > maxChars) {
      if (current.trim()) { chunks.push(current.trim()); current = ''; }
      chunks.push(block);
      continue;
    }
    if (current.length + block.length + 1 > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n' : '') + block;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Max chars sent to AI per request — tuned to stay well within token limits
// while keeping enough context for the AI to understand each question.
const CHARS_PER_CHUNK = 5_000;

/**
 * Build the extraction prompt for one chunk.
 * `globalOffset` = how many questions we've already extracted (for ordering context).
 */
function buildExtractionPrompt(chunk: string, globalOffset: number): string {
  return `You are a STRICT quiz extraction engine. Your job is to extract questions from raw document text into a PERFECT structured JSON array.

You MUST preserve 100% of the original content. NO data loss is allowed.

━━━━━━━━━━━━━━━━━━━
CRITICAL RULES (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━

1. DO NOT SKIP ANY QUESTION
- Every detected question MUST appear in output
- Do NOT merge multiple questions into one
- Do NOT split one question into multiple

2. DO NOT LOSE STRUCTURE
Each question MUST have:
- text (FULL question text ONLY, NOT including options A/B/C/D)
- type (correct classification)
- options (if exist, as separate array)
→ It is FORBIDDEN to return:
- question without text
- options without question
- partial data
- options included in the text field

🚨 CRITICAL: The "text" field must contain ONLY the question stem, NEVER include options like "A. ... B. ..." inside text

3. DO NOT PARAPHRASE
- Copy EXACT original text
- Keep line breaks if needed

━━━━━━━━━━━━━━━━━━━
QUESTION BOUNDARY DETECTION
━━━━━━━━━━━━━━━━━━━

A new question starts when a line matches:
- "1.", "2)", "3:"
- "Câu 1.", "Câu 2:"
- "Question 1"

Everything until the next question belongs to that question.

━━━━━━━━━━━━━━━━━━━
TYPE CLASSIFICATION (STRICT LOGIC)
━━━━━━━━━━━━━━━━━━━

You MUST follow this priority:

1. MULTIPLE-CHOICE
If the question contains ANY of:
- A. B. C. D.
- A) B) C) D)
- a. b. c. d.

→ type = "multiple-choice"
→ Extract ALL options (minimum 2, usually 4)
→ NEVER classify this as essay

2. TRUE-FALSE
If there are EXACTLY 2 options like:
- True / False
- Đúng / Sai

→ type = "true-false"

3. ESSAY
Only when:
- NO options exist

→ type = "essay"

🚨 IMPORTANT:
Presence of A/B/C/D ALWAYS overrides everything → must be multiple-choice

━━━━━━━━━━━━━━━━━━━
OPTION EXTRACTION RULES
━━━━━━━━━━━━━━━━━━━

- Remove prefix: "A.", "B)", etc.
- Keep ONLY option content
- Keep order exactly as in text

If options exist:
→ options MUST NOT be empty

If no options:
→ options = []

━━━━━━━━━━━━━━━━━━━
ANSWER DETECTION (MUST DO)
━━━━━━━━━━━━━━━━━━━

You MUST find and set correctAnswerIndex:

1. Look for answer markers in the input:
   - "Đáp án: A" or "Answer: B" → correctAnswerIndex = 0 (A), 1 (B), 2 (C), 3 (D)
   - "*", "✓", "→" before/after an option → mark that option as correct
   - Underline, bold, or highlight on option → that option is correct

2. If multiple questions have answers marked, set correctAnswerIndex for EACH question

3. If NO marker found:
   → Analyze which option is logically correct
   → Set correctAnswerIndex to the most likely answer (0, 1, 2, or 3)

🚨 CRITICAL: Every question MUST have correctAnswerIndex set (0, 1, 2, or 3)
NOT allowed: Leaving all as 0 without checking for markers

━━━━━━━━━━━━━━━━━━━
MULTI-LINE HANDLING
━━━━━━━━━━━━━━━━━━━

- Questions may span multiple lines
- Options may be on separate lines
→ MUST merge them correctly

━━━━━━━━━━━━━━━━━━━
PRONUNCIATION & COMPLEX QUESTION TYPES
━━━━━━━━━━━━━━━━━━━

For "pronunciation" or "choose the different" questions:

EXAMPLE FORMAT:
"A. Which word has the underlined part pronounced differently from that of the others
1. A. reduced  B. created  C. needed  D. directed
2. A. balanced B. coughed  C. produced D. learned"

MUST BE EXTRACTED AS SEPARATE QUESTIONS WITH REPEATED MAIN INSTRUCTION:

INPUT:
"A. Which word has the underlined part pronounced differently from that of the others
1. A. reduced  B. created  C. needed  D. directed
2. A. balanced B. coughed  C. produced D. learned"

OUTPUT JSON:
[
  {
    "type": "multiple-choice",
    "text": "Which word has the underlined part pronounced differently from that of the others? 1. A. reduced B. created C. needed D. directed",
    "options": ["reduced", "created", "needed", "directed"],
    "correctAnswerIndex": 0
  },
  {
    "type": "multiple-choice", 
    "text": "Which word has the underlined part pronounced differently from that of the others? 2. A. balanced B. coughed C. produced D. learned",
    "options": ["balanced", "coughed", "produced", "learned"],
    "correctAnswerIndex": 0
  }
]

⚠️ CRITICAL RULES - FOLLOW EXACTLY:
1. The MAIN INSTRUCTION (e.g., "Which word has...") MUST BE REPEATED in EVERY question text
2. Each numbered sub-question (1., 2., 3.) becomes a SEPARATE question with its OWN options
3. NEVER merge all sub-questions into one question
4. NEVER classify as essay - these are ALWAYS multiple-choice (type: "multiple-choice")
5. Extract options WITHOUT the A. B. C. D. prefixes (just the word)

━━━━━━━━━━━━━━━━━━━
ANTI-ERROR VALIDATION (VERY IMPORTANT)
━━━━━━━━━━━━━━━━━━━

Before returning JSON, you MUST check:

For EACH question:
- text is NOT empty
- If type = multiple-choice → options.length ≥ 2
- If options exist → type MUST NOT be essay

If any error:
→ FIX it before output

━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (STRICT JSON ONLY)
━━━━━━━━━━━━━━━━━━━

Return ONLY JSON array, NO markdown, NO explanation:

CORRECT EXAMPLE (text does NOT contain options):
[
  {
    "docOrder": ${globalOffset + 1},
    "type": "multiple-choice",
    "text": "What is the capital of France?",
    "options": ["Paris", "London", "Berlin", "Madrid"],
    "correctAnswerIndex": 0,
    "explanation": "",
    "sampleAnswer": ""
  }
]

❌ WRONG (options mixed in text):
[
  {
    "text": "What is 2+2? A. 3 B. 4 C. 5",
    "options": ["A. 3", "B. 4", "C. 5"]
  }
]

✅ CORRECT (clean separation):
[
  {
    "text": "What is 2+2?",
    "options": ["3", "4", "5"]
  }
]

━━━━━━━━━━━━━━━━━━━
TEXT TO PROCESS
━━━━━━━━━━━━━━━━━━━

${chunk}

JSON:`;
}

/**
 * Process a single chunk. Retries up to 3 times with progressively simpler prompts.
 */
async function extractChunk(
  chunk: string,
  globalOffset: number,
  chunkIndex: number,
  totalChunks: number
): Promise<Array<Omit<Question, 'id'> & { docOrder: number }>> {
  console.log(
    `[extract] chunk ${chunkIndex}/${totalChunks} — ${chunk.length} chars, offset ${globalOffset}` 
  );

  const fallbackPrompt = `Extract quiz questions from the text. Return ONLY a JSON array.

Text:
${chunk}

Format (include docOrder starting at ${globalOffset + 1}):
[{"docOrder":${globalOffset + 1},"type":"multiple-choice","text":"1. Question?","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"","sampleAnswer":""}]

JSON:`;

  const minimalPrompt = `Extract ALL questions as JSON array from:\n${chunk.slice(0, 3000)}\n
[{"docOrder":${globalOffset + 1},"type":"multiple-choice","text":"...","options":["A","B","C","D"],"correctAnswerIndex":0,"explanation":"","sampleAnswer":""}]`;

  const prompts = [
    buildExtractionPrompt(chunk, globalOffset),
    fallbackPrompt,
    minimalPrompt,
  ];

  for (let attempt = 0; attempt < prompts.length; attempt++) {
    try {
      const raw = await callGemini(prompts[attempt], 8192);
      const parsed = recoverJsonArray(raw);

      const valid = parsed
        .filter(isValidRaw)
        .map((q) => {
          const norm = normalise(q as Record<string, unknown>);
          const docOrder =
            typeof (q as any).docOrder === 'number'
              ? (q as any).docOrder
              : globalOffset + parsed.indexOf(q) + 1;
          return { ...norm, docOrder } as Omit<Question, 'id'> & { docOrder: number };
        });

      if (valid.length > 0) {
        console.log(`[extract] chunk ${chunkIndex}: ${valid.length} questions (attempt ${attempt + 1})`);
        return valid;
      }
      console.warn(`[extract] chunk ${chunkIndex} attempt ${attempt + 1}: 0 valid questions`);
    } catch (err: any) {
      console.warn(`[extract] chunk ${chunkIndex} attempt ${attempt + 1} failed:`, err.message);
    }
  }

  // Absolute last resort: regex-based extraction
  console.warn(`[extract] chunk ${chunkIndex}: using regex fallback`);
  return regexExtract(chunk, globalOffset);
}

/**
 * Pure-regex extraction as absolute last resort.
 * Preserves order and assigns docOrder from globalOffset.
 */
function regexExtract(
  text: string,
  globalOffset: number
): Array<Omit<Question, 'id'> & { docOrder: number }> {
  const results: Array<Omit<Question, 'id'> & { docOrder: number }> = [];
  const lines = text.split('\n');

  let current: {
    text: string;
    options: string[];
    correctAnswerIndex: number;
    lineStart: number;
  } | null = null;
  let docOrder = globalOffset;

  const flushCurrent = () => {
    if (!current || !current.text.trim()) return;
    docOrder++;
    const type: Question['type'] =
      current.options.length === 4
        ? 'multiple-choice'
        : current.options.length === 2
        ? 'true-false'
        : 'essay';
    results.push({
      docOrder,
      type,
      text: current.text.trim(),
      options: current.options,
      correctAnswerIndex: Math.min(current.correctAnswerIndex, Math.max(0, current.options.length - 1)),
      explanation: '',
      sampleAnswer: undefined,
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Question line
    const qm = line.match(/^(?:câu\s+)?(\d+)\s*[.):\-]\s+(.+)/i);
    if (qm) {
      flushCurrent();
      current = { text: line, options: [], correctAnswerIndex: 0, lineStart: i };
      continue;
    }

    // Option line A. / A) / a.
    const om = line.match(/^([A-Da-d])\s*[.)]\s+(.+)/);
    if (om && current) {
      const optionText = om[2].trim();
      // Detect answer marker in this option
      if (
        optionText.startsWith('→') ||
        optionText.endsWith('←') ||
        line.includes('(*)') ||
        line.includes('✓')
      ) {
        current.correctAnswerIndex = current.options.length;
      }
      current.options.push(optionText.replace(/^→|←$/g, '').trim());
    }
  }
  flushCurrent();

  return results;
}

// ─── Main export: generate from content ─────────────────────────────────────

export async function generateQuestionsFromContent(
  content: string,
  _language: string
): Promise<Question[]> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Nội dung trống — vui lòng nhập hoặc trích xuất nội dung trước');
  }

  // 1. Group lines by question (guaranteed no split)
  const lines = trimmed.split('\n');
  const groups = groupLinesByQuestion(lines);

  // 2. Pack into chunks ≤ CHARS_PER_CHUNK (no group ever crosses a chunk boundary)
  const chunks = packIntoChunks(groups, CHARS_PER_CHUNK);

  console.log(
    `[generateQuestionsFromContent] ${trimmed.length} chars → ${groups.length} question groups → ${chunks.length} chunks` 
  );

  // 3. Extract questions from each chunk, tracking global position
  type Extracted = Omit<Question, 'id'> & { docOrder: number };
  const allExtracted: Extracted[] = [];
  let globalOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    const extracted = await extractChunk(chunks[i], globalOffset, i + 1, chunks.length);
    allExtracted.push(...extracted);
    globalOffset += extracted.length;
  }

  if (allExtracted.length === 0) {
    throw new Error(
      'AI không trích xuất được câu hỏi hợp lệ nào. Vui lòng kiểm tra định dạng nội dung.'
    );
  }

  // 4. Deduplicate by text (keep first occurrence — preserves original order)
  const seen = new Set<string>();
  const deduped = allExtracted.filter((q) => {
    const key = q.text.trim().toLowerCase().slice(0, 100);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 5. Sort by docOrder to restore original document order
  deduped.sort((a, b) => a.docOrder - b.docOrder);

  console.log(
    `[generateQuestionsFromContent] Done: ${deduped.length} questions` +
    ` (${deduped.filter(q => q.type === 'multiple-choice').length} MC,` +
    ` ${deduped.filter(q => q.type === 'true-false').length} TF,` +
    ` ${deduped.filter(q => q.type === 'essay').length} essay)` 
  );

  // Remove the internal docOrder and post-process to normalize
  const cleaned = deduped.map(({ docOrder: _d, ...q }) => q) as Question[];
  
  // Post-process to ensure consistent results
  return postProcessQuestions(cleaned);
}

// ─── AI explanation ─────────────────────────────────────────────────────────

export async function getAIExplanation(
  question: string,
  userAnswer: string,
  correctAnswer: string
): Promise<string> {
  const prompt = `Quiz question: "${question}"
User answered: "${userAnswer}"
Correct answer: "${correctAnswer}"
In 2-3 sentences, explain why the correct answer is right and what the user misunderstood. Be concise and use the same language as the question.`;
  return callGemini(prompt, 512);
}

// ─── Essay grading ───────────────────────────────────────────────────────────

export async function gradeEssayAI(
  question: string,
  answer: string,
  sampleAnswer?: string
): Promise<EssayGrade> {
  const prompt = `Grade the following essay answer from 0 to 100.

Question: "${question}"
${sampleAnswer ? `Reference answer: "${sampleAnswer}"` : ''}
Student answer: "${answer}"

Criteria: accuracy, completeness, clarity. Respond in the same language as the question.

Return ONLY valid JSON — no markdown:
{"score": <integer 0-100>, "feedback": "<2-3 sentences>"}`;

  try {
    const raw = await callGemini(prompt, 512);
    const clean = raw.replace(/```json\s*|```\s*/gi, '').trim();
    const parsed = JSON.parse(clean) as { score: number; feedback: string };
    if (typeof parsed.score === 'number' && typeof parsed.feedback === 'string') {
      return {
        score: Math.max(0, Math.min(100, Math.round(parsed.score))),
        feedback: parsed.feedback,
      };
    }
    throw new Error('bad shape');
  } catch {
    return {
      score: 50,
      feedback: 'Không chấm được tự động. Vui lòng xem xét thủ công.',
    };
  }
}
