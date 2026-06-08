/**
 * Shared cancellation-motif helpers, used by the notification popup
 * (NotificationDetail) and the business order cards (incoming-orders).
 *
 * A stored/transported reason comes in three shapes:
 *   - a JSON `{key, note}` blob (the cancel screens now ship this),
 *   - a flattened "key: note" / bare "key" string (legacy + DB-stored form),
 *   - free text.
 */

export type MotifAuthor = 'business' | 'customer' | null;

/** Normalise any raw reason value into a (key, note) pair. */
export function parseMotifRaw(raw: string | null | undefined): { key: string; note: string } {
  if (!raw) return { key: '', note: '' };
  const rawTrim = String(raw).trim();
  if (rawTrim.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawTrim);
      if (parsed && typeof parsed === 'object') {
        return {
          key: typeof parsed.key === 'string' ? parsed.key : '',
          note: typeof parsed.note === 'string' ? parsed.note : '',
        };
      }
    } catch { /* fall through to the string forms */ }
  }
  // The key never contains ": ", so split on the first occurrence.
  const sep = rawTrim.indexOf(': ');
  if (sep > 0) return { key: rawTrim.slice(0, sep), note: rawTrim.slice(sep + 2) };
  return { key: rawTrim, note: '' };
}

/**
 * Build the human-readable motif string.
 *  - "other" / free-text reason: show ONLY the typed description (never the
 *    "Autre" label), suffixed with a "(du commerce)" / "(du client)" tag when
 *    the author is known, so it's clear who wrote it.
 *  - preset reason: translate the key in BOTH the business and customer
 *    namespaces (a business card may show a customer-chosen `changed_mind`),
 *    falling back to a humanized snake_case string for unknown keys.
 */
export function motifDisplay(
  key: string | null | undefined,
  note: string | null | undefined,
  author: MotifAuthor,
  t: (k: string, opts?: any) => string,
): string {
  const k = (key ?? '').trim();
  const n = (note ?? '').trim();

  const authorSuffix = author
    ? ` (${author === 'business'
        ? t('orders.motifFromBusiness', { defaultValue: 'du commerce' })
        : t('orders.motifFromCustomer', { defaultValue: 'du client' })})`
    : '';

  // Free-text "other" (or no key at all) → description text, not the label.
  if (!k || k === 'other') {
    const base = n || t('orders.cancelReasons.other', { defaultValue: 'Autre' });
    return `${base}${authorSuffix}`;
  }

  // Preset key — translate it.
  const bizLabel = t(`business.orders.cancelReasons.${k}`, { defaultValue: '' });
  const custLabel = t(`orders.cancelReasons.${k}`, { defaultValue: '' });
  let label = bizLabel || custLabel;
  if (!label) {
    label = k.includes('_')
      ? k.split('_').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
      : k;
  }
  return n ? `${label} : ${n}` : label;
}
