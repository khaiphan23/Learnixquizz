import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { Button, Spinner, Card } from '../components/ui';
import { v4 as uuidv4 } from 'uuid';
import { BookOpen, Clock, BarChart2, AlertCircle } from 'lucide-react';

export const TakeQuiz: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { getQuiz, fetchQuizById, addAttempt } = useQuizStore();
  const { user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [guestName, setGuestName] = useState('');
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);

  useEffect(() => {
    const load = async () => {
      if (id) await fetchQuizById(id);
      setLoading(false);
    };
    load();
  }, [id, fetchQuizById]);

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
      <div className="max-w-lg mx-auto px-4 py-12 space-y-6">
        <Card className="p-8 space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">{quiz.title}</h1>
            {quiz.description && <p className="text-slate-500 dark:text-slate-400">{quiz.description}</p>}
          </div>
          <div className="flex justify-center gap-6 text-sm text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-indigo-500" />{quiz.questions.length} {t.questions}</span>
            <span className="flex items-center gap-1.5"><BarChart2 className="h-4 w-4 text-yellow-500" />{diffLabel[quiz.difficulty]}</span>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-green-500" />{quiz.topic}</span>
          </div>
          {!user && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 text-left">{t.guestName}</label>
              <input value={guestName} onChange={e => setGuestName(e.target.value)}
                placeholder={t.enterName}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <p className="text-xs text-slate-400 text-left">{t.playAsGuest}</p>
            </div>
          )}
          <Button size="lg" className="w-full" onClick={() => setStarted(true)} disabled={!user && !guestName.trim()}>
            {t.startQuiz}
          </Button>
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
    } catch (e) { console.error(e); }
    setSubmitting(false);
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
        <Button variant="outline" onClick={() => setCurrentQ(prev => prev - 1)} disabled={currentQ === 0}>← {t.lang === 'vi' ? 'Trước' : 'Prev'}</Button>
        {isLast ? (
          <Button isLoading={submitting} onClick={handleSubmit} disabled={answers[q.id] === undefined}>
            {t.submit} ✓
          </Button>
        ) : (
          <Button onClick={() => setCurrentQ(prev => prev + 1)} disabled={answers[q.id] === undefined}>
            {t.lang === 'vi' ? 'Tiếp' : 'Next'} →
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
