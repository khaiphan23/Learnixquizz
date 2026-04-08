import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useLang } from '../store/LangContext';
import { Button, Input } from '../components/ui';
import { Lock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLang();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // FIX: 3 trạng thái rõ ràng thay vì boolean sessionReady
  // 'checking' → đang chờ session
  // 'ready'    → có session, cho phép đổi mật khẩu
  // 'expired'  → không có session hoặc timeout
  const [sessionState, setSessionState] = useState<'checking' | 'ready' | 'expired'>('checking');

  useEffect(() => {
    let resolved = false;

    const resolve = (state: 'ready' | 'expired') => {
      if (resolved) return;
      resolved = true;
      setSessionState(state);
    };

    // Lắng nghe PASSWORD_RECOVERY hoặc SIGNED_IN với session hợp lệ
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[ResetPassword] auth event:', event, '| session:', !!session);
      if (event === 'PASSWORD_RECOVERY' && session) {
        resolve('ready');
      } else if (event === 'SIGNED_IN' && session) {
        // Supabase đôi khi fire SIGNED_IN thay vì PASSWORD_RECOVERY
        resolve('ready');
      } else if (event === 'SIGNED_OUT') {
        resolve('expired');
      }
    });

    // Kiểm tra session hiện tại — có thể đã được set bởi detectSessionInUrl
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log('[ResetPassword] getSession:', !!session);
      if (session) {
        resolve('ready');
      }
    });

    // Timeout 8s — nếu không có session thì báo expired
    const timeout = setTimeout(() => {
      console.log('[ResetPassword] timeout — no session received');
      resolve('expired');
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async () => {
    setError(null);
    if (password.length < 8) {
      setError(t.lang === 'vi' ? 'Mật khẩu phải có ít nhất 8 ký tự.' : 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError(t.lang === 'vi' ? 'Mật khẩu xác nhận không khớp.' : 'Passwords do not match.');
      return;
    }

    setIsLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    // Đăng xuất session recovery, user tự đăng nhập lại
    await supabase.auth.signOut();
    setTimeout(() => navigate('/login'), 2000);
  };

  // ── Đang kiểm tra session ──
  if (sessionState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md p-8 w-full max-w-md text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600 mx-auto" />
          <p className="font-semibold text-slate-900 dark:text-white">
            {t.lang === 'vi' ? 'Đang xác thực link...' : 'Verifying link...'}
          </p>
          <p className="text-sm text-slate-400">
            {t.lang === 'vi' ? 'Vui lòng chờ trong giây lát' : 'Please wait a moment'}
          </p>
        </div>
      </div>
    );
  }

  // ── Link hết hạn hoặc không hợp lệ ──
  if (sessionState === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md p-8 w-full max-w-md text-center space-y-5">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
          <div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white">
              {t.lang === 'vi' ? 'Link không hợp lệ hoặc đã hết hạn' : 'Invalid or expired link'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              {t.lang === 'vi'
                ? 'Link reset mật khẩu chỉ có hiệu lực trong 1 giờ và chỉ dùng được một lần.'
                : 'Password reset links are valid for 1 hour and can only be used once.'}
            </p>
          </div>
          <Button onClick={() => navigate('/forgot-password')} className="w-full">
            {t.lang === 'vi' ? 'Gửi lại email' : 'Request new link'}
          </Button>
          <button onClick={() => navigate('/login')} className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            {t.lang === 'vi' ? 'Về trang đăng nhập' : 'Back to login'}
          </button>
        </div>
      </div>
    );
  }

  // ── Form đổi mật khẩu ──
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-md p-8 w-full max-w-md space-y-6">

        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center mx-auto">
            <Lock className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">
            {t.lang === 'vi' ? 'Đặt mật khẩu mới' : 'Set new password'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t.lang === 'vi' ? 'Nhập mật khẩu mới cho tài khoản của bạn' : 'Enter a new password for your account'}
          </p>
        </div>

        {success ? (
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-5 text-center space-y-2">
            <CheckCircle className="h-8 w-8 text-green-500 mx-auto" />
            <p className="font-semibold text-green-800 dark:text-green-300">
              {t.lang === 'vi' ? 'Đổi mật khẩu thành công!' : 'Password changed!'}
            </p>
            <p className="text-sm text-green-600 dark:text-green-400">
              {t.lang === 'vi' ? 'Đang chuyển về trang đăng nhập...' : 'Redirecting to login...'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                {error}
              </div>
            )}

            <Input
              type="password"
              label={t.lang === 'vi' ? 'Mật khẩu mới' : 'New password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t.lang === 'vi' ? 'Tối thiểu 8 ký tự' : 'At least 8 characters'}
            />

            {/* Strength indicator */}
            {password.length > 0 && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
                      password.length >= i * 3
                        ? i <= 1 ? 'bg-red-400' : i <= 2 ? 'bg-yellow-400' : i <= 3 ? 'bg-blue-400' : 'bg-green-400'
                        : 'bg-slate-200 dark:bg-slate-700'
                    }`} />
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  {password.length < 4
                    ? (t.lang === 'vi' ? 'Rất yếu' : 'Very weak')
                    : password.length < 7
                    ? (t.lang === 'vi' ? 'Yếu' : 'Weak')
                    : password.length < 10
                    ? (t.lang === 'vi' ? 'Trung bình' : 'Fair')
                    : (t.lang === 'vi' ? 'Mạnh' : 'Strong')}
                </p>
              </div>
            )}

            <Input
              type="password"
              label={t.lang === 'vi' ? 'Xác nhận mật khẩu' : 'Confirm password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSubmit()}
              placeholder={t.lang === 'vi' ? 'Nhập lại mật khẩu mới' : 'Re-enter new password'}
            />

            {/* Match indicator */}
            {confirmPassword.length > 0 && (
              <p className={`text-xs ${password === confirmPassword ? 'text-green-500' : 'text-red-400'}`}>
                {password === confirmPassword
                  ? (t.lang === 'vi' ? '✓ Mật khẩu khớp' : '✓ Passwords match')
                  : (t.lang === 'vi' ? '✗ Mật khẩu chưa khớp' : '✗ Passwords do not match')}
              </p>
            )}

            <Button
              onClick={handleSubmit}
              isLoading={isLoading}
              className="w-full"
              disabled={!password || !confirmPassword || password !== confirmPassword}
            >
              {t.lang === 'vi' ? 'Đặt mật khẩu mới' : 'Set new password'}
            </Button>

            <button
              onClick={() => navigate('/login')}
              className="w-full text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-center"
            >
              {t.lang === 'vi' ? 'Hủy' : 'Cancel'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
