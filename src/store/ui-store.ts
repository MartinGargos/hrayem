import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { secureStoreStorage } from '../lib/secure-store-storage';
import type { AppNotice, AuthScreen } from '../types/app';

type UIState = {
  isOffline: boolean;
  pendingDeepLink: string | null;
  pendingDeepLinkHandledUserId: string | null;
  authScreen: AuthScreen;
  authNotice: AppNotice | null;
  setOffline: (isOffline: boolean) => void;
  setPendingDeepLink: (pendingDeepLink: string | null) => void;
  markPendingDeepLinkHandledByUser: (userId: string) => void;
  clearPendingDeepLink: () => void;
  setAuthScreen: (authScreen: AuthScreen) => void;
  setAuthNotice: (authNotice: AppNotice | null) => void;
  clearAuthNotice: () => void;
  reset: () => void;
};

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      isOffline: false,
      pendingDeepLink: null,
      pendingDeepLinkHandledUserId: null,
      authScreen: 'login',
      authNotice: null,
      setOffline: (isOffline) => set({ isOffline }),
      setPendingDeepLink: (pendingDeepLink) =>
        set({
          pendingDeepLink,
          pendingDeepLinkHandledUserId: null,
        }),
      markPendingDeepLinkHandledByUser: (userId) =>
        set({
          pendingDeepLinkHandledUserId: userId,
        }),
      clearPendingDeepLink: () =>
        set({
          pendingDeepLink: null,
          pendingDeepLinkHandledUserId: null,
        }),
      setAuthScreen: (authScreen) => set({ authScreen, authNotice: null }),
      setAuthNotice: (authNotice) => set({ authNotice }),
      clearAuthNotice: () => set({ authNotice: null }),
      reset: () =>
        set({
          isOffline: false,
          pendingDeepLink: get().pendingDeepLink,
          pendingDeepLinkHandledUserId: get().pendingDeepLinkHandledUserId,
          authScreen: 'login',
          authNotice: null,
        }),
    }),
    {
      name: 'hrayem-ui-store',
      storage: createJSONStorage(() => secureStoreStorage),
      partialize: (state) => ({
        pendingDeepLink: state.pendingDeepLink,
        pendingDeepLinkHandledUserId: state.pendingDeepLinkHandledUserId,
      }),
    },
  ),
);
