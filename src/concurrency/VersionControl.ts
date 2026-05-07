/**
 * Version Control System
 * Lightweight optimistic locking for conflict detection
 */

interface VersionedEntity {
  id: string;
  version: number;
  lastModifiedAt: string;
  lastModifiedBy?: string;
}

interface PendingVersion {
  entityId: string;
  expectedVersion: number;
  mutationId: string;
  timestamp: number;
}

class VersionControl {
  private pendingVersions = new Map<string, PendingVersion>();
  private entityVersions = new Map<string, number>();

  // Check if mutation can proceed
  canMutate(entityId: string, expectedVersion: number): boolean {
    const pending = this.pendingVersions.get(entityId);
    
    // If we have a newer pending version, this mutation is stale
    if (pending && pending.expectedVersion > expectedVersion) {
      return false;
    }

    // Check against known server version
    const knownVersion = this.entityVersions.get(entityId);
    if (knownVersion && knownVersion > expectedVersion) {
      return false;
    }

    return true;
  }

  // Reserve version for mutation
  reserveVersion(
    entityId: string,
    expectedVersion: number,
    mutationId: string
  ): boolean {
    if (!this.canMutate(entityId, expectedVersion)) {
      return false;
    }

    this.pendingVersions.set(entityId, {
      entityId,
      expectedVersion,
      mutationId,
      timestamp: Date.now(),
    });

    return true;
  }

  // Release version after mutation completes
  releaseVersion(entityId: string): void {
    const pending = this.pendingVersions.get(entityId);
    if (pending) {
      // Update known version to expected + 1
      this.entityVersions.set(entityId, pending.expectedVersion + 1);
    }
    
    this.pendingVersions.delete(entityId);
  }

  // Update known server version
  updateServerVersion(entityId: string, version: number): void {
    const current = this.entityVersions.get(entityId) || 0;
    if (version > current) {
      this.entityVersions.set(entityId, version);
    }
  }

  // Get current expected version
  getExpectedVersion(entityId: string): number {
    return this.entityVersions.get(entityId) || 1;
  }

  // Merge conflicts
  mergeConflicts<T extends VersionedEntity>(
    serverState: T,
    optimisticState: T,
    originalState: T,
    strategy: 'last-write-wins' | 'merge-fields' = 'last-write-wins'
  ): T {
    if (strategy === 'last-write-wins') {
      // Compare timestamps
      const serverTime = new Date(serverState.lastModifiedAt).getTime();
      const optimisticTime = new Date(optimisticState.lastModifiedAt).getTime();

      return optimisticTime > serverTime ? optimisticState : serverState;
    }

    // Merge fields: optimistic wins on fields it changed, server wins on others
    const changedFields = this.getChangedFields(originalState, optimisticState);
    
    return {
      ...serverState,
      ...changedFields,
      version: Math.max(serverState.version, optimisticState.version) + 1,
    };
  }

  private getChangedFields<T>(original: T, modified: T): Partial<T> {
    const changes: Partial<T> = {};
    
    for (const key in modified) {
      if (JSON.stringify(original[key]) !== JSON.stringify(modified[key])) {
        changes[key] = modified[key];
      }
    }

    return changes;
  }

  // Cleanup old pending versions
  cleanup(maxAgeMs: number = 60000): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;

    this.pendingVersions.forEach((pending, entityId) => {
      if (pending.timestamp < cutoff) {
        this.pendingVersions.delete(entityId);
        count++;
      }
    });

    return count;
  }

  // Get pending mutations for entity
  getPendingForEntity(entityId: string): PendingVersion | undefined {
    return this.pendingVersions.get(entityId);
  }
}

export const versionControl = new VersionControl();

export function useVersionControl() {
  return {
    canMutate: (entityId: string, expectedVersion: number) =>
      versionControl.canMutate(entityId, expectedVersion),
    reserveVersion: (entityId: string, expectedVersion: number, mutationId: string) =>
      versionControl.reserveVersion(entityId, expectedVersion, mutationId),
    releaseVersion: (entityId: string) => versionControl.releaseVersion(entityId),
    updateServerVersion: (entityId: string, version: number) =>
      versionControl.updateServerVersion(entityId, version),
    mergeConflicts: <T extends VersionedEntity>(
      server: T,
      optimistic: T,
      original: T,
      strategy?: 'last-write-wins' | 'merge-fields'
    ) => versionControl.mergeConflicts(server, optimistic, original, strategy),
  };
}
