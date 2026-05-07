/**
 * Mutation ID Generation System
 * Generates unique IDs and idempotency keys for all mutations
 */

export interface MutationContext {
  mutationId: string;
  idempotencyKey: string;
  timestamp: number;
  sequenceNumber: number;
  tabId: string;
  retryCount: number;
  userId: string;
  entityId: string;
  operation: string;
}

// Generate UUID v4
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Get or create unique tab ID
function getTabId(): string {
  if (typeof window === 'undefined') return 'server';
  
  let tabId = sessionStorage.getItem('learnix-tab-id');
  if (!tabId) {
    tabId = generateUUID();
    sessionStorage.setItem('learnix-tab-id', tabId);
  }
  return tabId;
}

// Per-tab sequence counter
let sequenceCounter = 0;
function getNextSequenceNumber(): number {
  return ++sequenceCounter;
}

// Generate idempotency key (5-minute window)
function generateIdempotencyKey(
  userId: string,
  entityId: string,
  operation: string
): string {
  const timeWindow = Math.floor(Date.now() / 300000); // 5-minute buckets
  return `${userId}:${entityId}:${operation}:${timeWindow}`;
}

// Create full mutation context
export function createMutationContext(
  userId: string,
  entityId: string,
  operation: string
): MutationContext {
  return {
    mutationId: generateUUID(),
    idempotencyKey: generateIdempotencyKey(userId, entityId, operation),
    timestamp: Date.now(),
    sequenceNumber: getNextSequenceNumber(),
    tabId: getTabId(),
    retryCount: 0,
    userId,
    entityId,
    operation,
  };
}

// Regenerate for retry (preserves idempotency key)
export function regenerateForRetry(
  context: MutationContext
): MutationContext {
  return {
    ...context,
    mutationId: generateUUID(), // New mutation ID
    timestamp: Date.now(),
    sequenceNumber: getNextSequenceNumber(),
    retryCount: context.retryCount + 1,
    // idempotencyKey stays the same for deduplication
  };
}

// Check if two contexts represent duplicate mutations
export function isDuplicate(
  ctx1: MutationContext,
  ctx2: MutationContext
): boolean {
  return ctx1.idempotencyKey === ctx2.idempotencyKey &&
         ctx1.userId === ctx2.userId &&
         ctx1.operation === ctx2.operation;
}
