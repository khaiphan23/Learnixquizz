import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { Card, Button, Spinner } from '../components/ui';
import { Trophy, Users, BarChart3, ArrowLeft, TrendingUp, User } from 'lucide-react';
import type { QuizAttempt } from '../types';

export const QuizStats: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getQuiz, fetchAttemptsForQuiz } = useQuizStore();
  const { user } = useAuth();
  const { t, lang } = useLang();

  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);

  const quiz = getQuiz(id ?? '');

  useEffect(() => {
    const load = async () => {
      if (id) {
        const data = await fetchAttemptsForQuiz(id);
        // Sort by score descending
        setAttempts(data.sort((a, b) => b.score - a.score));
      }
      setLoading(false);
    };
    load();
  }, [id, fetchAttemptsForQuiz]);

  // Redirect if not quiz creator
  if (!loading && quiz && quiz.authorId && user?.id !== quiz.authorId) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center space-y-4">
        <div className="text-6xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {lang === 'vi' ? 'Không có quyền truy cập' : 'Access Denied'}
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          {lang === 'vi'
            ? 'Chỉ người tạo quiz mới có thể xem thống kê này.'
            : 'Only the quiz creator can view these statistics.'}
        </p>
        <Button onClick={() => navigate('/')} variant="outline">
          ← {t.backHome}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {lang === 'vi' ? 'Không tìm thấy quiz' : 'Quiz not found'}
        </h1>
        <Button onClick={() => navigate('/')} variant="outline">
          ← {t.backHome}
        </Button>
      </div>
    );
  }

  // Calculate statistics
  const totalAttempts = attempts.length;
  const uniqueUsers = new Set(attempts.map(a => a.userId)).size;
  const avgScore = totalAttempts > 0
    ? Math.round(attempts.reduce((sum, a) => sum + a.score, 0) / totalAttempts)
    : 0;

  const getRankBadge = (rank: number) => {
    if (rank === 0) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">🥇 #1</span>;
    if (rank === 1) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">🥈 #2</span>;
    if (rank === 2) return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">🥉 #3</span>;
    return <span className="text-slate-500 font-medium">#{rank + 1}</span>;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => navigate(`/my-quizzes`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">{quiz.title}</h1>
          <p className="text-slate-500 dark:text-slate-400">
            {lang === 'vi' ? 'Thống kê & Bảng xếp hạng' : 'Statistics & Leaderboard'}
          </p>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Tổng lượt làm' : 'Total Attempts'}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{totalAttempts}</p>
          </div>
        </Card>

        <Card className="p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
            <Users className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Người tham gia' : 'Unique Users'}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{uniqueUsers}</p>
          </div>
        </Card>

        <Card className="p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
            <BarChart3 className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Điểm trung bình' : 'Average Score'}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{avgScore}%</p>
          </div>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card className="overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {lang === 'vi' ? 'Bảng xếp hạng' : 'Leaderboard'}
            </h2>
          </div>
        </div>

        {attempts.length === 0 ? (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400">
            <p className="text-4xl mb-3">📊</p>
            <p>{lang === 'vi' ? 'Chưa có lượt làm nào' : 'No attempts yet'}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {attempts.map((attempt, index) => (
              <div
                key={attempt.id}
                className={`p-4 flex items-center justify-between ${
                  index < 3 ? 'bg-gradient-to-r from-yellow-50/50 to-transparent dark:from-yellow-900/10' : ''
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 flex justify-center">
                    {getRankBadge(index)}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                      <User className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">
                        {attempt.userName || (lang === 'vi' ? 'Ẩn danh' : 'Anonymous')}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(attempt.timestamp).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold ${
                    attempt.score >= 80 ? 'text-green-600 dark:text-green-400' :
                    attempt.score >= 60 ? 'text-yellow-600 dark:text-yellow-400' :
                    'text-red-600 dark:text-red-400'
                  }`}>
                    {Math.round(attempt.score)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default QuizStats;
