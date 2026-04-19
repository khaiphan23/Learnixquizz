import React, { useState } from 'react';
import { Quiz } from '../types';
import { useLang } from '../store/LangContext';
import { Badge, Card } from './ui';
import { BookOpen, BarChart2, Globe, Lock, Trash2, Share2, Link2, Hash, Check, Pencil, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface QuizCardProps {
  quiz: Quiz;
  onClick?: () => void;
  onDelete?: () => void;
  onTogglePublish?: () => void;
  onEdit?: () => void;
  onStats?: () => void;
  showActions?: boolean;
}

const difficultyVariant = (d: string): 'success' | 'warning' | 'danger' => {
  if (d === 'easy') return 'success';
  if (d === 'hard') return 'danger';
  return 'warning';
};

const ShareModal: React.FC<{ quiz: Quiz; onClose: () => void }> = ({ quiz, onClose }) => {
  const { lang } = useLang();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const shareLink = `${window.location.origin}${window.location.pathname}#/quiz/${quiz.id}`;
  const shareCode = quiz.shortCode ?? quiz.id.slice(0, 8).toUpperCase();

  const copy = async (text: string, type: 'link' | 'code') => {
    await navigator.clipboard.writeText(text);
    if (type === 'link') { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }
    else { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5 z-10"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
              <Share2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h2 className="font-bold text-slate-900 dark:text-white text-base">
              {lang === 'vi' ? 'Chia sẻ quiz' : 'Share Quiz'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">{quiz.title}</p>

        {/* Mã code */}
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            <Hash className="h-3.5 w-3.5" />
            {lang === 'vi' ? 'Mã tham gia' : 'Join Code'}
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3">
              <span className="font-mono text-2xl font-black tracking-[0.3em] text-indigo-600 dark:text-indigo-400">
                {shareCode}
              </span>
            </div>
            <button
              onClick={() => copy(shareCode, 'code')}
              className={`flex items-center gap-1.5 px-3 py-3 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                copiedCode
                  ? 'bg-green-500 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {copiedCode ? <Check className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
              {copiedCode ? (lang === 'vi' ? 'Đã sao' : 'Copied') : (lang === 'vi' ? 'Sao chép' : 'Copy')}
            </button>
          </div>
          <p className="text-xs text-slate-400">
            {lang === 'vi' ? 'Người chơi nhập mã này ở trang chủ' : 'Players enter this code on the home page'}
          </p>
        </div>

        {/* Link */}
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            <Link2 className="h-3.5 w-3.5" />
            {lang === 'vi' ? 'Link trực tiếp' : 'Direct Link'}
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 overflow-hidden">
              <p className="text-xs text-slate-600 dark:text-slate-300 truncate font-mono">{shareLink}</p>
            </div>
            <button
              onClick={() => copy(shareLink, 'link')}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                copiedLink
                  ? 'bg-green-500 text-white'
                  : 'bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 text-white'
              }`}
            >
              {copiedLink ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {copiedLink ? (lang === 'vi' ? 'Đã sao' : 'Copied') : (lang === 'vi' ? 'Sao chép' : 'Copy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const QuizCard: React.FC<QuizCardProps> = ({ quiz, onClick, onDelete, onTogglePublish, onEdit, onStats, showActions }) => {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [showShare, setShowShare] = useState(false);
  const diffLabel: Record<string, string> = { easy: t.easy, medium: t.medium, hard: t.hard };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit) onEdit();
    else navigate(`/edit/${quiz.id}`);
  };

  return (
    <>
      <Card className="p-5 space-y-3 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
        {/* Title row */}
        <div className="flex items-start gap-2">
          <h3
            className="font-bold text-slate-900 dark:text-white text-base leading-snug line-clamp-2 flex-1 cursor-pointer"
            onClick={onClick}
          >
            {quiz.title}
          </h3>
          <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
            <Badge variant={difficultyVariant(quiz.difficulty)}>
              {diffLabel[quiz.difficulty] ?? quiz.difficulty}
            </Badge>
            {quiz.isPublic
              ? <Badge variant="info"><Globe className="h-3 w-3" /></Badge>
              : <Badge><Lock className="h-3 w-3" /></Badge>
            }
          </div>
        </div>

        {/* Description */}
        {quiz.description && (
          <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 cursor-pointer" onClick={onClick}>
            {quiz.description}
          </p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 flex-wrap" onClick={onClick}>
          <span className="flex items-center gap-1 cursor-pointer">
            <BookOpen className="h-3.5 w-3.5" />{quiz.questions.length} {t.questions}
          </span>
          <span className="flex items-center gap-1 cursor-pointer">
            <BarChart2 className="h-3.5 w-3.5" />{quiz.topic}
          </span>
          {quiz.shortCode && (
            <span className="flex items-center gap-1 font-mono font-semibold text-indigo-500">
              <Hash className="h-3 w-3" />{quiz.shortCode}
            </span>
          )}
        </div>

        {/* Actions — separated, no overlap */}
        {showActions && (
          <div
            className="pt-2 border-t border-slate-100 dark:border-slate-700 grid grid-cols-5 gap-1"
            onClick={e => e.stopPropagation()}
          >
            {/* Stats */}
            {onStats && (
              <button
                onClick={onStats}
                className="flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 transition-colors"
              >
                <TrendingUp className="h-4 w-4" />
                <span>{lang === 'vi' ? 'Thống kê' : 'Stats'}</span>
              </button>
            )}

            {/* Edit */}
            <button
              onClick={handleEdit}
              className="flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <Pencil className="h-4 w-4" />
              <span>{lang === 'vi' ? 'Sửa' : 'Edit'}</span>
            </button>

            {/* Share */}
            <button
              onClick={() => setShowShare(true)}
              className="flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-700 transition-colors"
            >
              <Share2 className="h-4 w-4" />
              <span>{lang === 'vi' ? 'Chia sẻ' : 'Share'}</span>
            </button>

            {/* Publish toggle */}
            {onTogglePublish && (
              <button
                onClick={onTogglePublish}
                className={`flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition-colors ${
                  quiz.isPublic
                    ? 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                }`}
              >
                {quiz.isPublic ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                <span>{quiz.isPublic ? (lang === 'vi' ? 'Ẩn' : 'Hide') : (lang === 'vi' ? 'Công khai' : 'Publish')}</span>
              </button>
            )}

            {/* Delete */}
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                <span>{lang === 'vi' ? 'Xóa' : 'Delete'}</span>
              </button>
            )}
          </div>
        )}
      </Card>

      {showShare && <ShareModal quiz={quiz} onClose={() => setShowShare(false)} />}
    </>
  );
};
