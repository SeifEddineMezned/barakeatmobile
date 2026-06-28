// Picks the viewer's-language string out of a multilingual `{fr,en,ar}` object
// produced by the AI-improve feature, with a graceful fallback chain.
//
// Baskets store an AI-translated `description_i18n` / `pickup_instructions_i18n`
// JSONB alongside the plain `description` / `pickup_instructions` TEXT column.
// The TEXT column is always the source/fallback: older baskets, and any field
// the merchant never ran through the AI, only have the TEXT value. So the
// resolution order is:
//   1. the i18n object's entry for the active language, if present & non-empty
//   2. any other language present in the i18n object (so we still show the
//      translated/improved text rather than nothing)
//   3. the plain `fallback` text the merchant typed
//
// `lang` accepts a full i18n code ("fr", "en-US", "ar"); only the 2-letter
// prefix matters. The i18n object may arrive as a real object (JSON body) or a
// JSON string (rare) — both are handled.

export type I18nText = Record<string, string> | string | null | undefined;

export function localizeI18n(
  i18nValue: I18nText,
  lang: string | undefined,
  fallback?: string | null,
): string {
  const fb = (fallback ?? '').toString();

  let obj: Record<string, string> | null = null;
  if (i18nValue && typeof i18nValue === 'object') {
    obj = i18nValue as Record<string, string>;
  } else if (typeof i18nValue === 'string' && i18nValue.trim().startsWith('{')) {
    try { obj = JSON.parse(i18nValue); } catch { obj = null; }
  }

  if (!obj) return fb;

  const code = (lang || 'fr').slice(0, 2);
  const pick = (k: string) => {
    const v = obj?.[k];
    return typeof v === 'string' && v.trim() ? v : null;
  };

  // 1) exact language, 2) any other available language, 3) plain fallback.
  return pick(code) ?? pick('fr') ?? pick('en') ?? pick('ar') ?? fb;
}
