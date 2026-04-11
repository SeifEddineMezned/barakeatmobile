import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Modal } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Mail, KeyRound, Lock, XCircle, CheckCircle2 } from 'lucide-react-native';
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
  const { role } = useLocalSearchParams<{ role?: string }>();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<{ text: string; onDismiss?: () => void } | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendOtp = async () => {
    if (!email.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email.trim(), role === 'business' ? 'restaurant' : role === 'customer' ? 'buyer' : undefined);
      setStep('otp');
      setCountdown(60);
      setSuccessMsg({ text: t('auth.otpSent') });
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      const token = await verifyResetOtp(email.trim(), otp.trim());
      setResetToken(token);
      setStep('newPassword');
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;

  const handleResetPassword = async () => {
    if (!newPassword.trim() || !confirmPassword.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg(t('auth.passwordMismatch'));
      return;
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      setErrorMsg(t('auth.passwordRequirements'));
      return;
    }
    setLoading(true);
    try {
      await resetPassword(resetToken, newPassword);
      setSuccessMsg({ text: t('auth.passwordResetSuccess'), onDismiss: () => router.replace('/auth/sign-in' as never) });
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
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
      {/* Error modal */}
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
      {/* Success modal */}
      <Modal visible={!!successMsg} transparent animationType="fade" onRequestClose={() => { successMsg?.onDismiss?.(); setSuccessMsg(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#114b3c18', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <CheckCircle2 size={28} color="#114b3c" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('common.success', { defaultValue: 'Succès' })}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {successMsg?.text}
            </Text>
            <TouchableOpacity
              onPress={() => { successMsg?.onDismiss?.(); setSuccessMsg(null); }}
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
