import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Mail, KeyRound, Lock } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { forgotPassword, verifyResetOtp, resetPassword } from '@/src/services/auth';
import { getErrorMessage } from '@/src/lib/api';

type Step = 'email' | 'otp' | 'newPassword';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendOtp = async () => {
    if (!email.trim()) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setStep('otp');
      setCountdown(60);
      Alert.alert(t('common.success'), t('auth.otpSent'));
    } catch (err) {
      Alert.alert(t('auth.error'), getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim()) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      const token = await verifyResetOtp(email.trim(), otp.trim());
      setResetToken(token);
      setStep('newPassword');
    } catch (err) {
      Alert.alert(t('auth.error'), getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;

  const handleResetPassword = async () => {
    if (!newPassword.trim() || !confirmPassword.trim()) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('auth.error'), t('auth.passwordMismatch'));
      return;
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      Alert.alert(t('auth.error'), t('auth.passwordRequirements'));
      return;
    }
    setLoading(true);
    try {
      await resetPassword(resetToken, newPassword);
      Alert.alert(t('common.success'), t('auth.passwordResetSuccess'), [
        { text: t('common.ok'), onPress: () => router.replace('/auth/sign-in' as never) },
      ]);
    } catch (err) {
      Alert.alert(t('auth.error'), getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const renderStepIndicator = () => {
    const steps: Step[] = ['email', 'otp', 'newPassword'];
    const currentIndex = steps.indexOf(step);
    return (
      <View style={[styles.stepIndicator, { marginBottom: theme.spacing.xxl }]}>
        {steps.map((_, i) => (
          <View
            key={i}
            style={[
              styles.stepDot,
              {
                width: i === currentIndex ? 24 : 8,
                height: 8,
                borderRadius: theme.radii.pill,
                backgroundColor: i <= currentIndex ? theme.colors.primary : theme.colors.divider,
                marginHorizontal: theme.spacing.xs,
              },
            ]}
          />
        ))}
      </View>
    );
  };

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
              onPress={() => {
                if (step === 'email') router.back();
                else if (step === 'otp') setStep('email');
                else setStep('otp');
              }}
              style={[styles.backButton, { marginBottom: theme.spacing.xxl }]}
            >
              <ArrowLeft size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>

            {renderStepIndicator()}

            {step === 'email' && (
              <>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignSelf: 'center', marginBottom: theme.spacing.xxl }]}>
                  <Mail size={32} color={theme.colors.primary} />
                </View>
                <Text style={[styles.title, { color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                  {t('auth.forgotPasswordTitle')}
                </Text>
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
                  {t('auth.forgotPasswordDesc')}
                </Text>
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.xxl }]}>
                  <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                    {t('auth.email')}
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={theme.colors.muted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <PrimaryCTAButton onPress={handleSendOtp} title={t('auth.sendOtp')} loading={loading} />
              </>
            )}

            {step === 'otp' && (
              <>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignSelf: 'center', marginBottom: theme.spacing.xxl }]}>
                  <KeyRound size={32} color={theme.colors.primary} />
                </View>
                <Text style={[styles.title, { color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                  {t('auth.enterOtp')}
                </Text>
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
                  {t('auth.otpSentTo', { email })}
                </Text>
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.xxl }]}>
                  <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                    {t('auth.otpCode')}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.otpInput, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.h2, ...theme.shadows.shadowSm }]}
                    value={otp}
                    onChangeText={setOtp}
                    placeholder="• • • • • •"
                    placeholderTextColor={theme.colors.muted}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                </View>
                <PrimaryCTAButton onPress={handleVerifyOtp} title={t('auth.verifyOtp')} loading={loading} />
                <TouchableOpacity
                  onPress={countdown > 0 ? undefined : handleSendOtp}
                  style={[styles.resendButton, { marginTop: theme.spacing.xl }]}
                  disabled={countdown > 0}
                >
                  <Text style={[{ color: countdown > 0 ? theme.colors.muted : theme.colors.primary, ...theme.typography.bodySm }]}>
                    {countdown > 0
                      ? t('auth.resendIn', { seconds: countdown })
                      : t('auth.resendOtp')}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {step === 'newPassword' && (
              <>
                <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignSelf: 'center', marginBottom: theme.spacing.xxl }]}>
                  <Lock size={32} color={theme.colors.primary} />
                </View>
                <Text style={[styles.title, { color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                  {t('auth.newPasswordTitle')}
                </Text>
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.lg }]}>
                  {t('auth.newPasswordDesc')}
                </Text>
                <View style={{ backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, padding: 12, marginBottom: theme.spacing.xxl }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
                    {t('auth.passwordRequirements')}
                  </Text>
                </View>
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.xl }]}>
                  <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                    {t('auth.newPassword')}
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="••••••••"
                    placeholderTextColor={theme.colors.muted}
                    secureTextEntry
                  />
                </View>
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.xxl }]}>
                  <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                    {t('auth.confirmNewPassword')}
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="••••••••"
                    placeholderTextColor={theme.colors.muted}
                    secureTextEntry
                  />
                </View>
                <PrimaryCTAButton onPress={handleResetPassword} title={t('auth.resetPassword')} loading={loading} />
              </>
            )}
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
  },
  content: {
    flex: 1,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDot: {},
  iconContainer: {},
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  inputContainer: {},
  label: {
    marginBottom: 8,
  },
  input: {
    height: 52,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  otpInput: {
    textAlign: 'center',
    letterSpacing: 8,
  },
  resendButton: {
    alignSelf: 'center',
  },
});
