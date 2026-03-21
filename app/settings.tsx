import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Globe, Bell as BellIcon, Shield, HelpCircle, Info, LogOut,
  ChevronRight, Lock, FileText, Headphones, X,
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { logout } from '@/src/services/auth';
import { updatePassword } from '@/src/services/profile';
import i18n from '@/src/i18n';

const LANGUAGES = [
  { code: 'fr', label: 'Fran\u00e7ais', flag: '\u{1F1EB}\u{1F1F7}' },
  { code: 'en', label: 'English', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629', flag: '\u{1F1F9}\u{1F1F3}' },
];

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const signOut = useAuthStore((s) => s.signOut);
  const triggerSplash = useSplashStore((s) => s.triggerSplash);

  const [notifications, setNotifications] = useState(true);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [currentLang, setCurrentLang] = useState(i18n.language ?? 'en');
  const [demoRole, setDemoRole] = useState<'admin' | 'restricted'>('admin');
  const [showFaqModal, setShowFaqModal] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const currentLangObj = LANGUAGES.find((l) => l.code === currentLang) ?? LANGUAGES[0];

  const handleLanguageChange = useCallback((langCode: string) => {
    void i18n.changeLanguage(langCode);
    setCurrentLang(langCode);
    setShowLanguageModal(false);
    console.log('[Settings] Language changed to:', langCode);
  }, []);

  const handleDemoRoleSwitch = useCallback(() => {
    const newRole = demoRole === 'admin' ? 'restricted' : 'admin';
    setDemoRole(newRole);
    console.log('[Settings] Demo role switched to:', newRole);
    Alert.alert(
      t('profile.demoMode'),
      newRole === 'admin' ? t('profile.demoAdmin') : t('profile.demoRestricted'),
      [{ text: t('common.ok') }]
    );
  }, [demoRole, t]);

  const handleFAQPress = useCallback(() => {
    setShowFaqModal(true);
  }, []);

  const handleSupportPress = useCallback(() => {
    Alert.alert(
      t('profile.customerSupport'),
      'support@barakeat.tn',
      [{ text: t('common.ok') }]
    );
  }, [t]);

  const handleAboutPress = useCallback(() => {
    Alert.alert(
      t('profile.about'),
      `${t('profile.mission')}\n\n"${t('profile.motto')}"\n\n${t('profile.availability')}`,
      [{ text: t('common.ok') }]
    );
  }, [t]);

  const handleChangePassword = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      Alert.alert(t('auth.error'), t('auth.fillAllFields'));
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert(t('auth.error'), t('auth.passwordMismatch'));
      return;
    }
    if (newPw.length < 6) {
      Alert.alert(t('auth.error'), t('auth.passwordTooShort'));
      return;
    }
    setPwLoading(true);
    try {
      await updatePassword(currentPw, newPw);
      Alert.alert(t('common.success'), t('profile.passwordChanged'));
      setShowPasswordModal(false);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: any) {
      Alert.alert(t('auth.error'), err?.message ?? t('common.errorOccurred'));
    } finally {
      setPwLoading(false);
    }
  };

  const handleSignOut = useCallback(async () => {
    await logout();
    await signOut();
    triggerSplash(false); // false = sign-out, no welcome modal
    router.replace('/auth/sign-in' as never);
  }, [signOut, router, triggerSplash]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, marginLeft: theme.spacing.lg }]}>
          {t('settings.title')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl }} showsVerticalScrollIndicator={false}>
        {/* Language */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('profile.language')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg }]}
            onPress={() => setShowLanguageModal(true)}
          >
            <View style={styles.menuItemLeft}>
              <Globe size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.language')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.bodySm, marginRight: 6 }]}>
                {currentLangObj.flag} {currentLangObj.label}
              </Text>
              <ChevronRight size={18} color={theme.colors.muted} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Notifications */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('settings.notifications')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, padding: theme.spacing.lg, marginBottom: theme.spacing.xl, flexDirection: 'row', alignItems: 'center' }]}>
          <BellIcon size={20} color={theme.colors.textSecondary} />
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1, marginLeft: 12 }]}>{t('settings.pushNotifications')}</Text>
          <Switch value={notifications} onValueChange={setNotifications} trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }} thumbColor={notifications ? theme.colors.primary : theme.colors.muted} />
        </View>

        {/* Account */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('profile.personalInfo')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={() => setShowPasswordModal(true)}
          >
            <View style={styles.menuItemLeft}>
              <Lock size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.changePassword')}
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg }]}
            onPress={handleDemoRoleSwitch}
          >
            <View style={styles.menuItemLeft}>
              <Shield size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.demoMode')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[{
                backgroundColor: demoRole === 'admin' ? theme.colors.primary + '18' : theme.colors.accentWarm + '18',
                borderRadius: theme.radii.pill,
                paddingHorizontal: 10,
                paddingVertical: 4,
                marginRight: 6,
              }]}>
                <Text style={[{
                  color: demoRole === 'admin' ? theme.colors.primary : theme.colors.accentWarm,
                  ...theme.typography.caption,
                  fontWeight: '600' as const,
                }]}>
                  {demoRole === 'admin' ? t('profile.demoAdmin') : t('profile.demoRestricted')}
                </Text>
              </View>
              <ChevronRight size={18} color={theme.colors.muted} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Support & Info */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('settings.support')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={handleFAQPress}
          >
            <View style={styles.menuItemLeft}>
              <HelpCircle size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.faq')}
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={handleSupportPress}
          >
            <View style={styles.menuItemLeft}>
              <Headphones size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.customerSupport')}
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg }]}
            onPress={handleAboutPress}
          >
            <View style={styles.menuItemLeft}>
              <Info size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.about')}
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.muted} />
          </TouchableOpacity>
        </View>

        {/* Legal Mentions */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('profile.legalMentions')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          {[
            { label: t('profile.termsAndConditions'), key: 'terms' },
            { label: t('profile.cookies'), key: 'cookies' },
            { label: t('profile.privacyPolicy'), key: 'privacy' },
          ].map((item, i) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.menuItem, {
                padding: theme.spacing.lg,
                borderTopWidth: i > 0 ? 1 : 0,
                borderTopColor: theme.colors.divider,
              }]}
              onPress={() => setShowLegalModal(item.key)}
            >
              <View style={styles.menuItemLeft}>
                <FileText size={18} color={theme.colors.textSecondary} />
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                  {item.label}
                </Text>
              </View>
              <ChevronRight size={18} color={theme.colors.muted} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          onPress={() => void handleSignOut()}
          style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, padding: theme.spacing.lg, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}
        >
          <LogOut size={20} color={theme.colors.error} />
          <Text style={[{ color: theme.colors.error, ...theme.typography.body, marginLeft: 12 }]}>{t('profile.signOut')}</Text>
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Language Modal */}
      <Modal visible={showLanguageModal} transparent animationType="fade" onRequestClose={() => setShowLanguageModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowLanguageModal(false)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
              {t('profile.selectLanguage')}
            </Text>
            {LANGUAGES.map((lang) => {
              const isSelected = lang.code === currentLang;
              return (
                <TouchableOpacity
                  key={lang.code}
                  onPress={() => handleLanguageChange(lang.code)}
                  style={[{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: theme.spacing.lg,
                    borderRadius: theme.radii.r12,
                    marginBottom: theme.spacing.sm,
                    backgroundColor: isSelected ? theme.colors.primary + '12' : theme.colors.bg,
                    borderWidth: isSelected ? 1.5 : 0,
                    borderColor: theme.colors.primary,
                  }]}
                >
                  <Text style={{ fontSize: 22, marginRight: 12 }}>{lang.flag}</Text>
                  <Text style={[{
                    color: isSelected ? theme.colors.primary : theme.colors.textPrimary,
                    ...theme.typography.body,
                    fontWeight: isSelected ? ('600' as const) : ('400' as const),
                    flex: 1,
                  }]}>
                    {lang.label}
                  </Text>
                  {isSelected && (
                    <View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary }]} />
                  )}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => setShowLanguageModal(false)}
              style={[{ padding: theme.spacing.md, marginTop: theme.spacing.sm }]}
            >
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* FAQ Modal */}
      <Modal visible={showFaqModal} transparent animationType="slide" onRequestClose={() => setShowFaqModal(false)}>
        <View style={styles.bottomModalOverlay}>
          <View style={[styles.bottomModalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.r24, borderTopRightRadius: theme.radii.r24, ...theme.shadows.shadowLg }]}>
            <View style={[styles.bottomModalHeader, { padding: theme.spacing.xl }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('profile.faq')}
              </Text>
              <TouchableOpacity onPress={() => setShowFaqModal(false)}>
                <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' as const }]}>
                  {t('common.close')}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 24 }]}>
                {t('profile.faqContent')}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Legal Modal */}
      <Modal visible={showLegalModal !== null} transparent animationType="slide" onRequestClose={() => setShowLegalModal(null)}>
        <View style={styles.bottomModalOverlay}>
          <View style={[styles.bottomModalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.r24, borderTopRightRadius: theme.radii.r24, ...theme.shadows.shadowLg }]}>
            <View style={[styles.bottomModalHeader, { padding: theme.spacing.xl }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {showLegalModal === 'terms' ? t('profile.termsAndConditions') :
                 showLegalModal === 'cookies' ? t('profile.cookies') :
                 t('profile.privacyPolicy')}
              </Text>
              <TouchableOpacity onPress={() => setShowLegalModal(null)}>
                <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' as const }]}>
                  {t('common.close')}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={{ padding: theme.spacing.xl }}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
                {t('profile.legalContentSoon')}
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={showPasswordModal} transparent animationType="fade" onRequestClose={() => setShowPasswordModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowPasswordModal(false)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
              {t('profile.changePassword')}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('profile.currentPassword')}
            </Text>
            <TextInput
              style={{ height: 48, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 16, color: theme.colors.textPrimary, ...theme.typography.body, marginBottom: theme.spacing.lg }}
              value={currentPw}
              onChangeText={setCurrentPw}
              placeholder={t('profile.currentPassword')}
              placeholderTextColor={theme.colors.muted}
              secureTextEntry
            />
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('profile.newPasswordLabel')}
            </Text>
            <TextInput
              style={{ height: 48, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 16, color: theme.colors.textPrimary, ...theme.typography.body, marginBottom: theme.spacing.lg }}
              value={newPw}
              onChangeText={setNewPw}
              placeholder={t('profile.newPasswordLabel')}
              placeholderTextColor={theme.colors.muted}
              secureTextEntry
            />
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('profile.confirmPasswordLabel')}
            </Text>
            <TextInput
              style={{ height: 48, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 16, color: theme.colors.textPrimary, ...theme.typography.body, marginBottom: theme.spacing.lg }}
              value={confirmPw}
              onChangeText={setConfirmPw}
              placeholder={t('profile.confirmPasswordLabel')}
              placeholderTextColor={theme.colors.muted}
              secureTextEntry
            />
            <TouchableOpacity
              onPress={handleChangePassword}
              disabled={pwLoading}
              style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.sm, opacity: pwLoading ? 0.5 : 1 }}
            >
              <Text style={{ color: '#fff', ...theme.typography.button, textAlign: 'center' }}>
                {pwLoading ? t('common.loading') : t('common.save')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowPasswordModal(false)}
              style={{ padding: theme.spacing.md, marginTop: theme.spacing.sm }}
            >
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  sectionHeader: { textTransform: 'uppercase' },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
  },
  bottomModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomModalContent: {
    maxHeight: '85%',
    flex: 1,
  },
  bottomModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
