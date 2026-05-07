/**
 * Mutation Log System
 * Journals all mutations for recovery, replay, and rollback
 */

import type { MutationContext } from './MutationID';

export interface MutationEntry {
  context: MutationContext;
  operation: string;
  entityType: 'quiz' | 'question' | 'translation' | 'attempt' | 'user';
  entityId: string;
  payload: any;
  optimisticSnapshot: any;
  status: 'pending' | 'acknowledged' | 'failed' | 'rolled_back';
  error?: string;
  serverResponse?: any;
  createdAt: number;
  updatedAt: number;
}

export type MutationStatus = MutationEntry['status'];

const STORAGE_KEY = 'learnix-mutation-log-v1';

class MutationLog {
  private entries: Map<string, MutationEntry> = new Map();
  private initialized = false;

  constructor() {
    this.hydrateFromStorage();
    this.startPersistenceLoop();
  }

  // Record new mutation
  record(entry: Omit<MutationEntry, 'createdAt' | 'updatedAt'>): MutationContext {
    const fullEntry: MutationEntry = {
      ...entry,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.entries.set(entry.context.mutationId, fullEntry);
    this.persist();

    console.log(`[MutationLog] Recorded ${entry.operation} (${entry.context.mutationId})`);
    return entry.context;
  }

  // Mark as successfully completed
  acknowledge(mutationId: string, serverResponse: any): void {
    const entry = this.entries.get(mutationId);
    if (entry) {
      entry.status = 'acknowledged';
      entry.serverResponse = serverResponse;
      entry.updatedAt = Date.now();
      this.persist();

      console.log(`[MutationLog] Acknowledged ${entry.operation} (${mutationId})`);

      // Remove after delay (keep for debugging)
      setTimeout(() => {
        this.entries.delete(mutationId);
        this.persist();
      }, 60000);
    }
  }

  // Mark as failed
  fail(mutationId: string, error: string): void {
    const entry = this.entries.get(mutationId);
    if (entry) {
      entry.status = 'failed';
      entry.error = error;
      entry.updatedAt = Date.now();
      this.persist();

      console.log(`[MutationLog] Failed ${entry.operation} (${mutationId}): ${error}`);
    }
  }

  // Rollback to previous state
  rollback(mutationId: string, onRollback?: (snapshot: any) => void): boolean {
    const entry = this.entries.get(mutationId);
    if (!entry) return false;

    console.log(`[MutationLog] Rolling back ${entry.operation} (${mutationId})`);

    // Restore optimistic snapshot
    if (onRollback) {
      onRollback(entry.optimisticSnapshot);
    }

    entry.status = 'rolled_back';
    entry.updatedAt = Date.now();
    this.persist();

    return true;
  }

  // Get pending mutations (for replay on recovery)
  getPending(): MutationEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => e.status === 'pending' || e.status === 'failed')
      .sort((a, b) => a.context.timestamp - b.context.timestamp);
  }

  // Get all entries for debugging
  getAll(): MutationEntry[] {
    return Array.from(this.entries.values());
  }

  // Get specific entry
  get(mutationId: string): MutationEntry | undefined {
    return this.entries.get(mutationId);
  }

  // Check if similar mutation exists (deduplication)
  findSimilar(
    userId: string,
    entityId: string,
    operation: string,
    timeWindowMs: number = 5000
  ): MutationEntry | undefined {
    const now = Date.now();
    return Array.from(this.entries.values()).find(
      (e) =>
        e.context.userId === userId &&
        e.context.entityId === entityId &&
        e.context.operation === operation &&
        now - e.context.timestamp < timeWindowMs &&
        ['pending', 'acknowledged'].includes(e.status)
    );
  }

  // Clear old entries
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;

    this.entries.forEach((entry, id) => {
      if (entry.createdAt < cutoff) {
        this.entries.delete(id);
        count++;
      }
    });

    if (count > 0) {
      this.persist();
    }

    return count;
  }

  // Persistence
  private persist(): void {
    if (typeof window === 'undefined') return;

    try {
      const serializable = Array.from(this.entries.entries());
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (e) {
      console.error('[MutationLog] Persistence failed:', e);
    }
  }

  private hydrateFromStorage(): void {
    if (typeof window === 'undefined') return;
    if (this.initialized) return;

    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.entries = new Map(parsed);
        console.log(`[MutationLog] Hydrated ${this.entries.size} entries`);
      }
    } catch (e) {
      console.error('[MutationLog] Hydration failed:', e);
    }

    this.initialized = true;
  }

  private startPersistenceLoop(): void {
    // Periodic cleanup
    setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000); // Hourly
  }
}

// Singleton instance
export const mutationLog = new MutationLog();

// Hook for React components
export function useMutationLog() {
  return {
    record: (entry: Omit<MutationEntry, 'createdAt' | 'updatedAt'>) =>
      mutationLog.record(entry),
    acknowledge: (mutationId: string, response: any) =>
      mutationLog.acknowledge(mutationId, response),
    fail: (mutationId: string, error: string) => mutationLog.fail(mutationId, error),
    rollback: (mutationId: string, onRollback?: (snapshot: any) => void) =>
      mutationLog.rollback(mutationId, onRollback),
    getPending: () => mutationLog.getPending(),
  };
}
