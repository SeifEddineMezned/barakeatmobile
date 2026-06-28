import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import { mapErrorToI18nKey } from './errorMap';

// Cached device connectivity. Lets error messages tell "you're offline" apart
// from "the server didn't answer" (e.g. a Railway dyno waking from idle) so we
// never wrongly blame the user's WiFi when it's actually working. Defaults to
// online — "we don't know yet" must never read as offline.
let _deviceOnline = true;
try {
  NetInfo.addEventListener((s) => {
    const raw = s.isInternetReachable ?? s.isConnected;
    _deviceOnline = raw !== false; // null/undefined → assume online
  });
} catch {
  // NetInfo unavailable (e.g. in some test envs) — stay optimistic.
}
export function isDeviceOnline(): boolean {
  return _deviceOnline;
}

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
    if (__DEV__) console.log('[API] Generated new admin token for userId:', userId);
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
      // Read the token via the shared session helper so this interceptor uses
      // the SAME SecureStore → AsyncStorage fallback the auth-restore path
      // uses. If only AsyncStorage has the token (because SecureStore went
      // bad on this device), the interceptor still populates the Authorization
      // header. Previously the interceptor only consulted SecureStore, so
      // every API request after a SecureStore corruption went out anonymous
      // — even when restoreSession had already recovered the session from
      // the AsyncStorage fallback.
      const { getToken } = require('./session');
      const token = await getToken();
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

// ─── Account-deleted handler ───────────────────────────────────────────────
// The backend's authenticateToken returns 401 { error: 'account_deleted' } when
// a signed-in user's account no longer exists — e.g. an admin removed/deleted
// this member (and the orphan-user cleanup dropped the users row) while they
// were still connected. We surface a one-time "this account has been deleted"
// popup and sign the user out. The guard makes the burst of polling requests
// that all 401 at once trigger only ONE popup. Reset on a fresh sign-in so a
// later account can trigger it again.
let _accountDeletedHandled = false;
export function resetAccountDeletedGuard(): void {
  _accountDeletedHandled = false;
}
// Pre-arm the guard so the popup does NOT fire — used by the intentional
// self-delete flow (the user is already deleting their own account and gets
// their own confirmation, so a background poll that races the local sign-out
// shouldn't surface a second "account deleted" popup).
export function suppressAccountDeletedPopup(): void {
  _accountDeletedHandled = true;
}
function handleAccountDeleted(): void {
  if (_accountDeletedHandled) return;
  _accountDeletedHandled = true;
  // Informational popup first (sync) so it's on screen immediately…
  try {
    const i18n = require('@/src/i18n').default;
    const { showGlobalAlert } = require('@/src/components/CustomAlert');
    showGlobalAlert(
      i18n.t('auth.accountDeletedTitle', { defaultValue: 'Compte supprimé' }),
      i18n.t('auth.accountDeletedBody', { defaultValue: 'Ce compte a été supprimé. Vous avez été déconnecté.' }),
      [{ text: i18n.t('common.continue', { defaultValue: 'Continuer' }) }],
      'warning',
    );
  } catch {}
  // …then sign out. Doing it NOW (not on popup-dismiss) means that however the
  // user leaves the popup — Continue, tapping outside, or killing the app — the
  // session is already cleared: the central auth guard routes them to sign-in,
  // and a relaunch finds no token (no popup loop). The popup, rendered by the
  // root CustomAlertProvider, survives that navigation and sits over sign-in.
  try {
    const { useAuthStore } = require('@/src/stores/authStore');
    void useAuthStore.getState().signOut();
  } catch {}
}

// ─── Location-deleted handler ──────────────────────────────────────────────
// The backend returns 410 { code: 'location_deleted', locationId } when an
// explicit ?location_id=X query refers to a soft-deleted (or hard-deleted)
// location — e.g. an admin removed it from the admin SPA while a business
// user was still working on it. We surface a one-time "this location has
// been deleted" popup, drop the local selectedLocationId if it matches,
// and invalidate every query that depends on the location so the business
// layout's auto-pick effect snaps the user to a still-valid location.
//
// Dedup per locationId: in a burst of failing queries (profile + baskets +
// orders all share the same selectedLocationId) only the FIRST one fires
// the popup; the rest see the id in the set and silently ride along on
// the invalidation. Reset on a fresh sign-in via resetAccountDeletedGuard()
// — see signIn in authStore which clears both guards in lockstep.
const _locationDeletedHandled = new Set<number>();
export function resetLocationDeletedGuard(): void {
  _locationDeletedHandled.clear();
}
function handleLocationDeleted(locationId: number): void {
  if (_locationDeletedHandled.has(locationId)) return;
  _locationDeletedHandled.add(locationId);

  // Synchronous popup so the user sees an explanation BEFORE the screen
  // re-renders empty.
  try {
    const i18n = require('@/src/i18n').default;
    const { showGlobalAlert } = require('@/src/components/CustomAlert');
    showGlobalAlert(
      i18n.t('business.locationDeletedTitle', { defaultValue: 'Emplacement supprimé' }),
      i18n.t('business.locationDeletedBody', {
        defaultValue:
          "Cet emplacement a été supprimé par un administrateur. "
          + "Un autre emplacement a été sélectionné automatiquement.",
      }),
      [{ text: i18n.t('common.continue', { defaultValue: 'Continuer' }) }],
      'warning',
    );
  } catch {}

  // Clear the stale selection so the (business)/_layout auto-pick effect
  // snaps to the first valid location on its next render. Guarded on a
  // matching id so a stray 410 from a stale query for a previous selection
  // doesn't wipe out a still-valid current selection.
  try {
    const { useBusinessStore } = require('@/src/stores/businessStore');
    const store = useBusinessStore.getState();
    if (Number(store.selectedLocationId) === Number(locationId)) {
      store.setSelectedLocationId(null);
    }
  } catch {}

  // Invalidate every query that's keyed on the location so screens refetch
  // against the new selection. Prefix-invalidation hits every cached key —
  // ['my-profile', locationId], ['my-baskets', locationId], etc.
  try {
    const { getGlobalQueryClient } = require('@/src/lib/queryClientRef');
    const qc = getGlobalQueryClient();
    if (qc) {
      qc.invalidateQueries({ queryKey: ['my-profile'] });
      qc.invalidateQueries({ queryKey: ['my-context'] });
      qc.invalidateQueries({ queryKey: ['org-details'] });
      qc.invalidateQueries({ queryKey: ['my-baskets'] });
      qc.invalidateQueries({ queryKey: ['my-orders'] });
    }
  } catch {}
}

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

      // Account no longer exists — the signed-in member was deleted/removed
      // while connected. Fire the one-time popup + sign-out and reject without
      // retrying (retrying would just 401 again and spin the polling timers).
      if (status === 401 && (data as any)?.error === 'account_deleted') {
        handleAccountDeleted();
        return Promise.reject({ status, message, data, isApiError: true });
      }

      // Location the user was working on was soft- or hard-deleted by the
      // admin while they were connected. Fire the one-time popup, drop the
      // local selection, and invalidate dependent queries — the business
      // layout's auto-pick effect then snaps them to a valid location.
      if (status === 410 && (data as any)?.code === 'location_deleted') {
        const deletedId = Number((data as any)?.locationId);
        if (Number.isFinite(deletedId)) handleLocationDeleted(deletedId);
        return Promise.reject({ status, message, data, isApiError: true });
      }

      // 429 — back off and retry GET/HEAD requests. Without this, the
      // polling timers across the app would keep firing on schedule
      // even after the server told us to slow down.
      const cfg = error.config as (typeof error.config & { _429Attempt?: number; _netAttempt?: number; retryOnNetworkError?: boolean; skip429Retry?: boolean }) | undefined;
      const method = (cfg?.method ?? 'get').toLowerCase();
      const idempotent = method === 'get' || method === 'head';

      // Transient network failure (no response at all). Retry before surfacing
      // the error — this is what was showing up as the instant "pas de connexion"
      // popup on the FIRST press of any button after the app/backend sat idle
      // (cold Railway dyno, DNS/TLS warm-up), where the second press worked.
      //
      // Only retry GET/HEAD (idempotent) or non-idempotent calls that explicitly
      // opt in via `retryOnNetworkError: true`. The earlier rule — "retry any
      // non-timeout network error regardless of verb" — was UNSAFE on Android
      // cellular: a slow POST can succeed on the server, then the response gets
      // dropped during a cell-handoff / radio sleep. axios reports that as
      // `isNetworkError=true` + `isTimeout=false` (socket closed, no response),
      // and the interceptor would silently re-send the same POST → duplicate
      // server-side write. Symptom: duplicate chat messages on Android.
      const isNetworkError = !error.response;
      const retryThisError = idempotent || cfg?.retryOnNetworkError === true;
      if (isNetworkError && cfg && retryThisError) {
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

      // `skip429Retry: true` opts a call OUT of the auto-retry loop entirely
      // so the caller sees the 429 immediately. Critical for startup-path
      // probes (e.g. /api/auth/onboarding) where the default 30 s Retry-After
      // × 3 retries would block the splash holding overlay for ~90 s while
      // the app appears to hang on a green screen.
      if (status === 429 && cfg && idempotent && !cfg.skip429Retry) {
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
 * Generate a per-attempt idempotency key for write endpoints that accept one.
 *
 * Used by reserve, send-message, create-basket, submit-report, redeem-code:
 *   • The caller mints a key in a `useRef` when the user first taps submit.
 *   • The same key is re-sent on every retry of THAT attempt — so the server
 *     can recognise the second POST as a replay of the first and return the
 *     cached row instead of inserting a duplicate.
 *   • Reset (mint a fresh key next time) when the user changes the form state
 *     in a way that should produce a NEW write (cart change, new message
 *     text, new basket name, new code).
 *
 * Format: `<base36 timestamp>-<20 base36 random chars>` — ~120 bits of
 * entropy, comfortably collision-free for per-user scoping. Avoids
 * crypto.randomUUID because Hermes (RN's JS engine) doesn't ship it natively
 * and we don't want a native-module dependency for this.
 */
export function makeAttemptKey(): string {
  const r1 = Math.random().toString(36).substring(2, 12);
  const r2 = Math.random().toString(36).substring(2, 12);
  return `${Date.now().toString(36)}-${r1}${r2}`;
}

/**
 * "Ghost success" detector — returns true when an apparent error is actually
 * proof that the user's INTENT has already been achieved server-side.
 *
 * The pattern: customer taps "submit review" → network blips between commit
 * and response → app shows "submission failed" → user retries → backend says
 * "you already reviewed this". The second response IS the receipt for the
 * first attempt. From the user's perspective the action succeeded — they
 * should see a success state, not a second failure popup.
 *
 * Each `kind` carries action-specific knowledge of which error shapes mean
 * "intent achieved" vs. "real failure". Only narrow, EXPLICIT matches are
 * treated as ghost-success — anything ambiguous keeps surfacing as a real
 * error so we never swallow a legitimate failure.
 *
 * Usage in a useMutation onError:
 *   onError: (err) => {
 *     if (isActionAlreadyDoneError(err, 'review')) {
 *       // Treat as success — server already has the row
 *       queryClient.invalidateQueries(...); navigate(...); return;
 *     }
 *     setToastMsg({ type: 'error', text: getErrorMessage(err) });
 *   }
 *
 * Add a new `kind` only when the backend gives a SPECIFIC error code/string
 * for that endpoint's "already done" state. Don't broaden existing kinds —
 * each one is calibrated to the exact route's response shape.
 */
export type AlreadyDoneActionKind = 'review' | 'cancel-reservation' | 'confirm-pickup';

export function isActionAlreadyDoneError(err: unknown, kind: AlreadyDoneActionKind): boolean {
  if (!isApiError(err)) return false;
  const raw = String(err.message ?? '').toLowerCase();
  const data = (err.data ?? {}) as { error?: string; status?: string; message?: string };
  const code = String(data.error ?? '').toLowerCase();
  const currentStatus = String(data.status ?? '').toLowerCase();

  switch (kind) {
    case 'review':
      // POST /api/reviews → 400 "You have already reviewed this reservation".
      // Customer's intent (the review row exists) is satisfied either way.
      return err.status === 400 && (raw.includes('already reviewed') || code.includes('already reviewed'));

    case 'cancel-reservation':
      // DELETE /api/reservations/:id → 409 { error: 'order_already_terminal', status: '<currentStatus>' }.
      // Treat as success ONLY when the order is in a state that satisfies
      // the cancel intent (cancelled or expired = "not active anymore"). DO
      // NOT swallow 'picked_up' / 'completed' — the user wanted to cancel
      // but the merchant already collected, which is a real conflict the
      // customer needs to see.
      if (err.status !== 409) return false;
      if (code !== 'order_already_terminal') return false;
      return currentStatus === 'cancelled' || currentStatus === 'expired';

    case 'confirm-pickup':
      // POST /api/reservations/:id/confirm-pickup → 400 "Cette commande a
      // déjà été récupérée." The merchant's intent (mark as picked up) is
      // achieved. Cancelled / refunded responses on this endpoint are NOT
      // swallowed — those are real "you can't collect this" conflicts.
      return err.status === 400 && (raw.includes('déjà été récupérée') || raw.includes('deja ete recuperee'));
  }
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
    let i18nKey = mapErrorToI18nKey(raw);
    // The request got NO response but the device is online → it's the server
    // (waking from idle / briefly unreachable), not the user's connection.
    // Swap the alarming "check your network" copy for an honest "try again".
    if (i18nKey === 'errors.networkError' && _deviceOnline) {
      i18nKey = 'errors.serverUnavailable';
    }
    if (i18nKey && i18n) {
      const translated = i18n.t(i18nKey);
      // i18next returns the key itself when the key is missing — treat that as
      // "no translation" so we fall through to the fallback instead of showing
      // a raw key like "errors.loginFailed".
      if (translated && translated !== i18nKey) return translated;
    }
    // 1b. Pass-through for already-friendly French backend strings. A handful
    // of routes return clean, user-grade French sentences (e.g. "Vous venez de
    // réserver. Veuillez patienter avant de réessayer.") that we'd rather show
    // verbatim than swallow into the generic. Conservative whitelist on the
    // opening word so noisy technical messages still fall through to the
    // generic at step 2/3.
    const trimmed = raw.trim();
    if (FRIENDLY_FR_PREFIXES.some((p) => trimmed.startsWith(p))) {
      return trimmed;
    }
  }

  // 2/3. Never surface the raw/technical string — use the caller's fallback,
  // else a generic translated message.
  if (fallback) return fallback;
  if (i18n) {
    const generic = i18n.t('common.errorOccurred');
    if (generic && generic !== 'common.errorOccurred') return generic;
  }
  return 'Something went wrong. Please try again in a moment.';
}

// Conservative whitelist used by getErrorMessage step 1b. Anything starting
// with one of these prefixes is treated as already-user-grade French and
// surfaced verbatim. Keep this tight — adding broad prefixes like "Erreur"
// or "Échec" would let raw technical strings leak to users.
const FRIENDLY_FR_PREFIXES = [
  'Vous ',
  'Cette ',
  'Cet ',
  'Aucun ',
  'Veuillez ',
  'Pas de ',
  'Demandez ',
];
