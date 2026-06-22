import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Animated, Modal, Image, ActivityIndicator } from 'react-native';
import { PasswordInput } from '@/src/components/PasswordInput';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store, User, ChevronLeft, CheckCircle2, Check } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { register, restaurantAccessRequest, checkEmailAvailable } from '@/src/services/auth';
import { LOCATION_CATEGORIES } from '@/src/lib/locationCategories';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';
import type { UserRole, User as UserType } from '@/src/types';
import { StatusBar } from 'expo-status-bar';

type Step = 'role' | 'customer' | 'gender' | 'business' | 'businessSuccess';

/**
 * Tunisian flag — real flag asset (assets/images/tunisia_flag.png) instead
 * of the OS emoji (which renders as a glossy/wavy 3D flag on iOS) or a
 * hand-rolled SVG approximation. Uses resizeMode="cover" inside a rounded
 * 24×16 frame so the badge sits cleanly next to the +216 prefix.
 */
function TunisianFlag({ width = 24, height = 16 }: { width?: number; height?: number }) {
  return (
    <Image
      source={require('@/assets/images/tunisia_flag.png')}
      style={{ width, height, borderRadius: 2 }}
      resizeMode="cover"
    />
  );
}

// Pre-app language pills removed — language is set from the phone's system
// locale on first launch (see src/i18n/index.ts) and changed from Settings
// once the user is inside. Stub kept to avoid touching every step layout
// that referenced <LanguagePills/> — renders nothing.
function LanguagePills() {
  return null;
}

export default function SignUpScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);

  const [step, setStep] = useState<Step>('role');

  // Customer form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Repeat-password field — guards against a silent typo in the password field
  // sending the user into an account they can't sign back into.
  const [confirmPassword, setConfirmPassword] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Business access request state
  const [contactName, setContactName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  // Phone is stored as the display string "XX XXX XXX" (no prefix, no country
  // code) so the input rendering stays in sync with what the user typed. We
  // strip the spaces and prepend +216 in the submit handler.
  const [bizPhone, setBizPhone] = useState('');
  const [bizCategory, setBizCategory] = useState<string | null>(null);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  /**
   * Format a Tunisian phone number progressively as the user types — pattern
   * is "XX XXX XXX" (8 digits total, space after the 2nd and 5th digit).
   * Non-digit characters are stripped so paste / autofill from a contact
   * picker that includes "+216 " or punctuation lands in the same canonical
   * form as direct typing.
   */
  const formatTunisianPhone = (raw: string): string => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
    return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  };

  // Slide-up offset for the category bottom sheet. The Modal itself fades in
  // (backdrop appears instantly), while the inner sheet rides this animated
  // translateY from off-screen up to 0 — so we get the "fade-in scrim + sheet
  // slides up" combo instead of the default "everything slides together".
  const categorySheetY = useRef(new Animated.Value(420)).current;
  useEffect(() => {
    if (showCategoryPicker) {
      categorySheetY.setValue(420);
      Animated.spring(categorySheetY, {
        toValue: 0,
        friction: 12,
        tension: 80,
        useNativeDriver: true,
      }).start();
    }
  }, [showCategoryPicker, categorySheetY]);

  // Step 1 → validate the form, verify the email is free for a customer account,
  // THEN move to the gender step (registration happens there). The email check
  // is type-scoped, so an email already used for a RESTAURANT account is fine.
  const handleCustomerContinue = async () => {
    if (FeatureFlags.IS_PROTOTYPE) {
      setErrorMsg(t('auth.prototypeMode', { defaultValue: 'L\'application est en mode prototype. L\'inscription n\'est pas disponible.' }));
      return;
    }
    if (!tosAccepted) {
      setErrorMsg(t('auth.tosRequired'));
      return;
    }
    if (!name.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*]/.test(password)) {
      setErrorMsg(t('auth.passwordRequirements'));
      return;
    }
    // Check AFTER the strength rule so the user sees the actionable "use a
    // stronger password" message first when the password itself is weak —
    // otherwise they'd fix the mismatch only to immediately bounce on the
    // strength check.
    if (password !== confirmPassword) {
      setErrorMsg(t('auth.passwordsDontMatch', { defaultValue: 'Les mots de passe ne correspondent pas.' }));
      return;
    }
    // Email availability — surfaced HERE (not on the gender page) so the gender
    // step only ever shows once email + password are accepted.
    setCheckingEmail(true);
    try {
      const available = await checkEmailAvailable(email.trim(), 'buyer');
      if (!available) {
        setErrorMsg(t('errors.emailExists', { defaultValue: 'Cet email est déjà enregistré.' }));
        return;
      }
    } finally {
      setCheckingEmail(false);
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
      // Pin the current UI language onto the register call so the backend
      // sends the verification OTP email in that locale. Falls back to 'fr'
      // for anything outside the supported set so the email template never
      // sees an unmapped code.
      const rawLang = (i18n.language || 'fr').slice(0, 2).toLowerCase();
      const arAllowed = FeatureFlags.LANGUAGES_AR_ENABLED;
      const locale = (rawLang === 'en' || (rawLang === 'ar' && arAllowed) ? rawLang : 'fr') as 'fr' | 'en' | 'ar';
      const payload = {
        name: name.trim(),
        email: email.trim(),
        password,
        gender: selectedGender,
        type: 'buyer' as const,
        locale,
      };
      const res = await register(payload);
      // Buyer registration always returns { requiresVerification: true, email }
      // — no session token yet. Hand off to the OTP verify screen; signIn
      // happens there after the user enters the code we just emailed them.
      // Use URL-style routing so the email survives the navigation reliably,
      // and fall back to the form value if the response lacks one.
      const verifyEmail = (res?.email || payload.email).trim();
      router.replace(`/auth/verify-email?email=${encodeURIComponent(verifyEmail)}` as never);
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
    if (!contactName.trim() || !restaurantName.trim() || !bizEmail.trim() || !bizPhone.trim() || !bizCategory) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    // Tunisian phone numbers are exactly 8 digits and start with a digit in
    // [2-9]. Strip spaces from the display value, validate, prepend +216 for
    // backend storage so the format matches the rest of the app's phone
    // entries.
    const phoneDigits = bizPhone.replace(/\D/g, '');
    if (!/^[2-9]\d{7}$/.test(phoneDigits)) {
      setErrorMsg(t('errors.invalidTunisianPhone', { defaultValue: 'Numéro de téléphone tunisien invalide (8 chiffres requis).' }));
      return;
    }
    setLoading(true);
    try {
      const res = await restaurantAccessRequest({
        name: contactName.trim(),
        restaurantName: restaurantName.trim(),
        email: bizEmail.trim(),
        phone: `+216${phoneDigits}`,
        category: bizCategory,
      });
      // Backend now returns { requiresVerification: true, email } — hand off
      // to the same OTP verify screen the customer flow uses. After verify,
      // the user lands on the businessSuccess thank-you panel rather than
      // the (tabs) home, since restaurants still need admin approval.
      const verifyEmail = (res?.email || bizEmail.trim()).toString();
      router.push(`/auth/verify-email?email=${encodeURIComponent(verifyEmail)}&kind=restaurant` as never);
    } catch (err: any) {
      // Email already belongs to a verified business account: the backend
      // answers 409. getErrorMessage() can't map that French string to a key,
      // so it would fall through to the generic "an error occurred" — surface a
      // clear, actionable popup instead of that vague message.
      const status = err?.status ?? err?.response?.status;
      const data = err?.data ?? err?.response?.data ?? {};
      const rawMsg = String(data?.error ?? err?.message ?? '');
      if (status === 409 || /compte commerce|déjà associé|business account/i.test(rawMsg)) {
        setErrorMsg(t('errors.businessEmailExists', { defaultValue: 'Cet email est déjà associé à un compte commerce. Connectez-vous avec cet email ou utilisez une autre adresse.' }));
        return;
      }
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
  );

  // ── Step 1: Role Picker ───────────────────────────────────────────────────
  if (step === 'role') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#fffff8' }]}>
        <StatusBar style="dark" />
        <LanguagePills />
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
          <ScrollView contentContainerStyle={[styles.scrollContent, { justifyContent: 'center' }]}>
            <View style={[styles.content, { paddingHorizontal: theme.spacing.xxl, paddingVertical: theme.spacing.lg }]}>
              {/* Back button */}
              <TouchableOpacity onPress={() => setStep('role')} style={[styles.backBtn, { marginBottom: theme.spacing.md }]} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
                <ChevronLeft size={28} color="#114b3c" />
              </TouchableOpacity>

              {/* Customer icon — mirrors the partner sign-up form's icon
                  bubble (brand-yellow circle, brand-green glyph) but uses the
                  User glyph instead of Store so the two flows read as a
                  matching pair at a glance. */}
              <View style={{ alignSelf: 'center', backgroundColor: '#e3ff5c', borderRadius: 40, padding: 18, marginBottom: theme.spacing.lg }}>
                <User size={28} color="#114b3c" />
              </View>

              <Text style={[styles.title, { color: '#114b3c', ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                {t('auth.createAccount')}
              </Text>
              <Text style={[styles.subtitle, { color: '#114b3c80', ...theme.typography.body, marginBottom: theme.spacing.xl }]}>
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
                    placeholder={t('auth.placeholderName')} placeholderTextColor="#114b3c40"
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
                    placeholder={t('auth.placeholderEmail')} placeholderTextColor="#114b3c40"
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

                {/* Confirm password — must match `password` before Continue
                    advances. The border turns red the moment both fields are
                    non-empty and disagree (inline signal); the actual blocking
                    happens in handleCustomerContinue with a modal so the user
                    can't proceed past a typo. */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('auth.confirmPassword', { defaultValue: 'Confirmer le mot de passe' })}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <PasswordInput
                    containerStyle={{
                      backgroundColor: '#fff',
                      borderColor: confirmPassword.length > 0 && password !== confirmPassword
                        ? theme.colors.error
                        : '#114b3c',
                    }}
                    style={[styles.input, { color: '#114b3c', borderWidth: 0, ...theme.typography.body }]}
                    value={confirmPassword} onChangeText={setConfirmPassword}
                    placeholder="••••••••" placeholderTextColor="#114b3c40"
                    accessibilityLabel={t('auth.confirmPassword', { defaultValue: 'Confirmer le mot de passe' })}
                  />
                  {confirmPassword.length > 0 && password !== confirmPassword ? (
                    <Text style={{ color: theme.colors.error, ...theme.typography.caption, marginTop: 6 }}>
                      {t('auth.passwordsDontMatch', { defaultValue: 'Les mots de passe ne correspondent pas.' })}
                    </Text>
                  ) : null}
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
                    {tosAccepted && <Check size={14} color="#fff" strokeWidth={3} />}
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
                    disabled={!tosAccepted || checkingEmail}
                    style={{ height: 56, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, backgroundColor: '#114b3c', borderRadius: 14, opacity: (!tosAccepted || checkingEmail) ? 0.5 : 1 }}
                    activeOpacity={0.8}
                    accessibilityLabel={t('common.continue', { defaultValue: 'Continue' })}
                    accessibilityRole="button"
                  >
                    {checkingEmail ? (
                      <ActivityIndicator color="#e3ff5c" />
                    ) : (
                      <Text style={{ color: '#e3ff5c', ...theme.typography.button, textAlign: 'center', fontWeight: '700' as const }}>
                        {t('common.continue', { defaultValue: 'Continue' })}
                      </Text>
                    )}
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
            {/* Only the back button sits at the top-left (keeps name/email/password). */}
            <TouchableOpacity onPress={() => setStep('customer')} style={styles.backBtn} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
              <ChevronLeft size={28} color="#114b3c" />
            </TouchableOpacity>

            {/* Everything else is vertically centered in the remaining space. */}
            <View style={{ flex: 1, justifyContent: 'center' }}>
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

        {/* Category picker — backdrop FADES in (Modal animationType="fade"),
            sheet itself SLIDES up via the categorySheetY animated transform.
            Decoupling the two avoids the default "everything slides together"
            look which the user found heavy on this screen. */}
        <Modal visible={showCategoryPicker} transparent animationType="fade" onRequestClose={() => setShowCategoryPicker(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => setShowCategoryPicker(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
            <Animated.View style={{ transform: [{ translateY: categorySheetY }] }}>
              <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: '#fffff8', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingVertical: 16, paddingHorizontal: 4 }}>
                <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#114b3c33', marginBottom: 12 }} />
                <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 8 }}>
                  {t('business.auth.categoryPickerTitle', { defaultValue: 'Choisissez une catégorie' })}
                </Text>
                <ScrollView style={{ maxHeight: 360 }}>
                  {LOCATION_CATEGORIES.map((cat) => {
                    const selected = bizCategory === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        onPress={() => { setBizCategory(cat); setShowCategoryPicker(false); }}
                        style={{
                          paddingVertical: 14, paddingHorizontal: 20,
                          backgroundColor: selected ? '#114b3c14' : 'transparent',
                        }}
                      >
                        <Text style={{ color: selected ? '#114b3c' : '#114b3cb0', ...theme.typography.body, fontWeight: selected ? '700' : '400' }}>
                          {t(`categories.${cat}`, { defaultValue: cat })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </Modal>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={[styles.content, { padding: theme.spacing.xxl }]}>
              {/* Back button */}
              <TouchableOpacity onPress={() => setStep('role')} style={[styles.backBtn, { marginBottom: theme.spacing.xl }]} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
                <ChevronLeft size={28} color="#114b3c" />
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
                    placeholder={t('auth.placeholderContactName')} placeholderTextColor="#114b3c40"
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
                    placeholder={t('auth.placeholderBusinessName')} placeholderTextColor="#114b3c40"
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
                    placeholder={t('auth.placeholderBusinessEmail')} placeholderTextColor="#114b3c40"
                    keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                    accessibilityLabel={t('auth.email')}
                  />
                </View>

                {/* Category dropdown — opens a bottom modal of the 8
                    LOCATION_CATEGORIES used everywhere else in the app. */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('business.auth.category', { defaultValue: 'Catégorie' })}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowCategoryPicker(true)}
                    style={[styles.input, { backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14, justifyContent: 'center' }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('business.auth.category', { defaultValue: 'Catégorie' })}
                  >
                    <Text style={{ color: bizCategory ? '#114b3c' : '#114b3c40', ...theme.typography.body }}>
                      {bizCategory
                        ? t(`categories.${bizCategory}`, { defaultValue: bizCategory })
                        : t('business.auth.categoryPlaceholder', { defaultValue: 'Sélectionnez une catégorie' })}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Phone — Tunisian flag + +216 prefix as a fixed badge on
                    the left, then the formatted XX XXX XXX input. The
                    prefix is visual only; we always submit +216 + digits. */}
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.xl }]}>
                  <Text style={[styles.label, { color: '#114b3c', ...theme.typography.bodySm }]}>
                    {t('auth.phone')}<Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8 }}>
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8,
                      paddingHorizontal: 12, height: 56,
                      backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14,
                    }}>
                      <TunisianFlag width={24} height={16} />
                      <Text style={{ color: '#114b3c', ...theme.typography.body, fontWeight: '600' as const }}>+216</Text>
                    </View>
                    <TextInput
                      style={[styles.input, { flex: 1, backgroundColor: '#fff', borderColor: '#114b3c30', borderWidth: 1.5, borderRadius: 14, color: '#114b3c', ...theme.typography.body }]}
                      value={bizPhone}
                      onChangeText={(v) => setBizPhone(formatTunisianPhone(v))}
                      placeholder="XX XXX XXX"
                      placeholderTextColor="#114b3c40"
                      keyboardType="phone-pad"
                      maxLength={10} // 8 digits + 2 spaces
                      accessibilityLabel={t('auth.phone')}
                    />
                  </View>
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
  // Circular back button — same 44×44 chip used on the sign-in email/password
  // step so the back-affordance reads as one consistent shape across both
  // auth flows.
  backBtn: {
    alignSelf: 'flex-start',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#114b3c15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  form: {},
  inputContainer: {},
  label: { marginBottom: 8 },
  input: { height: 52, borderWidth: 1, paddingHorizontal: 16 },
  buttonContainer: {},
  tosRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tosCheckbox: { width: 20, height: 20, borderWidth: 1.5, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
