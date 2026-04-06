import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store, User, ArrowLeft, CheckCircle2 } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { register, restaurantAccessRequest } from '@/src/services/auth';
import { getErrorMessage } from '@/src/lib/api';
import type { UserRole, User as UserType } from '@/src/types';
import { StatusBar } from 'expo-status-bar';

type Step = 'role' | 'customer' | 'business' | 'businessSuccess';

export default function SignUpScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);

  const [step, setStep] = useState<Step>('role');

  // Customer form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Business access request state
  const [contactName, setContactName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizPhone, setBizPhone] = useState('');
  const [bizAddress, setBizAddress] = useState('');

  const handleCustomerSignUp = async () => {
    if (!tosAccepted) {
      Alert.alert(t('common.error'), t('auth.tosRequired'));
      return;
    }
    if (!name.trim() || !email.trim() || !phone.trim() || !password.trim()) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
      Alert.alert(t('auth.error'), t('auth.passwordRequirements'));
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
        type: 'buyer' as const,
      };
      const res = await register(payload);
      const rawType = (res.user as any).type ?? 'buyer';
      const resolvedRole: UserRole = rawType === 'restaurant' ? 'business' : 'customer';
      const user: UserType = {
        id: res.user.id,
        name: res.user.name,
        firstName: res.user.firstName,
        email: res.user.email,
        phone: res.user.phone,
        role: resolvedRole,
      };
      signIn(user, res.token);
      router.replace('/(tabs)');
    } catch (err) {
      Alert.alert(t('auth.error'), getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleBusinessRequest = async () => {
    if (!contactName.trim() || !restaurantName.trim() || !bizEmail.trim()) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      await restaurantAccessRequest({
        name: contactName.trim(),
        restaurantName: restaurantName.trim(),
        email: bizEmail.trim(),
        phone: bizPhone.trim() || undefined,
        address: bizAddress.trim() || undefined,
      });
      setStep('businessSuccess');
    } catch (err) {
      Alert.alert(t('auth.error'), getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 1: Role Picker ───────────────────────────────────────────────────
  if (step === 'role') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#114b3c' }]}>
        <StatusBar style="light" />
        <View style={[styles.roleScreen, { padding: theme.spacing.xxl }]}>
          <Text style={[styles.title, { color: '#fff', ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
            {t('auth.welcome')}
          </Text>
          <Text style={[styles.subtitle, { color: 'rgba(255,255,255,0.7)', ...theme.typography.body, marginBottom: theme.spacing.xxl * 1.5 }]}>
            {t('auth.chooseAccountType')}
          </Text>

          {/* Customer card */}
          <TouchableOpacity
            onPress={() => setStep('customer')}
            activeOpacity={0.85}
            style={[styles.roleCard, { backgroundColor: '#e3ff5c', borderRadius: theme.radii.r16, marginBottom: theme.spacing.md }]}
            accessibilityLabel={t('auth.customerRole')}
            accessibilityRole="button"
            accessibilityHint={t('auth.customerRoleDesc')}
          >
            <View style={[styles.roleCardIcon, { backgroundColor: 'rgba(17,75,60,0.12)', borderRadius: 40 }]}>
              <User size={28} color="#114b3c" />
            </View>
            <View style={styles.roleCardText}>
              <Text style={[{ color: '#114b3c', ...theme.typography.h3, fontWeight: '700' as const }]}>
                {t('auth.customerRole')}
              </Text>
              <Text style={[{ color: 'rgba(17,75,60,0.7)', ...theme.typography.bodySm, marginTop: 4 }]}>
                {t('auth.customerRoleDesc')}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Business card */}
          <TouchableOpacity
            onPress={() => setStep('business')}
            activeOpacity={0.85}
            style={[styles.roleCard, { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: theme.radii.r16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }]}
            accessibilityLabel={t('business.auth.switchToBusiness')}
            accessibilityRole="button"
            accessibilityHint={t('auth.businessRoleDesc')}
          >
            <View style={[styles.roleCardIcon, { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 40 }]}>
              <Store size={28} color="#e3ff5c" />
            </View>
            <View style={styles.roleCardText}>
              <Text style={[{ color: '#fff', ...theme.typography.h3, fontWeight: '700' as const }]}>
                {t('business.auth.switchToBusiness')}
              </Text>
              <Text style={[{ color: 'rgba(255,255,255,0.6)', ...theme.typography.bodySm, marginTop: 4 }]}>
                {t('auth.businessRoleDesc')}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
            <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.body }]}>
              {t('auth.haveAccount')}{' '}
            </Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={[{ color: '#e3ff5c', ...theme.typography.body, fontWeight: '600' as const }]}>
                {t('auth.signIn')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Step 2a: Customer Form ────────────────────────────────────────────────
  if (step === 'customer') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#114b3c' }]}>
        <StatusBar style="light" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={[styles.content, { padding: theme.spacing.xxl }]}>
              {/* Back button */}
              <TouchableOpacity onPress={() => setStep('role')} style={[styles.backBtn, { marginBottom: theme.spacing.xl }]} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
                <ArrowLeft size={22} color="#fff" />
              </TouchableOpacity>

              <Text style={[styles.title, { color: '#fff', ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                {t('auth.createAccount')}
              </Text>
              <Text style={[styles.subtitle, { color: 'rgba(255,255,255,0.7)', ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
                {t('auth.customerRoleDesc')}
              </Text>

              <View style={styles.form}>
                {/* Name */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>{t('auth.name')}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={name} onChangeText={setName}
                    placeholder="John Doe" placeholderTextColor="rgba(255,255,255,0.4)"
                    accessibilityLabel={t('auth.name')}
                  />
                </View>

                {/* Email */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>{t('auth.email')}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={email} onChangeText={setEmail}
                    placeholder="you@example.com" placeholderTextColor="rgba(255,255,255,0.4)"
                    keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                    accessibilityLabel={t('auth.email')}
                  />
                </View>

                {/* Phone */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>{t('auth.phone')}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={phone} onChangeText={setPhone}
                    placeholder="+216 XX XXX XXX" placeholderTextColor="rgba(255,255,255,0.4)"
                    keyboardType="phone-pad"
                    accessibilityLabel={t('auth.phone')}
                  />
                </View>

                {/* Password */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>{t('auth.password')}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={password} onChangeText={setPassword}
                    placeholder="••••••••" placeholderTextColor="rgba(255,255,255,0.4)"
                    secureTextEntry
                    accessibilityLabel={t('auth.password')}
                  />
                </View>

                {/* ToS */}
                <View style={[styles.tosRow, { marginTop: theme.spacing.sm }]}>
                  <TouchableOpacity
                    onPress={() => setTosAccepted(!tosAccepted)}
                    activeOpacity={0.7}
                    style={[styles.tosCheckbox, { borderColor: tosAccepted ? '#e3ff5c' : 'rgba(255,255,255,0.5)', backgroundColor: tosAccepted ? '#e3ff5c' : 'transparent' }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: tosAccepted }}
                    accessibilityLabel={t('auth.agreeToThe', { defaultValue: 'I agree to the Terms of Service and Privacy Policy' })}
                  >
                    {tosAccepted && <Text style={{ color: '#114b3c', fontSize: 13, fontWeight: '700' as const, lineHeight: 18 }}>✓</Text>}
                  </TouchableOpacity>
                  <Text style={{ color: 'rgba(255,255,255,0.85)', ...theme.typography.bodySm, flex: 1, flexWrap: 'wrap' }}>
                    {t('auth.agreeToThe', { defaultValue: 'I agree to the ' })}
                    <Text style={{ color: '#e3ff5c', fontWeight: '600' as const }}>{t('auth.termsOfService', { defaultValue: 'Terms of Service' })}</Text>
                    {' ' + t('common.and', { defaultValue: 'and' }) + ' '}
                    <Text style={{ color: '#e3ff5c', fontWeight: '600' as const }}>{t('auth.privacyPolicy', { defaultValue: 'Privacy Policy' })}</Text>
                  </Text>
                </View>

                <View style={[styles.buttonContainer, { marginTop: theme.spacing.xl }]}>
                  <TouchableOpacity
                    onPress={handleCustomerSignUp}
                    disabled={loading || !tosAccepted}
                    style={{ height: 56, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: '#e3ff5c', borderRadius: theme.radii.pill, opacity: loading || !tosAccepted ? 0.5 : 1 }}
                    activeOpacity={0.8}
                    accessibilityLabel={loading ? t('common.loading') : t('auth.createAccount')}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: '#114b3c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
                      {loading ? t('common.loading') : t('auth.createAccount')}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
                  <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.body }]}>{t('auth.haveAccount')}{' '}</Text>
                  <TouchableOpacity onPress={() => router.back()}>
                    <Text style={[{ color: '#e3ff5c', ...theme.typography.body, fontWeight: '600' as const }]}>{t('auth.signIn')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Step 2b: Business Access Request ─────────────────────────────────────
  if (step === 'business') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#114b3c' }]}>
        <StatusBar style="light" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={[styles.content, { padding: theme.spacing.xxl }]}>
              {/* Back button */}
              <TouchableOpacity onPress={() => setStep('role')} style={[styles.backBtn, { marginBottom: theme.spacing.xl }]} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
                <ArrowLeft size={22} color="#fff" />
              </TouchableOpacity>

              {/* Icon */}
              <View style={{ alignSelf: 'center', backgroundColor: '#e3ff5c', borderRadius: 40, padding: 18, marginBottom: theme.spacing.xl }}>
                <Store size={28} color="#114b3c" />
              </View>

              <Text style={[styles.title, { color: '#fff', ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                {t('business.auth.requestTitle')}
              </Text>
              <Text style={[styles.subtitle, { color: 'rgba(255,255,255,0.7)', ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
                {t('business.auth.requestDesc')}
              </Text>

              <View style={styles.form}>
                {/* Contact name */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>{t('business.auth.contactName')}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={contactName} onChangeText={setContactName}
                    placeholder="Ahmed Ben Ali" placeholderTextColor="rgba(255,255,255,0.4)"
                    accessibilityLabel={t('business.auth.contactName')}
                  />
                </View>

                {/* Restaurant name */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>{t('business.auth.businessName')}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={restaurantName} onChangeText={setRestaurantName}
                    placeholder="Mon Restaurant" placeholderTextColor="rgba(255,255,255,0.4)"
                    accessibilityLabel={t('business.auth.businessName')}
                  />
                </View>

                {/* Email */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>{t('auth.email')}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={bizEmail} onChangeText={setBizEmail}
                    placeholder="contact@monrestaurant.tn" placeholderTextColor="rgba(255,255,255,0.4)"
                    keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                    accessibilityLabel={t('auth.email')}
                  />
                </View>

                {/* Phone (optional) */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>
                    {t('auth.phone')}{' '}
                    <Text style={{ color: 'rgba(255,255,255,0.4)' }}>({t('common.optional', { defaultValue: 'optional' })})</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={bizPhone} onChangeText={setBizPhone}
                    placeholder="+216 XX XXX XXX" placeholderTextColor="rgba(255,255,255,0.4)"
                    keyboardType="phone-pad"
                    accessibilityLabel={t('auth.phone')}
                  />
                </View>

                {/* Address (optional) */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.xl }]}>
                  <Text style={[styles.label, { color: '#fff', ...theme.typography.bodySm }]}>
                    {t('business.auth.businessAddress')}{' '}
                    <Text style={{ color: 'rgba(255,255,255,0.4)' }}>({t('common.optional', { defaultValue: 'optional' })})</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)', borderRadius: theme.radii.r12, color: '#fff', ...theme.typography.body }]}
                    value={bizAddress} onChangeText={setBizAddress}
                    placeholder="Avenue Habib Bourguiba, Tunis" placeholderTextColor="rgba(255,255,255,0.4)"
                    accessibilityLabel={t('business.auth.businessAddress')}
                  />
                </View>

                <TouchableOpacity
                  onPress={handleBusinessRequest}
                  disabled={loading}
                  style={{ height: 56, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: '#e3ff5c', borderRadius: theme.radii.pill, opacity: loading ? 0.5 : 1 }}
                  activeOpacity={0.8}
                  accessibilityLabel={loading ? t('common.loading') : t('business.auth.submitApplication')}
                  accessibilityRole="button"
                >
                  <Text style={{ color: '#114b3c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
                    {loading ? t('common.loading') : t('business.auth.submitApplication')}
                  </Text>
                </TouchableOpacity>

                <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
                  <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.body }]}>{t('auth.haveAccount')}{' '}</Text>
                  <TouchableOpacity onPress={() => router.back()}>
                    <Text style={[{ color: '#e3ff5c', ...theme.typography.body, fontWeight: '600' as const }]}>{t('auth.signIn')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Step 3b: Business Success ─────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#114b3c' }]}>
      <StatusBar style="light" />
      <View style={[styles.successScreen, { padding: theme.spacing.xxl }]}>
        <View style={{ backgroundColor: '#e3ff5c', borderRadius: 50, padding: 20, marginBottom: theme.spacing.xxl }}>
          <CheckCircle2 size={40} color="#114b3c" />
        </View>
        <Text style={[styles.title, { color: '#fff', ...theme.typography.h1, marginBottom: theme.spacing.md }]}>
          {t('business.auth.applicationSubmitted')}
        </Text>
        <Text style={[styles.subtitle, { color: 'rgba(255,255,255,0.7)', ...theme.typography.body, marginBottom: theme.spacing.xxl * 1.5 }]}>
          {t('business.auth.applicationSubmittedDesc')}
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/auth/sign-in' as never)}
          style={{ height: 56, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: '#e3ff5c', borderRadius: theme.radii.pill }}
          activeOpacity={0.8}
        >
          <Text style={{ color: '#114b3c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
            {t('auth.signIn')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1 },
  roleScreen: { flex: 1, justifyContent: 'center' },
  successScreen: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  roleCardIcon: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleCardText: { flex: 1 },
  backBtn: { alignSelf: 'flex-start' },
  form: {},
  inputContainer: {},
  label: { marginBottom: 8 },
  input: { height: 52, borderWidth: 1, paddingHorizontal: 16 },
  buttonContainer: {},
  tosRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tosCheckbox: { width: 20, height: 20, borderWidth: 1.5, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
