/**
 * Quiz Mutations Hook
 * Production-grade mutations with optimistic updates, retry, and rollback
 * INTEGRATED with existing QuizContext
 */

import { useCallback } from 'react';
import { supabase } from '../services/supabase';
import { Quiz } from '../types';
import { createMutationContext, regenerateForRetry } from '../mutations/core/MutationID';
import { mutationLog } from '../mutations/core/MutationLog';
import { mutationExecutor } from '../mutations/core/MutationExecutor';
import { optimisticEngine } from '../mutations/core/OptimisticEngine';
import { invalidationManager } from '../cache/QueryInvalidationManager';
import type { MutationContext } from '../mutations/core/MutationID';

// Helper to convert Quiz to DB format
function quizToDb(quiz: Quiz, authorId?: string) {
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    topic: quiz.topic ?? 'Chung',
    difficulty: quiz.difficulty ?? 'medium',
    questions: quiz.questions,
    created_at: quiz.createdAt,
    author: quiz.author,
    author_id: authorId ?? quiz.authorId ?? null,
    deleted_at: quiz.deletedAt ?? null,
    is_public: quiz.isPublic ?? false,
    short_code: quiz.shortCode ?? null,
  };
}

export interface UseQuizMutationsOptions {
  userId: string;
  userName: string;
  onOptimisticUpdate?: (quiz: Quiz, action: 'create' | 'update' | 'delete') => void;
  onRollback?: (quizId: string, action: 'create' | 'update' | 'delete') => void;
}

export function useQuizMutations(options: UseQuizMutationsOptions) {
  const { userId, userName, onOptimisticUpdate, onRollback } = options;

  /**
   * CREATE QUIZ - With full mutation tracking
   */
  const createQuiz = useCallback(async (quiz: Quiz): Promise<{ success: boolean; error?: Error }> => {
    if (!userId) {
      return { success: false, error: new Error('Bạn cần đăng nhập để lưu quiz') };
    }

    // Validation
    if (!quiz.questions || quiz.questions.length === 0) {
      return { success: false, error: new Error('Quiz phải có ít nhất 1 câu hỏi') };
    }

    if (quiz.questions.length > 100) {
      return { success: false, error: new Error(`Quiz quá nhiều câu hỏi (${quiz.questions.length}). Tối đa 100 câu.`) };
    }

    const row = quizToDb(quiz, userId);
    row.author = userName;

    // Check data size
    const dataSize = JSON.stringify(row).length;
    if (dataSize > 2000000) {
      return { success: false, error: new Error('Quiz quá lớn (>2MB) - vui lòng giảm số câu hỏi hoặc độ dài nội dung') };
    }

    // Create mutation context
    const context = createMutationContext(userId, quiz.id, 'create_quiz');

    // Apply optimistic update BEFORE mutation (triggers UI update immediately)
    onOptimisticUpdate?.(quiz, 'create');

    // Record in mutation log
    mutationLog.record({
      context,
      operation: 'create_quiz',
      entityType: 'quiz',
      entityId: quiz.id,
      payload: row,
      optimisticSnapshot: null, // No previous state for create
      status: 'pending',
    });

    // Execute with retry
    const startTime = Date.now();
    const result = await mutationExecutor.execute(
      context,
      async () => {
        const timeoutMs = quiz.questions.length > 50 ? 120000 : 60000;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
        );

        const insertPromise = supabase.from('quizzes').insert(row);
        return await Promise.race([insertPromise, timeoutPromise]);
      },
      {
        maxRetries: 2,
        timeoutMs: quiz.questions.length > 50 ? 120000 : 60000,
        onRetry: (attempt, error) => {
          console.log(`[createQuiz] Retry ${attempt} after error:`, error.message);
        },
      }
    );

    if (result.success) {
      // Acknowledge in log
      mutationLog.acknowledge(context.mutationId, result.data);
      // Invalidate cache
      invalidationManager.invalidate('create_quiz');
      return { success: true };
    } else {
      // Rollback
      mutationLog.rollback(context.mutationId, () => {
        onRollback?.(quiz.id, 'create');
      });
      mutationLog.fail(context.mutationId, result.error?.message || 'Unknown error');
      return { success: false, error: result.error };
    }
  }, [userId, userName, onOptimisticUpdate, onRollback]);

  /**
   * UPDATE QUIZ - With optimistic update and rollback
   */
  const updateQuiz = useCallback(async (
    quiz: Quiz,
    previousQuiz: Quiz
  ): Promise<{ success: boolean; error?: Error }> => {
    if (!userId) {
      return { success: false, error: new Error('Bạn cần đăng nhập để cập nhật quiz') };
    }

    // Validation
    if (!quiz.questions || quiz.questions.length === 0) {
      return { success: false, error: new Error('Quiz phải có ít nhất 1 câu hỏi') };
    }

    const row = quizToDb(quiz, userId);

    // Check data size
    const dataSize = JSON.stringify(row).length;
    if (dataSize > 2000000) {
      return { success: false, error: new Error('Quiz quá lớn (>2MB)') };
    }

    // Create mutation context
    const context = createMutationContext(userId, quiz.id, 'update_quiz');

    // Apply optimistic update
    onOptimisticUpdate?.(quiz, 'update');

    // Record in mutation log with snapshot for rollback
    mutationLog.record({
      context,
      operation: 'update_quiz',
      entityType: 'quiz',
      entityId: quiz.id,
      payload: row,
      optimisticSnapshot: previousQuiz, // Store previous state for rollback
      status: 'pending',
    });

    // Execute with retry
    const result = await mutationExecutor.execute(
      context,
      async () => {
        const timeoutMs = quiz.questions.length > 50 ? 120000 : 60000;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
        );

        const upsertPromise = supabase.from('quizzes').upsert(row, { onConflict: 'id' });
        return await Promise.race([upsertPromise, timeoutPromise]);
      },
      {
        maxRetries: 2,
        timeoutMs: quiz.questions.length > 50 ? 120000 : 60000,
      }
    );

    if (result.success) {
      mutationLog.acknowledge(context.mutationId, result.data);
      invalidationManager.invalidate('update_quiz', { entityId: quiz.id });
      return { success: true };
    } else {
      // Rollback to previous state
      mutationLog.rollback(context.mutationId, () => {
        onRollback?.(quiz.id, 'update');
      });
      mutationLog.fail(context.mutationId, result.error?.message || 'Unknown error');
      return { success: false, error: result.error };
    }
  }, [userId, onOptimisticUpdate, onRollback]);

  /**
   * DELETE QUIZ (Soft Delete) - With optimistic update
   */
  const deleteQuiz = useCallback(async (
    quizId: string,
    currentQuiz: Quiz
  ): Promise<{ success: boolean; error?: Error }> => {
    if (!userId) {
      return { success: false, error: new Error('Unauthorized') };
    }

    const context = createMutationContext(userId, quizId, 'delete_quiz');
    const deletedAt = new Date().toISOString();

    // Optimistic: mark as deleted locally
    onOptimisticUpdate?.({ ...currentQuiz, deletedAt }, 'delete');

    mutationLog.record({
      context,
      operation: 'delete_quiz',
      entityType: 'quiz',
      entityId: quizId,
      payload: { deleted_at: deletedAt },
      optimisticSnapshot: currentQuiz,
      status: 'pending',
    });

    const result = await mutationExecutor.execute(
      context,
      async () => {
        return await supabase
          .from('quizzes')
          .update({ deleted_at: deletedAt })
          .eq('id', quizId);
      },
      { maxRetries: 2, timeoutMs: 30000 }
    );

    if (result.success) {
      mutationLog.acknowledge(context.mutationId, result.data);
      invalidationManager.invalidate('delete_quiz', { entityId: quizId });
      return { success: true };
    } else {
      mutationLog.rollback(context.mutationId, () => {
        onRollback?.(quizId, 'delete');
      });
      mutationLog.fail(context.mutationId, result.error?.message || 'Unknown error');
      return { success: false, error: result.error };
    }
  }, [userId, onOptimisticUpdate, onRollback]);

  /**
   * RESTORE QUIZ - Undo soft delete
   */
  const restoreQuiz = useCallback(async (
    quizId: string,
    currentQuiz: Quiz
  ): Promise<{ success: boolean; error?: Error }> => {
    if (!userId) {
      return { success: false, error: new Error('Unauthorized') };
    }

    const context = createMutationContext(userId, quizId, 'restore_quiz');

    // Optimistic: restore locally
    onOptimisticUpdate?.({ ...currentQuiz, deletedAt: undefined }, 'update');

    mutationLog.record({
      context,
      operation: 'restore_quiz',
      entityType: 'quiz',
      entityId: quizId,
      payload: { deleted_at: null },
      optimisticSnapshot: currentQuiz,
      status: 'pending',
    });

    const result = await mutationExecutor.execute(
      context,
      async () => {
        return await supabase
          .from('quizzes')
          .update({ deleted_at: null })
          .eq('id', quizId);
      },
      { maxRetries: 2, timeoutMs: 30000 }
    );

    if (result.success) {
      mutationLog.acknowledge(context.mutationId, result.data);
      invalidationManager.invalidate('update_quiz', { entityId: quizId });
      return { success: true };
    } else {
      mutationLog.rollback(context.mutationId, () => {
        onRollback?.(quizId, 'update');
      });
      mutationLog.fail(context.mutationId, result.error?.message || 'Unknown error');
      return { success: false, error: result.error };
    }
  }, [userId, onOptimisticUpdate, onRollback]);

  /**
   * PERMANENT DELETE - Hard delete
   */
  const permanentDeleteQuiz = useCallback(async (
    quizId: string
  ): Promise<{ success: boolean; error?: Error }> => {
    if (!userId) {
      return { success: false, error: new Error('Unauthorized') };
    }

    const context = createMutationContext(userId, quizId, 'permanent_delete_quiz');

    // Optimistic: remove from UI immediately
    onOptimisticUpdate?.({ id: quizId } as Quiz, 'delete');

    mutationLog.record({
      context,
      operation: 'permanent_delete_quiz',
      entityType: 'quiz',
      entityId: quizId,
      payload: {},
      optimisticSnapshot: null,
      status: 'pending',
    });

    const result = await mutationExecutor.execute(
      context,
      async () => {
        return await supabase.from('quizzes').delete().eq('id', quizId);
      },
      { maxRetries: 2, timeoutMs: 30000 }
    );

    if (result.success) {
      mutationLog.acknowledge(context.mutationId, result.data);
      invalidationManager.invalidate('delete_quiz', { entityId: quizId });
      return { success: true };
    } else {
      onRollback?.(quizId, 'delete');
      mutationLog.fail(context.mutationId, result.error?.message || 'Unknown error');
      return { success: false, error: result.error };
    }
  }, [userId, onOptimisticUpdate, onRollback]);

  /**
   * TOGGLE PUBLISH STATUS
   */
  const togglePublishQuiz = useCallback(async (
    quizId: string,
    isPublic: boolean,
    currentQuiz: Quiz
  ): Promise<{ success: boolean; error?: Error }> => {
    if (!userId) {
      return { success: false, error: new Error('Unauthorized') };
    }

    const context = createMutationContext(userId, quizId, 'toggle_publish_quiz');

    // Optimistic: update UI immediately
    onOptimisticUpdate?.({ ...currentQuiz, isPublic }, 'update');

    mutationLog.record({
      context,
      operation: 'toggle_publish_quiz',
      entityType: 'quiz',
      entityId: quizId,
      payload: { is_public: isPublic },
      optimisticSnapshot: currentQuiz,
      status: 'pending',
    });

    const result = await mutationExecutor.execute(
      context,
      async () => {
        return await supabase
          .from('quizzes')
          .update({ is_public: isPublic })
          .eq('id', quizId);
      },
      { maxRetries: 2, timeoutMs: 30000 }
    );

    if (result.success) {
      mutationLog.acknowledge(context.mutationId, result.data);
      invalidationManager.invalidate('update_quiz', { entityId: quizId });
      return { success: true };
    } else {
      mutationLog.rollback(context.mutationId, () => {
        onRollback?.(quizId, 'update');
      });
      mutationLog.fail(context.mutationId, result.error?.message || 'Unknown error');
      return { success: false, error: result.error };
    }
  }, [userId, onOptimisticUpdate, onRollback]);

  return {
    createQuiz,
    updateQuiz,
    deleteQuiz,
    restoreQuiz,
    permanentDeleteQuiz,
    togglePublishQuiz,
  };
}
