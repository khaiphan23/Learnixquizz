/**
 * Mutations Module
 * Distributed mutation and consistency system
 */

export { createMutationContext, regenerateForRetry, isDuplicate } from './core/MutationID';
export type { MutationContext } from './core/MutationID';

export { mutationLog, useMutationLog } from './core/MutationLog';
export type { MutationEntry, MutationStatus } from './core/MutationLog';

export { mutationExecutor, useMutationExecutor } from './core/MutationExecutor';
export type { ExecuteOptions, ExecuteResult } from './core/MutationExecutor';

export { optimisticEngine, useOptimisticEngine } from './core/OptimisticEngine';
export type { OptimisticUpdate } from './core/OptimisticEngine';

export { mutationQueue, useMutationQueue } from './core/MutationQueue';
export type { QueueStatus } from './core/MutationQueue';

export { mutationReplay, useMutationReplay } from './core/MutationReplay';
export type { ReplayResult } from './core/MutationReplay';
