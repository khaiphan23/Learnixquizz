import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { useLang } from '../store/LangContext';
import { Button, Spinner } from '../components/ui';
import { getAIExplanation, gradeEssayAI } from '../services/geminiService';
import { CheckCircle, XCircle, BrainCircuit, RefreshCcw, Home as HomeIcon, Loader2, AlignLeft, Trophy } from 'lucide-react';
import { EssayGrade, QuizAttempt } from '../types';
import { supabase } from '../services/supabase';

export const QuizResult: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { getQuiz, attempts, updateAttempt, fetchAttemptsForQuiz } = useQuizStore();
  const { t } = useLang();
  const attemptId = state?.attemptId;
  const [localAttempt, setLocalAttempt] = useState<QuizAttempt | null>(null);
  const [leaderboard, setLeaderboard] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const quiz = getQuiz(id ?? '');
  const currentAttempt = localAttempt ?? attempts.find(a => a.id === attemptId);
  const [loadingExplanation, setLoadingExplanation] = useState<string | null>(null);
  const [aiExplanations, setAiExplanations] = useState<Record<string, string>>({});
  const [gradingProgress, setGradingProgress] = useState<{ current: number; total: number } | null>(null);
  const gradingStartedRef = useRef(false);

  useEffect(() => {
    const loadData = async () => {
      if (!id) return;
      if (attemptId && !attempts.find(a => a.id === attemptId)) {
        const { data } = await supabase.from('attempts').select('*').eq('id', attemptId).single();
        if (data) setLocalAttempt({ id: data.id, quizId: data.quiz_id, userId: data.user_id ?? undefined, userName: data.user_name ?? undefined, answers: data.answers, score: data.score, essayGrades: data.essay_grades ?? {}, timestamp: data.timestamp, status: data.status });
      }
      try {
        const all = await fetchAttemptsForQuiz(id);
        const userBestMap = new Map<string, QuizAttempt>();
        all.forEach(att => { if (!att.userId) return; const existing = userBestMap.get(att.userId); if (!existing || att.score > existing.score) userBestMap.set(att.userId, att); });
        setLeaderboard(Array.from(userBestMap.values()).sort((a, b) => b.score - a.score).slice(0, 5));
      } catch (e) { console.error('Failed to fetch attempts:', e); }
      setLoading(false);
    };
    loadData();
  }, [id, attemptId, attempts, fetchAttemptsForQuiz]);

  useEffect(() => {
    const gradeEssays = async () => {
      if (!currentAttempt || !quiz || currentAttempt.status === 'completed' || gradingStartedRef.current) return;
      gradingStartedRef.current = true;
      const essayQs = quiz.questions.filter(q => q.type === 'essay');
      if (!essayQs.length) return;
      setGradingProgress({ current: 0, total: essayQs.length });
      const newGrades: Record<string, EssayGrade> = { ...(currentAttempt.essayGrades ?? {}) };
      for (let i = 0; i < essayQs.length; i++) {
        const q = essayQs[i]; const answer = currentAttempt.answers[q.id];
        if (typeof answer === 'string' && !newGrades[q.id]) {
          newGrades[q.id] = await gradeEssayAI(q.text, answer, q.sampleAnswer);
          setGradingProgress({ current: i + 1, total: essayQs.length });
        }
      }
      let totalPoints = 0;
      quiz.questions.forEach(q => { if (q.type === 'essay') { if (newGrades[q.id]) totalPoints += newGrades[q.id].score / 100; } else { if (currentAttempt.answers[q.id] === q.correctAnswerIndex) totalPoints += 1; } });
      const finalScore = (totalPoints / quiz.questions.length) * 100;
      const updates = { essayGrades: newGrades, score: finalScore, status: 'completed' as const };
      await updateAttempt(currentAttempt.id, updates);
      if (localAttempt) setLocalAttempt(prev => prev ? { ...prev, ...updates } : null);
      setGradingProgress(null);
    };
    gradeEssays();
  }, [currentAttempt, quiz, updateAttempt, localAttempt]);

  if (loading || !quiz || !currentAttempt) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  const isGrading = currentAttempt.status === 'pending-grading' || gradingProgress !== null;
  const sc = currentAttempt.score;
  const scoreColor = sc >= 80 ? 'text-green-600' : sc >= 50 ? 'text-yellow-600' : 'text-red-600';
  const scoreBg = sc >= 80 ? 'bg-green-100 dark:bg-green-900/30' : sc >= 50 ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-red-100 dark:bg-red-900/30';

  const fetchExplanation = async (qid: string) => {
    if (aiExplanations[qid]) return;
    setLoadingExplanation(qid);
    const q = quiz.questions.find(qu => qu.id === qid);
    if (q) { const userAns = currentAttempt.answers[q.id] as number; const exp = await getAIExplanation(q.text, q.options[userAns], q.options[q.correctAnswerIndex]); setAiExplanations(prev => ({ ...prev, [qid]: exp })); }
    setLoadingExplanation(null);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8 pb-12">
      <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-md text-center space-y-4">
        {isGrading ? (
          <div className="py-8 space-y-3">
            <Loader2 className="h-12 w-12 animate-spin text-indigo-600 mx-auto" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t.aiGrading}</h1>
            {gradingProgress && <p className="text-slate-500">{gradingProgress.current}/{gradingProgress.total}</p>}
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">{t.lang === 'vi' ? 'Hoàn thành!' : 'Complete!'}</h1>
            <div className={`inline-flex items-center justify-center w-32 h-32 rounded-full ${scoreBg} ${scoreColor} text-4xl font-black`}>{Math.round(sc)}%</div>
            <p className="text-slate-500 dark:text-slate-400">{t.score}: <span className="font-bold text-slate-900 dark:text-white">{Math.round(sc)}%</span></p>
            <div className="flex justify-center gap-3 pt-2">
              <Button variant="outline" onClick={() => navigate('/')}><HomeIcon className="h-4 w-4" />{t.backHome}</Button>
              <Button onClick={() => navigate(`/quiz/${quiz.id}`)}><RefreshCcw className="h-4 w-4" />{t.retake}</Button>
            </div>
          </>
        )}
      </div>

      {!isGrading && leaderboard.length > 0 && (
        <div className="bg-gradient-to-br from-indigo-900 to-violet-900 rounded-2xl p-6 text-white space-y-4">
          <div className="flex items-center gap-2"><Trophy className="h-5 w-5 text-yellow-400" /><h2 className="font-bold text-lg">{t.leaderboard}</h2></div>
          <div className="space-y-2">
            {leaderboard.map((entry, idx) => (
              <div key={idx} className={`flex items-center justify-between p-3 rounded-xl ${entry.id === currentAttempt.id ? 'bg-white/20 border border-white/30' : 'bg-white/10'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 flex items-center justify-center rounded-full font-bold text-sm ${idx === 0 ? 'bg-yellow-400 text-yellow-900' : idx === 1 ? 'bg-slate-300 text-slate-800' : idx === 2 ? 'bg-orange-400 text-orange-900' : 'bg-indigo-700 text-white'}`}>{idx + 1}</div>
                  <span className="font-medium truncate max-w-[150px]">{entry.userName ?? t.lang === 'vi' ? 'Ẩn danh' : 'Anonymous'}</span>
                  {entry.id === currentAttempt.id && <span className="text-xs bg-indigo-500 px-2 py-0.5 rounded text-white">{t.you}</span>}
                </div>
                <span className="font-bold">{Math.round(entry.score)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white text-lg">{t.results}</h2>
        {quiz.questions.map(q => {
          const answer = currentAttempt.answers[q.id];
          if (q.type === 'essay') {
            const grade = currentAttempt.essayGrades?.[q.id];
            return (
              <div key={q.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <AlignLeft className="h-5 w-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <p className="font-semibold text-slate-900 dark:text-white">{q.text}</p>
                    <div className="bg-slate-50 dark:bg-slate-700 p-3 rounded-lg text-sm text-slate-700 dark:text-slate-300">{answer as string}</div>
                    {grade ? (
                      <div className={`p-3 rounded-lg text-sm border ${grade.score >= 70 ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800 text-green-900 dark:text-green-200' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-100 dark:border-yellow-800 text-yellow-900 dark:text-yellow-200'}`}>
                        <div className="flex justify-between mb-1"><span className="font-bold flex items-center gap-1"><BrainCircuit className="h-3.5 w-3.5" />AI {t.feedback}</span><span className="font-bold">{grade.score}/100</span></div>
                        <p>{grade.feedback}</p>
                      </div>
                    ) : <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{t.aiGrading}</div>}
                  </div>
                </div>
              </div>
            );
          }
          const userIdx = answer as number;
          const isCorrect = userIdx === q.correctAnswerIndex;
          return (
            <div key={q.id} className={`bg-white dark:bg-slate-800 rounded-xl border p-5 space-y-3 ${isCorrect ? 'border-slate-200 dark:border-slate-700' : 'border-red-200 dark:border-red-800'}`}>
              <div className="flex items-start gap-3">
                {isCorrect ? <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" /> : <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />}
                <div className="flex-1 space-y-2">
                  <p className="font-semibold text-slate-900 dark:text-white">{q.text}</p>
                  <div className={`flex items-center gap-2 p-2 rounded-lg text-sm ${isCorrect ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'}`}>
                    <span className="font-semibold w-20 flex-shrink-0">{t.yourAnswer}:</span><span>{q.options[userIdx]}</span>
                  </div>
                  {!isCorrect && (
                    <div className="flex items-center gap-2 p-2 rounded-lg text-sm bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200">
                      <span className="font-semibold w-20 flex-shrink-0">{t.correctAnswer}:</span><span>{q.options[q.correctAnswerIndex]}</span>
                    </div>
                  )}
                  {!isCorrect && !aiExplanations[q.id] && (
                    <button onClick={() => fetchExplanation(q.id)} disabled={loadingExplanation === q.id}
                      className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                      {loadingExplanation === q.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
                      {t.lang === 'vi' ? 'Hỏi AI tại sao tôi sai' : 'Ask AI why I was wrong'}
                    </button>
                  )}
                  {aiExplanations[q.id] && (
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg text-sm text-indigo-900 dark:text-indigo-200 flex gap-2">
                      <BrainCircuit className="h-4 w-4 text-indigo-600 flex-shrink-0 mt-0.5" /><p>{aiExplanations[q.id]}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
