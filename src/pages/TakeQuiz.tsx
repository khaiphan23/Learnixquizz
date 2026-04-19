import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { Button, Spinner, Card } from '../components/ui';
import { v4 as uuidv4 } from 'uuid';
import { Clock, AlertCircle, Hash, FileText, BarChart3, Play, Calendar } from 'lucide-react';

export const TakeQuiz: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { getQuiz, fetchQuizById, addAttempt, fetchAttemptsForQuiz } = useQuizStore();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [guestName, setGuestName] = useState('');
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);
  const [attemptCount, setAttemptCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      if (id) {
        await fetchQuizById(id);
        const attempts = await fetchAttemptsForQuiz(id);
        setAttemptCount(attempts.length);
      }
      setLoading(false);
    };
    load();
  }, [id, fetchQuizById, fetchAttemptsForQuiz]);

  const quiz = getQuiz(id ?? '');

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  if (!quiz) return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center space-y-4">
      <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
      <p className="text-slate-600 dark:text-slate-400">{t.notFound}</p>
      <Button onClick={() => navigate('/')}>{t.backHome}</Button>
    </div>
  );

  const diffLabel: Record<string, string> = { easy: t.easy, medium: t.medium, hard: t.hard };

  if (!started) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Card lớn, bo góc, shadow, căn giữa */}
        <Card className="overflow-hidden shadow-xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-6 text-center">
            <h1 className="text-2xl md:text-3xl font-black text-white">{quiz.title}</h1>
            <div className="flex items-center justify-center gap-2 mt-2 text-indigo-100">
              <Hash className="h-4 w-4" />
              <span className="text-sm font-mono">Mã đề thi: {quiz.shortCode || quiz.id.slice(0, 8).toUpperCase()}</span>
            </div>
          </div>

          {/* Thông tin chi tiết */}
          <div className="p-8 space-y-6">
            {/* Danh sách thông tin */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Thời gian làm bài */}
              <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4">
                <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
                  <Clock className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Thời gian làm bài</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{quiz.duration || quiz.questions.length * 2} phút</p>
                </div>
              </div>

              {/* Số lượng câu hỏi */}
              <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Số lượng câu hỏi</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{quiz.questions.length} câu</p>
                </div>
              </div>

              {/* Loại đề */}
              <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4">
                <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
                  <BarChart3 className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Loại đề</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{diffLabel[quiz.difficulty]}</p>
                </div>
              </div>

              {/* Tổng lượt đã làm */}
              <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4">
                <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
                  <Calendar className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Tổng lượt đã làm</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{attemptCount} lượt</p>
                </div>
              </div>
            </div>

            {/* Guest name input (if not logged in) */}
            {!user && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t.guestName}</label>
                <input
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  placeholder={t.enterName}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <p className="text-xs text-slate-400">{t.playAsGuest}</p>
              </div>
            )}

            {/* Button Bắt đầu luyện tập - full width, cam, bo góc lớn */}
            <button
              onClick={() => setStarted(true)}
              disabled={!user && !guestName.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold text-lg transition-all shadow-lg hover:shadow-xl"
            >
              <Play className="h-5 w-5" />
              <span>Bắt đầu luyện tập</span>
            </button>
          </div>
        </Card>
      </div>
    );
  }

  const q = quiz.questions[currentQ];
  const isLast = currentQ === quiz.questions.length - 1;
  const progress = ((currentQ) / quiz.questions.length) * 100;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const hasEssay = quiz.questions.some(q => q.type === 'essay');
      let score = 0;
      if (!hasEssay) {
        quiz.questions.forEach(q => {
          if (q.type !== 'essay' && answers[q.id] === q.correctAnswerIndex) score++;
        });
        score = (score / quiz.questions.length) * 100;
      }
      const attemptId = uuidv4();
      const attempt = {
        id: attemptId,
        quizId: quiz.id,
        userId: user?.id ?? `guest-${uuidv4()}`,
        userName: user?.name ?? guestName,
        answers,
        score,
        essayGrades: {},
        timestamp: Date.now(),
        status: (hasEssay ? 'pending-grading' : 'completed') as 'completed' | 'pending-grading',
      };
      await addAttempt(attempt);
      navigate(`/result/${quiz.id}`, { state: { attemptId } });
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>{t.question} {currentQ + 1}/{quiz.questions.length}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-600 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Question */}
      <Card className="p-6 space-y-6">
        <div className="space-y-3">
          <p className="text-lg font-semibold text-slate-900 dark:text-white">{q.text}</p>
          {q.imageUrl && <img src={q.imageUrl} alt="" className="max-h-48 rounded-xl object-cover border border-slate-200 dark:border-slate-700" />}
        </div>

        {q.type === 'essay' ? (
          <textarea value={(answers[q.id] as string) ?? ''} onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
            placeholder={t.yourAnswer} rows={5}
            className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
        ) : (
          <div className="space-y-2">
            {q.options.map((opt, oi) => (
              <button key={oi} onClick={() => setAnswers(prev => ({ ...prev, [q.id]: oi }))}
                className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all font-medium text-sm ${answers[q.id] === oi ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-600 hover:border-indigo-300 text-slate-700 dark:text-slate-300'}`}>
                <span className="mr-3 text-xs font-bold text-slate-400">{String.fromCharCode(65 + oi)}.</span>{opt}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setCurrentQ(prev => prev - 1)} disabled={currentQ === 0}>← {lang === 'vi' ? 'Trước' : 'Prev'}</Button>
        {isLast ? (
          <Button isLoading={submitting} onClick={handleSubmit} disabled={answers[q.id] === undefined}>
            {t.submit} ✓
          </Button>
        ) : (
          <Button onClick={() => setCurrentQ(prev => prev + 1)} disabled={answers[q.id] === undefined}>
            {lang === 'vi' ? 'Tiếp' : 'Next'} →
          </Button>
        )}
      </div>

      {/* Question dots */}
      <div className="flex flex-wrap gap-1.5 justify-center">
        {quiz.questions.map((_, i) => (
          <button key={i} onClick={() => setCurrentQ(i)}
            className={`w-7 h-7 rounded-full text-xs font-bold transition-all ${i === currentQ ? 'bg-indigo-600 text-white' : answers[quiz.questions[i].id] !== undefined ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'}`}>
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
};
