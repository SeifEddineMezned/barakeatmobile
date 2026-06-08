/**
 * Format a location's display name for the business interface.
 *
 * Convention: business-side surfaces (dashboard switcher, basket cards,
 * team page, add-member, profile, etc.) always show `"Org - Location"` so
 * users can disambiguate when an org has multiple locations. The bare
 * `location.name` column in the DB now holds just the location name
 * (e.g. "La Marsa"), and the org name is supplied separately by the
 * caller — typically from the team context or org-details query.
 *
 * Falls back gracefully:
 *  - both names → "Org - Location"
 *  - only org    → "Org"
 *  - only loc    → "Location"
 *  - neither     → fallback string (caller-provided, defaults to "")
 *
 * For data coming from endpoints that already pre-format the string
 * (the public `/api/locations` list and `/api/locations/:id` set
 * `display_name` server-side), prefer reading `display_name` directly
 * instead of calling this helper.
 */
export function formatLocationName(
  orgName: string | null | undefined,
  locationName: string | null | undefined,
  fallback: string = '',
): string {
  const o = (orgName ?? '').trim();
  const l = (locationName ?? '').trim();
  if (o && l) return `${o} - ${l}`;
  if (o) return o;
  if (l) return l;
  return fallback;
}
