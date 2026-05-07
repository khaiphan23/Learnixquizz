/**
 * Mutation Executor
 * Centralized execution of all mutations with idempotency, retry, and error handling
 */

import type { MutationContext } from './MutationID';
import { mutationLog } from './MutationLog';
import { regenerateForRetry } from './MutationID';

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

// Idempotency cache (in-memory, per-session)
const idempotencyCache = new Map<string, any>();
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000; // 24 hours

class MutationExecutor {
  private executing = new Set<string>();

  async execute<T>(
    context: MutationContext,
    operation: () => Promise<T>,
    options: ExecuteOptions = {}
  ): Promise<ExecuteResult<T>> {
    const { maxRetries = 3, timeoutMs = 30000 } = options;

    // Check if already executing (concurrent duplicate prevention)
    if (this.executing.has(context.idempotencyKey)) {
      console.log(`[MutationExecutor] Duplicate prevented: ${context.idempotencyKey}`);
      return {
        success: false,
        error: new Error('DUPLICATE_MUTATION'),
        mutationId: context.mutationId,
        attempts: 0,
      };
    }

    // Check idempotency cache
    const cached = idempotencyCache.get(context.idempotencyKey);
    if (cached && Date.now() - cached.timestamp < IDEMPOTENCY_TTL) {
      console.log(`[MutationExecutor] Idempotency hit: ${context.idempotencyKey}`);
      return {
        success: true,
        data: cached.result,
        mutationId: context.mutationId,
        attempts: 0,
        fromIdempotencyCache: true,
      };
    }

    this.executing.add(context.idempotencyKey);

    let currentContext = context;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Timeout wrapper
        const result = await this.withTimeout(operation(), timeoutMs);

        // Success - cache for idempotency
        idempotencyCache.set(context.idempotencyKey, {
          result,
          timestamp: Date.now(),
        });

        // Acknowledge in mutation log
        mutationLog.acknowledge(currentContext.mutationId, result);

        this.executing.delete(context.idempotencyKey);

        return {
          success: true,
          data: result,
          mutationId: currentContext.mutationId,
          attempts: attempt + 1,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if retryable
        if (!this.isRetryableError(lastError) || attempt >= maxRetries) {
          break;
        }

        // Retry with new context
        console.log(`[MutationExecutor] Retry ${attempt + 1}/${maxRetries} for ${context.operation}`);
        currentContext = regenerateForRetry(currentContext);
        options.onRetry?.(attempt + 1, lastError);

        // Exponential backoff
        await this.delay(Math.min(1000 * Math.pow(2, attempt), 10000));
      }
    }

    // All retries failed
    mutationLog.fail(currentContext.mutationId, lastError?.message || 'Unknown error');
    this.executing.delete(context.idempotencyKey);

    return {
      success: false,
      error: lastError,
      mutationId: currentContext.mutationId,
      attempts: maxRetries + 1,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('MUTATION_TIMEOUT')), timeoutMs)
      ),
    ]);
  }

  private isRetryableError(error: Error): boolean {
    const retryableCodes = [
      'NETWORK_ERROR',
      'MUTATION_TIMEOUT',
      'SERVER_ERROR',
      'RATE_LIMITED',
      'STORAGE_ERROR',
    ];

    // Non-retryable errors
    if (error.message.includes('UNAUTHORIZED')) return false;
    if (error.message.includes('VALIDATION_ERROR')) return false;
    if (error.message.includes('VERSION_CONFLICT')) return false;
    if (error.message.includes('DUPLICATE_MUTATION')) return false;

    return retryableCodes.some((code) => error.message.includes(code));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const mutationExecutor = new MutationExecutor();

// Convenience hook
export function useMutationExecutor() {
  return {
    execute: <T>(
      context: MutationContext,
      operation: () => Promise<T>,
      options?: ExecuteOptions
    ) => mutationExecutor.execute(context, operation, options),
  };
}
