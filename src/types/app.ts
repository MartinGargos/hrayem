export type AppLanguage = 'cs' | 'en';

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'signed-out';

export type UserProfile = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  city: string | null;
  language: AppLanguage;
};
