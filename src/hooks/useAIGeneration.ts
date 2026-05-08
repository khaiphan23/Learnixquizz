/**
 * AI Generation Hook
 * Persistent AI job queue with recovery and cancellation
 */

import { useCallback, useEffect, useState } from 'react';
import { aiPipeline } from '../ai/AIPipeline';
import type { AIJob, AIJobType } from '../ai/AIPipeline';

export interface UseAIGenerationOptions {
  onJobComplete?: (job: AIJob) => void;
  onJobFailed?: (job: AIJob) => void;
  onProgressUpdate?: (jobId: string, progress: number) => void;
}

export function useAIGeneration(options: UseAIGenerationOptions = {}) {
  const [jobs, setJobs] = useState<AIJob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Get initial jobs
    setJobs(aiPipeline.getJobs());

    // Subscribe to job updates
    const unsubscribe = aiPipeline.subscribe((updatedJobs) => {
      setJobs(updatedJobs);
      setIsProcessing(updatedJobs.some(j => j.status === 'running'));

      // Check for completed jobs
      updatedJobs.forEach(job => {
        if (job.status === 'completed' && job.completedAt) {
          // Check if just completed (within last 2 seconds)
          if (Date.now() - job.completedAt < 2000) {
            options.onJobComplete?.(job);
          }
        }
        if (job.status === 'failed' && job.completedAt) {
          if (Date.now() - job.completedAt < 2000) {
            options.onJobFailed?.(job);
          }
        }
        if (job.status === 'running') {
          options.onProgressUpdate?.(job.id, job.progress);
        }
      });
    });

    return () => {
      unsubscribe();
    };
  }, [options]);

  /**
   * Submit AI translation job
   */
  const submitTranslation = useCallback(async (
    entityId: string,
    targetLanguage: string,
    content: any
  ): Promise<AIJob> => {
    return aiPipeline.submit({
      type: 'translate',
      entityId,
      targetLanguage,
      status: 'pending',
      progress: 0,
      retryCount: 0,
    });
  }, []);

  /**
   * Submit AI extraction job (from document)
   */
  const submitExtraction = useCallback(async (
    entityId: string,
    documentContent: string
  ): Promise<AIJob> => {
    return aiPipeline.submit({
      type: 'extract',
      entityId,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      metadata: {
        documentContent,
      },
    });
  }, []);

  /**
   * Submit AI generation job
   */
  const submitGeneration = useCallback(async (
    entityId: string,
    prompt: string
  ): Promise<AIJob> => {
    return aiPipeline.submit({
      type: 'generate',
      entityId,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      metadata: {
        prompt,
      },
    });
  }, []);

  /**
   * Cancel a job
   */
  const cancelJob = useCallback(async (jobId: string): Promise<boolean> => {
    return aiPipeline.cancel(jobId);
  }, []);

  /**
   * Get job status
   */
  const getJob = useCallback((jobId: string): AIJob | undefined => {
    return aiPipeline.getJob(jobId);
  }, []);

  /**
   * Get jobs for a specific entity
   */
  const getJobsForEntity = useCallback((entityId: string): AIJob[] => {
    return jobs.filter(j => j.entityId === entityId);
  }, [jobs]);

  /**
   * Check if entity has pending AI operations
   */
  const hasPendingJobs = useCallback((entityId: string): boolean => {
    return jobs.some(j => 
      j.entityId === entityId && 
      (j.status === 'pending' || j.status === 'running')
    );
  }, [jobs]);

  /**
   * Get overall progress for an entity
   */
  const getEntityProgress = useCallback((entityId: string): number => {
    const entityJobs = jobs.filter(j => j.entityId === entityId);
    if (entityJobs.length === 0) return 100;
    
    const totalProgress = entityJobs.reduce((sum, j) => sum + j.progress, 0);
    return Math.round(totalProgress / entityJobs.length);
  }, [jobs]);

  return {
    jobs,
    isProcessing,
    submitTranslation,
    submitExtraction,
    submitGeneration,
    cancelJob,
    getJob,
    getJobsForEntity,
    hasPendingJobs,
    getEntityProgress,
  };
}
