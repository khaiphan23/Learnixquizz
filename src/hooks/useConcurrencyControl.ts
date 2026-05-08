/**
 * Concurrency Control Hook
 * Version control and tab coordination for mutations
 */

import { useCallback, useEffect, useState } from 'react';
import { versionControl } from '../concurrency/VersionControl';
import { tabCoordinator } from '../concurrency/TabCoordinator';

export interface VersionedMutationOptions {
  entityId: string;
  expectedVersion: number;
  operation: () => Promise<any>;
  onConflict?: (serverVersion: number) => void;
}

export function useConcurrencyControl() {
  const [isLeader, setIsLeader] = useState(false);
  const [tabId, setTabId] = useState<string>('');

  useEffect(() => {
    const status = tabCoordinator.getStatus();
    setIsLeader(status.isLeader);
    setTabId(status.tabId);

    const unsubscribe = tabCoordinator.subscribe('mutation-complete', () => {
      const newStatus = tabCoordinator.getStatus();
      setIsLeader(newStatus.isLeader);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  /**
   * Check if mutation can proceed with version control
   */
  const canMutate = useCallback((entityId: string, expectedVersion: number): boolean => {
    return versionControl.canMutate(entityId, expectedVersion);
  }, []);

  /**
   * Reserve version for mutation
   */
  const reserveVersion = useCallback((entityId: string, expectedVersion: number, mutationId: string): boolean => {
    return versionControl.reserveVersion(entityId, expectedVersion, mutationId);
  }, []);

  /**
   * Release version after mutation
   */
  const releaseVersion = useCallback((entityId: string) => {
    versionControl.releaseVersion(entityId);
  }, []);

  /**
   * Update known server version
   */
  const updateServerVersion = useCallback((entityId: string, version: number) => {
    versionControl.updateServerVersion(entityId, version);
  }, []);

  /**
   * Execute versioned mutation with conflict handling
   */
  const executeVersionedMutation = useCallback(async <T>(
    options: VersionedMutationOptions
  ): Promise<{ success: boolean; data?: T; conflict?: boolean; serverVersion?: number; error?: Error }> => {
    const { entityId, expectedVersion, operation, onConflict } = options;

    // Check version
    if (!canMutate(entityId, expectedVersion)) {
      const pending = versionControl.getPendingForEntity(entityId);
      console.warn('[useConcurrencyControl] Version conflict detected:', {
        entityId,
        expectedVersion,
        pendingVersion: pending?.expectedVersion,
      });

      const serverVersion = versionControl.getExpectedVersion(entityId);
      onConflict?.(serverVersion);

      return {
        success: false,
        conflict: true,
        serverVersion,
        error: new Error('VERSION_CONFLICT'),
      };
    }

    // Reserve version
    const mutationId = `mutation-${Date.now()}`;
    if (!reserveVersion(entityId, expectedVersion, mutationId)) {
      return {
        success: false,
        conflict: true,
        error: new Error('VERSION_RESERVATION_FAILED'),
      };
    }

    try {
      // Execute mutation
      const result = await operation();

      // Release and update version
      releaseVersion(entityId);
      updateServerVersion(entityId, expectedVersion + 1);

      return { success: true, data: result };
    } catch (error) {
      releaseVersion(entityId);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }, [canMutate, reserveVersion, releaseVersion, updateServerVersion]);

  /**
   * Check if this tab should execute mutations locally
   */
  const shouldExecuteLocally = useCallback((): boolean => {
    return tabCoordinator.shouldExecuteLocally();
  }, []);

  /**
   * Broadcast cache invalidation to other tabs
   */
  const broadcastCacheInvalidation = useCallback((keys: string[][]) => {
    tabCoordinator.broadcastCacheInvalidation(keys);
  }, []);

  return {
    isLeader,
    tabId,
    canMutate,
    reserveVersion,
    releaseVersion,
    updateServerVersion,
    executeVersionedMutation,
    shouldExecuteLocally,
    broadcastCacheInvalidation,
  };
}
