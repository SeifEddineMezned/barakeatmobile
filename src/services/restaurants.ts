import { apiClient } from '@/src/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// BACKEND TODO — include review aggregates on /api/locations
//
// The search-tab home page renders a card per location. Each card shows a
// star rating + count. Today, the locations response does NOT include those
// aggregates, so the home page falls back to fetching every review in the
// app via /api/reviews and grouping locally — that endpoint gets slower
// (and rate-limit-prone) as the review table grows, which is why users see
// "N/A" on the cards for several seconds at app start before the global
// fetch resolves.
//
// Fix on the backend: when serialising a location for the /api/locations
// list response, include:
//   avg_rating:    AVG(reviews.rating) WHERE reviews.location_id = location.id
//                  (or NULL when there are no reviews for that location)
//   review_count:  COUNT(*) WHERE reviews.location_id = location.id
//
// Mobile is already wired to read both fields (see LocationFromAPI below
// and normalizeLocationToBasket in src/utils/normalizeRestaurant.ts). The
// moment the backend ships them the cards will render ratings instantly
// on first paint with zero additional requests — and we can then remove
// the slow /api/reviews fallback in app/(tabs)/index.tsx entirely.
// ─────────────────────────────────────────────────────────────────────────────

export interface RestaurantFromAPI {
  id: number;
  user_id?: number;
  name: string;
  description?: string | null;
  phone?: string | null;
  address?: string | null;
  image_url?: string | null;
  price_tier?: string | null;
  original_price?: string | null;
  category?: string | null;
  pickup_start_time?: string | null;
  pickup_end_time?: string | null;
  available_quantity?: number;
  default_daily_quantity?: number;
  availability_status?: string | null;
  is_paused?: boolean;
  bag_description?: string | null;
  pickup_instructions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  avg_rating?: number | string | null;
  reserved_today?: number;
  available_left?: number;
  pickup_expired?: boolean;
  created_at?: string;
  updated_at?: string;
  // Organization/location fields (new model)
  organization_id?: number | null;
  org_name?: string | null;
  cover_image_url?: string | null;
  display_name?: string | null;
}

// Location data from GET /api/locations (new model, replaces restaurants for search)
export interface LocationFromAPI {
  id: number;
  name: string;
  display_name?: string;
  description?: string | null;
  phone?: string | null;
  address?: string | null;
  image_url?: string | null;
  cover_image_url?: string | null;
  price_tier?: string | null;
  original_price?: string | null;
  category?: string | null;
  pickup_start_time?: string | null;
  pickup_end_time?: string | null;
  available_quantity?: number;
  default_daily_quantity?: number;
  availability_status?: string | null;
  is_paused?: boolean;
  bag_description?: string | null;
  pickup_instructions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  organization_id?: number | null;
  /** Organization (business) name — shared across all locations */
  org_name?: string | null;
  reserved_today?: number;
  available_left?: number;
  pickup_expired?: boolean;
  basket_count?: number;
  total_basket_quantity?: number;
  min_basket_price?: number | null;
  /** Aggregate review rating (AVG of all reviews where location_id = this.id).
   *  REQUIRED for the search list to show ratings without a separate
   *  /api/reviews fetch. If omitted, the home page falls back to the slow
   *  global reviews aggregation (which trips rate limits as data grows).
   *  Backend dev: add this column to the /api/locations list response. */
  avg_rating?: number | string | null;
  /** Number of reviews for this location. Same backend caveat as avg_rating. */
  review_count?: number | null;
  created_at?: string;
  updated_at?: string;
  /** description comes from organizations table — shared across all locations of the same business */
}

export async function fetchLocations(): Promise<LocationFromAPI[]> {
  console.log('[Locations] Fetching all locations');
  try {
    const res = await apiClient.get<LocationFromAPI[]>('/api/locations');
    const data = res.data;
    const raw = Array.isArray(data) ? data : [];

    // Debug: print first location to verify coordinate field names from the API
    if (raw.length > 0) {
      const sample = raw[0] as any;
      console.log('[Locations] Sample location fields:', JSON.stringify({
        id: sample.id,
        name: sample.name ?? sample.display_name,
        latitude: sample.latitude,
        longitude: sample.longitude,
        lat: sample.lat,
        lng: sample.lng,
        gps_lat: sample.gps_lat,
        gps_lng: sample.gps_lng,
        location: sample.location,
        coordinates: sample.coordinates,
      }));
    }

    // Normalize: ensure latitude/longitude are present regardless of API field naming
    const locations: LocationFromAPI[] = raw.map((loc: any) => {
      // Try every common coordinate field naming convention
      const rawLat =
        loc.latitude ??
        loc.lat ??
        loc.gps_lat ??
        loc.location?.latitude ??
        loc.location?.lat ??
        loc.coordinates?.latitude ??
        loc.coordinates?.lat ??
        loc.geo?.lat ??
        null;

      const rawLng =
        loc.longitude ??
        loc.lng ??
        loc.gps_lng ??
        loc.gps_long ??
        loc.location?.longitude ??
        loc.location?.lng ??
        loc.coordinates?.longitude ??
        loc.coordinates?.lng ??
        loc.geo?.lng ??
        null;

      const lat = rawLat != null && rawLat !== '' ? Number(rawLat) : null;
      const lng = rawLng != null && rawLng !== '' ? Number(rawLng) : null;

      return {
        ...loc,
        latitude: lat,
        longitude: lng,
      } as LocationFromAPI;
    });

    const withCoords = locations.filter((l) => l.latitude != null && l.longitude != null && isFinite(l.latitude!) && isFinite(l.longitude!));
    const missingCoords = locations.filter((l) => l.latitude == null || l.longitude == null || !isFinite(l.latitude!) || !isFinite(l.longitude!));
    console.log('[Locations] Fetched', locations.length, 'locations,', withCoords.length, 'have valid GPS coordinates');
    if (missingCoords.length > 0) {
      console.warn('[Locations] ⚠️ MISSING COORDINATES — these locations will NOT appear on the map:');
      missingCoords.forEach((l) => {
        const name = (l as any).display_name ?? (l as any).location_name ?? (l as any).name ?? `id:${l.id}`;
        console.warn(`  → "${name}" (id=${l.id}) lat=${l.latitude} lng=${l.longitude}`);
      });
    }
    return locations;
  } catch (err: unknown) {
    const errObj = err as any;
    console.log('[Locations] Fetch failed:', errObj?.status, errObj?.message);
    throw err;
  }
}


export async function fetchLocationById(id: string | number): Promise<LocationFromAPI> {
  console.log('[Locations] Fetching location:', id);
  const res = await apiClient.get<LocationFromAPI>(`/api/locations/${id}`);
  return res.data as LocationFromAPI;
}

export async function fetchRestaurants(): Promise<RestaurantFromAPI[]> {
  console.log('[Restaurants] Fetching all restaurants');
  try {
    const res = await apiClient.get<RestaurantFromAPI[] | { restaurants: RestaurantFromAPI[] } | { data: RestaurantFromAPI[] }>('/api/restaurants');
    const data = res.data;
    let restaurants: RestaurantFromAPI[];
    if (Array.isArray(data)) {
      restaurants = data;
    } else if (data && typeof data === 'object' && 'restaurants' in data && Array.isArray((data as any).restaurants)) {
      restaurants = (data as any).restaurants;
    } else if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as any).data)) {
      restaurants = (data as any).data;
    } else {
      console.log('[Restaurants] Unexpected response shape:', JSON.stringify(data).substring(0, 500));
      restaurants = [];
    }
    console.log('[Restaurants] Fetched', restaurants.length, 'restaurants');
    return restaurants;
  } catch (err: unknown) {
    const errObj = err as any;
    console.log('[Restaurants] Fetch failed:', errObj?.status, errObj?.message);
    throw err;
  }
}

export async function fetchRestaurantById(id: string | number): Promise<RestaurantFromAPI> {
  console.log('[Restaurants] Fetching restaurant:', id);
  const res = await apiClient.get<RestaurantFromAPI | { restaurant: RestaurantFromAPI } | { data: RestaurantFromAPI }>(`/api/restaurants/${id}`);
  const data = res.data;
  let restaurant: RestaurantFromAPI;
  if (data && typeof data === 'object' && 'restaurant' in data) {
    restaurant = (data as any).restaurant;
  } else if (data && typeof data === 'object' && 'data' in data && !('id' in data)) {
    restaurant = (data as any).data;
  } else {
    restaurant = data as RestaurantFromAPI;
  }
  console.log('[Restaurants] Fetched restaurant:', restaurant.name);
  return restaurant;
}

export async function fetchRestaurantMenuItems(id: string | number): Promise<string[]> {
  console.log('[Restaurants] Fetching menu items for:', id);
  try {
    const res = await apiClient.get(`/api/restaurants/${id}/menu-items`);
    const data = res.data;
    if (Array.isArray(data)) {
      return data.map((item: any) => item.name ?? item.title ?? String(item));
    }
    if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as any).items)) {
      return (data as any).items.map((item: any) => item.name ?? item.title ?? String(item));
    }
    return [];
  } catch {
    console.log('[Restaurants] Menu items not available for:', id);
    return [];
  }
}
