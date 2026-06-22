import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, DevSettings } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import * as Updates from 'expo-updates';
import { KeyRound } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { AccountFlowPage, accountFlowStyles } from '@/src/components/AccountFlowPage';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { useAuthStore } from '@/src/stores/authStore';
import { verifyEmailChange, requestEmailChange } from '@/src/services/profile';
import { getErrorMessage } from '@/src/lib/api';

/**
 * Step 3 of the change-email flow. The user typed the new email on step 2,
 * which triggered an OTP send to that address; here they type the code.
 * On successful verify the backend flips the email on the user row — we
 * invalidate the cached profile so screens that show the email refresh.
 *
 * The current password is still in route params so "Renvoyer le code" can
 * re-call PUT /api/users/email without sending the user back to step 1.
 * Failure to verify keeps the user here with a specific error; the
 * backend leaves the current email unchanged on miss.
 */
export default function ChangeEmailVerifyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const customAlert = useCustomAlert();
  const authUser = useAuthStore((s) => s.user);
  const setAuthUser = useAuthStore((s) => s.setUser);
  const { newEmail, currentPwd } = useLocalSearchParams<{ newEmail?: string; currentPwd?: string }>();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleVerify = async () => {
    if (!otp.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    if (!newEmail) {
      setErrorMsg(t('account.confirmPasswordExpired', { defaultValue: 'Veuillez recommencer le processus de changement d\'email.' }));
      setTimeout(() => router.replace('/account/change-email-confirm' as never), 600);
      return;
    }
    setLoading(true);
    try {
      const { email: confirmedEmail } = await verifyEmailChange(String(newEmail), otp.trim());
      // Mirror the new email into the auth store right away so any screen
      // already mounted (settings, profile) shows the updated address even
      // if the JS bundle reload below ends up being a no-op (Expo Go).
      if (authUser) setAuthUser({ ...authUser, email: confirmedEmail });
      setLoading(false);
      // Success popup, then refresh the app. The reload restarts the JS
      // bundle so every cached screen rebuilds against the new email — the
      // surest way to "the whole app shows the new email now" without
      // chasing every cache key by hand. If reload fails (e.g. Expo Go in
      // dev), fall through to dismiss(3) + cache clear so the user still
      // returns to /settings with fresh data.
      customAlert.showAlert(
        t('account.emailUpdatedTitle', { defaultValue: 'Email mis à jour' }),
        t('account.emailUpdatedBody', {
          email: confirmedEmail,
          defaultValue: 'Votre adresse email a été changée avec succès en {{email}}. L\'application va redémarrer.',
        }),
        [
          {
            text: 'OK',
            onPress: () => {
              // Hard refresh strategy — pick the right tool per environment:
              //   • __DEV__ (Expo Go, EAS dev build): DevSettings.reload()
              //     bounces the JS bundle. Updates.reloadAsync() tends to
              //     silently no-op in Expo Go, which is what the user hit.
              //   • production: Updates.reloadAsync() restarts the bundle.
              // Both run synchronously after this onPress returns, so we
              // also clear queryClient + dismiss(3) as a deterministic
              // fallback in case neither reload mechanism actually fires —
              // the user always at least leaves the email-change stack
              // with fresh caches.
              queryClient.clear();
              try {
                if (__DEV__ && typeof DevSettings?.reload === 'function') {
                  DevSettings.reload();
                  return;
                }
              } catch (devErr) {
                console.warn('[ChangeEmailVerify] DevSettings.reload failed:', devErr);
              }
              Updates.reloadAsync().catch((reloadErr) => {
                console.warn('[ChangeEmailVerify] Updates.reloadAsync failed, falling back to navigation:', reloadErr);
                router.dismiss(3);
              });
            },
          },
        ],
      );
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    if (!newEmail || !currentPwd) {
      setErrorMsg(t('account.confirmPasswordExpired', { defaultValue: 'Veuillez recommencer le processus.' }));
      setTimeout(() => router.replace('/account/change-email-confirm' as never), 600);
      return;
    }
    setResending(true);
    try {
      await requestEmailChange(String(currentPwd), String(newEmail));
      setCountdown(60);
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <AccountFlowPage
      icon={<KeyRound size={32} color={theme.colors.primary} />}
      title={t('account.enterCodeTitle', { defaultValue: 'Entrez le code' })}
      subtitle={t('account.enterCodeDesc', { email: newEmail, defaultValue: 'Un code à 6 chiffres a été envoyé à {{email}}.' })}
      onBack={() => router.back()}
      errorMsg={errorMsg}
      onClearError={() => setErrorMsg(null)}
    >
      <View style={[accountFlowStyles.inputContainer, { marginBottom: theme.spacing.xxl }]}>
        <Text style={[accountFlowStyles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
          {t('auth.otpCode')}<Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <TextInput
          style={[accountFlowStyles.input, accountFlowStyles.otpInput, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.h2, ...theme.shadows.shadowSm }]}
          value={otp}
          onChangeText={setOtp}
          placeholder="• • • • • •"
          placeholderTextColor={theme.colors.muted}
          keyboardType="number-pad"
          maxLength={6}
        />
      </View>
      <PrimaryCTAButton onPress={handleVerify} title={t('auth.verifyOtp', { defaultValue: 'Vérifier' })} loading={loading} />
      <TouchableOpacity
        onPress={countdown > 0 ? undefined : handleResend}
        style={[accountFlowStyles.resendButton, { marginTop: theme.spacing.xl }]}
        disabled={countdown > 0 || resending}
      >
        <Text style={[{ color: countdown > 0 ? theme.colors.muted : theme.colors.primary, ...theme.typography.bodySm }]}>
          {countdown > 0
            ? t('auth.resendIn', { seconds: countdown })
            : t('auth.resendOtp')}
        </Text>
      </TouchableOpacity>
    </AccountFlowPage>
  );
}
