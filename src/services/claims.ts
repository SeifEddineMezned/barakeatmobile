import { apiClient } from '@/src/lib/api';

export interface ClaimFromAPI {
  id: number;
  reference_number: string;
  reason: string;
  description?: string;
  status: string;
  restaurant_name?: string;
  image_url?: string | null;
  created_at: string;
}

export async function submitClaim(data: {
  reservation_id?: number;
  reason: string;
  description?: string;
  photoUri?: string | null;
}): Promise<ClaimFromAPI> {
  if (data.photoUri) {
    const formData = new FormData();
    formData.append('reason', data.reason);
    if (data.description) formData.append('description', data.description);
    if (data.reservation_id != null) formData.append('reservation_id', String(data.reservation_id));
    const filename = data.photoUri.split('/').pop() ?? 'claim.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const ext = (match?.[1] ?? 'jpg').toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    formData.append('image', { uri: data.photoUri, name: filename, type: mime } as any);
    const res = await apiClient.post<ClaimFromAPI>('/api/claims', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data as ClaimFromAPI;
  }
  const res = await apiClient.post<ClaimFromAPI>('/api/claims', {
    reservation_id: data.reservation_id,
    reason: data.reason,
    description: data.description,
  });
  return res.data as ClaimFromAPI;
}

export async function fetchMyClaims(): Promise<ClaimFromAPI[]> {
  const res = await apiClient.get<ClaimFromAPI[]>('/api/claims');
  const data = res.data;
  return Array.isArray(data) ? data : [];
}
