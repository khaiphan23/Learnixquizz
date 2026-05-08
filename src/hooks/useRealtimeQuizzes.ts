/**
 * Realtime Quizzes Hook
 * Supabase realtime subscription with deduplication and cache sync
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { realtimeCacheBridge } from '../realtime/RealtimeCacheBridge';
import { sequenceManager } from '../realtime/SequenceManager';
import { useQuizCache, quizKeys } from './useQuizQueries';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

interface UseRealtimeQuizzesOptions {
  userId?: string;
  enabled?: boolean;
}

/**
 * Subscribe to realtime quiz changes
 */
export function useRealtimeQuizzes(options: UseRealtimeQuizzesOptions = {}) {
  const { userId, enabled = true } = options;
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const { invalidateQuiz, invalidateQuizList } = useQuizCache();

  const handleQuizChange = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    // Generate event ID for deduplication
    const eventId = `${payload.commit_timestamp}-${newRecord?.id || oldRecord?.id}`;
    
    // Skip if already processed
    if (sequenceManager.isProcessed(eventId)) {
      return;
    }
    
    sequenceManager.markProcessed({
      id: eventId,
      commitTimestamp: payload.commit_timestamp as string,
      table: 'quizzes',
      record: newRecord || oldRecord,
      eventType: eventType as 'INSERT' | 'UPDATE' | 'DELETE',
    });

    console.log('[useRealtimeQuizzes] Event received:', eventType, newRecord?.id || oldRecord?.id);

    // Handle based on event type
    switch (eventType) {
      case 'INSERT':
        // New quiz created - invalidate list
        if (newRecord?.author_id === userId) {
          invalidateQuizList(userId);
        }
        break;
        
      case 'UPDATE':
        // Quiz updated - invalidate specific quiz
        if (newRecord?.id) {
          invalidateQuiz(newRecord.id);
          if (newRecord?.author_id === userId) {
            invalidateQuizList(userId);
          }
        }
        break;
        
      case 'DELETE':
        // Quiz deleted - invalidate list
        if (oldRecord?.author_id === userId) {
          invalidateQuizList(userId);
        }
        break;
    }

    // Also update via cache bridge for surgical updates
    realtimeCacheBridge.handleEvent({
      schema: 'public',
      table: 'quizzes',
      commit_timestamp: payload.commit_timestamp as string,
      eventType: eventType as 'INSERT' | 'UPDATE' | 'DELETE',
      new: newRecord,
      old: oldRecord,
      errors: null,
    });
  }, [userId, invalidateQuiz, invalidateQuizList]);

  useEffect(() => {
    if (!enabled || !userId) return;

    // Clean up existing subscription
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
    }

    console.log('[useRealtimeQuizzes] Setting up subscription for user:', userId);

    // Create new subscription
    const channel = supabase
      .channel(`quizzes-user-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quizzes',
          filter: `author_id=eq.${userId}`,
        },
        handleQuizChange
      )
      .subscribe((status) => {
        console.log('[useRealtimeQuizzes] Subscription status:', status);
      });

    subscriptionRef.current = channel;

    return () => {
      console.log('[useRealtimeQuizzes] Cleaning up subscription');
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [userId, enabled, handleQuizChange]);

  return {
    isSubscribed: !!subscriptionRef.current,
  };
}

/**
 * Subscribe to specific quiz changes (for collaborative editing)
 */
export function useRealtimeQuiz(quizId: string | undefined) {
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const { invalidateQuiz } = useQuizCache();

  const handleQuizChange = useCallback((payload: RealtimePostgresChangesPayload<any>) => {
    const { eventType, new: newRecord } = payload;
    
    if (!newRecord?.id) return;
    
    const eventId = `${payload.commit_timestamp}-${newRecord.id}`;
    
    if (sequenceManager.isProcessed(eventId)) {
      return;
    }
    
    sequenceManager.markProcessed({
      id: eventId,
      commitTimestamp: payload.commit_timestamp as string,
      table: 'quizzes',
      record: newRecord,
      eventType: eventType as 'INSERT' | 'UPDATE' | 'DELETE',
    });

    console.log('[useRealtimeQuiz] Event received:', eventType, newRecord.id);

    // Invalidate the specific quiz
    invalidateQuiz(newRecord.id);

    // Update via cache bridge
    realtimeCacheBridge.handleEvent({
      schema: 'public',
      table: 'quizzes',
      commit_timestamp: payload.commit_timestamp as string,
      eventType: eventType as 'INSERT' | 'UPDATE' | 'DELETE',
      new: newRecord,
      old: payload.old,
      errors: null,
    });
  }, [invalidateQuiz]);

  useEffect(() => {
    if (!quizId) return;

    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
    }

    console.log('[useRealtimeQuiz] Setting up subscription for quiz:', quizId);

    const channel = supabase
      .channel(`quiz-${quizId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'quizzes',
          filter: `id=eq.${quizId}`,
        },
        handleQuizChange
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [quizId, handleQuizChange]);

  return {
    isSubscribed: !!subscriptionRef.current,
  };
}
