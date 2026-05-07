/**
 * AI Pipeline
 * Manages AI job execution with queue, recovery, and cancellation
 */

import { createMutationContext } from '../mutations/core/MutationID';
import { mutationLog } from '../mutations/core/MutationLog';
import { optimisticEngine } from '../mutations/core/OptimisticEngine';
import { cacheSynchronizer } from '../cache/CacheSynchronizer';

export type AIJobType = 'translate' | 'extract' | 'generate';
export type AIJobStatus = 
  | 'pending' 
  | 'queued' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

export interface AIJob {
  id: string;
  type: AIJobType;
  entityId: string;
  targetLanguage?: string;
  status: AIJobStatus;
  progress: number;
  result?: any;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  edgeFunctionId?: string;
  retryCount: number;
  metadata?: {
    promptTokens?: number;
    completionTokens?: number;
    model?: string;
  };
}

const STORAGE_KEY = 'learnix-ai-jobs-v1';
const MAX_RETRIES = 2;
const STUCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

class AIPipeline {
  private jobs = new Map<string, AIJob>();
  private activeJobId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private listeners: Set<(jobs: AIJob[]) => void> = new Set();

  constructor() {
    this.hydrateFromStorage();
    this.startHeartbeat();
    this.startQueueProcessor();
  }

  // Submit new AI job
  async submit(jobSpec: Omit<AIJob, 'id' | 'status' | 'progress' | 'retryCount' | 'createdAt'>): Promise<AIJob> {
    const id = `${jobSpec.type}-${jobSpec.entityId}-${Date.now()}`;
    
    // Check for duplicates
    const existing = this.findDuplicate(jobSpec);
    if (existing && ['pending', 'queued', 'running'].includes(existing.status)) {
      console.log(`[AIPipeline] Duplicate job prevented: ${existing.id}`);
      return existing;
    }

    const job: AIJob = {
      ...jobSpec,
      id,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    this.persist();
    this.notifyListeners();

    // Apply optimistic update
    this.applyOptimistic(job);

    // Process queue
    this.processQueue();

    return job;
  }

  // Cancel job
  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'running' && job.edgeFunctionId) {
      // Cancel on server
      try {
        await fetch(`/functions/v1/ai-jobs/${job.edgeFunctionId}/cancel`, {
          method: 'POST',
        });
      } catch (e) {
        console.warn('[AIPipeline] Cancel request failed:', e);
      }
    }

    job.status = 'cancelled';
    job.completedAt = Date.now();
    
    this.jobs.set(jobId, job);
    this.persist();
    this.notifyListeners();

    // Rollback optimistic
    optimisticEngine.rollback(jobId);

    // Process next if this was active
    if (this.activeJobId === jobId) {
      this.activeJobId = null;
      this.processQueue();
    }

    return true;
  }

  private findDuplicate(spec: Partial<AIJob>): AIJob | undefined {
    return Array.from(this.jobs.values()).find((job) =>
      job.type === spec.type &&
      job.entityId === spec.entityId &&
      job.targetLanguage === spec.targetLanguage &&
      ['pending', 'queued', 'running'].includes(job.status)
    );
  }

  private applyOptimistic(job: AIJob): void {
    // Apply optimistic translation placeholder
    if (job.type === 'translate') {
      const queryKey = ['quiz', job.entityId, job.targetLanguage];
      
      cacheSynchronizer.patch(queryKey, (old: any) => {
        if (!old) return old;
        
        return {
          ...old,
          _optimisticTranslation: {
            status: 'translating',
            progress: 0,
            jobId: job.id,
          },
        };
      });
    }
  }

  private async processQueue(): Promise<void> {
    if (this.activeJobId) return; // Already processing

    const pending = Array.from(this.jobs.values())
      .filter((j) => j.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);

    if (pending.length === 0) return;

    const job = pending[0];
    this.activeJobId = job.id;
    job.status = 'running';
    job.startedAt = Date.now();
    
    this.jobs.set(job.id, job);
    this.persist();
    this.notifyListeners();

    try {
      await this.executeJob(job);
    } catch (error) {
      this.handleJobError(job, error as Error);
    }

    this.activeJobId = null;
    this.processQueue(); // Process next
  }

  private async executeJob(job: AIJob): Promise<void> {
    // Submit to Edge Function
    const response = await fetch('/functions/v1/ai-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: job.id,
        type: job.type,
        entityId: job.entityId,
        targetLanguage: job.targetLanguage,
      }),
    });

    if (!response.ok) {
      throw new Error(`Job submission failed: ${response.status}`);
    }

    const { edgeFunctionId } = await response.json();
    job.edgeFunctionId = edgeFunctionId;
    this.jobs.set(job.id, job);

    // Poll for completion
    await this.pollJobCompletion(job);
  }

  private async pollJobCompletion(job: AIJob): Promise<void> {
    const pollInterval = 2000;
    const maxPollTime = 10 * 60 * 1000; // 10 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      // Check if cancelled
      if (job.status === 'cancelled') return;

      try {
        const response = await fetch(
          `/functions/v1/ai-jobs/${job.edgeFunctionId}/status`
        );

        if (!response.ok) {
          await this.delay(pollInterval);
          continue;
        }

        const status = await response.json();

        // Update progress
        if (status.progress !== job.progress) {
          job.progress = status.progress;
          this.jobs.set(job.id, job);
          this.persist();
          this.notifyListeners();
        }

        // Check completion
        if (status.status === 'completed') {
          await this.finalizeJob(job, status.result);
          return;
        }

        if (status.status === 'failed') {
          throw new Error(status.error || 'Job failed');
        }

      } catch (error) {
        // Continue polling on error
      }

      await this.delay(pollInterval);
    }

    throw new Error('Job timeout');
  }

  private async finalizeJob(job: AIJob, result: any): Promise<void> {
    job.status = 'completed';
    job.progress = 100;
    job.result = result;
    job.completedAt = Date.now();
    job.metadata = {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      model: result.model,
    };

    // Save to database
    const { error } = await (await import('../services/supabase')).supabase
      .from('translations')
      .insert({
        quiz_id: job.type === 'translate' ? job.entityId : null,
        question_id: null, // Would be set per-question in batch
        language: job.targetLanguage,
        content: result.content,
        status: 'draft',
        translated_by: 'ai',
        ai_model: result.model,
      });

    if (error) {
      job.status = 'failed';
      job.error = 'DB_SAVE_FAILED';
    }

    this.jobs.set(job.id, job);
    this.persist();
    this.notifyListeners();

    // Update cache
    if (job.status === 'completed') {
      cacheSynchronizer.queueRefetch(
        ['quiz', job.entityId, job.targetLanguage],
        { immediate: true }
      );
    }
  }

  private handleJobError(job: AIJob, error: Error): void {
    console.error(`[AIPipeline] Job ${job.id} failed:`, error);

    if (job.retryCount < MAX_RETRIES) {
      job.retryCount++;
      job.status = 'pending';
      job.progress = 0;
      this.jobs.set(job.id, job);
      this.persist();
      
      // Retry after delay
      setTimeout(() => this.processQueue(), 5000 * job.retryCount);
    } else {
      job.status = 'failed';
      job.error = error.message;
      job.completedAt = Date.now();
      this.jobs.set(job.id, job);
      this.persist();
      this.notifyListeners();

      // Rollback optimistic
      optimisticEngine.rollback(job.id);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      // Check for stuck jobs
      this.jobs.forEach((job) => {
        if (job.status === 'running' && job.startedAt) {
          const elapsed = Date.now() - job.startedAt;
          if (elapsed > STUCK_TIMEOUT_MS) {
            console.warn(`[AIPipeline] Stuck job detected: ${job.id}`);
            this.handleJobError(job, new Error('STUCK_JOB'));
          }
        }
      });
    }, 30000);
  }

  private startQueueProcessor(): void {
    // Ensure queue is processed on mount
    setTimeout(() => this.processQueue(), 1000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private persist(): void {
    if (typeof window === 'undefined') return;

    try {
      const data = Array.from(this.jobs.entries());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('[AIPipeline] Persistence failed:', e);
    }
  }

  private hydrateFromStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.jobs = new Map(parsed);
        
        // Reset running jobs to pending (they were interrupted)
        this.jobs.forEach((job) => {
          if (job.status === 'running') {
            job.status = 'pending';
            job.progress = 0;
          }
        });
      }
    } catch (e) {
      console.error('[AIPipeline] Hydration failed:', e);
    }
  }

  private notifyListeners(): void {
    const jobs = Array.from(this.jobs.values());
    this.listeners.forEach((l) => l(jobs));
  }

  // Public API
  getJobs(): AIJob[] {
    return Array.from(this.jobs.values());
  }

  getJob(id: string): AIJob | undefined {
    return this.jobs.get(id);
  }

  subscribe(listener: (jobs: AIJob[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const aiPipeline = new AIPipeline();

export function useAIPipeline() {
  return {
    submit: (spec: Omit<AIJob, 'id' | 'status' | 'progress' | 'retryCount' | 'createdAt'>) =>
      aiPipeline.submit(spec),
    cancel: (id: string) => aiPipeline.cancel(id),
    getJobs: () => aiPipeline.getJobs(),
    getJob: (id: string) => aiPipeline.getJob(id),
    subscribe: (cb: (jobs: AIJob[]) => void) => aiPipeline.subscribe(cb),
  };
}
