/**
 * Request Sequencer
 * Ensures mutation requests are executed in order
 * Prevents race conditions from parallel requests
 */

type RequestExecutor<T> = () => Promise<T>;

interface SequencedRequest<T> {
  id: string;
  execute: RequestExecutor<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
}

class RequestSequencer {
  private queues = new Map<string, SequencedRequest<any>[]>();
  private processing = new Set<string>();

  // Execute request in sequence for given entity
  async execute<T>(
    entityId: string,
    execute: RequestExecutor<T>,
    options: { priority?: number; skipQueue?: boolean } = {}
  ): Promise<T> {
    const { priority = 0, skipQueue = false } = options;

    // If skipQueue and not processing, execute immediately
    if (skipQueue && !this.processing.has(entityId)) {
      return execute();
    }

    return new Promise((resolve, reject) => {
      const request: SequencedRequest<T> = {
        id: `${entityId}-${Date.now()}-${Math.random()}`,
        execute,
        resolve,
        reject,
        priority,
      };

      // Get or create queue for entity
      let queue = this.queues.get(entityId);
      if (!queue) {
        queue = [];
        this.queues.set(entityId, queue);
      }

      // Insert by priority
      const insertIndex = queue.findIndex((r) => r.priority < priority);
      if (insertIndex === -1) {
        queue.push(request);
      } else {
        queue.splice(insertIndex, 0, request);
      }

      // Process queue
      this.processQueue(entityId);
    });
  }

  private async processQueue(entityId: string): Promise<void> {
    // If already processing this entity, wait
    if (this.processing.has(entityId)) return;

    const queue = this.queues.get(entityId);
    if (!queue || queue.length === 0) return;

    this.processing.add(entityId);

    while (queue.length > 0) {
      const request = queue.shift()!;

      try {
        const result = await request.execute();
        request.resolve(result);
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.processing.delete(entityId);
    this.queues.delete(entityId);
  }

  // Cancel pending requests for entity
  cancel(entityId: string, reason: string = 'CANCELLED'): number {
    const queue = this.queues.get(entityId);
    if (!queue) return 0;

    const cancelled = [...queue];
    this.queues.delete(entityId);

    cancelled.forEach((req) => {
      req.reject(new Error(reason));
    });

    return cancelled.length;
  }

  // Get queue length for entity
  getQueueLength(entityId: string): number {
    return this.queues.get(entityId)?.length || 0;
  }

  // Check if entity has pending requests
  hasPending(entityId: string): boolean {
    return this.processing.has(entityId) || (this.queues.get(entityId)?.length || 0) > 0;
  }
}

export const requestSequencer = new RequestSequencer();

export function useRequestSequencer() {
  return {
    execute: <T>(
      entityId: string,
      execute: () => Promise<T>,
      options?: { priority?: number; skipQueue?: boolean }
    ) => requestSequencer.execute(entityId, execute, options),
    cancel: (entityId: string, reason?: string) => requestSequencer.cancel(entityId, reason),
    hasPending: (entityId: string) => requestSequencer.hasPending(entityId),
    getQueueLength: (entityId: string) => requestSequencer.getQueueLength(entityId),
  };
}
