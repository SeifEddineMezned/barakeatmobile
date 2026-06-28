import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Image, Modal, Animated, Dimensions } from 'react-native';
import { PasswordInput } from '@/src/components/PasswordInput';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store, User, ChevronLeft, Mail } from 'lucide-react-native';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { login, loginWithGoogle, loginWithApple } from '@/src/services/auth';
import { clearSession } from '@/src/lib/session';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';
import type { UserRole, User as UserType } from '@/src/types';
import { StatusBar } from 'expo-status-bar';
import * as AppleAuthentication from 'expo-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Expo Go can't load custom native modules. The team still tests iOS via Expo Go
// (no Apple dev account yet), so we must NOT import the Google Sign-In native
// module at the top — that would crash the screen on launch with "RNGoogleSignin
// could not be found". Instead we lazy-require it only in a real dev/prod build
// and hide the Google button in Expo Go. Mirrors how this app guards
// expo-notifications for Expo Go.
const isExpoGo = Constants.appOwnership === 'expo';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Phones shorter than ~740 logical px (iPhone SE, older Androids, mid-range
// Galaxy A series) can't fit the full bag-arc + brand + 3-button stack at the
// default sizes without scrolling. We collapse the bag area, brand size, and
// inter-block margins on those screens so the landing reads as a single page
// on every device the app targets.
const COMPACT = SCREEN_H < 740;
const BAG_BOX_W = COMPACT ? 280 : 340;
const BAG_BOX_H = COMPACT ? 220 : 280;
const BAG_IMG = COMPACT ? 140 : 180;
const BAG_ARC_R = COMPACT ? 100 : 125;
const BRAND_FONT = COMPACT ? 30 : 38;
const TAGLINE_H = COMPACT ? 44 : 56;
const TAGLINE_FONT = COMPACT ? 16 : 18;
const BUTTONS_GAP_TOP = COMPACT ? 24 : 40;
const LINKS_GAP_TOP = COMPACT ? 14 : 24;
const BAG_BOTTOM_GAP = COMPACT ? 4 : 8;

// Food emojis arranged on a semi-circle above the centered paper-bag image.
// Positions are tied to a fixed-size container that wraps both the bag and
// the food items, so the arc actually surrounds the bag regardless of where
// the flex-centered group lands on screen. See the BAG_ASSEMBLY_* constants
// inline below for the local coordinate system.
const FOOD_ITEMS = [
  { emoji: '🥐', size: 44, angle: -160 },
  { emoji: '🥗', size: 42, angle: -125 },
  { emoji: '🧁', size: 36, angle:  -90 },
  { emoji: '🍕', size: 40, angle:  -55 },
  { emoji: '🍩', size: 36, angle:  -20 },
];

// Rotating advantages shown on the sign-in landing screen. Translated at
// render-time via i18n so switching the language pill above the page swaps the
// copy live — see WELCOME_WORDS in SignInScreen().
// ── Native Google Sign-In ────────────────────────────────────────────────────
// Configured once at module load. We use the NATIVE SDK (not a browser
// authorization-code flow) because Android OAuth clients don't support the
// reversed-client-id custom-scheme redirect — that combination is rejected by
// Google as "Access blocked: …'s request is invalid". The native SDK uses the
// platform clients under the hood (Android: package + SHA-1 from
// google-services.json; iOS: iosClientId) and returns an idToken whose audience
// is the WEB client, which the backend's /api/auth/google already accepts.
const GOOGLE_WEB_CLIENT_ID = '347897166718-fms7s6phli6l0qh8ajs4i1edrqk3jkct.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = '347897166718-e65j3461423p2c7loofv7c4cb3p6193r.apps.googleusercontent.com';

// Lazily loaded + configured on first use. Returns null in Expo Go (or if the
// native module is otherwise absent) so callers can degrade gracefully instead
// of crashing. `googleStatusCodes` is populated alongside for the cancel check.
let _googleSignin: any = null;
let _googleConfigured = false;
let googleStatusCodes: any = {};
function getGoogleSignin(): any | null {
  if (isExpoGo) return null;
  try {
    const mod = require('@react-native-google-signin/google-signin');
    const GoogleSignin = mod.GoogleSignin;
    googleStatusCodes = mod.statusCodes ?? {};
    if (!_googleConfigured) {
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        iosClientId: GOOGLE_IOS_CLIENT_ID,
        scopes: ['profile', 'email'],
        offlineAccess: false,
      });
      _googleConfigured = true;
    }
    _googleSignin = GoogleSignin;
    return GoogleSignin;
  } catch (e) {
    console.log('[Google] native module unavailable (Expo Go?):', (e as any)?.message);
    return null;
  }
}

// Whether to show the Google button at all. Hidden in Expo Go since the native
// flow can't run there.
const GOOGLE_SIGNIN_AVAILABLE = !isExpoGo;

// NOTE: the PKCE/SHA-256 + buildGoogleAuthUrl/exchangeAuthCode helpers below are
// legacy from the old browser-based Google flow and are no longer called now that
// Google sign-in is native (see handleGoogleSignIn). Left in place to keep this
// change minimal; safe to delete in a follow-up cleanup.
function sha256(message: string): string {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const rr = (v: number, n: number) => (v >>> n) | (v << (32 - n));
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i++) bytes.push(message.charCodeAt(i));
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const bitLen = message.length * 8;
  for (let i = 56; i >= 0; i -= 8) bytes.push((bitLen / Math.pow(2, i)) & 0xff);
  let [h0, h1, h2, h3, h4, h5, h6, h7] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  for (let off = 0; off < bytes.length; off += 64) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++)
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const hashBytes = new Uint8Array(32);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => {
    hashBytes[i * 4] = (v >>> 24) & 0xff;
    hashBytes[i * 4 + 1] = (v >>> 16) & 0xff;
    hashBytes[i * 4 + 2] = (v >>> 8) & 0xff;
    hashBytes[i * 4 + 3] = v & 0xff;
  });
  let binary = '';
  hashBytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

// ── Google OAuth helpers ─────────────────────────────────────────────────────
// Native client IDs for platform-specific OAuth flows with custom scheme redirects.
// These work with WebBrowser.openAuthSessionAsync in Expo Go.
const GOOGLE_CLIENT = {
  ios: {
    clientId: '563732969753-tjbeid6kat52st6anrt34p31g8dp0ajt.apps.googleusercontent.com',
    scheme: 'com.googleusercontent.apps.563732969753-tjbeid6kat52st6anrt34p31g8dp0ajt',
  },
  android: {
    clientId: '563732969753-rjog1l089e2kksn56b6qladv603lt09g.apps.googleusercontent.com',
    scheme: 'com.googleusercontent.apps.563732969753-rjog1l089e2kksn56b6qladv603lt09g',
  },
} as const;

function buildGoogleAuthUrl(): { url: string; redirectUri: string; codeVerifier: string; clientId: string } {
  const cfg = Platform.OS === 'ios' ? GOOGLE_CLIENT.ios : GOOGLE_CLIENT.android;
  const redirectUri = `${cfg.scheme}:/oauth2redirect`;
  const codeVerifier = [
    Math.random().toString(36).substring(2),
    Math.random().toString(36).substring(2),
    Math.random().toString(36).substring(2),
  ].join('');
  // SHA-256 PKCE — pure JS, no native module required
  const hashBase64 = sha256(codeVerifier);
  const codeChallenge = hashBase64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
  });
  console.log('[Google] Platform:', Platform.OS, '| clientId:', cfg.clientId.substring(0, 20) + '...');
  console.log('[Google] redirectUri:', redirectUri);
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    redirectUri,
    codeVerifier,
    clientId: cfg.clientId,
  };
}

function parseCodeFromUrl(url: string): string | null {
  try {
    // Auth code is returned in query params: ...?code=4%2F...&scope=...
    const queryStart = url.indexOf('?');
    if (queryStart === -1) return null;
    return new URLSearchParams(url.substring(queryStart + 1)).get('code');
  } catch {
    return null;
  }
}

// Exchange auth code for tokens — returns both accessToken and idToken
async function exchangeAuthCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
): Promise<{ accessToken: string; idToken: string }> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data: any = await resp.json();
  if (!resp.ok) {
    console.log('[Google] Code exchange HTTP error:', resp.status, data);
    throw new Error(data.error_description || data.error || 'Token exchange failed');
  }

  // DEBUG: log what Google returned
  console.log('[Google] Token exchange result — has access_token:', !!data.access_token,
    '| has id_token:', !!data.id_token,
    '| id_token length:', data.id_token?.length ?? 0);

  // id_token is REQUIRED — without it the backend cannot authenticate the user
  if (!data.id_token) {
    console.error('[Google] Token exchange returned NO id_token. Response keys:', Object.keys(data));
    throw new Error('Google did not return an id_token. Please try again.');
  }

  return { accessToken: data.access_token ?? '', idToken: data.id_token };
}

export default function SignInScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);
  const triggerSplash = useSplashStore((s) => s.triggerSplash);
  // While the post-login splash overlay is up, pause this screen's own welcome
  // animation (it sits underneath the splash) so nothing competes with the
  // halo's JS-thread animation.
  const splashUp = useSplashStore((s) => s.showSplash);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [role, setRole] = useState<UserRole>('customer');
  const [step, setStep] = useState<'choose' | 'login'>('choose');
  const [roleMismatchMsg, setRoleMismatchMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Welcome animation state ──────────────────────────────────────────────
  const [welcomeIdx, setWelcomeIdx] = useState(0);
  const welcomeFade = useRef(new Animated.Value(1)).current;
  const buttonsOpacity = useRef(new Animated.Value(0)).current;
  // Translated tagline rotation. Re-derives when the user switches the
  // language pill so the next fade-in cycle picks up the new copy.
  const WELCOME_WORDS = useMemo(
    () => [
      t('auth.welcomeWord1', { defaultValue: 'Économisez sur vos repas' }),
      t('auth.welcomeWord2', { defaultValue: 'Luttez contre le gaspillage' }),
      t('auth.welcomeWord3', { defaultValue: 'Soutenez les commerces locaux' }),
    ],
    [t, i18n.language],
  );
  const foodAnims = useRef(FOOD_ITEMS.map(() => ({
    y: new Animated.Value(-120),
    opacity: new Animated.Value(0),
  }))).current;

  useEffect(() => {
    // Skip while the splash is up — this screen is hidden under it, and its
    // setInterval/Animated cycle would otherwise compete with the halo's
    // JS-thread animation during login.
    if (step !== 'choose' || splashUp) return;
    // Cycle welcome words: Arabic → English → French
    let idx = 0;
    const cycle = () => {
      Animated.timing(welcomeFade, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        idx = (idx + 1) % WELCOME_WORDS.length;
        setWelcomeIdx(idx);
        Animated.timing(welcomeFade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      });
    };
    const interval = setInterval(cycle, 2000);
    // Food drop animation — stagger each item
    FOOD_ITEMS.forEach((_, i) => {
      foodAnims[i].y.setValue(-120);
      foodAnims[i].opacity.setValue(0);
    });
    Animated.stagger(120, FOOD_ITEMS.map((_, i) =>
      Animated.parallel([
        Animated.spring(foodAnims[i].y, { toValue: 0, friction: 5, tension: 40, useNativeDriver: true, delay: 200 }),
        Animated.timing(foodAnims[i].opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    )).start(() => {
      // After food settles, fade in buttons
      Animated.timing(buttonsOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    });
    return () => clearInterval(interval);
  }, [step, splashUp]);

  // ── Apple Sign-In ────────────────────────────────────────────────────────

  // OAuth (Google/Apple) is customer-only on the welcome screen \u2014 merchants
  // sign in with email. Accept the requested role as an explicit argument so
  // we never read a stale `role` state value: calling `setRole('customer')`
  // right before invoking the handler doesn't flush the state update before
  // the closure reads `role` \u2014 that was the "stuck in commerce mode after
  // back-out" bug.
  const handleAppleSignIn = async (requestedRole: UserRole = 'customer') => {
    if (FeatureFlags.IS_PROTOTYPE) {
      setErrorMsg(t('auth.prototypeMode', { defaultValue: 'L\'application est en mode prototype. La connexion n\'est pas disponible. Utilisez le mode d\u00e9mo pour d\u00e9couvrir l\'application.' }));
      return;
    }
    try {
      setAppleLoading(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        setErrorMsg(t('auth.appleUnavailable'));
        return;
      }

      const rawName = credential.fullName
        ? `${credential.fullName.givenName ?? ''} ${credential.fullName.familyName ?? ''}`.trim()
        : '';
      // Apple only returns the name on the FIRST authorization for each app
      // install — and on that one chance it can still be empty if the user
      // clears the name field on the consent sheet. We pass the raw value
      // verbatim (empty string included). The backend USED to reject new
      // accounts with empty names; now it creates the account with an empty
      // `name` + `nameNeedsInput: true`, and we route the user through a
      // dedicated name-entry screen below before the gender picker.
      const fullName = rawName;

      const res = await loginWithApple(credential.identityToken, fullName);

      const backendType = (res as any).user?.type ?? '';
      const mappedRole: UserRole = backendType === 'restaurant' ? 'business' : 'customer';

      // Enforce role match — block cross-role login. Merchants hitting Apple
      // OAuth on the customer flow get a tailored "use email" message.
      if (mappedRole !== requestedRole) {
        await clearSession();
        setRoleMismatchMsg(
          requestedRole === 'customer' && mappedRole === 'business'
            ? t('auth.businessMustUseEmail', { defaultValue: 'Les commerçants se connectent uniquement par email.' })
            : requestedRole === 'customer'
              ? t('auth.notCustomerAccount', { defaultValue: 'Ce compte est enregistré comme commerce. Veuillez passer en mode commerçant.' })
              : t('auth.notBusinessAccount', { defaultValue: 'Ce compte est enregistré comme client. Veuillez passer en mode client.' })
        );
        setLoading(false);
        return;
      }

      const onboardingCompleted = Boolean((res.user as any).onboardingCompleted);
      // Gender step is OAuth-only and tracked separately from the tutorial so
      // finishing it doesn't suppress the welcome carousel / demo / address
      // prompt. Default to true when the backend omits it (older server) so we
      // don't strand the user on a gender screen.
      const genderStepCompleted = (res.user as any).genderStepCompleted !== false;
      const user: UserType = {
        id: res.user.id,
        name: res.user.name,
        firstName: res.user.firstName,
        email: res.user.email,
        phone: res.user.phone,
        role: mappedRole,
        gender: (res.user as any).gender ?? null,
        avatar: (res.user as any).avatar ?? null,
        onboardingCompleted,
        genderStepCompleted,
        authProvider: (res.user as any).provider ?? 'local',
        organizationName: (res.user as any).organizationName ?? null,
        orgRole: (res.user as any).role ?? null,
      };

      // First-login routing: when the OAuth user hasn't done the gender step
      // yet, send them through the dedicated first-login screens (name → gender)
      // instead of straight into the app. We do NOT gate this on
      // onboardingCompleted — that flag stays false through the gender step so
      // the welcome carousel / demo / address prompt still fires once the user
      // reaches the app. The routing guard ALSO checks nameNeedsInput /
      // genderStepCompleted on cold reload, so a mid-step process kill still
      // lands the user back on the right screen on next launch.
      const nameNeedsInput = (res.user as any).nameNeedsInput === true;
      if (!genderStepCompleted) {
        // Stash the OAuth-supplied flags on the user object so the routing
        // guard in _layout can read them (persists across reload via SecureStore).
        (user as any).nameNeedsInput = nameNeedsInput;
        (user as any).genderNeedsInput = (res.user as any).genderNeedsInput ?? true;
        await signIn(user, res.token);
        if (nameNeedsInput) {
          console.log('[SignIn] Apple new user — Apple withheld name, routing to /auth/name-input');
          router.replace('/auth/name-input' as never);
        } else {
          console.log('[SignIn] Apple new user — routing to /auth/onboarding (gender step)');
          router.replace('/auth/onboarding' as never);
        }
        return;
      }

      console.log('[SignIn] Apple success — splash up; routing guard navigates after the animation');
      // No app sneak-peek: if onboarding isn't done yet, mount the welcome
      // carousel UNDER the splash (see the email-login branch for the rationale).
      if (!onboardingCompleted) {
        useWalkthroughStore.getState().setPendingFirstRun(true);
      }
      // Trigger the splash (which resets splashStore.animDone=false) BEFORE
      // flipping auth, so the routing guard can never observe "authenticated +
      // animation-already-done" in the render gap and navigate into the app
      // early. Navigation is then LEFT to the routing guard, which fires the
      // role-based redirect only AFTER the splash animation finishes (routing
      // UNDER the still-visible splash). The old eager router.replace mounted the
      // tabs/dashboard tree concurrently with the splash — the user saw the app
      // for a frame and the halo froze.
      triggerSplash();
      // Defer the auth-state flip (and its root re-render cascade + downstream
      // queries) until the splash animation finishes — see
      // splashStore.pendingAnimFinish. Running signIn() now starved the halo's
      // JS-thread rAF loop and froze the animation on login.
      useSplashStore.getState().setPendingAnimFinish(() => signIn(user, res.token));
    } catch (err: any) {
      if (err.code === 'ERR_REQUEST_CANCELED') return; // user cancelled
      // Apple didn't share the name/email needed to create the account (the user
      // declined, or the app was already authorized so Apple won't resend them).
      // Tell them they must share both — they can't be onboarded otherwise.
      const data = err?.data ?? err?.response?.data ?? {};
      if (data?.appleMissingInfo) {
        setRoleMismatchMsg(t('auth.appleNeedsInfo', { defaultValue: 'Pour créer votre compte avec Apple, vous devez partager votre nom et votre email. Réessayez en autorisant le partage, ou utilisez Google ou votre email.' }));
        return;
      }
      // Any other failure (backend auth/config rejection, network, missing
      // token) isn't actionable by the user — show a clean, translated
      // "unavailable" message and steer them to email / Google instead of a
      // raw backend string like "Token not authorized for this app". The real
      // cause is still logged for us.
      console.log('[SignIn] Apple error:', getErrorMessage(err));
      setErrorMsg(t('auth.appleUnavailable'));
    } finally {
      setAppleLoading(false);
    }
  };

  // ── Google OAuth ─────────────────────────────────────────────────────────

  const handleGoogleSignIn = async (requestedRole: UserRole = 'customer') => {
    if (FeatureFlags.IS_PROTOTYPE) {
      setErrorMsg(t('auth.prototypeMode', { defaultValue: 'L\'application est en mode prototype. La connexion n\'est pas disponible. Utilisez le mode d\u00e9mo pour d\u00e9couvrir l\'application.' }));
      return;
    }
    const GoogleSignin = getGoogleSignin();
    if (!GoogleSignin) {
      // Expo Go / native module missing — can't run the native flow here.
      setErrorMsg(t('auth.googleNeedsBuild', { defaultValue: 'La connexion Google est disponible uniquement dans l\'application installée, pas en mode test.' }));
      return;
    }
    try {
      setGoogleLoading(true);

      // Native Google Sign-In. On Android this requires Google Play Services;
      // hasPlayServices throws a clean status code if they're missing/outdated.
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // Sign out first so the account chooser always appears (avoids silently
      // reusing a previously-picked account on a shared device).
      try { await GoogleSignin.signOut(); } catch {}

      const response: any = await GoogleSignin.signIn();
      // v13+ returns a discriminated union { type, data }; older returns the
      // user object directly. Normalise so this survives a version bump.
      if (response?.type === 'cancelled') {
        return; // user dismissed the chooser — silent no-op
      }
      const info = response?.data ?? response;
      let idToken: string | null = info?.idToken ?? null;
      let accessToken = '';
      try {
        const tokens = await GoogleSignin.getTokens();
        accessToken = tokens?.accessToken ?? '';
        if (!idToken) idToken = tokens?.idToken ?? null;
      } catch {
        // getTokens can fail right after sign-in on some devices — idToken from
        // the signIn() response is enough for the backend.
      }

      if (!idToken) {
        console.log('[Google] No idToken from native sign-in');
        setErrorMsg(t('auth.googleAuthError', { defaultValue: 'La connexion Google a échoué. Réessayez.' }));
        return;
      }

      // Send to backend (it decodes the idToken payload; accessToken optional).
      const res = await loginWithGoogle(accessToken, idToken);

      // Map backend type to app role
      const backendType = (res as any).user?.type ?? '';
      const mappedRole: UserRole =
        backendType === 'restaurant' ? 'business' : 'customer';

      // Enforce role match — block cross-role login. Merchants hitting Google
      // OAuth on the customer flow get a tailored "use email" message.
      if (mappedRole !== requestedRole) {
        await clearSession();
        setRoleMismatchMsg(
          requestedRole === 'customer' && mappedRole === 'business'
            ? t('auth.businessMustUseEmail', { defaultValue: 'Les commerçants se connectent uniquement par email.' })
            : requestedRole === 'customer'
              ? t('auth.notCustomerAccount', { defaultValue: 'Ce compte est enregistré comme commerce. Veuillez passer en mode commerçant.' })
              : t('auth.notBusinessAccount', { defaultValue: 'Ce compte est enregistré comme client. Veuillez passer en mode client.' })
        );
        setGoogleLoading(false);
        return;
      }

      const onboardingCompleted = Boolean((res.user as any).onboardingCompleted);
      // Gender step tracked separately from the tutorial — see the Apple block.
      const genderStepCompleted = (res.user as any).genderStepCompleted !== false;
      const user: UserType = {
        id: res.user.id,
        name: res.user.name,
        firstName: res.user.firstName,
        email: res.user.email,
        phone: res.user.phone,
        role: mappedRole,
        gender: (res.user as any).gender ?? null,
        avatar: (res.user as any).avatar ?? null,
        onboardingCompleted,
        genderStepCompleted,
        authProvider: (res.user as any).provider ?? 'local',
        organizationName: (res.user as any).organizationName ?? null,
        orgRole: (res.user as any).role ?? null,
      };

      // First-login routing for Google. Same logic as the Apple branch above:
      // route to the gender picker when the gender step isn't done yet (NOT
      // gated on onboardingCompleted, so the carousel/demo still fires after).
      // For Google the name step is almost always skipped (Google ALWAYS ships
      // a real name) but the screen handles both cases.
      if (!genderStepCompleted) {
        console.log('[SignIn] Google new user — routing to /auth/onboarding (gender step)');
        (user as any).nameNeedsInput = (res.user as any).nameNeedsInput ?? false;
        (user as any).genderNeedsInput = (res.user as any).genderNeedsInput ?? true;
        await signIn(user, res.token);
        router.replace('/auth/onboarding' as never);
        return;
      }

      console.log('[SignIn] Google success — splash up; routing guard navigates after the animation');
      // No app sneak-peek: if onboarding isn't done yet, mount the welcome
      // carousel UNDER the splash (see the email-login branch for the rationale).
      if (!onboardingCompleted) {
        useWalkthroughStore.getState().setPendingFirstRun(true);
      }
      // Splash BEFORE signIn — see the Apple-login block + splashStore.animDone.
      triggerSplash();
      // Defer the auth-state flip (and its root re-render cascade + downstream
      // queries) until the splash animation finishes — see
      // splashStore.pendingAnimFinish. Running signIn() now starved the halo's
      // JS-thread rAF loop and froze the animation on login.
      useSplashStore.getState().setPendingAnimFinish(() => signIn(user, res.token));
      // Navigation is LEFT to the routing guard (fires after the splash anim).
    } catch (err: any) {
      // User-cancelled / in-progress → silent. Everything else (incl.
      // DEVELOPER_ERROR = SHA-1 not registered, PLAY_SERVICES_NOT_AVAILABLE)
      // isn't actionable by the user — show a clean message, log the code.
      if (err?.code === googleStatusCodes.SIGN_IN_CANCELLED || err?.code === googleStatusCodes.IN_PROGRESS) {
        return;
      }
      console.log('[SignIn] Google error:', err?.code, getErrorMessage(err));
      setErrorMsg(t('auth.googleAuthError', { defaultValue: 'La connexion Google a échoué. Réessayez.' }));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSignIn = async () => {
    if (FeatureFlags.IS_PROTOTYPE) {
      setErrorMsg(t('auth.prototypeMode', { defaultValue: 'L\'application est en mode prototype. La connexion n\'est pas disponible. Utilisez le mode d\u00e9mo pour d\u00e9couvrir l\'application.' }));
      return;
    }
    if (!email.trim() || !password.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      const res = await login({ email: email.trim(), password, requested_type: role === 'business' ? 'restaurant' : 'buyer' } as any);
      // Map backend type ("buyer"/"restaurant") to app role ("customer"/"business")
      const backendRole = res.user.role ?? (res as any).user?.type ?? '';
      let mappedRole: UserRole = role;
      if (backendRole === 'restaurant' || backendRole === 'business') {
        mappedRole = 'business';
      } else if (backendRole === 'buyer' || backendRole === 'customer') {
        mappedRole = 'customer';
      }
      // Block login if selected role doesn't match account type
      if (mappedRole !== role) {
        await clearSession();
        setRoleMismatchMsg(role === 'customer'
          ? t('auth.notCustomerAccount', { defaultValue: 'Ce compte est enregistré comme commerce. Veuillez passer en mode commerçant.' })
          : t('auth.notBusinessAccount', { defaultValue: 'Ce compte est enregistré comme client. Veuillez passer en mode client.' }));
        setLoading(false);
        return;
      }
      const onboardingCompleted = Boolean((res.user as any).onboardingCompleted);
      const user: UserType = {
        id: res.user.id,
        name: res.user.name,
        firstName: res.user.firstName,
        email: res.user.email,
        phone: res.user.phone,
        role: mappedRole,
        gender: (res.user as any).gender ?? null,
        onboardingCompleted,
        authProvider: (res.user as any).provider ?? 'local',
        organizationName: (res.user as any).organizationName ?? null,
        orgRole: (res.user as any).role ?? null,
      };
      console.log('[SignIn] Success — splash up; routing guard navigates after the animation (role:', user.role, 'backend:', backendRole, ')');
      // First login via email — most often a business account created by admin,
      // but also a customer who never finished onboarding. Mount the welcome
      // carousel UNDER the splash so the home screen NEVER flashes between the
      // loading animation and the onboarding (no app sneak-peek) — the same
      // pattern verify-email (email signup) and the OAuth gender flow use. The
      // probe would otherwise only flip the carousel on AFTER the splash tears
      // down, leaving the dashboard visible for a beat first.
      if (!onboardingCompleted) {
        useWalkthroughStore.getState().setPendingFirstRun(true);
      }
      // Splash BEFORE signIn — see the Apple-login block + splashStore.animDone.
      triggerSplash();
      // Defer the auth-state flip (and its root re-render cascade + downstream
      // queries) until the splash animation finishes — see
      // splashStore.pendingAnimFinish. Running signIn() now starved the halo's
      // JS-thread rAF loop and froze the animation on login.
      useSplashStore.getState().setPendingAnimFinish(() => signIn(user, res.token));
      // Navigation is LEFT to the routing guard (fires after the splash anim).
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status;
      const data = err?.data ?? err?.response?.data ?? {};
      // This email belongs to a Google/Apple account (no password). Steer the
      // user to the right button instead of a confusing "invalid credentials".
      if (data?.oauthProvider === 'google' || data?.oauthProvider === 'apple') {
        setRoleMismatchMsg(data.oauthProvider === 'google'
          ? t('auth.useGoogleSignIn', { defaultValue: 'Ce compte utilise la connexion Google. Appuyez sur « Continuer avec Google ».' })
          : t('auth.useAppleSignIn', { defaultValue: 'Ce compte utilise la connexion Apple. Appuyez sur « Continuer avec Apple ».' }));
        setLoading(false);
        return;
      }
      // Buyer who registered but never finished email verification — bounce
      // them straight to the OTP screen with their email pre-filled. The
      // verify screen will resend the code if the previous one expired.
      if (status === 403 && data?.requiresVerification && (data?.email || email.trim())) {
        const verifyEmail = (data?.email || email.trim()).toString();
        router.replace(`/auth/verify-email?email=${encodeURIComponent(verifyEmail)}` as never);
        setLoading(false);
        return;
      }
      const msg = getErrorMessage(err);
      console.log('[SignIn] Error:', msg);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#fffff8' }]}>
      <StatusBar style="dark" />
      {/* Warm the decoded-image cache for the OAuth first-login gender step.
          That screen mounts immediately after a heavy Google/Apple sign-in, so
          decoding these ~160–240 KB PNGs on its first paint made the man/woman
          cards appear blank for a beat. Rendering them here (off-screen, fully
          transparent, at the same size the gender cards use) decodes them while
          the user is still on this landing screen, so they show instantly. */}
      <Image
        source={require('@/assets/images/man_holding_basket-removebg-preview.png')}
        style={{ position: 'absolute', left: -9999, width: 100, height: 150, opacity: 0 }}
        accessible={false}
      />
      <Image
        source={require('@/assets/images/woman_holding_basket-removebg-preview.png')}
        style={{ position: 'absolute', left: -9999, width: 100, height: 150, opacity: 0 }}
        accessible={false}
      />
      {/* Language pills removed from pre-app screens — the app now picks up
          the phone's system language on first launch (see src/i18n/index.ts)
          and the user can change it from Settings once they're inside. */}
      {/* Back button — lifted out of the centered form so it sits flush at
          the top-left of the safe area on the email/password step, matching
          the position used on the sign-up form pages. */}
      {step === 'login' && (
        <TouchableOpacity
          onPress={() => setStep('choose')}
          style={{
            alignSelf: 'flex-start',
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: '#114b3c15',
            justifyContent: 'center',
            alignItems: 'center',
            marginLeft: theme.spacing.xxl,
            marginTop: theme.spacing.xxl,
          }}
          accessibilityLabel={t('common.goBack', { defaultValue: 'Retour' })}
          accessibilityRole="button"
        >
          <ChevronLeft size={28} color="#114b3c" />
        </TouchableOpacity>
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          scrollEnabled={step !== 'choose'}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.content, {
            paddingHorizontal: theme.spacing.xxl,
            paddingTop: step === 'choose' ? theme.spacing.sm : theme.spacing.xxl,
            paddingBottom: theme.spacing.xxl,
          }]}>
            {step === 'choose' ? (
              // Vertically centered — was 'flex-start' which anchored the
              // bag-arc + tagline + brand + buttons to the top of the
              // available space, leaving dead air at the bottom on taller
              // phones. Centering keeps the assembly balanced on every
              // screen size, including the COMPACT phones the constants
              // up top already account for horizontally.
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                {/* Bag + food arc assembly. Fixed dimensions so the food emojis,
                    positioned in this container's local coordinates, always
                    surround the bag — the previous screen-space coords drifted
                    relative to the flex-centered bag and the arc appeared above
                    instead of around it. Bag sits bottom-anchored in the box;
                    food emojis curve from -160° to -20° around the bag's center.
                    Sizes shrink on COMPACT (short) phones so the page fits. */}
                <View style={{ width: BAG_BOX_W, height: BAG_BOX_H, marginBottom: BAG_BOTTOM_GAP, alignItems: 'center', justifyContent: 'flex-end' }}>
                  {(() => {
                    const BAG_CX = BAG_BOX_W / 2;
                    const BAG_CY = BAG_BOX_H - BAG_IMG / 2;
                    const ARC_R  = BAG_ARC_R;
                    return FOOD_ITEMS.map((item, i) => {
                      const rad = (item.angle * Math.PI) / 180;
                      const left = BAG_CX + ARC_R * Math.cos(rad) - item.size / 2;
                      const top  = BAG_CY + ARC_R * Math.sin(rad) - item.size / 2;
                      return (
                        <Animated.Text
                          key={i}
                          style={{
                            position: 'absolute',
                            left,
                            top,
                            fontSize: item.size,
                            opacity: foodAnims[i].opacity,
                            transform: [{ translateY: foodAnims[i].y }],
                          }}
                        >
                          {item.emoji}
                        </Animated.Text>
                      );
                    });
                  })()}

                  {/* Paper bag image */}
                  <Image
                    source={require('@/assets/images/barakeat_paper_bag.png')}
                    style={{ width: BAG_IMG, height: BAG_IMG }}
                    resizeMode="contain"
                  />
                </View>

                {/* Fixed-height wrapper so the rotating advantage text reserves
                    the same vertical space regardless of how many lines the
                    current phrase wraps to — keeps the bag from jumping when
                    the longer "Soutenez les commerces locaux" cycles through. */}
                <View style={{ height: TAGLINE_H, justifyContent: 'center', paddingHorizontal: 16 }}>
                  <Animated.Text
                    numberOfLines={2}
                    style={{
                      opacity: welcomeFade,
                      color: '#114b3c',
                      fontSize: TAGLINE_FONT,
                      lineHeight: TAGLINE_FONT + 6,
                      fontFamily: 'Poppins_400Regular',
                      textAlign: 'center',
                    }}
                  >
                    {WELCOME_WORDS[welcomeIdx]}
                  </Animated.Text>
                </View>

                <Text style={{
                  color: '#114b3c',
                  fontSize: BRAND_FONT,
                  fontWeight: '700',
                  fontFamily: 'Poppins_700Bold',
                  textAlign: 'center',
                  marginTop: 2,
                }}>
                  Barakeat
                </Text>

                {/* Sign-in buttons — fade in after food settles */}
                <Animated.View style={{ opacity: buttonsOpacity, width: '100%', marginTop: BUTTONS_GAP_TOP, gap: 12 }}>
                  {/* Google — native module, so hidden in Expo Go (can't run there).
                      Always customer on the welcome screen; merchants must use email. */}
                  {GOOGLE_SIGNIN_AVAILABLE && (
                  <TouchableOpacity
                    onPress={() => handleGoogleSignIn('customer')}
                    disabled={googleLoading}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      height: 52, backgroundColor: '#fff', borderRadius: 14,
                      borderWidth: 1, borderColor: '#e0e0e0',
                      opacity: googleLoading ? 0.6 : 1,
                    }}
                  >
                    {googleLoading ? (
                      <ActivityIndicator size="small" color="#4285F4" style={{ marginRight: 10 }} />
                    ) : (
                      <Image source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }} style={{ width: 20, height: 20, marginRight: 10 }} resizeMode="contain" />
                    )}
                    <Text style={{ color: '#3c4043', fontSize: 15, fontWeight: '600', fontFamily: 'Poppins_500Medium' }}>
                      {t('auth.continueWithGoogle', { defaultValue: 'Continuer avec Google' })}
                    </Text>
                  </TouchableOpacity>
                  )}

                  {/* Apple — iOS only */}
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      onPress={() => handleAppleSignIn('customer')}
                      disabled={appleLoading}
                      activeOpacity={0.8}
                      style={{
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        height: 52, backgroundColor: '#000', borderRadius: 14,
                        opacity: appleLoading ? 0.6 : 1,
                      }}
                    >
                      {appleLoading ? (
                        <ActivityIndicator size="small" color="#fff" style={{ marginRight: 10 }} />
                      ) : (
                        <FontAwesome name="apple" size={20} color="#fff" style={{ marginRight: 8 }} />
                      )}
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'Poppins_500Medium' }}>
                        {t('auth.continueWithApple', { defaultValue: 'Continuer avec Apple' })}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Email */}
                  <TouchableOpacity
                    onPress={() => { setRole('customer'); setStep('login'); }}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                      height: 52, backgroundColor: '#114b3c', borderRadius: 14,
                    }}
                  >
                    <Mail size={18} color="#e3ff5c" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '600', fontFamily: 'Poppins_500Medium' }}>
                      {t('auth.continueWithEmail', { defaultValue: 'Continuer avec e-mail' })}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>

                {/* Bottom links */}
                <Animated.View style={{ opacity: buttonsOpacity, marginTop: LINKS_GAP_TOP, alignItems: 'center', gap: 10 }}>
                  <TouchableOpacity onPress={() => { setRole('business'); setStep('login'); }}>
                    <Text style={{ color: '#114b3c', fontSize: 14, fontFamily: 'Poppins_400Regular', textDecorationLine: 'underline' }}>
                      {t('auth.businessLink', { defaultValue: 'Vous \u00eates un commerce ? Cliquez ici' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => router.push('/auth/sign-up' as never)}>
                    <Text style={{ color: '#114b3c80', fontSize: 13, fontFamily: 'Poppins_400Regular' }}>
                      {t('auth.noAccountShort', { defaultValue: 'Pas encore de compte ?' })}{' '}
                      <Text style={{ fontWeight: '700', color: '#114b3c', textDecorationLine: 'underline' }}>
                        {t('auth.signUp', { defaultValue: "S'inscrire" })}
                      </Text>
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              </View>
            ) : (
              <>
                {/* Back button now lives above the ScrollView so it sits at
                    the top-left of the safe area; the centered form starts
                    with the Barakeat brand title. */}
                <Text style={{ color: '#114b3c', fontSize: 34, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 2 }}>
                  Barakeat
                </Text>
                <Text style={{ color: '#114b3c', fontSize: 20, fontFamily: 'Poppins_400Regular', textAlign: 'center', marginBottom: 6 }}>
                  {role === 'customer' ? t('auth.signIn', { defaultValue: 'Se connecter' }) : t('business.auth.businessSignIn', { defaultValue: 'Espace commerce' })}
                </Text>
                <Text
                  style={{
                    color: '#114b3c90',
                    fontSize: 14,
                    fontFamily: 'Poppins_400Regular',
                    textAlign: 'center',
                    lineHeight: 20,
                    marginBottom: theme.spacing.xxl,
                    paddingHorizontal: 10,
                  }}
                >
                  {role === 'customer'
                    ? t('auth.tagline', { defaultValue: '\u00c9conomisez, Sauvez la Nourriture et Luttez Contre le Gaspillage !' })
                    : t('auth.businessTagline', { defaultValue: 'Transformez vos invendus en revenus' })}
                </Text>

            <View style={styles.form}>
              <View style={[styles.inputContainer, { marginBottom: theme.spacing.xl }]}>
                <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                  {t('auth.email')}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: '#fff',
                      borderColor: '#114b3c30',
                      borderWidth: 1.5,
                      borderRadius: 14,
                      color: '#114b3c',
                      shadowColor: '#114b3c',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.06,
                      shadowRadius: 6,
                      elevation: 2,
                      ...theme.typography.body,
                    },
                  ]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('auth.placeholderEmail')}
                  placeholderTextColor="#114b3c40"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={t('auth.email')}
                />
              </View>

              <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                  {t('auth.password')}
                </Text>
                <PasswordInput
                  containerStyle={{
                    backgroundColor: '#fff',
                    borderColor: '#114b3c',
                    shadowColor: '#114b3c',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.06,
                    shadowRadius: 6,
                    elevation: 2,
                  }}
                  style={[styles.input, { color: '#114b3c', borderWidth: 0, ...theme.typography.body }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#114b3c40"
                  accessibilityLabel={t('auth.password')}
                />
              </View>

              <TouchableOpacity
                style={styles.forgotPassword}
                onPress={() => router.push({ pathname: '/auth/forgot-password', params: { role } } as never)}
                accessibilityLabel={t('auth.forgotPassword')}
                accessibilityRole="button"
              >
                <Text style={{ color: '#114b3c', ...theme.typography.bodySm, fontWeight: '600' }}>
                  {t('auth.forgotPassword')}
                </Text>
              </TouchableOpacity>

              <View style={[styles.buttonContainer, { marginTop: theme.spacing.xl }]}>
                <TouchableOpacity
                  onPress={handleSignIn}
                  disabled={loading}
                  style={{
                    height: 52,
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingHorizontal: 32,
                    backgroundColor: '#114b3c',
                    borderRadius: 14,
                    opacity: loading ? 0.5 : 1,
                  }}
                  activeOpacity={0.8}
                  accessibilityLabel={loading ? t('common.loading') : t('auth.signIn')}
                  accessibilityRole="button"
                >
                  <Text style={{ color: '#e3ff5c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
                    {loading ? t('common.loading') : t('auth.signIn')}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.footer, { marginTop: theme.spacing.xl }]}>
                <Text style={{ color: '#114b3c80', ...theme.typography.body }}>
                  {t('auth.noAccount')}{' '}
                </Text>
                <TouchableOpacity onPress={() => router.push('/auth/sign-up' as never)} accessibilityLabel={t('auth.signUp')} accessibilityRole="button">
                  <Text style={{ color: '#114b3c', ...theme.typography.body, fontWeight: '600', textDecorationLine: 'underline' }}>
                    {t('auth.signUp')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Role switch link */}
              <TouchableOpacity onPress={() => { setRole(role === 'customer' ? 'business' : 'customer'); }} style={{ marginTop: 14, alignSelf: 'center' }}>
                <Text style={{ color: '#114b3c', fontSize: 13, fontFamily: 'Poppins_400Regular', textDecorationLine: 'underline' }}>
                  {role === 'customer'
                    ? t('auth.businessLink', { defaultValue: 'Vous \u00eates un commerce ? Cliquez ici' })
                    : t('auth.customerLink', { defaultValue: 'Vous \u00eates un client ? Cliquez ici' })}
                </Text>
              </TouchableOpacity>
            </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Role mismatch modal */}
      <Modal visible={!!roleMismatchMsg} transparent animationType="fade" onRequestClose={() => setRoleMismatchMsg(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <BarakeatErrorIcon size={28} color="#ef4444" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('auth.wrongAccountType', { defaultValue: 'Mauvais type de compte' })}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {roleMismatchMsg}
            </Text>
            <TouchableOpacity
              onPress={() => { setRoleMismatchMsg(null); setStep('choose'); }}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {t('auth.switchRole', { defaultValue: 'Changer de mode' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* Generic error modal — replaces all Alert.alert calls */}
      <Modal visible={!!errorMsg} transparent animationType="fade" onRequestClose={() => setErrorMsg(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <BarakeatErrorIcon size={28} color="#ef4444" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('auth.error')}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {errorMsg}
            </Text>
            <TouchableOpacity
              onPress={() => setErrorMsg(null)}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {t('common.ok', { defaultValue: 'OK' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  roleSelector: {
    flexDirection: 'row',
  },
  roleOption: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {},
  inputContainer: {},
  label: {
    marginBottom: 8,
  },
  input: {
    height: 52,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
  },
  buttonContainer: {},
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
