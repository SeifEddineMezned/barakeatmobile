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

export async function submitReport(data: SubmitReportRequest): Promise<void> {
  console.log('[Reports] Submitting report for location:', data.location_id ?? data.restaurant_id);
  await apiClient.post('/api/reviews/report', data);
}
