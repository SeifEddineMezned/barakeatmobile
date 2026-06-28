// Canonical list of business categories surfaced when creating or editing a
// food location. Both the customer-facing add-location form (mobile) and the
// admin "Gestion d'équipe" location form import from here so the two surfaces
// can't drift apart again. The backend whitelist in routes/locations.js + the
// `category || ...` fallback in routes/teams.js must mirror this set.
//
// Labels live in src/i18n/locales/{fr,en,ar}.json under "categories.{slug}".
//
// History:
//   • Dropped 'meals', 'fresh', 'produce' — 'meals' was the silent backend
//     default that surfaced as "Repas" on locations created via the team
//     onboarding flow even though it was never offered as a choice.
//   • Added 'pizzeria', 'traiteur', 'healthy', 'fast_food' to better reflect
//     the actual Tunisian food-commerce landscape.
//   • Added 'hotel' — hotels with restaurants/buffets are a meaningful source
//     of surplus food; surfaced on both the mobile and website signup forms.
//   • Re-added 'produce' — fresh-produce grocers (fruits & légumes) are a
//     distinct commerce type that does NOT fit "healthy" or "supermarket"
//     for filtering purposes. The legacy backfill in routes/locations.js
//     that remapped 'produce' → 'healthy' was scoped to its 'fresh'
//     sibling to avoid re-coercing newly-saved produce rows on each boot.
export const LOCATION_CATEGORIES = [
  'bakery',
  'restaurant',
  'fast_food',
  'cafe',
  'supermarket',
  'pizzeria',
  'traiteur',
  'hotel',
  'healthy',
  'produce',
] as const;

export type LocationCategory = (typeof LOCATION_CATEGORIES)[number];
