export interface User {
  id: string;
  email: string;
  name: string;
  photoURL?: string;
  bio?: string;
  notifications?: {
    email: boolean;
    push: boolean;
    activitySummary: boolean;
  };
  preferences?: {
    theme: 'light' | 'dark' | 'system';
    language: 'vi' | 'en';
  };
}

export type QuestionType = 'multiple-choice' | 'true-false' | 'essay';

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options: string[];
  correctAnswerIndex: number;
  explanation?: string;
  imageUrl?: string;
  sampleAnswer?: string;
}

export interface Quiz {
  id: string;
  title: string;
  description: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  questions: Question[];
  createdAt: number;
  author: string;
  authorId?: string;
  deletedAt?: string;
  isPublic: boolean;
  shortCode?: string;
}

export interface EssayGrade {
  score: number;
  feedback: string;
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  userId?: string;
  userName?: string;
  answers: Record<string, number | string>;
  score: number;
  essayGrades?: Record<string, EssayGrade>;
  timestamp: number;
  status: 'completed' | 'pending-grading';
}
