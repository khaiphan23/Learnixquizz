/**
 * Cache Synchronizer
 * Manages React Query cache with surgical updates and deduplicated refetching
 */

import { queryClient } from '../lib/queryClient';

interface CachePatch {
  queryKey: string[];
  updater: (old: any) => any;
}

class CacheSynchronizer {
  private pendingPatches: Map<string, CachePatch> = new Map();
  private refetchQueue: Set<string> = new Set();
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 100;

  // Apply surgical patch to specific query
  patch<T>(queryKey: string[], updater: (old: T) => T): void {
    const key = JSON.stringify(queryKey);
    
    // Queue patch
    this.pendingPatches.set(key, { queryKey, updater });
    
    // Debounce flush
    this.scheduleFlush();
  }

  // Batch patch multiple queries
  batchPatch(patches: CachePatch[]): void {
    patches.forEach((patch) => {
      const key = JSON.stringify(patch.queryKey);
      this.pendingPatches.set(key, patch);
    });
    
    this.scheduleFlush();
  }

  // Queue refetch (deduplicated)
  queueRefetch(queryKey: string[], options: { 
    immediate?: boolean;
    inactiveOnly?: boolean;
  } = {}): void {
    const key = JSON.stringify(queryKey);
    
    // Check if already refetching
    const query = queryClient.getQueryCache().find({ queryKey });
    if (query?.state.isFetching) return;

    if (options.immediate) {
      this.executeRefetch(queryKey, options.inactiveOnly);
    } else {
      this.refetchQueue.add(key);
      this.scheduleFlush();
    }
  }

  // Invalidate without immediate refetch (mark stale)
  markStale(queryKey: string[]): void {
    queryClient.invalidateQueries({
      queryKey,
      exact: false,
      refetchType: 'none',
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(() => {
      this.flush();
    }, this.DEBOUNCE_MS);
  }

  private flush(): void {
    // Apply all pending patches
    this.pendingPatches.forEach((patch) => {
      queryClient.setQueryData(patch.queryKey, patch.updater);
    });
    this.pendingPatches.clear();

    // Execute queued refetches
    this.refetchQueue.forEach((key) => {
      const queryKey = JSON.parse(key);
      this.executeRefetch(queryKey);
    });
    this.refetchQueue.clear();
  }

  private executeRefetch(queryKey: string[], inactiveOnly?: boolean): void {
    const query = queryClient.getQueryCache().find({ queryKey });
    
    if (!query) return;

    // Skip if recently fetched
    if (Date.now() - query.state.dataUpdatedAt < 1000) return;

    if (inactiveOnly && query.getObserversCount() > 0) {
      // Only mark stale, don't refetch active queries
      query.invalidate();
      return;
    }

    queryClient.refetchQueries({ queryKey, exact: true });
  }

  // Immediate full reset (emergency use)
  reset(): void {
    this.pendingPatches.clear();
    this.refetchQueue.clear();
    queryClient.clear();
  }

  // Get cache stats
  getStats(): {
    queries: number;
    pendingPatches: number;
    pendingRefetches: number;
  } {
    return {
      queries: queryClient.getQueryCache().getAll().length,
      pendingPatches: this.pendingPatches.size,
      pendingRefetches: this.refetchQueue.size,
    };
  }
}

export const cacheSynchronizer = new CacheSynchronizer();

export function useCacheSynchronizer() {
  return {
    patch: <T>(key: string[], updater: (old: T) => T) =>
      cacheSynchronizer.patch(key, updater),
    batchPatch: (patches: CachePatch[]) => cacheSynchronizer.batchPatch(patches),
    queueRefetch: (key: string[], options?: { immediate?: boolean; inactiveOnly?: boolean }) =>
      cacheSynchronizer.queueRefetch(key, options),
    markStale: (key: string[]) => cacheSynchronizer.markStale(key),
    reset: () => cacheSynchronizer.reset(),
    getStats: () => cacheSynchronizer.getStats(),
  };
}
