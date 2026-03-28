import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store, User } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { login, loginWithGoogle } from '@/src/services/auth';
import { getErrorMessage } from '@/src/lib/api';
import type { UserRole, User as UserType } from '@/src/types';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';

// Required by expo-web-browser — must be called at module level
WebBrowser.maybeCompleteAuthSession();

// ── Google OAuth helpers ─────────────────────────────────────────────────────
// IMPORTANT: We use the WEB client ID for all platforms. This is required
// because native client IDs do NOT return an id_token during auth code
// exchange for public clients (no client_secret). The Web client ID with
// an Expo Auth redirect URI returns both access_token and id_token.
const GOOGLE_WEB_CLIENT_ID = '563732969753-6qpdd2nmllsgqh3am96o4q683bl233ph.apps.googleusercontent.com';

// Expo Auth proxy redirect URI — matches the Google Cloud Console config
const EXPO_REDIRECT_URI = 'https://auth.expo.io/@smzd/barakeat-surprise-baskets';

function buildGoogleAuthUrl(): { url: string; redirectUri: string; codeVerifier: string; clientId: string } {
  const redirectUri = EXPO_REDIRECT_URI;
  // Plain PKCE: code_challenge === code_verifier (no SHA-256, no expo-crypto)
  const codeVerifier = [
    Math.random().toString(36).substring(2),
    Math.random().toString(36).substring(2),
    Math.random().toString(36).substring(2),
  ].join('');
  const params = new URLSearchParams({
    client_id: GOOGLE_WEB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: codeVerifier,       // plain method: challenge === verifier
    code_challenge_method: 'plain',
    access_type: 'online',
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    redirectUri,
    codeVerifier,
    clientId: GOOGLE_WEB_CLIENT_ID,
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
  const [role, setRole] = useState<UserRole>('customer');

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
      const res = await login({ email: email.trim(), password });
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
        const msgKey = role === 'customer' ? 'auth.notCustomerAccount' : 'auth.notBusinessAccount';
        Alert.alert(t('auth.error'), t(msgKey));
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
            <Text
              style={[
                styles.title,
                { color: '#fff', ...theme.typography.h1, marginBottom: theme.spacing.sm },
              ]}
            >
              {t('auth.welcomeBack')}
            </Text>
            <Text
              style={[
                styles.subtitle,
                { color: 'rgba(255,255,255,0.7)', ...theme.typography.body, marginBottom: theme.spacing.xxl },
              ]}
            >
              {t('auth.welcome')}
            </Text>

            <View style={[styles.roleSelector, { marginBottom: theme.spacing.xxl }]}>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  {
                    flex: 1,
                    paddingVertical: theme.spacing.lg,
                    borderRadius: theme.radii.r12,
                    backgroundColor: role === 'customer' ? '#e3ff5c' : 'rgba(255,255,255,0.12)',
                    marginRight: theme.spacing.sm,
                  },
                ]}
                onPress={() => setRole('customer')}
                activeOpacity={0.8}
              >
                <User size={22} color={role === 'customer' ? '#114b3c' : '#fff'} />
                <Text
                  style={[
                    {
                      color: role === 'customer' ? '#114b3c' : '#fff',
                      ...theme.typography.bodySm,
                      fontWeight: '600' as const,
                      marginTop: 6,
                    },
                  ]}
                >
                  {t('business.auth.switchToCustomer')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  {
                    flex: 1,
                    paddingVertical: theme.spacing.lg,
                    borderRadius: theme.radii.r12,
                    backgroundColor: role === 'business' ? '#e3ff5c' : 'rgba(255,255,255,0.12)',
                    marginLeft: theme.spacing.sm,
                  },
                ]}
                onPress={() => setRole('business')}
                activeOpacity={0.8}
              >
                <Store size={22} color={role === 'business' ? '#114b3c' : '#fff'} />
                <Text
                  style={[
                    {
                      color: role === 'business' ? '#114b3c' : '#fff',
                      ...theme.typography.bodySm,
                      fontWeight: '600' as const,
                      marginTop: 6,
                    },
                  ]}
                >
                  {t('business.auth.switchToBusiness')}
                </Text>
              </TouchableOpacity>
            </View>

            {role === 'customer' && (
              <>
                <TouchableOpacity
                  onPress={handleGoogleSignIn}
                  disabled={googleLoading || loading}
                  activeOpacity={0.8}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 56,
                    backgroundColor: '#ffffff',
                    borderRadius: theme.radii.pill,
                    paddingHorizontal: 24,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.12,
                    shadowRadius: 6,
                    elevation: 3,
                    opacity: googleLoading || loading ? 0.6 : 1,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: '#fff',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                      borderWidth: 1,
                      borderColor: '#e0e0e0',
                    }}
                  >
                    {googleLoading ? (
                      <ActivityIndicator size="small" color="#4285F4" />
                    ) : (
                      <Text
                        style={{
                          fontSize: 16,
                          fontWeight: '700' as const,
                          color: '#4285F4',
                        }}
                      >
                        G
                      </Text>
                    )}
                  </View>
                  <Text
                    style={{
                      color: '#3c4043',
                      ...theme.typography.button,
                      fontWeight: '600' as const,
                    }}
                  >
                    {t('auth.continueWithGoogle')}
                  </Text>
                </TouchableOpacity>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginVertical: theme.spacing.xl,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      height: 1,
                      backgroundColor: 'rgba(255,255,255,0.25)',
                    }}
                  />
                  <Text
                    style={{
                      color: 'rgba(255,255,255,0.5)',
                      ...theme.typography.bodySm,
                      marginHorizontal: theme.spacing.lg,
                    }}
                  >
                    {t('auth.or')}
                  </Text>
                  <View
                    style={{
                      flex: 1,
                      height: 1,
                      backgroundColor: 'rgba(255,255,255,0.25)',
                    }}
                  />
                </View>
              </>
            )}

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
                />
              </View>

              <TouchableOpacity
                style={styles.forgotPassword}
                onPress={() => router.push('/auth/forgot-password' as never)}
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
                >
                  <Text style={{ color: '#114b3c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
                    {loading ? t('common.loading') : t('auth.signIn')}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
                <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.body }]}>
                  {t('auth.noAccount')}{' '}
                </Text>
                <TouchableOpacity onPress={() => router.push('/auth/sign-up' as never)}>
                  <Text style={[{ color: '#e3ff5c', ...theme.typography.body, fontWeight: '600' as const }]}>
                    {t('auth.signUp')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
