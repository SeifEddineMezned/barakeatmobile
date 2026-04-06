import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, Image, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store, User, ChevronLeft, AlertTriangle } from 'lucide-react-native';
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
// Required by expo-web-browser — must be called at module level
WebBrowser.maybeCompleteAuthSession();

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

async function buildGoogleAuthUrl(): Promise<{ url: string; redirectUri: string; codeVerifier: string; clientId: string }> {
  const cfg = Platform.OS === 'ios' ? GOOGLE_CLIENT.ios : GOOGLE_CLIENT.android;
  const redirectUri = `${cfg.scheme}:/oauth2redirect`;
  const codeVerifier = [
    Math.random().toString(36).substring(2),
    Math.random().toString(36).substring(2),
    Math.random().toString(36).substring(2),
  ].join('');
  // SHA-256 PKCE using Web Crypto API (available in Hermes, no native module needed)
  const encoded = new TextEncoder().encode(codeVerifier);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const hashBytes = new Uint8Array(hashBuffer);
  let binary = '';
  hashBytes.forEach((b) => { binary += String.fromCharCode(b); });
  const codeChallenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
        Alert.alert(t('auth.error'), t('auth.appleAuthError'));
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
      Alert.alert(t('auth.error'), msg);
    } finally {
      setAppleLoading(false);
    }
  };

  // ── Google OAuth ─────────────────────────────────────────────────────────

  const handleGoogleSignIn = async () => {
    try {
      setGoogleLoading(true);
      const { url, redirectUri, codeVerifier, clientId } = await buildGoogleAuthUrl();
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);

      // User cancelled / dismissed — silent no-op
      if (!result || result.type === 'cancel' || result.type === 'dismiss') {
        return;
      }

      if (result.type !== 'success') {
        Alert.alert(t('auth.error'), t('auth.googleAuthError'));
        return;
      }

      // Auth code is in the redirect query params
      const code = parseCodeFromUrl(result.url);
      if (!code) {
        console.log('[Google] No code in redirect URL:', result.url);
        Alert.alert(t('auth.error'), t('auth.googleAuthError'));
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
      Alert.alert(t('auth.error'), msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSignIn = async () => {

    if (!email.trim() || !password.trim()) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
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
      Alert.alert(t('auth.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#114b3c' }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.content, { padding: theme.spacing.xxl }]}>
            {step === 'choose' ? (
              <>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
                  {t('auth.welcomeTo', { defaultValue: 'Bienvenue chez' })}
                </Text>
                <Text style={{ color: '#eff35c', fontSize: 36, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginTop: 4, marginBottom: theme.spacing.lg }}>
                  Barakeat.
                </Text>
                <Text
                  style={[
                    styles.subtitle,
                    { color: 'rgba(255,255,255,0.6)', ...theme.typography.body, marginBottom: theme.spacing.xxxl, textAlign: 'center' },
                  ]}
                >
                  {t('auth.chooseAccountType')}
                </Text>

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      backgroundColor: '#e3ff5c',
                      borderRadius: theme.radii.r16,
                      padding: 16,
                      alignItems: 'center',
                    }}
                    onPress={() => { setRole('customer'); setStep('login'); }}
                    activeOpacity={0.8}
                    accessibilityLabel={t('auth.customerRole')}
                    accessibilityRole="button"
                    accessibilityHint={t('auth.customerRoleDesc')}
                  >
                    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#114b3c20', justifyContent: 'center', alignItems: 'center', marginBottom: 10 }}>
                      <User size={26} color="#114b3c" />
                    </View>
                    <Text style={{ color: '#114b3c', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
                      {t('auth.iAm', { defaultValue: 'Je suis' })}
                    </Text>
                    <Text style={{ color: '#114b3c', fontSize: 17, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
                      {t('auth.clientLabel', { defaultValue: 'Client' })}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{
                      flex: 1,
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      borderRadius: theme.radii.r16,
                      padding: 16,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.2)',
                    }}
                    onPress={() => { setRole('business'); setStep('login'); }}
                    activeOpacity={0.8}
                    accessibilityLabel={t('business.auth.switchToBusiness')}
                    accessibilityRole="button"
                    accessibilityHint={t('auth.businessRoleDesc')}
                  >
                    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 10 }}>
                      <Store size={26} color="#fff" />
                    </View>
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
                      {t('auth.iAm', { defaultValue: 'Je suis' })}
                    </Text>
                    <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
                      {t('auth.merchantLabel', { defaultValue: 'Commerçant' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => setStep('choose')}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginBottom: theme.spacing.xl,
                  }}
                  accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })}
                  accessibilityRole="button"
                >
                  <ChevronLeft size={28} color="#fff" />
                </TouchableOpacity>
                <Text
                  style={[
                    styles.title,
                    { color: '#fff', ...theme.typography.h1, marginBottom: theme.spacing.sm },
                  ]}
                >
                  {role === 'customer' ? t('auth.signIn') : t('business.auth.businessSignIn')}
                </Text>
                <Text
                  style={[
                    styles.subtitle,
                    { color: 'rgba(255,255,255,0.7)', ...theme.typography.body, marginBottom: theme.spacing.xxl },
                  ]}
                >
                  {role === 'customer' ? t('auth.customerRoleDesc') : t('auth.businessRoleDesc')}
                </Text>

            <View style={styles.form}>
              <View style={[styles.inputContainer, { marginBottom: theme.spacing.xl }]}>
                <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>
                  {t('auth.email')}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      borderColor: 'rgba(255,255,255,0.2)',
                      borderRadius: theme.radii.r12,
                      color: '#fff',
                      ...theme.typography.body,
                    },
                  ]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={t('auth.email')}
                />
              </View>

              <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>
                  {t('auth.password')}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      borderColor: 'rgba(255,255,255,0.2)',
                      borderRadius: theme.radii.r12,
                      color: '#fff',
                      ...theme.typography.body,
                    },
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  secureTextEntry
                  accessibilityLabel={t('auth.password')}
                />
              </View>

              <TouchableOpacity
                style={styles.forgotPassword}
                onPress={() => router.push('/auth/forgot-password' as never)}
                accessibilityLabel={t('auth.forgotPassword')}
                accessibilityRole="button"
              >
                <Text style={[{ color: '#e3ff5c', ...theme.typography.bodySm }]}>
                  {t('auth.forgotPassword')}
                </Text>
              </TouchableOpacity>

              <View style={[styles.buttonContainer, { marginTop: theme.spacing.xxxl }]}>
                <TouchableOpacity
                  onPress={handleSignIn}
                  disabled={loading}
                  style={{
                    height: 56,
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingHorizontal: 32,
                    backgroundColor: '#e3ff5c',
                    borderRadius: theme.radii.pill,
                    opacity: loading ? 0.5 : 1,
                  }}
                  activeOpacity={0.8}
                  accessibilityLabel={loading ? t('common.loading') : t('auth.signIn')}
                  accessibilityRole="button"
                >
                  <Text style={{ color: '#114b3c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
                    {loading ? t('common.loading') : t('auth.signIn')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Google sign-in — only for customer, under sign-in button with divider */}
              {role === 'customer' && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: theme.spacing.lg }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
                    <Text style={{ color: 'rgba(255,255,255,0.5)', ...theme.typography.bodySm, marginHorizontal: theme.spacing.lg }}>
                      {t('auth.or')}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
                  </View>
                  <TouchableOpacity
                    onPress={handleGoogleSignIn}
                    disabled={googleLoading || loading}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      alignSelf: 'center',
                      height: 48,
                      backgroundColor: '#ffffff',
                      borderRadius: theme.radii.r12,
                      paddingHorizontal: 16,
                      opacity: googleLoading || loading ? 0.6 : 1,
                    }}
                    accessibilityLabel={t('auth.continueWithGoogle')}
                    accessibilityRole="button"
                  >
                    {googleLoading ? (
                      <ActivityIndicator size="small" color="#4285F4" style={{ marginRight: 10 }} />
                    ) : (
                      <Image
                        source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }}
                        style={{ width: 20, height: 20, marginRight: 10 }}
                        resizeMode="contain"
                      />
                    )}
                    <Text style={{ color: '#3c4043', ...theme.typography.body, fontWeight: '600' }}>
                      {t('auth.continueWithGoogle')}
                    </Text>
                  </TouchableOpacity>

                  {/* Apple Sign-In — iOS only */}
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity
                      onPress={handleAppleSignIn}
                      disabled={appleLoading || loading}
                      activeOpacity={0.8}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        alignSelf: 'center',
                        height: 48,
                        backgroundColor: '#000000',
                        borderRadius: theme.radii.r12,
                        paddingHorizontal: 16,
                        marginTop: 12,
                        opacity: appleLoading || loading ? 0.6 : 1,
                      }}
                      accessibilityLabel={t('auth.continueWithApple')}
                      accessibilityRole="button"
                    >
                      {appleLoading ? (
                        <ActivityIndicator size="small" color="#fff" style={{ marginRight: 10 }} />
                      ) : (
                        <FontAwesome name="apple" size={20} color="#fff" style={{ marginRight: 8 }} />
                      )}
                      <Text style={{ color: '#ffffff', ...theme.typography.body, fontWeight: '600' }}>
                        {t('auth.continueWithApple')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
                <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.body }]}>
                  {t('auth.noAccount')}{' '}
                </Text>
                <TouchableOpacity onPress={() => router.push('/auth/sign-up' as never)} accessibilityLabel={t('auth.signUp')} accessibilityRole="button">
                  <Text style={[{ color: '#e3ff5c', ...theme.typography.body, fontWeight: '600' as const }]}>
                    {t('auth.signUp')}
                  </Text>
                </TouchableOpacity>
              </View>
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
