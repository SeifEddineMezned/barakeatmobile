import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, I18nManager, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { ChevronRight, Globe, MapPin, Clock, Phone, Store, LogOut, ArrowLeftRight } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useBusinessStore } from '@/src/stores/businessStore';

export default function BusinessProfileScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const { profile } = useBusinessStore();
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const handleSignOut = useCallback(() => {
    signOut();
    router.replace('/auth/sign-in' as never);
  }, [signOut, router]);

  const handleSwitchToCustomer = useCallback(() => {
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
        [{ text: t('common.ok') }]
      );
    }
  }, [i18n, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.profile.title')}
        </Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: theme.spacing.xl }} showsVerticalScrollIndicator={false}>
        <View style={[styles.profileCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, ...theme.shadows.shadowSm }]}>
          <View style={styles.profileTop}>
            {profile?.logo ? (
              <Image source={{ uri: profile.logo }} style={[styles.profileLogo, { borderRadius: theme.radii.r16 }]} />
            ) : (
              <View style={[styles.profileLogo, { borderRadius: theme.radii.r16, backgroundColor: theme.colors.primary + '15' }]}>
                <Store size={32} color={theme.colors.primary} />
              </View>
            )}
            <View style={styles.profileInfo}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {profile?.name ?? user?.name}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                {profile?.category}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
                {user?.email}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.infoCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            {t('business.profile.businessInfo')}
          </Text>

          {[
            { icon: MapPin, label: t('business.profile.address'), value: profile?.address ?? '-' },
            { icon: Phone, label: t('business.profile.phone'), value: profile?.phone ?? '-' },
            { icon: Clock, label: t('business.profile.hours'), value: profile?.hours ?? '-' },
          ].map((item, index) => {
            const IconComp = item.icon;
            return (
              <View
                key={index}
                style={[styles.infoRow, {
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.divider,
                }]}
              >
                <View style={styles.infoRowLeft}>
                  <IconComp size={18} color={theme.colors.textSecondary} />
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                    {item.label}
                  </Text>
                </View>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const, flex: 1, textAlign: 'right' as const }]} numberOfLines={2}>
                  {item.value}
                </Text>
              </View>
            );
          })}

          {profile?.description && (
            <View style={[{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 4 }]}>
                {t('business.profile.description')}
              </Text>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                {profile.description}
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.menuSection, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={() => setShowLanguageModal(true)}
          >
            <View style={styles.menuItemLeft}>
              <Globe size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
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
            style={[styles.menuItem, { padding: theme.spacing.lg }]}
            onPress={handleSwitchToCustomer}
          >
            <View style={styles.menuItemLeft}>
              <ArrowLeftRight size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('business.profile.switchToCustomer')}
              </Text>
            </View>
            <ChevronRight size={20} color={theme.colors.muted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.signOutBtn, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}
          onPress={handleSignOut}
        >
          <LogOut size={20} color={theme.colors.error} />
          <Text style={[{ color: theme.colors.error, ...theme.typography.body, marginLeft: 12 }]}>
            {t('business.profile.signOut')}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={showLanguageModal} transparent animationType="fade" onRequestClose={() => setShowLanguageModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowLanguageModal(false)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowMd }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
              {t('profile.selectLanguage')}
            </Text>
            {[
              { code: 'en', name: 'English' },
              { code: 'fr', name: 'Français' },
              { code: 'ar', name: 'العربية' },
            ].map((lang, index) => (
              <TouchableOpacity
                key={lang.code}
                style={[styles.langOption, {
                  padding: theme.spacing.lg,
                  borderRadius: theme.radii.r12,
                  marginBottom: index < 2 ? theme.spacing.sm : 0,
                  backgroundColor: i18n.language === lang.code ? theme.colors.primary + '15' : theme.colors.bg,
                  borderWidth: i18n.language === lang.code ? 2 : 0,
                  borderColor: theme.colors.primary,
                }]}
                onPress={() => changeLanguage(lang.code)}
              >
                <Text style={[{
                  color: i18n.language === lang.code ? theme.colors.primary : theme.colors.textPrimary,
                  ...theme.typography.body,
                  fontWeight: i18n.language === lang.code ? ('600' as const) : ('400' as const),
                }]}>
                  {lang.name}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[{ marginTop: theme.spacing.lg, padding: theme.spacing.md, borderRadius: theme.radii.r12, backgroundColor: theme.colors.bg }]}
              onPress={() => setShowLanguageModal(false)}
            >
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
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
  profileCard: {},
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileLogo: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  infoCard: {},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 120,
  },
  menuSection: {},
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  langOption: {},
});
