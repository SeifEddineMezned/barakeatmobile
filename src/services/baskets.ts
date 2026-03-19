import { apiClient } from '@/src/lib/api';

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
