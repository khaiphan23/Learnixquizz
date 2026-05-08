/**
 * Mutation Type Definitions
 * Core types for distributed mutation system
 */

export type MutationStatus = 'pending' | 'acknowledged' | 'failed' | 'rolled_back';

export type EntityType = 'quiz' | 'question' | 'translation' | 'attempt' | 'user';

export interface MutationContext {
  mutationId: string;
  idempotencyKey: string;
  timestamp: number;
  sequenceNumber: number;
  tabId: string;
  retryCount: number;
  userId: string;
  entityId: string;
  operation: string;
}

export interface MutationEntry {
  context: MutationContext;
  operation: string;
  entityType: EntityType;
  entityId: string;
  payload: any;
  optimisticSnapshot: any;
  status: MutationStatus;
  error?: string;
  serverResponse?: any;
  createdAt: number;
  updatedAt: number;
}

export interface ExecuteOptions {
  maxRetries?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export interface ExecuteResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  mutationId: string;
  attempts: number;
  fromIdempotencyCache?: boolean;
}
