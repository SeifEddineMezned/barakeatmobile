import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Store, User } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useAuthStore } from '@/src/stores/authStore';
import { register } from '@/src/services/auth';
import { getErrorMessage } from '@/src/lib/api';
import type { UserRole, User as UserType } from '@/src/types';

export default function SignUpScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<UserRole>('customer');

  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');

  const handleSignUp = async () => {
    const displayName = role === 'business' ? (businessName || name) : name;
    if (!displayName.trim() || !email.trim() || !password.trim()) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      const res = await register({
        name: displayName.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
        role,
      });
      const user: UserType = {
        id: res.user.id,
        name: res.user.name,
        firstName: res.user.firstName,
        email: res.user.email,
        phone: res.user.phone,
        role: (res.user.role as UserRole) || role,
      };
      signIn(user, res.token);
      console.log('[SignUp] Success, navigating for role:', user.role);
      if (user.role === 'business') {
        router.replace('/(business)/dashboard' as never);
      } else {
        router.replace('/(tabs)');
      }
    } catch (err) {
      const msg = getErrorMessage(err);
      console.log('[SignUp] Error:', msg);
      Alert.alert(t('auth.error'), msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={[styles.content, { padding: theme.spacing.xxl }]}>
            <Text
              style={[
                styles.title,
                { color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.sm },
              ]}
            >
              {t('auth.welcome')}
            </Text>
            <Text
              style={[
                styles.subtitle,
                { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.xl },
              ]}
            >
              {t('auth.createAccount')}
            </Text>

            <View style={[styles.roleSelector, { marginBottom: theme.spacing.xl }]}>
              <TouchableOpacity
                style={[
                  styles.roleOption,
                  {
                    flex: 1,
                    paddingVertical: theme.spacing.md,
                    borderRadius: theme.radii.r12,
                    backgroundColor: role === 'customer' ? theme.colors.primary : theme.colors.surface,
                    marginRight: theme.spacing.sm,
                    ...(role === 'customer' ? {} : theme.shadows.shadowSm),
                  },
                ]}
                onPress={() => setRole('customer')}
                activeOpacity={0.8}
              >
                <User size={20} color={role === 'customer' ? '#fff' : theme.colors.textSecondary} />
                <Text
                  style={[
                    {
                      color: role === 'customer' ? '#fff' : theme.colors.textPrimary,
                      ...theme.typography.caption,
                      fontWeight: '600' as const,
                      marginTop: 4,
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
                    paddingVertical: theme.spacing.md,
                    borderRadius: theme.radii.r12,
                    backgroundColor: role === 'business' ? theme.colors.primary : theme.colors.surface,
                    marginLeft: theme.spacing.sm,
                    ...(role === 'business' ? {} : theme.shadows.shadowSm),
                  },
                ]}
                onPress={() => setRole('business')}
                activeOpacity={0.8}
              >
                <Store size={20} color={role === 'business' ? '#fff' : theme.colors.textSecondary} />
                <Text
                  style={[
                    {
                      color: role === 'business' ? '#fff' : theme.colors.textPrimary,
                      ...theme.typography.caption,
                      fontWeight: '600' as const,
                      marginTop: 4,
                    },
                  ]}
                >
                  {t('business.auth.switchToBusiness')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.form}>
              {role === 'customer' && (
                <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                  <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                    {t('auth.name')}
                  </Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                    value={name}
                    onChangeText={setName}
                    placeholder="John Doe"
                    placeholderTextColor={theme.colors.muted}
                  />
                </View>
              )}

              {role === 'business' && (
                <>
                  <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                    <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                      {t('business.auth.businessName')}
                    </Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                      value={businessName}
                      onChangeText={setBusinessName}
                      placeholder="Mon Commerce"
                      placeholderTextColor={theme.colors.muted}
                    />
                  </View>
                  <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                    <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                      {t('business.auth.businessAddress')}
                    </Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                      value={businessAddress}
                      onChangeText={setBusinessAddress}
                      placeholder="Avenue Habib Bourguiba, Tunis"
                      placeholderTextColor={theme.colors.muted}
                    />
                  </View>
                </>
              )}

              <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
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

              <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                  {t('auth.phone')}
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+216 XX XXX XXX"
                  placeholderTextColor={theme.colors.muted}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                  {t('auth.password')}
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                />
              </View>

              <View style={[styles.buttonContainer, { marginTop: theme.spacing.xl }]}>
                <PrimaryCTAButton
                  onPress={handleSignUp}
                  title={role === 'business' ? t('business.auth.businessSignUp') : t('auth.createAccount')}
                  loading={loading}
                />
              </View>

              <View style={[styles.footer, { marginTop: theme.spacing.xxl }]}>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body }]}>
                  {t('auth.haveAccount')}{' '}
                </Text>
                <TouchableOpacity onPress={() => router.back()}>
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' as const }]}>
                    {t('auth.signIn')}
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
  buttonContainer: {},
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
