import { apiClient } from '@/src/lib/api';

export interface SubmitReportRequest {
  // location_id is the modern field; restaurant_id is accepted by the backend
  // for legacy reasons and is aliased to location_id server-side.
  location_id?: number | string;
  restaurant_id?: number | string;
  reservation_id?: number | string;
  reason: string;
  details?: string;
  /** Data URL (data:image/…;base64,…). Backend uploads to Cloudinary and stores
   *  the resulting URL on reports.image_url. Do NOT send a local file URI. */
  image_data_url?: string;
}

export interface SubmitReportResponse {
  message?: string;
  reference_number?: string;
  report?: {
    id: number;
    reference_number?: string;
    reason: string;
    details?: string;
    status?: string;
    image_url?: string | null;
    created_at?: string;
  };
}

export async function submitReport(data: SubmitReportRequest, idempotencyKey?: string): Promise<SubmitReportResponse> {
  console.log('[Reports] Submitting report for location:', data.location_id ?? data.restaurant_id);
  const key = idempotencyKey && idempotencyKey.length > 0 ? idempotencyKey : undefined;
  // Header is canonical; body field is a redundant fallback so a proxy that
  // strips custom headers still gets the dedup signal through. The backend
  // recognizes either and returns the cached report on replay.
  const res = await apiClient.post<SubmitReportResponse>(
    '/api/reviews/report',
    { ...data, client_request_id: key },
    key ? { headers: { 'Idempotency-Key': key } } : undefined
  );
  return res.data ?? {};
}
