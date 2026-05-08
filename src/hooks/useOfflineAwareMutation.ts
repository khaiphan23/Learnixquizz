/**
 * Offline-Aware Mutation Hook
 * Handles mutation queuing and replay when offline
 */

import { useCallback, useEffect, useState } from 'react';
import { offlineManager } from '../offline/OfflineManager';
import { mutationReplay } from '../mutations/core/MutationReplay';
import { draftRecovery } from '../offline/DraftRecovery';
import { connectivityMonitor } from '../offline/ConnectivityMonitor';
import type { OfflineState } from '../offline/OfflineManager';
import type { ConnectionQuality } from '../offline/ConnectivityMonitor';

export interface UseOfflineAwareMutationOptions {
  onOnline?: () => void;
  onOffline?: () => void;
  onReplayComplete?: (result: { attempted: number; succeeded: number; failed: number }) => void;
}

export function useOfflineAwareMutation(options: UseOfflineAwareMutationOptions = {}) {
  const [isOnline, setIsOnline] = useState(offlineManager.isOnline());
  const [isSlowConnection, setIsSlowConnection] = useState(connectivityMonitor.isSlowConnection());
  const [pendingCount, setPendingCount] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);

  useEffect(() => {
    // Subscribe to offline state changes
    const unsubscribeOffline = offlineManager.subscribe((state: OfflineState) => {
      setIsOnline(state.isOnline);
      setPendingCount(state.pendingMutations);
      
      if (state.isOnline) {
        options.onOnline?.();
      } else {
        options.onOffline?.();
      }
    });

    // Subscribe to connectivity quality
    const unsubscribeConnectivity = connectivityMonitor.subscribe((quality: ConnectionQuality) => {
      setIsSlowConnection(
        quality.type === 'slow' || 
        quality.effectiveType === '2g' || 
        quality.effectiveType === 'slow-2g'
      );
    });

    // Listen for online/offline events
    const handleOnline = () => {
      console.log('[useOfflineAwareMutation] Browser reports online');
      // Trigger replay when coming back online
      handleReplay();
    };

    window.addEventListener('online', handleOnline);

    return () => {
      unsubscribeOffline();
      unsubscribeConnectivity();
      window.removeEventListener('online', handleOnline);
    };
  }, [options]);

  const handleReplay = useCallback(async () => {
    const status = mutationReplay.getStatus();
    if (status.pendingCount === 0 || status.isReplaying) return;

    setIsReplaying(true);
    console.log('[useOfflineAwareMutation] Starting mutation replay...');

    try {
      const result = await mutationReplay.replay();
      options.onReplayComplete?.(result);
      console.log('[useOfflineAwareMutation] Replay complete:', result);
    } catch (error) {
      console.error('[useOfflineAwareMutation] Replay failed:', error);
    } finally {
      setIsReplaying(false);
    }
  }, [options]);

  const saveDraft = useCallback(<T extends { id: string }>(entityType: 'quiz' | 'question', data: T, version?: number) => {
    draftRecovery.save({
      entityId: data.id,
      entityType,
      data,
      serverVersionAtSave: version,
    });
  }, []);

  const recoverDraft = useCallback(<T>(entityId: string): T | null => {
    const draft = draftRecovery.recover<T>(entityId);
    return draft?.data || null;
  }, []);

  const checkForStaleServerVersion = useCallback(async (entityId: string, entityType: string, savedVersion?: number): Promise<boolean> => {
    return draftRecovery.hasServerNewerVersion(entityId, entityType, savedVersion);
  }, []);

  const deleteDraft = useCallback((entityId: string) => {
    draftRecovery.deleteDraft(entityId);
  }, []);

  return {
    isOnline,
    isOffline: !isOnline,
    isSlowConnection,
    pendingCount,
    isReplaying,
    replay: handleReplay,
    saveDraft,
    recoverDraft,
    checkForStaleServerVersion,
    deleteDraft,
  };
}
