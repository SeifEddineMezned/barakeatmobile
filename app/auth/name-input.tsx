/**
 * Apple first-login name capture.
 *
 * Shown ONLY when Apple withheld the customer's name on first sign-in (the
 * backend creates the row with `name=''` + `nameNeedsInput=true`; the routing
 * guard in _layout.tsx holds the user here until they submit). This is the
 * only chance to fill in a missing Apple name — Apple does not re-send it on
 * subsequent auths, so without this step a placeholder would stick forever.
 *
 * Soft UX: title reads as a friendly welcome, no "required" mark, no error
 * state until something actually fails. The fade on the Continue button is the
 * only "you can't skip this" signal — it lights up once the trimmed name is
 * at least MIN_NAME_LENGTH characters (matches the backend's minimum).
 *
 * Hardware back is captured on Android — the routing guard would push the
 * user right back anyway, but swallowing the gesture avoids a flicker.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, BackHandler, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { updateUserName } from '@/src/services/auth';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { AppTextInput } from '@/src/components/ui/AppTextInput';

const MIN_NAME_LENGTH = 2;

export default function NameInputScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const canSubmit = trimmed.length >= MIN_NAME_LENGTH && !saving;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await updateUserName(trimmed);
      if (user && res.user) {
        setUser({
          ...user,
          name: res.user.name,
          ...({ nameNeedsInput: false } as any),
        });
      }
      router.replace('/auth/onboarding' as never);
    } catch (err: any) {
      console.error('[NameInput] Save failed:', err?.status, err?.message);
      alert.showAlert(
        t('common.error', { defaultValue: 'Erreur' }),
        t('errors.serverUnavailable', { defaultValue: 'Le serveur ne répond pas. Veuillez réessayer.' }),
      );
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fffff8' }}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ paddingHorizontal: theme.spacing.xxl }}>
            <Text
              style={{
                color: '#114b3c',
                ...theme.typography.h1,
                marginBottom: theme.spacing.sm,
                textAlign: 'center',
              }}
            >
              {t('auth.nameInputTitle', { defaultValue: 'Comment vous appelez-vous ?' })}
            </Text>
            <Text
              style={{
                color: '#114b3c80',
                ...theme.typography.body,
                marginBottom: theme.spacing.xxl,
                textAlign: 'center',
              }}
            >
              {t('auth.nameInputSubtitle', {
                defaultValue: 'Cela apparaîtra dans votre profil.',
              })}
            </Text>

            <AppTextInput
              value={name}
              onChangeText={setName}
              placeholder={t('auth.nameInputPlaceholder', { defaultValue: 'Votre nom complet' })}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              maxLength={80}
              containerStyle={{ marginBottom: theme.spacing.xl }}
            />

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.85}
              style={{
                backgroundColor: '#114b3c',
                height: 52,
                borderRadius: 14,
                justifyContent: 'center',
                alignItems: 'center',
                opacity: canSubmit ? 1 : 0.35,
              }}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
              accessibilityLabel={t('common.continue', { defaultValue: 'Continuer' })}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '700' as const }}>
                  {t('common.continue', { defaultValue: 'Continuer' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
