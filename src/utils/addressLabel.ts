// Saved-address labels are stored as free strings. The two reserved defaults
// ("Home"/"Work") are saved in whatever language was active at creation
// (e.g. "Maison"), so they would otherwise NOT follow a later language switch.
// These helpers recognise the reserved defaults in every supported language and
// re-translate ONLY those two; every user-entered custom name renders verbatim.

type TLike = (key: string, opts?: Record<string, unknown>) => string;

const HOME_ALIASES = new Set(['home', 'maison', 'المنزل']);
const WORK_ALIASES = new Set(['work', 'travail', 'العمل']);

/** Canonical key for a reserved default ('home'/'work'), else null. */
export function defaultAddressKey(label?: string | null): 'home' | 'work' | null {
  const k = (label ?? '').trim().toLowerCase();
  if (HOME_ALIASES.has(k)) return 'home';
  if (WORK_ALIASES.has(k)) return 'work';
  return null;
}

/** Display label: reserved defaults translate to the active language; any
 *  custom name is returned unchanged. */
export function resolveAddressLabel(label: string | undefined | null, t: TLike): string {
  const key = defaultAddressKey(label);
  if (key === 'home') return t('addressPicker.label_home', { defaultValue: 'Maison' });
  if (key === 'work') return t('addressPicker.label_work', { defaultValue: 'Travail' });
  return label ?? '';
}
