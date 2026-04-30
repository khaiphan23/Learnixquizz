// Types for leaderboard/ranking system

export interface QuizPlayCount {
  quizId: string;
  quizTitle: string;
  quizTopic: string;
  authorName: string;
  playCount: number;
  uniquePlayers: number;
  averageScore: number;
}

export interface UserQuizCount {
  userId: string;
  userName: string;
  userEmail: string;
  quizzesPlayed: number;
  totalAttempts: number;
  averageScore: number;
  bestScore: number;
}

export interface CreatorQuizStats {
  userId: string;
  userName: string;
  userEmail: string;
  quizzesCreated: number;
  totalPlays: number;
  uniquePlayers: number;
  averageRating: number;
}

export type LeaderboardType = 'most-played-quizzes' | 'most-active-players' | 'top-creators';

export interface LeaderboardData {
  mostPlayedQuizzes: QuizPlayCount[];
  mostActivePlayers: UserQuizCount[];
  topCreators: CreatorQuizStats[];
  lastUpdated: number;
}
