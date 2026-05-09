/**
 * Hooks Module
 * React hooks for distributed consistency system
 */

export { useQuizMutations } from './useQuizMutations';
export type { UseQuizMutationsOptions } from './useQuizMutations';

export { 
  useUserQuizzes, 
  useQuiz, 
  usePublicQuizzes, 
  useQuizAttempts,
  useQuizCache,
  quizKeys 
} from './useQuizQueries';

export { useRealtimeQuizzes, useRealtimeQuiz } from './useRealtimeQuizzes';

export { useAIGeneration } from './useAIGeneration';

// NOTE: useOfflineAwareMutation and useConcurrencyControl are internal implementation
// details of the mutation system. Use useQuizMutations for quiz operations.
// They remain in the filesystem for potential future use but are not exported.
