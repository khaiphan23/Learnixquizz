import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import { supabase } from '../services/supabase';
import { Quiz, QuizAttempt } from '../types';
import type { QuizPlayCount, UserQuizCount, CreatorQuizStats } from '../types/leaderboard';
import { useAuth } from './AuthContext';
// INTEGRATION: React Query as server state source
import { useQuery, useQueryClient } from '@tanstack/react-query';
// INTEGRATION: Mutation system
import { useQuizMutations } from '../hooks/useQuizMutations';
import { invalidationManager } from '../cache/QueryInvalidationManager';

function dbToQuiz(row: any): Quiz {
  return {
    id: row.id, title: row.title, description: row.description,
    topic: row.topic, difficulty: row.difficulty, questions: row.questions,
    createdAt: row.created_at, author: row.author, authorId: row.author_id,
    deletedAt: row.deleted_at ?? undefined, isPublic: row.is_public,
    shortCode: row.short_code ?? undefined,
  };
}

function quizToDb(quiz: Quiz, authorId?: string) {
  return {
    id: quiz.id, title: quiz.title, description: quiz.description,
    topic: quiz.topic ?? 'Chung', difficulty: quiz.difficulty ?? 'medium',
    questions: quiz.questions, created_at: quiz.createdAt,
    author: quiz.author, author_id: authorId ?? quiz.authorId ?? null,
    deleted_at: quiz.deletedAt ?? null, is_public: quiz.isPublic ?? false,
    short_code: quiz.shortCode ?? null,
  };
}

function dbToAttempt(row: any): QuizAttempt {
  return {
    id: row.id, quizId: row.quiz_id, userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined, answers: row.answers, score: row.score,
    essayGrades: row.essay_grades ?? {}, timestamp: row.timestamp, status: row.status,
  };
}

function attemptToDb(attempt: QuizAttempt) {
  return {
    id: attempt.id, quiz_id: attempt.quizId,
    user_id: attempt.userId ?? null, user_name: attempt.userName ?? null,
    answers: attempt.answers, score: attempt.score,
    essay_grades: attempt.essayGrades ?? {}, timestamp: attempt.timestamp,
    status: attempt.status,
  };
}

interface QuizContextType {
  quizzes: Quiz[]; attempts: QuizAttempt[];
  addQuiz: (quiz: Quiz) => Promise<void>;
  editQuiz: (quiz: Quiz) => Promise<void>;
  deleteQuiz: (id: string) => Promise<void>;
  restoreQuiz: (id: string) => Promise<void>;
  permanentDeleteQuiz: (id: string) => Promise<void>;
  deleteAllQuizzesByAuthor: (authorId: string) => Promise<void>;
  togglePublishQuiz: (id: string, isPublic: boolean) => Promise<void>;
  getPublicQuizzes: () => Promise<Quiz[]>;
  importQuiz: (quiz: Quiz) => Promise<void>;
  updateAttempt: (id: string, updates: Partial<QuizAttempt>) => Promise<void>;
  addAttempt: (attempt: QuizAttempt) => Promise<void>;
  getQuiz: (id: string) => Quiz | undefined;
  getQuizByShortCode: (code: string) => Promise<Quiz | undefined>;
  fetchQuizById: (id: string) => Promise<boolean>;
  publishQuiz: (id: string) => Promise<void>;
  getAllAttemptsForQuiz: (quizId: string) => QuizAttempt[];
  fetchAttemptsForQuiz: (quizId: string) => Promise<QuizAttempt[]>;
  isLoading: boolean;
  // Leaderboard/Ranking functions
  fetchMostPlayedQuizzes: (limit?: number) => Promise<QuizPlayCount[]>;
  fetchMostActivePlayers: (limit?: number) => Promise<UserQuizCount[]>;
  fetchTopCreators: (limit?: number) => Promise<CreatorQuizStats[]>;
}

const QuizContext = createContext<QuizContextType | undefined>(undefined);

// Query key factory (local to context for now)
const quizKeys = {
  all: ['quizzes'] as const,
  lists: () => [...quizKeys.all, 'list'] as const,
  list: (filters: { userId?: string; isPublic?: boolean }) => 
    [...quizKeys.lists(), filters] as const,
  details: () => [...quizKeys.all, 'detail'] as const,
  detail: (id: string) => [...quizKeys.details(), id] as const,
  attempts: (userId?: string) => ['attempts', userId] as const,
  public: () => [...quizKeys.all, 'public'] as const,
};

export const QuizProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  
  // React Query as source of truth - NO local state duplication
  const { data: quizzes = [], isLoading: quizzesLoading } = useQuery({
    queryKey: quizKeys.list({ userId: user?.id }),
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('quizzes')
        .select('*')
        .eq('author_id', user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(dbToQuiz);
    },
    enabled: !!user?.id && !authLoading,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: attempts = [] } = useQuery({
    queryKey: quizKeys.attempts(user?.id),
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('attempts')
        .select('*')
        .eq('user_id', user.id);
      
      if (error) throw error;
      return (data || []).map(dbToAttempt);
    },
    enabled: !!user?.id && !authLoading,
    staleTime: 2 * 60 * 1000,
  });

  // Local state for public quizzes (fetched on-demand)
  const [publicQuizzesCache, setPublicQuizzesCache] = React.useState<Quiz[]>([]);
  
  const isLoading = authLoading || quizzesLoading;

  // INTEGRATION: Setup mutation handlers with React Query cache
  const handleOptimisticUpdate = useCallback((quiz: Quiz, action: 'create' | 'update' | 'delete') => {
    if (action === 'create' && user?.id) {
      // Optimistically add to cache
      queryClient.setQueryData(
        quizKeys.list({ userId: user.id }),
        (old: Quiz[] = []) => [quiz, ...old]
      );
    } else if (action === 'update') {
      // Update in cache
      queryClient.setQueryData(
        quizKeys.list({ userId: user?.id }),
        (old: Quiz[] = []) => old.map(q => q.id === quiz.id ? quiz : q)
      );
      queryClient.setQueryData(
        quizKeys.detail(quiz.id),
        quiz
      );
    } else if (action === 'delete' && user?.id) {
      // Remove from cache
      queryClient.setQueryData(
        quizKeys.list({ userId: user.id }),
        (old: Quiz[] = []) => old.filter(q => q.id !== quiz.id)
      );
    }
  }, [queryClient, user?.id]);

  const handleRollback = useCallback((quizId: string, action: 'create' | 'update' | 'delete') => {
    if (action === 'create') {
      // Remove optimistically added quiz
      queryClient.setQueryData(
        quizKeys.list({ userId: user?.id }),
        (old: Quiz[] = []) => old.filter(q => q.id !== quizId)
      );
    } else if (action === 'update' || action === 'delete') {
      // Invalidate to trigger refetch
      queryClient.invalidateQueries({ queryKey: quizKeys.detail(quizId) });
      queryClient.invalidateQueries({ queryKey: quizKeys.list({ userId: user?.id }) });
    }
  }, [queryClient, user?.id]);

  // INTEGRATION: Initialize mutation hook
  const quizMutations = useQuizMutations({
    userId: user?.id || '',
    userName: user?.name || '',
    onOptimisticUpdate: handleOptimisticUpdate,
    onRollback: handleRollback,
  });

  // INTEGRATION: addQuiz now uses mutation system
  const addQuiz = async (quiz: Quiz) => {
    if (!user) throw new Error('Bạn cần đăng nhập để lưu quiz');

    console.log('[addQuiz] Using mutation system for quiz:', quiz.id);
    const result = await quizMutations.createQuiz(quiz);

    if (!result.success) {
      throw result.error || new Error('Lỗi lưu quiz');
    }
  };

  // INTEGRATION: editQuiz now uses mutation system with rollback support
  const editQuiz = async (updatedQuiz: Quiz) => {
    if (!user) throw new Error('Bạn cần đăng nhập để cập nhật quiz');

    // Get previous state for potential rollback
    const previousQuiz = getQuiz(updatedQuiz.id);
    if (!previousQuiz) {
      throw new Error('Quiz không tồn tại');
    }

    console.log('[editQuiz] Using mutation system for quiz:', updatedQuiz.id);
    const result = await quizMutations.updateQuiz(updatedQuiz, previousQuiz);

    if (!result.success) {
      throw result.error || new Error('Lỗi cập nhật quiz');
    }
  };

  // INTEGRATION: deleteQuiz uses mutation system
  const deleteQuiz = async (id: string) => {
    const quiz = getQuiz(id);
    if (!quiz) {
      throw new Error('Quiz không tồn tại');
    }

    console.log('[deleteQuiz] Using mutation system for quiz:', id);
    const result = await quizMutations.deleteQuiz(id, quiz);

    if (!result.success) {
      throw result.error || new Error('Lỗi xóa quiz');
    }
  };

  // INTEGRATION: restoreQuiz uses mutation system
  const restoreQuiz = async (id: string) => {
    const quiz = getQuiz(id);
    if (!quiz) {
      throw new Error('Quiz không tồn tại');
    }

    console.log('[restoreQuiz] Using mutation system for quiz:', id);
    const result = await quizMutations.restoreQuiz(id, quiz);

    if (!result.success) {
      throw result.error || new Error('Lỗi khôi phục quiz');
    }
  };

  // INTEGRATION: permanentDeleteQuiz uses mutation system
  const permanentDeleteQuiz = async (id: string) => {
    console.log('[permanentDeleteQuiz] Using mutation system for quiz:', id);
    const result = await quizMutations.permanentDeleteQuiz(id);

    if (!result.success) {
      throw result.error || new Error('Lỗi xóa vĩnh viễn quiz');
    }
  };

  const deleteAllQuizzesByAuthor = async (authorId: string) => {
    const { error } = await supabase.from('quizzes').delete().eq('author_id', authorId);
    if (error) throw new Error(error.message);
    setQuizzes([]);
  };

  // INTEGRATION: togglePublishQuiz uses mutation system
  const togglePublishQuiz = async (id: string, isPublic: boolean) => {
    const quiz = getQuiz(id);
    if (!quiz) {
      throw new Error('Quiz không tồn tại');
    }

    console.log('[togglePublishQuiz] Using mutation system for quiz:', id);
    const result = await quizMutations.togglePublishQuiz(id, isPublic, quiz);

    if (!result.success) {
      throw result.error || new Error('Lỗi cập nhật trạng thái quiz');
    }
  };

  // INTEGRATION: publishQuiz uses mutation system
  const publishQuiz = async (id: string) => {
    const quiz = getQuiz(id);
    if (!quiz) {
      throw new Error('Quiz không tồn tại');
    }
    // Use togglePublishQuiz with isPublic=true
    await togglePublishQuiz(id, true);
  };

  // INTEGRATION: getPublicQuizzes uses React Query pattern
  const getPublicQuizzes = useCallback(async (): Promise<Quiz[]> => {
    // Use React Query cache first
    const cached = queryClient.getQueryData<Quiz[]>(quizKeys.public());
    if (cached && cached.length > 0) {
      return cached.filter(q => q.isPublic && !q.deletedAt);
    }
    
    // Fetch and cache
    const { data, error } = await supabase
      .from('quizzes').select('*')
      .eq('is_public', true).is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) return [];
    const result = (data ?? []).map(dbToQuiz);
    // Cache the result
    queryClient.setQueryData(quizKeys.public(), result);
    setPublicQuizzesCache(result);
    return result;
  }, [queryClient, publicQuizzesCache]);

  // INTEGRATION: importQuiz uses mutation system
  const importQuiz = async (quiz: Quiz) => {
    // Check if already exists in cache
    const cached = queryClient.getQueryData<Quiz[]>(quizKeys.public()) || [];
    if (cached.some(q => q.id === quiz.id)) {
      return;
    }
    
    // Add to public quizzes cache
    queryClient.setQueryData(
      quizKeys.public(),
      (old: Quiz[] = []) => [...old, quiz]
    );
    setPublicQuizzesCache(prev => [...prev, quiz]);
  };

  // INTEGRATION: addAttempt uses React Query mutation pattern
  const addAttempt = useCallback(async (attempt: QuizAttempt) => {
    if (!user) throw new Error('Bạn cần đăng nhập để lưu kết quả');
    
    // Optimistic update in React Query cache
    queryClient.setQueryData(
      quizKeys.attempts(user.id),
      (old: QuizAttempt[] = []) => [...old, attempt]
    );
    
    // Import mutation executor for attempts
    const { createMutationContext } = await import('../mutations/core/MutationID');
    const { mutationExecutor } = await import('../mutations/core/MutationExecutor');
    const { mutationLog } = await import('../mutations/core/MutationLog');
    
    const context = createMutationContext(user.id, attempt.id, 'create_attempt');
    
    mutationLog.record({
      context,
      operation: 'create_attempt',
      entityType: 'attempt',
      entityId: attempt.id,
      payload: attemptToDb(attempt),
      optimisticSnapshot: null,
      status: 'pending',
    });
    
    const result = await mutationExecutor.execute(
      context,
      async () => {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('TIMEOUT')), 30000)
        );
        const insertPromise = supabase.from('attempts').insert(attemptToDb(attempt));
        return await Promise.race([insertPromise, timeoutPromise]);
      },
      { maxRetries: 2, timeoutMs: 30000 }
    );
    
    if (result.success) {
      mutationLog.acknowledge(context.mutationId, result.data);
      // Invalidate to trigger background refetch
      queryClient.invalidateQueries({ queryKey: quizKeys.attempts(user.id) });
    } else {
      // Rollback - remove from cache
      queryClient.setQueryData(
        quizKeys.attempts(user.id),
        (old: QuizAttempt[] = []) => old.filter(a => a.id !== attempt.id)
      );
      mutationLog.fail(context.mutationId, result.error?.message || 'Unknown error');
      throw result.error || new Error('Lỗi lưu kết quả');
    }
  }, [user, queryClient]);

  // INTEGRATION: updateAttempt uses mutation system with React Query
  const updateAttempt = useCallback(async (id: string, updates: Partial<QuizAttempt>) => {
    if (!user) throw new Error('Unauthorized');
    
    const previousAttempt = attempts.find(a => a.id === id);
    if (!previousAttempt) {
      throw new Error('Attempt không tồn tại');
    }
    
    // Optimistic update in React Query cache
    queryClient.setQueryData(
      quizKeys.attempts(user.id),
      (old: QuizAttempt[] = []) => old.map(a => a.id === id ? { ...a, ...updates } : a)
    );
    
    const dbUpdates: Record<string, any> = {};
    if (updates.score !== undefined) dbUpdates.score = updates.score;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.essayGrades !== undefined) dbUpdates.essay_grades = updates.essayGrades;
    
    // Use mutation executor
    const { createMutationContext } = await import('../mutations/core/MutationID');
    const { mutationExecutor } = await import('../mutations/core/MutationExecutor');
    const { mutationLog } = await import('../mutations/core/MutationLog');
    
    const context = createMutationContext(user.id, id, 'update_attempt');
    
    mutationLog.record({
      context,
      operation: 'update_attempt',
      entityType: 'attempt',
      entityId: id,
      payload: dbUpdates,
      optimisticSnapshot: previousAttempt,
      status: 'pending',
    });
    
    const result = await mutationExecutor.execute(
      context,
      async () => {
        return await supabase.from('attempts').update(dbUpdates).eq('id', id);
      },
      { maxRetries: 2, timeoutMs: 30000 }
    );
    
    if (result.success) {
      mutationLog.acknowledge(context.mutationId, result.data);
    } else {
      // Rollback in cache
      queryClient.setQueryData(
        quizKeys.attempts(user.id),
        (old: QuizAttempt[] = []) => old.map(a => a.id === id ? previousAttempt : a)
      );
      mutationLog.fail(context.mutationId, result.error?.message || 'Unknown error');
      throw result.error || new Error('Lỗi cập nhật kết quả');
    }
  }, [user, attempts, queryClient]);

  const getQuiz = useCallback((id: string) =>
    quizzes.find(q => q.id === id) || publicQuizzes.find(q => q.id === id),
  [quizzes, publicQuizzes]);

  const fetchQuizById = useCallback(async (id: string): Promise<boolean> => {
    if (quizzes.find(q => q.id === id) || publicQuizzes.find(q => q.id === id)) return true;
    const { data, error } = await supabase.from('quizzes').select('*').eq('id', id).single();
    if (error || !data) return false;
    const quiz = dbToQuiz(data);
    setPublicQuizzes(prev => prev.some(q => q.id === quiz.id) ? prev : [...prev, quiz]);
    return true;
  }, [quizzes, publicQuizzes]);

  const getQuizByShortCode = useCallback(async (code: string): Promise<Quiz | undefined> => {
    const local = quizzes.find(q => q.shortCode === code) || publicQuizzes.find(q => q.shortCode === code);
    if (local) return local;
    const { data, error } = await supabase.from('quizzes').select('*').eq('short_code', code).single();
    if (error || !data) return undefined;
    const quiz = dbToQuiz(data);
    setPublicQuizzes(prev => prev.some(q => q.id === quiz.id) ? prev : [...prev, quiz]);
    return quiz;
  }, [quizzes, publicQuizzes]);

  const getAllAttemptsForQuiz = (quizId: string) => attempts.filter(a => a.quizId === quizId);

  const fetchAttemptsForQuiz = useCallback(async (quizId: string): Promise<QuizAttempt[]> => {
    const { data, error } = await supabase
      .from('attempts').select('*').eq('quiz_id', quizId)
      .order('score', { ascending: false });
    if (error) return [];
    return (data ?? []).map(dbToAttempt);
  }, []);

  // Leaderboard: Most played quizzes
  const fetchMostPlayedQuizzes = useCallback(async (limit = 10): Promise<QuizPlayCount[]> => {
    console.log('[Leaderboard] Fetching most played quizzes...');
    
    // Get all attempts with quiz info using join
    const { data: attemptsData, error: attemptsError } = await supabase
      .from('attempts')
      .select('quiz_id, score, user_id, quiz:quizzes!inner(id, title, topic, author, deleted_at)');
    
    console.log('[Leaderboard] Attempts with quiz data:', attemptsData?.length || 0);
    if (attemptsError) {
      console.error('[Leaderboard] Attempts error:', attemptsError);
      return [];
    }
    
    if (!attemptsData || attemptsData.length === 0) {
      console.log('[Leaderboard] No attempts in database');
      return [];
    }
    
    // Aggregate by quiz using quiz data from join
    const statsMap = new Map<string, { 
      playCount: number; 
      uniqueUsers: Set<string>; 
      totalScore: number;
      quizTitle: string;
      quizTopic: string;
      authorName: string;
    }>();
    
    for (const attempt of attemptsData) {
      const quizId = attempt.quiz_id;
      const quiz = attempt.quiz as any;
      
      if (!statsMap.has(quizId)) {
        statsMap.set(quizId, { 
          playCount: 0, 
          uniqueUsers: new Set(), 
          totalScore: 0,
          quizTitle: quiz?.title || 'Unknown Quiz',
          quizTopic: quiz?.topic || 'General',
          authorName: quiz?.author || 'Unknown'
        });
      }
      const stats = statsMap.get(quizId)!;
      stats.playCount++;
      stats.totalScore += (attempt.score || 0);
      if (attempt.user_id) stats.uniqueUsers.add(attempt.user_id);
    }
    
    // Build result
    const result: QuizPlayCount[] = [];
    for (const [quizId, stats] of statsMap) {
      result.push({
        quizId,
        quizTitle: stats.quizTitle,
        quizTopic: stats.quizTopic,
        authorName: stats.authorName,
        playCount: stats.playCount,
        uniquePlayers: stats.uniqueUsers.size,
        averageScore: stats.playCount > 0 ? Math.round(stats.totalScore / stats.playCount) : 0
      });
    }
    
    // Log unknown quizzes for debugging
    const unknownQuizzes = result.filter(q => q.quizTitle === 'Unknown Quiz');
    if (unknownQuizzes.length > 0) {
      console.warn('[Leaderboard] Unknown quizzes found:', unknownQuizzes.map(q => q.quizId));
    }
    
    console.log('[Leaderboard] Result:', result.length, 'quizzes');
    
    return result
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, limit);
  }, []);

  // Leaderboard: Most active players
  const fetchMostActivePlayers = useCallback(async (limit = 10): Promise<UserQuizCount[]> => {
    console.log('[Leaderboard] Fetching most active players...');
    
    // Get all attempts - don't filter by user_id to see all data
    const { data, error } = await supabase
      .from('attempts')
      .select('user_id, user_name, score, quiz_id');
    
    console.log('[Leaderboard] Raw attempts for players:', data?.length || 0, 'records');
    if (error) console.error('[Leaderboard] Error:', error);
    
    if (error || !data || data.length === 0) {
      console.log('[Leaderboard] No attempts found');
      return [];
    }
    
    // Group by user_id (use anonymous_xxx as userId if no user_id)
    const userMap = new Map<string, { 
      userId: string; 
      userName: string; 
      quizzes: Set<string>; 
      attempts: number; 
      totalScore: number;
      bestScore: number;
    }>();
    
    for (const row of data) {
      // Use user_id if available, otherwise use user_name or 'anonymous'
      const userId = row.user_id || row.user_name || 'anonymous';
      
      if (!userMap.has(userId)) {
        userMap.set(userId, {
          userId,
          userName: row.user_name || 'Anonymous',
          quizzes: new Set<string>(),
          attempts: 0,
          totalScore: 0,
          bestScore: 0
        });
      }
      
      const stats = userMap.get(userId)!;
      stats.attempts++;
      stats.totalScore += (row.score || 0);
      stats.bestScore = Math.max(stats.bestScore, row.score || 0);
      if (row.quiz_id) stats.quizzes.add(row.quiz_id);
    }
    
    const result: UserQuizCount[] = Array.from(userMap.values()).map(stats => ({
      userId: stats.userId,
      userName: stats.userName,
      userEmail: '',
      quizzesPlayed: stats.quizzes.size,
      totalAttempts: stats.attempts,
      averageScore: stats.attempts > 0 ? Math.round(stats.totalScore / stats.attempts) : 0,
      bestScore: stats.bestScore
    }));
    
    console.log('[Leaderboard] Processed players:', result.length, result);
    
    return result
      .sort((a, b) => b.totalAttempts - a.totalAttempts)
      .slice(0, limit);
  }, []);

  // Leaderboard: Top creators
  const fetchTopCreators = useCallback(async (limit = 10): Promise<CreatorQuizStats[]> => {
    console.log('[Leaderboard] Fetching top creators...');
    
    // Get all quizzes with their authors (include private for owner's stats)
    const { data: quizzesData, error } = await supabase
      .from('quizzes')
      .select('author_id, author');
    
    console.log('[Leaderboard] Total quizzes:', quizzesData?.length || 0);
    if (error) console.error('[Leaderboard] Error:', error);
    
    if (error || !quizzesData || quizzesData.length === 0) {
      console.log('[Leaderboard] No quizzes found');
      return [];
    }
    
    const creatorMap = new Map<string, {
      userId: string;
      userName: string;
      quizzesCreated: number;
      quizIds: string[];
    }>();
    
    for (const quiz of quizzesData) {
      const authorId = quiz.author_id;
      if (!authorId) continue;
      
      if (!creatorMap.has(authorId)) {
        creatorMap.set(authorId, {
          userId: authorId,
          userName: quiz.author || 'Unknown',
          quizzesCreated: 0,
          quizIds: []
        });
      }
      
      const creator = creatorMap.get(authorId)!;
      creator.quizzesCreated++;
      // Store quiz IDs to count attempts later
    }
    
    // Get all attempts to calculate plays per creator
    const { data: allAttempts } = await supabase
      .from('attempts')
      .select('quiz_id, user_id, quiz:quizzes!inner(author_id)');
    
    console.log('[Leaderboard] Total attempts:', allAttempts?.length || 0);
    
    // Count plays per creator
    const creatorStats = new Map<string, { totalPlays: number; uniqueUsers: Set<string> }>();
    
    if (allAttempts) {
      for (const attempt of allAttempts) {
        const authorId = (attempt.quiz as any)?.author_id;
        if (!authorId) continue;
        
        if (!creatorStats.has(authorId)) {
          creatorStats.set(authorId, { totalPlays: 0, uniqueUsers: new Set() });
        }
        
        const stats = creatorStats.get(authorId)!;
        stats.totalPlays++;
        if (attempt.user_id) stats.uniqueUsers.add(attempt.user_id);
      }
    }
    
    // Combine data
    const result: CreatorQuizStats[] = [];
    for (const [authorId, creator] of creatorMap) {
      const stats = creatorStats.get(authorId) || { totalPlays: 0, uniqueUsers: new Set() };
      result.push({
        userId: creator.userId,
        userName: creator.userName,
        userEmail: '',
        quizzesCreated: creator.quizzesCreated,
        totalPlays: stats.totalPlays,
        uniquePlayers: stats.uniqueUsers.size,
        averageRating: creator.quizzesCreated > 0 ? Math.round(stats.totalPlays / creator.quizzesCreated) : 0
      });
    }
    
    console.log('[Leaderboard] Processed creators:', result.length);
    
    return result
      .sort((a, b) => b.totalPlays - a.totalPlays)
      .slice(0, limit);
  }, []);

  return (
    <QuizContext.Provider value={{
      quizzes, attempts, addQuiz, editQuiz, deleteQuiz, restoreQuiz,
      permanentDeleteQuiz, deleteAllQuizzesByAuthor, togglePublishQuiz,
      getPublicQuizzes, importQuiz, addAttempt, updateAttempt,
      getQuiz, getQuizByShortCode, fetchQuizById, publishQuiz,
      getAllAttemptsForQuiz, fetchAttemptsForQuiz, isLoading,
      fetchMostPlayedQuizzes, fetchMostActivePlayers, fetchTopCreators,
    }}>
      {children}
    </QuizContext.Provider>
  );
};

export const useQuizStore = () => {
  const ctx = useContext(QuizContext);
  if (!ctx) throw new Error('useQuizStore must be used within QuizProvider');
  return ctx;
};
