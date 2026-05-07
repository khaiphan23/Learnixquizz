/**
 * Query Invalidation Manager
 * Smart invalidation that prevents storms and deduplicates refetches
 */

import { queryClient } from '../lib/queryClient';

interface InvalidationRule {
  mutation: string;
  affectedQueries: string[][];
  strategy: 'immediate' | 'delayed' | 'background';
  delayMs?: number;
}

class QueryInvalidationManager {
  private rules: Map<string, InvalidationRule> = new Map();
  private pendingInvalidations: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.registerDefaultRules();
  }

  private registerDefaultRules(): void {
    // Quiz mutations
    this.register({
      mutation: 'create_quiz',
      affectedQueries: [['quizzes', 'list']],
      strategy: 'delayed',
      delayMs: 2000,
    });

    this.register({
      mutation: 'update_quiz',
      affectedQueries: [['quiz'], ['quizzes', 'list']],
      strategy: 'immediate',
    });

    this.register({
      mutation: 'delete_quiz',
      affectedQueries: [['quiz'], ['quizzes', 'list']],
      strategy: 'immediate',
    });

    // Translation mutations
    this.register({
      mutation: 'create_translation',
      affectedQueries: [['quiz'], ['translations']],
      strategy: 'delayed',
      delayMs: 1000,
    });

    // Question mutations
    this.register({
      mutation: 'reorder_questions',
      affectedQueries: [['quiz', 'questions']],
      strategy: 'immediate',
    });
  }

  register(rule: InvalidationRule): void {
    this.rules.set(rule.mutation, rule);
  }

  // Invalidate based on mutation type
  invalidate(mutationType: string, params?: { entityId?: string }): void {
    const rule = this.rules.get(mutationType);
    if (!rule) {
      console.warn(`[QueryInvalidation] No rule for ${mutationType}`);
      return;
    }

    const key = `${mutationType}-${params?.entityId || 'global'}`;

    // Clear existing timeout for this invalidation
    if (this.pendingInvalidations.has(key)) {
      clearTimeout(this.pendingInvalidations.get(key)!);
    }

    const execute = () => {
      this.executeInvalidation(rule, params);
      this.pendingInvalidations.delete(key);
    };

    switch (rule.strategy) {
      case 'immediate':
        execute();
        break;
      case 'delayed':
        const timeout = setTimeout(execute, rule.delayMs || 1000);
        this.pendingInvalidations.set(key, timeout);
        break;
      case 'background':
        // Only invalidate inactive queries
        this.executeBackgroundInvalidation(rule, params);
        break;
    }
  }

  private executeInvalidation(
    rule: InvalidationRule,
    params?: { entityId?: string }
  ): void {
    rule.affectedQueries.forEach((queryKey) => {
      const fullKey = params?.entityId 
        ? [...queryKey, params.entityId]
        : queryKey;

      queryClient.invalidateQueries({
        queryKey: fullKey,
        exact: false,
        refetchType: 'all',
      });
    });
  }

  private executeBackgroundInvalidation(
    rule: InvalidationRule,
    params?: { entityId?: string }
  ): void {
    rule.affectedQueries.forEach((queryKey) => {
      const fullKey = params?.entityId
        ? [...queryKey, params.entityId]
        : queryKey;

      const queries = queryClient.getQueryCache().findAll({ queryKey: fullKey });
      
      queries.forEach((query) => {
        if (query.getObserversCount() === 0) {
          // Inactive query - refetch
          queryClient.refetchQueries({ queryKey: fullKey, exact: true });
        } else {
          // Active query - just mark stale
          query.invalidate();
        }
      });
    });
  }

  // Emergency: Invalidate all
  invalidateAll(): void {
    queryClient.invalidateQueries();
  }

  // Clear all pending invalidations
  clearPending(): void {
    this.pendingInvalidations.forEach((timeout) => clearTimeout(timeout));
    this.pendingInvalidations.clear();
  }
}

export const invalidationManager = new QueryInvalidationManager();

export function useQueryInvalidationManager() {
  return {
    invalidate: (type: string, params?: { entityId?: string }) =>
      invalidationManager.invalidate(type, params),
    invalidateAll: () => invalidationManager.invalidateAll(),
    register: (rule: InvalidationRule) => invalidationManager.register(rule),
  };
}
