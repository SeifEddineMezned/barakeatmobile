import { apiClient } from '@/src/lib/api';

export interface SubmitReportRequest {
  restaurant_id: number | string;
  reason: string;
  details?: string;
  image_url?: string;
}

export async function submitReport(data: SubmitReportRequest): Promise<void> {
  console.log('[Reports] Submitting report for restaurant:', data.restaurant_id);
  await apiClient.post('/api/reviews/report', data);
}
