import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { secureStoreStorage } from '../lib/secure-store-storage';
import type { SessionStatus } from '../types/app';

type AuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  expiresAt: number | null;
  pushToken: string | null;
  status: SessionStatus;
  errorMessageKey: string | null;
  hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
  beginBootstrap: () => void;
  applySession: (session: Session | null) => void;
  clearSession: (errorMessageKey?: string | null) => void;
  clearErrorMessage: () => void;
  setPushToken: (pushToken: string | null) => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      userId: null,
      expiresAt: null,
      pushToken: null,
      status: 'idle',
      errorMessageKey: null,
      hasHydrated: false,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      beginBootstrap: () =>
        set({
          status: 'loading',
          errorMessageKey: null,
        }),
      applySession: (session) =>
        set({
          accessToken: session?.access_token ?? null,
          refreshToken: session?.refresh_token ?? null,
          userId: session?.user.id ?? null,
          expiresAt: session?.expires_at ?? null,
          status: session ? 'authenticated' : 'signed-out',
          errorMessageKey: null,
        }),
      clearSession: (errorMessageKey = null) =>
        set({
          accessToken: null,
          refreshToken: null,
          userId: null,
          expiresAt: null,
          pushToken: null,
          status: 'signed-out',
          errorMessageKey,
        }),
      clearErrorMessage: () => set({ errorMessageKey: null }),
      setPushToken: (pushToken) => set({ pushToken }),
    }),
    {
      name: 'hrayem-auth-store',
      storage: createJSONStorage(() => secureStoreStorage),
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        pushToken: state.pushToken,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
