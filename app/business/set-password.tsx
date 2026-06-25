import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { PasswordInput } from '@/src/components/PasswordInput';
import { AccountFlowPage, accountFlowStyles } from '@/src/components/AccountFlowPage';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { setFirstLoginPassword } from '@/src/services/profile';
import { getErrorMessage } from '@/src/lib/api';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';

/**
 * Business FIRST-LOGIN "set your password" step. Replaces the old cramped popup
 * with the SAME form the settings change-password flow uses (AccountFlowPage +
 * PasswordInput). Unlike the settings flow this needs no current-password step
 * — the member just signed in with the temporary password from their invite
 * email, so we call setFirstLoginPassword() directly. On success we show a
 * success alert and drop them on the dashboard, releasing the onboarding gate
 * so the dashboard's "add your first location" prompt can finally appear.
 * Password rules mirror change-password-set (8+ chars, upper, lower, digit,
 * special).
 */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;

export default function BusinessSetPasswordScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const customAlert = useCustomAlert();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Release the onboarding gate (so the dashboard's add-location prompt can
  // finally paint) and land the user on their dashboard. Shared by the success
  // path and the back/skip affordance so the gate never stays stuck.
  const finishToDashboard = () => {
    useWalkthroughStore.getState().setOnboardingSequenceActive(false);
    router.replace('/(business)/dashboard' as never);
  };

  const handleSave = async () => {
    if (!newPassword.trim() || !confirmPassword.trim()) {
      setErrorMsg(t('auth.fillAllFields'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg(t('auth.passwordMismatch'));
      return;
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      setErrorMsg(t('auth.passwordRequirements'));
      return;
    }
    setErrorMsg(null);
    setLoading(true);
    try {
      await setFirstLoginPassword(newPassword);
      customAlert.showAlert(
        t('business.setPassword.successTitle', { defaultValue: 'Mot de passe enregistré' }),
        t('business.setPassword.successBody', { defaultValue: 'Votre mot de passe a été mis à jour. Bienvenue sur votre tableau de bord !' }),
        [{ text: t('common.ok', { defaultValue: 'OK' }), onPress: finishToDashboard }],
      );
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccountFlowPage
      icon={<Lock size={32} color={theme.colors.primary} />}
      title={t('business.setPassword.title', { defaultValue: 'Définissez votre mot de passe' })}
      subtitle={t('business.setPassword.subtitle', { defaultValue: 'Choisissez un mot de passe personnel pour remplacer celui qui vous a été envoyé.' })}
      onBack={finishToDashboard}
      errorMsg={errorMsg}
      onClearError={() => setErrorMsg(null)}
    >
      <View style={{ backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, padding: 12, marginBottom: theme.spacing.xxl }}>
        <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
          {t('auth.passwordRequirements')}
        </Text>
      </View>
      <View style={[accountFlowStyles.inputContainer, { marginBottom: theme.spacing.xl }]}>
        <Text style={[accountFlowStyles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
          {t('auth.newPassword')}<Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <PasswordInput
          containerStyle={{ backgroundColor: theme.colors.surface }}
          style={[accountFlowStyles.input, { color: theme.colors.textPrimary, borderWidth: 0, ...theme.typography.body }]}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="••••••••"
          placeholderTextColor={theme.colors.muted}
        />
      </View>
      <View style={[accountFlowStyles.inputContainer, { marginBottom: theme.spacing.xxl }]}>
        <Text style={[accountFlowStyles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
          {t('auth.confirmNewPassword')}<Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <PasswordInput
          containerStyle={{ backgroundColor: theme.colors.surface }}
          style={[accountFlowStyles.input, { color: theme.colors.textPrimary, borderWidth: 0, ...theme.typography.body }]}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="••••••••"
          placeholderTextColor={theme.colors.muted}
        />
      </View>
      <PrimaryCTAButton onPress={handleSave} title={t('common.save', { defaultValue: 'Enregistrer' })} loading={loading} />
    </AccountFlowPage>
  );
}
