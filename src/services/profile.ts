import { apiClient } from '@/src/lib/api';

export interface OnboardingData {
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  [key: string]: unknown;
}

export async function fetchOnboarding(): Promise<OnboardingData> {
  console.log('[Profile] Fetching onboarding data');
  const res = await apiClient.get<OnboardingData | { data: OnboardingData }>('/api/auth/onboarding');
  const data = res.data;
  if (data && typeof data === 'object' && 'data' in data) {
    return (data as any).data;
  }
  return data as OnboardingData;
}

export async function updateOnboarding(data: OnboardingData): Promise<OnboardingData> {
  console.log('[Profile] Updating onboarding data');
  const res = await apiClient.put<OnboardingData | { data: OnboardingData }>('/api/auth/onboarding', data);
  const resData = res.data;
  if (resData && typeof resData === 'object' && 'data' in resData) {
    return (resData as any).data;
  }
  return resData as OnboardingData;
}

export async function fetchAvatar(): Promise<string | null> {
  console.log('[Profile] Fetching avatar');
  try {
    const res = await apiClient.get<{ url: string } | { avatar: string } | { data: string }>('/api/auth/avatar');
    const data = res.data;
    if (data && typeof data === 'object' && 'url' in data) return (data as any).url;
    if (data && typeof data === 'object' && 'avatar' in data) return (data as any).avatar;
    if (data && typeof data === 'object' && 'data' in data) return (data as any).data;
    return null;
  } catch {
    return null;
  }
}

export async function updateAvatar(formData: FormData): Promise<string | null> {
  console.log('[Profile] Updating avatar');
  try {
    const res = await apiClient.put('/api/auth/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const data = res.data;
    if (data && typeof data === 'object' && 'url' in data) return (data as any).url;
    if (data && typeof data === 'object' && 'avatar' in data) return (data as any).avatar;
    return null;
  } catch {
    return null;
  }
}
