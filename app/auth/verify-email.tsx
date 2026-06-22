import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Modal, BackHandler } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { verifySignupOtp, resendSignupVerificationOtp, abortSignup, verifyRestaurantSignupOtp, resendRestaurantSignupOtp } from '@/src/services/auth';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { useAuthStore } from '@/src/stores/authStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Customer-signup email verification screen.
 *
 * Reached automatically after a successful POST /auth/register OR after a
 * /login attempt that fails with `requiresVerification: true` (e.g. user
 * killed the app between signup and verification). The OTP was sent by the
 * backend at registration; this screen submits it via /verify-signup-otp,
 * receives a fresh session token on success, and hands off to the tabs.
 *
 * Mirrors the OTP step of forgot-password.tsx so the visual language stays
 * consistent across auth flows.
 */
export default function VerifyEmailScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; kind?: string }>();
  const email = (params.email ?? '').toString();
  // 'restaurant' = commerce signup — no JWT comes back on verify (still
  // pending admin approval). Anything else (or unset) = buyer flow.
  const isRestaurant = (params.kind ?? '').toString().toLowerCase() === 'restaurant';
  const signIn = useAuthStore((s) => s.signIn);

  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN_SECONDS);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [aborting, setAborting] = useState(false);
  // Restaurant signup ends on a "demande reçue" thank-you state instead of
  // navigating away — the applicant needs to see that the email verification
  // worked and that the team will follow up after review.
  const [restaurantSubmitted, setRestaurantSubmitted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  // Going back from this screen would leave a half-finished signup behind —
  // the staged pending_signups row + its still-valid OTP. Confirm with the
  // user, then call /abort-signup to drop it so the same email is usable
  // again. Covers both the UI back arrow and Android hardware back.
  //
  // After a restaurant demande has been successfully submitted, there's
  // nothing to abort — bounce straight to sign-in instead of nagging.
  const handleBackPress = useCallback(() => {
    if (restaurantSubmitted) {
      try { router.replace('/auth/sign-in' as never); } catch { router.back(); }
      return true;
    }
    setShowBackConfirm(true);
    return true; // tell Android we consumed the back press
  }, [restaurantSubmitted, router]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    return () => sub.remove();
  }, [handleBackPress]);

  const handleBackConfirm = useCallback(async () => {
    if (aborting) return;
    setAborting(true);
    try {
      if (email) {
        try { await abortSignup(email, isRestaurant ? 'restaurant' : 'buyer'); } catch {} // best-effort; never block back nav
      }
    } finally {
      setAborting(false);
      setShowBackConfirm(false);
      // Replace so the verify-email screen never reappears in the back stack
      // post-abort. Sign-in is the safe fallback for any entry path.
      try { router.replace('/auth/sign-in' as never); } catch { router.back(); }
    }
  }, [aborting, email, router]);

  // Start the resend cooldown immediately on mount — the OTP was just sent at
  // registration, so a re-send is pointless for the first minute.
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const handleVerify = async () => {
    if (otp.trim().length < 6) {
      setErrorMsg(t('auth.verifyEmail.invalidOtp', { defaultValue: 'Code invalide ou expiré.' }));
      return;
    }
    if (!email) {
      setErrorMsg(t('auth.verifyEmail.missingEmail', { defaultValue: "Email manquant. Veuillez recommencer l'inscription." }));
      return;
    }
    setLoading(true);
    try {
      if (isRestaurant) {
        // Restaurant flow — verify only. No JWT yet (admin still has to
        // approve). Swap to the in-screen "demande reçue" thank-you state so
        // the applicant sees an explicit confirmation that the verification
        // worked and that Barakeat will reach out after review.
        await verifyRestaurantSignupOtp(email, otp.trim());
        setRestaurantSubmitted(true);
        return;
      }
      const res = await verifySignupOtp(email, otp.trim());
      if (!res?.token || !res?.user) {
        setErrorMsg(getErrorMessage(new Error('Empty response')));
        return;
      }
      // Hand off to the auth store — saves token/user and unlocks the tabs.
      // Await so the SecureStore writes commit BEFORE we navigate; otherwise
      // a fast Metro reload right after sign-up could find the SecureStore
      // empty on next launch and force the user to log in again.
      // Brand-new account's first login. Flag it so the root layout mounts the
      // onboarding carousel under the splash once auth flips (no probe-latency
      // flash). Then show the loading splash and DEFER the auth-state flip to
      // the END of the animation — the same pattern the sign-in screen uses —
      // so a freshly verified account also sees the halo animation before
      // landing in the app, and the carousel only appears once it finishes.
      // Navigation is left to the routing guard (it fires after the animation).
      useWalkthroughStore.getState().setPendingFirstRun(true);
      useSplashStore.getState().triggerSplash();
      useSplashStore.getState().setPendingAnimFinish(() => signIn(res.user as any, res.token));
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || !email) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      if (isRestaurant) {
        // Partner emails are sent in French regardless of UI language (per
        // product call — the team monitors a single inbox locale for now).
        await resendRestaurantSignupOtp(email);
      } else {
        const rawLang = (i18n.language || 'fr').slice(0, 2).toLowerCase();
        const arAllowed = FeatureFlags.LANGUAGES_AR_ENABLED;
        const locale = (rawLang === 'en' || (rawLang === 'ar' && arAllowed) ? rawLang : 'fr') as 'fr' | 'en' | 'ar';
        await resendSignupVerificationOtp(email, locale);
      }
      // Visible confirmation — the user needs to know the press did something.
      // Auto-hide after 4s; the resend countdown also re-arms below.
      setSuccessMsg(t('auth.verifyEmail.resendSuccess', { defaultValue: 'Code renvoyé. Vérifiez votre boîte mail.' }));
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessMsg(null), 4000);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Restaurant signup thank-you state. Reached only after a successful
  // restaurant OTP verification. The screen replaces the OTP form entirely so
  // the applicant can't accidentally re-submit, and the only exit is the
  // "Retour à la connexion" CTA.
  if (restaurantSubmitted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.content, { padding: theme.spacing.xxl, justifyContent: 'center', flex: 1 }]}>
            <View style={{
              backgroundColor: theme.colors.primary + '15',
              borderRadius: theme.radii.r24,
              padding: theme.spacing.xl,
              alignSelf: 'center',
              marginBottom: theme.spacing.xxl,
            }}>
              <CheckCircle2 size={40} color={theme.colors.primary} />
            </View>
            <Text style={[styles.title, { color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.md }]}>
              {t('auth.verifyEmail.restaurantSuccessTitle', { defaultValue: 'Demande reçue !' })}
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.xxl, paddingHorizontal: theme.spacing.md, lineHeight: 22 }]}>
              {t('auth.verifyEmail.restaurantSuccessBody', {
                defaultValue: 'Merci ! Notre équipe va étudier votre demande et vous recontactera par email dès que votre compte commerce sera prêt.',
              })}
            </Text>
            <PrimaryCTAButton
              onPress={() => router.replace('/auth/sign-in' as never)}
              title={t('auth.verifyEmail.backToSignIn', { defaultValue: 'Retour à la connexion' })}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.content, { padding: theme.spacing.xxl }]}>
            <TouchableOpacity
              onPress={handleBackPress}
              style={[styles.backButton, { marginBottom: theme.spacing.xxl }]}
              accessibilityLabel={t('common.back', { defaultValue: 'Retour' })}
            >
              <ArrowLeft size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            {/* Centered content block — fills the space below the back button and
                centres the icon/title/code form vertically. The back button
                stays pinned top-left above this wrapper. */}
            <View style={{ flex: 1, justifyContent: 'center' }}>
            <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignSelf: 'center', marginBottom: theme.spacing.xxl }]}>
              <KeyRound size={32} color={theme.colors.primary} />
            </View>
            <Text style={[styles.title, { color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
              {t('auth.verifyEmail.title', { defaultValue: 'Vérifiez votre email' })}
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
              {email
                ? t('auth.verifyEmail.desc', { defaultValue: 'Entrez le code à 6 chiffres envoyé à {{email}}.', email })
                : t('auth.verifyEmail.descNoEmail', { defaultValue: 'Entrez le code à 6 chiffres reçu par email.' })}
            </Text>

            {successMsg && (
              <View style={{
                backgroundColor: theme.colors.primary + '15',
                borderColor: theme.colors.primary + '40',
                borderWidth: 1,
                borderRadius: theme.radii.r12,
                paddingVertical: 10,
                paddingHorizontal: 14,
                marginBottom: theme.spacing.lg,
              }}>
                <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>
                  {successMsg}
                </Text>
              </View>
            )}

            <View style={[styles.inputContainer, { marginBottom: theme.spacing.xxl }]}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                {t('auth.verifyEmail.codeLabel', { defaultValue: 'Code de vérification' })}
                <Text style={{ color: theme.colors.error }}> *</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.otpInput,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                    borderRadius: theme.radii.r12,
                    color: theme.colors.textPrimary,
                    ...theme.typography.h2,
                    ...theme.shadows.shadowSm,
                  },
                ]}
                value={otp}
                onChangeText={setOtp}
                placeholder="• • • • • •"
                placeholderTextColor={theme.colors.muted}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
            </View>

            <PrimaryCTAButton
              onPress={handleVerify}
              title={t('auth.verifyEmail.verify', { defaultValue: 'Vérifier' })}
              loading={loading}
            />

            <TouchableOpacity
              onPress={countdown > 0 ? undefined : handleResend}
              style={[styles.resendButton, { marginTop: theme.spacing.xl }]}
              disabled={countdown > 0 || loading}
            >
              <Text style={[{ color: countdown > 0 ? theme.colors.muted : theme.colors.primary, ...theme.typography.bodySm }]}>
                {countdown > 0
                  ? t('auth.verifyEmail.resendIn', { defaultValue: 'Renvoyer dans {{seconds}}s', seconds: countdown })
                  : t('auth.verifyEmail.resend', { defaultValue: 'Renvoyer le code' })}
              </Text>
            </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Error modal — uses the Barakeat sad-bag icon like other auth errors */}
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

      {/* Back-out confirmation — warns the user that the OTP will be invalidated
          and they'll have to restart signup. Confirming calls /abort-signup to
          drop the staged pending_signups row, then navigates back. */}
      <Modal visible={showBackConfirm} transparent animationType="fade" onRequestClose={() => !aborting && setShowBackConfirm(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: theme.colors.surfaceMuted, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <BarakeatErrorIcon size={28} color={theme.colors.textSecondary} />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('auth.verifyEmail.backConfirmTitle', { defaultValue: 'Quitter la vérification ?' })}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {t('auth.verifyEmail.backConfirmBody', { defaultValue: "Le code va expirer et vous devrez recommencer l'inscription." })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={() => !aborting && setShowBackConfirm(false)}
                disabled={aborting}
                style={{ flex: 1, backgroundColor: '#f5f5f1', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e8e8e3' }}
              >
                <Text style={{ color: '#1a1a1a', fontSize: 14, fontWeight: '600', fontFamily: 'Poppins_600SemiBold' }}>
                  {t('common.cancel', { defaultValue: 'Annuler' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBackConfirm}
                disabled={aborting}
                style={{ flex: 1, backgroundColor: '#d94f4f', borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: aborting ? 0.7 : 1 }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {aborting
                    ? t('common.loading', { defaultValue: 'Chargement...' })
                    : t('auth.verifyEmail.backConfirmCta', { defaultValue: 'Quitter' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1 },
  backButton: { alignSelf: 'flex-start' },
  iconContainer: {},
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  inputContainer: {},
  label: { marginBottom: 8 },
  input: { height: 52, borderWidth: 1, paddingHorizontal: 16 },
  otpInput: { textAlign: 'center', letterSpacing: 8 },
  resendButton: { alignSelf: 'center' },
});
