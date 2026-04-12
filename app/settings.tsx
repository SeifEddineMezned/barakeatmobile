import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput, Linking, Animated, PanResponder, KeyboardAvoidingView, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Globe, Bell as BellIcon, Shield, HelpCircle, Info, LogOut,
  ChevronRight, Lock, FileText, Headphones, X, Trash2, Camera, MapPin, Image, AlertTriangle, Mail, ExternalLink,
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/src/stores/authStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { logout, deleteAccount as deleteAccountApi } from '@/src/services/auth';
import { updatePassword } from '@/src/services/profile';
import i18n from '@/src/i18n';
import Constants from 'expo-constants';
import { Camera as ExpoCamera } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';

const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

const NOTIF_PREFS_KEY = '@barakeat_notif_prefs';

interface NotifPrefs {
  orderConfirmed: boolean;
  pickupReminder: boolean;
  favoritesUpdates: boolean;
  suggestions: boolean;
  promotions: boolean;
}

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  orderConfirmed: true,
  pickupReminder: true,
  favoritesUpdates: true,
  suggestions: false,
  promotions: false,
};

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const signOut = useAuthStore((s) => s.signOut);
  const triggerSplash = useSplashStore((s) => s.triggerSplash);
  const queryClient = useQueryClient();

  const [notifications, setNotifications] = useState(true);
  const PUSH_ENABLED_KEY = '@barakeat_push_enabled';
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

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);

  // Permission statuses
  const [cameraStatus, setCameraStatus] = useState<string>('Not Set');
  const [locationStatus, setLocationStatus] = useState<string>('Not Set');
  const [photoLibraryStatus, setPhotoLibraryStatus] = useState<string>('Not Set');

  // Load notification preferences from AsyncStorage
  useEffect(() => {
    const loadNotifPrefs = async () => {
      try {
        const stored = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
        if (stored) {
          setNotifPrefs({ ...DEFAULT_NOTIF_PREFS, ...JSON.parse(stored) });
        }
        // Load main push toggle
        const pushEnabled = await AsyncStorage.getItem(PUSH_ENABLED_KEY);
        if (pushEnabled !== null) setNotifications(pushEnabled === 'true');
      } catch (err) {
        console.log('[Settings] Error loading notif prefs:', err);
      }
    };
    loadNotifPrefs();
  }, []);

  // Load permission statuses
  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const cam = await ExpoCamera.getCameraPermissionsAsync();
        setCameraStatus(cam.granted ? 'Granted' : 'Not Set');
      } catch {
        setCameraStatus('Not Set');
      }
      try {
        const loc = await Location.getForegroundPermissionsAsync();
        setLocationStatus(loc.granted ? 'Granted' : 'Not Set');
      } catch {
        setLocationStatus('Not Set');
      }
      try {
        const photo = await ImagePicker.getMediaLibraryPermissionsAsync();
        setPhotoLibraryStatus(photo.granted ? 'Granted' : 'Not Set');
      } catch {
        setPhotoLibraryStatus('Not Set');
      }
    };
    checkPermissions();
  }, []);

  // Save notification preferences
  const updateNotifPref = useCallback(async (key: keyof NotifPrefs, value: boolean) => {
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    try {
      await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(updated));
    } catch (err) {
      console.log('[Settings] Error saving notif prefs:', err);
    }
  }, [notifPrefs]);

  const currentLangObj = LANGUAGES.find((l) => l.code === currentLang) ?? LANGUAGES[0];

  const handleLanguageChange = useCallback((langCode: string) => {
    void i18n.changeLanguage(langCode);
    void AsyncStorage.setItem('app_lang', langCode);
    setCurrentLang(langCode);
    setShowLanguageModal(false);
    console.log('[Settings] Language changed to:', langCode);
  }, []);

  const handleDemoRoleSwitch = useCallback(() => {
    // Navigate to onboarding with demo flag to bypass auth redirect
    router.push(`/onboarding?demo=true&role=${user?.role ?? 'customer'}` as never);
  }, [router]);

  const handleFAQPress = useCallback(() => {
    // Reset sheet state before opening so it always starts at half, clean
    sheetY.setValue(0);
    sheetStateRef.current = 'half';
    setSheetState('half');
    setShowFaqModal(true);
  }, [sheetY]);

  // Bottom sheet: 3 states — closed / half / full
  // Only use translateY for closing (slide down off screen), use height change for expand/collapse
  const sheetY = useRef(new Animated.Value(0)).current;
  const sheetStateRef = useRef<'half' | 'full'>('half');
  const [sheetState, setSheetState] = useState<'half' | 'full'>('half');
  useEffect(() => { sheetStateRef.current = sheetState; }, [sheetState]);

  const sheetPan = useRef(PanResponder.create({
    // Only claim gesture when movement is clearly vertical — lets the ScrollView
    // claim horizontal or ambiguous touches first.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => {
      if (g.dy > 0) sheetY.setValue(g.dy);
    },
    onPanResponderRelease: (_, g) => {
      const state = sheetStateRef.current;
      if (g.dy > 80 || g.vy > 0.5) {
        // Swipe down
        if (state === 'full') {
          // Full → half (snap back, change height via state)
          sheetStateRef.current = 'half';
          setSheetState('half');
          Animated.spring(sheetY, { toValue: 0, friction: 8, useNativeDriver: true }).start();
        } else {
          // Half → close: animate slide-off, then reset state AFTER animation
          Animated.timing(sheetY, { toValue: 600, duration: 200, useNativeDriver: true }).start(() => {
            // Reset sheetY BEFORE clearing modal so next open starts clean
            sheetY.setValue(0);
            sheetStateRef.current = 'half';
            setSheetState('half');
            setShowFaqModal(false);
            setShowLegalModal(null);
          });
        }
      } else if (g.dy < -50) {
        // Swipe up → expand
        sheetStateRef.current = 'full';
        setSheetState('full');
        Animated.spring(sheetY, { toValue: 0, friction: 8, useNativeDriver: true }).start();
      } else {
        // Snap back to resting position
        Animated.spring(sheetY, { toValue: 0, friction: 8, useNativeDriver: true }).start();
      }
    },
  })).current;

  const closeSheet = useCallback(() => {
    Animated.timing(sheetY, { toValue: 600, duration: 200, useNativeDriver: true }).start(() => {
      // Order matters: reset animated value FIRST, then unmount modal
      sheetY.setValue(0);
      sheetStateRef.current = 'half';
      setSheetState('half');
      setShowFaqModal(false);
      setShowLegalModal(null);
    });
  }, [sheetY]);

  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'first' | 'final'>('first');

  const handleSupportPress = useCallback(() => {
    setShowSupportModal(true);
  }, []);

  const handleAboutPress = useCallback(() => {
    setShowAboutModal(true);
  }, []);

  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess(false);
    if (!currentPw || !newPw || !confirmPw) {
      setPwError(t('auth.fillAllFields'));
      return;
    }
    if (newPw !== confirmPw) {
      setPwError(t('auth.passwordMismatch'));
      return;
    }
    if (newPw.length < 8 || !/[A-Z]/.test(newPw) || !/[a-z]/.test(newPw) || !/[0-9]/.test(newPw) || !/[!@#$%^&*]/.test(newPw)) {
      setPwError(t('auth.passwordRequirements'));
      return;
    }
    setPwLoading(true);
    try {
      await updatePassword(currentPw, newPw);
      setPwSuccess(true);
      setTimeout(() => { setShowPasswordModal(false); setCurrentPw(''); setNewPw(''); setConfirmPw(''); setPwSuccess(false); }, 1500);
    } catch (err: any) {
      setPwError(err?.message ?? t('common.errorOccurred'));
    } finally {
      setPwLoading(false);
    }
  };

  const [deleteLoading, setDeleteLoading] = useState(false);

  const deleteAccount = useCallback(() => {
    setDeleteStep('first');
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteStep === 'first') {
      setDeleteStep('final');
      return;
    }
    setDeleteLoading(true);
    try {
      await deleteAccountApi();
      await signOut();
      queryClient.clear();
      triggerSplash(false);
      router.replace('/auth/sign-in' as never);
    } catch (err: any) {
      // keep modal open, show error inline if needed
    } finally {
      setDeleteLoading(false);
      setShowDeleteModal(false);
    }
  }, [deleteStep, signOut, triggerSplash, router]);

  const handleSignOut = useCallback(async () => {
    await logout();
    await signOut();
    queryClient.clear(); // Clear all cached data so next login gets fresh data
    triggerSplash(false); // false = sign-out, no welcome modal
    router.replace('/auth/sign-in' as never);
  }, [signOut, router, triggerSplash, queryClient]);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  const NOTIF_ITEMS: { key: keyof NotifPrefs; labelKey: string; descKey: string }[] = [
    { key: 'orderConfirmed', labelKey: 'settings.orderConfirmed', descKey: 'settings.orderConfirmedDesc' },
    { key: 'pickupReminder', labelKey: 'settings.pickupReminder', descKey: 'settings.pickupReminderDesc' },
    { key: 'favoritesUpdates', labelKey: 'settings.favoritesUpdates', descKey: 'settings.favoritesUpdatesDesc' },
    { key: 'suggestions', labelKey: 'settings.suggestions', descKey: 'settings.suggestionsDesc' },
    { key: 'promotions', labelKey: 'settings.promotions', descKey: 'settings.promotionsDesc' },
  ];

  const PERMISSION_ITEMS = [
    { labelKey: 'settings.camera', status: cameraStatus, icon: Camera },
    { labelKey: 'settings.location', status: locationStatus, icon: MapPin },
    { labelKey: 'settings.photoLibrary', status: photoLibraryStatus, icon: Image },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })} accessibilityRole="button">
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
            accessibilityLabel={t('profile.language')}
            accessibilityRole="button"
          >
            <View style={styles.menuItemLeft}>
              <Globe size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.language')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.bodySm, marginRight: 6 }]}>
                {currentLangObj.label}
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
          <Switch value={notifications} onValueChange={(val) => { setNotifications(val); void AsyncStorage.setItem(PUSH_ENABLED_KEY, String(val)); }} trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }} thumbColor={notifications ? theme.colors.primary : theme.colors.muted} accessibilityLabel={t('settings.pushNotifications')} accessibilityRole="switch" />
        </View>

        {/* Notification Preferences — only shown when push notifications are ON */}
        {notifications && (
          <>
            <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
              {t('settings.notificationPreferences')}
            </Text>
            <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
              {NOTIF_ITEMS.map((item, i) => (
                <View
                  key={item.key}
                  style={[{
                    padding: theme.spacing.lg,
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopColor: theme.colors.divider,
                  }]}
                >
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body }]}>
                      {t(item.labelKey)}
                    </Text>
                    <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 2 }]}>
                      {t(item.descKey)}
                    </Text>
                  </View>
                  <Switch
                    value={notifPrefs[item.key]}
                    onValueChange={(val) => updateNotifPref(item.key, val)}
                    trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }}
                    thumbColor={notifPrefs[item.key] ? theme.colors.primary : theme.colors.muted}
                    accessibilityLabel={t(item.labelKey)}
                    accessibilityRole="switch"
                  />
                </View>
              ))}
            </View>
          </>
        )}

        {/* Permissions */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('settings.permissions')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          {PERMISSION_ITEMS.map((item, i) => {
            const IconComponent = item.icon;
            const isGranted = item.status === 'Granted';
            return (
              <TouchableOpacity
                key={item.labelKey}
                style={[styles.menuItem, {
                  padding: theme.spacing.lg,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: theme.colors.divider,
                }]}
                onPress={handleOpenSettings}
                accessibilityLabel={`${t(item.labelKey)}: ${isGranted ? t('settings.granted') : t('settings.notSet')}`}
                accessibilityRole="button"
              >
                <View style={styles.menuItemLeft}>
                  <IconComponent size={20} color={theme.colors.textSecondary} />
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                    {t(item.labelKey)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[{
                    backgroundColor: isGranted ? theme.colors.primary + '18' : theme.colors.muted + '18',
                    borderRadius: theme.radii.pill,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    marginRight: 6,
                  }]}>
                    <Text style={[{
                      color: isGranted ? theme.colors.primary : theme.colors.muted,
                      ...theme.typography.caption,
                      fontWeight: '600' as const,
                    }]}>
                      {isGranted ? t('settings.granted') : t('settings.notSet')}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={theme.colors.muted} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Account */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('profile.personalInfo')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={() => setShowPasswordModal(true)}
            accessibilityLabel={t('profile.changePassword')}
            accessibilityRole="button"
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
            accessibilityLabel={t('profile.demoMode')}
            accessibilityRole="button"
          >
            <View style={styles.menuItemLeft}>
              <Shield size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.demoMode')}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
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
            accessibilityLabel={t('profile.faq')}
            accessibilityRole="button"
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
            accessibilityLabel={t('profile.customerSupport')}
            accessibilityRole="button"
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
            accessibilityLabel={t('profile.about')}
            accessibilityRole="button"
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
              onPress={() => {
                // Reset sheet state before opening so it always starts clean
                sheetY.setValue(0);
                sheetStateRef.current = 'half';
                setSheetState('half');
                setShowLegalModal(item.key);
              }}
              accessibilityLabel={item.label}
              accessibilityRole="button"
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
          style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, padding: theme.spacing.lg, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.lg }]}
          accessibilityLabel={t('profile.signOut')}
          accessibilityRole="button"
        >
          <LogOut size={20} color={theme.colors.error} />
          <Text style={[{ color: theme.colors.error, ...theme.typography.body, marginLeft: 12 }]}>{t('profile.signOut')}</Text>
        </TouchableOpacity>

        {/* Delete Account */}
        <TouchableOpacity
          onPress={deleteAccount}
          disabled={deleteLoading}
          style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, padding: theme.spacing.lg, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', opacity: deleteLoading ? 0.5 : 1 }]}
          accessibilityLabel={t('profile.deleteAccount')}
          accessibilityRole="button"
        >
          <Trash2 size={20} color="#e53e3e" />
          <Text style={[{ color: '#e53e3e', ...theme.typography.body, marginLeft: 12 }]}>{t('profile.deleteAccount')}</Text>
        </TouchableOpacity>

        {/* App Version */}
        <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textAlign: 'center' as const, marginTop: theme.spacing.xl }]}>
          Barakeat v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>

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
                  accessibilityLabel={lang.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
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

      {/* FAQ Modal — 3-state bottom sheet: half → full → close */}
      <Modal visible={showFaqModal} transparent animationType="fade" onRequestClose={closeSheet}>
        <View style={styles.bottomModalOverlay}>
          <TouchableOpacity style={{ flex: sheetState === 'full' ? 0 : 1, minHeight: sheetState === 'full' ? 0 : 40 }} activeOpacity={1} onPress={closeSheet} />
          <Animated.View
            style={[styles.bottomModalContent, {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.r24,
              borderTopRightRadius: theme.radii.r24,
              ...theme.shadows.shadowLg,
              height: sheetState === 'full' ? '95%' : '50%',
              transform: [{ translateY: sheetY }],
            }]}
          >
            {/* Drag handle — PanResponder lives ONLY here, not on the content area */}
            <View {...sheetPan.panHandlers} style={{ paddingTop: 6, paddingBottom: 4, alignItems: 'center' }}>
              <View style={[styles.bottomModalHandle, { backgroundColor: theme.colors.divider, marginTop: 4, marginBottom: 4 }]} />
            </View>
            <View style={[styles.bottomModalHeader, { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('profile.faq')}
              </Text>
              <TouchableOpacity onPress={closeSheet} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {/* scrollEnabled is always true — content is readable in half AND full state */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
            >
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 24 }]}>
                {t('profile.faqContent')}
              </Text>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Legal Modal — 3-state bottom sheet: half → full → close */}
      <Modal visible={showLegalModal !== null} transparent animationType="fade" onRequestClose={closeSheet}>
        <View style={styles.bottomModalOverlay}>
          <TouchableOpacity style={{ flex: sheetState === 'full' ? 0 : 1, minHeight: sheetState === 'full' ? 0 : 40 }} activeOpacity={1} onPress={closeSheet} />
          <Animated.View
            style={[styles.bottomModalContent, {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.r24,
              borderTopRightRadius: theme.radii.r24,
              ...theme.shadows.shadowLg,
              height: sheetState === 'full' ? '95%' : '50%',
              transform: [{ translateY: sheetY }],
            }]}
          >
            {/* Drag handle — PanResponder lives ONLY here, not on the content area */}
            <View {...sheetPan.panHandlers} style={{ paddingTop: 6, paddingBottom: 4, alignItems: 'center' }}>
              <View style={[styles.bottomModalHandle, { backgroundColor: theme.colors.divider, marginTop: 4, marginBottom: 4 }]} />
            </View>
            <View style={[styles.bottomModalHeader, { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {showLegalModal === 'terms' ? t('profile.termsAndConditions') :
                  showLegalModal === 'cookies' ? t('profile.cookies') :
                    t('profile.privacyPolicy')}
              </Text>
              <TouchableOpacity onPress={closeSheet} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {/* scrollEnabled is always true — content is readable in half AND full state */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
            >
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 24 }]}>
                {showLegalModal === 'terms' ? t('legal.termsContent') :
                  showLegalModal === 'cookies' ? t('legal.cookiesContent') :
                    t('legal.privacyContent')}
              </Text>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Customer Support Modal */}
      <Modal visible={showSupportModal} transparent animationType="fade" onRequestClose={() => setShowSupportModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ backgroundColor: theme.colors.primary + '15', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Headphones size={26} color={theme.colors.primary} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('profile.customerSupport', { defaultValue: 'Support client' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', lineHeight: 22, marginBottom: 20 }}>
              {t('profile.supportDesc', { defaultValue: 'Envoyez-nous un email et nous vous répondrons dans les plus brefs délais.' })}
            </Text>
            <TouchableOpacity
              onPress={() => { Linking.openURL('mailto:contactbarakeat@gmail.com'); setShowSupportModal(false); }}
              style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
            >
              <Mail size={16} color="#e3ff5c" />
              <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 15 }}>contactbarakeat@gmail.com</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSupportModal(false)} style={{ marginTop: 12 }}>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>{t('common.close', { defaultValue: 'Fermer' })}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* About / A Propos Modal */}
      <Modal visible={showAboutModal} transparent animationType="fade" onRequestClose={() => setShowAboutModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ backgroundColor: '#114b3c', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Info size={26} color="#e3ff5c" />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 12 }}>
              {t('profile.about', { defaultValue: 'À propos' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', lineHeight: 22, marginBottom: 8 }}>
              {t('profile.mission')}
            </Text>
            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontStyle: 'italic', textAlign: 'center', marginBottom: 8 }}>
              "{t('profile.motto')}"
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center', marginBottom: 20 }}>
              {t('profile.availability')}
            </Text>
            <TouchableOpacity
              onPress={() => Linking.openURL('https://barakeat.tn')}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 12, width: '100%', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 }}
            >
              <ExternalLink size={16} color="#e3ff5c" />
              <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 14 }}>barakeat.tn</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowAboutModal(false)} style={{ marginTop: 8 }}>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>{t('common.close', { defaultValue: 'Fermer' })}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Delete Account Confirmation Modal */}
      <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={() => setShowDeleteModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ backgroundColor: theme.colors.error + '15', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <AlertTriangle size={26} color={theme.colors.error} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {deleteStep === 'first'
                ? t('profile.deleteAccount', { defaultValue: 'Supprimer le compte' })
                : t('profile.deleteAccountFinalTitle', { defaultValue: 'Confirmation finale' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {deleteStep === 'first'
                ? t('profile.deleteAccountConfirm', { defaultValue: 'Cette action est irréversible. Toutes vos données seront supprimées.' })
                : t('profile.deleteAccountFinalDesc', { defaultValue: 'Êtes-vous absolument sûr ? Cette action ne peut pas être annulée.' })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={() => setShowDeleteModal(false)}
                style={{ flex: 1, backgroundColor: theme.colors.bg, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>{t('common.cancel', { defaultValue: 'Annuler' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDeleteConfirm}
                disabled={deleteLoading}
                style={{ flex: 1, backgroundColor: theme.colors.error, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                  {deleteLoading ? t('common.loading') : deleteStep === 'first' ? t('common.delete', { defaultValue: 'Supprimer' }) : t('profile.deleteAccountConfirmButton', { defaultValue: 'Confirmer la suppression' })}
                </Text>
              </TouchableOpacity>
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
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
              {t('profile.changePassword')}
            </Text>
            {pwError ? <Text style={{ color: theme.colors.error, ...theme.typography.caption, marginBottom: theme.spacing.sm }}>{pwError}</Text> : null}
            {pwSuccess ? <Text style={{ color: '#16a34a', ...theme.typography.bodySm, fontWeight: '600', marginBottom: theme.spacing.sm }}>{t('profile.passwordChanged', { defaultValue: 'Mot de passe changé !' })}</Text> : null}
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
              accessibilityLabel={t('profile.currentPassword')}
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
              accessibilityLabel={t('profile.newPasswordLabel')}
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
              accessibilityLabel={t('profile.confirmPasswordLabel')}
            />
            <TouchableOpacity
              onPress={handleChangePassword}
              disabled={pwLoading}
              style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.sm, opacity: pwLoading ? 0.5 : 1 }}
              accessibilityLabel={pwLoading ? t('common.loading') : t('common.save')}
              accessibilityRole="button"
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
  bottomModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
});
