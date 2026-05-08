/**
 * AI Generation Service with Pipeline Integration
 * Wraps geminiService with persistent job tracking and recovery
 */

import { Question, EssayGrade } from '../types';
import { generateQuizAI, extractQuizFromDocument, gradeEssayAnswer } from './geminiService';
import { aiPipeline } from '../ai/AIPipeline';
import type { AIJob } from '../ai/AIPipeline';

export interface AIGenerationOptions {
  onProgress?: (progress: number) => void;
  onComplete?: (questions: Question[]) => void;
  onError?: (error: Error) => void;
}

export interface AIExtractionOptions extends AIGenerationOptions {
  documentName?: string;
}

export interface AIGradingOptions {
  onProgress?: (progress: number) => void;
  onComplete?: (grade: EssayGrade) => void;
  onError?: (error: Error) => void;
}

/**
 * Generate quiz with AI pipeline tracking
 * Survives refresh and recovers automatically
 */
export async function generateQuizWithPipeline(
  entityId: string,
  topic: string,
  numQuestions: number,
  difficulty: string,
  language: string,
  options: AIGenerationOptions = {}
): Promise<{ jobId: string; questions?: Question[] }> {
  // Submit job to pipeline
  const job = aiPipeline.submit({
    type: 'generate',
    entityId,
    status: 'pending',
    progress: 0,
    retryCount: 0,
    metadata: {
      topic,
      numQuestions,
      difficulty,
      language,
    },
  });

  options.onProgress?.(10);

  try {
    // Execute generation
    const questions = await generateQuizAI(topic, numQuestions, difficulty, language);
    
    // Mark as completed
    aiPipeline.submit({
      ...job,
      status: 'completed',
      progress: 100,
      result: questions,
      completedAt: Date.now(),
    });

    options.onProgress?.(100);
    options.onComplete?.(questions);

    return { jobId: job.id, questions };
  } catch (error) {
    // Mark as failed
    aiPipeline.submit({
      ...job,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      completedAt: Date.now(),
    });

    options.onError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Extract quiz from document with pipeline tracking
 */
export async function extractQuizWithPipeline(
  entityId: string,
  documentContent: string,
  language: string,
  options: AIExtractionOptions = {}
): Promise<{ jobId: string; questions?: Question[] }> {
  // Submit job
  const job = aiPipeline.submit({
    type: 'extract',
    entityId,
    status: 'pending',
    progress: 0,
    retryCount: 0,
    metadata: {
      documentName: options.documentName || 'document',
      contentLength: documentContent.length,
      language,
    },
  });

  options.onProgress?.(5);

  try {
    // Execute extraction
    const questions = await extractQuizFromDocument(documentContent, language);
    
    aiPipeline.submit({
      ...job,
      status: 'completed',
      progress: 100,
      result: questions,
      completedAt: Date.now(),
    });

    options.onProgress?.(100);
    options.onComplete?.(questions);

    return { jobId: job.id, questions };
  } catch (error) {
    aiPipeline.submit({
      ...job,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      completedAt: Date.now(),
    });

    options.onError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Grade essay with pipeline tracking
 */
export async function gradeEssayWithPipeline(
  entityId: string,
  questionText: string,
  userAnswer: string,
  maxScore: number,
  referenceAnswer?: string,
  options: AIGradingOptions = {}
): Promise<{ jobId: string; grade?: EssayGrade }> {
  // Submit job
  const job = aiPipeline.submit({
    type: 'grade',
    entityId,
    status: 'pending',
    progress: 0,
    retryCount: 0,
    metadata: {
      maxScore,
      hasReference: !!referenceAnswer,
    },
  });

  options.onProgress?.(20);

  try {
    // Execute grading
    const grade = await gradeEssayAnswer(
      questionText,
      userAnswer,
      maxScore,
      referenceAnswer
    );
    
    aiPipeline.submit({
      ...job,
      status: 'completed',
      progress: 100,
      result: grade,
      completedAt: Date.now(),
    });

    options.onProgress?.(100);
    options.onComplete?.(grade);

    return { jobId: job.id, grade };
  } catch (error) {
    aiPipeline.submit({
      ...job,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      completedAt: Date.now(),
    });

    options.onError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Cancel an AI job
 */
export function cancelAIGeneration(jobId: string): boolean {
  return aiPipeline.cancel(jobId);
}

/**
 * Get status of an AI job
 */
export function getAIJobStatus(jobId: string): AIJob | undefined {
  return aiPipeline.getJob(jobId);
}

/**
 * Get all AI jobs for an entity
 */
export function getAIJobsForEntity(entityId: string): AIJob[] {
  return aiPipeline.getJobs().filter(j => j.entityId === entityId);
}

/**
 * Check if entity has pending AI operations
 */
export function hasPendingAIOperations(entityId: string): boolean {
  return aiPipeline.getJobs().some(j => 
    j.entityId === entityId && 
    (j.status === 'pending' || j.status === 'running')
  );
}

/**
 * Retry a failed AI job
 */
export async function retryAIGeneration(
  jobId: string,
  options: AIGenerationOptions = {}
): Promise<{ jobId: string; questions?: Question[] }> {
  const job = aiPipeline.getJob(jobId);
  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status !== 'failed' && job.status !== 'cancelled') {
    throw new Error(`Cannot retry job with status: ${job.status}`);
  }

  const { type, entityId, metadata } = job;

  // Reset job status
  aiPipeline.submit({
    ...job,
    status: 'pending',
    progress: 0,
    error: undefined,
    retryCount: job.retryCount + 1,
  });

  // Re-execute based on type
  switch (type) {
    case 'generate':
      return generateQuizWithPipeline(
        entityId,
        metadata?.topic || '',
        metadata?.numQuestions || 5,
        metadata?.difficulty || 'medium',
        metadata?.language || 'vi',
        options
      );
    
    case 'extract':
      // For extract, we need the original document content
      // This should be stored in the job metadata
      throw new Error('Retry for extract not implemented - document content not persisted');
    
    case 'grade':
      // For grade, we need the original inputs
      throw new Error('Retry for grade not implemented - inputs not persisted');
    
    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}

// Re-export original functions for backward compatibility
export { generateQuizAI, extractQuizFromDocument, gradeEssayAnswer } from './geminiService';
