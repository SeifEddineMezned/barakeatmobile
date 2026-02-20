import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useAuthStore } from '@/src/stores/authStore';

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

  const handleSignUp = async () => {
    setLoading(true);
    setTimeout(() => {
      signIn({
        id: '1',
        name,
        email,
        phone,
      });
      setLoading(false);
      router.replace('/(tabs)');
    }, 1000);
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
                { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.xxl },
              ]}
            >
              {t('auth.createAccount')}
            </Text>

            <View style={styles.form}>
              <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                  {t('auth.name')}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.divider,
                      borderRadius: theme.radii.r12,
                      color: theme.colors.textPrimary,
                      ...theme.typography.body,
                      ...theme.shadows.shadowSm,
                    },
                  ]}
                  value={name}
                  onChangeText={setName}
                  placeholder="John Doe"
                  placeholderTextColor={theme.colors.muted}
                />
              </View>

              <View style={[styles.inputContainer, { marginBottom: theme.spacing.lg }]}>
                <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                  {t('auth.email')}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.divider,
                      borderRadius: theme.radii.r12,
                      color: theme.colors.textPrimary,
                      ...theme.typography.body,
                      ...theme.shadows.shadowSm,
                    },
                  ]}
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
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.divider,
                      borderRadius: theme.radii.r12,
                      color: theme.colors.textPrimary,
                      ...theme.typography.body,
                      ...theme.shadows.shadowSm,
                    },
                  ]}
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
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.divider,
                      borderRadius: theme.radii.r12,
                      color: theme.colors.textPrimary,
                      ...theme.typography.body,
                      ...theme.shadows.shadowSm,
                    },
                  ]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry
                />
              </View>

              <View style={[styles.buttonContainer, { marginTop: theme.spacing.xxl }]}>
                <PrimaryCTAButton onPress={handleSignUp} title={t('auth.createAccount')} loading={loading} />
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
