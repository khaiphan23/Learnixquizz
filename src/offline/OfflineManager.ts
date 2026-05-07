/**
 * Offline Manager
 * Handles offline detection, mutation queuing, and reconnect recovery
 */

import { mutationLog } from '../mutations/core/MutationLog';
import { mutationReplay } from '../mutations/core/MutationReplay';
import { tabCoordinator } from '../concurrency/TabCoordinator';

interface OfflineState {
  isOnline: boolean;
  lastOnlineAt: number | null;
  lastOfflineAt: number | null;
  pendingMutations: number;
}

class OfflineManager {
  private state: OfflineState = {
    isOnline: navigator.onLine,
    lastOnlineAt: navigator.onLine ? Date.now() : null,
    lastOfflineAt: navigator.onLine ? null : Date.now(),
    pendingMutations: 0,
  };

  private listeners: Set<(state: OfflineState) => void> = new Set();
  private reconnectHandlers: Set<() => Promise<void>> = new Set();

  constructor() {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());

    // Periodic sync check
    setInterval(() => this.checkConnection(), 30000);
  }

  private handleOnline(): void {
    console.log('[OfflineManager] Back online');
    
    this.state.isOnline = true;
    this.state.lastOnlineAt = Date.now();
    this.notifyListeners();

    // Only leader tab performs recovery
    if (tabCoordinator.shouldExecuteLocally()) {
      this.performReconnectRecovery();
    }
  }

  private handleOffline(): void {
    console.log('[OfflineManager] Gone offline');
    
    this.state.isOnline = false;
    this.state.lastOfflineAt = Date.now();
    this.notifyListeners();
  }

  private async performReconnectRecovery(): Promise<void> {
    console.log('[OfflineManager] Starting reconnect recovery');

    // Execute all registered handlers
    for (const handler of this.reconnectHandlers) {
      try {
        await handler();
      } catch (error) {
        console.error('[OfflineManager] Reconnect handler failed:', error);
      }
    }

    // Replay pending mutations
    const result = await mutationReplay.replay();
    
    if (result.attempted > 0) {
      console.log('[OfflineManager] Replay complete:', result);
    }

    // Reconcile stale data
    await this.reconcileStaleData();
  }

  private async reconcileStaleData(): Promise<void> {
    // This would integrate with React Query to refetch stale data
    console.log('[OfflineManager] Reconciling stale data');
  }

  private async checkConnection(): Promise<void> {
    // Ping check
    try {
      const response = await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-store',
      });
      
      if (!this.state.isOnline && response.ok) {
        this.handleOnline();
      } else if (this.state.isOnline && !response.ok) {
        this.handleOffline();
      }
    } catch {
      if (this.state.isOnline) {
        this.handleOffline();
      }
    }
  }

  private notifyListeners(): void {
    this.state.pendingMutations = mutationLog.getPending().length;
    this.listeners.forEach((l) => l({ ...this.state }));
  }

  // Public API

  isOnline(): boolean {
    return this.state.isOnline;
  }

  isOffline(): boolean {
    return !this.state.isOnline;
  }

  getState(): OfflineState {
    return { ...this.state };
  }

  subscribe(listener: (state: OfflineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onReconnect(handler: () => Promise<void>): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  // Queue mutation for offline execution
  async queueWhenOffline<T>(
    operation: () => Promise<T>,
    fallback: () => void
  ): Promise<T | void> {
    if (this.state.isOnline) {
      return operation();
    }

    // Offline: execute fallback (usually optimistic update)
    fallback();
    
    // Mutation is already logged, will be replayed when online
    console.log('[OfflineManager] Mutation queued for replay');
  }
}

export const offlineManager = new OfflineManager();

export function useOfflineManager() {
  return {
    isOnline: () => offlineManager.isOnline(),
    isOffline: () => offlineManager.isOffline(),
    getState: () => offlineManager.getState(),
    subscribe: (cb: (state: OfflineState) => void) => offlineManager.subscribe(cb),
    onReconnect: (handler: () => Promise<void>) => offlineManager.onReconnect(handler),
    queueWhenOffline: <T>(op: () => Promise<T>, fallback: () => void) =>
      offlineManager.queueWhenOffline(op, fallback),
  };
}
