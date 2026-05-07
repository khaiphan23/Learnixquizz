/**
 * Query Client Configuration
 * Centralized React Query client with error handling and cache config
 */

import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';

// Query cache error handler
const queryCache = new QueryCache({
  onError: (error, query) => {
    console.error(`[QueryCache] Error for ${query.queryKey.join('/')}:`, error);

    // Don't show toast for background refetches
    if (query.state.data !== undefined) return;

    // Show user-friendly error based on error type
    if (error instanceof Error) {
      if (error.message.includes('network')) {
        console.warn('[QueryCache] Network error - working offline');
      } else if (error.message.includes('RLS')) {
        console.error('[QueryCache] Permission denied');
      }
    }
  },
});

// Mutation cache handler
const mutationCache = new MutationCache({
  onError: (error, variables, context, mutation) => {
    console.error(
      `[MutationCache] Error for ${mutation.options.mutationKey}:`,
      error
    );
  },
  onSuccess: (data, variables, context, mutation) => {
    // Auto-log successful mutations
    if (process.env.NODE_ENV === 'development') {
      console.log(`[MutationCache] Success: ${mutation.options.mutationKey}`);
    }
  },
});

// Create query client
export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      // Retry configuration
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors
        if (error?.status >= 400 && error?.status < 500) return false;
        // Retry up to 3 times on network errors
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      
      // Cache configuration
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (garbage collection)
      
      // Refetch configuration
      refetchOnWindowFocus: false, // We handle this manually
      refetchOnReconnect: false, // We handle this manually
      refetchOnMount: 'always',
      
      // Network mode
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 2,
      networkMode: 'offlineFirst',
    },
  },
});

// Export for use in other modules
export default queryClient;
