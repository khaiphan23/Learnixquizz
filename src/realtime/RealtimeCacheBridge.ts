/**
 * Realtime Cache Bridge
 * Connects Supabase realtime events to React Query cache
 */

import { queryClient } from '../lib/queryClient';
import { sequenceManager } from './SequenceManager';
import { cacheSynchronizer } from '../cache/CacheSynchronizer';

interface RealtimePayload {
  schema: string;
  table: string;
  commit_timestamp: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: any;
  old: any;
  errors: any;
}

interface EventBufferItem {
  payload: RealtimePayload;
  receivedAt: number;
}

class RealtimeCacheBridge {
  private eventBuffer: EventBufferItem[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 500;
  private readonly BATCH_SIZE = 10;

  // Receive event from realtime subscription
  handleEvent(payload: RealtimePayload): void {
    const eventId = `${payload.commit_timestamp}-${payload.table}-${payload.new?.id || payload.old?.id}`;

    // Deduplication
    if (sequenceManager.isProcessed(eventId)) {
      return;
    }

    sequenceManager.markProcessed({
      id: eventId,
      commitTimestamp: payload.commit_timestamp,
      table: payload.table,
      record: payload.new,
      eventType: payload.eventType,
    });

    // Buffer event
    this.eventBuffer.push({
      payload,
      receivedAt: Date.now(),
    });

    // Schedule flush
    this.scheduleFlush();

    // Immediate flush if buffer full
    if (this.eventBuffer.length >= this.BATCH_SIZE) {
      this.flush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(() => {
      this.flush();
    }, this.DEBOUNCE_MS);
  }

  private flush(): void {
    if (this.eventBuffer.length === 0) return;

    // Sort by timestamp
    const sorted = [...this.eventBuffer].sort(
      (a, b) =>
        new Date(a.payload.commit_timestamp).getTime() -
        new Date(b.payload.commit_timestamp).getTime()
    );

    // Group by table for batch processing
    const byTable = this.groupByTable(sorted);

    // Process each table's events
    byTable.forEach((events, table) => {
      this.processTableEvents(table, events);
    });

    // Clear buffer
    this.eventBuffer = [];
  }

  private groupByTable(events: EventBufferItem[]): Map<string, EventBufferItem[]> {
    const map = new Map<string, EventBufferItem[]>();
    
    events.forEach((event) => {
      const list = map.get(event.payload.table) || [];
      list.push(event);
      map.set(event.payload.table, list);
    });

    return map;
  }

  private processTableEvents(table: string, events: EventBufferItem[]): void {
    // Deduplicate by record ID (keep latest)
    const latestById = new Map<string, EventBufferItem>();
    
    events.forEach((event) => {
      const id = event.payload.new?.id || event.payload.old?.id;
      if (id) {
        const existing = latestById.get(id);
        if (!existing || 
            new Date(event.payload.commit_timestamp) > 
            new Date(existing.payload.commit_timestamp)) {
          latestById.set(id, event);
        }
      }
    });

    // Apply to cache
    latestById.forEach((event) => {
      this.applyToCache(event.payload);
    });
  }

  private applyToCache(payload: RealtimePayload): void {
    const queryKey = this.getQueryKey(payload);
    
    switch (payload.eventType) {
      case 'INSERT':
        // Add to list queries
        this.handleInsert(queryKey, payload.new);
        break;
      case 'UPDATE':
        // Patch specific entity
        this.handleUpdate(queryKey, payload.new);
        break;
      case 'DELETE':
        // Remove from cache
        this.handleDelete(queryKey, payload.old?.id);
        break;
    }
  }

  private getQueryKey(payload: RealtimePayload): string[] {
    // Map table to query key pattern
    const tableMap: Record<string, string[]> = {
      quizzes: ['quiz'],
      questions: ['quiz', 'questions'],
      translations: ['translation'],
      attempts: ['attempt'],
    };

    return tableMap[payload.table] || [payload.table];
  }

  private handleInsert(baseKey: string[], record: any): void {
    // Find list queries and add item
    const listQueries = queryClient
      .getQueryCache()
      .findAll({ queryKey: baseKey });

    listQueries.forEach((query) => {
      queryClient.setQueryData(query.queryKey, (old: any[]) => {
        if (!old) return old;
        // Check if already exists
        if (old.some((item) => item.id === record.id)) return old;
        return [record, ...old];
      });
    });
  }

  private handleUpdate(baseKey: string[], record: any): void {
    // Patch specific entity query
    const specificKey = [...baseKey, record.id];

    cacheSynchronizer.patch(specificKey, (old: any) => {
      if (!old) return record;
      
      // Validate order before applying
      if (!sequenceManager.validateOrder(
        { commit_timestamp: record.updated_at, table: '', record, eventType: 'UPDATE', id: '' },
        old
      )) {
        return old;
      }

      return { ...old, ...record, _lastModifiedAt: record.updated_at };
    });
  }

  private handleDelete(baseKey: string[], id: string): void {
    // Remove from all list queries
    const queries = queryClient.getQueryCache().findAll({ queryKey: baseKey });

    queries.forEach((query) => {
      queryClient.setQueryData(query.queryKey, (old: any[]) => {
        if (!old) return old;
        return old.filter((item) => item.id !== id);
      });
    });

    // Remove specific entity query
    const specificKey = [...baseKey, id];
    queryClient.removeQueries({ queryKey: specificKey, exact: true });
  }
}

export const realtimeCacheBridge = new RealtimeCacheBridge();

export function useRealtimeCacheBridge() {
  return {
    handleEvent: (payload: RealtimePayload) => realtimeCacheBridge.handleEvent(payload),
  };
}
