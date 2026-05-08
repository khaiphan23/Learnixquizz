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
  private initialized = false;

  constructor() {
    // Lazy initialization - don't access browser APIs here
  }

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;
    
    this.startMonitoring();
  }

  private startMonitoring(): void {
    // Check every 30 seconds
    this.checkInterval = setInterval(() => this.checkQuality(), 30000);
    
    // Initial check
    this.checkQuality();

    // Listen for native connection API
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
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

  stop(): void {
    this.checkInterval && clearInterval(this.checkInterval);
    this.checkInterval = null;
  }
}

// Lazy singleton
let connectivityMonitorInstance: ConnectivityMonitor | null = null;

function getConnectivityMonitor(): ConnectivityMonitor {
  if (!connectivityMonitorInstance && typeof window !== 'undefined') {
    connectivityMonitorInstance = new ConnectivityMonitor();
    connectivityMonitorInstance.initialize();
  }
  if (!connectivityMonitorInstance) {
    // Dummy for SSR
    return {
      getQuality: () => ({ type: 'online', latencyMs: null, downlinkMbps: null, effectiveType: null }),
      isSlowConnection: () => false,
      subscribe: () => () => {},
      stop: () => {},
      initialize: () => {},
    } as ConnectivityMonitor;
  }
  return connectivityMonitorInstance;
}

export const connectivityMonitor = new Proxy({} as ConnectivityMonitor, {
  get(target, prop) {
    return (getConnectivityMonitor() as any)[prop];
  },
});

export function useConnectivityMonitor() {
  const monitor = getConnectivityMonitor();
  return {
    getQuality: () => monitor.getQuality(),
    isSlowConnection: () => monitor.isSlowConnection(),
    subscribe: (cb: (q: ConnectionQuality) => void) =>
      monitor.subscribe(cb),
  };
}
