import { apiClient, getAdminToken } from '@/src/lib/api';

// ─── Profile ────────────────────────────────────────────────────────────────

export interface BusinessProfileFromAPI {
  id: number;
  user_id?: number;
  name: string;
  description?: string | null;
  phone?: string | null;
  address?: string | null;
  image_url?: string | null;
  cover_image_url?: string | null;
  category?: string | null;
  price_tier?: string | null;
  original_price?: string | null;
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
  total_baskets_sold?: number;
  total_revenue?: number;
  organization_id?: number | null;
  reserved_today?: number;
  permissions?: Record<string, unknown> | null;
}

export async function fetchMyProfile(): Promise<BusinessProfileFromAPI> {
  console.log('[Business] Fetching my profile');
  const res = await apiClient.get<BusinessProfileFromAPI | { restaurant: BusinessProfileFromAPI } | { data: BusinessProfileFromAPI }>('/api/restaurants/my/profile');
  const data = res.data;
  if (data && typeof data === 'object' && 'restaurant' in data) return (data as any).restaurant;
  if (data && typeof data === 'object' && 'data' in data && !('id' in data)) return (data as any).data;
  return data as BusinessProfileFromAPI;
}

export async function updateMyProfile(formData: FormData, userId?: number): Promise<BusinessProfileFromAPI> {
  console.log('[Business] Updating my profile');
  const headers: Record<string, string> = { 'Content-Type': 'multipart/form-data' };
  if (userId) {
    headers['x-admin-token'] = getAdminToken(userId);
    console.log('[Business] Attaching x-admin-token for profile update');
  }
  const res = await apiClient.put<BusinessProfileFromAPI | { restaurant: BusinessProfileFromAPI }>('/api/restaurants/my/profile', formData, { headers });
  const data = res.data;
  if (data && typeof data === 'object' && 'restaurant' in data) return (data as any).restaurant;
  return data as BusinessProfileFromAPI;
}

// ─── Baskets ────────────────────────────────────────────────────────────────

export interface BusinessBasketFromAPI {
  id: number;
  restaurant_id?: number;
  name: string;
  description?: string | null;
  category?: string | null;
  original_price?: string | number;
  selling_price?: string | number;
  quantity?: number;
  available_quantity?: number;
  pickup_start_time?: string | null;
  pickup_end_time?: string | null;
  image_url?: string | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
}

export async function fetchMyBaskets(): Promise<BusinessBasketFromAPI[]> {
  console.log('[Business] Fetching my baskets');
  const res = await apiClient.get<BusinessBasketFromAPI[] | { baskets: BusinessBasketFromAPI[] } | { data: BusinessBasketFromAPI[] }>('/api/baskets/my/baskets');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'baskets' in data) return (data as any).baskets;
  if (data && typeof data === 'object' && 'data' in data) return (data as any).data;
  return [];
}

export async function createBasket(formData: FormData): Promise<BusinessBasketFromAPI> {
  console.log('[Business] Creating basket (multipart)');
  const res = await apiClient.post<BusinessBasketFromAPI | { basket: BusinessBasketFromAPI }>('/api/baskets', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const data = res.data;
  if (data && typeof data === 'object' && 'basket' in data) return (data as any).basket;
  return data as BusinessBasketFromAPI;
}

export async function createBasketJSON(payload: {
  name: string;
  description?: string;
  category?: string;
  original_price?: number;
  selling_price: number;
  quantity: number;
  pickup_start_time: string;
  pickup_end_time: string;
}): Promise<BusinessBasketFromAPI> {
  console.log('[Business] Creating basket (JSON):', JSON.stringify(payload));
  const res = await apiClient.post<BusinessBasketFromAPI | { basket: BusinessBasketFromAPI }>('/api/baskets', payload);
  const data = res.data;
  if (data && typeof data === 'object' && 'basket' in data) return (data as any).basket;
  return data as BusinessBasketFromAPI;
}

export async function updateBasket(id: number | string, data: Record<string, any>): Promise<BusinessBasketFromAPI> {
  console.log('[Business] Updating basket:', id, 'data:', JSON.stringify(data));
  const res = await apiClient.put<BusinessBasketFromAPI | { basket: BusinessBasketFromAPI }>(`/api/baskets/${id}`, data);
  const resData = res.data;
  if (resData && typeof resData === 'object' && 'basket' in resData) return (resData as any).basket;
  return resData as BusinessBasketFromAPI;
}

export async function updateBasketWithImage(id: number | string, formData: FormData): Promise<BusinessBasketFromAPI> {
  console.log('[Business] Updating basket with image:', id);
  const res = await apiClient.put<BusinessBasketFromAPI | { basket: BusinessBasketFromAPI }>(`/api/baskets/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const resData = res.data;
  if (resData && typeof resData === 'object' && 'basket' in resData) return (resData as any).basket;
  return resData as BusinessBasketFromAPI;
}

export async function deleteBasket(id: number | string): Promise<void> {
  console.log('[Business] Deleting basket:', id);
  await apiClient.delete(`/api/baskets/${id}`);
}

// ─── Quantity & Availability ────────────────────────────────────────────────

export async function updateQuantity(availableQuantity: number): Promise<void> {
  console.log('[Business] Updating quantity to:', availableQuantity);
  await apiClient.put('/api/restaurants/my/quantity', { available_quantity: availableQuantity });
}

export async function updateAvailability(data: {
  availability_status?: string;
  is_paused?: boolean;
  pickup_start_time?: string;
  pickup_end_time?: string;
  available_quantity?: number;
  default_daily_quantity?: number;
}, userId?: number): Promise<void> {
  console.log('[Business] Updating availability:', JSON.stringify(data));
  const headers: Record<string, string> = {};
  if (userId) {
    headers['x-admin-token'] = getAdminToken(userId);
    console.log('[Business] Attaching x-admin-token for availability update');
  }
  await apiClient.put('/api/restaurants/my/availability', data, { headers });
}

// ─── Today's Orders ─────────────────────────────────────────────────────────

export interface TodayReservationFromAPI {
  id: number | string;
  buyer_id?: number;
  restaurant_id?: number;
  quantity?: number;
  reservation_date?: string;
  status?: string;
  pickup_code?: string;
  qr_code?: string;
  created_at?: string;
  buyer_name?: string;
  buyer_phone?: string;
  buyer_email?: string;
  price_tier?: string;
  original_price?: string;
  [key: string]: unknown;
}

export async function fetchTodayOrders(): Promise<TodayReservationFromAPI[]> {
  console.log('[Business] Fetching today orders');
  const res = await apiClient.get<TodayReservationFromAPI[] | { reservations: TodayReservationFromAPI[] } | { data: TodayReservationFromAPI[] }>('/api/reservations/restaurant/today');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'reservations' in data) return (data as any).reservations;
  if (data && typeof data === 'object' && 'data' in data) return (data as any).data;
  return [];
}

export async function confirmPickup(reservationId: number | string, pickupCode: string, buyerId?: number | string): Promise<void> {
  console.log('[Business] Confirming pickup:', reservationId);
  const payload: Record<string, unknown> = { pickup_code: pickupCode };
  if (buyerId !== undefined && buyerId !== null) {
    payload.buyer_id = buyerId;
  }
  await apiClient.post(`/api/reservations/${reservationId}/confirm-pickup`, payload);
}

export async function verifyQR(qrData: string): Promise<{ valid: boolean; reservation_id?: string; buyer_id?: number; buyer_name?: string; quantity?: number; pickup_code?: string; status?: string }> {
  console.log('[Business] Verifying QR code');
  // Backend expects { reservation_id, pickup_code } parsed from the QR JSON
  let reservation_id: string | undefined;
  let pickup_code: string | undefined;
  try {
    const parsed = JSON.parse(qrData);
    reservation_id = parsed.reservation_id ? String(parsed.reservation_id) : undefined;
    pickup_code = parsed.pickup_code ?? undefined;
  } catch {
    // Not JSON, treat as raw pickup code
    pickup_code = qrData.trim();
  }
  if (!reservation_id || !pickup_code) {
    throw new Error('Invalid QR code data');
  }
  const res = await apiClient.post<{ valid: boolean; reservation_id?: string; buyer_id?: number; buyer_name?: string; quantity?: number; pickup_code?: string; status?: string }>('/api/reservations/verify-qr', { reservation_id, pickup_code });
  return res.data;
}

// ─── Stats & Analytics ──────────────────────────────────────────────────────

export interface BusinessStatsFromAPI {
  total_reservations?: number;
  total_completed?: number;
  total_cancelled?: number;
  total_revenue?: number;
  today_baskets?: number;
  today_revenue?: number;
  monthly_baskets?: number;
  monthly_revenue?: number;
  average_rating?: number;
  [key: string]: unknown;
}

export interface BusinessAnalyticsFromAPI {
  daily_sales?: number[];
  weekly_sales?: number[];
  weekly?: { day: string; dayName: string; baskets_sold: number; revenue: number }[];
  monthly?: { month: string; monthName: string; baskets_sold: number; revenue: number }[];
  statusBreakdown?: { confirmed: number; picked_up: number; cancelled: number };
  summary?: { revenue_today: number; baskets_sold_today: number; baskets_reserved_today: number; pickups_today: number };
  performance?: Record<string, { value: number; change: number }>;
  price_tier?: number;
  [key: string]: unknown;
}

export async function fetchStats(): Promise<BusinessStatsFromAPI> {
  console.log('[Business] Fetching stats');
  const res = await apiClient.get<BusinessStatsFromAPI | { data: BusinessStatsFromAPI }>('/api/reservations/restaurant/stats');
  const data = res.data;
  if (data && typeof data === 'object' && 'data' in data && !('total_reservations' in data)) return (data as any).data;
  return data as BusinessStatsFromAPI;
}

export async function fetchAnalytics(): Promise<BusinessAnalyticsFromAPI> {
  console.log('[Business] Fetching analytics');
  const res = await apiClient.get<BusinessAnalyticsFromAPI | { data: BusinessAnalyticsFromAPI }>('/api/reservations/restaurant/analytics');
  const data = res.data;
  if (data && typeof data === 'object' && 'data' in data && !('daily_sales' in data)) return (data as any).data;
  return data as BusinessAnalyticsFromAPI;
}

// ─── Menu Items ─────────────────────────────────────────────────────────────

export interface MenuItemFromAPI {
  id: number;
  restaurant_id?: number;
  name: string;
  description?: string | null;
  price?: string | number | null;
  image_url?: string | null;
  created_at?: string;
}

export async function fetchMyMenuItems(): Promise<MenuItemFromAPI[]> {
  console.log('[Business] Fetching my menu items');
  const res = await apiClient.get<MenuItemFromAPI[] | { items: MenuItemFromAPI[] }>('/api/restaurants/my/menu-items');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'items' in data) return (data as any).items;
  return [];
}

export async function addMenuItem(formData: FormData): Promise<MenuItemFromAPI> {
  console.log('[Business] Adding menu item');
  const res = await apiClient.post<MenuItemFromAPI | { item: MenuItemFromAPI }>('/api/restaurants/my/menu-items', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const data = res.data;
  if (data && typeof data === 'object' && 'item' in data) return (data as any).item;
  return data as MenuItemFromAPI;
}

export async function deleteMenuItem(itemId: number | string): Promise<void> {
  console.log('[Business] Deleting menu item:', itemId);
  await apiClient.delete(`/api/restaurants/my/menu-items/${itemId}`);
}

// ─── Notifications ──────────────────────────────────────────────────────────

export async function fetchRestaurantNotifications(): Promise<unknown[]> {
  console.log('[Business] Fetching notifications');
  const res = await apiClient.get<unknown[] | { notifications: unknown[] }>('/api/reservations/restaurant/notifications');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'notifications' in data) return (data as any).notifications;
  return [];
}
