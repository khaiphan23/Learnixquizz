/**
 * Offline Module
 * Offline detection, recovery, and draft persistence
 */

export { offlineManager, useOfflineManager } from './OfflineManager';
export type { OfflineState } from './OfflineManager';

export { draftRecovery, useDraftRecovery } from './DraftRecovery';
export type { Draft, DraftMetadata } from './DraftRecovery';

export { connectivityMonitor, useConnectivityMonitor } from './ConnectivityMonitor';
export type { ConnectionQuality } from './ConnectivityMonitor';
