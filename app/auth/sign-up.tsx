import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Animated, Modal, Image, ActivityIndicator } from 'react-native';
import { PasswordInput } from '@/src/components/PasswordInput';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store, User, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { register, restaurantAccessRequest } from '@/src/services/auth';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';
import type { UserRole, User as UserType } from '@/src/types';
import { StatusBar } from 'expo-status-bar';

type Step = 'role' | 'customer' | 'gender' | 'business' | 'businessSuccess';

export default function SignUpScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);

  const [step, setStep] = useState<Step>('role');

  // Customer form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Business access request state
  const [contactName, setContactName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizPhone, setBizPhone] = useState('');

  // Step 1 → validate the form, then move to the gender step (registration
  // happens there, with the chosen gender or skipped).
  const handleCustomerContinue = () => {
    if (FeatureFlags.IS_PROTOTYPE) {
      setErrorMsg(t('auth.prototypeMode', { defaultValue: 'L\'application est en mode prototype. L\'inscription n\'est pas disponible.' }));
      return;
    }
    if (!tosAccepted) {
      setErrorMsg(t('auth.tosRequired'));
      return;
    }
    if (!name.trim() || !email.trim() || !password.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
      setErrorMsg(t('auth.passwordRequirements'));
      return;
    }
    setGender(null);
    setStep('gender');
  };

  // Step 2 → register. `selectedGender` is the chosen value, or null when the
  // user skips. We accept it as a param so a tap that both selects and submits
  // doesn't race the gender state update.
  const handleCustomerSignUp = async (selectedGender: 'male' | 'female' | null) => {
    if (FeatureFlags.IS_PROTOTYPE) {
      setErrorMsg(t('auth.prototypeMode', { defaultValue: 'L\'application est en mode prototype. L\'inscription n\'est pas disponible.' }));
      return;
    }
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim(),
        password,
        gender: selectedGender,
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
        gender: (res.user as any).gender ?? selectedGender ?? undefined,
        role: resolvedRole,
      };
      signIn(user, res.token);
      router.replace('/(tabs)');
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleBusinessRequest = async () => {
    if (FeatureFlags.IS_PROTOTYPE) {
      setErrorMsg(t('auth.prototypeMode', { defaultValue: 'L\'application est en mode prototype. L\'inscription n\'est pas disponible.' }));
      return;
    }
    if (!contactName.trim() || !restaurantName.trim() || !bizEmail.trim() || !bizPhone.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      await restaurantAccessRequest({
        name: contactName.trim(),
        restaurantName: restaurantName.trim(),
        email: bizEmail.trim(),
        phone: bizPhone.trim(),
      });
      setStep('businessSuccess');
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const renderErrorModal = () => (
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
  );

  // ── Step 1: Role Picker ───────────────────────────────────────────────────
  if (step === 'role') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#fffff8' }]}>
        <StatusBar style="dark" />
        <View style={[styles.roleScreen, { padding: theme.spacing.xxl }]}>
          <Text style={{ color: '#114b3c80', fontSize: 18, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
            {t('auth.welcomeTo', { defaultValue: 'Bienvenue chez' })}
          </Text>
          <Text style={{ color: '#114b3c', fontSize: 36, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 6 }}>
            Barakeat
          </Text>
          <Text style={{ color: '#114b3c80', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', marginBottom: theme.spacing.xxl * 1.5 }}>
            {t('auth.chooseAccountType')}
          </Text>

          {/* Customer card — white bg, dark icon circle */}
          <TouchableOpacity
            onPress={() => setStep('customer')}
            activeOpacity={0.85}
            style={[styles.roleCard, { backgroundColor: '#fff', borderRadius: theme.radii.r16, marginBottom: theme.spacing.md, borderWidth: 1.5, borderColor: '#114b3c20', shadowColor: '#114b3c', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }]}
            accessibilityLabel={t('auth.customerRole')}
            accessibilityRole="button"
          >
            <View style={[styles.roleCardIcon, { backgroundColor: '#114b3c', borderRadius: 40 }]}>
              <User size={28} color="#e3ff5c" />
            </View>
            <View style={styles.roleCardText}>
              <Text style={[{ color: '#114b3c', ...theme.typography.h3, fontWeight: '700' as const }]}>
                {t('auth.customerRole')}
              </Text>
              <Text style={[{ color: '#114b3c80', ...theme.typography.bodySm, marginTop: 4 }]}>
                {t('auth.customerRoleDesc')}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Business card — same white style, dark icon circle */}
          <TouchableOpacity
            onPress={() => setStep('business')}
            activeOpacity={0.85}
            style={[styles.roleCard, { backgroundColor: '#fff', borderRadius: theme.radii.r16, borderWidth: 1.5, borderColor: '#114b3c20', shadowColor: '#114b3c', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }]}
            accessibilityLabel={t('business.auth.switchToBusiness')}
            accessibilityRole="button"
          >
            <View style={[styles.roleCardIcon, { backgroundColor: '#114b3c', borderRadius: 40 }]}>
              <Store size={28} color="#e3ff5c" />
            </View>
            <View style={styles.roleCardText}>
              <Text style={[{ color: '#114b3c', ...theme.typography.h3, fontWeight: '700' as const }]}>
                {t('business.auth.switchToBusiness')}
              </Text>
              <Text style={[{ color: '#114b3c80', ...theme.typography.bodySm, marginTop: 4 }]}>
                {t('auth.businessRoleDesc')}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
            <Text style={{ color: '#114b3c80', ...theme.typography.body }}>
              {t('auth.haveAccount')}{' '}
            </Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={{ color: '#114b3c', ...theme.typography.body, fontWeight: '600' as const, textDecorationLine: 'underline' }}>
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
      <SafeAreaView style={[styles.container, { backgroundColor: '#fffff8' }]}>
        <StatusBar style="dark" />
        {renderErrorModal()}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={[styles.content, { padding: theme.spacing.xxl }]}>
              {/* Back button */}
              <TouchableOpacity onPress={() => setStep('role')} style={[styles.backBtn, { marginBottom: theme.spacing.xl }]} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
                <ArrowLeft size={22} color="#114b3c" />
              </TouchableOpacity>

              <Text style={[styles.title, { color: '#114b3c', ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                {t('auth.createAccount')}
              </Text>
              <Text style={[styles.subtitle, { color: '#114b3c80', ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
                {t('auth.customerRoleDesc')}
              </Text>

              <View style={styles.form}>
                {/* Name */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('auth.name')}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14, color: '#114b3c', ...theme.typography.body }]}
                    value={name} onChangeText={setName}
                    placeholder="John Doe" placeholderTextColor="#114b3c40"
                    accessibilityLabel={t('auth.name')}
                  />
                </View>

                {/* Email */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('auth.email')}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14, color: '#114b3c', ...theme.typography.body }]}
                    value={email} onChangeText={setEmail}
                    placeholder="you@example.com" placeholderTextColor="#114b3c40"
                    keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                    accessibilityLabel={t('auth.email')}
                  />
                </View>

                {/* Password */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('auth.password')}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <PasswordInput
                    containerStyle={{ backgroundColor: '#fff', borderColor: '#114b3c' }}
                    style={[styles.input, { color: '#114b3c', borderWidth: 0, ...theme.typography.body }]}
                    value={password} onChangeText={setPassword}
                    placeholder="••••••••" placeholderTextColor="#114b3c40"
                    accessibilityLabel={t('auth.password')}
                  />
                </View>

                {/* ToS */}
                <View style={[styles.tosRow, { marginTop: theme.spacing.sm }]}>
                  <TouchableOpacity
                    onPress={() => setTosAccepted(!tosAccepted)}
                    activeOpacity={0.7}
                    style={[styles.tosCheckbox, { borderColor: tosAccepted ? '#114b3c' : '#114b3c40', backgroundColor: tosAccepted ? '#114b3c' : 'transparent' }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: tosAccepted }}
                    accessibilityLabel={t('auth.agreeToThe', { defaultValue: 'I agree to the Terms of Service and Privacy Policy' })}
                  >
                    {tosAccepted && <Text style={{ color: '#114b3c', fontSize: 13, fontWeight: '700' as const, lineHeight: 18 }}>✓</Text>}
                  </TouchableOpacity>
                  <Text style={{ color: '#114b3c', ...theme.typography.bodySm, flex: 1, flexWrap: 'wrap' }}>
                    {t('auth.agreeToThe', { defaultValue: 'I agree to the ' })}
                    {/* Tappable links — route to the same /legal screen the
                        settings "Mentions légales" rows use, so both surfaces
                        render from the same i18n source. */}
                    <Text
                      onPress={() => router.push({ pathname: '/legal', params: { type: 'terms' } } as never)}
                      accessibilityRole="link"
                      style={{ color: '#114b3c', fontWeight: '600' as const, textDecorationLine: 'underline' as const }}
                    >
                      {t('auth.termsOfService', { defaultValue: 'Terms of Service' })}
                    </Text>
                    {' ' + t('common.and', { defaultValue: 'and' }) + ' '}
                    <Text
                      onPress={() => router.push({ pathname: '/legal', params: { type: 'privacy' } } as never)}
                      accessibilityRole="link"
                      style={{ color: '#114b3c', fontWeight: '600' as const, textDecorationLine: 'underline' as const }}
                    >
                      {t('auth.privacyPolicy', { defaultValue: 'Privacy Policy' })}
                    </Text>
                  </Text>
                </View>

                <View style={[styles.buttonContainer, { marginTop: theme.spacing.xl }]}>
                  <TouchableOpacity
                    onPress={handleCustomerContinue}
                    disabled={!tosAccepted}
                    style={{ height: 56, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: '#114b3c', borderRadius: 14, opacity: !tosAccepted ? 0.5 : 1 }}
                    activeOpacity={0.8}
                    accessibilityLabel={t('common.continue', { defaultValue: 'Continue' })}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: '#e3ff5c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
                      {t('common.continue', { defaultValue: 'Continue' })}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
                  <Text style={[{ color: '#114b3c80', ...theme.typography.body }]}>{t('auth.haveAccount')}{' '}</Text>
                  <TouchableOpacity onPress={() => router.back()}>
                    <Text style={[{ color: '#114b3c', ...theme.typography.body, fontWeight: '600' as const, textDecorationLine: 'underline' as const }]}>{t('auth.signIn')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Step 1b: Gender (customer only, skippable) ───────────────────────────
  if (step === 'gender') {
    const genderCard = (value: 'male' | 'female', img: any, label: string) => {
      const selected = gender === value;
      return (
        <TouchableOpacity
          // The image card IS the button: tapping it picks the gender and
          // registers right away (skip is the no-gender path below).
          onPress={() => { setGender(value); void handleCustomerSignUp(value); }}
          activeOpacity={0.85}
          disabled={loading}
          style={{
            flex: 1,
            backgroundColor: selected ? '#114b3c12' : '#fff',
            borderWidth: 2,
            borderColor: selected ? '#114b3c' : '#114b3c20',
            borderRadius: 20,
            paddingVertical: theme.spacing.lg,
            paddingHorizontal: theme.spacing.md,
            alignItems: 'center',
          }}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={label}
        >
          <Image source={img} style={{ width: '100%', height: 150 }} resizeMode="contain" />
          <Text style={{ color: '#114b3c', ...theme.typography.body, fontWeight: '700' as const, marginTop: theme.spacing.sm }}>
            {label}
          </Text>
        </TouchableOpacity>
      );
    };

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#fffff8' }]}>
        <StatusBar style="dark" />
        {renderErrorModal()}
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.content, { padding: theme.spacing.xxl }]}>
            {/* Back to the form (keeps the entered name/email/password) */}
            <TouchableOpacity onPress={() => setStep('customer')} style={[styles.backBtn, { marginBottom: theme.spacing.xl }]} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
              <ArrowLeft size={22} color="#114b3c" />
            </TouchableOpacity>

            <Text style={[styles.title, { color: '#114b3c', ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
              {t('auth.genderTitle', { defaultValue: 'Vous êtes ?' })}
            </Text>
            <Text style={[styles.subtitle, { color: '#114b3c80', ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
              {t('auth.genderSubtitle', { defaultValue: 'Cela nous aide à personnaliser votre expérience. Vous pouvez passer cette étape.' })}
            </Text>

            {/* Two image buttons, side by side */}
            <View style={{ flexDirection: 'row', gap: theme.spacing.lg, marginBottom: theme.spacing.xl }}>
              {genderCard('male', require('@/assets/images/man_holding_basket-removebg-preview.png'), t('auth.genderMale', { defaultValue: 'Homme' }))}
              {genderCard('female', require('@/assets/images/woman_holding_basket-removebg-preview.png'), t('auth.genderFemale', { defaultValue: 'Femme' }))}
            </View>

            {loading ? (
              <View style={{ height: 48, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator color="#114b3c" />
              </View>
            ) : (
              /* Skip — register without a gender */
              <TouchableOpacity
                onPress={() => handleCustomerSignUp(null)}
                style={{ height: 48, justifyContent: 'center', alignItems: 'center' }}
                accessibilityLabel={t('common.skip', { defaultValue: 'Skip' })}
                accessibilityRole="button"
              >
                <Text style={{ color: '#114b3c', ...theme.typography.body, fontWeight: '600' as const, textDecorationLine: 'underline' as const }}>
                  {t('common.skip', { defaultValue: 'Skip' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Step 2b: Business Access Request ─────────────────────────────────────
  if (step === 'business') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#fffff8' }]}>
        <StatusBar style="dark" />
        {renderErrorModal()}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={[styles.content, { padding: theme.spacing.xxl }]}>
              {/* Back button */}
              <TouchableOpacity onPress={() => setStep('role')} style={[styles.backBtn, { marginBottom: theme.spacing.xl }]} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
                <ArrowLeft size={22} color="#114b3c" />
              </TouchableOpacity>

              {/* Icon */}
              <View style={{ alignSelf: 'center', backgroundColor: '#e3ff5c', borderRadius: 40, padding: 18, marginBottom: theme.spacing.xl }}>
                <Store size={28} color="#114b3c" />
              </View>

              <Text style={[styles.title, { color: '#114b3c', ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                {t('business.auth.requestTitle')}
              </Text>
              <Text style={[styles.subtitle, { color: '#114b3c80', ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
                {t('business.auth.requestDesc')}
              </Text>

              <View style={styles.form}>
                {/* Contact name */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('business.auth.contactName')}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14, color: '#114b3c', ...theme.typography.body }]}
                    value={contactName} onChangeText={setContactName}
                    placeholder="Ahmed Ben Ali" placeholderTextColor="#114b3c40"
                    accessibilityLabel={t('business.auth.contactName')}
                  />
                </View>

                {/* Restaurant name */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('business.auth.businessName')}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14, color: '#114b3c', ...theme.typography.body }]}
                    value={restaurantName} onChangeText={setRestaurantName}
                    placeholder="Mon Restaurant" placeholderTextColor="#114b3c40"
                    accessibilityLabel={t('business.auth.businessName')}
                  />
                </View>

                {/* Email */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('auth.email')}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14, color: '#114b3c', ...theme.typography.body }]}
                    value={bizEmail} onChangeText={setBizEmail}
                    placeholder="contact@monrestaurant.tn" placeholderTextColor="#114b3c40"
                    keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                    accessibilityLabel={t('auth.email')}
                  />
                </View>

                {/* Phone */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.xl }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('auth.phone')}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14, color: '#114b3c', ...theme.typography.body }]}
                    value={bizPhone} onChangeText={setBizPhone}
                    placeholder="+216 XX XXX XXX" placeholderTextColor="#114b3c40"
                    keyboardType="phone-pad"
                    accessibilityLabel={t('auth.phone')}
                  />
                </View>

                <TouchableOpacity
                  onPress={handleBusinessRequest}
                  disabled={loading}
                  style={{ height: 56, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: '#114b3c', borderRadius: 14, opacity: loading ? 0.5 : 1 }}
                  activeOpacity={0.8}
                  accessibilityLabel={loading ? t('common.loading') : t('business.auth.submitApplication')}
                  accessibilityRole="button"
                >
                  <Text style={{ color: '#e3ff5c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
                    {loading ? t('common.loading') : t('business.auth.submitApplication')}
                  </Text>
                </TouchableOpacity>

                <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
                  <Text style={[{ color: '#114b3c80', ...theme.typography.body }]}>{t('auth.haveAccount')}{' '}</Text>
                  <TouchableOpacity onPress={() => router.back()}>
                    <Text style={[{ color: '#114b3c', ...theme.typography.body, fontWeight: '600' as const, textDecorationLine: 'underline' as const }]}>{t('auth.signIn')}</Text>
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
    <SafeAreaView style={[styles.container, { backgroundColor: '#fffff8' }]}>
      <StatusBar style="dark" />
      <View style={[styles.successScreen, { padding: theme.spacing.xxl }]}>
        <View style={{ backgroundColor: '#e3ff5c', borderRadius: 50, padding: 20, marginBottom: theme.spacing.xxl }}>
          <CheckCircle2 size={40} color="#114b3c" />
        </View>
        <Text style={[styles.title, { color: '#114b3c', ...theme.typography.h1, marginBottom: theme.spacing.md }]}>
          {t('business.auth.applicationSubmitted')}
        </Text>
        <Text style={[styles.subtitle, { color: '#114b3c80', ...theme.typography.body, marginBottom: theme.spacing.xxl * 1.5 }]}>
          {t('business.auth.applicationSubmittedDesc')}
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/auth/sign-in' as never)}
          style={{ height: 56, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: '#114b3c', borderRadius: 14 }}
          activeOpacity={0.8}
        >
          <Text style={{ color: '#e3ff5c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
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
