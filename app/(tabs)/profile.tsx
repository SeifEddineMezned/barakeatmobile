import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, I18nManager, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { ChevronRight, Globe, HelpCircle, Info, LogOut } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export default function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const handleSignOut = useCallback(() => {
    signOut();
    router.replace('/auth/sign-in' as never);
  }, [signOut, router]);

  const changeLanguage = useCallback(async (lang: string) => {
    const currentLang = i18n.language;
    const wasRTL = currentLang === 'ar';
    const willBeRTL = lang === 'ar';

    await i18n.changeLanguage(lang);
    setShowLanguageModal(false);

    if (wasRTL !== willBeRTL) {
      I18nManager.forceRTL(willBeRTL);
      Alert.alert(
        t('profile.languageChanged'),
        t('profile.restartRequired'),
        [
          {
            text: t('common.ok'),
            onPress: async () => {
              await Updates.reloadAsync();
            },
          },
        ]
      );
    }
  }, [i18n, t]);

  const handleLanguagePress = useCallback(() => {
    setShowLanguageModal(true);
  }, []);

  const handleFAQPress = useCallback(() => {
    Alert.alert(
      t('profile.faq'),
      t('profile.faqContent') || 'FAQ content coming soon!\n\n• How do I reserve a basket?\n• What is a surprise basket?\n• How do pickup windows work?\n• What payment methods are accepted?',
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('profile.title')}</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl }]}>
        <View
          style={[
            styles.section,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.xs }]}>
            {user?.name}
          </Text>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body }]}>{user?.email}</Text>
        </View>

        <View
          style={[
            styles.menuSection,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.menuItem,
              { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
            ]}
            onPress={handleLanguagePress}
          >
            <View style={styles.menuItemLeft}>
              <Globe size={20} color={theme.colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: theme.colors.textPrimary, ...theme.typography.body }]}>
                {t('profile.language')}
              </Text>
            </View>
            <View style={styles.menuItemRight}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                {i18n.language.toUpperCase()}
              </Text>
              <ChevronRight size={20} color={theme.colors.muted} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={handleFAQPress}
          >
            <View style={styles.menuItemLeft}>
              <HelpCircle size={20} color={theme.colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: theme.colors.textPrimary, ...theme.typography.body }]}>
                {t('profile.faq')}
              </Text>
            </View>
            <ChevronRight size={20} color={theme.colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg }]}
            onPress={handleAboutPress}
          >
            <View style={styles.menuItemLeft}>
              <Info size={20} color={theme.colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: theme.colors.textPrimary, ...theme.typography.body }]}>
                {t('profile.about')}
              </Text>
            </View>
            <ChevronRight size={20} color={theme.colors.muted} />
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.aboutSection,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('profile.about')}
          </Text>
          <Text
            style={[
              { color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: theme.spacing.md },
            ]}
          >
            {t('profile.mission')}
          </Text>
          <Text
            style={[
              {
                color: theme.colors.primary,
                ...theme.typography.body,
                fontStyle: 'italic',
                marginBottom: theme.spacing.md,
              },
            ]}
          >
            "{t('profile.motto')}"
          </Text>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
            {t('profile.availability')}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.signOutButton,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
          onPress={handleSignOut}
        >
          <LogOut size={20} color={theme.colors.error} />
          <Text style={[styles.signOutText, { color: theme.colors.error, ...theme.typography.body }]}>
            {t('profile.signOut')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={showLanguageModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLanguageModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowLanguageModal(false)}
        >
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r24,
                padding: theme.spacing.xl,
                ...theme.shadows.shadowMd,
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
              {t('profile.selectLanguage')}
            </Text>

            {[
              { code: 'en', name: 'English', nativeName: 'English' },
              { code: 'fr', name: 'Français', nativeName: 'Français' },
              { code: 'ar', name: 'العربية', nativeName: 'العربية' },
            ].map((lang, index) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.languageOption,
                  {
                    padding: theme.spacing.lg,
                    borderRadius: theme.radii.r12,
                    marginBottom: index < 2 ? theme.spacing.sm : 0,
                    backgroundColor:
                      i18n.language === lang.code ? theme.colors.primary + '15' : theme.colors.bg,
                    borderWidth: i18n.language === lang.code ? 2 : 0,
                    borderColor: theme.colors.primary,
                  },
                ]}
                onPress={() => changeLanguage(lang.code)}
              >
                <Text
                  style={[
                    {
                      color: i18n.language === lang.code ? theme.colors.primary : theme.colors.textPrimary,
                      ...theme.typography.body,
                      fontWeight: i18n.language === lang.code ? '600' : '400',
                    },
                  ]}
                >
                  {lang.nativeName}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[
                styles.modalCloseButton,
                {
                  marginTop: theme.spacing.lg,
                  padding: theme.spacing.md,
                  borderRadius: theme.radii.r12,
                  backgroundColor: theme.colors.bg,
                },
              ]}
              onPress={() => setShowLanguageModal(false)}
            >
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }]}>
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
  container: {
    flex: 1,
  },
  header: {},
  content: {
    flex: 1,
  },
  section: {},
  menuSection: {},
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuItemText: {},
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aboutSection: {},
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  signOutText: {},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
  },
  languageOption: {},
  modalCloseButton: {},
});
