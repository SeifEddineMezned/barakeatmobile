/**
 * Display-only phone-number formatter.
 *
 * Goal: render stored phone strings as "(+216) XX XXX XXX" — country code
 * in parentheses, the remaining digits spaced according to the country's
 * convention. Editing flows still see the raw input.
 *
 * The function is forgiving on input:
 *   - accepts numbers with or without a leading "+"
 *   - accepts a "00" prefix in place of "+" (common in EU input)
 *   - strips all non-digit characters (spaces, dashes, parentheses) before parsing
 *   - falls back to Tunisia formatting for bare 8-digit local numbers
 *     (the app's primary market)
 *   - returns "" for null / empty / digit-less input
 */
type CountryFormat = { code: string; groups: number[] };

// Ordered longest-prefix-first so the lookup below picks the right country
// when codes nest (e.g. "1" vs "1XXX"). Default fallback grouping is 2-3-3.
const FORMATS: CountryFormat[] = [
  { code: '216', groups: [2, 3, 3] },         // Tunisia → XX XXX XXX
  { code: '33',  groups: [1, 2, 2, 2, 2] },   // France → X XX XX XX XX
  { code: '44',  groups: [4, 6] },            // United Kingdom (loose)
  { code: '49',  groups: [3, 3, 4] },         // Germany (loose)
  { code: '34',  groups: [3, 3, 3] },         // Spain
  { code: '39',  groups: [3, 3, 4] },         // Italy
  { code: '212', groups: [3, 3, 3] },         // Morocco
  { code: '213', groups: [3, 2, 2, 2] },      // Algeria
  { code: '1',   groups: [3, 3, 4] },         // US / Canada
];

const FALLBACK_GROUPS = [2, 3, 3];

function groupDigits(body: string, groups: number[]): string {
  const parts: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= body.length) break;
    parts.push(body.slice(i, i + g));
    i += g;
  }
  if (i < body.length) parts.push(body.slice(i));
  return parts.join(' ');
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  // Treat a leading "00" the same as a leading "+".
  const normalized = digits.startsWith('00') ? digits.slice(2) : digits;
  const hadPlus = trimmed.startsWith('+') || digits.length !== normalized.length;

  // Pick a country code by longest matching prefix. We only run the lookup
  // when the input either explicitly had "+/00" or is long enough to plausibly
  // include a country code (>8 digits — most local-only numbers stop there).
  let country = '';
  let body = normalized;
  if (hadPlus || normalized.length > 8) {
    const sorted = FORMATS.slice().sort((a, b) => b.code.length - a.code.length);
    for (const f of sorted) {
      if (normalized.startsWith(f.code)) {
        country = f.code;
        body = normalized.slice(f.code.length);
        break;
      }
    }
  }

  // Bare local number with no prefix and 8 digits → default to Tunisia.
  if (!country && body.length === 8) country = '216';

  const groups = FORMATS.find((f) => f.code === country)?.groups ?? FALLBACK_GROUPS;
  const formatted = groupDigits(body, groups);

  return country ? `(+${country}) ${formatted}` : formatted;
}
