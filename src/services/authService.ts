import { supabase } from './supabase';
import { User } from '../types';

function mapProfileToUser(
  supabaseUser: { id: string; email?: string | null },
  profile: { name: string; photo_url?: string | null; bio?: string | null; notifications?: any; preferences?: any; }
): User {
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? '',
    name: profile.name,
    photoURL: profile.photo_url ?? undefined,
    bio: profile.bio ?? undefined,
    notifications: profile.notifications ?? { email: true, push: true, activitySummary: true },
    preferences: profile.preferences ?? { theme: 'light', language: 'vi' },
  };
}

export const authService = {
  login: async (email: string, password: string): Promise<User> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Đăng nhập thất bại');

    let { data: profile } = await supabase
      .from('profiles').select('*').eq('id', data.user.id).single();

    if (!profile) {
      const name = data.user.user_metadata?.name ?? email.split('@')[0];
      await supabase.from('profiles').upsert({ id: data.user.id, name, email: data.user.email ?? '' });
      profile = { name, email: data.user.email ?? '' };
    }

    return mapProfileToUser(data.user, profile);
  },

  register: async (name: string, email: string, password: string): Promise<User> => {
    const { data, error } = await supabase.auth.signUp({
      email, password, options: { data: { name } },
    });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Không thể tạo tài khoản');

    // Trigger tự tạo profile, chỉ upsert nếu chưa có
    const { data: existing } = await supabase
      .from('profiles').select('id').eq('id', data.user.id).single();

    if (!existing) {
      await supabase.from('profiles').upsert({
        id: data.user.id, name, email: data.user.email ?? email,
      });
    }

    return { id: data.user.id, email: data.user.email ?? '', name };
  },

  logout: async () => { await supabase.auth.signOut(); },

  deleteAccount: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Không tìm thấy người dùng');
    const { error } = await supabase.functions.invoke('delete-user');
    if (error) throw new Error(error.message);
    await supabase.auth.signOut();
  },

  getCurrentUser: async (): Promise<User | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();

      if (!profile) {
        const name = user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User';
        await supabase.from('profiles').upsert({ id: user.id, name, email: user.email ?? '' });
        return { id: user.id, email: user.email ?? '', name };
      }

      return mapProfileToUser(user, profile);
    } catch {
      return null;
    }
  },

  updateUserProfile: async (userId: string, updates: {
    name?: string; photoURL?: string; bio?: string; notifications?: any; preferences?: any;
  }) => {
    const payload: Record<string, any> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.photoURL !== undefined) payload.photo_url = updates.photoURL;
    if (updates.bio !== undefined) payload.bio = updates.bio;
    if (updates.notifications !== undefined) payload.notifications = updates.notifications;
    if (updates.preferences !== undefined) payload.preferences = updates.preferences;
    const { error } = await supabase.from('profiles').update(payload).eq('id', userId);
    if (error) throw new Error(error.message);
  },

  updateUserPassword: async (currentPassword: string, newPassword: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) throw new Error('Không tìm thấy email người dùng');
    const { error: reAuthError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (reAuthError) throw new Error('Mật khẩu hiện tại không đúng');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  },

  uploadAvatar: async (userId: string, file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const filePath = `${userId}/avatar.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
    if (uploadError) throw new Error(uploadError.message);
    const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
    return `${data.publicUrl}?t=${Date.now()}`;
  },
};
