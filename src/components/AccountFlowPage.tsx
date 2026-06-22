import React, { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2 } from 'lucide-react-native';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';

/**
 * Shared layout for the account-management multi-step flows
 * (change-password, change-email). Mirrors the visual language of
 * app/auth/forgot-password.tsx — centred icon + title + subtitle + form
 * + back chevron + matching error/success modals — so the new pages
 * feel like a continuation of the existing auth flow.
 *
 * Each page renders its own form fields + CTAs as children; this
 * component only owns the chrome (chevron, layout, modals).
 */
interface AccountFlowPageProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: ReactNode;
  errorMsg?: string | null;
  onClearError?: () => void;
  successMsg?: { text: string; onDismiss?: () => void } | null;
  onClearSuccess?: () => void;
}

export function AccountFlowPage({
  icon,
  title,
  subtitle,
  onBack,
  children,
  errorMsg,
  onClearError,
  successMsg,
  onClearSuccess,
}: AccountFlowPageProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={[styles.content, { padding: theme.spacing.xxl }]}>
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
              <ArrowLeft size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignSelf: 'center', marginBottom: theme.spacing.xxl }]}>
                {icon}
              </View>
              <Text style={[styles.title, { color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.xxl }]}>
                  {subtitle}
                </Text>
              ) : null}
              {children}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal visible={!!errorMsg} transparent animationType="fade" onRequestClose={() => onClearError?.()}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <BarakeatErrorIcon size={28} color="#ef4444" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('auth.error', { defaultValue: 'Erreur' })}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {errorMsg}
            </Text>
            <TouchableOpacity
              onPress={() => onClearError?.()}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {t('common.ok', { defaultValue: 'OK' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={!!successMsg} transparent animationType="fade" onRequestClose={() => { successMsg?.onDismiss?.(); onClearSuccess?.(); }}>
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
              onPress={() => { successMsg?.onDismiss?.(); onClearSuccess?.(); }}
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
  container: { flex: 1 },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1 },
  backButton: { alignSelf: 'flex-start' },
  iconContainer: {},
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center' },
});

export const accountFlowStyles = StyleSheet.create({
  inputContainer: {},
  label: { marginBottom: 8 },
  input: {
    height: 52,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  otpInput: {
    textAlign: 'center',
    letterSpacing: 8,
  },
  resendButton: { alignSelf: 'center' },
});
