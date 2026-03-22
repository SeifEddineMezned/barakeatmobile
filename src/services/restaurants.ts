import { apiClient } from '@/src/lib/api';

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
