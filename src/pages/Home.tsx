import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { useQuizStore } from '../store/QuizContext';
import { useLang } from '../store/LangContext';
import { Button } from '../components/ui';
import { QuizCard } from '../components/QuizCard';
import { BookOpen, Sparkles, Users, Zap, ArrowRight, Hash, LogIn } from 'lucide-react';

export const Home: React.FC = () => {
  const { user } = useAuth();
  const { quizzes, getQuizByShortCode } = useQuizStore();
  const { t } = useLang();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);

  const activeQuizzes = quizzes.filter(q => !q.deletedAt);
  const recentQuizzes = activeQuizzes.slice(0, 3);

  const handleJoinByCode = async () => {
    if (!code.trim()) return;
    setCodeLoading(true);
    setCodeError('');
    try {
      const quiz = await getQuizByShortCode(code.trim().toUpperCase());
      if (quiz) { navigate(`/quiz/${quiz.id}`); }
      else { setCodeError(t.notFound); }
    } catch { setCodeError(t.error); }
    setCodeLoading(false);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-16">
      {/* Hero */}
      <div className="text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
          <Sparkles className="h-4 w-4" />AI-Powered Quiz Platform
        </div>
        <h1 className="text-4xl md:text-6xl font-black text-slate-900 dark:text-white leading-tight">
          {t.appName}<span className="text-indigo-600">.</span>
        </h1>
        <p className="text-lg text-slate-500 dark:text-slate-400 max-w-xl mx-auto">{t.tagline}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {user ? (
            <>
              <Button size="lg" onClick={() => navigate('/create')}>
                <Sparkles className="h-5 w-5" />{t.createQuiz}
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/my-quizzes')}>
                {t.myQuizzes}<ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button size="lg" onClick={() => navigate('/register')}>
                {t.register}<ArrowRight className="h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/library')}>
                <BookOpen className="h-4 w-4" />{t.library}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Join by Code */}
      <div className="max-w-md mx-auto">
        <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl p-6 text-white space-y-4">
          <div className="flex items-center gap-2">
            <Hash className="h-5 w-5" />
            <h2 className="font-bold text-lg">{t.joinByCode}</h2>
          </div>
          <div className="flex gap-2">
            {/* Input với icon # bên trái */}
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 font-mono font-bold text-lg select-none">#</span>
              <input
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleJoinByCode()}
                placeholder={t.enterCode}
                maxLength={8}
                className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-white/20 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50 font-mono text-lg tracking-widest uppercase"
              />
            </div>
            {/* Nút Join với icon */}
            <button
              onClick={handleJoinByCode}
              disabled={codeLoading || !code.trim()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-indigo-700 hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed font-bold transition-all"
            >
              {codeLoading ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              <span>{t.join}</span>
            </button>
          </div>
          {codeError && <p className="text-red-200 text-sm">{codeError}</p>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
        {[
          { icon: <BookOpen className="h-6 w-6 text-indigo-600" />, label: t.myQuizzes, value: activeQuizzes.length },
          { icon: <Zap className="h-6 w-6 text-yellow-500" />, label: 'AI', value: '✓' },
          { icon: <Users className="h-6 w-6 text-green-500" />, label: t.leaderboard, value: '✓' },
        ].map((s, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 text-center space-y-2">
            <div className="flex justify-center">{s.icon}</div>
            <p className="text-2xl font-black text-slate-900 dark:text-white">{s.value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Recent quizzes */}
      {user && recentQuizzes.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t.myQuizzes}</h2>
            <button onClick={() => navigate('/my-quizzes')} className="text-sm text-indigo-600 hover:underline flex items-center gap-1">
              {t.myQuizzes} <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {recentQuizzes.map(q => (
              <QuizCard key={q.id} quiz={q} onClick={() => navigate(`/quiz/${q.id}`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
