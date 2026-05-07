/**
 * Optimistic Update Engine
 * Manages optimistic state changes with rollback and server reconciliation
 */

import type { MutationContext } from './MutationID';

export interface OptimisticUpdate<T> {
  context: MutationContext;
  currentState: T;
  optimisticState: T;
  metadata?: {
    placeholderId?: string;
    affectedKeys?: string[][];
  };
}

interface ReconciliationResult<T> {
  finalState: T;
  hadConflict: boolean;
  conflicts?: string[];
}

class OptimisticEngine {
  private activeUpdates = new Map<string, OptimisticUpdate<any>>();

  // Create optimistic update
  create<T>(
    context: MutationContext,
    getCurrentState: () => T,
    applyOptimistic: (current: T) => T,
    metadata?: OptimisticUpdate<T>['metadata']
  ): { optimisticState: T; snapshot: T } {
    const currentState = getCurrentState();
    const optimisticState = applyOptimistic(structuredClone(currentState));

    const update: OptimisticUpdate<T> = {
      context,
      currentState: structuredClone(currentState),
      optimisticState,
      metadata,
    };

    this.activeUpdates.set(context.mutationId, update);

    return { optimisticState, snapshot: currentState };
  }

  // Confirm optimistic (server success)
  confirm<T>(
    mutationId: string,
    serverResult: any,
    mergeStrategy: 'replace' | 'merge' = 'merge'
  ): ReconciliationResult<T> | null {
    const update = this.activeUpdates.get(mutationId);
    if (!update) return null;

    this.activeUpdates.delete(mutationId);

    if (mergeStrategy === 'replace') {
      return {
        finalState: serverResult,
        hadConflict: false,
      };
    }

    // Merge strategy: preserve optimistic if server doesn't conflict
    const conflicts = this.detectConflicts(update.optimisticState, serverResult);
    const hadConflict = conflicts.length > 0;

    const finalState = hadConflict
      ? this.mergeStates(update.optimisticState, serverResult)
      : serverResult;

    return { finalState, hadConflict, conflicts };
  }

  // Rollback to previous state
  rollback<T>(mutationId: string): T | null {
    const update = this.activeUpdates.get(mutationId);
    if (!update) return null;

    this.activeUpdates.delete(mutationId);

    console.log(`[OptimisticEngine] Rolled back ${update.context.operation}`);

    return update.currentState;
  }

  // Check for conflicts between optimistic and server states
  private detectConflicts(optimistic: any, server: any): string[] {
    const conflicts: string[] = [];

    // Check version conflicts
    if (optimistic.version && server.version && optimistic.version !== server.version) {
      conflicts.push('version');
    }

    // Check timestamp conflicts
    if (optimistic.updatedAt && server.updatedAt) {
      const optimisticTime = new Date(optimistic.updatedAt).getTime();
      const serverTime = new Date(server.updatedAt).getTime();
      if (serverTime > optimisticTime) {
        conflicts.push('timestamp');
      }
    }

    // Check field-level conflicts for key fields
    const fieldsToCheck = ['title', 'description', 'content', 'questions'];
    fieldsToCheck.forEach((field) => {
      if (optimistic[field] && server[field]) {
        if (JSON.stringify(optimistic[field]) !== JSON.stringify(server[field])) {
          conflicts.push(field);
        }
      }
    });

    return conflicts;
  }

  // Merge states (server wins on conflict)
  private mergeStates(optimistic: any, server: any): any {
    return {
      ...optimistic,
      ...server,
      // Preserve optimistic IDs for new entities
      _optimisticIds: optimistic._optimisticIds,
    };
  }

  // Get active optimistic update for entity
  getActiveForEntity(entityId: string): OptimisticUpdate<any> | undefined {
    return Array.from(this.activeUpdates.values()).find(
      (u) => u.context.entityId === entityId
    );
  }

  // Check if entity has pending optimistic update
  hasPending(entityId: string): boolean {
    return this.getActiveForEntity(entityId) !== undefined;
  }

  // Cleanup old updates
  cleanup(maxAgeMs: number = 5 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;

    this.activeUpdates.forEach((update, id) => {
      if (update.context.timestamp < cutoff) {
        this.activeUpdates.delete(id);
        count++;
      }
    });

    return count;
  }
}

export const optimisticEngine = new OptimisticEngine();

// React hook for components
export function useOptimisticEngine() {
  return {
    create: <T>(
      context: MutationContext,
      getCurrentState: () => T,
      applyOptimistic: (current: T) => T,
      metadata?: OptimisticUpdate<T>['metadata']
    ) => optimisticEngine.create(context, getCurrentState, applyOptimistic, metadata),
    confirm: <T>(mutationId: string, serverResult: any, strategy?: 'replace' | 'merge') =>
      optimisticEngine.confirm<T>(mutationId, serverResult, strategy),
    rollback: <T>(mutationId: string) => optimisticEngine.rollback<T>(mutationId),
    hasPending: (entityId: string) => optimisticEngine.hasPending(entityId),
  };
}
