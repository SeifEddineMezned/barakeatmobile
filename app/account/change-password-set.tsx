import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { PasswordInput } from '@/src/components/PasswordInput';
import { AccountFlowPage, accountFlowStyles } from '@/src/components/AccountFlowPage';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { updatePassword } from '@/src/services/profile';
import { getErrorMessage } from '@/src/lib/api';

/**
 * Step 2 of the change-password flow. The user typed their current password
 * on step 1 (change-password-confirm); we forwarded it via route params and
 * include it in the PUT /api/users/password payload so the backend's own
 * bcrypt-compare check stays intact. Password rules mirror forgot-password
 * (8+ chars, upper, lower, digit, special).
 */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;

export default function ChangePasswordSetScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const customAlert = useCustomAlert();
  const { currentPwd } = useLocalSearchParams<{ currentPwd?: string }>();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // The actual mutation, isolated so the "same password as current" confirm
  // flow below can call it after the user agrees.
  const doSave = async () => {
    setLoading(true);
    try {
      await updatePassword(String(currentPwd), newPassword);
      // Drop the spinner BEFORE the alert so the popup doesn't paint over
      // a still-loading CTA. The alert's OK handler does the actual
      // dismiss back to settings.
      setLoading(false);
      // Success popup — the user needs an explicit "it worked" before
      // we yank them back to settings. Previously the screen just popped
      // and the user was left wondering whether anything happened.
      // dismiss(2) collapses BOTH change-password screens (set + confirm)
      // so the user lands back on the ORIGINAL /settings entry — using
      // router.replace('/settings') would push a second /settings on top
      // and the back stack would walk them through the password flow in
      // reverse.
      customAlert.showAlert(
        t('account.passwordUpdatedTitle', { defaultValue: 'Mot de passe mis à jour' }),
        t('account.passwordUpdatedBody', { defaultValue: 'Votre mot de passe a été modifié avec succès.' }),
        [
          { text: 'OK', onPress: () => router.dismiss(2) },
        ],
      );
    } catch (err) {
      setErrorMsg(getErrorMessage(err));
      setLoading(false);
    }
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
    if (!currentPwd) {
      // Lost the forwarded password (refresh / deep-link). Send the user
      // back to step 1 to re-enter it rather than silently failing.
      setErrorMsg(t('account.confirmPasswordExpired', { defaultValue: 'Veuillez confirmer à nouveau votre mot de passe actuel.' }));
      setTimeout(() => router.replace('/account/change-password-confirm' as never), 600);
      return;
    }
    // Same-password guard: the new password equals the current one. Allow
    // it (the backend will accept it too — bcrypt-rehash is idempotent on
    // a re-set), but make sure the user knows so a typo / autofill-paste
    // doesn't quietly "change" the password to itself.
    if (newPassword === String(currentPwd)) {
      customAlert.showAlert(
        t('account.samePasswordTitle', { defaultValue: 'Mot de passe identique' }),
        t('account.samePasswordBody', { defaultValue: 'Le nouveau mot de passe est identique à votre mot de passe actuel. Voulez-vous continuer ?' }),
        [
          { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
          { text: t('common.continue', { defaultValue: 'Continuer' }), onPress: () => { void doSave(); } },
        ],
      );
      return;
    }
    await doSave();
  };

  return (
    <AccountFlowPage
      icon={<Lock size={32} color={theme.colors.primary} />}
      title={t('account.newPasswordTitle', { defaultValue: 'Nouveau mot de passe' })}
      subtitle={t('account.newPasswordDesc', { defaultValue: 'Choisissez un nouveau mot de passe pour votre compte.' })}
      onBack={() => router.back()}
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
