import { apiClient } from '@/src/lib/api';
import { saveToken, saveUser, clearSession } from '@/src/lib/session';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  phone?: string;       // optional — customers no longer provide a phone number
  gender?: 'male' | 'female' | null; // optional — customer gender step (skippable)
  type: 'buyer' | 'restaurant'; // backend uses `type`, NOT `role`
  // Two-letter UI language (fr/en/ar). Backend uses this to pick the
  // verification-OTP email template so the email matches what the user is
  // looking at on the verify-email screen. Optional — defaults to 'fr'.
  locale?: 'fr' | 'en' | 'ar';
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    name: string;
    firstName?: string;
    email: string;
    phone?: string;
    role?: string;
    // Backend `provider` column: 'local' | 'google' | 'apple'.
    provider?: 'local' | 'google' | 'apple';
    /** Persisted gender — null when the user skipped the picker on signup. */
    gender?: 'male' | 'female' | null;
    /** OAuth-only: false when this user hasn't seen the onboarding screen.
     *  The Apple/Google handlers in sign-in.tsx route to /auth/onboarding
     *  when this is false instead of dropping the user straight into the
     *  app. Local + restaurant sign-in flows always treat it as true. */
    onboardingCompleted?: boolean;
    /** OAuth-only: true if the user should be prompted for their name on
     *  the onboarding screen (Apple users who skipped name share; legacy
     *  rows whose stored name is a localized "Inconnu"/"Unknown"
     *  placeholder). Google never sets this. */
    nameNeedsInput?: boolean;
    /** OAuth-only: true if gender is null and the onboarding screen
     *  should show the picker. Independently optional from name input. */
    genderNeedsInput?: boolean;
    /** Server-stored avatar URL (preset silhouette or uploaded photo). */
    avatar?: string | null;
  };
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  console.log('[Auth] Logging in with:', data.email);
  const res = await apiClient.post<AuthResponse>('/api/auth/login', data);
  // DON'T persist session here — let the caller (sign-in.tsx) verify role match first
  // and call authStore.signIn() which now handles persistence
  console.log('[Auth] Login successful, user:', res.data.user.name);
  return res.data;
}

/**
 * Pre-signup email availability check, scoped by account type, so the customer
 * flow can validate the email at "Continue" (before the gender step) instead of
 * only on the final register call. A restaurant email is still "available" for a
 * buyer. On any network/server failure we assume available so signup is never
 * hard-blocked by a flaky check — register() re-validates authoritatively.
 */
export async function checkEmailAvailable(
  email: string,
  type: 'buyer' | 'restaurant' = 'buyer',
): Promise<boolean> {
  try {
    const res = await apiClient.post<{ available: boolean }>(
      '/api/auth/check-email',
      { email, type },
      { retryOnNetworkError: true } as any,
    );
    return res.data?.available !== false;
  } catch (err) {
    console.log('[Auth] check-email failed, assuming available:', err);
    return true;
  }
}

// Response shape from /api/auth/register. Buyer signups always return the
// `requiresVerification` branch (no token/user yet) — the caller must route
// the user to the verify-email screen. Restaurant/admin-created accounts go
// through different endpoints; they're not in this client.
export interface RegisterResponse {
  requiresVerification: true;
  userId: number;
  email: string;
}

export async function register(data: RegisterRequest): Promise<RegisterResponse> {
  console.log('[Auth] Registering with payload:', JSON.stringify({
    name: data.name,
    email: data.email,
    phone: data.phone,
    type: data.type,
    locale: data.locale,
    password: '[hidden]',
  }));
  const res = await apiClient.post<RegisterResponse>('/api/auth/register', data);
  // We do NOT persist a session here — the user has to verify their email via
  // OTP before any token is issued. verifySignupOtp() below handles that.
  console.log('[Auth] Registration successful, OTP sent to:', res.data.email);
  return res.data;
}

// Submit the 6-digit OTP from the verify-email screen. On success the backend
// returns a fresh session token + user — caller should save them via the auth
// store (signIn) before navigating into the tabs.
export async function verifySignupOtp(email: string, otp: string): Promise<AuthResponse> {
  const res = await apiClient.post<AuthResponse>('/api/auth/verify-signup-otp', { email, otp });
  return res.data;
}

// Re-send the signup OTP. Backend rate-limits to one per 60 seconds and 429s
// if you hit the cooldown — the UI shows a countdown to match. `locale` is the
// current UI language so the re-sent email matches whatever the verify-email
// screen is showing now (the user may have switched language since the
// original send).
export async function resendSignupVerificationOtp(email: string, locale?: 'fr' | 'en' | 'ar'): Promise<void> {
  console.log('[Auth] Resending signup OTP — email:', email, '| locale:', locale);
  await apiClient.post('/api/auth/resend-signup-verification', { email, locale });
}

// Drop the in-flight signup staging row. Called when the user explicitly
// backs out of the verify-email screen so the same email can be re-registered
// without a confusing 409 / pending-OTP collision. Safe to call when no
// pending row exists (server treats it as idempotent).
export async function abortSignup(email: string, kind: 'buyer' | 'restaurant' = 'buyer'): Promise<void> {
  await apiClient.post('/api/auth/abort-signup', { email, kind });
}

export async function forgotPassword(email: string, accountType?: string): Promise<void> {
  console.log('[Auth] Forgot password for:', email, accountType ? `(type: ${accountType})` : '');
  await apiClient.post('/api/auth/forgot-password', { identifier: email, accountType });
}

export async function verifyResetOtp(identifier: string, otp: string): Promise<string> {
  // Backend returns { success, token, requiresPasswordChange, email }
  const res = await apiClient.post<{ token: string }>('/api/auth/verify-reset-otp', { identifier, otp });
  return res.data.token;
}

export async function resetPassword(resetToken: string, newPassword: string): Promise<void> {
  // Backend validates the OTP-granted JWT via Authorization header, body only needs newPassword
  await apiClient.post('/api/auth/reset-password', { newPassword }, {
    headers: { Authorization: `Bearer ${resetToken}` },
  });
}

export interface RestaurantAccessRequest {
  name: string;
  restaurantName: string;
  email: string;
  phone?: string;
  address?: string;
  category?: string;
}

export interface RestaurantAccessResponse {
  success: true;
  requiresVerification: true;
  email: string;
  requestId: number;
  message?: string;
}

export async function restaurantAccessRequest(data: RestaurantAccessRequest): Promise<RestaurantAccessResponse> {
  const res = await apiClient.post<RestaurantAccessResponse>('/api/auth/restaurant-access/request', data);
  return res.data;
}

// Restaurant signup OTP — mirrors the buyer flow but lands on the
// business-success thank-you screen instead of issuing a session JWT. The
// commerce account is only created once the Barakeat team approves the
// request from the admin dashboard.
export async function verifyRestaurantSignupOtp(email: string, otp: string): Promise<void> {
  await apiClient.post('/api/auth/restaurant-access/verify-otp', { email, otp });
}

export async function resendRestaurantSignupOtp(email: string): Promise<void> {
  await apiClient.post('/api/auth/restaurant-access/resend-otp', { email });
}

export async function loginWithGoogle(accessToken: string, idToken: string): Promise<AuthResponse> {
  console.log('[Auth] Logging in with Google idToken');
  const res = await apiClient.post<AuthResponse>('/api/auth/google', { accessToken, idToken });
  // DON'T persist session here — caller verifies role match first
  console.log('[Auth] Google login successful, user:', res.data.user.name);
  return res.data;
}

export async function loginWithApple(identityToken: string, fullName?: string): Promise<AuthResponse> {
  console.log('[Auth] Logging in with Apple identityToken');
  const res = await apiClient.post<AuthResponse>('/api/auth/apple', { identityToken, fullName });
  // DON'T persist session here — caller verifies role match first
  console.log('[Auth] Apple login successful, user:', res.data.user.name);
  return res.data;
}

export interface DeleteAccountOptions {
  /** Org admin id to inherit org ownership from the leaving owner. */
  transferTo?: number;
  /** Owner-only: dissolve the entire org alongside the owner's account. */
  deleteOrg?: boolean;
}

export async function deleteAccount(opts: DeleteAccountOptions = {}): Promise<void> {
  console.log('[Auth] Requesting account deletion', opts);
  // axios DELETE needs the payload under `data` to actually send a body.
  await apiClient.delete('/api/auth/account', { data: opts } as any);
  await clearSession();
  console.log('[Auth] Account deleted and session cleared');
}

export async function logout(): Promise<void> {
  // Clear THIS device's push token on the backend FIRST — while the JWT is
  // still present so the DELETE authenticates. Otherwise the server keeps the
  // account↔device link and this phone keeps receiving that account's push
  // notifications after sign-out (the "logged out but still getting pushes"
  // bug). The DELETE clears both the Expo push_token and the native fcm_token.
  try {
    const { unregisterPushNotifications } = require('@/src/services/pushNotifications');
    await unregisterPushNotifications();
  } catch {}
  await clearSession();
  console.log('[Auth] Logged out');
}

// Complete the first-login onboarding step for OAuth users. Every field
// is optional individually; the server still flips
// `onboarding_completed = true` so the user is never re-routed to the
// onboarding screen on a future sign-in. Returns the now-current user
// row so the auth store can patch its cached profile without a separate
// /me round-trip.
export interface OnboardingProfilePatch {
  gender?: 'male' | 'female' | null;
  name?: string;
  /** Frontend-resolved avatar token (e.g. 'silhouette://male' or a
   *  remote URL). The backend stores it on the user row verbatim. */
  avatar?: string;
}
export interface OnboardingProfileResponse {
  success: true;
  user: {
    id: string;
    email: string;
    type: string;
    name: string;
    avatar: string | null;
    gender: 'male' | 'female' | null;
    onboardingCompleted: boolean;
    /** OAuth gender step done — decoupled from onboardingCompleted so the
     *  welcome carousel / demo / address prompt still fires afterwards. */
    genderStepCompleted?: boolean;
  } | null;
}
export async function updateOnboardingProfile(
  patch: OnboardingProfilePatch,
): Promise<OnboardingProfileResponse> {
  console.log('[Auth] Updating onboarding profile:', patch);
  const res = await apiClient.put<OnboardingProfileResponse>(
    '/api/auth/me/onboarding',
    patch,
  );
  return res.data;
}
