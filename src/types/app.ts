import type { CityName } from '../constants/cities';

export type AppLanguage = 'cs' | 'en';

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'signed-out';

export type AuthScreen = 'login' | 'register' | 'forgot-password' | 'reset-password';

export type NoticeTone = 'info' | 'success' | 'error';

export type AppNotice = {
  messageKey: string;
  tone: NoticeTone;
};

export type UserProfile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  city: CityName | null;
  language: AppLanguage;
  latitude: number | null;
  longitude: number | null;
  profileComplete: boolean;
};
