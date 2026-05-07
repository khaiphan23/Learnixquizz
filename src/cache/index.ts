/**
 * Cache Module
 * Cache synchronization and invalidation management
 */

export { cacheSynchronizer, useCacheSynchronizer } from './CacheSynchronizer';
export type { CachePatch } from './CacheSynchronizer';

export { invalidationManager, useQueryInvalidationManager } from './QueryInvalidationManager';
export type { InvalidationRule } from './QueryInvalidationManager';
