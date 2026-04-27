import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase } from '../services/supabase';
import { Quiz, QuizAttempt } from '../types';
import { useAuth } from './AuthContext';

function dbToQuiz(row: any): Quiz {
  return {
    id: row.id, title: row.title, description: row.description,
    topic: row.topic, difficulty: row.difficulty, questions: row.questions,
    createdAt: row.created_at, author: row.author, authorId: row.author_id,
    deletedAt: row.deleted_at ?? undefined, isPublic: row.is_public,
    shortCode: row.short_code ?? undefined,
  };
}

function quizToDb(quiz: Quiz, authorId?: string) {
  return {
    id: quiz.id, title: quiz.title, description: quiz.description,
    topic: quiz.topic ?? 'Chung', difficulty: quiz.difficulty ?? 'medium',
    questions: quiz.questions, created_at: quiz.createdAt,
    author: quiz.author, author_id: authorId ?? quiz.authorId ?? null,
    deleted_at: quiz.deletedAt ?? null, is_public: quiz.isPublic ?? false,
    short_code: quiz.shortCode ?? null,
  };
}

function dbToAttempt(row: any): QuizAttempt {
  return {
    id: row.id, quizId: row.quiz_id, userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined, answers: row.answers, score: row.score,
    essayGrades: row.essay_grades ?? {}, timestamp: row.timestamp, status: row.status,
  };
}

function attemptToDb(attempt: QuizAttempt) {
  return {
    id: attempt.id, quiz_id: attempt.quizId,
    user_id: attempt.userId ?? null, user_name: attempt.userName ?? null,
    answers: attempt.answers, score: attempt.score,
    essay_grades: attempt.essayGrades ?? {}, timestamp: attempt.timestamp,
    status: attempt.status,
  };
}

interface QuizContextType {
  quizzes: Quiz[]; attempts: QuizAttempt[];
  addQuiz: (quiz: Quiz) => Promise<void>;
  editQuiz: (quiz: Quiz) => Promise<void>;
  deleteQuiz: (id: string) => Promise<void>;
  restoreQuiz: (id: string) => Promise<void>;
  permanentDeleteQuiz: (id: string) => Promise<void>;
  deleteAllQuizzesByAuthor: (authorId: string) => Promise<void>;
  togglePublishQuiz: (id: string, isPublic: boolean) => Promise<void>;
  getPublicQuizzes: () => Promise<Quiz[]>;
  importQuiz: (quiz: Quiz) => Promise<void>;
  updateAttempt: (id: string, updates: Partial<QuizAttempt>) => Promise<void>;
  addAttempt: (attempt: QuizAttempt) => Promise<void>;
  getQuiz: (id: string) => Quiz | undefined;
  getQuizByShortCode: (code: string) => Promise<Quiz | undefined>;
  fetchQuizById: (id: string) => Promise<boolean>;
  publishQuiz: (id: string) => Promise<void>;
  getAllAttemptsForQuiz: (quizId: string) => QuizAttempt[];
  fetchAttemptsForQuiz: (quizId: string) => Promise<QuizAttempt[]>;
  isLoading: boolean;
}

const QuizContext = createContext<QuizContextType | undefined>(undefined);

export const QuizProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, isLoading: authLoading } = useAuth();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [publicQuizzes, setPublicQuizzes] = useState<Quiz[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setQuizzes([]); setAttempts([]); setIsLoading(false); return; }

    setIsLoading(true);
    const fetchUserData = async () => {
      try {
        const [{ data: quizData }, { data: attemptData }] = await Promise.all([
          supabase.from('quizzes').select('*').eq('author_id', user.id).order('created_at', { ascending: false }),
          supabase.from('attempts').select('*').eq('user_id', user.id),
        ]);
        setQuizzes((quizData ?? []).map(dbToQuiz));
        setAttempts((attemptData ?? []).map(dbToAttempt));
      } catch (e) {
        console.error('fetchUserData error:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUserData();
  }, [user?.id, authLoading]);

  // FIX LỖI 2: addQuiz giờ dùng optimistic update — thêm vào state TRƯỚC khi insert
  // Nếu insert lỗi thì rollback. Không cần chờ DB để UI cập nhật ngay.
  const addQuiz = async (quiz: Quiz) => {
    if (!user) throw new Error('Bạn cần đăng nhập để lưu quiz');
    
    // Validate quiz data
    if (!quiz.questions || quiz.questions.length === 0) {
      throw new Error('Quiz phải có ít nhất 1 câu hỏi');
    }
    
    const row = quizToDb(quiz, user.id);
    row.author = user.name;

    // Kiểm tra giới hạn câu hỏi
    if (quiz.questions.length > 100) {
      throw new Error(`Quiz quá nhiều câu hỏi (${quiz.questions.length}). Tối đa 100 câu. Vui lòng chia thành nhiều quiz nhỏ hơn.`);
    }

    // Kiểm tra kích thước dữ liệu TRƯỚC khi optimistic update
    const dataSize = JSON.stringify(row).length;
    console.log('[addQuiz] Data size:', (dataSize / 1024).toFixed(2), 'KB', 'Questions:', quiz.questions.length);
    
    if (dataSize > 2000000) { // Tăng lên 2MB
      throw new Error('Quiz quá lớn (>2MB) - vui lòng giảm số câu hỏi hoặc độ dài nội dung');
    }

    // Optimistic: thêm vào đầu list ngay lập tức
    setQuizzes(prev => [quiz, ...prev]);

    console.log('[addQuiz] Inserting quiz:', quiz.id, 'Questions:', quiz.questions.length);
    const startTime = Date.now();
    
    try {
      // Thực hiện insert với timeout (tăng lên 120s cho quiz lớn)
      const timeoutMs = quiz.questions.length > 50 ? 120000 : 60000;
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      );
      
      const insertPromise = supabase.from('quizzes').insert(row);
      
      let result: any;
      try {
        result = await Promise.race([insertPromise, timeoutPromise]) as any;
      } catch (e: any) {
        if (e.message === 'TIMEOUT') {
          console.log('[addQuiz] Timeout after', timeoutMs, 'ms, waiting for actual result...');
          result = await insertPromise;
          console.log('[addQuiz] Operation completed after timeout');
        } else {
          throw e;
        }
      }
      
      const duration = Date.now() - startTime;
      console.log('[addQuiz] Insert completed in', duration, 'ms');
      
      if (result?.error) {
        throw new Error('Lỗi lưu quiz: ' + result.error.message);
      }
    } catch (error: any) {
      // Rollback: xóa quiz khỏi state nếu insert thất bại
      setQuizzes(prev => prev.filter(q => q.id !== quiz.id));
      console.error('[addQuiz] Insert failed, rolled back:', error.message);
      throw error;
    }
  };

  const editQuiz = async (updatedQuiz: Quiz) => {
    if (!user) throw new Error('Bạn cần đăng nhập để cập nhật quiz');
    
    // Validate quiz data
    if (!updatedQuiz.questions || updatedQuiz.questions.length === 0) {
      throw new Error('Quiz phải có ít nhất 1 câu hỏi');
    }
    
    const row = quizToDb(updatedQuiz, user.id);
    
    // Kiểm tra kích thước dữ liệu
    const dataSize = JSON.stringify(row).length;
    console.log('[editQuiz] Data size:', (dataSize / 1024).toFixed(2), 'KB');
    
    if (dataSize > 1000000) {
      throw new Error('Quiz quá lớn (>1MB) - vui lòng giảm số câu hỏi hoặc độ dài nội dung');
    }
    
    // Optimistic update
    setQuizzes(prev => prev.map(q => q.id === updatedQuiz.id ? updatedQuiz : q));
    setPublicQuizzes(prev => prev.map(q => q.id === updatedQuiz.id ? updatedQuiz : q));

    console.log('[editQuiz] Upserting quiz:', updatedQuiz.id, 'Questions:', updatedQuiz.questions.length);
    const startTime = Date.now();
    
    // Thêm timeout 120s cho quiz lớn, 60s cho quiz nhỏ
    const timeoutMs = updatedQuiz.questions.length > 50 ? 120000 : 60000;
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
    );
    
    const upsertPromise = supabase.from('quizzes').upsert(row, { onConflict: 'id' });
    
    let result: any;
    try {
      result = await Promise.race([upsertPromise, timeoutPromise]) as any;
    } catch (e: any) {
      if (e.message === 'TIMEOUT') {
        // Timeout xảy ra - đợi thêm để xem operation có hoàn thành không
        console.log('[editQuiz] Timeout after', timeoutMs, 'ms, waiting for actual result...');
        result = await upsertPromise;
        console.log('[editQuiz] Operation actually completed after timeout');
      } else {
        throw e;
      }
    }
    
    const duration = Date.now() - startTime;
    console.log('[editQuiz] Upsert completed in', duration, 'ms');
    
    if (result?.error) {
      // Không rollback edit vì khó lấy lại state cũ — chỉ log lỗi
      console.error('[editQuiz] Upsert error:', result.error);
      throw new Error('Lỗi cập nhật quiz: ' + result.error.message);
    }
  };

  const deleteQuiz = async (id: string) => {
    const { error } = await supabase.from('quizzes').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    setQuizzes(prev => prev.map(q => q.id === id ? { ...q, deletedAt: new Date().toISOString() } : q));
  };

  const restoreQuiz = async (id: string) => {
    const { error } = await supabase.from('quizzes').update({ deleted_at: null }).eq('id', id);
    if (error) throw new Error(error.message);
    setQuizzes(prev => prev.map(q => q.id === id ? { ...q, deletedAt: undefined } : q));
  };

  const permanentDeleteQuiz = async (id: string) => {
    const { error } = await supabase.from('quizzes').delete().eq('id', id);
    if (error) throw new Error(error.message);
    setQuizzes(prev => prev.filter(q => q.id !== id));
  };

  const deleteAllQuizzesByAuthor = async (authorId: string) => {
    const { error } = await supabase.from('quizzes').delete().eq('author_id', authorId);
    if (error) throw new Error(error.message);
    setQuizzes([]);
  };

  const togglePublishQuiz = async (id: string, isPublic: boolean) => {
    const { error } = await supabase.from('quizzes').update({ is_public: isPublic }).eq('id', id);
    if (error) throw new Error(error.message);
    setQuizzes(prev => prev.map(q => q.id === id ? { ...q, isPublic } : q));
  };

  const publishQuiz = async (id: string) => {
    const { error } = await supabase.from('quizzes').update({ is_public: true }).eq('id', id);
    if (error) throw new Error(error.message);
  };

  const getPublicQuizzes = async (): Promise<Quiz[]> => {
    const { data, error } = await supabase
      .from('quizzes').select('*')
      .eq('is_public', true).is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data ?? []).map(dbToQuiz);
  };

  const importQuiz = async (quiz: Quiz) => {
    setPublicQuizzes(prev => prev.some(q => q.id === quiz.id) ? prev : [...prev, quiz]);
  };

  const addAttempt = async (attempt: QuizAttempt) => {
    // Optimistic update first
    setAttempts(prev => [...prev, attempt]);
    
    try {
      // Add timeout to prevent hanging
      const timeoutMs = 30000;
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      );
      
      const insertPromise = supabase.from('attempts').insert(attemptToDb(attempt));
      
      let result: any;
      try {
        result = await Promise.race([insertPromise, timeoutPromise]) as any;
      } catch (e: any) {
        if (e.message === 'TIMEOUT') {
          console.log('[addAttempt] Timeout after', timeoutMs, 'ms, waiting for actual result...');
          result = await insertPromise;
        } else {
          throw e;
        }
      }
      
      if (result?.error) {
        throw new Error(result.error.message);
      }
    } catch (error: any) {
      // Rollback on error
      setAttempts(prev => prev.filter(a => a.id !== attempt.id));
      console.error('[addAttempt] Failed:', error.message);
      throw error;
    }
  };

  const updateAttempt = async (id: string, updates: Partial<QuizAttempt>) => {
    const dbUpdates: Record<string, any> = {};
    if (updates.score !== undefined) dbUpdates.score = updates.score;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.essayGrades !== undefined) dbUpdates.essay_grades = updates.essayGrades;
    const { error } = await supabase.from('attempts').update(dbUpdates).eq('id', id);
    if (error) throw new Error(error.message);
    setAttempts(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  const getQuiz = useCallback((id: string) =>
    quizzes.find(q => q.id === id) || publicQuizzes.find(q => q.id === id),
  [quizzes, publicQuizzes]);

  const fetchQuizById = useCallback(async (id: string): Promise<boolean> => {
    if (quizzes.find(q => q.id === id) || publicQuizzes.find(q => q.id === id)) return true;
    const { data, error } = await supabase.from('quizzes').select('*').eq('id', id).single();
    if (error || !data) return false;
    const quiz = dbToQuiz(data);
    setPublicQuizzes(prev => prev.some(q => q.id === quiz.id) ? prev : [...prev, quiz]);
    return true;
  }, [quizzes, publicQuizzes]);

  const getQuizByShortCode = useCallback(async (code: string): Promise<Quiz | undefined> => {
    const local = quizzes.find(q => q.shortCode === code) || publicQuizzes.find(q => q.shortCode === code);
    if (local) return local;
    const { data, error } = await supabase.from('quizzes').select('*').eq('short_code', code).single();
    if (error || !data) return undefined;
    const quiz = dbToQuiz(data);
    setPublicQuizzes(prev => prev.some(q => q.id === quiz.id) ? prev : [...prev, quiz]);
    return quiz;
  }, [quizzes, publicQuizzes]);

  const getAllAttemptsForQuiz = (quizId: string) => attempts.filter(a => a.quizId === quizId);

  const fetchAttemptsForQuiz = useCallback(async (quizId: string): Promise<QuizAttempt[]> => {
    const { data, error } = await supabase
      .from('attempts').select('*').eq('quiz_id', quizId)
      .order('score', { ascending: false });
    if (error) return [];
    return (data ?? []).map(dbToAttempt);
  }, []);

  return (
    <QuizContext.Provider value={{
      quizzes, attempts, addQuiz, editQuiz, deleteQuiz, restoreQuiz,
      permanentDeleteQuiz, deleteAllQuizzesByAuthor, togglePublishQuiz,
      getPublicQuizzes, importQuiz, addAttempt, updateAttempt,
      getQuiz, getQuizByShortCode, fetchQuizById, publishQuiz,
      getAllAttemptsForQuiz, fetchAttemptsForQuiz, isLoading,
    }}>
      {children}
    </QuizContext.Provider>
  );
};

export const useQuizStore = () => {
  const ctx = useContext(QuizContext);
  if (!ctx) throw new Error('useQuizStore must be used within QuizProvider');
  return ctx;
};
