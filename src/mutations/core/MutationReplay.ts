/**
 * Mutation Replay System
 * Handles recovery and replay of pending mutations after offline/reconnect
 */

import { mutationLog } from './MutationLog';
import { mutationExecutor } from './MutationExecutor';
import { optimisticEngine } from './OptimisticEngine';
import { regenerateForRetry } from './MutationID';
import type { MutationEntry } from './MutationLog';

export interface ReplayResult {
  attempted: number;
  succeeded: number;
  failed: number;
  rolledBack: number;
  skipped: number;
}

class MutationReplay {
  private isReplaying = false;

  // Main replay function - call on reconnect/refresh
  async replay(): Promise<ReplayResult> {
    if (this.isReplaying) {
      console.log('[MutationReplay] Replay already in progress');
      return { attempted: 0, succeeded: 0, failed: 0, rolledBack: 0, skipped: 0 };
    }

    const pending = mutationLog.getPending();
    if (pending.length === 0) {
      return { attempted: 0, succeeded: 0, failed: 0, rolledBack: 0, skipped: 0 };
    }

    this.isReplaying = true;
    console.log(`[MutationReplay] Starting replay of ${pending.length} mutations`);

    const result: ReplayResult = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      rolledBack: 0,
      skipped: 0,
    };

    for (const entry of pending) {
      // Skip if too many retries
      if (entry.context.retryCount >= 3) {
        console.log(`[MutationReplay] Max retries reached for ${entry.context.mutationId}`);
        mutationLog.rollback(entry.context.mutationId);
        result.rolledBack++;
        continue;
      }

      // Skip if entity was deleted
      if (await this.isEntityDeleted(entry)) {
        console.log(`[MutationReplay] Entity deleted, skipping ${entry.context.mutationId}`);
        mutationLog.acknowledge(entry.context.mutationId, { skipped: true });
        result.skipped++;
        continue;
      }

      result.attempted++;

      try {
        // Check server state first
        const serverState = await this.fetchServerState(entry);
        
        if (this.isAlreadyApplied(entry, serverState)) {
          console.log(`[MutationReplay] Already applied ${entry.context.mutationId}`);
          mutationLog.acknowledge(entry.context.mutationId, serverState);
          result.succeeded++;
          continue;
        }

        // Regenerate context for retry
        const retryContext = regenerateForRetry(entry.context);

        // Re-execute with new context
        const executeResult = await this.reExecute(entry, retryContext);

        if (executeResult.success) {
          result.succeeded++;
        } else {
          result.failed++;
          
          // Rollback on final failure
          if (retryContext.retryCount >= 3) {
            optimisticEngine.rollback(entry.context.mutationId);
            result.rolledBack++;
          }
        }
      } catch (error) {
        console.error(`[MutationReplay] Failed to replay ${entry.context.mutationId}:`, error);
        result.failed++;
      }
    }

    this.isReplaying = false;
    console.log('[MutationReplay] Complete:', result);

    return result;
  }

  // Check if entity was deleted
  private async isEntityDeleted(entry: MutationEntry): Promise<boolean> {
    // For quiz mutations, check if quiz still exists
    if (entry.entityType === 'quiz' || entry.entityType === 'question') {
      try {
        const { data } = await import('../../services/supabase').then((m) =>
          m.supabase.from('quizzes').select('id').eq('id', entry.entityId).single()
        );
        return data === null;
      } catch {
        return true; // Assume deleted on error
      }
    }
    return false;
  }

  // Fetch current server state for entity
  private async fetchServerState(entry: MutationEntry): Promise<any> {
    try {
      const { supabase } = await import('../../services/supabase');
      
      switch (entry.entityType) {
        case 'quiz':
          const { data } = await supabase
            .from('quizzes')
            .select('*')
            .eq('id', entry.entityId)
            .single();
          return data;
        case 'translation':
          const { data: trans } = await supabase
            .from('translations')
            .select('*')
            .eq('quiz_id', entry.entityId)
            .single();
          return trans;
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  // Check if mutation was already applied
  private isAlreadyApplied(entry: MutationEntry, serverState: any): boolean {
    if (!serverState) return false;

    // Check timestamp - if server updated after our mutation, it may have been applied
    if (entry.payload.updatedAt && serverState.updated_at) {
      const serverTime = new Date(serverState.updated_at).getTime();
      const payloadTime = new Date(entry.payload.updatedAt).getTime();
      
      if (serverTime >= payloadTime) {
        // Additional checks for specific operations
        switch (entry.operation) {
          case 'update_quiz':
            return this.shallowEqual(entry.payload, serverState);
          case 'create_quiz':
            return serverState.id === entry.entityId;
          default:
            return true; // Assume applied if timestamp newer
        }
      }
    }

    return false;
  }

  // Re-execute mutation
  private async reExecute(
    entry: MutationEntry,
    context: typeof entry.context
  ): Promise<{ success: boolean }> {
    // This would need operation-specific re-execution logic
    // For now, mark as failed (specific re-execution implemented per operation)
    console.log(`[MutationReplay] Re-executing ${entry.operation}`);
    
    mutationLog.fail(entry.context.mutationId, 'REQUIRES_MANUAL_RETRY');
    
    return { success: false };
  }

  private shallowEqual(a: any, b: any): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    
    if (keysA.length !== keysB.length) return false;
    
    return keysA.every((key) => a[key] === b[key]);
  }

  // Get replay status
  getStatus(): { isReplaying: boolean; pendingCount: number } {
    return {
      isReplaying: this.isReplaying,
      pendingCount: mutationLog.getPending().length,
    };
  }
}

export const mutationReplay = new MutationReplay();

// Hook
export function useMutationReplay() {
  return {
    replay: () => mutationReplay.replay(),
    getStatus: () => mutationReplay.getStatus(),
  };
}
