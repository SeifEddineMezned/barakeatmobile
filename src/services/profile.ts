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

export async function updatePassword(currentPassword: string, newPassword: string): Promise<void> {
  console.log('[Profile] Updating password');
  await apiClient.put('/api/users/password', { currentPassword, newPassword });
}

// Step 1: verify the current password and send a 6-digit confirmation code to
// the NEW email address. The email is NOT changed yet — the user must confirm
// the code via verifyEmailChange(). Returns the pending (new) email.
export async function requestEmailChange(currentPassword: string, newEmail: string): Promise<{ pendingEmail: string }> {
  console.log('[Profile] Requesting email change (sending code)');
  const res = await apiClient.put<{ pendingEmail?: string }>(
    '/api/users/email',
    { currentPassword, newEmail }
  );
  const data = res.data as any;
  return { pendingEmail: data?.pendingEmail ?? newEmail };
}

// Step 2: confirm the code sent to the new address and apply the change.
export async function verifyEmailChange(newEmail: string, otp: string): Promise<{ email: string }> {
  console.log('[Profile] Verifying email change code');
  const res = await apiClient.post<{ user?: { email: string }; email?: string }>(
    '/api/users/email/verify',
    { newEmail, otp }
  );
  const data = res.data as any;
  return { email: data?.user?.email ?? data?.email ?? newEmail };
}

export async function updateFoodPreferences(preferences: string[]): Promise<void> {
  console.log('[Profile] Updating food preferences');
  await apiClient.put('/api/users/preferences', { food_preferences: preferences });
}

export async function fetchUserProfile(): Promise<{ food_preferences?: string[]; [key: string]: unknown }> {
  console.log('[Profile] Fetching user profile');
  const res = await apiClient.get('/api/users/profile');
  const data = res.data;
  if (data && typeof data === 'object' && 'data' in data) return (data as any).data;
  return data as any;
}

export async function updateUserProfile(data: { name?: string; phone?: string; gender?: string }): Promise<void> {
  console.log('[Profile] Updating user profile');
  await apiClient.put('/api/users/profile', data);
}
