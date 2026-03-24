import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CityName } from '../constants/cities';
import { secureStoreStorage } from '../lib/secure-store-storage';
import type { AppLanguage, UserProfile } from '../types/app';
import { getDeviceLanguage } from '../utils/language';

type UserState = {
  profile: UserProfile | null;
  selectedCity: CityName | null;
  language: AppLanguage;
  hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
  setProfile: (profile: UserProfile | null) => void;
  setSelectedCity: (selectedCity: CityName | null) => void;
  setLanguage: (language: AppLanguage) => void;
  clearProfile: () => void;
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      profile: null,
      selectedCity: null,
      language: getDeviceLanguage(),
      hasHydrated: false,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setProfile: (profile) => set({ profile }),
      setSelectedCity: (selectedCity) =>
        set((state) => ({
          selectedCity,
          profile: state.profile
            ? {
                ...state.profile,
                city: selectedCity,
              }
            : state.profile,
        })),
      setLanguage: (language) =>
        set((state) => ({
          language,
          profile: state.profile
            ? {
                ...state.profile,
                language,
              }
            : state.profile,
        })),
      clearProfile: () => set({ profile: null }),
    }),
    {
      name: 'hrayem-user-store',
      storage: createJSONStorage(() => secureStoreStorage),
      partialize: (state) => ({
        selectedCity: state.selectedCity,
        language: state.language,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
