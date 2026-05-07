/**
 * Sequence Manager
 * Ensures realtime events are processed in order and deduplicated
 */

interface RealtimeEvent {
  id: string;
  commitTimestamp: string;
  table: string;
  record: any;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
}

class SequenceManager {
  private processedEvents: Set<string> = new Set();
  private eventLog: Array<{ id: string; timestamp: number }> = [];
  private readonly MAX_LOG_SIZE = 1000;
  private readonly CLOCK_DRIFT_TOLERANCE_MS = 5000;

  // Check if event already processed
  isProcessed(eventId: string): boolean {
    return this.processedEvents.has(eventId);
  }

  // Mark event as processed
  markProcessed(event: RealtimeEvent): void {
    const id = this.generateEventId(event);
    
    this.processedEvents.add(id);
    this.eventLog.push({ id, timestamp: Date.now() });

    // Cleanup if log too large
    if (this.eventLog.length > this.MAX_LOG_SIZE) {
      const toRemove = this.eventLog.splice(0, this.MAX_LOG_SIZE / 2);
      toRemove.forEach((e) => this.processedEvents.delete(e.id));
    }
  }

  // Validate event order (reject stale events)
  validateOrder(event: RealtimeEvent, currentData: any): boolean {
    if (!currentData?._lastModifiedAt && !currentData?.updated_at) {
      return true; // No previous data, accept
    }

    const eventTime = new Date(event.commitTimestamp).getTime();
    const currentTime = new Date(
      currentData._lastModifiedAt || currentData.updated_at
    ).getTime();

    // Allow tolerance for clock drift
    if (eventTime < currentTime - this.CLOCK_DRIFT_TOLERANCE_MS) {
      console.warn('[SequenceManager] Stale event rejected', {
        eventId: this.generateEventId(event),
        eventTime: new Date(eventTime).toISOString(),
        currentTime: new Date(currentTime).toISOString(),
      });
      return false;
    }

    return true;
  }

  // Generate unique event ID
  private generateEventId(event: RealtimeEvent): string {
    return `${event.commitTimestamp}-${event.table}-${event.record?.id || 'unknown'}`;
  }

  // Get sequence stats
  getStats(): {
    processedCount: number;
    logSize: number;
  } {
    return {
      processedCount: this.processedEvents.size,
      logSize: this.eventLog.length,
    };
  }

  // Reset (emergency use)
  reset(): void {
    this.processedEvents.clear();
    this.eventLog = [];
  }
}

export const sequenceManager = new SequenceManager();

export function useSequenceManager() {
  return {
    isProcessed: (eventId: string) => sequenceManager.isProcessed(eventId),
    markProcessed: (event: RealtimeEvent) => sequenceManager.markProcessed(event),
    validateOrder: (event: RealtimeEvent, currentData: any) =>
      sequenceManager.validateOrder(event, currentData),
    getStats: () => sequenceManager.getStats(),
  };
}
