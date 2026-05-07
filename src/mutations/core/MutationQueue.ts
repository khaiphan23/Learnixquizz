/**
 * Mutation Queue
 * Serializes mutations to prevent race conditions and handles offline queuing
 */

import type { MutationContext } from './MutationID';

interface QueuedMutation {
  id: string;
  context: MutationContext;
  execute: () => Promise<any>;
  priority: number;
  dependencies?: string[]; // IDs of mutations that must complete first
}

class MutationQueue {
  private queue: QueuedMutation[] = [];
  private processing = false;
  private current: QueuedMutation | null = null;
  private completed = new Set<string>();
  private listeners: Set<(status: QueueStatus) => void> = new Set();

  get status(): QueueStatus {
    return {
      pending: this.queue.length,
      processing: this.processing,
      current: this.current?.id || null,
    };
  }

  // Add mutation to queue
  async enqueue<T>(
    context: MutationContext,
    execute: () => Promise<T>,
    options: {
      priority?: number;
      dependencies?: string[];
      skipQueue?: boolean;
    } = {}
  ): Promise<T> {
    const { priority = 0, dependencies, skipQueue = false } = options;

    // If skipQueue and nothing processing, execute immediately
    if (skipQueue && !this.processing) {
      return execute();
    }

    return new Promise((resolve, reject) => {
      const wrappedExecute = async () => {
        try {
          const result = await execute();
          resolve(result);
          return result;
        } catch (error) {
          reject(error);
          throw error;
        }
      };

      const queued: QueuedMutation = {
        id: context.mutationId,
        context,
        execute: wrappedExecute,
        priority,
        dependencies,
      };

      // Insert by priority (higher first)
      const insertIndex = this.queue.findIndex((q) => q.priority < priority);
      if (insertIndex === -1) {
        this.queue.push(queued);
      } else {
        this.queue.splice(insertIndex, 0, queued);
      }

      this.notifyListeners();
      this.process();
    });
  }

  // Process queue
  private async process(): Promise<void> {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;
    this.notifyListeners();

    while (this.queue.length > 0) {
      // Find first mutation whose dependencies are satisfied
      const executableIndex = this.queue.findIndex(
        (q) => !q.dependencies || q.dependencies.every((d) => this.completed.has(d))
      );

      if (executableIndex === -1) {
        // Deadlock detection - no executable mutations
        console.error('[MutationQueue] Deadlock detected:', this.queue.map((q) => q.id));
        break;
      }

      const next = this.queue.splice(executableIndex, 1)[0];
      this.current = next;
      this.notifyListeners();

      try {
        await next.execute();
        this.completed.add(next.id);
      } catch (error) {
        console.error(`[MutationQueue] Mutation failed: ${next.id}`, error);
        // Continue processing other mutations
      }

      this.current = null;
      this.notifyListeners();
    }

    this.processing = false;
    this.notifyListeners();
  }

  // Cancel pending mutation
  cancel(mutationId: string): boolean {
    const index = this.queue.findIndex((q) => q.id === mutationId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.notifyListeners();
      return true;
    }
    return false;
  }

  // Get queue status
  getStatus(): QueueStatus {
    return this.status;
  }

  // Subscribe to status changes
  subscribe(listener: (status: QueueStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const status = this.status;
    this.listeners.forEach((l) => l(status));
  }

  // Clear queue (emergency reset)
  clear(): void {
    this.queue = [];
    this.processing = false;
    this.current = null;
    this.notifyListeners();
  }
}

export interface QueueStatus {
  pending: number;
  processing: boolean;
  current: string | null;
}

export const mutationQueue = new MutationQueue();

// Hook for components
export function useMutationQueue() {
  return {
    enqueue: <T>(
      context: MutationContext,
      execute: () => Promise<T>,
      options?: Parameters<MutationQueue['enqueue']>[2]
    ) => mutationQueue.enqueue(context, execute, options),
    cancel: (mutationId: string) => mutationQueue.cancel(mutationId),
    getStatus: () => mutationQueue.getStatus(),
    subscribe: (listener: (status: QueueStatus) => void) =>
      mutationQueue.subscribe(listener),
    clear: () => mutationQueue.clear(),
  };
}
