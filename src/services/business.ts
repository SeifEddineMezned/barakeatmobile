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
  average_rating?: number;
  organization_id?: number | null;
  reserved_today?: number;
  permissions?: Record<string, unknown> | null;
  // Organization/location fields (new model)
  org_name?: string | null;
  display_name?: string | null;
  location_name?: string | null;
  team_context?: { role?: string; permissions?: Record<string, unknown> | null; organization_id?: number } | null;
}

export async function fetchMyProfile(locationId?: number | string | null): Promise<BusinessProfileFromAPI> {
  const params = locationId ? `?location_id=${locationId}` : '';
  console.log('[Business] Fetching my profile', params);
  const res = await apiClient.get<BusinessProfileFromAPI | { restaurant: BusinessProfileFromAPI } | { data: BusinessProfileFromAPI }>(`/api/locations/my/profile${params}`);
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
  const res = await apiClient.put<BusinessProfileFromAPI | { restaurant: BusinessProfileFromAPI }>('/api/locations/my/profile', formData, { headers });
  const data = res.data;
  if (data && typeof data === 'object' && 'restaurant' in data) return (data as any).restaurant;
  return data as BusinessProfileFromAPI;
}

// ─── Baskets ────────────────────────────────────────────────────────────────

export interface BusinessBasketFromAPI {
  id: number;
  restaurant_id?: number;
  location_id?: number;
  name: string;
  description?: string | null;
  category?: string | null;
  original_price?: string | number;
  selling_price?: string | number;
  quantity?: number;
  daily_reinitialization_quantity?: number;
  restaurant_available_quantity?: number | null;
  pickup_start_time?: string | null;
  pickup_end_time?: string | null;
  image_url?: string | null;
  status?: string | null;
  menu_item_ids?: number[] | null;
  created_at?: string;
  updated_at?: string;
}

export async function fetchMyBaskets(locationId?: number | string | null): Promise<BusinessBasketFromAPI[]> {
  const locId = (locationId && typeof locationId === 'object') ? null : locationId;
  const params = locId ? `?location_id=${locId}` : '';
  console.log('[Business] Fetching my baskets', params);
  const res = await apiClient.get<BusinessBasketFromAPI[] | { baskets: BusinessBasketFromAPI[] } | { data: BusinessBasketFromAPI[] }>(`/api/baskets/my/baskets${params}`);
  const data = res.data;
  let baskets: BusinessBasketFromAPI[] = [];
  if (Array.isArray(data)) baskets = data;
  else if (data && typeof data === 'object' && 'baskets' in data) baskets = (data as any).baskets;
  else if (data && typeof data === 'object' && 'data' in data) baskets = (data as any).data;
  console.log('[Business] Baskets raw:', baskets.map(b => ({ id: b.id, quantity: b.quantity, daily_reinitialization_quantity: b.daily_reinitialization_quantity, status: b.status })));
  return baskets;
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
  menu_item_ids?: number[];
  show_menu_items?: boolean;
  pickup_instructions?: string;
  location_id?: number;
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
  await apiClient.put('/api/locations/my/quantity', { available_quantity: availableQuantity });
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
  await apiClient.put('/api/locations/my/availability', data, { headers });
}

// Cascading location hours update — tries every known backend variant in order.
// Stops at first success; throws the last error if all fail.
export async function updatePickupHours(
  locationId: number | string,
  orgId: number | string | undefined,
  data: { pickup_start_time: string; pickup_end_time: string },
  userId?: number
): Promise<void> {
  const adminHeaders: Record<string, string> = {};
  if (userId) {
    adminHeaders['x-admin-token'] = getAdminToken(userId);
  }
  const attempts: Array<() => Promise<unknown>> = [
    // 1. Teams PUT (org-scoped)
    ...(orgId
      ? [() => apiClient.put(`/api/teams/organizations/${orgId}/locations/${locationId}`, data, { headers: adminHeaders })]
      : []
    ),
    // 2. PATCH availability (with admin token)
    () => apiClient.patch('/api/locations/my/availability', data, { headers: adminHeaders }),
    // 3. PATCH availability (no admin token)
    () => apiClient.patch('/api/locations/my/availability', data),
    // 4. PUT availability (no admin token)
    () => apiClient.put('/api/locations/my/availability', data),
    // 4a. PUT availability WITH location_id+organization_id in body
    //     — server's WHERE clause may need these to find the right row
    () => apiClient.put('/api/locations/my/availability', {
      ...data,
      location_id: locationId,
      organization_id: orgId,
    }, { headers: adminHeaders }),
    // 4b. PUT availability with location_id as query param
    () => apiClient.put(`/api/locations/my/availability?location_id=${locationId}`, data, { headers: adminHeaders }),
    // 4c. POST variant — some backends use POST for upsert-style updates
    () => apiClient.post('/api/locations/my/availability', data, { headers: adminHeaders }),
    // 5. Basket update fallback — profile.available_quantity is joined from baskets,
    //    so pickup_start_time is likely also sourced from baskets. Updating all
    //    baskets' pickup times should update the profile display.
    async () => {
      console.log('[Business] Attempting basket pickup_time update fallback…');
      const res = await apiClient.get<any>('/api/baskets/my/baskets');
      const baskets: any[] = Array.isArray(res.data)
        ? res.data
        : (res.data?.baskets ?? res.data?.data ?? []);
      if (baskets.length === 0) throw new Error('No baskets found for location');
      await Promise.all(
        baskets.map((b: any) =>
          apiClient.put(`/api/baskets/${b.id}`, {
            pickup_start_time: data.pickup_start_time,
            pickup_end_time: data.pickup_end_time,
          })
        )
      );
    },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      console.log('[Business] updatePickupHours attempt…');
      await attempt();
      console.log('[Business] updatePickupHours succeeded');
      return; // ← stop on first success
    } catch (err: any) {
      console.log('[Business] updatePickupHours attempt failed:', err?.status, err?.message);
      lastError = err;
      // Continue to next attempt on 404 or 500
      if (err?.status !== 404 && err?.status !== 500) throw err; // auth errors etc: fail fast
    }
  }
  throw lastError;
}

// Update location — handles pickup times via cascade, other fields via direct PUT
export async function updateLocationById(
  locationId: number | string,
  data: Record<string, any>,
  userId?: number,
  orgId?: number | string
): Promise<void> {
  // Pickup times use the existing cascade (tries multiple endpoints)
  if (data.pickup_start_time || data.pickup_end_time) {
    await updatePickupHours(locationId, orgId, {
      pickup_start_time: data.pickup_start_time ?? '',
      pickup_end_time: data.pickup_end_time ?? '',
    }, userId);
  }
  // Other fields (pickup_instructions, etc.) go directly to teams endpoint
  const extraFields = { ...data };
  delete extraFields.pickup_start_time;
  delete extraFields.pickup_end_time;
  if (Object.keys(extraFields).length > 0 && orgId) {
    const adminHeaders: Record<string, string> = {};
    if (userId) adminHeaders['x-admin-token'] = getAdminToken(userId);
    await apiClient.put(`/api/teams/organizations/${orgId}/locations/${locationId}`, extraFields, { headers: adminHeaders });
  }
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

export async function fetchTodayOrders(locationId?: number | string | null): Promise<TodayReservationFromAPI[]> {
  const params = locationId ? `?location_id=${locationId}` : '';
  console.log('[Business] Fetching today orders', params);
  const res = await apiClient.get<TodayReservationFromAPI[] | { reservations: TodayReservationFromAPI[] } | { data: TodayReservationFromAPI[] }>(`/api/reservations/location/today${params}`);
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

export async function fetchStats(locationId?: number | string | null): Promise<BusinessStatsFromAPI> {
  const params = locationId ? `?location_id=${locationId}` : '';
  console.log('[Business] Fetching stats', params);
  const res = await apiClient.get<any>(`/api/reservations/location/stats${params}`);
  let data: any = res.data;
  // Unwrap common API envelope shapes: { stats: {...} } or { data: {...} }
  if (data && typeof data === 'object') {
    if ('stats' in data && data.stats && typeof data.stats === 'object') {
      data = data.stats;
    } else if ('data' in data && data.data && typeof data.data === 'object' && !('total_reservations' in data)) {
      data = data.data;
    }
  }
  return data as BusinessStatsFromAPI;
}

export async function fetchAnalytics(locationId?: number | string | null): Promise<BusinessAnalyticsFromAPI> {
  const params = locationId ? `?location_id=${locationId}` : '';
  console.log('[Business] Fetching analytics', params);
  const res = await apiClient.get<any>(`/api/reservations/location/analytics${params}`);
  let data: any = res.data;
  // Unwrap common API envelope shapes: { analytics: {...} } or { data: {...} }
  if (data && typeof data === 'object') {
    if ('analytics' in data && data.analytics && typeof data.analytics === 'object') {
      data = data.analytics;
    } else if (
      'data' in data &&
      data.data &&
      typeof data.data === 'object' &&
      !('weekly' in data) &&
      !('daily_sales' in data) &&
      !('summary' in data)
    ) {
      data = data.data;
    }
  }
  // Normalize snake_case → camelCase field names so the dashboard doesn't need to branch
  if (data && typeof data === 'object') {
    // status_breakdown → statusBreakdown
    if ('status_breakdown' in data && !('statusBreakdown' in data)) {
      data = { ...data, statusBreakdown: data.status_breakdown };
    }
    // weekly: day_name → dayName
    if (Array.isArray(data.weekly) && data.weekly.length > 0 && 'day_name' in data.weekly[0] && !('dayName' in data.weekly[0])) {
      data = { ...data, weekly: data.weekly.map((d: any) => ({ ...d, dayName: d.day_name })) };
    }
    // monthly: month_name → monthName
    if (Array.isArray(data.monthly) && data.monthly.length > 0 && 'month_name' in data.monthly[0] && !('monthName' in data.monthly[0])) {
      data = { ...data, monthly: data.monthly.map((m: any) => ({ ...m, monthName: m.month_name })) };
    }
  }
  console.log('[Business] Analytics normalized:', JSON.stringify({ weekly: data?.weekly?.length, monthly: data?.monthly?.length, statusBreakdown: data?.statusBreakdown }));
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
  const res = await apiClient.get<MenuItemFromAPI[] | { items: MenuItemFromAPI[] }>('/api/locations/my/menu-items');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'items' in data) return (data as any).items;
  return [];
}

export async function addMenuItem(formData: FormData): Promise<MenuItemFromAPI> {
  console.log('[Business] Adding menu item');
  const res = await apiClient.post<MenuItemFromAPI | { item: MenuItemFromAPI }>('/api/locations/my/menu-items', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const data = res.data;
  if (data && typeof data === 'object' && 'item' in data) return (data as any).item;
  return data as MenuItemFromAPI;
}

export async function deleteMenuItem(itemId: number | string): Promise<void> {
  console.log('[Business] Deleting menu item:', itemId);
  await apiClient.delete(`/api/locations/my/menu-items/${itemId}`);
}

export async function fetchBasketMenuItems(basketId: number | string): Promise<MenuItemFromAPI[]> {
  console.log('[Business] Fetching menu items for basket:', basketId);
  const res = await apiClient.get<MenuItemFromAPI[] | { items: MenuItemFromAPI[] }>(`/api/baskets/${basketId}/menu-items`);
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'items' in data) return (data as any).items;
  return [];
}

// ─── Notifications ──────────────────────────────────────────────────────────

export async function fetchRestaurantNotifications(): Promise<unknown[]> {
  console.log('[Business] Fetching notifications');
  const res = await apiClient.get<unknown[] | { notifications: unknown[] }>('/api/reservations/location/notifications');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'notifications' in data) return (data as any).notifications;
  return [];
}
