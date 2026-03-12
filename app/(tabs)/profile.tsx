import React, { useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import {
  ChevronRight, HelpCircle, Info, LogOut, User, Mail, Phone,
  CreditCard, Leaf, DollarSign, ShoppingBag, FileText, Headphones, Globe, Shield
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useOrdersStore } from '@/src/stores/ordersStore';
import i18n from '@/src/i18n';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'ar', label: 'العربية', flag: '🇹🇳' },
];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const orders = useOrdersStore((state) => state.orders);
  const [showFaqModal, setShowFaqModal] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState<string | null>(null);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [currentLang, setCurrentLang] = useState(i18n.language ?? 'en');
  const [demoRole, setDemoRole] = useState<'admin' | 'restricted'>('admin');

  const stats = useMemo(() => {
    const completedOrders = orders.filter((o) => o.status === 'collected');
    const basketsBought = completedOrders.reduce((sum, o) => sum + o.quantity, 0);
    const moneySaved = completedOrders.reduce((sum, o) => sum + (o.basket.originalPrice - o.basket.discountedPrice) * o.quantity, 0);
    const co2Saved = basketsBought * 2.5;
    return { basketsBought, moneySaved, co2Saved };
  }, [orders]);

  const handleSignOut = useCallback(() => {
    signOut();
    router.replace('/auth/sign-in' as never);
  }, [signOut, router]);

  const handleFAQPress = useCallback(() => {
    setShowFaqModal(true);
  }, []);

  const handleAboutPress = useCallback(() => {
    Alert.alert(
      t('profile.about'),
      `${t('profile.mission')}\n\n"${t('profile.motto')}"\n\n${t('profile.availability')}`,
      [{ text: t('common.ok') }]
    );
  }, [t]);

  const handleSupportPress = useCallback(() => {
    Alert.alert(
      t('profile.customerSupport'),
      'support@barakeat.tn',
      [{ text: t('common.ok') }]
    );
  }, [t]);

  const handleLanguageChange = useCallback((langCode: string) => {
    void i18n.changeLanguage(langCode);
    setCurrentLang(langCode);
    setShowLanguageModal(false);
    console.log('[Profile] Language changed to:', langCode);
  }, []);

  const handleDemoRoleSwitch = useCallback(() => {
    const newRole = demoRole === 'admin' ? 'restricted' : 'admin';
    setDemoRole(newRole);
    console.log('[Profile] Demo role switched to:', newRole);
    Alert.alert(
      t('profile.demoMode'),
      newRole === 'admin' ? t('profile.demoAdmin') : t('profile.demoRestricted'),
      [{ text: t('common.ok') }]
    );
  }, [demoRole, t]);

  const currentLangObj = LANGUAGES.find((l) => l.code === currentLang) ?? LANGUAGES[0];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('profile.title')}</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl }]} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.userCard,
            {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
            },
          ]}
        >
          <View style={[styles.userAvatar, { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 28, width: 56, height: 56 }]}>
            <User size={28} color="#fff" />
          </View>
          <View style={styles.userInfo}>
            <Text style={[{ color: '#fff', ...theme.typography.h2 }]}>
              {user?.name ?? 'Utilisateur'}
            </Text>
            <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.bodySm, marginTop: 2 }]}>
              {user?.email ?? ''}
            </Text>
          </View>
        </View>

        <View style={[styles.statsRow, { marginBottom: theme.spacing.lg }]}>
          <View style={[styles.statItem, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <DollarSign size={18} color={theme.colors.primary} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8 }]}>
              {stats.moneySaved.toFixed(0)} TND
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
              {t('profile.moneySaved')}
            </Text>
          </View>
          <View style={[styles.statItem, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.accentFresh + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Leaf size={18} color={theme.colors.accentFresh} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8 }]}>
              {stats.co2Saved.toFixed(1)} kg
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
              {t('profile.co2Saved')}
            </Text>
          </View>
          <View style={[styles.statItem, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.secondary + '30', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <ShoppingBag size={18} color={theme.colors.primaryDark} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8 }]}>
              {stats.basketsBought}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
              {t('profile.basketsBought')}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.infoSection,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            {t('profile.personalInfo')}
          </Text>
          {[
            { icon: User, label: t('profile.name'), value: user?.name ?? '-' },
            { icon: Mail, label: t('profile.email'), value: user?.email ?? '-' },
            { icon: Phone, label: t('profile.phone'), value: user?.phone ?? '-' },
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
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
                  {item.value}
                </Text>
              </View>
            );
          })}
          <View style={[styles.infoRow, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <View style={styles.infoRowLeft}>
              <CreditCard size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('profile.cardInfo')}
              </Text>
            </View>
            <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
              {t('profile.cardInfoSoon')}
            </Text>
          </View>
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
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={() => setShowLanguageModal(true)}
          >
            <View style={styles.menuItemLeft}>
              <Globe size={20} color={theme.colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: theme.colors.textPrimary, ...theme.typography.body }]}>
                {t('profile.language')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.bodySm, marginRight: 6 }]}>
                {currentLangObj.flag} {currentLangObj.label}
              </Text>
              <ChevronRight size={20} color={theme.colors.muted} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={handleDemoRoleSwitch}
          >
            <View style={styles.menuItemLeft}>
              <Shield size={20} color={theme.colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: theme.colors.textPrimary, ...theme.typography.body }]}>
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
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={handleSupportPress}
          >
            <View style={styles.menuItemLeft}>
              <Headphones size={20} color={theme.colors.textSecondary} />
              <Text style={[styles.menuItemText, { color: theme.colors.textPrimary, ...theme.typography.body }]}>
                {t('profile.customerSupport')}
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
            styles.legalSection,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            {t('profile.legalMentions')}
          </Text>
          {[
            { label: t('profile.termsAndConditions'), key: 'terms' },
            { label: t('profile.cookies'), key: 'cookies' },
            { label: t('profile.privacyPolicy'), key: 'privacy' },
          ].map((item) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.menuItem, {
                padding: theme.spacing.lg,
                borderTopWidth: 1,
                borderTopColor: theme.colors.divider,
              }]}
              onPress={() => setShowLegalModal(item.key)}
            >
              <View style={styles.menuItemLeft}>
                <FileText size={18} color={theme.colors.textSecondary} />
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                  {item.label}
                </Text>
              </View>
              <ChevronRight size={18} color={theme.colors.muted} />
            </TouchableOpacity>
          ))}
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

        <View style={{ height: 30 }} />
      </ScrollView>

      <Modal visible={showLanguageModal} transparent animationType="fade" onRequestClose={() => setShowLanguageModal(false)}>
        <TouchableOpacity style={styles.langModalOverlay} activeOpacity={1} onPress={() => setShowLanguageModal(false)}>
          <View
            style={[styles.langModalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
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

      <Modal visible={showFaqModal} transparent animationType="slide" onRequestClose={() => setShowFaqModal(false)}>
        <View style={styles.faqModalOverlay}>
          <View style={[styles.faqModalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.r24, borderTopRightRadius: theme.radii.r24, ...theme.shadows.shadowLg }]}>
            <View style={[styles.faqHeader, { padding: theme.spacing.xl }]}>
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

      <Modal visible={showLegalModal !== null} transparent animationType="slide" onRequestClose={() => setShowLegalModal(null)}>
        <View style={styles.faqModalOverlay}>
          <View style={[styles.faqModalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.r24, borderTopRightRadius: theme.radii.r24, ...theme.shadows.shadowLg }]}>
            <View style={[styles.faqHeader, { padding: theme.spacing.xl }]}>
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
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
    marginLeft: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoSection: {},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
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
    gap: 12,
  },
  menuItemText: {},
  legalSection: {},
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  signOutText: {},
  langModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  langModalContent: {
    width: '100%',
    maxWidth: 360,
  },
  faqModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  faqModalContent: {
    maxHeight: '85%',
    flex: 1,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
