/**
 * App Providers
 * Initializes all distributed consistency infrastructure
 * INTEGRATED with React Query and app lifecycle
 */

import React, { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Infrastructure imports
import { offlineManager } from '../offline/OfflineManager';
import { mutationReplay } from '../mutations/core/MutationReplay';
import { aiPipeline } from '../ai/AIPipeline';
import { consistencyRules } from '../consistency/ConsistencyRules';
import { tabCoordinator } from '../concurrency/TabCoordinator';
import { mutationDiagnostics } from '../diagnostics/MutationDiagnostics';
import { connectivityMonitor } from '../offline/ConnectivityMonitor';
import { invalidationManager } from '../cache/QueryInvalidationManager';

interface AppProvidersProps {
  children: React.ReactNode;
}

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  const [initialized, setInitialized] = useState(false);
  const queryClient = useQueryClient();
  const replayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initAttemptedRef = useRef(false);

  useEffect(() => {
    // Prevent double initialization in StrictMode
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;

    console.log('[AppProviders] Initializing distributed consistency infrastructure...');

    // 1. Setup React Query cache invalidation bridge
    invalidationManager.setQueryClient(queryClient);

    // 2. Check for pending mutations and replay AFTER mount
    const checkAndReplay = async () => {
      const status = mutationReplay.getStatus();
      if (status.pendingCount > 0 && !status.isReplaying) {
        console.log(`[AppProviders] ${status.pendingCount} pending mutations found, starting replay...`);
        try {
          const result = await mutationReplay.replay();
          console.log('[AppProviders] Replay complete:', result);
        } catch (error) {
          console.error('[AppProviders] Replay failed:', error);
        }
      }
    };
    
    // Delay replay slightly to ensure all components are mounted
    replayTimeoutRef.current = setTimeout(checkAndReplay, 500);

    // 3. Recover and restart AI jobs
    const pendingAIJobs = aiPipeline.getJobs().filter(j => 
      j.status === 'pending' || j.status === 'running'
    );
    
    if (pendingAIJobs.length > 0) {
      console.log(`[AppProviders] Recovering ${pendingAIJobs.length} AI jobs...`);
      pendingAIJobs.forEach((job) => {
        console.log(`[AppProviders] Recovering AI job: ${job.id} (${job.type})`);
        // Restart stuck jobs
        if (job.status === 'running' && job.startedAt) {
          const elapsed = Date.now() - job.startedAt;
          const MAX_AI_DURATION = 10 * 60 * 1000; // 10 minutes
          if (elapsed > MAX_AI_DURATION) {
            console.log(`[AppProviders] AI job ${job.id} appears stuck, marking for retry`);
            aiPipeline.submit({ ...job, status: 'pending', progress: 0, retryCount: job.retryCount + 1 });
          }
        }
      });
    }

    // 4. Set up visibility change handler
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[AppProviders] Tab became visible, reconciling...');
        consistencyRules.handleVisibilityChange(true);
        // Re-check for pending mutations when tab becomes visible
        const status = mutationReplay.getStatus();
        if (status.pendingCount > 0 && !status.isReplaying) {
          mutationReplay.replay();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 5. Set up online/offline handlers with automatic replay
    const unsubscribeOffline = offlineManager.subscribe((state) => {
      if (state.isOnline && state.pendingMutations > 0) {
        console.log('[AppProviders] Back online with', state.pendingMutations, 'pending mutations, triggering replay...');
        // Small delay to ensure network is stable
        setTimeout(() => mutationReplay.replay(), 1000);
      }
    });

    // 6. Subscribe to tab coordinator for multi-tab sync
    const unsubscribeTab = tabCoordinator.subscribe('mutation-complete', (payload) => {
      console.log('[AppProviders] Mutation completed in another tab:', payload);
      // Invalidate cache for this tab
      if (payload?.entityId) {
        invalidationManager.invalidate('tab_sync', { entityId: payload.entityId });
      }
    });

    const unsubscribeCache = tabCoordinator.subscribe('cache-invalidation', (payload) => {
      console.log('[AppProviders] Cache invalidation from another tab:', payload);
      if (payload?.keys) {
        payload.keys.forEach((key: string[]) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      }
    });

    // 7. Start diagnostics monitoring
    const unsubscribeDiagnostics = mutationDiagnostics.subscribe((anomaly) => {
      if (anomaly.severity === 'error' || anomaly.severity === 'critical') {
        console.error('[AppProviders] Anomaly detected:', anomaly);
      }
    });

    // 8. Start connectivity monitoring
    connectivityMonitor.start();

    setInitialized(true);

    console.log('[AppProviders] Initialization complete');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeOffline();
      unsubscribeTab?.();
      unsubscribeCache?.();
      unsubscribeDiagnostics?.();
      connectivityMonitor.stop();
      if (replayTimeoutRef.current) {
        clearTimeout(replayTimeoutRef.current);
      }
    };
  }, [queryClient]);

  if (!initialized) {
    // Show minimal loading state
    return <>{children}</>;
  }

  return <>{children}</>;
};
