import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { supabase } from '../services/supabase';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  deleteAccount: () => Promise<void>;
  updateUserProfile: (updates: { name?: string; photoURL?: string; bio?: string; notifications?: any; preferences?: any; }) => Promise<void>;
  updateUserPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  uploadAvatar: (file: File) => Promise<string>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchOrCreateProfile(userId: string, email: string, meta: any): Promise<User> {
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', userId).single();

  if (profile) {
    return {
      id: userId, email,
      name: profile.name,
      photoURL: profile.photo_url ?? undefined,
      bio: profile.bio ?? undefined,
      notifications: profile.notifications ?? { email: true, push: true, activitySummary: true },
      preferences: profile.preferences ?? { theme: 'light', language: 'vi' },
    };
  }

  const name = meta?.name ?? email.split('@')[0] ?? 'User';
  await supabase.from('profiles').upsert({ id: userId, name, email });
  return { id: userId, email, name };
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadingDone = useRef(false);

  const finishLoading = () => {
    if (!loadingDone.current) {
      loadingDone.current = true;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Chỉ dùng getSession() để init — không phụ thuộc onAuthStateChange cho việc này
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        try {
          const u = await fetchOrCreateProfile(
            session.user.id,
            session.user.email ?? '',
            session.user.user_metadata
          );
          setUser(u);
        } catch {
          setUser(null);
        }
      } else {
        setUser(null);
      }
      finishLoading();
    }).catch(() => {
      setUser(null);
      finishLoading();
    });

    // onAuthStateChange chỉ dùng để phản ứng các sự kiện SAU khi đã init xong
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth]', event);

      // PASSWORD_RECOVERY: chuyển sang trang reset, không set user
      if (event === 'PASSWORD_RECOVERY') {
        finishLoading();
        window.location.hash = '#/reset-password';
        return;
      }

      // Chỉ xử lý sau khi init đã xong (loadingDone = true)
      // Tránh race condition với getSession() ở trên
      if (!loadingDone.current) return;

      if (event === 'SIGNED_IN' && session?.user) {
        try {
          const u = await fetchOrCreateProfile(
            session.user.id,
            session.user.email ?? '',
            session.user.user_metadata
          );
          setUser(u);
        } catch {
          setUser(null);
        }
        return;
      }

      if (event === 'SIGNED_OUT') {
        setUser(null);
        return;
      }
    });

    // Safety fallback: nếu getSession() không trả về sau 3s
    const fallback = setTimeout(finishLoading, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(fallback);
    };
  }, []);

  // Apply theme
  useEffect(() => {
    const theme = user?.preferences?.theme ?? 'light';
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      root.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } else {
      root.classList.add(theme);
    }
  }, [user?.preferences?.theme]);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  };

  const register = async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { data: { name } },
    });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Không thể tạo tài khoản');
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  const deleteAccount = async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) throw new Error('Không tìm thấy người dùng');
    const { error } = await supabase.functions.invoke('delete-user');
    if (error) throw new Error(error.message);
    await supabase.auth.signOut();
    setUser(null);
  };

  const updateUserProfile = async (updates: any) => {
    if (!user) return;
    const payload: Record<string, any> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.photoURL !== undefined) payload.photo_url = updates.photoURL;
    if (updates.bio !== undefined) payload.bio = updates.bio;
    if (updates.notifications !== undefined) payload.notifications = updates.notifications;
    if (updates.preferences !== undefined) payload.preferences = updates.preferences;
    const { error } = await supabase.from('profiles').update(payload).eq('id', user.id);
    if (error) throw new Error(error.message);
    setUser(prev => prev ? { ...prev, ...updates } : null);
  };

  const updateUserPassword = async (currentPassword: string, newPassword: string) => {
    if (!user) return;
    const { error: reAuthError } = await supabase.auth.signInWithPassword({
      email: user.email, password: currentPassword,
    });
    if (reAuthError) throw new Error('Mật khẩu hiện tại không đúng');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  };

  const uploadAvatar = async (file: File): Promise<string> => {
    if (!user) throw new Error('Chưa đăng nhập');
    const fileExt = file.name.split('.').pop();
    const filePath = `${user.id}/avatar.${fileExt}`;
    const { error } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
    return `${data.publicUrl}?t=${Date.now()}`;
  };

  return (
    <AuthContext.Provider value={{
      user, login, register, logout, deleteAccount,
      updateUserProfile, updateUserPassword, uploadAvatar, isLoading,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
