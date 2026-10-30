'use client';

import { create } from 'zustand';
import axios from 'axios';
import { api } from '@/lib/api';
import {
  clearAuthCookies,
  homePathForRole,
  readSessionFromDocument,
  setSessionCookie,
  setTokenCookie,
  type AuthUser,
} from '@/lib/auth';

function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 502 || status === 503 || !error.response) {
      return '서버가 데이터베이스에 연결되지 않았습니다. 로그인 정보가 틀린 것이 아닙니다.';
    }
    const data = error.response?.data as
      | { message?: string | string[] }
      | undefined;
    const msg = data?.message;
    if (Array.isArray(msg) && msg.length > 0) return msg.join('\n');
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return fallback;
}

interface AuthState {
  user: AuthUser | null;
  hydrated: boolean;
  hydrate: () => void;
  login: (
    id: string,
    password: string,
  ) => Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  hydrated: false,

  hydrate: () => {
    const user = readSessionFromDocument();
    set({ user, hydrated: true });
  },

  login: async (id, password) => {
    try {
      const { data } = await api.post<{
        accessToken: string;
        user: AuthUser;
      }>('/auth/login', { id, password });

      setTokenCookie(data.accessToken);
      setSessionCookie(data.user);
      set({ user: data.user, hydrated: true });
      return { ok: true, user: data.user };
    } catch (error) {
      return {
        ok: false,
        error: apiErrorMessage(
          error,
          '아이디 또는 비밀번호가 올바르지 않습니다.',
        ),
      };
    }
  },

  logout: async () => {
    // Clear local session first so middleware/AuthGuard see logged-out state
    // before any navigation (API call may be slow or fail).
    clearAuthCookies();
    set({ user: null });
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
  },

  isAdmin: () => get().user?.role === 'admin',
}));

export { homePathForRole };
