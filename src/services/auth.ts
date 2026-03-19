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
  phone?: string;
  role?: string;
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
  const { token, user } = res.data;
  await saveToken(token);
  await saveUser(user);
  console.log('[Auth] Login successful, user:', user.name);
  return res.data;
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  console.log('[Auth] Registering:', data.email);
  const res = await apiClient.post<AuthResponse>('/api/auth/register', data);
  const { token, user } = res.data;
  await saveToken(token);
  await saveUser(user);
  console.log('[Auth] Registration successful, user:', user.name);
  return res.data;
}

export async function forgotPassword(email: string): Promise<void> {
  console.log('[Auth] Forgot password for:', email);
  await apiClient.post('/api/auth/forgot-password', { email });
}

export async function verifyResetOtp(email: string, otp: string): Promise<void> {
  await apiClient.post('/api/auth/verify-reset-otp', { email, otp });
}

export async function resetPassword(email: string, otp: string, newPassword: string): Promise<void> {
  await apiClient.post('/api/auth/reset-password', { email, otp, newPassword });
}

export async function logout(): Promise<void> {
  await clearSession();
  console.log('[Auth] Logged out');
}
