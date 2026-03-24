import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getDeviceLanguage } from '../utils/language';
import cs from './cs.json';
import en from './en.json';

const i18n = createInstance();

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    compatibilityJSON: 'v4',
    fallbackLng: 'cs',
    interpolation: {
      escapeValue: false,
    },
    lng: getDeviceLanguage(),
    resources: {
      cs: {
        translation: cs,
      },
      en: {
        translation: en,
      },
    },
    returnNull: false,
  });
}

export default i18n;
