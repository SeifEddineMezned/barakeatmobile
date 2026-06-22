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

// Verify the user's current password without changing anything. Powers the
// "confirm password" first step of the change-password and change-email
// full-page flows so the user gets immediate feedback on page 1 instead of
// being forwarded to page 2/3 only to fail at the final submit.
//
// `retryOnNetworkError: true` — non-mutating bcrypt-compare (no state change),
// so it's safe to retry. The axios layer in api.ts only auto-retries POSTs
// when this flag is on; without it, the first call after a cold start
// (Railway dyno waking, fresh TLS handshake) fails as "Network Error" and
// the user sees the popup until they manually retry. The user kept hitting
// exactly that on this endpoint — opting in fixes it without changing
// behaviour for successful calls.
export async function verifyCurrentPassword(password: string): Promise<void> {
  console.log('[Profile] Verifying current password');
  await apiClient.post(
    '/api/users/verify-password',
    { password },
    { retryOnNetworkError: true } as any,
  );
}

// First-login password set — no current password required. The backend's
// PUT /api/users/password treats `password_changed_at === null` (admin-created
// business accounts) as a first login and accepts a new password without the
// current one. Used by the business onboarding "set your password" step.
export async function setFirstLoginPassword(newPassword: string): Promise<void> {
  console.log('[Profile] Setting first-login password');
  await apiClient.put('/api/users/password', { newPassword });
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
