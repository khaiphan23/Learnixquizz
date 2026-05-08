/**
 * Quiz Queries Hook
 * React Query integration for quiz data fetching with cache synchronization
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase } from '../services/supabase';
import { Quiz, QuizAttempt } from '../types';
import { realtimeCacheBridge } from '../realtime/RealtimeCacheBridge';

// Query key factory for consistent cache keys
export const quizKeys = {
  all: ['quizzes'] as const,
  lists: () => [...quizKeys.all, 'list'] as const,
  list: (filters: { userId?: string; isPublic?: boolean }) => 
    [...quizKeys.lists(), filters] as const,
  details: () => [...quizKeys.all, 'detail'] as const,
  detail: (id: string) => [...quizKeys.details(), id] as const,
  attempts: (quizId: string) => ['attempts', quizId] as const,
  public: () => [...quizKeys.all, 'public'] as const,
};

/**
 * Fetch user's quizzes with caching
 */
export function useUserQuizzes(userId: string | undefined) {
  return useQuery({
    queryKey: quizKeys.list({ userId }),
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('quizzes')
        .select('*')
        .eq('author_id', userId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToQuiz);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Fetch single quiz by ID with caching
 */
export function useQuiz(quizId: string | undefined) {
  return useQuery({
    queryKey: quizKeys.detail(quizId || ''),
    queryFn: async () => {
      if (!quizId) return null;
      const { data, error } = await supabase
        .from('quizzes')
        .select('*')
        .eq('id', quizId)
        .single();
      
      if (error) throw error;
      return dbToQuiz(data);
    },
    enabled: !!quizId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch public quizzes
 */
export function usePublicQuizzes() {
  return useQuery({
    queryKey: quizKeys.public(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quizzes')
        .select('*')
        .eq('is_public', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToQuiz);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch attempts for a quiz
 */
export function useQuizAttempts(quizId: string | undefined) {
  return useQuery({
    queryKey: quizKeys.attempts(quizId || ''),
    queryFn: async () => {
      if (!quizId) return [];
      const { data, error } = await supabase
        .from('attempts')
        .select('*')
        .eq('quiz_id', quizId)
        .order('score', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToAttempt);
    },
    enabled: !!quizId,
    staleTime: 2 * 60 * 1000, // 2 minutes for attempts
  });
}

/**
 * Hook for manual cache operations
 */
export function useQuizCache() {
  const queryClient = useQueryClient();

  const invalidateQuiz = useCallback((quizId: string) => {
    queryClient.invalidateQueries({ queryKey: quizKeys.detail(quizId) });
  }, [queryClient]);

  const invalidateQuizList = useCallback((userId?: string) => {
    queryClient.invalidateQueries({ 
      queryKey: quizKeys.list({ userId }),
      exact: false 
    });
  }, [queryClient]);

  const setQuizData = useCallback((quizId: string, quiz: Quiz) => {
    queryClient.setQueryData(quizKeys.detail(quizId), quiz);
  }, [queryClient]);

  const addQuizToList = useCallback((userId: string, quiz: Quiz) => {
    queryClient.setQueryData(
      quizKeys.list({ userId }),
      (old: Quiz[] = []) => [quiz, ...old]
    );
  }, [queryClient]);

  const removeQuizFromList = useCallback((userId: string, quizId: string) => {
    queryClient.setQueryData(
      quizKeys.list({ userId }),
      (old: Quiz[] = []) => old.filter(q => q.id !== quizId)
    );
  }, [queryClient]);

  return {
    invalidateQuiz,
    invalidateQuizList,
    setQuizData,
    addQuizToList,
    removeQuizFromList,
    queryClient,
  };
}

// Helper functions
function dbToQuiz(row: any): Quiz {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    topic: row.topic,
    difficulty: row.difficulty,
    questions: row.questions,
    createdAt: row.created_at,
    author: row.author,
    authorId: row.author_id,
    deletedAt: row.deleted_at ?? undefined,
    isPublic: row.is_public,
    shortCode: row.short_code ?? undefined,
  };
}

function dbToAttempt(row: any): QuizAttempt {
  return {
    id: row.id,
    quizId: row.quiz_id,
    userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined,
    answers: row.answers,
    score: row.score,
    essayGrades: row.essay_grades ?? {},
    timestamp: row.timestamp,
    status: row.status,
  };
}
