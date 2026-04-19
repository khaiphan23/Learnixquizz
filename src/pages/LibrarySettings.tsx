import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuizStore } from '../store/QuizContext';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { QuizCard } from '../components/QuizCard';
import { Button, Spinner, Input, Modal, Card } from '../components/ui';
import { Search, Library as LibIcon, Upload, Play } from 'lucide-react';

export const Library: React.FC = () => {
  const { getPublicQuizzes, importQuiz } = useQuizStore();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [diff, setDiff] = useState('');

  useEffect(() => {
    getPublicQuizzes().then(q => { setQuizzes(q); setLoading(false); });
  }, [getPublicQuizzes]);

  const filtered = quizzes.filter(q => {
    const matchSearch = !search || q.title.toLowerCase().includes(search.toLowerCase()) || q.topic.toLowerCase().includes(search.toLowerCase());
    const matchDiff = !diff || q.difficulty === diff;
    return matchSearch && matchDiff;
  });

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <LibIcon className="h-6 w-6 text-indigo-600" />
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">{t.publicLibrary}</h1>
        <span className="text-sm text-slate-500 dark:text-slate-400">({filtered.length})</span>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={lang === 'vi' ? 'Tìm kiếm...' : 'Search...'}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <select value={diff} onChange={e => setDiff(e.target.value)}
          className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">{lang === 'vi' ? 'Tất cả' : 'All'}</option>
          <option value="easy">{t.easy}</option>
          <option value="medium">{t.medium}</option>
          <option value="hard">{t.hard}</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-500 dark:text-slate-400">
          <p className="text-4xl mb-3">📚</p>
          <p>{t.noQuizzes}</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(q => (
            // FIX: bỏ relative + absolute, dùng flex-col để nút Play nằm dưới card
            <div key={q.id} className="flex flex-col gap-2">
              <QuizCard quiz={q} onClick={() => navigate(`/quiz/${q.id}`)} />
              <button
                onClick={() => { importQuiz(q); navigate(`/quiz/${q.id}`); }}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
              >
                <Play className="h-4 w-4 fill-white" />
                {lang === 'vi' ? 'Vào làm bài' : 'Start Quiz'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const Settings: React.FC = () => {
  const { user, updateUserProfile, updateUserPassword, uploadAvatar, deleteAccount } = useAuth();
  const { t, lang, setLang } = useLang();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  if (!user) { navigate('/login'); return null; }

  const handleSaveProfile = async () => {
    setSaving(true);
    await updateUserProfile({ name, bio });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setAvatarLoading(true);
    const url = await uploadAvatar(file);
    await updateUserProfile({ photoURL: url });
    setAvatarLoading(false);
  };

  const handleChangePassword = async () => {
    setPwError('');
    if (pwNew.length < 8) { setPwError(lang === 'vi' ? 'Mật khẩu mới phải có ít nhất 8 ký tự' : 'New password must be at least 8 characters'); return; }
    if (pwNew !== pwConfirm) { setPwError(lang === 'vi' ? 'Mật khẩu xác nhận không khớp' : 'Passwords do not match'); return; }
    setPwLoading(true);
    try { await updateUserPassword(pwCurrent, pwNew); setPwSuccess(true); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }
    catch (e: any) { setPwError(e.message); }
    setPwLoading(false);
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try { await deleteAccount(); navigate('/'); }
    catch (e: any) { console.error(e); }
    setDeleteLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">{t.settings}</h1>

      {/* Profile */}
      <Card className="p-6 space-y-5">
        <h2 className="font-bold text-slate-900 dark:text-white">{t.profile}</h2>
        <div className="flex items-center gap-4">
          <div className="relative">
            {user.photoURL
              ? <img src={user.photoURL} className="w-16 h-16 rounded-full object-cover" alt={user.name} />
              : <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-black">{user.name[0].toUpperCase()}</div>
            }
            <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 hover:opacity-100 cursor-pointer transition-opacity">
              {avatarLoading ? <Spinner size="sm" /> : <Upload className="h-5 w-5 text-white" />}
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
            </label>
          </div>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">{user.name}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
          </div>
        </div>
        <Input label={t.name} value={name} onChange={e => setName(e.target.value)} />
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t.bio}</label>
          <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3}
            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
        </div>
        <Button onClick={handleSaveProfile} isLoading={saving}>{saved ? '✓ ' + t.success : t.save}</Button>
      </Card>

      {/* Language */}
      <Card className="p-6 space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white">{t.language}</h2>
        <div className="flex gap-3">
          {(['vi', 'en'] as const).map(l => (
            <button key={l} onClick={() => setLang(l)}
              className={`px-4 py-2 rounded-xl font-medium text-sm transition-all ${lang === l ? 'bg-indigo-600 text-white' : 'border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
              {l === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
            </button>
          ))}
        </div>
      </Card>

      {/* Change Password */}
      <Card className="p-6 space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white">{t.changePassword}</h2>
        {pwSuccess && <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-3 text-sm text-green-700 dark:text-green-300">{t.success}</div>}
        {pwError && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-3 text-sm text-red-700 dark:text-red-300">{pwError}</div>}
        <Input type="password" label={t.currentPassword} value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} />
        <Input type="password" label={t.newPassword} value={pwNew} onChange={e => setPwNew(e.target.value)} />
        <Input type="password" label={t.confirmPassword} value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} />
        <Button onClick={handleChangePassword} isLoading={pwLoading} variant="outline">{t.changePassword}</Button>
      </Card>

      {/* Danger zone */}
      <Card className="p-6 space-y-4 border-red-200 dark:border-red-800">
        <h2 className="font-bold text-red-600">{lang === 'vi' ? 'Vùng nguy hiểm' : 'Danger Zone'}</h2>
        <Button variant="danger" onClick={() => setDeleteModal(true)}>{t.deleteAccount}</Button>
      </Card>

      <Modal isOpen={deleteModal} onClose={() => setDeleteModal(false)} title={t.deleteAccount}>
        <p className="text-slate-600 dark:text-slate-400 text-sm">
          {lang === 'vi' ? 'Tài khoản của bạn sẽ bị xóa vĩnh viễn. Hành động này không thể hoàn tác.' : 'Your account will be permanently deleted. This action cannot be undone.'}
        </p>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={() => setDeleteModal(false)}>{t.cancel}</Button>
          <Button variant="danger" isLoading={deleteLoading} onClick={handleDeleteAccount}>{t.deleteAccount}</Button>
        </div>
      </Modal>
    </div>
  );
};
