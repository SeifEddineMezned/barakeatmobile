import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { PasswordInput } from '@/src/components/PasswordInput';
import { AccountFlowPage, accountFlowStyles } from '@/src/components/AccountFlowPage';
import { verifyCurrentPassword } from '@/src/services/profile';
import { getErrorMessage } from '@/src/lib/api';

/**
 * Step 1 of the change-email flow. Same pattern as change-password-confirm —
 * verify the current password via POST /api/users/verify-password before
 * letting the user enter a new email + receive a verification code. The
 * verified password is forwarded to step 2 because the backend's PUT
 * /api/users/email endpoint requires it on the actual change request too.
 */
export default function ChangeEmailConfirmScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleVerify = async () => {
    if (!password.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    setLoading(true);
    try {
      await verifyCurrentPassword(password);
      router.push({ pathname: '/account/change-email-new', params: { currentPwd: password } } as never);
    } catch (err: any) {
      const code = err?.data?.error ?? err?.response?.data?.error;
      if (code === 'invalid_password' || err?.status === 401 || err?.response?.status === 401) {
        setErrorMsg(t('errors.invalidPassword', { defaultValue: 'Mot de passe invalide.' }));
      } else {
        setErrorMsg(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccountFlowPage
      icon={<KeyRound size={32} color={theme.colors.primary} />}
      title={t('account.confirmPasswordTitle', { defaultValue: 'Confirmer votre mot de passe' })}
      subtitle={t('account.confirmPasswordEmailDesc', { defaultValue: 'Entrez votre mot de passe actuel pour changer votre email.' })}
      onBack={() => router.back()}
      errorMsg={errorMsg}
      onClearError={() => setErrorMsg(null)}
    >
      <View style={[accountFlowStyles.inputContainer, { marginBottom: theme.spacing.xxl }]}>
        <Text style={[accountFlowStyles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
          {t('account.currentPassword', { defaultValue: 'Mot de passe actuel' })}
          <Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <PasswordInput
          containerStyle={{ backgroundColor: theme.colors.surface }}
          style={[accountFlowStyles.input, { color: theme.colors.textPrimary, borderWidth: 0, ...theme.typography.body }]}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={theme.colors.muted}
        />
      </View>
      <PrimaryCTAButton onPress={handleVerify} title={t('common.continue', { defaultValue: 'Continuer' })} loading={loading} />
    </AccountFlowPage>
  );
}
