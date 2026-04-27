import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { Button, Input, Select, Textarea, Card } from '../components/ui';
import { generateQuizAI, generateQuestionsFromContent } from '../services/geminiService';
import { extractTextFromFile } from '../services/fileParser';
import { uploadImage, fileToBase64 } from '../services/imageUploadService';
import { Question, Quiz } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { PlusCircle, Sparkles, Trash2, ChevronDown, ChevronUp, Image, Upload, FileText, Clipboard } from 'lucide-react';

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
  const [duration, setDuration] = useState(existing?.duration ?? 15);
  const [questions, setQuestions] = useState<Question[]>(existing?.questions ?? [emptyQuestion()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [showAI, setShowAI] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiNum, setAiNum] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState<Quiz['difficulty']>('medium');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Content generation states
  const [contentSource, setContentSource] = useState<'paste' | 'upload'>('paste');
  const [pastedText, setPastedText] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [genError, setGenError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  
  // Image upload states per question
  const [uploadingImages, setUploadingImages] = useState<Record<string, boolean>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});

  if (!user) { navigate('/login'); return null; }
  
  // Handle image upload for a question
  const handleImageUpload = async (idx: number, file: File) => {
    const questionId = questions[idx]?.id;
    if (!questionId || !user) return;
    
    setUploadingImages(prev => ({ ...prev, [questionId]: true }));
    setImageErrors(prev => ({ ...prev, [questionId]: '' }));
    
    try {
      // Validate file
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
        throw new Error('Chỉ chấp nhận file: JPG, PNG, GIF, WebP');
      }
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('File quá lớn (tối đa 5MB)');
      }
      
      // Upload to Supabase
      const { url } = await uploadImage(file, user.id);
      
      // Update question with image URL
      updateQuestion(idx, { imageUrl: url });
    } catch (error: any) {
      console.error('[handleImageUpload] Error:', error);
      setImageErrors(prev => ({ ...prev, [questionId]: error.message }));
    } finally {
      setUploadingImages(prev => ({ ...prev, [questionId]: false }));
    }
  };
  
  // Handle image file selection
  const handleImageFileChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(idx, file);
    }
  };

  const updateQuestion = (idx: number, updates: Partial<Question>) => {
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, ...updates } : q));
  };
  const removeQuestion = (idx: number) => setQuestions(prev => prev.filter((_, i) => i !== idx));
  const addQuestion = () => setQuestions(prev => [...prev, emptyQuestion()]);

  const generateAI = async () => {
    if (!aiTopic.trim()) return;
    setAiGenerating(true); setAiError('');
    try {
      const generated = await generateQuizAI(aiTopic, aiNum, aiDifficulty, lang);
      setQuestions(prev => [...prev.filter(q => q.text.trim()), ...generated.map(q => ({ ...q, id: uuidv4() }))]);
      if (!title) setTitle(aiTopic);
      if (!topic) setTopic(aiTopic);
      setShowAI(false);
    } catch (e: any) { setAiError(e.message); }
    setAiGenerating(false);
  };

  // Handle file selection
  // Reset file-related state when switching to paste mode
  const handleSourceChange = (source: 'paste' | 'upload') => {
    setContentSource(source);
    if (source === 'paste') {
      setUploadedFile(null);
      setExtractedText('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      setUploadedFile(file);
      setExtractedText('');
      setGenError('');
    }
  };

  // Extract text from uploaded file and auto-generate questions
  const extractText = async () => {
    if (!uploadedFile) return;
    setIsExtracting(true);
    setGenError('');
    try {
      const text = await extractTextFromFile(uploadedFile);
      setExtractedText(text);
      setShowPreview(true);
      // Auto-generate questions after successful extraction
      await autoGenerateFromContent(text);
    } catch (err: any) {
      setGenError(err.message);
      setExtractedText('');
    } finally {
      setIsExtracting(false);
    }
  };

  // Auto-generate from extracted/pasted content - AI auto-detects all questions
  const autoGenerateFromContent = async (content: string) => {
    setGenError('');
    if (!content.trim()) {
      setGenError(lang === 'vi' ? `Vui lòng nhập nội dung hoặc trích xuất từ file` : `Please enter or extract content first`);
      return;
    }

    setAiGenerating(true);
    try {
      // AI tự động phân tích và trích xuất tất cả câu hỏi từ nội dung
      const generated = await generateQuestionsFromContent(content, lang);
      setQuestions(prev => [...prev.filter(q => q.text.trim()), ...generated.map(q => ({ ...q, id: uuidv4() }))]);
      // Optional: fill quiz details from content
      if (!topic) setTopic(content.substring(0, 50) + (content.length > 50 ? '...' : ''));
    } catch (e: any) {
      setGenError(e.message);
    } finally {
      setAiGenerating(false);
    }
  };

  // Generate questions from pasted content (manual trigger)
  const generateFromContent = async () => {
    const content = contentSource === 'paste' ? pastedText : extractedText;
    await autoGenerateFromContent(content);
  };

  const handleSave = async () => {
    if (!title.trim()) { setError(lang === 'vi' ? 'Vui lòng nhập tiêu đề' : 'Please enter a title'); return; }
    if (questions.some(q => !q.text.trim())) { setError(lang === 'vi' ? 'Vui lòng nhập nội dung tất cả câu hỏi' : 'Please fill all questions'); return; }
    if (!user) { setError('Không tìm thấy user — vui lòng đăng nhập lại'); return; }

    setSaving(true);
    setError('');

    try {
      const shortCode = existing?.shortCode ?? Math.random().toString(36).substring(2, 8).toUpperCase();
      
      // Ensure each question has a unique ID before saving
      const processedQuestions = questions.map((q, idx) => ({
        ...q,
        id: q.id && q.id.trim() ? q.id : uuidv4(),
        // Ensure correctAnswerIndex is valid
        correctAnswerIndex: Math.max(0, Math.min(q.correctAnswerIndex || 0, (q.options?.length || 1) - 1))
      }));
      
      const quiz: Quiz = {
        id: existing?.id ?? uuidv4(),
        title: title.trim(),
        description: description.trim(),
        topic: topic.trim() || 'Chung',
        difficulty,
        questions: processedQuestions,
        createdAt: existing?.createdAt ?? Date.now(),
        author: user.name,
        authorId: user.id,
        deletedAt: undefined,
        isPublic: existing?.isPublic ?? false,
        shortCode,
        duration,
      };

      if (existing) {
        await editQuiz(quiz);
      } else {
        await addQuiz(quiz);
      }

      navigate('/my-quizzes');
    } catch (e: any) {
      setError(`Lỗi: ${e.message}`);
    } finally {
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
        <div className="grid grid-cols-3 gap-4">
          <Input label={t.topic} value={topic} onChange={e => setTopic(e.target.value)} placeholder={lang === 'vi' ? 'Toán, Lý, Sử...' : 'Math, Science...'} />
          <Select label={t.difficulty} value={difficulty} onChange={e => setDifficulty(e.target.value as Quiz['difficulty'])}
            options={[{ value: 'easy', label: t.easy }, { value: 'medium', label: t.medium }, { value: 'hard', label: t.hard }]} />
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{lang === 'vi' ? 'Thời gian (phút)' : 'Duration (minutes)'}</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              min={1}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
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
              <div className="w-32">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t.difficulty}</label>
                <select
                  value={aiDifficulty}
                  onChange={e => setAiDifficulty(e.target.value as Quiz['difficulty'])}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                >
                  <option value="easy">{t.easy}</option>
                  <option value="medium">{t.medium}</option>
                  <option value="hard">{t.hard}</option>
                </select>
              </div>
            </div>
            <Button onClick={generateAI} isLoading={aiGenerating} className="w-full bg-indigo-600">
              <Sparkles className="h-4 w-4" />{aiGenerating ? t.generating : t.generateAI}
            </Button>
          </div>
        )}
      </Card>

      {/* Generate from Content Section */}
      <Card className="p-6 space-y-4 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-semibold">
            <FileText className="h-5 w-5" />{t.generateFromContent}
          </div>
        </div>

        {/* Source tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => handleSourceChange('paste')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl border transition-all ${
              contentSource === 'paste'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Clipboard className="h-4 w-4" />{t.pasteContent}
          </button>
          <button
            onClick={() => handleSourceChange('upload')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl border transition-all ${
              contentSource === 'upload'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Upload className="h-4 w-4" />{t.uploadFile}
          </button>
        </div>

        {/* Paste text mode */}
        {contentSource === 'paste' && (
          <div className="space-y-2">
            <Textarea
              value={pastedText}
              onChange={e => setPastedText(e.target.value)}
              placeholder={lang === 'vi' ? 'Dán nội dung bài học, bài viết hoặc văn bản vào đây...' : 'Paste your lesson content, article, or text here...'}
              rows={6}
            />
            {pastedText && (
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                {showPreview ? 'Ẩn' : 'Xem'} {t.previewExtracted}
              </button>
            )}
            {showPreview && pastedText && (
              <div className="max-h-48 overflow-auto bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                {pastedText}
              </div>
            )}
          </div>
        )}

        {/* Upload file mode */}
        {contentSource === 'upload' && (
          <div className="space-y-3">
            {/* Dropzone */}
            <div
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) setUploadedFile(file);
              }}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-6 text-center hover:border-emerald-500 dark:hover:border-emerald-500 transition-colors cursor-pointer"
            >
              <input
                type="file"
                accept=".txt,.md,.rtf,.pdf,.docx"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">{t.dropzonePrompt}</p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">{t.supportedFormats}</p>
              </label>
            </div>

            {uploadedFile && (
              <div className="flex items-center justify-between bg-white dark:bg-slate-700 rounded-lg px-4 py-2 border border-slate-200 dark:border-slate-600">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-emerald-600" />
                  <span className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-xs">{uploadedFile.name}</span>
                  <span className="text-xs text-slate-500">({(uploadedFile.size / 1024).toFixed(1)} KB)</span>
                </div>
                <button
                  onClick={extractText}
                  disabled={isExtracting}
                  className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExtracting ? t.extracting : t.extractText}
                </button>
              </div>
            )}

            {extractedText && (
              <>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {showPreview ? 'Ẩn' : 'Xem'} {t.previewExtracted}
                </button>
                {showPreview && (
                  <div className="max-h-48 overflow-auto bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {extractedText}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* AI will automatically detect all questions from content */}
        <div className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-100/50 dark:bg-emerald-900/20 rounded-xl p-3">
          <p className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {lang === 'vi' 
              ? 'AI sẽ tự động phân tích và trích xuất tất cả câu hỏi từ nội dung (trắc nghiệm, đúng/sai, tự luận) và tự nhận diện đáp án đúng.'
              : 'AI will automatically analyze and extract all questions from content (multiple-choice, true/false, essay) and detect correct answers.'}
          </p>
        </div>

        {/* Error message */}
        {genError && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
            {genError}
          </div>
        )}

        {/* Generate button */}
        <Button
          onClick={generateFromContent}
          isLoading={aiGenerating}
          className="w-full bg-emerald-600 hover:bg-emerald-700"
        >
          <Sparkles className="h-4 w-4" />
          {t.generateFromContentBtn}
        </Button>
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
                <div className="space-y-2">
                  {/* Image source tabs */}
                  <div className="flex gap-2 mb-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 pt-1">{t.image || (lang === 'vi' ? 'Hình ảnh:' : 'Image:')}</span>
                    <label className="flex items-center gap-1 px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors">
                      <Upload className="h-3 w-3" />
                      {t.uploadImage}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        onChange={e => handleImageFileChange(idx, e)}
                        className="hidden"
                        disabled={uploadingImages[q.id]}
                      />
                    </label>
                    <span className="text-xs text-slate-400 pt-1">{t.or}</span>
                  </div>
                  
                  {/* URL input */}
                  <div className="flex gap-2">
                    <Image className="h-4 w-4 text-slate-400 mt-2.5 flex-shrink-0" />
                    <input value={q.imageUrl ?? ''} onChange={e => updateQuestion(idx, { imageUrl: e.target.value || undefined })}
                      placeholder={t.imageUrl || (lang === 'vi' ? 'URL hình ảnh...' : 'Image URL...')}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  
                  {/* Error message */}
                  {imageErrors[q.id] && (
                    <p className="text-xs text-red-500">{imageErrors[q.id]}</p>
                  )}
                  
                  {/* Loading indicator */}
                  {uploadingImages[q.id] && (
                    <p className="text-xs text-indigo-500 flex items-center gap-1">
                      <span className="animate-spin">⏳</span> {t.uploading}
                    </p>
                  )}
                </div>
                
                {/* Image preview */}
                {q.imageUrl && !uploadingImages[q.id] && (
                  <div className="relative">
                    <img src={q.imageUrl} alt="preview" className="rounded-xl max-h-48 object-cover border border-slate-200 dark:border-slate-600"
                      onError={e => (e.currentTarget.style.display = 'none')} />
                    <button
                      onClick={() => updateQuestion(idx, { imageUrl: undefined })}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                      title={t.removeImage}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
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
