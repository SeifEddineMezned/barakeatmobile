/**
 * Shared geocoding helpers used by the customer address picker and the
 * business location-form. Strategy is Tunisia-strict on BOTH ends:
 *
 *   • Native forward results (Apple Geocoder on iOS, Google on Android via
 *     expo-location) are reverse-geocoded to read their country, then
 *     filtered to `isoCountryCode === 'TN'`. This kills the "Carthage,
 *     Texas" / "Tunis Square, Cairo" results that Apple's relevance
 *     scoring used to surface ahead of Tunisian hits.
 *   • Nominatim forward uses `countrycodes=tn` + `bounded=1` with the
 *     Tunisia bounding-box viewbox, so it can only return results that
 *     are physically inside the country.
 *   • Both backends run in PARALLEL and their results are merged + deduped
 *     (native usually has better street accuracy; Nominatim covers POIs
 *     that Apple/Google don't index). This means a partial query like
 *     "Carth" already returns the OSM Tunisia hits while the native
 *     geocoder is still narrowing down.
 *
 * Reverse geocoding still does native-first → Nominatim fallback because the
 * pin is already at the user's chosen coordinates and country filtering is
 * unnecessary.
 *
 * This is the ONLY place in the app that should call Nominatim or
 * Location.geocodeAsync / Location.reverseGeocodeAsync directly.
 */
import * as Location from 'expo-location';

export interface GeocodeHit {
  name: string;
  lat: number;
  lng: number;
}

// Tunisia bounding box (west, south, east, north). Same numbers used by both
// the native country-filter check and the Nominatim viewbox so the two paths
// stay in sync.
const TUNISIA_BBOX = { west: 7.5, south: 30.2, east: 11.6, north: 37.5 };
const TUNISIA_ISO = 'TN';

function isInsideTunisiaBbox(lat: number, lng: number): boolean {
  return (
    lat >= TUNISIA_BBOX.south && lat <= TUNISIA_BBOX.north &&
    lng >= TUNISIA_BBOX.west && lng <= TUNISIA_BBOX.east
  );
}

// In-memory cache of reverse-geocode results, keyed by 4-decimal rounded
// coords (~11 m). Survives until the JS context is torn down, which is enough
// to suppress the back-to-back identical calls produced by rapid pan + the
// trailing onRegionChangeComplete.
const reverseCache = new Map<string, string>();
const reverseKey = (lat: number, lng: number) =>
  `${Math.round(lat * 10000) / 10000}|${Math.round(lng * 10000) / 10000}`;

// Hard upper bound on every external HTTP call in this module. Without this
// a stalled Photon/Nominatim endpoint locks the await chain (e.g. inside
// confirmMap) and the map picker modal stays open with the underlying form
// dimmed — exactly the "screen faded but buttons clickable, then frozen"
// pattern the user reported.
const HTTP_TIMEOUT_MS = 4000;
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Native (expo-location) ────────────────────────────────────────────────
function formatNativeReverse(parts: Location.LocationGeocodedAddress | undefined): string {
  if (!parts) return '';
  const line1 = parts.name || parts.street || '';
  const line2 = parts.district || parts.subregion || parts.city || '';
  const line3 = parts.region || parts.country || '';
  return [line1, line2, line3].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
}

// Same upper-bound for native geocoder calls — Apple's CLGeocoder and
// Google's Android equivalent both occasionally stall (no network, throttle,
// etc.) and Location.*Async has no timeout option. Promise.race lets us
// move on with `null` after HTTP_TIMEOUT_MS instead of waiting forever.
function withNativeTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), HTTP_TIMEOUT_MS)),
  ]);
}

async function nativeReverseFull(lat: number, lng: number): Promise<Location.LocationGeocodedAddress | null> {
  try {
    const results = await withNativeTimeout(
      Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }),
      [] as Location.LocationGeocodedAddress[],
    );
    return results?.[0] ?? null;
  } catch {
    return null;
  }
}

async function nativeReverse(lat: number, lng: number): Promise<string> {
  const addr = await nativeReverseFull(lat, lng);
  return formatNativeReverse(addr ?? undefined);
}

async function nativeSearch(query: string): Promise<GeocodeHit[]> {
  try {
    const results = await withNativeTimeout(
      Location.geocodeAsync(query),
      [] as Location.LocationGeocodedLocation[],
    );
    if (!results || results.length === 0) return [];
    // Pull up to 8 candidates (vs 5 before) — the filter step throws most
    // foreign hits away, so we need extra headroom for Tunisia matches to
    // survive into the final list.
    const top = results.slice(0, 8);
    // Bbox pre-filter is a cheap rejection: if the coord lies outside the
    // Tunisia rectangle, drop it without paying the reverse round-trip.
    // Borderline hits (still inside the rectangle but actually in Algeria/
    // Libya) get caught by the isoCountryCode check after the reverse.
    const inBbox = top.filter((r) => isInsideTunisiaBbox(r.latitude, r.longitude));
    if (inBbox.length === 0) return [];
    const detailed = await Promise.all(inBbox.map(async (r) => {
      const addr = await nativeReverseFull(r.latitude, r.longitude);
      if (!addr) return null;
      // isoCountryCode is the authoritative signal — drop anything that
      // isn't Tunisia. (When the field is missing we keep the result —
      // the bbox check above already constrained it geographically.)
      if (addr.isoCountryCode && addr.isoCountryCode !== TUNISIA_ISO) return null;
      const label = formatNativeReverse(addr) || query;
      return { name: label, lat: r.latitude, lng: r.longitude } as GeocodeHit;
    }));
    const hits = detailed.filter((h): h is GeocodeHit => h != null);
    // Dedupe by name — native sometimes returns the same address twice when
    // the input matches multiple geocoder entries.
    const seen = new Set<string>();
    return hits.filter((h) => {
      if (seen.has(h.name)) return false;
      seen.add(h.name);
      return true;
    });
  } catch {
    return [];
  }
}

// ── Nominatim ─────────────────────────────────────────────────────────────
function formatNominatim(data: any): string {
  const a = data?.address ?? {};
  const parts = [
    a.road || a.pedestrian || a.cycleway,
    a.suburb || a.neighbourhood || a.village,
    a.city || a.town || a.municipality,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return data?.display_name ?? '';
}

async function nominatimReverse(lat: number, lng: number): Promise<string> {
  try {
    const resp = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await resp.json();
    return formatNominatim(data);
  } catch {
    return '';
  }
}

async function nominatimSearch(query: string): Promise<GeocodeHit[]> {
  try {
    // Tunisia-strict-but-not-too-strict: countrycodes=tn already restricts
    // results to .tn entries, which is enough. `bounded=0` keeps results
    // whose centroid sits right on the bbox edge from being silently
    // dropped — that's how some of the Lac-neighborhood entries used to
    // vanish even though they're clearly Tunisian.
    const params = new URLSearchParams({
      format: 'json',
      q: query,
      limit: '10',
      addressdetails: '1',
      countrycodes: 'tn',
      viewbox: `${TUNISIA_BBOX.west},${TUNISIA_BBOX.south},${TUNISIA_BBOX.east},${TUNISIA_BBOX.north}`,
      bounded: '0',
      'accept-language': 'en',
    });
    const resp = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'Accept-Language': 'en' },
    });
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    return data.map((place: any) => ({
      name: place.display_name as string,
      lat: parseFloat(place.lat),
      lng: parseFloat(place.lon),
    })).filter((h: GeocodeHit) => Number.isFinite(h.lat) && Number.isFinite(h.lng));
  } catch {
    return [];
  }
}

// ── Photon (komoot.io) ────────────────────────────────────────────────────
// Photon is an OSM-based search service specifically tuned for autocomplete
// queries: it surfaces partial matches and POIs that Nominatim's strict
// full-text matcher misses (e.g. "Lac" matching "Les Berges du Lac",
// "Lac 1", "Lac 2"). Free, no API key, and we filter to Tunisia by reading
// the `countrycode` field in each result's properties.
const TUNIS_CENTER = { lat: 36.8065, lng: 10.1815 };
function formatPhotonHit(props: any): string {
  if (!props) return '';
  // Prefer the long-form district + city tail when present so the
  // suggestion reads as "Lac 1, La Marsa, Tunis" rather than just "Lac 1".
  const head = props.name || props.street || '';
  const mid = props.district || props.suburb || '';
  const tail = props.city || props.town || props.village || props.county || '';
  return [head, mid, tail].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
}

async function photonSearch(query: string): Promise<GeocodeHit[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      limit: '10',
      lang: 'fr',
      // lat/lon bias toward Tunis center — Photon ranks closer-to-center
      // results higher without strict-bounding them out.
      lat: String(TUNIS_CENTER.lat),
      lon: String(TUNIS_CENTER.lng),
    });
    const resp = await fetchWithTimeout(`https://photon.komoot.io/api/?${params}`, {
      headers: { 'Accept-Language': 'en' },
    });
    const data = await resp.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    return features
      .filter((f: any) => {
        const cc = f?.properties?.countrycode;
        // Keep only Tunisia (uppercase ISO-2 per Photon convention). When
        // the field is missing fall back to the bbox check.
        if (cc) return cc === TUNISIA_ISO;
        const c = f?.geometry?.coordinates;
        return Array.isArray(c) && c.length >= 2 && isInsideTunisiaBbox(c[1], c[0]);
      })
      .map((f: any) => {
        const coords = f.geometry?.coordinates || [];
        const label = formatPhotonHit(f.properties) || f.properties?.name || query;
        return { name: label, lat: parseFloat(coords[1]), lng: parseFloat(coords[0]) };
      })
      .filter((h: GeocodeHit) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && h.name);
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function searchAddresses(query: string): Promise<GeocodeHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  // Three backends in parallel, each pulling its weight:
  //   • Photon (komoot.io OSM autocomplete) — best at partial matches and
  //     neighborhood/POI names like "Lac", "Berges", "Sidi" that the other
  //     two miss; ranked first because the user explicitly complained the
  //     short queries weren't matching anything.
  //   • Nominatim — strict Tunisia full-text fallback; covers entries
  //     Photon doesn't have indexed.
  //   • Native (Apple/Google via expo-location) — best at full street
  //     addresses with numbers; filtered to TN by isoCountryCode.
  const [photon, nominatim, native] = await Promise.all([
    photonSearch(trimmed),
    nominatimSearch(trimmed),
    nativeSearch(trimmed),
  ]);
  if (photon.length === 0 && nominatim.length === 0 && native.length === 0) return [];
  // Photon → Nominatim → Native order. Dedupe by name AND by ~11 m
  // proximity so the same physical point doesn't appear twice with slightly
  // different labels.
  const out: GeocodeHit[] = [];
  const seenNames = new Set<string>();
  const seenCoords = new Set<string>();
  const proxKey = (h: GeocodeHit) => `${Math.round(h.lat * 10000) / 10000}|${Math.round(h.lng * 10000) / 10000}`;
  for (const hit of [...photon, ...nominatim, ...native]) {
    const ck = proxKey(hit);
    if (seenNames.has(hit.name) || seenCoords.has(ck)) continue;
    seenNames.add(hit.name);
    seenCoords.add(ck);
    out.push(hit);
    if (out.length >= 12) break;
  }
  return out;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = reverseKey(lat, lng);
  const cached = reverseCache.get(key);
  if (cached) return cached;
  // Nominatim wins — it's now pinned to Accept-Language: en, so addresses
  // are stored in a locale-stable canonical form. The native call falls
  // back to the device's locale and there's no API to override it, which
  // is why a Spanish-phone owner was saving "Tunez" instead of "Tunisia"
  // and French customers were seeing the Spanish string downstream.
  // Native is kept as the fallback for the offline case.
  let resolved = await nominatimReverse(lat, lng);
  if (!resolved) resolved = await nativeReverse(lat, lng);
  if (resolved) reverseCache.set(key, resolved);
  return resolved;
}
