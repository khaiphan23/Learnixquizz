import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { QuizCard } from '../components/QuizCard';
import { Button, Spinner } from '../components/ui';
import { PlusCircle, Trash2, RotateCcw, Trash, CheckCircle2, XCircle, Globe, Lock, X } from 'lucide-react';

let _toastId = 0;
type ToastType = 'success' | 'error';
interface ToastItem { id: number; msg: string; type: ToastType }

const ToastContainer: React.FC<{ toasts: ToastItem[]; remove: (id: number) => void }> = ({ toasts, remove }) => (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
    {toasts.map(t => (
      <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl text-sm font-semibold text-white pointer-events-auto ${t.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
        {t.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        <span>{t.msg}</span>
        <button onClick={() => remove(t.id)}><X className="h-3.5 w-3.5 opacity-70 hover:opacity-100" /></button>
      </div>
    ))}
  </div>
);

const ConfirmModal: React.FC<{
  isOpen: boolean; title: string; description: string;
  confirmLabel: string; danger?: boolean; loading?: boolean;
  onConfirm: () => void; onClose: () => void;
}> = ({ isOpen, title, description, confirmLabel, danger, loading, onConfirm, onClose }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 z-10">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{description}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Hủy</Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" isLoading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
};

export const MyQuizzes: React.FC = () => {
  const { quizzes, deleteQuiz, restoreQuiz, permanentDeleteQuiz, togglePublishQuiz, isLoading } = useQuizStore();
  const { user } = useAuth();
  const { lang } = useLang();
  const navigate = useNavigate();

  const [showTrash, setShowTrash] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; title: string; description: string; confirmLabel: string; danger: boolean; action: () => Promise<void> } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const toast = useCallback((msg: string, type: ToastType = 'success') => {
    const id = ++_toastId;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const runConfirm = async () => {
    if (!confirmModal) return;
    setConfirmLoading(true);
    try { await confirmModal.action(); }
    catch (e: any) { toast(e.message || (lang === 'vi' ? 'Có lỗi xảy ra' : 'Error occurred'), 'error'); }
    setConfirmLoading(false);
    setConfirmModal(null);
  };

  const handleDelete = (id: string, title: string) => setConfirmModal({
    open: true,
    title: lang === 'vi' ? 'Xóa quiz?' : 'Delete quiz?',
    description: lang === 'vi' ? `"${title}" sẽ vào thùng rác. Có thể khôi phục sau.` : `"${title}" will be moved to trash.`,
    confirmLabel: lang === 'vi' ? 'Xóa' : 'Delete',
    danger: true,
    action: async () => {
      setDeletingId(id);
      await deleteQuiz(id);
      setDeletingId(null);
      toast(lang === 'vi' ? 'Đã xóa vào thùng rác' : 'Moved to trash');
    },
  });

  const handlePermanentDelete = (id: string, title: string) => setConfirmModal({
    open: true,
    title: lang === 'vi' ? 'Xóa vĩnh viễn?' : 'Delete permanently?',
    description: lang === 'vi' ? `"${title}" sẽ bị xóa hoàn toàn, không thể khôi phục.` : `"${title}" will be permanently deleted.`,
    confirmLabel: lang === 'vi' ? 'Xóa vĩnh viễn' : 'Delete forever',
    danger: true,
    action: async () => {
      await permanentDeleteQuiz(id);
      toast(lang === 'vi' ? 'Đã xóa vĩnh viễn' : 'Permanently deleted');
    },
  });

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try {
      await restoreQuiz(id);
      toast(lang === 'vi' ? '✓ Đã khôi phục quiz' : '✓ Quiz restored');
    } catch (e: any) {
      toast(e.message || (lang === 'vi' ? 'Không thể khôi phục' : 'Could not restore'), 'error');
    }
    setRestoringId(null);
  };

  const handleTogglePublish = async (id: string, currentPublic: boolean) => {
    setPublishingId(id);
    try {
      await togglePublishQuiz(id, !currentPublic);
      toast(!currentPublic
        ? (lang === 'vi' ? '✓ Quiz đã công khai' : '✓ Quiz is now public')
        : (lang === 'vi' ? 'Quiz đã chuyển về riêng tư' : 'Quiz set to private'));
    } catch (e: any) {
      toast(e.message || (lang === 'vi' ? 'Không thể thay đổi' : 'Could not update'), 'error');
    } finally {
      setPublishingId(null);
    }
  };

  if (!user) return null;
  if (isLoading) return (
    <div className="flex flex-col items-center justify-center py-32 gap-3">
      <Spinner size="lg" />
      <p className="text-slate-400 text-sm">{lang === 'vi' ? 'Đang tải...' : 'Loading...'}</p>
    </div>
  );

  const activeQuizzes = quizzes.filter(q => !q.deletedAt);
  const trashedQuizzes = quizzes.filter(q => q.deletedAt);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {showTrash ? (lang === 'vi' ? '🗑️ Thùng rác' : '🗑️ Trash') : (lang === 'vi' ? 'Quiz của tôi' : 'My Quizzes')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {showTrash
              ? `${trashedQuizzes.length} ${lang === 'vi' ? 'quiz đã xóa' : 'deleted'}`
              : `${activeQuizzes.length} ${lang === 'vi' ? 'quiz' : 'quizzes'}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTrash(!showTrash)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${showTrash ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
          >
            <Trash2 className="h-4 w-4" />
            {showTrash ? (lang === 'vi' ? 'Xem quiz' : 'My Quizzes') : (lang === 'vi' ? 'Thùng rác' : 'Trash')}
            {trashedQuizzes.length > 0 && !showTrash && (
              <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">{trashedQuizzes.length}</span>
            )}
          </button>
          {!showTrash && (
            <Button size="sm" onClick={() => navigate('/create')}>
              <PlusCircle className="h-4 w-4" />{lang === 'vi' ? 'Tạo Quiz' : 'Create Quiz'}
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {(showTrash ? trashedQuizzes : activeQuizzes).length === 0 && (
        <div className="text-center py-24 space-y-4">
          <div className="text-7xl">{showTrash ? '🗑️' : '📝'}</div>
          <p className="text-slate-500 dark:text-slate-400 font-medium">
            {showTrash ? (lang === 'vi' ? 'Thùng rác trống' : 'Trash is empty') : (lang === 'vi' ? 'Bạn chưa có quiz nào' : 'No quizzes yet')}
          </p>
          {!showTrash && (
            <Button onClick={() => navigate('/create')}><PlusCircle className="h-4 w-4" />{lang === 'vi' ? 'Tạo quiz đầu tiên' : 'Create first quiz'}</Button>
          )}
        </div>
      )}

      {/* Trash view */}
      {showTrash && trashedQuizzes.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trashedQuizzes.map(quiz => (
            <div key={quiz.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-4 opacity-80 hover:opacity-100 transition-opacity">
              <div>
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 line-clamp-2">{quiz.title}</h3>
                <p className="text-xs text-slate-400 mt-1">{quiz.questions.length} {lang === 'vi' ? 'câu hỏi' : 'questions'}</p>
              </div>
              <div className="flex gap-2 pt-1 border-t border-slate-100 dark:border-slate-700">
                <button
                  onClick={() => handleRestore(quiz.id)}
                  disabled={restoringId === quiz.id}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                >
                  {restoringId === quiz.id ? <Spinner size="sm" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  {lang === 'vi' ? 'Khôi phục' : 'Restore'}
                </button>
                <button
                  onClick={() => handlePermanentDelete(quiz.id, quiz.title)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ml-auto"
                >
                  <Trash className="h-3.5 w-3.5" />
                  {lang === 'vi' ? 'Xóa vĩnh viễn' : 'Delete forever'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active quiz view */}
      {!showTrash && activeQuizzes.length > 0 && (
        <>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeQuizzes.map(quiz => (
              <div key={quiz.id} className="relative">
                {(publishingId === quiz.id || deletingId === quiz.id) && (
                  <div className="absolute inset-0 bg-white/70 dark:bg-slate-800/70 rounded-2xl z-10 flex items-center justify-center">
                    <Spinner size="sm" />
                  </div>
                )}
                <QuizCard
                  quiz={quiz}
                  onClick={() => navigate(`/quiz/${quiz.id}`)}
                  showActions
                  onEdit={() => navigate(`/edit/${quiz.id}`)}
                  onTogglePublish={() => handleTogglePublish(quiz.id, quiz.isPublic)}
                  onDelete={() => handleDelete(quiz.id, quiz.title)}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-indigo-500" />{lang === 'vi' ? 'Công khai' : 'Public'}</span>
            <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" />{lang === 'vi' ? 'Riêng tư' : 'Private'}</span>
          </div>
        </>
      )}

      {/* Confirm modal */}
      {confirmModal && (
        <ConfirmModal
          isOpen={confirmModal.open}
          title={confirmModal.title}
          description={confirmModal.description}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          loading={confirmLoading}
          onConfirm={runConfirm}
          onClose={() => !confirmLoading && setConfirmModal(null)}
        />
      )}

      <ToastContainer toasts={toasts} remove={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  );
};
