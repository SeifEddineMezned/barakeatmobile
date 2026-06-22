import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FeatureFlags } from '@/src/lib/featureFlags';
import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  ar: { translation: ar },
};

// Arabic stays in the resource set so any string already keyed against it
// still resolves, but it's filtered out of `supportedLangs` while the feature
// flag is off — a previously-persisted `app_lang === 'ar'` would otherwise
// silently re-select Arabic on the next launch and stick the user in the
// locale we've just hidden from every picker.
const supportedLangs: string[] = ['fr', 'en', ...(FeatureFlags.LANGUAGES_AR_ENABLED ? ['ar'] : [])];

// First launch picks up the phone's system language. Pre-app language
// selectors were removed — the user can change the language from Settings
// once they're inside the app, and the choice is persisted under `app_lang`
// (see the AsyncStorage block at the bottom of this file). Falls back to
// French only if the device's language isn't one we support — we don't want
// a brand-new install on a phone set to Spanish to silently use 'fr' if the
// user actually understands English.
function detectInitialLang(): string {
  try {
    const locales = Localization.getLocales();
    const primary = locales?.[0]?.languageCode?.toLowerCase();
    if (primary && supportedLangs.includes(primary)) return primary;
  } catch {
    // expo-localization unavailable (e.g. some test envs) — fall through.
  }
  return 'fr';
}
const initialLang = detectInitialLang();

void i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLang,
    fallbackLng: 'fr',
    interpolation: {
      escapeValue: false,
      // Don't show raw {{variable}} for missing params — render empty string instead
      defaultVariables: {},
    },
    missingInterpolationHandler: () => '',
  });

// RTL handling intentionally removed. The previous version flipped the entire
// React Native layout via I18nManager.forceRTL(true) whenever 'ar' was picked,
// which:
//   1. Mirrors EVERY component horizontally — even icons, halos, and chat
//      bubbles that were never designed for RTL — producing visible glitches.
//   2. On Android, forceRTL triggers a partial mid-session reload (RN reads
//      the new direction at component-mount time): views already on screen
//      stay LTR while newly-mounted views render RTL, so the user sees the
//      app "half-flip" — that's the intermittent horizontal-flip bug.
// Until every screen is audited for RTL correctness, leave the layout LTR for
// all locales and just translate the strings. The Arabic pill is also gated
// behind FeatureFlags.LANGUAGES_AR_ENABLED in pickers, so 'ar' shouldn't be
// reachable from the UI while this is being worked through.
i18n.on('languageChanged', (lng) => {
  console.log('[i18n] Language changed to:', lng);
});

// Restore persisted language preference
AsyncStorage.getItem('app_lang').then((saved) => {
  if (saved && supportedLangs.includes(saved) && saved !== i18n.language) {
    void i18n.changeLanguage(saved);
  }
}).catch(() => {});

export default i18n;
