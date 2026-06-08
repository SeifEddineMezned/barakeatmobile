import { apiClient } from '@/src/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Basket pickup-time inheritance convention
//
// Convention:
//   - NULL `pickup_start_time` / `pickup_end_time` on a basket row  →  the
//     basket inherits the location's current hours.
//   - Non-NULL values  →  the basket has its own custom window.
//
// The mobile merchant form (app/business/create-basket.tsx) writes NULL when
// the merchant ticks "use horaires du commerce". The backend correctly
// persists and returns NULL on those columns.
//
// Resolution happens client-side in the consumer normalisers:
// `normalizeRawBasketToBasket` in src/utils/normalizeRestaurant.ts accepts a
// `locationDefaults` arg and falls back through:
//   basket pickup time → location pickup time → hardcoded 18:00/19:00
//
// All consumer call sites pass the location's hours so an inheriting basket
// correctly displays the location's window. Without that arg the normaliser
// would slap on the hardcoded default (the original chez-joe "6-7 PM" bug).
//
// If you ever want the location-hours fallback to happen server-side too
// (so the API is self-consistent for any other client), wrap the time
// columns in COALESCE on the basket read endpoints:
//   SELECT COALESCE(b.pickup_start_time, l.pickup_start_time) AS pickup_start_time,
//          COALESCE(b.pickup_end_time,   l.pickup_end_time)   AS pickup_end_time
//   FROM baskets b JOIN locations l ON b.location_id = l.id
// Not required today — the mobile fallback handles it — but worth knowing.
// ─────────────────────────────────────────────────────────────────────────────

export interface BasketFromAPI {
  id: string;
  merchantId?: string;
  merchantName?: string;
  merchantLogo?: string;
  merchantRating?: number;
  reviewCount?: number;
  reviews?: {
    service: number;
    quantite: number;
    qualite: number;
    variete: number;
  };
  description?: string;
  name: string;
  category?: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercentage?: number;
  pickupWindow?: {
    start: string;
    end: string;
  };
  quantityLeft?: number;
  quantityTotal?: number;
  distance?: number;
  address?: string;
  latitude?: number;
  longitude?: number;
  exampleItems?: string[];
  imageUrl?: string;
  isActive?: boolean;
  isSupermarket?: boolean;
  [key: string]: unknown;
}

export async function fetchBaskets(): Promise<BasketFromAPI[]> {
  console.log('[Baskets] Fetching all baskets from:', apiClient.defaults.baseURL + '/api/baskets');
  try {
    const res = await apiClient.get<BasketFromAPI[] | { baskets: BasketFromAPI[] } | { data: BasketFromAPI[] }>('/api/baskets');
    const data = res.data;
    console.log('[Baskets] Response status:', res.status, 'type:', typeof data, 'isArray:', Array.isArray(data));
    let baskets: BasketFromAPI[];
    if (Array.isArray(data)) {
      baskets = data;
    } else if (data && typeof data === 'object' && 'baskets' in data && Array.isArray((data as any).baskets)) {
      baskets = (data as any).baskets;
    } else if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as any).data)) {
      baskets = (data as any).data;
    } else {
      console.log('[Baskets] Unexpected response shape:', JSON.stringify(data).substring(0, 500));
      baskets = [];
    }
    console.log('[Baskets] Fetched', baskets.length, 'baskets');
    return baskets;
  } catch (err: unknown) {
    const errObj = err as any;
    console.log('[Baskets] Fetch failed:', errObj?.status, errObj?.message, JSON.stringify(errObj?.data ?? '').substring(0, 500));
    throw err;
  }
}

export async function fetchBasketById(id: string): Promise<BasketFromAPI> {
  console.log('[Baskets] Fetching basket:', id);
  const res = await apiClient.get<BasketFromAPI | { basket: BasketFromAPI } | { data: BasketFromAPI }>(`/api/baskets/${id}`);
  const data = res.data;
  let basket: BasketFromAPI;
  if (data && typeof data === 'object' && 'basket' in data) {
    basket = (data as any).basket;
  } else if (data && typeof data === 'object' && 'data' in data) {
    basket = (data as any).data;
  } else {
    basket = data as BasketFromAPI;
  }
  console.log('[Baskets] Fetched basket:', basket.name);
  return basket;
}

export async function fetchBasketsByLocation(locationId: string): Promise<BasketFromAPI[]> {
  console.log('[Baskets] Fetching baskets for location:', locationId);
  const res = await apiClient.get<BasketFromAPI[] | { baskets: BasketFromAPI[] }>(`/api/baskets/location/${locationId}`);
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'baskets' in data) return (data as any).baskets;
  return [];
}
