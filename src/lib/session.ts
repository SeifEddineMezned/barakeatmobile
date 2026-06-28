import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'barakeat_auth_token';
const USER_KEY = 'barakeat_user';
// Sticky-logout sentinel — written to AsyncStorage by signOut, cleared by
// signIn, checked by restoreSession. The sentinel is the safety net for a
// real Android failure mode we hit in testing: signOut wipes both stores,
// the app backgrounds, Android kills the JS process, the app cold-starts on
// resume, and SecureStore HAS THE TOKEN BACK (some OEM keystore quirk
// where the delete didn't fully take). The dualRead + purgeStaleKeychainSession
// guard then either restores the stale session (both stores have it) or
// half-recovers (one has it, one doesn't). The sentinel cuts through all of
// that: if it's set on restoreSession, the user explicitly chose to log
// out, period — force-clear and present the sign-in screen no matter what
// the storage layers report. Only AsyncStorage is used because (a) it's
// fast, (b) it's wiped on app uninstall so a reinstall starts fresh, and
// (c) it's the most reliable store across Android OEMs.
const LOGGED_OUT_KEY = 'barakeat_logged_out';

// ── Why we mirror to BOTH SecureStore and AsyncStorage ───────────────────
//
// We've now hit two reload-logout bugs on real devices that both came down
// to SecureStore returning `null` or throwing on read:
//
//   1. iOS Keychain `kSecAttrAccessible` mismatch — solved last commit.
//   2. Some-device-specific failure where SecureStore was the only persistence
//      layer and a single OEM keystore hiccup, biometric-prompt timeout, or
//      Android encrypted-SharedPreferences corruption wiped the session for
//      everyone — which is exactly what kept logging the user out even after
//      the Keychain fix.
//
// Belt-and-braces: every write goes to SecureStore (preferred — encrypted +
// device-only) AND to AsyncStorage (unencrypted fallback). Every read tries
// SecureStore first; if it returns null OR throws, fall back to AsyncStorage.
// This ALSO migrates pre-existing tokens forward: a token written under a
// different accessibility option that the current SecureStore filter can't
// match will still be readable from AsyncStorage on the next launch.
//
// Security tradeoff: a JWT in AsyncStorage is readable by the app process
// itself but not by other apps (RN's sandbox guarantees that). The token
// already has a 30-day server-side expiry, so even if a rooted device leaks
// it, the blast radius is bounded. Worth it to never have a real user
// silently logged out again.
//
// Writes set `keychainAccessible: AFTER_FIRST_UNLOCK` on the SecureStore
// copy ONLY — looser than the default WHEN_UNLOCKED_THIS_DEVICE_ONLY so the
// item survives a reboot+unlock cycle. Reads pass NO options because on iOS
// `kSecAttrAccessible` is a query filter on reads, and reading with a
// specific accessibility level only matches items stored with that exact
// level — so an option-less read finds the entry under any accessibility.

const WRITE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

async function dualWrite(key: string, value: string, label: string): Promise<void> {
  let secureErr: unknown = null;
  let asyncErr: unknown = null;
  try {
    await SecureStore.setItemAsync(key, value, WRITE_OPTS);
    console.log(`[Session] ${label} saved to SecureStore`);
  } catch (err) {
    secureErr = err;
    console.log(`[Session] ${label} SecureStore write FAILED:`, err);
  }
  try {
    await AsyncStorage.setItem(key, value);
    console.log(`[Session] ${label} saved to AsyncStorage (fallback)`);
  } catch (err) {
    asyncErr = err;
    console.log(`[Session] ${label} AsyncStorage write FAILED:`, err);
  }
  // Only treat the operation as failed if BOTH stores failed. As long as at
  // least one succeeded, the next launch's restoreSession can recover.
  if (secureErr && asyncErr) {
    throw secureErr;
  }
}

async function dualRead(key: string, label: string): Promise<string | null> {
  // 1) Try SecureStore first (preferred, more secure).
  try {
    const tok = await SecureStore.getItemAsync(key);
    if (tok != null) {
      console.log(`[Session] ${label} read from SecureStore (${tok.length} chars)`);
      return tok;
    }
    console.log(`[Session] ${label} not in SecureStore, trying AsyncStorage…`);
  } catch (err) {
    console.log(`[Session] ${label} SecureStore read THREW, trying AsyncStorage:`, err);
  }
  // 2) Fall back to AsyncStorage.
  try {
    const tok = await AsyncStorage.getItem(key);
    if (tok != null) {
      console.log(`[Session] ${label} read from AsyncStorage fallback (${tok.length} chars)`);
      // Self-heal: push the value back into SecureStore so future reads hit
      // the preferred path. Best-effort — failure here is not fatal.
      try {
        await SecureStore.setItemAsync(key, tok, WRITE_OPTS);
        console.log(`[Session] ${label} self-healed back into SecureStore`);
      } catch {}
      return tok;
    }
    console.log(`[Session] ${label} not in either store`);
    return null;
  } catch (err) {
    console.log(`[Session] ${label} AsyncStorage read FAILED:`, err);
    return null;
  }
}

async function dualDelete(key: string, label: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (err) {
    console.log(`[Session] ${label} SecureStore delete failed (non-fatal):`, err);
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    console.log(`[Session] ${label} AsyncStorage delete failed (non-fatal):`, err);
  }
  console.log(`[Session] ${label} removed`);
}

// In-memory token cache. The axios auth interceptor calls getToken() on EVERY
// request, and without this each call hit the Keychain/SecureStore (a native,
// non-trivial read) and logged "[Session] Token read…" — so a burst of requests
// (e.g. retries during a rate-limit window) spammed the Keychain and the logs.
// `undefined` = not yet loaded; `null` = known-absent; string = the token.
// Kept in lock-step by saveToken/removeToken so it can never go stale.
let tokenCache: string | null | undefined = undefined;

export async function saveToken(token: string): Promise<void> {
  tokenCache = token;
  await dualWrite(TOKEN_KEY, token, 'Token');
}

export async function getToken(): Promise<string | null> {
  if (tokenCache !== undefined) return tokenCache; // memory hit — no Keychain read
  tokenCache = await dualRead(TOKEN_KEY, 'Token');
  return tokenCache;
}

export async function removeToken(): Promise<void> {
  tokenCache = null;
  await dualDelete(TOKEN_KEY, 'Token');
}

export async function saveUser(user: object): Promise<void> {
  await dualWrite(USER_KEY, JSON.stringify(user), 'User');
}

export async function getUser<T>(): Promise<T | null> {
  const raw = await dualRead(USER_KEY, 'User');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.log('[Session] User JSON.parse failed:', err);
    return null;
  }
}

export async function removeUser(): Promise<void> {
  await dualDelete(USER_KEY, 'User');
}

export async function clearSession(): Promise<void> {
  await removeToken();
  await removeUser();
  console.log('[Session] Session cleared');
}

// ── Sticky-logout sentinel ───────────────────────────────────────────────
// Lives independently of TOKEN_KEY / USER_KEY so a SecureStore/AsyncStorage
// delete failure on those keys cannot bleed into a silent re-login. Written
// FIRST in signOut (before any other I/O) so even a JS process kill mid-
// signOut still leaves the marker on disk for the next launch to see.
//
// DUAL-STORAGE: the previous AsyncStorage-only implementation inherited the
// exact failure mode it was meant to defend against — on certain Android
// devices the AsyncStorage read transiently returned `null` after a long
// background, `hasLoggedOutSentinel()` fell back to `false`, and the keystore
// quirk left the old token in SecureStore so `restoreSession()` re-hydrated
// the session the user explicitly killed. Mirroring the sentinel to BOTH
// stores means both have to fail simultaneously for the signal to be lost.
//
// FAIL-CLOSED: if BOTH reads throw, we assume the user IS logged out (forcing
// a one-tap re-login) rather than auto-restoring a session of unclear status.
// A user who never logged out has neither store reporting the sentinel and
// the cold-start path still works normally. The only "regression" is a single
// extra sign-in when both storage layers are broken — strictly safer than
// silently restoring a session the user thought they killed.
export async function setLoggedOutSentinel(): Promise<void> {
  let asyncOk = false;
  let secureOk = false;
  try {
    await AsyncStorage.setItem(LOGGED_OUT_KEY, '1');
    asyncOk = true;
  } catch (err) {
    console.log('[Session] Logged-out sentinel AsyncStorage write FAILED:', err);
  }
  try {
    await SecureStore.setItemAsync(LOGGED_OUT_KEY, '1', WRITE_OPTS);
    secureOk = true;
  } catch (err) {
    console.log('[Session] Logged-out sentinel SecureStore write FAILED:', err);
  }
  console.log(`[Session] Logged-out sentinel set (async=${asyncOk}, secure=${secureOk})`);
}

export async function clearLoggedOutSentinel(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LOGGED_OUT_KEY);
  } catch (err) {
    console.log('[Session] Logged-out sentinel AsyncStorage clear FAILED (non-fatal):', err);
  }
  try {
    await SecureStore.deleteItemAsync(LOGGED_OUT_KEY);
  } catch (err) {
    console.log('[Session] Logged-out sentinel SecureStore clear FAILED (non-fatal):', err);
  }
}

export async function hasLoggedOutSentinel(): Promise<boolean> {
  let asyncErr: unknown = null;
  let secureErr: unknown = null;
  try {
    const v = await AsyncStorage.getItem(LOGGED_OUT_KEY);
    if (v === '1') return true;
  } catch (err) {
    asyncErr = err;
  }
  try {
    const v = await SecureStore.getItemAsync(LOGGED_OUT_KEY);
    if (v === '1') return true;
  } catch (err) {
    secureErr = err;
  }
  // Fail-CLOSED: if BOTH reads threw, treat as if the sentinel were set. A
  // user mid-session who genuinely never logged out had neither store
  // reporting the sentinel value — they fall through to the negative-return
  // path BELOW, with no error caught, so they're unaffected. This branch
  // only fires when storage is simultaneously broken across both layers,
  // and in that case forcing a fresh sign-in is the safe play.
  if (asyncErr && secureErr) {
    console.log('[Session] Logged-out sentinel read FAILED on BOTH stores — failing closed (treat as logged out).');
    return true;
  }
  return false;
}

// ── Reinstall-stale-session guard ────────────────────────────────────────
//
// iOS keeps Keychain items across an app *uninstall*, so SecureStore can hand
// back a valid-looking token even on a "fresh" reinstall — silently logging
// the reinstalled app straight back in (and making a clean-install test
// impossible). AsyncStorage, by contrast, IS wiped on uninstall.
//
// Because every real sign-in mirrors the token to BOTH stores (see dualWrite),
// a token that exists in SecureStore but NOT in AsyncStorage can only mean the
// app was reinstalled and the Keychain leaked a stale session — so we purge it
// and start clean.
//
// Safety:
//   • Migration-safe — users already signed in when this ships have the token
//     in AsyncStorage too, so they are never affected on update.
//   • Does NOT fight the anti-silent-logout design — a transient SecureStore
//     miss leaves AsyncStorage populated (token in both ⇒ not purged), and the
//     normal dualRead fallback still restores the session.
//   • Only false positive is a session whose AsyncStorage mirror write had
//     failed (rare, already tolerated by dualWrite): that user is logged out
//     once and simply signs back in.
//   • If AsyncStorage itself is unreadable we make NO judgement and leave the
//     session untouched, rather than risk clearing a valid one.
export async function purgeStaleKeychainSession(): Promise<boolean> {
  let secureToken: string | null = null;
  try {
    secureToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return false; // Keychain unreadable → nothing stale to purge
  }
  if (!secureToken) return false; // nothing survived in the Keychain

  let asyncToken: string | null = null;
  try {
    asyncToken = await AsyncStorage.getItem(TOKEN_KEY);
  } catch (err) {
    console.log('[Session] purgeStale: AsyncStorage unreadable, skipping guard:', err);
    return false;
  }

  if (asyncToken == null) {
    console.log('[Session] Stale Keychain session detected after reinstall — purging.');
    await clearSession();
    return true;
  }
  return false;
}
