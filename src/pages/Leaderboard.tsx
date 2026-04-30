import React, { useState, useEffect } from 'react';
import { useQuizStore } from '../store/QuizContext';
import { useLang } from '../store/LangContext';
import { Trophy, Users, BookOpen, Crown, Target, Star, RefreshCw } from 'lucide-react';
import type { QuizPlayCount, UserQuizCount, CreatorQuizStats } from '../types/leaderboard';

type TabType = 'most-played' | 'active-players' | 'top-creators';

export const Leaderboard: React.FC = () => {
  const { t } = useLang();
  const { fetchMostPlayedQuizzes, fetchMostActivePlayers, fetchTopCreators } = useQuizStore();
  
  const [activeTab, setActiveTab] = useState<TabType>('most-played');
  const [loading, setLoading] = useState(true);
  const [mostPlayedQuizzes, setMostPlayedQuizzes] = useState<QuizPlayCount[]>([]);
  const [activePlayers, setActivePlayers] = useState<UserQuizCount[]>([]);
  const [topCreators, setTopCreators] = useState<CreatorQuizStats[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    loadLeaderboardData();
  }, []);

  const loadLeaderboardData = async () => {
    setLoading(true);
    try {
      const [quizzes, players, creators] = await Promise.all([
        fetchMostPlayedQuizzes(10),
        fetchMostActivePlayers(10),
        fetchTopCreators(10)
      ]);
      setMostPlayedQuizzes(quizzes);
      setActivePlayers(players);
      setTopCreators(creators);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshData = () => {
    loadLeaderboardData();
  };

  const getRankColor = (rank: number) => {
    if (rank === 1) return 'bg-yellow-400 text-yellow-900';
    if (rank === 2) return 'bg-slate-300 text-slate-800';
    if (rank === 3) return 'bg-orange-400 text-orange-900';
    return 'bg-indigo-100 text-indigo-700';
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Crown className="w-5 h-5 text-yellow-500" />;
    if (rank <= 3) return <Trophy className="w-5 h-5" />;
    return <span className="font-bold">{rank}</span>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-900 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">
            🏆 Bảng Xếp Hạng
          </h1>
          <p className="text-slate-600 dark:text-slate-300">
            Thống kê thực tế từ dữ liệu người dùng
          </p>
          {lastUpdated && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Cập nhật: {lastUpdated.toLocaleTimeString('vi-VN')}
            </p>
          )}
        </div>

        {/* Refresh Button */}
        <div className="text-center mb-6">
          <button
            onClick={refreshData}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Đang tải...' : 'Làm mới dữ liệu'}
            </span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          <button
            onClick={() => setActiveTab('most-played')}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${
              activeTab === 'most-played'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            Quiz được làm nhiều nhất
          </button>
          <button
            onClick={() => setActiveTab('active-players')}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${
              activeTab === 'active-players'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
            }`}
          >
            <Target className="w-5 h-5" />
            Người làm nhiều quiz nhất
          </button>
          <button
            onClick={() => setActiveTab('top-creators')}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${
              activeTab === 'top-creators'
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
            }`}
          >
            <Star className="w-5 h-5" />
            Top người tạo quiz
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-slate-600 dark:text-slate-300">Đang tải bảng xếp hạng...</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden">
            {/* Most Played Quizzes */}
            {activeTab === 'most-played' && (
              <div className="p-6">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <BookOpen className="w-6 h-6 text-indigo-600" />
                  Quiz được làm nhiều nhất
                </h3>
                {mostPlayedQuizzes.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">Chưa có dữ liệu</p>
                ) : (
                  <div className="space-y-3">
                    {mostPlayedQuizzes.map((quiz, index) => (
                      <div
                        key={quiz.quizId}
                        className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                      >
                        <div className={`w-10 h-10 flex items-center justify-center rounded-full ${getRankColor(index + 1)}`}>
                          {getRankIcon(index + 1)}
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 dark:text-white">{quiz.quizTitle}</h4>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Chủ đề: {quiz.quizTopic} • Tác giả: {quiz.authorName}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-indigo-600">{quiz.playCount}</p>
                          <p className="text-sm text-slate-500">lượt làm</p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">{quiz.uniquePlayers}</p>
                          <p className="text-sm text-slate-500">người chơi</p>
                        </div>
                        <div className="text-right hidden md:block">
                          <p className="text-lg font-semibold text-green-600">{quiz.averageScore}%</p>
                          <p className="text-sm text-slate-500">điểm TB</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Active Players */}
            {activeTab === 'active-players' && (
              <div className="p-6">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <Target className="w-6 h-6 text-indigo-600" />
                  Người làm nhiều quiz nhất
                </h3>
                {activePlayers.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">Chưa có dữ liệu</p>
                ) : (
                  <div className="space-y-3">
                    {activePlayers.map((player, index) => (
                      <div
                        key={player.userId}
                        className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                      >
                        <div className={`w-10 h-10 flex items-center justify-center rounded-full ${getRankColor(index + 1)}`}>
                          {getRankIcon(index + 1)}
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 dark:text-white">{player.userName}</h4>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Đã làm {player.quizzesPlayed} quiz khác nhau
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-indigo-600">{player.totalAttempts}</p>
                          <p className="text-sm text-slate-500">tổng lượt</p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-lg font-semibold text-green-600">{player.averageScore}%</p>
                          <p className="text-sm text-slate-500">điểm TB</p>
                        </div>
                        <div className="text-right hidden md:block">
                          <p className="text-lg font-semibold text-yellow-600">{player.bestScore}%</p>
                          <p className="text-sm text-slate-500">điểm cao nhất</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Top Creators */}
            {activeTab === 'top-creators' && (
              <div className="p-6">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <Star className="w-6 h-6 text-indigo-600" />
                  Top người tạo quiz (nhiều người làm nhất)
                </h3>
                {topCreators.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">Chưa có dữ liệu</p>
                ) : (
                  <div className="space-y-3">
                    {topCreators.map((creator, index) => (
                      <div
                        key={creator.userId}
                        className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                      >
                        <div className={`w-10 h-10 flex items-center justify-center rounded-full ${getRankColor(index + 1)}`}>
                          {getRankIcon(index + 1)}
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900 dark:text-white">{creator.userName}</h4>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Đã tạo {creator.quizzesCreated} quiz công khai
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-indigo-600">{creator.totalPlays}</p>
                          <p className="text-sm text-slate-500">tổng lượt làm</p>
                        </div>
                        <div className="text-right hidden sm:block">
                          <p className="text-lg font-semibold text-blue-600">{creator.uniquePlayers}</p>
                          <p className="text-sm text-slate-500">người chơi</p>
                        </div>
                        <div className="text-right hidden md:block">
                          <p className="text-lg font-semibold text-purple-600">
                            {creator.quizzesCreated > 0 ? Math.round(creator.totalPlays / creator.quizzesCreated) : 0}
                          </p>
                          <p className="text-sm text-slate-500">lượt/quiz</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Leaderboard;
