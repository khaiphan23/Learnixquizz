/**
 * Resilient Subscription
 * Manages Supabase realtime subscriptions with automatic reconnect and recovery
 */

import { supabase } from '../services/supabase';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

interface SubscriptionConfig {
  name: string;
  table: string;
  filter?: string;
  onEvent: (payload: RealtimePostgresChangesPayload<any>) => void;
  onError?: (error: Error) => void;
}

interface SubscriptionState {
  channel: RealtimeChannel | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastEventAt: number | null;
  reconnectAttempts: number;
}

class ResilientSubscription {
  private subscriptions = new Map<string, SubscriptionState>();
  private maxReconnectAttempts = 5;
  private reconnectDelayBase = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startGlobalHeartbeat();
  }

  subscribe(config: SubscriptionConfig): () => void {
    const state: SubscriptionState = {
      channel: null,
      status: 'connecting',
      lastEventAt: null,
      reconnectAttempts: 0,
    };

    this.subscriptions.set(config.name, state);
    this.connect(config);

    // Return unsubscribe function
    return () => this.unsubscribe(config.name);
  }

  private connect(config: SubscriptionConfig): void {
    const state = this.subscriptions.get(config.name);
    if (!state) return;

    const channel = supabase
      .channel(`${config.name}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: config.table,
          filter: config.filter,
        },
        (payload) => {
          state.lastEventAt = Date.now();
          state.reconnectAttempts = 0; // Reset on successful event
          config.onEvent(payload);
        }
      )
      .subscribe((status) => {
        switch (status) {
          case 'SUBSCRIBED':
            state.status = 'connected';
            state.reconnectAttempts = 0;
            console.log(`[ResilientSubscription] Connected: ${config.name}`);
            break;
          case 'CLOSED':
          case 'CHANNEL_ERROR':
            state.status = 'error';
            this.handleDisconnect(config);
            break;
        }
      });

    state.channel = channel;
  }

  private handleDisconnect(config: SubscriptionConfig): void {
    const state = this.subscriptions.get(config.name);
    if (!state) return;

    if (state.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[ResilientSubscription] Max reconnects reached: ${config.name}`);
      state.status = 'error';
      config.onError?.(new Error('MAX_RECONNECTS'));
      this.enablePollingFallback(config);
      return;
    }

    state.status = 'disconnected';
    state.reconnectAttempts++;

    const delay = Math.min(
      this.reconnectDelayBase * Math.pow(2, state.reconnectAttempts),
      30000
    );

    console.log(`[ResilientSubscription] Reconnecting ${config.name} in ${delay}ms`);

    setTimeout(() => {
      if (this.subscriptions.has(config.name)) {
        this.cleanupChannel(config.name);
        this.connect(config);
      }
    }, delay);
  }

  private enablePollingFallback(config: SubscriptionConfig): void {
    console.log(`[ResilientSubscription] Enabling polling fallback for ${config.name}`);
    
    // Poll every 10 seconds
    const interval = setInterval(async () => {
      if (!this.subscriptions.has(config.name)) {
        clearInterval(interval);
        return;
      }

      // Fetch recent changes
      const { data } = await supabase
        .from(config.table)
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(10);

      // Emit as events
      data?.forEach((record) => {
        config.onEvent({
          eventType: 'UPDATE',
          new: record,
          old: {},
          schema: 'public',
          table: config.table,
          commit_timestamp: record.updated_at,
          errors: null,
        } as any);
      });
    }, 10000);
  }

  private cleanupChannel(name: string): void {
    const state = this.subscriptions.get(name);
    if (state?.channel) {
      supabase.removeChannel(state.channel);
      state.channel = null;
    }
  }

  unsubscribe(name: string): void {
    this.cleanupChannel(name);
    this.subscriptions.delete(name);
    console.log(`[ResilientSubscription] Unsubscribed: ${name}`);
  }

  private startGlobalHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.subscriptions.forEach((state, name) => {
        // Check if stale (> 30 seconds without event)
        if (state.status === 'connected' && 
            state.lastEventAt && 
            Date.now() - state.lastEventAt > 30000) {
          // Send heartbeat (will be ignored but keeps connection alive)
          state.channel?.send({
            type: 'broadcast',
            event: 'heartbeat',
            payload: {},
          });
        }
      });
    }, 15000);
  }

  getStatus(): Map<string, SubscriptionState> {
    return new Map(this.subscriptions);
  }

  destroy(): void {
    this.heartbeatInterval && clearInterval(this.heartbeatInterval);
    this.subscriptions.forEach((_, name) => this.unsubscribe(name));
  }
}

export const resilientSubscription = new ResilientSubscription();

export function useResilientSubscription() {
  return {
    subscribe: (config: SubscriptionConfig) => resilientSubscription.subscribe(config),
    getStatus: () => resilientSubscription.getStatus(),
  };
}
