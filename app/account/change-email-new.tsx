import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { AccountFlowPage, accountFlowStyles } from '@/src/components/AccountFlowPage';
import { requestEmailChange } from '@/src/services/profile';
import { useAuthStore } from '@/src/stores/authStore';
import { getErrorMessage } from '@/src/lib/api';

/**
 * Step 2 of the change-email flow. Shows the user's CURRENT email read-only
 * for context, asks for the new email, and submits to PUT /api/users/email
 * which sends a 6-digit code to the new address. On success we forward
 * BOTH the new email and the original password to step 3 (verify-code) so
 * the user can re-request a code if needed without re-entering everything.
 */
export default function ChangeEmailNewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { currentPwd } = useLocalSearchParams<{ currentPwd?: string }>();
  const user = useAuthStore((s) => s.user);
  const [newEmail, setNewEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSend = async () => {
    if (!newEmail.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    if (!currentPwd) {
      setErrorMsg(t('account.confirmPasswordExpired', { defaultValue: 'Veuillez confirmer à nouveau votre mot de passe actuel.' }));
      setTimeout(() => router.replace('/account/change-email-confirm' as never), 600);
      return;
    }
    setLoading(true);
    try {
      await requestEmailChange(String(currentPwd), newEmail.trim());
      router.push({
        pathname: '/account/change-email-verify',
        params: { newEmail: newEmail.trim(), currentPwd: String(currentPwd) },
      } as never);
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const currentEmail = (user as any)?.email ?? '';

  return (
    <AccountFlowPage
      icon={<Mail size={32} color={theme.colors.primary} />}
      title={t('account.newEmailTitle', { defaultValue: 'Nouvelle adresse email' })}
      subtitle={t('account.newEmailDesc', { defaultValue: 'Entrez votre nouvelle adresse email. Un code de vérification vous sera envoyé.' })}
      onBack={() => router.back()}
      errorMsg={errorMsg}
      onClearError={() => setErrorMsg(null)}
    >
      {currentEmail ? (
        <View style={[accountFlowStyles.inputContainer, { marginBottom: theme.spacing.lg }]}>
          <Text style={[accountFlowStyles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
            {t('account.currentEmail', { defaultValue: 'Email actuel' })}
          </Text>
          <View style={[accountFlowStyles.input, { backgroundColor: theme.colors.bg, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, justifyContent: 'center' }]}>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }} numberOfLines={1}>
              {currentEmail}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={[accountFlowStyles.inputContainer, { marginBottom: theme.spacing.xxl }]}>
        <Text style={[accountFlowStyles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
          {t('account.newEmail', { defaultValue: 'Nouvel email' })}<Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <TextInput
          style={[accountFlowStyles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
          value={newEmail}
          onChangeText={setNewEmail}
          placeholder={t('auth.placeholderEmail')}
          placeholderTextColor={theme.colors.muted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <PrimaryCTAButton onPress={handleSend} title={t('account.sendCode', { defaultValue: 'Envoyer le code' })} loading={loading} />
    </AccountFlowPage>
  );
}
