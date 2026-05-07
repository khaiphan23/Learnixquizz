/**
 * App Providers
 * Initializes all distributed consistency infrastructure
 */

import React, { useEffect, useState } from 'react';

// Infrastructure imports
import { offlineManager } from '../offline/OfflineManager';
import { mutationReplay } from '../mutations/core/MutationReplay';
import { aiPipeline } from '../ai/AIPipeline';
import { consistencyRules } from '../consistency/ConsistencyRules';
import { tabCoordinator } from '../concurrency/TabCoordinator';
import { mutationDiagnostics } from '../diagnostics/MutationDiagnostics';

interface AppProvidersProps {
  children: React.ReactNode;
}

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Initialize all infrastructure
    console.log('[AppProviders] Initializing distributed consistency infrastructure...');

    // 1. Check for pending mutations and replay
    const pendingCount = mutationReplay.getStatus().pendingCount;
    if (pendingCount > 0) {
      console.log(`[AppProviders] ${pendingCount} pending mutations found, starting replay...`);
      mutationReplay.replay();
    }

    // 2. Recover AI jobs
    aiPipeline.getJobs().forEach((job) => {
      if (job.status === 'pending' || job.status === 'running') {
        console.log(`[AppProviders] Recovering AI job: ${job.id}`);
      }
    });

    // 3. Set up visibility change handler
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[AppProviders] Tab became visible, reconciling...');
        consistencyRules.handleVisibilityChange(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 4. Set up online/offline handlers
    const unsubscribeOffline = offlineManager.subscribe((state) => {
      if (state.isOnline && state.pendingMutations > 0) {
        console.log('[AppProviders] Back online with pending mutations');
      }
    });

    // 5. Subscribe to tab coordinator
    const unsubscribeTab = tabCoordinator.subscribe('mutation-complete', (payload) => {
      console.log('[AppProviders] Mutation completed in another tab:', payload);
    });

    // 6. Start diagnostics monitoring
    const unsubscribeDiagnostics = mutationDiagnostics.subscribe((anomaly) => {
      if (anomaly.severity === 'error' || anomaly.severity === 'critical') {
        console.error('[AppProviders] Anomaly detected:', anomaly);
      }
    });

    setInitialized(true);

    console.log('[AppProviders] Initialization complete');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeOffline();
      unsubscribeTab?.();
      unsubscribeDiagnostics?.();
    };
  }, []);

  if (!initialized) {
    // Show minimal loading state
    return <>{children}</>;
  }

  return <>{children}</>;
};
