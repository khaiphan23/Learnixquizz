/**
 * Mutation Diagnostics
 * Tracks mutation performance, failures, and anomalies
 */

import { mutationLog } from '../mutations/core/MutationLog';

interface MutationMetrics {
  totalMutations: number;
  successfulMutations: number;
  failedMutations: number;
  retriedMutations: number;
  rolledBackMutations: number;
  averageLatency: number;
  optimisticCorrections: number;
}

interface AnomalyReport {
  type: 'stuck_mutation' | 'duplicate_detected' | 'cache_inconsistency' | 'high_retry_rate';
  severity: 'warning' | 'error' | 'critical';
  details: any;
  timestamp: number;
}

class MutationDiagnostics {
  private metrics: MutationMetrics = {
    totalMutations: 0,
    successfulMutations: 0,
    failedMutations: 0,
    retriedMutations: 0,
    rolledBackMutations: 0,
    averageLatency: 0,
    optimisticCorrections: 0,
  };

  private anomalies: AnomalyReport[] = [];
  private listeners: Set<(report: AnomalyReport) => void> = new Set();

  // Track mutation execution
  trackMutation(
    mutationId: string,
    operation: string,
    startTime: number,
    result: 'success' | 'failure' | 'retry',
    details?: {
      serverDiff?: boolean;
      retryCount?: number;
      error?: string;
    }
  ): void {
    const duration = Date.now() - startTime;

    this.metrics.totalMutations++;

    if (result === 'success') {
      this.metrics.successfulMutations++;
    } else if (result === 'failure') {
      this.metrics.failedMutations++;
    } else if (result === 'retry') {
      this.metrics.retriedMutations++;
    }

    // Update average latency
    this.metrics.averageLatency =
      (this.metrics.averageLatency * (this.metrics.totalMutations - 1) + duration) /
      this.metrics.totalMutations;

    // Track optimistic corrections
    if (details?.serverDiff) {
      this.metrics.optimisticCorrections++;
    }

    // Track rollbacks
    if (details?.retryCount && details.retryCount >= 3) {
      this.metrics.rolledBackMutations++;
    }

    // Sample logging (10%)
    if (Math.random() < 0.1) {
      this.logSample(mutationId, operation, duration, result, details);
    }

    // Detect anomalies
    this.detectAnomalies(operation, duration, result, details);
  }

  private logSample(
    mutationId: string,
    operation: string,
    duration: number,
    result: string,
    details?: any
  ): void {
    console.log('[MutationDiagnostics] Sample:', {
      mutationId: mutationId.slice(0, 8),
      operation,
      duration,
      result,
      ...details,
    });
  }

  private detectAnomalies(
    operation: string,
    duration: number,
    result: string,
    details?: any
  ): void {
    // High latency
    if (duration > 10000) {
      this.reportAnomaly({
        type: 'high_retry_rate',
        severity: 'warning',
        details: { operation, duration },
        timestamp: Date.now(),
      });
    }

    // Multiple retries
    if (details?.retryCount && details.retryCount >= 2) {
      this.reportAnomaly({
        type: 'high_retry_rate',
        severity: 'warning',
        details: { operation, retryCount: details.retryCount },
        timestamp: Date.now(),
      });
    }
  }

  // Detect stuck mutations
  checkStuckMutations(): void {
    const pending = mutationLog.getPending();
    const now = Date.now();
    const STUCK_THRESHOLD = 60000; // 1 minute

    const stuck = pending.filter((m) => now - m.createdAt > STUCK_THRESHOLD);

    if (stuck.length > 0) {
      console.error(`[MutationDiagnostics] ${stuck.length} stuck mutations detected`);
      
      this.reportAnomaly({
        type: 'stuck_mutation',
        severity: 'error',
        details: { count: stuck.length, mutations: stuck.map((m) => m.context.mutationId) },
        timestamp: now,
      });
    }
  }

  private reportAnomaly(report: AnomalyReport): void {
    this.anomalies.push(report);
    
    // Keep last 100
    if (this.anomalies.length > 100) {
      this.anomalies.shift();
    }

    this.listeners.forEach((l) => l(report));
  }

  // Get metrics
  getMetrics(): MutationMetrics {
    return { ...this.metrics };
  }

  // Get anomalies
  getAnomalies(
    since?: number,
    severity?: AnomalyReport['severity']
  ): AnomalyReport[] {
    let filtered = this.anomalies;

    if (since) {
      filtered = filtered.filter((a) => a.timestamp > since);
    }

    if (severity) {
      filtered = filtered.filter((a) => a.severity === severity);
    }

    return filtered;
  }

  // Subscribe to anomalies
  subscribe(listener: (report: AnomalyReport) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Reset
  reset(): void {
    this.metrics = {
      totalMutations: 0,
      successfulMutations: 0,
      failedMutations: 0,
      retriedMutations: 0,
      rolledBackMutations: 0,
      averageLatency: 0,
      optimisticCorrections: 0,
    };
    this.anomalies = [];
  }
}

export const mutationDiagnostics = new MutationDiagnostics();

// Start stuck mutation detection
setInterval(() => mutationDiagnostics.checkStuckMutations(), 60000);

export function useMutationDiagnostics() {
  return {
    track: (
      id: string,
      op: string,
      start: number,
      result: 'success' | 'failure' | 'retry',
      details?: any
    ) => mutationDiagnostics.trackMutation(id, op, start, result, details),
    getMetrics: () => mutationDiagnostics.getMetrics(),
    getAnomalies: (since?: number, severity?: any) =>
      mutationDiagnostics.getAnomalies(since, severity),
    subscribe: (cb: (r: any) => void) => mutationDiagnostics.subscribe(cb),
  };
}
