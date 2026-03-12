import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { I18nManager, Platform } from 'react-native';
import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  ar: { translation: ar },
};

const deviceLang = Localization.getLocales()[0]?.languageCode || 'en';
const supportedLangs = ['en', 'fr', 'ar'];
const initialLang = supportedLangs.includes(deviceLang) ? deviceLang : 'en';

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on('languageChanged', (lng) => {
  const isRTL = lng === 'ar';
  if (Platform.OS !== 'web') {
    if (I18nManager.isRTL !== isRTL) {
      I18nManager.allowRTL(isRTL);
      I18nManager.forceRTL(isRTL);
    }
  }
  console.log('[i18n] Language changed to:', lng, 'RTL:', isRTL);
});

export default i18n;
