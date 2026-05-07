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
  private tabId: string;
  private isLeader = false;
  private leaderId: string | null = null;
  private listeners: Map<string, Set<(payload: any) => void>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.tabId = this.generateTabId();
    
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('learnix_tabs');
      this.setupChannel();
      this.electLeader();
      this.startHeartbeat();
    }
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
      if (tabId === this.tabId) return;

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
      tabId: this.tabId,
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
    const myTimestamp = parseInt(this.tabId.split('-')[0]);
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
      tabId: this.tabId,
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
          tabId: this.tabId,
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
    if (this.isLeader || !this.channel) {
      // Execute locally
      return;
    }

    // Delegate to leader
    this.broadcast({
      type: 'MUTATION_REQUEST',
      payload: { context, operation, data },
      tabId: this.tabId,
      timestamp: Date.now(),
    });
  }

  broadcastCacheInvalidation(keys: string[][]): void {
    this.broadcast({
      type: 'CACHE_INVALIDATE',
      payload: { keys },
      tabId: this.tabId,
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
      tabId: this.tabId,
    };
  }

  destroy(): void {
    this.heartbeatInterval && clearInterval(this.heartbeatInterval);
    this.channel?.close();
  }
}

export const tabCoordinator = new TabCoordinator();

export function useTabCoordinator() {
  return {
    shouldExecuteLocally: () => tabCoordinator.shouldExecuteLocally(),
    submitMutation: (ctx: MutationContext, op: string, data: any) =>
      tabCoordinator.submitMutation(ctx, op, data),
    broadcastCacheInvalidation: (keys: string[][]) =>
      tabCoordinator.broadcastCacheInvalidation(keys),
    subscribe: (event: string, cb: (payload: any) => void) =>
      tabCoordinator.subscribe(event, cb),
    getStatus: () => tabCoordinator.getStatus(),
  };
}
