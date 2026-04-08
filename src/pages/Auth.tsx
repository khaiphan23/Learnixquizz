import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { useLang } from '../store/LangContext';
import { supabase } from '../services/supabase';
import { BookOpen, Mail, Lock, User, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { Loader2 } from 'lucide-react';

const AuthInput: React.FC<{
  icon: React.ReactNode; type: string; placeholder: string;
  value: string; onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  rightIcon?: React.ReactNode; onRightClick?: () => void;
}> = ({ icon, type, placeholder, value, onChange, onKeyDown, rightIcon, onRightClick }) => (
  <div className="relative">
    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>
    <input type={type} placeholder={placeholder} value={value}
      onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown}
      className="w-full pl-11 pr-11 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-slate-700 transition-all text-[15px]"
    />
    {rightIcon && (
      <button type="button" onClick={onRightClick} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
        {rightIcon}
      </button>
    )}
  </div>
);

const AuthCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950 px-4 py-12">
    <div className="w-full max-w-md">{children}</div>
  </div>
);

const Logo: React.FC = () => (
  <div className="flex flex-col items-center gap-3 mb-8">
    <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200 dark:shadow-indigo-900">
      <BookOpen className="h-7 w-7 text-white" />
    </div>
    <span className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">EduQuiz</span>
  </div>
);

export const Login: React.FC = () => {
  const { login, user } = useAuth();
  const { lang } = useLang();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError(lang === 'vi' ? 'Vui lòng nhập đầy đủ thông tin' : 'Please fill in all fields');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <AuthCard>
      <Logo />
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl p-8 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {lang === 'vi' ? 'Chào mừng trở lại' : 'Welcome back'}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {lang === 'vi' ? 'Đăng nhập để tiếp tục' : 'Sign in to continue'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <AuthInput icon={<Mail className="h-4 w-4" />} type="email" placeholder="Email"
            value={email} onChange={setEmail} />
          <AuthInput icon={<Lock className="h-4 w-4" />}
            type={showPw ? 'text' : 'password'}
            placeholder={lang === 'vi' ? 'Mật khẩu' : 'Password'}
            value={password} onChange={setPassword}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            rightIcon={showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            onRightClick={() => setShowPw(!showPw)}
          />
        </div>

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
            {lang === 'vi' ? 'Quên mật khẩu?' : 'Forgot password?'}
          </Link>
        </div>

        <button onClick={handleSubmit} disabled={loading}
          className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-[15px] transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-200 dark:shadow-indigo-900">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading
            ? (lang === 'vi' ? 'Đang đăng nhập...' : 'Signing in...')
            : (lang === 'vi' ? 'Đăng nhập' : 'Sign in')}
        </button>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          {lang === 'vi' ? 'Chưa có tài khoản?' : "Don't have an account?"}{' '}
          <Link to="/register" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
            {lang === 'vi' ? 'Đăng ký' : 'Sign up'}
          </Link>
        </p>
      </div>
    </AuthCard>
  );
};

export const Register: React.FC = () => {
  const { register, user } = useAuth();
  const { lang } = useLang();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const handleSubmit = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError(lang === 'vi' ? 'Vui lòng nhập đầy đủ thông tin' : 'Please fill in all fields');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), password);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <AuthCard>
      <Logo />
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl p-8 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {lang === 'vi' ? 'Tạo tài khoản' : 'Create account'}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {lang === 'vi' ? 'Bắt đầu hành trình học tập' : 'Start your learning journey'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <AuthInput icon={<User className="h-4 w-4" />} type="text"
            placeholder={lang === 'vi' ? 'Họ và tên' : 'Full name'}
            value={name} onChange={setName} />
          <AuthInput icon={<Mail className="h-4 w-4" />} type="email" placeholder="Email"
            value={email} onChange={setEmail} />
          <AuthInput icon={<Lock className="h-4 w-4" />}
            type={showPw ? 'text' : 'password'}
            placeholder={lang === 'vi' ? 'Mật khẩu (tối thiểu 6 ký tự)' : 'Password (min 6 chars)'}
            value={password} onChange={setPassword}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            rightIcon={showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            onRightClick={() => setShowPw(!showPw)}
          />
        </div>

        <button onClick={handleSubmit} disabled={loading}
          className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-[15px] transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-200 dark:shadow-indigo-900">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading
            ? (lang === 'vi' ? 'Đang tạo tài khoản...' : 'Creating account...')
            : (lang === 'vi' ? 'Đăng ký' : 'Sign up')}
        </button>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          {lang === 'vi' ? 'Đã có tài khoản?' : 'Already have an account?'}{' '}
          <Link to="/login" className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">
            {lang === 'vi' ? 'Đăng nhập' : 'Sign in'}
          </Link>
        </p>
      </div>
    </AuthCard>
  );
};

export const ForgotPassword: React.FC = () => {
  const { lang } = useLang();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setError('');
    setLoading(true);

    // FIX: dùng origin không có hash, Supabase sẽ append token vào
    // rồi Supabase redirect về URL này, HashRouter sẽ handle /#/reset-password
    const redirectUrl = `${window.location.origin}/`;
    // setDebugUrl(redirectUrl); --- REMOVED FOR LINT
    console.log('[ForgotPassword] redirectTo:', redirectUrl);

    const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirectUrl,
    });

    if (e) {
      console.error('[ForgotPassword] error:', e);
      setError(e.message);
    } else {
      console.log('[ForgotPassword] email sent successfully');
      setSent(true);
    }
    setLoading(false);
  };

  return (
    <AuthCard>
      <Logo />
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl p-8 space-y-5">
        <button onClick={() => navigate('/login')} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          {lang === 'vi' ? 'Quay lại đăng nhập' : 'Back to login'}
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {lang === 'vi' ? 'Quên mật khẩu?' : 'Forgot password?'}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {lang === 'vi' ? 'Nhập email để nhận link đặt lại' : 'Enter email to receive reset link'}
          </p>
        </div>

        {sent ? (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-5 text-center space-y-2">
            <div className="text-3xl">📬</div>
            <p className="font-semibold text-green-800 dark:text-green-300">
              {lang === 'vi' ? 'Email đã được gửi!' : 'Email sent!'}
            </p>
            <p className="text-sm text-green-700 dark:text-green-400">
              {lang === 'vi' ? 'Kiểm tra hộp thư của bạn (và thư mục spam)' : 'Check your inbox (and spam folder)'}
            </p>
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
            <AuthInput icon={<Mail className="h-4 w-4" />} type="email" placeholder="Email"
              value={email} onChange={setEmail} onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            <button onClick={handleSubmit} disabled={loading}
              className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold text-[15px] transition-all flex items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {lang === 'vi' ? 'Gửi link đặt lại' : 'Send reset link'}
            </button>
          </>
        )}
      </div>
    </AuthCard>
  );
};
