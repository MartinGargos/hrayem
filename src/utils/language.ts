import { getLocales } from 'expo-localization';

import type { AppLanguage } from '../types/app';

export function getDeviceLanguage(): AppLanguage {
  const [locale] = getLocales();

  return locale?.languageCode === 'cs' ? 'cs' : 'en';
}
