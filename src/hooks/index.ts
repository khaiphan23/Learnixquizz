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

export { useOfflineAwareMutation } from './useOfflineAwareMutation';

export { useConcurrencyControl } from './useConcurrencyControl';

export { useAIGeneration } from './useAIGeneration';
