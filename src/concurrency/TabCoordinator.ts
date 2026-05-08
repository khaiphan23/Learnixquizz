/**
 * Tab Coordinator
 * Multi-tab coordination using BroadcastChannel
 * Ensures only one tab is "leader" for mutations
 */

import type { MutationContext } from '../mutations/core/MutationID';

interface TabMessage {
  type: 'LEADER_ELECTION' | 'MUTATION_REQUEST' | 'MUTATION_COMPLETE' | 'CACHE_INVALIDATE' | 'HEARTBEAT';
  payload?: any;
  tabId: string;
  timestamp: number;
}

class TabCoordinator {
  private channel: BroadcastChannel | null = null;
  private tabId: string | null = null;
  private isLeader = false;
  private leaderId: string | null = null;
  private listeners: Map<string, Set<(payload: any) => void>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor() {
    // Lazy initialization - don't access browser APIs here
  }

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    this.tabId = this.generateTabId();
    
    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('learnix_tabs');
      this.setupChannel();
      this.electLeader();
      this.startHeartbeat();
    }
  }

  private getTabId(): string {
    if (!this.tabId) {
      this.tabId = this.generateTabId();
    }
    return this.tabId;
  }

  private generateTabId(): string {
    if (typeof window === 'undefined') return 'server';
    
    let id = sessionStorage.getItem('learnix-tab-id');
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('learnix-tab-id', id);
    }
    return id;
  }

  private setupChannel(): void {
    if (!this.channel) return;

    this.channel.onmessage = (event: MessageEvent<TabMessage>) => {
      const { type, payload, tabId, timestamp } = event.data;

      // Ignore own messages
      if (tabId === this.getTabId()) return;

      switch (type) {
        case 'LEADER_ELECTION':
          this.handleLeaderElection(tabId, timestamp);
          break;
        case 'MUTATION_REQUEST':
          if (this.isLeader) {
            this.executeMutationRequest(payload);
          }
          break;
        case 'MUTATION_COMPLETE':
          this.handleMutationComplete(payload);
          break;
        case 'CACHE_INVALIDATE':
          this.handleCacheInvalidation(payload);
          break;
        case 'HEARTBEAT':
          // Leader is alive
          if (this.leaderId === tabId) {
            this.leaderId = tabId;
          }
          break;
      }
    };
  }

  private electLeader(): void {
    this.broadcast({
      type: 'LEADER_ELECTION',
      tabId: this.getTabId(),
      timestamp: Date.now(),
    });

    // Assume leadership if no one challenges within 500ms
    setTimeout(() => {
      if (!this.leaderId) {
        this.becomeLeader();
      }
    }, 500);
  }

  private handleLeaderElection(otherTabId: string, timestamp: number): void {
    // Lower timestamp wins (older tab is leader)
    const myTimestamp = parseInt(this.getTabId().split('-')[0]);
    const otherTimestamp = parseInt(otherTabId.split('-')[0]);

    if (otherTimestamp < myTimestamp) {
      this.leaderId = otherTabId;
      this.isLeader = false;
    }
  }

  private becomeLeader(): void {
    this.isLeader = true;
    this.leaderId = this.tabId;
    console.log('[TabCoordinator] Became leader');
  }

  private executeMutationRequest(payload: {
    context: MutationContext;
    operation: string;
    data: any;
  }): void {
    // Execute mutation on behalf of requesting tab
    // This would integrate with the mutation system
    console.log('[TabCoordinator] Executing mutation for other tab:', payload.operation);

    // After completion, broadcast result
    this.broadcast({
      type: 'MUTATION_COMPLETE',
      payload: {
        mutationId: payload.context.mutationId,
        success: true,
      },
      tabId: this.getTabId(),
      timestamp: Date.now(),
    });
  }

  private handleMutationComplete(payload: { mutationId: string; success: boolean }): void {
    // Notify local listeners
    const listeners = this.listeners.get('mutation-complete');
    listeners?.forEach((cb) => cb(payload));
  }

  private handleCacheInvalidation(payload: { keys: string[][] }): void {
    // Notify local cache to invalidate
    const listeners = this.listeners.get('cache-invalidate');
    listeners?.forEach((cb) => cb(payload));
  }

  private broadcast(message: TabMessage): void {
    this.channel?.postMessage(message);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isLeader) {
        this.broadcast({
          type: 'HEARTBEAT',
          tabId: this.getTabId(),
          timestamp: Date.now(),
        });
      }
    }, 5000);
  }

  // Public API

  shouldExecuteLocally(): boolean {
    // If no BroadcastChannel support, always execute locally
    if (!this.channel) return true;
    
    // If leader, execute locally
    if (this.isLeader) return true;
    
    // Otherwise delegate to leader
    return false;
  }

  submitMutation(context: MutationContext, operation: string, data: any): void {
    this.initialize();
    if (this.isLeader || !this.channel) {
      // Execute locally
      return;
    }

    // Delegate to leader
    this.broadcast({
      type: 'MUTATION_REQUEST',
      payload: { context, operation, data },
      tabId: this.getTabId(),
      timestamp: Date.now(),
    });
  }

  broadcastCacheInvalidation(keys: string[][]): void {
    this.initialize();
    this.broadcast({
      type: 'CACHE_INVALIDATE',
      payload: { keys },
      tabId: this.getTabId(),
      timestamp: Date.now(),
    });
  }

  subscribe(event: string, callback: (payload: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  getStatus(): { isLeader: boolean; leaderId: string | null; tabId: string } {
    return {
      isLeader: this.isLeader,
      leaderId: this.leaderId,
      tabId: this.getTabId(),
    };
  }

  destroy(): void {
    this.heartbeatInterval && clearInterval(this.heartbeatInterval);
    this.channel?.close();
  }
}

// Lazy singleton
let tabCoordinatorInstance: TabCoordinator | null = null;

function getTabCoordinator(): TabCoordinator {
  if (!tabCoordinatorInstance && typeof window !== 'undefined') {
    tabCoordinatorInstance = new TabCoordinator();
    tabCoordinatorInstance.initialize();
  }
  if (!tabCoordinatorInstance) {
    // Dummy for SSR
    return {
      shouldExecuteLocally: () => true,
      submitMutation: () => {},
      broadcastCacheInvalidation: () => {},
      subscribe: () => () => {},
      getStatus: () => ({ isLeader: true, leaderId: null, tabId: 'server' }),
      destroy: () => {},
      initialize: () => {},
    } as TabCoordinator;
  }
  return tabCoordinatorInstance;
}

export const tabCoordinator = new Proxy({} as TabCoordinator, {
  get(target, prop) {
    return (getTabCoordinator() as any)[prop];
  },
});

export function useTabCoordinator() {
  const coordinator = getTabCoordinator();
  return {
    shouldExecuteLocally: () => coordinator.shouldExecuteLocally(),
    submitMutation: (ctx: MutationContext, op: string, data: any) =>
      coordinator.submitMutation(ctx, op, data),
    broadcastCacheInvalidation: (keys: string[][]) =>
      coordinator.broadcastCacheInvalidation(keys),
    subscribe: (event: string, cb: (payload: any) => void) =>
      coordinator.subscribe(event, cb),
    getStatus: () => coordinator.getStatus(),
  };
}
