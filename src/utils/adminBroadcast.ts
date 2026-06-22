import i18n from '@/src/i18n';

// Admin/platform broadcasts store a multilingual blob in the notification's
// `message` field:
//   { key: 'admin_broadcast', params: { titles: {fr,en,ar}, bodies: {fr,en,ar}, image } }
// so the card/popup render in the user's CURRENT app language (and re-render when
// they switch language) and can show the attached image. Falls back to legacy
// raw-text broadcasts that predate the multilang format.
export function adminBroadcastContent(
  item: { title?: string | null; message?: string | null }
): { title: string; body: string; image: string | null } {
  const lang = (i18n.language || 'fr').slice(0, 2).toLowerCase();
  try {
    const parsed = JSON.parse(item.message ?? '');
    const p = (parsed?.params ?? parsed) ?? {};
    if (p.titles && p.bodies) {
      return {
        title: p.titles[lang] || p.titles.fr || item.title || '',
        body: p.bodies[lang] || p.bodies.fr || '',
        image: p.image || null,
      };
    }
  } catch {}
  return { title: item.title || '', body: item.message || '', image: null };
}
