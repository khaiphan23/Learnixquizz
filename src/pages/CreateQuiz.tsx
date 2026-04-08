import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { Button, Input, Select, Textarea, Card } from '../components/ui';
import { generateQuizAI } from '../services/geminiService';
import { Question, Quiz } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { PlusCircle, Sparkles, Trash2, ChevronDown, ChevronUp, Image } from 'lucide-react';

const emptyQuestion = (): Question => ({
  id: uuidv4(), type: 'multiple-choice', text: '', options: ['', '', '', ''], correctAnswerIndex: 0, explanation: '',
});

export const CreateQuiz: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  // FIX: dùng addQuiz / editQuiz từ context thay vì gọi supabase trực tiếp
  const { addQuiz, editQuiz, getQuiz } = useQuizStore();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const navigate = useNavigate();

  const existing = id ? getQuiz(id) : undefined;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [topic, setTopic] = useState(existing?.topic ?? '');
  const [difficulty, setDifficulty] = useState<Quiz['difficulty']>(existing?.difficulty ?? 'medium');
  const [questions, setQuestions] = useState<Question[]>(existing?.questions ?? [emptyQuestion()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [showAI, setShowAI] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiNum, setAiNum] = useState(5);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!user) { navigate('/login'); return null; }

  const updateQuestion = (idx: number, updates: Partial<Question>) => {
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q));
  };
  const removeQuestion = (idx: number) => setQuestions(prev => prev.filter((_, i) => i !== idx));
  const addQuestion = () => setQuestions(prev => [...prev, emptyQuestion()]);

  const generateAI = async () => {
    if (!aiTopic.trim()) return;
    setAiGenerating(true); setAiError('');
    try {
      const generated = await generateQuizAI(aiTopic, aiNum, difficulty, lang);
      setQuestions(prev => [...prev.filter(q => q.text.trim()), ...generated.map(q => ({ ...q, id: uuidv4() }))]);
      if (!title) setTitle(aiTopic);
      if (!topic) setTopic(aiTopic);
      setShowAI(false);
    } catch (e: any) { setAiError(e.message); }
    setAiGenerating(false);
  };

  const handleSave = async () => {
    if (!title.trim()) { setError(lang === 'vi' ? 'Vui lòng nhập tiêu đề' : 'Please enter a title'); return; }
    if (questions.some(q => !q.text.trim())) { setError(lang === 'vi' ? 'Vui lòng nhập nội dung tất cả câu hỏi' : 'Please fill all questions'); return; }
    if (!user) { setError('Không tìm thấy user — vui lòng đăng nhập lại'); return; }

    setSaving(true);
    setError('');

    try {
      const shortCode = existing?.shortCode ?? Math.random().toString(36).substring(2, 8).toUpperCase();
      const quiz: Quiz = {
        id: existing?.id ?? uuidv4(),
        title: title.trim(),
        description: description.trim(),
        topic: topic.trim() || 'Chung',
        difficulty,
        questions,
        createdAt: existing?.createdAt ?? Date.now(),
        author: user.name,
        authorId: user.id,
        deletedAt: undefined,
        isPublic: existing?.isPublic ?? false,
        shortCode,
      };

      // FIX: dùng addQuiz/editQuiz từ context — có optimistic update
      // quiz xuất hiện ngay ở MyQuizzes khi navigate, không cần reload
      if (existing) {
        await editQuiz(quiz);
      } else {
        await addQuiz(quiz);
      }

      navigate('/my-quizzes');
    } catch (e: any) {
      setError(`Lỗi: ${e.message}`);
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">{existing ? t.editQuiz : t.createQuiz}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>{t.cancel}</Button>
          <Button size="sm" isLoading={saving} onClick={handleSave}>{t.save}</Button>
        </div>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-xl p-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

      <Card className="p-6 space-y-4">
        <Input label={t.title} value={title} onChange={e => setTitle(e.target.value)} placeholder={lang === 'vi' ? 'Tiêu đề quiz...' : 'Quiz title...'} />
        <Textarea label={t.description} value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder={lang === 'vi' ? 'Mô tả (tuỳ chọn)...' : 'Description (optional)...'} />
        <div className="grid grid-cols-2 gap-4">
          <Input label={t.topic} value={topic} onChange={e => setTopic(e.target.value)} placeholder={lang === 'vi' ? 'Toán, Lý, Sử...' : 'Math, Science...'} />
          <Select label={t.difficulty} value={difficulty} onChange={e => setDifficulty(e.target.value as Quiz['difficulty'])}
            options={[{ value: 'easy', label: t.easy }, { value: 'medium', label: t.medium }, { value: 'hard', label: t.hard }]} />
        </div>
      </Card>

      <Card className="p-6 space-y-4 border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10">
        <button onClick={() => setShowAI(!showAI)} className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-semibold">
            <Sparkles className="h-5 w-5" />{t.createAI}
          </div>
          {showAI ? <ChevronUp className="h-4 w-4 text-indigo-400" /> : <ChevronDown className="h-4 w-4 text-indigo-400" />}
        </button>
        {showAI && (
          <div className="space-y-3">
            {aiError && <div className="text-sm text-red-600">{aiError}</div>}
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{lang === 'vi' ? 'Chủ đề' : 'Topic'}</label>
                <input value={aiTopic} onChange={e => setAiTopic(e.target.value)}
                  placeholder={lang === 'vi' ? 'Chủ đề muốn tạo...' : 'Topic to generate...'}
                  onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && generateAI()}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
              </div>
              <div className="w-28">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.numQuestions}</label>
                <input type="number" value={aiNum} onChange={e => setAiNum(Number(e.target.value))} min={1} max={20}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
              </div>
            </div>
            <Button onClick={generateAI} isLoading={aiGenerating} className="w-full bg-indigo-600">
              <Sparkles className="h-4 w-4" />{aiGenerating ? t.generating : t.generateAI}
            </Button>
          </div>
        )}
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900 dark:text-white">{questions.length} {t.questions}</h2>
          <Button size="sm" variant="outline" onClick={addQuestion}><PlusCircle className="h-4 w-4" />{t.addQuestion}</Button>
        </div>

        {questions.map((q, idx) => (
          <Card key={q.id} className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">{idx + 1}</span>
                <button onClick={() => setCollapsed(prev => ({ ...prev, [q.id]: !prev[q.id] }))} className="text-xs text-slate-400 hover:text-slate-600">
                  {collapsed[q.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </button>
                <select value={q.type} onChange={e => updateQuestion(idx, {
                  type: e.target.value as Question['type'],
                  options: e.target.value === 'true-false' ? (lang === 'vi' ? ['Đúng', 'Sai'] : ['True', 'False']) : (q.options.length === 4 ? q.options : ['', '', '', '']),
                  correctAnswerIndex: 0
                })} className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  <option value="multiple-choice">{t.multipleChoice}</option>
                  <option value="true-false">{t.trueFalse}</option>
                  <option value="essay">{t.essay}</option>
                </select>
              </div>
              <button onClick={() => removeQuestion(idx)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"><Trash2 className="h-4 w-4" /></button>
            </div>

            {!collapsed[q.id] && (
              <div className="space-y-3">
                <Textarea value={q.text} onChange={e => updateQuestion(idx, { text: e.target.value })} placeholder={lang === 'vi' ? 'Nội dung câu hỏi...' : 'Question text...'} rows={2} />
                <div className="flex gap-2">
                  <Image className="h-4 w-4 text-slate-400 mt-2.5 flex-shrink-0" />
                  <input value={q.imageUrl ?? ''} onChange={e => updateQuestion(idx, { imageUrl: e.target.value || undefined })}
                    placeholder={t.imageUrl}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                {q.imageUrl && (
                  <img src={q.imageUrl} alt="preview" className="rounded-xl max-h-48 object-cover border border-slate-200 dark:border-slate-600"
                    onError={e => (e.currentTarget.style.display = 'none')} />
                )}
                {q.type !== 'essay' ? (
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input type="radio" checked={q.correctAnswerIndex === oi}
                          onChange={() => updateQuestion(idx, { correctAnswerIndex: oi })}
                          className="accent-indigo-600 w-4 h-4 flex-shrink-0" />
                        <input value={opt} onChange={e => {
                          const newOptions = [...q.options]; newOptions[oi] = e.target.value;
                          updateQuestion(idx, { options: newOptions });
                        }} placeholder={`${t.option} ${oi + 1}`} disabled={q.type === 'true-false'}
                          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Textarea label={t.sampleAnswer} value={q.sampleAnswer ?? ''} onChange={e => updateQuestion(idx, { sampleAnswer: e.target.value })} rows={2}
                    placeholder={lang === 'vi' ? 'Đáp án mẫu (dùng để AI chấm điểm)...' : 'Sample answer (used for AI grading)...'} />
                )}
                <Input label={t.explanation} value={q.explanation ?? ''} onChange={e => updateQuestion(idx, { explanation: e.target.value })}
                  placeholder={lang === 'vi' ? 'Giải thích đáp án (tuỳ chọn)...' : 'Explanation (optional)...'} />
              </div>
            )}
          </Card>
        ))}

        <Button variant="outline" onClick={addQuestion} className="w-full">
          <PlusCircle className="h-4 w-4" />{t.addQuestion}
        </Button>
      </div>
    </div>
  );
};
