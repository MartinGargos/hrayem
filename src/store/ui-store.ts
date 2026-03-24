import { create } from 'zustand';

type UIState = {
  isOffline: boolean;
  pendingDeepLink: string | null;
  setOffline: (isOffline: boolean) => void;
  setPendingDeepLink: (pendingDeepLink: string | null) => void;
  clearPendingDeepLink: () => void;
};

export const useUIStore = create<UIState>((set) => ({
  isOffline: false,
  pendingDeepLink: null,
  setOffline: (isOffline) => set({ isOffline }),
  setPendingDeepLink: (pendingDeepLink) => set({ pendingDeepLink }),
  clearPendingDeepLink: () => set({ pendingDeepLink: null }),
}));
