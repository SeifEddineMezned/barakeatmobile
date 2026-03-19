import { apiClient } from '@/src/lib/api';

export interface CreateReservationRequest {
  restaurant_id: number;
  quantity: number;
}

export interface ReservationFromAPI {
  id: string;
  restaurant_id?: number;
  basketId?: string;
  basket?: {
    id: string;
    name?: string;
    merchantName?: string;
    merchant_name?: string;
    merchantLogo?: string;
    image_url?: string;
    originalPrice?: number;
    original_price?: string;
    discountedPrice?: number;
    price_tier?: string;
    pickupWindow?: { start: string; end: string };
    pickup_start_time?: string;
    pickup_end_time?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    quantityLeft?: number;
    quantityTotal?: number;
    imageUrl?: string;
    [key: string]: unknown;
  };
  restaurant?: {
    id: number;
    name?: string;
    address?: string;
    image_url?: string;
    price_tier?: string;
    original_price?: string;
    pickup_start_time?: string;
    pickup_end_time?: string;
    latitude?: number;
    longitude?: number;
    [key: string]: unknown;
  };
  quantity?: number;
  total?: number;
  total_price?: string;
  pickupWindow?: {
    start: string;
    end: string;
  };
  pickupCode?: string;
  pickup_code?: string;
  qrCode?: string;
  status?: string;
  createdAt?: string;
  created_at?: string;
  [key: string]: unknown;
}

export async function createReservation(data: CreateReservationRequest): Promise<ReservationFromAPI> {
  console.log('[Reservations] Creating reservation for restaurant:', data.restaurant_id, 'qty:', data.quantity);
  const res = await apiClient.post<ReservationFromAPI | { reservation: ReservationFromAPI } | { data: ReservationFromAPI }>('/api/reservations', {
    restaurant_id: data.restaurant_id,
    quantity: data.quantity,
  });
  const resData = res.data;
  let reservation: ReservationFromAPI;
  if (resData && typeof resData === 'object' && 'reservation' in resData) {
    reservation = (resData as any).reservation;
  } else if (resData && typeof resData === 'object' && 'data' in resData) {
    reservation = (resData as any).data;
  } else {
    reservation = resData as ReservationFromAPI;
  }
  console.log('[Reservations] Created reservation:', reservation.id);
  return reservation;
}

export async function fetchMyReservations(): Promise<ReservationFromAPI[]> {
  console.log('[Reservations] Fetching my reservations');
  const res = await apiClient.get<ReservationFromAPI[] | { reservations: ReservationFromAPI[] } | { data: ReservationFromAPI[] }>('/api/reservations/my/reservations');
  const data = res.data;
  let reservations: ReservationFromAPI[];
  if (Array.isArray(data)) {
    reservations = data;
  } else if (data && typeof data === 'object' && 'reservations' in data && Array.isArray((data as any).reservations)) {
    reservations = (data as any).reservations;
  } else if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as any).data)) {
    reservations = (data as any).data;
  } else {
    console.log('[Reservations] Unexpected response shape:', JSON.stringify(data).substring(0, 200));
    reservations = [];
  }
  console.log('[Reservations] Fetched', reservations.length, 'reservations');
  return reservations;
}

export async function fetchReservationQRCode(reservationId: string): Promise<string> {
  console.log('[Reservations] Fetching QR code for:', reservationId);
  const res = await apiClient.get<{ qrCode: string } | { data: string } | string>(`/api/reservations/${reservationId}/qrcode`);
  const data = res.data;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && 'qrCode' in data) return (data as any).qrCode;
  if (data && typeof data === 'object' && 'data' in data) return (data as any).data;
  return '';
}

export async function cancelReservation(reservationId: string): Promise<void> {
  console.log('[Reservations] Cancelling reservation:', reservationId);
  await apiClient.delete(`/api/reservations/${reservationId}`);
  console.log('[Reservations] Cancelled reservation:', reservationId);
}

export async function hideReservation(reservationId: string): Promise<void> {
  console.log('[Reservations] Hiding reservation:', reservationId);
  await apiClient.put(`/api/reservations/${reservationId}/hide`);
  console.log('[Reservations] Hidden reservation:', reservationId);
}
