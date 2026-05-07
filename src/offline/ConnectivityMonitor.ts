/**
 * Connectivity Monitor
 * Advanced connection quality monitoring
 */

interface ConnectionQuality {
  type: 'online' | 'offline' | 'slow' | 'unstable';
  latencyMs: number | null;
  downlinkMbps: number | null;
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g' | null;
}

class ConnectivityMonitor {
  private quality: ConnectionQuality = {
    type: 'online',
    latencyMs: null,
    downlinkMbps: null,
    effectiveType: null,
  };

  private listeners: Set<(quality: ConnectionQuality) => void> = new Set();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startMonitoring();
  }

  private startMonitoring(): void {
    // Check every 30 seconds
    this.checkInterval = setInterval(() => this.checkQuality(), 30000);
    
    // Initial check
    this.checkQuality();

    // Listen for native connection API
    if ('connection' in navigator) {
      (navigator as any).connection.addEventListener('change', () => {
        this.checkQuality();
      });
    }
  }

  private async checkQuality(): Promise<void> {
    const start = Date.now();

    try {
      // Latency check
      await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-store',
      });

      const latency = Date.now() - start;

      // Get connection info
      const conn = (navigator as any).connection;
      const effectiveType = conn?.effectiveType || null;
      const downlink = conn?.downlink || null;

      // Determine quality
      let type: ConnectionQuality['type'] = 'online';
      
      if (latency > 1000) {
        type = 'slow';
      } else if (latency > 500) {
        type = 'unstable';
      }

      this.quality = {
        type,
        latencyMs: latency,
        downlinkMbps: downlink,
        effectiveType,
      };
    } catch {
      this.quality = {
        type: 'offline',
        latencyMs: null,
        downlinkMbps: null,
        effectiveType: null,
      };
    }

    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l({ ...this.quality }));
  }

  // Public API

  getQuality(): ConnectionQuality {
    return { ...this.quality };
  }

  isSlowConnection(): boolean {
    return this.quality.type === 'slow' || 
           this.quality.effectiveType === '2g' ||
           this.quality.effectiveType === 'slow-2g';
  }

  subscribe(listener: (quality: ConnectionQuality) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.checkInterval && clearInterval(this.checkInterval);
  }
}

export const connectivityMonitor = new ConnectivityMonitor();

export function useConnectivityMonitor() {
  return {
    getQuality: () => connectivityMonitor.getQuality(),
    isSlowConnection: () => connectivityMonitor.isSlowConnection(),
    subscribe: (cb: (q: ConnectionQuality) => void) =>
      connectivityMonitor.subscribe(cb),
  };
}
