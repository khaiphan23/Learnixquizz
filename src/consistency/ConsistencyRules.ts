/**
 * Consistency Rules
 * Defines and enforces consistency rules across the system
 */

import { queryClient } from '../lib/queryClient';
import { cacheSynchronizer } from '../cache/CacheSynchronizer';
import { invalidationManager } from '../cache/QueryInvalidationManager';
import { mutationLog } from '../mutations/core/MutationLog';

class ConsistencyRules {
  // Rule 1: Server response always has authority over optimistic
  enforceServerAuthority<T>(
    mutationId: string,
    serverData: T,
    mergeStrategy: 'replace' | 'merge' = 'merge'
  ): T {
    if (mergeStrategy === 'replace') {
      return serverData;
    }

    // For merge, server fields take precedence
    return serverData;
  }

  // Rule 2: Mark queries stale on mutation, don't immediately refetch
  markAffectedStale(
    mutationType: string,
    entityId?: string,
    options: { 
      affectedKeys?: string[][];
      refetchDelay?: number;
    } = {}
  ): void {
    // Use invalidation manager
    invalidationManager.invalidate(mutationType, { entityId });
  }

  // Rule 3: Tab visibility triggers reconciliation
  handleVisibilityChange(isVisible: boolean): void {
    if (!isVisible) return;

    console.log('[ConsistencyRules] Tab visible, reconciling');

    // 1. Replay any pending mutations
    const pending = mutationLog.getPending();
    if (pending.length > 0) {
      console.log(`[ConsistencyRules] ${pending.length} pending mutations`);
      // Trigger replay
      import('../mutations/core/MutationReplay').then(({ mutationReplay }) => {
        mutationReplay.replay();
      });
    }

    // 2. Refetch stale queries
    const staleQueries = queryClient
      .getQueryCache()
      .getAll()
      .filter((q) => q.isStale() && Date.now() - q.state.dataUpdatedAt > 5000);

    if (staleQueries.length > 0) {
      console.log(`[ConsistencyRules] ${staleQueries.length} stale queries`);
      
      // Batch refetch
      const batchSize = 3;
      for (let i = 0; i < staleQueries.length; i += batchSize) {
        const batch = staleQueries.slice(i, i + batchSize);
        setTimeout(() => {
          batch.forEach((q) => {
            queryClient.refetchQueries({ queryKey: q.queryKey, exact: true });
          });
        }, i * 1000);
      }
    }
  }

  // Rule 4: Language switch clears language-specific caches
  handleLanguageChange(newLang: string, oldLang: string): void {
    console.log(`[ConsistencyRules] Language change: ${oldLang} -> ${newLang}`);

    // Remove old language caches (not just invalidate)
    const queries = queryClient.getQueryCache().getAll();
    
    queries.forEach((query) => {
      const key = JSON.stringify(query.queryKey);
      
      // Check if this query is language-specific
      if (key.includes(`"${oldLang}"`) || key.includes('translation')) {
        queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
      }
    });
  }

  // Rule 5: Realtime events trigger debounced background sync
  handleRealtimeEvent(table: string, record: any): void {
    const queryKeys = this.getAffectedQueryKeys(table, record);
    
    queryKeys.forEach((key) => {
      // Mark stale without immediate refetch
      cacheSynchronizer.markStale(key);
    });

    // Debounced background refetch
    setTimeout(() => {
      queryKeys.forEach((key) => {
        cacheSynchronizer.queueRefetch(key, { inactiveOnly: true });
      });
    }, 2000);
  }

  private getAffectedQueryKeys(table: string, record: any): string[][] {
    const keys: string[][] = [];

    switch (table) {
      case 'quizzes':
        keys.push(['quiz', record.id]);
        keys.push(['quizzes', 'list']);
        break;
      case 'questions':
        keys.push(['quiz', record.quiz_id, 'questions']);
        break;
      case 'translations':
        keys.push(['translation', record.quiz_id || record.question_id]);
        keys.push(['quiz', record.quiz_id]);
        break;
      case 'attempts':
        keys.push(['attempt', record.quiz_id]);
        break;
    }

    return keys;
  }

  // Rule 6: Conflict resolution - server wins on timestamp
  resolveConflict<T extends { updated_at?: string }>(
    serverData: T,
    localData: T
  ): T {
    const serverTime = serverData.updated_at 
      ? new Date(serverData.updated_at).getTime() 
      : 0;
    const localTime = localData.updated_at 
      ? new Date(localData.updated_at).getTime() 
      : 0;

    return serverTime >= localTime ? serverData : localData;
  }
}

export const consistencyRules = new ConsistencyRules();

export function useConsistencyRules() {
  return {
    enforceServerAuthority: <T>(id: string, data: T, strategy?: 'replace' | 'merge') =>
      consistencyRules.enforceServerAuthority(id, data, strategy),
    markAffectedStale: (type: string, id?: string, opts?: any) =>
      consistencyRules.markAffectedStale(type, id, opts),
    handleVisibilityChange: (visible: boolean) =>
      consistencyRules.handleVisibilityChange(visible),
    handleLanguageChange: (newLang: string, oldLang: string) =>
      consistencyRules.handleLanguageChange(newLang, oldLang),
    handleRealtimeEvent: (table: string, record: any) =>
      consistencyRules.handleRealtimeEvent(table, record),
    resolveConflict: <T extends { updated_at?: string }>(server: T, local: T) =>
      consistencyRules.resolveConflict(server, local),
  };
}
