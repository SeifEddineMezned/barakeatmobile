/**
 * Shared geocoding helpers used by the customer address picker and the
 * business location-form. Strategy: device-native geocoder first (Apple /
 * Google via expo-location — much better Tunisian POI coverage and free),
 * Nominatim (OpenStreetMap) as the fallback when native returns nothing or
 * the call throws.
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

// In-memory cache of reverse-geocode results, keyed by 4-decimal rounded
// coords (~11 m). Survives until the JS context is torn down, which is enough
// to suppress the back-to-back identical calls produced by rapid pan + the
// trailing onRegionChangeComplete.
const reverseCache = new Map<string, string>();
const reverseKey = (lat: number, lng: number) =>
  `${Math.round(lat * 10000) / 10000}|${Math.round(lng * 10000) / 10000}`;

// ── Native (expo-location) ────────────────────────────────────────────────
// Native reverse returns an object with name/street/city/region/etc. — format
// it the same way the Nominatim helper does so callers can swap freely.
function formatNativeReverse(parts: Location.LocationGeocodedAddress | undefined): string {
  if (!parts) return '';
  const line1 = parts.name || parts.street || '';
  const line2 = parts.district || parts.subregion || parts.city || '';
  const line3 = parts.region || parts.country || '';
  return [line1, line2, line3].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
}

async function nativeReverse(lat: number, lng: number): Promise<string> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return formatNativeReverse(results?.[0]);
  } catch {
    return '';
  }
}

async function nativeSearch(query: string): Promise<GeocodeHit[]> {
  try {
    const results = await Location.geocodeAsync(query);
    if (!results || results.length === 0) return [];
    // Native forward only returns coords; resolve each one back to a
    // human-readable label via reverse. Keep parallel and cap at 5 to avoid
    // hammering the native geocoder.
    const top = results.slice(0, 5);
    const names = await Promise.all(top.map((r) => nativeReverse(r.latitude, r.longitude)));
    const hits: GeocodeHit[] = top.map((r, i) => ({
      name: names[i] || query,
      lat: r.latitude,
      lng: r.longitude,
    }));
    // Deduplicate by name — native sometimes returns the same address twice
    // when the input matches multiple geocoder entries.
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

// ── Nominatim fallback ────────────────────────────────────────────────────
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
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
      { headers: { 'Accept-Language': 'fr' } }
    );
    const data = await resp.json();
    return formatNominatim(data);
  } catch {
    return '';
  }
}

async function nominatimSearch(query: string): Promise<GeocodeHit[]> {
  try {
    // viewbox biases toward Tunisia without bounding (so distant-but-correct
    // hits aren't silently dropped). countrycodes=tn dropped intentionally —
    // when the native geocoder already failed, restricting Nominatim too
    // hard would yield zero results.
    const params = new URLSearchParams({
      format: 'json',
      q: query,
      limit: '10',
      addressdetails: '1',
      viewbox: '7.5,30.2,11.6,37.5',
      bounded: '0',
      'accept-language': 'fr',
    });
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'Accept-Language': 'fr' },
    });
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    return data.map((place: any) => ({
      name: place.display_name as string,
      lat: parseFloat(place.lat),
      lng: parseFloat(place.lon),
    }));
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function searchAddresses(query: string): Promise<GeocodeHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const native = await nativeSearch(trimmed);
  if (native.length > 0) return native;
  return nominatimSearch(trimmed);
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = reverseKey(lat, lng);
  const cached = reverseCache.get(key);
  if (cached) return cached;
  let resolved = await nativeReverse(lat, lng);
  if (!resolved) resolved = await nominatimReverse(lat, lng);
  if (resolved) reverseCache.set(key, resolved);
  return resolved;
}
