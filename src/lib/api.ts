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
  // 30s, not 15s. Write endpoints like POST /api/reservations and the cancel
  // DELETE do inline notification fan-out to every business member, which on a
  // slow network can push the round-trip past 15s WHILE the server has already
  // committed. That produced "pas de connexion" errors on actions that had in
  // fact gone through. A roomier timeout makes those ghost failures rare; the
  // reserve/cancel flows also verify-and-recover on a network error as a backstop.
  timeout: 30000,
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

// 429 retry layer. The backend's express-rate-limit returns 429 with
// standardHeaders enabled, so we get a `Retry-After` (in seconds) when
// it knows; when it doesn't, we fall back to jittered exponential
// backoff. Only safe methods (GET/HEAD) retry — POST/PUT/DELETE that
// were rate-limited should fail loudly so the caller can surface it
// to the user instead of silently double-writing.
const MAX_429_RETRIES = 3;
// Transient "Network Error" (axios got NO response — a Railway dyno waking from
// idle, a brief connectivity blip, etc.) shows up as `undefined` status. Retry
// these for safe requests so the first action after the app sat idle doesn't
// hard-fail. GET/HEAD always qualify; a non-idempotent request can opt in with
// `retryOnNetworkError: true` (used by read-only POSTs like verify-qr).
const MAX_NETWORK_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      const message =
        (data as any)?.message ||
        (data as any)?.error ||
        error.message ||
        'An unexpected error occurred';

      // 429 — back off and retry GET/HEAD requests. Without this, the
      // polling timers across the app would keep firing on schedule
      // even after the server told us to slow down.
      const cfg = error.config as (typeof error.config & { _429Attempt?: number; _netAttempt?: number; retryOnNetworkError?: boolean }) | undefined;
      const method = (cfg?.method ?? 'get').toLowerCase();
      const idempotent = method === 'get' || method === 'head';

      // Transient network failure (no response at all). Retry safe requests
      // before surfacing the error — this is what was showing up as
      // "[API] Error: undefined Network Error /api/reservations/verify-qr"
      // on the first scan after the backend had gone idle.
      const isNetworkError = !error.response;
      if (isNetworkError && cfg && (idempotent || cfg.retryOnNetworkError === true)) {
        const attempt = (cfg._netAttempt ?? 0) + 1;
        if (attempt <= MAX_NETWORK_RETRIES) {
          cfg._netAttempt = attempt;
          // 0.8s, 1.6s, 3.2s (+jitter) — long enough to outlast a cold start.
          const delayMs = Math.min(800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 300), 6_000);
          console.log('[API] network retry', attempt, 'in', delayMs, 'ms', cfg.url);
          await sleep(delayMs);
          return apiClient.request(cfg);
        }
        // Out of retries — fall through to the normal rejection.
      }

      if (status === 429 && cfg && idempotent) {
        const attempt = (cfg._429Attempt ?? 0) + 1;
        if (attempt <= MAX_429_RETRIES) {
          cfg._429Attempt = attempt;
          const retryAfterHeader =
            error.response?.headers?.['retry-after'] ??
            error.response?.headers?.['Retry-After'];
          let delayMs: number;
          if (retryAfterHeader != null) {
            // RFC 7231 lets Retry-After be either delta-seconds or HTTP-date.
            // The express-rate-limit middleware emits seconds.
            const asSeconds = Number(retryAfterHeader);
            delayMs = Number.isFinite(asSeconds) && asSeconds >= 0
              ? Math.min(asSeconds * 1000, 30_000)
              : 5_000;
          } else {
            // Jittered exponential backoff: 1s, 2s, 4s, capped at 15s.
            delayMs = Math.min(1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500), 15_000);
          }
          console.log('[API] 429 retry', attempt, 'in', delayMs, 'ms', cfg.url);
          cfg.headers = cfg.headers ?? {};
          (cfg.headers as any)['x-retry-attempt'] = String(attempt);
          await sleep(delayMs);
          return apiClient.request(cfg);
        }
        // Out of retries — fall through to the normal rejection so the
        // caller's onError gets a real signal instead of an endless loop.
      }

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

/**
 * Turns ANY thrown error into a clean, user-appropriate, TRANSLATED string.
 *
 * Guarantee: this never returns a raw/technical backend string (tokens, JWTs,
 * SQL, stack traces, English dev strings, etc.). Resolution order:
 *   1. If the raw message maps to a known i18n key → return that translation.
 *   2. Else, if the caller passed a `fallback` (already-translated) → use it.
 *   3. Else → a generic translated "an error occurred, please try again".
 *
 * Pass a context-specific `fallback` (e.g. t('business.team.updateFailed')) when
 * a tailored message reads better than the generic one for that screen.
 */
export function getErrorMessage(err: unknown, fallback?: string): string {
  let raw = '';
  if (isApiError(err)) {
    raw = err.message ?? '';
  } else if (err instanceof Error) {
    raw = err.message ?? '';
  } else if (typeof err === 'string') {
    raw = err;
  }

  // Lazily import i18n to avoid a circular dependency at module load.
  let i18n: { t: (k: string) => string } | null = null;
  try {
    i18n = require('@/src/i18n').default;
  } catch {
    i18n = null;
  }

  // 1. Known backend message → its translation.
  if (raw) {
    const i18nKey = mapErrorToI18nKey(raw);
    if (i18nKey && i18n) {
      const translated = i18n.t(i18nKey);
      // i18next returns the key itself when the key is missing — treat that as
      // "no translation" so we fall through to the fallback instead of showing
      // a raw key like "errors.loginFailed".
      if (translated && translated !== i18nKey) return translated;
    }
  }

  // 2/3. Never surface the raw/technical string — use the caller's fallback,
  // else a generic translated message.
  if (fallback) return fallback;
  if (i18n) {
    const generic = i18n.t('common.errorOccurred');
    if (generic && generic !== 'common.errorOccurred') return generic;
  }
  return 'Something went wrong. Please try again.';
}
