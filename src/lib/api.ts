import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { mapErrorToI18nKey } from './errorMap';

// ─── Admin Token ─────────────────────────────────────────────────────────────
// The backend's requireRestaurantAdmin middleware validates x-admin-token as:
//   base64(userId + ':' + timestamp)  — must be < 2h old and userId must match
// Mobile restaurant owners are inherently admins, so we auto-generate this.

let _cachedAdminToken: string | null = null;
let _cachedAdminTokenTs = 0;
let _cachedAdminTokenUserId: number | null = null;
const ADMIN_TOKEN_TTL_MS = 90 * 60 * 1000; // 90 min (server allows 120 min)

export function getAdminToken(userId: number): string {
  const now = Date.now();
  const stale =
    !_cachedAdminToken ||
    _cachedAdminTokenUserId !== userId ||
    now - _cachedAdminTokenTs > ADMIN_TOKEN_TTL_MS;
  if (stale) {
    _cachedAdminToken = btoa(`${userId}:${now}`);
    _cachedAdminTokenTs = now;
    _cachedAdminTokenUserId = userId;
    console.log('[API] Generated new admin token for userId:', userId);
  }
  return _cachedAdminToken!;
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://barakeat-production.up.railway.app';
const TOKEN_KEY = 'barakeat_auth_token';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (err) {
      console.log('[API] Failed to read token from storage:', err);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      const message =
        (data as any)?.message ||
        (data as any)?.error ||
        error.message ||
        'An unexpected error occurred';

      console.log('[API] Error:', status, message, error.config?.url);

      return Promise.reject({
        status,
        message,
        data,
        isApiError: true,
      });
    }
    return Promise.reject(error);
  }
);

export interface ApiError {
  status?: number;
  message: string;
  data?: unknown;
  isApiError: boolean;
}

export function isApiError(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as any).isApiError === true;
}

export function getErrorMessage(err: unknown): string {
  let message = 'An unexpected error occurred';
  if (isApiError(err)) {
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  }
  // Try to find an i18n key for the message
  const i18nKey = mapErrorToI18nKey(message);
  if (i18nKey) {
    // Import i18n lazily to avoid circular deps
    try {
      const i18n = require('@/src/i18n').default;
      const translated = i18n.t(i18nKey);
      if (translated !== i18nKey) return translated;
    } catch {
      // i18n not available, fall through
    }
  }
  return message;
}
