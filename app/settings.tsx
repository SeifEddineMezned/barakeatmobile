import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput, Linking, Animated, PanResponder, KeyboardAvoidingView, Platform, findNodeHandle, UIManager, Image } from 'react-native';
import { DEMO_COVER_URL, DEMO_LOGO_URL, DEMO_BASKET_PHOTOS } from '@/src/lib/demoData';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { ModalCard } from '@/src/components/ui/ModalCard';
import { AppTextInput } from '@/src/components/ui/AppTextInput';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Globe, Bell as BellIcon, Shield, HelpCircle, Info, LogOut,
  ChevronRight, Lock, FileText, Headphones, X, Trash2, Camera, MapPin, Image as ImageIcon, AlertTriangle, Mail, ExternalLink, Hand,
} from 'lucide-react-native';
import { Dimensions, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useOverlayOriginOffset } from '@/src/components/useOverlayOriginOffset';
import { StatusBar } from 'expo-status-bar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/src/stores/authStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { logout, deleteAccount as deleteAccountApi } from '@/src/services/auth';
import { updatePassword, requestEmailChange, verifyEmailChange, fetchUserProfile } from '@/src/services/profile';
import { fetchMyContext } from '@/src/services/teams';
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
  // Customer prefs
  orderConfirmed: boolean;
  pickupReminder: boolean;
  favoritesUpdates: boolean;
  suggestions: boolean;
  promotions: boolean;
  // Business prefs
  newOrders: boolean;
  basketPickedUp: boolean;
  cancellations: boolean;
}

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  orderConfirmed: true,
  pickupReminder: true,
  favoritesUpdates: true,
  suggestions: false,
  promotions: false,
  newOrders: true,
  basketPickedUp: true,
  cancellations: true,
};

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const signOut = useAuthStore((s) => s.signOut);
  const triggerSplash = useSplashStore((s) => s.triggerSplash);
  const queryClient = useQueryClient();

  // Business context for showing organization/location name
  const isBusiness = user?.role === 'business';
  const bizCtx = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, enabled: isBusiness, staleTime: 60_000 });
  const bizName = bizCtx.data?.organization_name || bizCtx.data?.location_name;

  // Fetch fresh user name from DB (users table) — for business users, user.name in
  // the auth store may contain the location name instead of the personal name
  const profileQuery = useQuery({ queryKey: ['user-profile'], queryFn: fetchUserProfile, enabled: isBusiness, staleTime: 60_000 });
  const userName = isBusiness ? ((profileQuery.data as any)?.name || user?.name) : user?.name;

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

  // Change email modal — current-password gated, same UX pattern as password
  // change. We surface the user's current email above the input as read-only
  // context so they know what they're replacing.
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emCurrentPw, setEmCurrentPw] = useState('');
  const [emNewEmail, setEmNewEmail] = useState('');
  const [emLoading, setEmLoading] = useState(false);
  const [emError, setEmError] = useState('');
  const [emSuccess, setEmSuccess] = useState(false);
  // Two-step email change: 'request' (password + new email → send code) then
  // 'verify' (enter the 6-digit code sent to the new address).
  const [emStep, setEmStep] = useState<'request' | 'verify'>('request');
  const [emOtp, setEmOtp] = useState('');
  const [emPendingEmail, setEmPendingEmail] = useState('');

  const resetEmailModal = () => {
    setShowEmailModal(false);
    setEmStep('request');
    setEmCurrentPw('');
    setEmNewEmail('');
    setEmOtp('');
    setEmPendingEmail('');
    setEmError('');
    setEmSuccess(false);
    setEmLoading(false);
  };
  const setUser = useAuthStore((s) => s.setUser);

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);

  // Permission statuses
  const [cameraStatus, setCameraStatus] = useState<string>('Not Set');
  const [locationStatus, setLocationStatus] = useState<string>('Not Set');
  const [photoLibraryStatus, setPhotoLibraryStatus] = useState<string>('Not Set');

  // ── Walkthrough final-stage overlay ──────────────────────────────────────
  // Rendered when the business walkthrough reaches its settings step. We
  // measure the Demo Mode row in window coordinates so the cutout sits
  // exactly on top of it, no matter how the user scrolls.
  const showSettingsOverlay = useWalkthroughStore((s) => s.showSettingsOverlay);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  const demoRowRef = useRef<View>(null);
  const [demoRect, setDemoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Outer ScrollView ref + tracked Y of the demo row so we can scrollTo when
  // the walkthrough lands on this screen. The row lives below the fold, so
  // without scrolling the measureInWindow call returns 0×0 and the overlay
  // would render only the dim mask (no halo) + popup off-screen.
  const settingsScrollRef = useRef<ScrollView | null>(null);
  const measureDemoRow = useCallback(() => {
    // Skip publishes while the walkthrough's settings overlay is active —
    // the post-scroll retry loop in the showSettingsOverlay effect below
    // owns the rect lifecycle. An onLayout-driven publish here fires the
    // moment the demo row mounts, BEFORE the scroll has happened, so the
    // halo renders briefly at the pre-scroll y and the user sees the
    // "wrong halo, then corrected" jitter. The effect's setDemoRect(null)
    // at t=0 races this onLayout and loses on most devices because the
    // onLayout callback often fires after effects on initial mount.
    // Read the LIVE flag from the store rather than the closed-over hook
    // value because this callback has [] deps and the hook value would
    // be stale for the entire component lifetime.
    if (useWalkthroughStore.getState().showSettingsOverlay) return;
    requestAnimationFrame(() => {
      demoRowRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setDemoRect({ x, y, w, h });
      });
    });
  }, []);
  // When the overlay is requested: scroll the demo row into view first, then
  // re-measure (with retries) once the scroll animation has landed. The
  // "Mode démo" row sits below the fold; without scrolling, measureInWindow
  // returns 0×0 and the overlay degenerates to a full dim + an offscreen
  // popup. measureLayout against the ScrollView's node handle gives the
  // row's Y in content-coordinate space, which is what scrollTo wants.
  useEffect(() => {
    if (!showSettingsOverlay) return;
    setDemoRect(null);
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => {
      const scrollNode = settingsScrollRef.current ? findNodeHandle(settingsScrollRef.current as any) : null;
      // `demoRowRef` points at a TouchableOpacity (a JS wrapper) — calling
      // its instance `.measureLayout` directly logs
      //   "Warning: ref.measureLayout must be called with a ref to a native component"
      // because the wrapper isn't a native node. Resolve to the underlying
      // native handle with findNodeHandle and use the static
      // UIManager.measureLayout, which accepts handles and is the supported
      // path for ref-to-wrapper -> measure-relative-to-another-view.
      const rowNode = demoRowRef.current ? findNodeHandle(demoRowRef.current as any) : null;
      if (scrollNode != null && rowNode != null) {
        UIManager.measureLayout(
          rowNode,
          scrollNode,
          () => { /* silent fallback — re-measure below still runs */ },
          (_x: number, y: number) => {
            settingsScrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
          },
        );
      }
      // Retry measureInWindow up to 8× at 100 ms intervals — handles the
      // initial 0×0 race + lets the scroll animation settle before locking
      // the halo position. The initial delay of 600 ms covers the full
      // ~300 ms scrollTo animation plus a buffer; previously at 350 ms the
      // first valid measurement could land mid-scroll, freezing the halo
      // at a transient y for the rest of the step until the user moved.
      const tryMeasure = (attempt: number) => {
        if (attempt > 8) return;
        demoRowRef.current?.measureInWindow((x, y, w, h) => {
          if (w > 0 && h > 0) {
            setDemoRect({ x, y, w, h });
          } else {
            timers.push(setTimeout(() => tryMeasure(attempt + 1), 100));
          }
        });
      };
      timers.push(setTimeout(() => tryMeasure(0), 600));
    }, 100));
    return () => { timers.forEach((id) => clearTimeout(id)); };
  }, [showSettingsOverlay, measureDemoRow]);

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

  // Save notification preferences locally AND sync to backend
  const updateNotifPref = useCallback(async (key: keyof NotifPrefs, value: boolean) => {
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    try {
      await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(updated));
      // Sync to backend (fire-and-forget)
      const { apiClient } = require('@/src/lib/api');
      apiClient.put('/api/auth/notification-preferences', updated).catch(() => {});
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

  const handleDemoRoleSwitch = useCallback(async () => {
    // Customer-side flow now goes through a full-screen "Welcome to the
    // Barakeat demo" cover rendered on top of the (tabs) home screen.
    // The cover gives the home tab time to mount and lay out, lets demo
    // image prefetch settle, and lets the user explicitly tap "Start
    // demo" — the walkthrough only fires when EVERYTHING is ready, so
    // there are no jittery settling frames at start. The business demo
    // (existing behaviour, no welcome cover) still starts immediately.
    const { resetWalkthroughCompletion, startWalkthrough, setShowDemoWelcome, setDemoCustomerActive } = useWalkthroughStore.getState();
    resetWalkthroughCompletion();
    const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
    if (isBiz) {
      try { router.replace('/(business)/dashboard' as never); } catch {}
      requestAnimationFrame(() => startWalkthrough());
      return;
    }
    // Customer flow — THREE things happen at the same render tick so the
    // /(tabs)/ home tab loads UNDER the cover with the demo card already
    // injected. When the user later taps "Start demo" the cover unmounts
    // and the home tab is already in its demo state — no flash of the
    // "real" search page sliding out to make way for the demo card.
    //   1. setDemoCustomerActive(true) — flips the demo-listing flag on
    //      so the home tab's render injects the Chez Joe card at the
    //      top of its list FROM THE FIRST FRAME it mounts.
    //   2. setShowDemoWelcome(true) — the cover at the root nav level
    //      paints over the screen instantly.
    //   3. router.replace('/(tabs)/') — /settings pops, /(tabs)/ mounts
    //      underneath the cover with demoCustomerActive=true already in
    //      the store. The home tab's query loads, layout measures, the
    //      demo card sits at the top of the list — all invisible behind
    //      the cover.
    setDemoCustomerActive(true);
    setShowDemoWelcome(true);
    try { router.replace('/(tabs)/' as never); } catch {}
    // Image prefetch — also runs in the background during the cover
    // display so the basket image is cached by the time step 2 renders.
    try {
      const all = [DEMO_COVER_URL, DEMO_LOGO_URL, ...DEMO_BASKET_PHOTOS]
        .filter((u): u is string => typeof u === 'string' && !!u);
      void Promise.race([
        Promise.all(all.map((uri) => Image.prefetch(uri).catch(() => undefined))),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch {}
  }, [router, user]);

  const handleFAQPress = useCallback(() => {
    setShowFaqModal(true);
  }, []);

  // Bottom sheet: 3 states — closed / half / full
  // Only use translateY for closing (slide down off screen), use height change for expand/collapse
  const sheetY = useRef(new Animated.Value(0)).current;
  const sheetStateRef = useRef<'half' | 'full'>('half');
  const [sheetState, setSheetState] = useState<'half' | 'full'>('half');
  useEffect(() => { sheetStateRef.current = sheetState; }, [sheetState]);

  // 3-state sheet (closed / half / full) with the same dynamic gesture
  // model as src/hooks/useSwipeToDismiss — follow-finger drag, velocity
  // projection on release, low start threshold so the sheet feels alive
  // immediately. The state machine layers on top:
  //   full + projected-down  → drop to half
  //   half + projected-down  → close
  //   half + projected-up    → expand to full
  const sheetPan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => {
      if (g.dy >= 0) sheetY.setValue(g.dy);
      else sheetY.setValue(g.dy / 3); // rubber-band when overshooting up
    },
    onPanResponderRelease: (_, g) => {
      const state = sheetStateRef.current;
      const projection = g.dy + g.vy * 60;
      if (projection > 80 || g.vy > 0.6) {
        if (state === 'full') {
          // Full → half: snap back to 0 (no close), drop state.
          sheetStateRef.current = 'half';
          setSheetState('half');
          Animated.spring(sheetY, { toValue: 0, friction: 10, tension: 80, useNativeDriver: true }).start();
        } else {
          const duration = Math.max(120, Math.min(280, 220 - g.vy * 50));
          Animated.timing(sheetY, { toValue: 800, duration, useNativeDriver: true }).start(({ finished }) => {
            if (!finished) return;
            setShowFaqModal(false); setShowLegalModal(null); sheetY.setValue(0);
            sheetStateRef.current = 'half'; setSheetState('half');
          });
        }
      } else if (g.dy < -40 && state !== 'full') {
        sheetStateRef.current = 'full';
        setSheetState('full');
        Animated.spring(sheetY, { toValue: 0, friction: 10, tension: 80, useNativeDriver: true }).start();
      } else {
        Animated.spring(sheetY, { toValue: 0, friction: 10, tension: 80, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => sheetY.setValue(0),
  })).current;
  const closeSheet = useCallback(() => {
    Animated.timing(sheetY, { toValue: 600, duration: 200, useNativeDriver: true }).start(() => {
      setShowFaqModal(false); setShowLegalModal(null); sheetY.setValue(0);
      sheetStateRef.current = 'half'; setSheetState('half');
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
      setPwError(getErrorMessage(err));
    } finally {
      setPwLoading(false);
    }
  };

  // Step 1 — validate password + new email, then send a verification code to
  // the new address. The email is NOT changed until the code is confirmed.
  const handleSendEmailCode = async () => {
    setEmError('');
    setEmSuccess(false);
    if (!emCurrentPw || !emNewEmail) {
      setEmError(t('auth.fillAllFields'));
      return;
    }
    const trimmed = emNewEmail.trim().toLowerCase();
    // Length-then-shape validation. 254 is the RFC 5321 cap (also our DB cap)
    // and the regex enforces only-ASCII local/domain chars plus a 2+ letter
    // TLD, blocking the most common garbage like "a@b.c" or "foo@bar".
    if (trimmed.length > 254 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmed)) {
      setEmError(t('errors.invalidEmail', { defaultValue: "Format d'email invalide." }));
      return;
    }
    if (user?.email && trimmed === user.email.toLowerCase()) {
      setEmError(t('errors.sameEmail', { defaultValue: 'Le nouvel email doit être différent.' }));
      return;
    }
    setEmLoading(true);
    try {
      const { pendingEmail } = await requestEmailChange(emCurrentPw, trimmed);
      setEmPendingEmail(pendingEmail);
      setEmOtp('');
      setEmStep('verify');
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status;
      if (status === 409) {
        setEmError(t('errors.emailExists', { defaultValue: 'Cet email est déjà utilisé.' }));
      } else if (status === 401) {
        setEmError(t('profile.wrongCurrentPassword', { defaultValue: 'Mot de passe actuel incorrect.' }));
      } else {
        setEmError(getErrorMessage(err));
      }
    } finally {
      setEmLoading(false);
    }
  };

  // Step 2 — confirm the 6-digit code sent to the new address and apply it.
  const handleVerifyEmailCode = async () => {
    setEmError('');
    const code = emOtp.trim();
    if (code.length < 6) {
      setEmError(t('errors.invalidOtp', { defaultValue: 'Code invalide.' }));
      return;
    }
    setEmLoading(true);
    try {
      const { email } = await verifyEmailChange(emPendingEmail, code);
      if (user) setUser({ ...user, email });
      setEmSuccess(true);
      setTimeout(resetEmailModal, 1500);
    } catch (err: any) {
      const status = err?.response?.status ?? err?.status;
      if (status === 409) {
        setEmError(t('errors.emailExists', { defaultValue: 'Cet email est déjà utilisé.' }));
      } else if (status === 401) {
        setEmError(t('errors.invalidOtp', { defaultValue: 'Code invalide ou expiré.' }));
      } else {
        setEmError(getErrorMessage(err));
      }
    } finally {
      setEmLoading(false);
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

  const bizRole = bizCtx.data?.role ?? 'member';
  const bizPerms = bizCtx.data?.permissions ?? {};
  const isAdminOrOwner = bizRole === 'owner' || bizRole === 'admin';
  const hasConfirmPickup = isAdminOrOwner || (bizPerms as any).confirm_pickup === 'write' || (bizPerms as any).confirm_pickup === true;

  const NOTIF_ITEMS: { key: keyof NotifPrefs; labelKey: string; descKey: string }[] = isBusiness
    ? [
        // Business items — only show relevant ones based on permissions
        ...(hasConfirmPickup ? [{ key: 'newOrders' as keyof NotifPrefs, labelKey: 'settings.newOrders', descKey: 'settings.newOrdersDesc' }] : []),
        ...(hasConfirmPickup ? [{ key: 'basketPickedUp' as keyof NotifPrefs, labelKey: 'settings.basketPickedUp', descKey: 'settings.basketPickedUpDesc' }] : []),
        { key: 'cancellations' as keyof NotifPrefs, labelKey: 'settings.cancellations', descKey: 'settings.cancellationsDesc' },
      ]
    : [
        // Customer items
        { key: 'pickupReminder', labelKey: 'settings.pickupReminder', descKey: 'settings.pickupReminderDesc' },
        { key: 'favoritesUpdates', labelKey: 'settings.favoritesUpdates', descKey: 'settings.favoritesUpdatesDesc' },
        { key: 'suggestions', labelKey: 'settings.suggestions', descKey: 'settings.suggestionsDesc' },
        { key: 'promotions', labelKey: 'settings.promotions', descKey: 'settings.promotionsDesc' },
      ];

  const PERMISSION_ITEMS = [
    { labelKey: 'settings.camera', status: cameraStatus, icon: Camera },
    { labelKey: 'settings.location', status: locationStatus, icon: MapPin },
    { labelKey: 'settings.photoLibrary', status: photoLibraryStatus, icon: ImageIcon },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })}
          accessibilityRole="button"
        >
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, marginLeft: theme.spacing.lg }]}>
          {t('settings.title')}
        </Text>
      </View>
      <ScrollView ref={settingsScrollRef} contentContainerStyle={{ padding: theme.spacing.xl }} showsVerticalScrollIndicator={false}>
        {/* User identity card */}
        {user && (
          <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl, padding: theme.spacing.lg, flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: theme.colors.primary, fontSize: 20, fontWeight: '700' }}>
                {(userName ?? user.email ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              {userName ? (
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {userName}
                </Text>
              ) : null}
              {bizName ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                  {bizName}
                </Text>
              ) : null}
              {user.email ? (
                <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 2 }}>
                  {user.email}
                </Text>
              ) : null}
              {/* Role line — only for business users. We surface the team
                  scope here so a member glancing at their settings knows what
                  level of access they have. Format:
                    org-admin       → "Admin de {org}"
                    location-admin  → "Admin de {org} - {location}"
                    member          → "Membre de {org} - {location}" */}
              {isBusiness && bizCtx.data?.role ? (() => {
                const orgLabel = bizCtx.data?.organization_name ?? '';
                const locLabel = (bizCtx.data?.location_name ?? '').trim();
                const role = bizCtx.data?.role;
                const hasLocation = !!bizCtx.data?.location_id;
                const isOrgScopedAdmin = (role === 'admin' || role === 'owner') && !hasLocation;
                const isLocAdmin = role === 'admin' && hasLocation;
                // When the backend hasn't returned a location_name (legacy
                // `/organizations` payload, soft-deleted location, race
                // condition), the templated keys would render "Membre de Org
                // - " with a dangling separator. Switch to a no-location
                // variant so the label reads cleanly as "Membre de {Org}".
                const display = isOrgScopedAdmin
                  ? t('business.settings.roleDisplay.orgAdmin', { org: orgLabel, defaultValue: `Admin de ${orgLabel}` })
                  : isLocAdmin && locLabel
                    ? t('business.settings.roleDisplay.locationAdmin', { org: orgLabel, location: locLabel, defaultValue: `Admin de ${orgLabel} - ${locLabel}` })
                    : isLocAdmin
                      ? t('business.settings.roleDisplay.locationAdminNoLocation', { org: orgLabel, defaultValue: `Admin de ${orgLabel}` })
                      : locLabel
                        ? t('business.settings.roleDisplay.member', { org: orgLabel, location: locLabel, defaultValue: `Membre de ${orgLabel} - ${locLabel}` })
                        : t('business.settings.roleDisplay.memberNoLocation', { org: orgLabel, defaultValue: `Membre de ${orgLabel}` });
                return (
                  <Text style={{ color: theme.colors.primary, ...theme.typography.caption, marginTop: 4, fontFamily: 'Poppins_600SemiBold' }} numberOfLines={2}>
                    {display}
                  </Text>
                );
              })() : null}
            </View>
          </View>
        )}

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
          <Switch value={notifications} onValueChange={async (val) => {
            setNotifications(val);
            void AsyncStorage.setItem(PUSH_ENABLED_KEY, String(val));
            if (val) {
              // Request system permission and register for push notifications
              const { registerForPushNotifications } = require('@/src/services/pushNotifications');
              const token = await registerForPushNotifications();
              if (!token) {
                Alert.alert(
                  t('settings.pushPermissionDenied', { defaultValue: 'Notifications désactivées' }),
                  t('settings.pushPermissionDeniedDesc', { defaultValue: 'Activez les notifications dans les réglages de votre appareil pour recevoir des alertes.' }),
                  [
                    { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
                    { text: t('settings.openSettings', { defaultValue: 'Réglages' }), onPress: () => Linking.openSettings() },
                  ]
                );
              }
            } else {
              // Push turned OFF — clear the token on the backend so the server
              // stops delivering OS-level notifications to this phone. In-app
              // notifications/popups keep working (they don't use the token).
              const { unregisterPushNotifications } = require('@/src/services/pushNotifications');
              void unregisterPushNotifications();
            }
          }} trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }} thumbColor={notifications ? theme.colors.primary : theme.colors.muted} accessibilityLabel={t('settings.pushNotifications')} accessibilityRole="switch" />
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
            onPress={() => setShowEmailModal(true)}
            accessibilityLabel={t('profile.changeEmail', { defaultValue: "Changer l'email" })}
            accessibilityRole="button"
          >
            <View style={styles.menuItemLeft}>
              <Mail size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.changeEmail', { defaultValue: "Changer l'email" })}
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg }]}
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
        </View>

        {/* Support & Info */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('settings.support')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
            onPress={() => router.push('/faq' as never)}
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
            style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
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

          {/* Mode démo — moved here from Account section per UX request. */}
          <TouchableOpacity
            ref={demoRowRef as any}
            onLayout={measureDemoRow}
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
              onPress={() => router.push({ pathname: '/legal', params: { type: item.key } } as never)}
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

        {/* Delete Account — quiet destructive trigger. The loud red confirm
            lives inside the two-step modal below. */}
        <TouchableOpacity
          onPress={deleteAccount}
          disabled={deleteLoading}
          style={{ paddingVertical: theme.spacing.md, alignItems: 'center', opacity: deleteLoading ? 0.5 : 1 }}
          accessibilityLabel={t('profile.deleteAccount')}
          accessibilityRole="button"
        >
          <Text style={{ color: theme.colors.error, fontSize: 14, fontFamily: 'Poppins_600SemiBold', fontWeight: '600' }}>
            {t('profile.deleteAccount')}
          </Text>
        </TouchableOpacity>

        {/* App Version */}
        <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textAlign: 'center' as const, marginTop: theme.spacing.xl }]}>
          Barakeat v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Language Modal */}
      <ModalCard
        visible={showLanguageModal}
        onClose={() => setShowLanguageModal(false)}
        title={t('profile.selectLanguage')}
        maxWidth={360}
      >
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
                borderWidth: 1,
                borderColor: isSelected ? theme.colors.primary : theme.colors.divider,
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
      </ModalCard>

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
            <View {...sheetPan.panHandlers} style={{ paddingTop: 10, paddingBottom: 12, alignItems: 'center' }}>
              <View style={[styles.bottomModalHandle, { backgroundColor: theme.colors.divider }]} />
            </View>
            <View style={[styles.bottomModalHeader, { padding: theme.spacing.xl }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('profile.faq')}
              </Text>
              <TouchableOpacity onPress={closeSheet} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }} scrollEnabled={sheetState === 'full'}>
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
            <View {...sheetPan.panHandlers} style={{ paddingTop: 10, paddingBottom: 12, alignItems: 'center' }}>
              <View style={[styles.bottomModalHandle, { backgroundColor: theme.colors.divider }]} />
            </View>
            <View style={[styles.bottomModalHeader, { padding: theme.spacing.xl }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {showLegalModal === 'terms' ? t('profile.termsAndConditions') :
                 showLegalModal === 'cookies' ? t('profile.cookies') :
                 t('profile.privacyPolicy')}
              </Text>
              <TouchableOpacity onPress={closeSheet} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }} scrollEnabled={sheetState === 'full'}>
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
      <ModalCard
        visible={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        maxWidth={340}
        contentStyle={{ alignItems: 'center' }}
      >
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
          onPress={() => { Linking.openURL('mailto:contact@barakeat.tn'); setShowSupportModal(false); }}
          style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <Mail size={16} color="#e3ff5c" />
          <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 15 }}>contact@barakeat.tn</Text>
        </TouchableOpacity>
      </ModalCard>

      {/* About / A Propos Modal */}
      <ModalCard
        visible={showAboutModal}
        onClose={() => setShowAboutModal(false)}
        maxWidth={360}
        accent
        contentStyle={{ alignItems: 'center' }}
      >
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
          style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 12, width: '100%', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <ExternalLink size={16} color="#e3ff5c" />
          <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 14 }}>barakeat.tn</Text>
        </TouchableOpacity>
      </ModalCard>

      {/* Delete Account Confirmation Modal */}
      <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={() => setShowDeleteModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <PaperSurface radius={20} style={{ padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: theme.colors.surfaceMuted, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <AlertTriangle size={26} color={theme.colors.textSecondary} />
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
          </PaperSurface>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <ModalCard
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        title={t('profile.changePassword')}
        maxWidth={380}
      >
        {pwSuccess ? (
          <View style={{ backgroundColor: '#16a34a14', borderWidth: 1, borderColor: '#16a34a40', borderRadius: theme.radii.r12, paddingVertical: 10, paddingHorizontal: 14, marginBottom: theme.spacing.lg }}>
            <Text style={{ color: '#16a34a', ...theme.typography.bodySm, fontWeight: '600' }}>
              {t('profile.passwordChanged', { defaultValue: 'Mot de passe changé !' })}
            </Text>
          </View>
        ) : null}
        <AppTextInput
          label={t('profile.currentPassword')}
          secureToggle
          containerStyle={{ marginBottom: theme.spacing.lg }}
          value={currentPw}
          onChangeText={setCurrentPw}
          placeholder={t('profile.currentPassword')}
          accessibilityLabel={t('profile.currentPassword')}
        />
        <AppTextInput
          label={t('profile.newPasswordLabel')}
          secureToggle
          containerStyle={{ marginBottom: theme.spacing.lg }}
          value={newPw}
          onChangeText={setNewPw}
          placeholder={t('profile.newPasswordLabel')}
          accessibilityLabel={t('profile.newPasswordLabel')}
        />
        <AppTextInput
          label={t('profile.confirmPasswordLabel')}
          secureToggle
          containerStyle={{ marginBottom: theme.spacing.sm }}
          value={confirmPw}
          onChangeText={setConfirmPw}
          placeholder={t('profile.confirmPasswordLabel')}
          accessibilityLabel={t('profile.confirmPasswordLabel')}
          error={pwError}
        />
        <TouchableOpacity
          onPress={handleChangePassword}
          disabled={pwLoading}
          style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.md, opacity: pwLoading ? 0.5 : 1 }}
          accessibilityLabel={pwLoading ? t('common.loading') : t('common.save')}
          accessibilityRole="button"
        >
          <Text style={{ color: '#fff', ...theme.typography.button, textAlign: 'center' }}>
            {pwLoading ? t('common.loading') : t('common.save')}
          </Text>
        </TouchableOpacity>
      </ModalCard>

      {/* Change Email Modal — two steps: request code, then verify it */}
      <ModalCard
        visible={showEmailModal}
        onClose={resetEmailModal}
        title={t('profile.changeEmail', { defaultValue: "Changer l'email" })}
        maxWidth={380}
      >
        {emSuccess ? (
          <View style={{ backgroundColor: '#16a34a14', borderWidth: 1, borderColor: '#16a34a40', borderRadius: theme.radii.r12, paddingVertical: 10, paddingHorizontal: 14, marginBottom: theme.spacing.lg }}>
            <Text style={{ color: '#16a34a', ...theme.typography.bodySm, fontWeight: '600' }}>
              {t('profile.emailChanged', { defaultValue: 'Email changé avec succès.' })}
            </Text>
          </View>
        ) : null}

        {emStep === 'request' ? (
          <>
            {user?.email ? (
              <View style={{ marginBottom: theme.spacing.lg }}>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 4 }}>
                  {t('profile.currentEmail', { defaultValue: 'Email actuel' })}
                </Text>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body }} numberOfLines={1}>
                  {user.email}
                </Text>
              </View>
            ) : null}
            <AppTextInput
              label={t('profile.newEmail', { defaultValue: 'Nouvel email' })}
              containerStyle={{ marginBottom: theme.spacing.lg }}
              value={emNewEmail}
              onChangeText={setEmNewEmail}
              placeholder="vous@example.com"
              accessibilityLabel={t('profile.newEmail', { defaultValue: 'Nouvel email' })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <AppTextInput
              label={t('profile.currentPassword')}
              secureToggle
              containerStyle={{ marginBottom: theme.spacing.sm }}
              value={emCurrentPw}
              onChangeText={setEmCurrentPw}
              placeholder={t('profile.currentPassword')}
              accessibilityLabel={t('profile.currentPassword')}
              error={emError}
            />
            <TouchableOpacity
              onPress={handleSendEmailCode}
              disabled={emLoading}
              style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.md, opacity: emLoading ? 0.5 : 1 }}
              accessibilityLabel={emLoading ? t('common.loading') : t('profile.sendCode', { defaultValue: 'Envoyer le code' })}
              accessibilityRole="button"
            >
              <Text style={{ color: '#fff', ...theme.typography.button, textAlign: 'center' }}>
                {emLoading ? t('common.loading') : t('profile.sendCode', { defaultValue: 'Envoyer le code' })}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={{ marginBottom: theme.spacing.lg }}>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20 }}>
                {t('profile.emailCodeSent', { email: emPendingEmail, defaultValue: `Nous avons envoyé un code à 6 chiffres à ${emPendingEmail}. Saisissez-le ci-dessous pour confirmer.` })}
              </Text>
            </View>
            <AppTextInput
              label={t('profile.confirmationCode', { defaultValue: 'Code de confirmation' })}
              containerStyle={{ marginBottom: theme.spacing.sm }}
              value={emOtp}
              onChangeText={(v) => setEmOtp(v.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="000000"
              accessibilityLabel={t('profile.confirmationCode', { defaultValue: 'Code de confirmation' })}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
              error={emError}
            />
            <TouchableOpacity
              onPress={handleVerifyEmailCode}
              disabled={emLoading}
              style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.md, opacity: emLoading ? 0.5 : 1 }}
              accessibilityLabel={emLoading ? t('common.loading') : t('profile.verifyAndSave', { defaultValue: 'Vérifier et enregistrer' })}
              accessibilityRole="button"
            >
              <Text style={{ color: '#fff', ...theme.typography.button, textAlign: 'center' }}>
                {emLoading ? t('common.loading') : t('profile.verifyAndSave', { defaultValue: 'Vérifier et enregistrer' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSendEmailCode}
              disabled={emLoading}
              style={{ paddingVertical: theme.spacing.md, marginTop: theme.spacing.xs }}
              accessibilityLabel={t('auth.resendOtp', { defaultValue: 'Renvoyer le code' })}
              accessibilityRole="button"
            >
              <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600', textAlign: 'center' }}>
                {t('auth.resendOtp', { defaultValue: 'Renvoyer le code' })}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ModalCard>

      {showSettingsOverlay && demoRect && (
        <SettingsDemoOverlay
          rect={demoRect}
          onDone={skipWalkthrough}
          theme={theme}
          t={t}
          insets={insets}
        />
      )}
    </SafeAreaView>
  );
}

function SettingsDemoOverlay({ rect, onDone, theme, t, insets }: { rect: { x: number; y: number; w: number; h: number }; onDone: () => void; theme: any; t: any; insets: { top: number; bottom: number; left: number; right: number } }) {
  // Live dimensions so the dim mask and tooltip placement work on devices
  // whose window height settles to a different value after edge-to-edge
  // initialisation (Pixel 6, foldables, etc.).
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  // Self-measure where this overlay sits in window coords. The settings
  // screen wraps content in <SafeAreaView edges={['top']}>, so without this
  // the overlay's (0,0) is below the status bar while `rect.x/y` from
  // measureInWindow are in window coords — leaving the halo `insets.top`
  // off from the actual row.
  const { originRef, originX, originY, remeasure: remeasureOrigin } = useOverlayOriginOffset();
  // Pad the hole by 4px so the highlight ring sits outside the row border.
  const pad = 4;
  const x = rect.x - pad;
  const y = rect.y - pad;
  const w = rect.w + pad * 2;
  const h = rect.h + pad * 2;
  const radius = 14;

  // Tooltip above the row if the row is in the bottom half, else below.
  // `insets.bottom` covers the Samsung system nav bar (visible even with
  // edge-to-edge enabled) so the tooltip never gets clipped by it.
  const safeBottom = insets.bottom + 12;
  const below = (y + h / 2) < SCREEN_H / 2;
  const tooltipTop = below ? y + h + 20 : undefined;
  const tooltipBottom = !below ? SCREEN_H - y + 20 + safeBottom : undefined;

  // SVG even-odd path: full-screen rect + inner rounded-rect drawn with
  // opposite winding so the rounded hole is cut out cleanly. Replaces an
  // older 4-rectangle + 4-corner-cap construction whose caps overlapped
  // the rounded edges of the row and made the halo border look like it
  // was fading out at the corners.
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const x2 = x + w;
  const y2 = y + h;
  const cutoutPath = [
    `M0 0 H${SCREEN_W} V${SCREEN_H} H0 Z`,
    `M${x + r} ${y}`,
    `H${x2 - r}`,
    `A${r} ${r} 0 0 1 ${x2} ${y + r}`,
    `V${y2 - r}`,
    `A${r} ${r} 0 0 1 ${x2 - r} ${y2}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${y2 - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');

  return (
    <View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999 }} onLayout={remeasureOrigin}>
      <View ref={originRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
      {/* Window-coords canvas. See useOverlayOriginOffset. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: -originY, left: -originX, width: SCREEN_W, height: SCREEN_H }}>
      {/* Visual dim with rounded cutout — SVG follows the row's rounded
          corners exactly so the halo border isn't cropped at the curves. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <Svg width={SCREEN_W} height={SCREEN_H} style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Path d={cutoutPath} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
        </Svg>
      </View>

      {/* Highlight ring */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: x, top: y, width: w, height: h,
          borderRadius: radius, borderWidth: 3, borderColor: '#e3ff5c', backgroundColor: 'transparent',
        }}
      />

      {/* Tooltip */}
      <View
        style={{
          position: 'absolute',
          top: tooltipTop,
          bottom: tooltipBottom,
          left: Math.max(16, Math.min(SCREEN_W / 2 - 140, SCREEN_W - 296)),
          width: 280,
          backgroundColor: '#fff',
          borderRadius: 20,
          padding: 20,
          shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#114b3c12', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
            <Shield size={22} color="#114b3c" />
          </View>
          <Text style={{ color: '#114b3c', fontSize: 17, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1 }}>
            {t('walkthrough.biz.settingsDemo.title', { defaultValue: 'Relancer le guide' })}
          </Text>
        </View>
        <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, marginBottom: 12 }}>
          {t('walkthrough.biz.settingsDemo.desc', { defaultValue: "Vous pouvez revenir ici et appuyer sur « Mode démo » à tout moment pour revoir cette visite guidée." })}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, backgroundColor: '#114b3c0f', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 }}>
          <Hand size={14} color="#114b3c" />
          <Text style={{ color: '#114b3c', fontSize: 12, fontFamily: 'Poppins_600SemiBold', marginLeft: 6, flex: 1 }}>
            {t('walkthrough.biz.settingsDemo.hint', { defaultValue: 'Repérez la ligne Mode démo surlignée.' })}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TouchableOpacity
            onPress={onDone}
            style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
          >
            <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              {t('walkthrough.finishDemo', { defaultValue: 'OK, terminer la démo' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  sectionHeader: { textTransform: 'none' },
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
