import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Shield } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { PasswordInput } from '@/src/components/PasswordInput';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { adminLogin } from '@/src/services/admin';
import { getErrorMessage } from '@/src/lib/api';
import type { User as UserType } from '@/src/types';

// Separate sign-in route for Barakeat platform admins. Their JWT is issued
// by /api/admin/login (different from the regular user login) and it carries
// `type: 'admin'` which the backend's adminAuth middleware validates.
export default function AdminSignIn() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setError(t('auth.fillAllFields', { defaultValue: 'Remplissez tous les champs' }));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await adminLogin(email.trim(), password);
      // Build a minimal User so the rest of the app (which keys off role)
      // can treat the admin session uniformly.
      const user: UserType = {
        id: 'admin',
        name: 'Barakeat Admin',
        email: res.admin.email,
        role: 'admin',
      };
      signIn(user, res.token);
      router.replace('/(admin)/users' as never);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeft size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, paddingHorizontal: 24, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', marginBottom: 32 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Shield size={32} color={theme.colors.primary} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 22, fontWeight: '700' }}>
              {t('admin.signInTitle', { defaultValue: 'Admin Barakeat' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
              {t('admin.signInDesc', { defaultValue: "Accès réservé à l'équipe Barakeat" })}
            </Text>
          </View>

          <Text style={styles.label}>{t('auth.email', { defaultValue: 'Email' })}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, color: theme.colors.textPrimary }]}
            value={email}
            onChangeText={setEmail}
            placeholder="contact@barakeat.tn"
            placeholderTextColor={theme.colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { marginTop: 16 }]}>{t('auth.password', { defaultValue: 'Mot de passe' })}</Text>
          <PasswordInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
          />

          {error ? (
            <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 10, textAlign: 'center' }}>
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={handleSignIn}
            disabled={loading}
            style={{
              backgroundColor: theme.colors.primary,
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: 'center',
              marginTop: 24,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator color="#e3ff5c" />
            ) : (
              <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 15 }}>
                {t('auth.signIn', { defaultValue: 'Se connecter' })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  label: { color: '#114b3c', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15 },
});
