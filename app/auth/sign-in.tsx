import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Image, Modal, Animated, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store, User, ChevronLeft, AlertTriangle, XCircle, Mail } from 'lucide-react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { login, loginWithGoogle, loginWithApple } from '@/src/services/auth';
import { clearSession } from '@/src/lib/session';
import { getErrorMessage } from '@/src/lib/api';
import type { UserRole, User as UserType } from '@/src/types';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Food emojis that fall from above and settle at fixed positions
// Food positions: top area + sides only — never behind the center buttons
const FOOD_ITEMS = [
  { emoji: '🥐', size: 44, finalX: SCREEN_W * 0.06, finalY: SCREEN_H * 0.04 },
  { emoji: '🍕', size: 40, finalX: SCREEN_W * 0.75, finalY: SCREEN_H * 0.03 },
  { emoji: '🧁', size: 36, finalX: SCREEN_W * 0.42, finalY: SCREEN_H * 0.01 },
  { emoji: '🥗', size: 42, finalX: SCREEN_W * 0.02, finalY: SCREEN_H * 0.16 },
  { emoji: '🍩', size: 36, finalX: SCREEN_W * 0.84, finalY: SCREEN_H * 0.14 },
  { emoji: '🥑', size: 32, finalX: SCREEN_W * 0.01, finalY: SCREEN_H * 0.78 },
  { emoji: '🌮', size: 36, finalX: SCREEN_W * 0.85, finalY: SCREEN_H * 0.80 },
  { emoji: '🍰', size: 38, finalX: SCREEN_W * 0.40, finalY: SCREEN_H * 0.88 },
];

// Full "welcome chez" in 3 languages, cycling
const WELCOME_WORDS = ['أهلاً بكم في', 'Welcome to', 'Bienvenue chez'];
// Required by expo-web-browser — must be called at module level
WebBrowser.maybeCompleteAuthSession();

// ── Pure-JS SHA-256 for PKCE (no native module needed) ──────────────────────
// Minimal implementation — only used to hash the code_verifier string.
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
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);
  const triggerSplash = useSplashStore((s) => s.triggerSplash);

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
  const foodAnims = useRef(FOOD_ITEMS.map(() => ({
    y: new Animated.Value(-120),
    opacity: new Animated.Value(0),
  }))).current;

  useEffect(() => {
    if (step !== 'choose') return;
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
  }, [step]);

  // ── Apple Sign-In ────────────────────────────────────────────────────────

  const handleAppleSignIn = async () => {
    try {
      setAppleLoading(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        setErrorMsg(t('auth.appleAuthError'));
        return;
      }

      const fullName = credential.fullName
        ? `${credential.fullName.givenName ?? ''} ${credential.fullName.familyName ?? ''}`.trim()
        : undefined;

      const res = await loginWithApple(credential.identityToken, fullName);

      const backendType = (res as any).user?.type ?? '';
      const mappedRole: UserRole = backendType === 'restaurant' ? 'business' : 'customer';

      // Enforce role match — block cross-role login
      if (mappedRole !== role) {
        await clearSession();
        setRoleMismatchMsg(role === 'customer'
          ? t('auth.notCustomerAccount', { defaultValue: 'Ce compte est enregistré comme commerce. Veuillez passer en mode commerçant.' })
          : t('auth.notBusinessAccount', { defaultValue: 'Ce compte est enregistré comme client. Veuillez passer en mode client.' }));
        setLoading(false);
        return;
      }

      const user: UserType = {
        id: res.user.id,
        name: res.user.name,
        firstName: res.user.firstName,
        email: res.user.email,
        phone: res.user.phone,
        role: mappedRole,
        gender: (res.user as any).gender ?? null,
      };

      signIn(user, res.token);
      console.log('[SignIn] Apple success, navigating for role:', mappedRole);
      triggerSplash();
      if (mappedRole === 'business') {
        router.replace('/(business)/dashboard' as never);
      } else {
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      if (err.code === 'ERR_REQUEST_CANCELED') return; // user cancelled
      const msg = getErrorMessage(err);
      console.log('[SignIn] Apple error:', msg);
      setErrorMsg(msg);
    } finally {
      setAppleLoading(false);
    }
  };

  // ── Google OAuth ─────────────────────────────────────────────────────────

  const handleGoogleSignIn = async () => {
    try {
      setGoogleLoading(true);
      const { url, redirectUri, codeVerifier, clientId } = buildGoogleAuthUrl();
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);

      // User cancelled / dismissed — silent no-op
      if (!result || result.type === 'cancel' || result.type === 'dismiss') {
        return;
      }

      if (result.type !== 'success') {
        setErrorMsg(t('auth.googleAuthError'));
        return;
      }

      // Auth code is in the redirect query params
      const code = parseCodeFromUrl(result.url);
      if (!code) {
        console.log('[Google] No code in redirect URL:', result.url);
        setErrorMsg(t('auth.googleAuthError'));
        return;
      }

      // Exchange code — get both accessToken and idToken
      const { accessToken, idToken } = await exchangeAuthCode(code, redirectUri, codeVerifier, clientId);

      // DEBUG: confirm idToken is valid before calling backend
      console.log('[Google] idToken exists:', !!idToken, '| length:', idToken?.length ?? 0);
      console.log('[Google] Sending to backend: { accessToken: ' + (!!accessToken) + ', idToken: ' + (!!idToken) + ' }');

      // Send both to backend (backend decodes idToken payload without any network call)
      const res = await loginWithGoogle(accessToken, idToken);



      // Map backend type to app role
      const backendType = (res as any).user?.type ?? '';
      const mappedRole: UserRole =
        backendType === 'restaurant' ? 'business' : 'customer';

      // Enforce role match — block cross-role login
      if (mappedRole !== role) {
        await clearSession();
        setRoleMismatchMsg(role === 'customer'
          ? t('auth.notCustomerAccount', { defaultValue: 'Ce compte est enregistré comme commerce. Veuillez passer en mode commerçant.' })
          : t('auth.notBusinessAccount', { defaultValue: 'Ce compte est enregistré comme client. Veuillez passer en mode client.' }));
        setGoogleLoading(false);
        return;
      }

      const user: UserType = {
        id: res.user.id,
        name: res.user.name,
        firstName: res.user.firstName,
        email: res.user.email,
        phone: res.user.phone,
        role: mappedRole,
        gender: (res.user as any).gender ?? null,
      };

      signIn(user, res.token);
      console.log('[SignIn] Google success, navigating for role:', mappedRole);
      triggerSplash();
      if (mappedRole === 'business') {
        router.replace('/(business)/dashboard' as never);
      } else {
        router.replace('/(tabs)');
      }
    } catch (err) {
      const msg = getErrorMessage(err);
      console.log('[SignIn] Google error:', msg);
      setErrorMsg(msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSignIn = async () => {

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
      const user: UserType = {
        id: res.user.id,
        name: res.user.name,
        firstName: res.user.firstName,
        email: res.user.email,
        phone: res.user.phone,
        role: mappedRole,
        gender: (res.user as any).gender ?? null,
      };
      signIn(user, res.token);
      console.log('[SignIn] Success, navigating for role:', user.role, '(backend:', backendRole, ')');
      triggerSplash();
      if (user.role === 'business') {
        router.replace('/(business)/dashboard' as never);
      } else {
        router.replace('/(tabs)');
      }
    } catch (err) {
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.content, { padding: theme.spacing.xxl }]}>
            {step === 'choose' ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                {/* Floating food emojis */}
                {FOOD_ITEMS.map((item, i) => (
                  <Animated.Text
                    key={i}
                    style={{
                      position: 'absolute',
                      left: item.finalX,
                      top: item.finalY,
                      fontSize: item.size,
                      opacity: foodAnims[i].opacity,
                      transform: [{ translateY: foodAnims[i].y }],
                    }}
                  >
                    {item.emoji}
                  </Animated.Text>
                ))}

                {/* Paper bag image */}
                <Image
                  source={require('@/assets/images/barakeat_paper_bag.png')}
                  style={{ width: 130, height: 130, marginBottom: 24 }}
                  resizeMode="contain"
                />

                {/* Animated welcome phrase cycling: Arabic → English → French */}
                <Animated.Text style={{
                  opacity: welcomeFade,
                  color: '#114b3c',
                  fontSize: 24,
                  fontFamily: 'Poppins_400Regular',
                  textAlign: 'center',
                  minHeight: 36,
                }}>
                  {WELCOME_WORDS[welcomeIdx]}
                </Animated.Text>

                <Text style={{
                  color: '#114b3c',
                  fontSize: 38,
                  fontWeight: '700',
                  fontFamily: 'Poppins_700Bold',
                  textAlign: 'center',
                  marginTop: 4,
                }}>
                  Barakeat.
                </Text>

                {/* Sign-in buttons — fade in after food settles */}
                <Animated.View style={{ opacity: buttonsOpacity, width: '100%', marginTop: 48, gap: 12 }}>
                  {/* Google */}
                  <TouchableOpacity
                    onPress={() => { setRole('customer'); handleGoogleSignIn(); }}
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

                  {/* Apple — iOS only */}
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      onPress={() => { setRole('customer'); handleAppleSignIn(); }}
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
                <Animated.View style={{ opacity: buttonsOpacity, marginTop: 28, alignItems: 'center', gap: 12 }}>
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
                <TouchableOpacity
                  onPress={() => setStep('choose')}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: '#114b3c15',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginBottom: theme.spacing.lg,
                  }}
                  accessibilityLabel={t('common.goBack', { defaultValue: 'Retour' })}
                  accessibilityRole="button"
                >
                  <ChevronLeft size={28} color="#114b3c" />
                </TouchableOpacity>
                <Text style={{ color: '#114b3c', fontSize: 34, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 2 }}>
                  Barakeat.
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
                  placeholder="you@example.com"
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
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#114b3c40"
                  secureTextEntry
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
              <AlertTriangle size={28} color="#ef4444" />
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
              <XCircle size={28} color="#ef4444" />
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
