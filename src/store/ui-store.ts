import { create } from 'zustand';

import type { AppNotice, AuthScreen } from '../types/app';

type UIState = {
  isOffline: boolean;
  pendingDeepLink: string | null;
  authScreen: AuthScreen;
  authNotice: AppNotice | null;
  setOffline: (isOffline: boolean) => void;
  setPendingDeepLink: (pendingDeepLink: string | null) => void;
  clearPendingDeepLink: () => void;
  setAuthScreen: (authScreen: AuthScreen) => void;
  setAuthNotice: (authNotice: AppNotice | null) => void;
  clearAuthNotice: () => void;
  reset: () => void;
};

export const useUIStore = create<UIState>((set) => ({
  isOffline: false,
  pendingDeepLink: null,
  authScreen: 'login',
  authNotice: null,
  setOffline: (isOffline) => set({ isOffline }),
  setPendingDeepLink: (pendingDeepLink) => set({ pendingDeepLink }),
  clearPendingDeepLink: () => set({ pendingDeepLink: null }),
  setAuthScreen: (authScreen) => set({ authScreen, authNotice: null }),
  setAuthNotice: (authNotice) => set({ authNotice }),
  clearAuthNotice: () => set({ authNotice: null }),
  reset: () =>
    set({
      isOffline: false,
      pendingDeepLink: null,
      authScreen: 'login',
      authNotice: null,
    }),
}));
