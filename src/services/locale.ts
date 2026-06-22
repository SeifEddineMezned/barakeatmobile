import i18n from '@/src/i18n';
import { apiClient } from '@/src/lib/api';

// Report the app's current language to the backend so OS push notification
// banners can be localized server-side (PUT /api/auth/locale → users.locale).
// In-app notifications are already localized on the client, so this only affects
// the lock-screen / notification-tray text. Best-effort, fire-and-forget — a
// failure just means the next push falls back to French.
export async function syncLocaleToBackend(locale?: string): Promise<void> {
  try {
    const lang = (locale ?? i18n.language ?? 'fr').slice(0, 2).toLowerCase();
    const valid = ['fr', 'en', 'ar'].includes(lang) ? lang : 'fr';
    await apiClient.put('/api/auth/locale', { locale: valid });
  } catch {
    // ignore — non-critical
  }
}
