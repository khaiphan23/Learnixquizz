/**
 * AI Jobs Edge Function
 * Manages AI job execution with heartbeat and status tracking
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AIJobRequest {
  jobId: string;
  type: 'translate' | 'extract' | 'generate';
  entityId: string;
  targetLanguage?: string;
}

// Initialize Supabase client
function getSupabaseClient(req: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Create new AI job
async function createJob(req: Request): Promise<Response> {
  const supabase = getSupabaseClient(req);
  const body: AIJobRequest = await req.json();
  
  // Get user from auth header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  // Create job record
  const { data, error } = await supabase
    .from('ai_job_queue')
    .insert({
      job_id: body.jobId,
      type: body.type,
      entity_id: body.entityId,
      target_language: body.targetLanguage,
      status: 'pending',
      user_id: (await supabase.auth.getUser(authHeader.replace('Bearer ', ''))).data.user?.id,
    })
    .select()
    .single();
  
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  // Start async processing
  processJobAsync(supabase, body, data.id);
  
  return new Response(JSON.stringify({ 
    edgeFunctionId: data.id,
    status: 'queued' 
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Get job status
async function getJobStatus(req: Request, edgeFunctionId: string): Promise<Response> {
  const supabase = getSupabaseClient(req);
  
  const { data, error } = await supabase
    .from('ai_job_queue')
    .select('*')
    .eq('id', edgeFunctionId)
    .single();
  
  if (error || !data) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  return new Response(JSON.stringify({
    status: data.status,
    progress: data.progress,
    result: data.result,
    error: data.error,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Cancel job
async function cancelJob(req: Request, edgeFunctionId: string): Promise<Response> {
  const supabase = getSupabaseClient(req);
  
  const { error } = await supabase
    .from('ai_job_queue')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', edgeFunctionId);
  
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  return new Response(JSON.stringify({ status: 'cancelled' }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Async job processor
async function processJobAsync(
  supabase: any,
  jobSpec: AIJobRequest,
  dbId: number
): Promise<void> {
  try {
    // Update status to running
    await supabase
      .from('ai_job_queue')
      .update({ 
        status: 'running', 
        started_at: new Date().toISOString(),
        progress: 0,
      })
      .eq('id', dbId);
    
    // Simulate progress updates
    for (let progress = 0; progress <= 100; progress += 20) {
      // Check if cancelled
      const { data: check } = await supabase
        .from('ai_job_queue')
        .select('status')
        .eq('id', dbId)
        .single();
      
      if (check?.status === 'cancelled') {
        return;
      }
      
      // Update progress
      await supabase
        .from('ai_job_queue')
        .update({ 
          progress,
          heartbeat_at: new Date().toISOString(),
        })
        .eq('id', dbId);
      
      // Simulate work
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Mark complete
    await supabase
      .from('ai_job_queue')
      .update({ 
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
        result: {
          content: { /* translation result */ },
          model: 'gemini-1.5-flash',
          promptTokens: 100,
          completionTokens: 200,
        },
      })
      .eq('id', dbId);
      
  } catch (error) {
    // Mark failed
    await supabase
      .from('ai_job_queue')
      .update({ 
        status: 'failed',
        error: error.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', dbId);
  }
}

// Main handler
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  const url = new URL(req.url);
  const path = url.pathname;
  
  try {
    if (req.method === 'POST' && path === '/ai-jobs') {
      return await createJob(req);
    }
    
    if (req.method === 'GET' && path.startsWith('/ai-jobs/')) {
      const edgeFunctionId = path.split('/')[2];
      return await getJobStatus(req, edgeFunctionId);
    }
    
    if (req.method === 'POST' && path.includes('/cancel')) {
      const edgeFunctionId = path.split('/')[2];
      return await cancelJob(req, edgeFunctionId);
    }
    
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
