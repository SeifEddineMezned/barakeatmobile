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
  phone: string;        // required by backend for buyer accounts
  type: 'buyer' | 'restaurant'; // backend uses `type`, NOT `role`
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

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  // Log the exact payload so it's visible in Expo logs
  console.log('[Auth] Registering with payload:', JSON.stringify({
    name: data.name,
    email: data.email,
    phone: data.phone,
    type: data.type,
    password: '[hidden]',
  }));
  const res = await apiClient.post<AuthResponse>('/api/auth/register', data);
  const { token, user } = res.data;
  await saveToken(token);
  await saveUser(user);
  console.log('[Auth] Registration successful, user:', user.name, '| type:', (user as any).type);
  return res.data;
}

export async function forgotPassword(email: string): Promise<void> {
  console.log('[Auth] Forgot password for:', email);
  // Backend expects `identifier` (email OR phone)
  await apiClient.post('/api/auth/forgot-password', { identifier: email });
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
}

export async function restaurantAccessRequest(data: RestaurantAccessRequest): Promise<void> {
  await apiClient.post('/api/auth/restaurant-access/request', data);
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

export async function deleteAccount(): Promise<void> {
  console.log('[Auth] Requesting account deletion');
  await apiClient.delete('/api/auth/account');
  await clearSession();
  console.log('[Auth] Account deleted and session cleared');
}

export async function logout(): Promise<void> {
  await clearSession();
  console.log('[Auth] Logged out');
}
