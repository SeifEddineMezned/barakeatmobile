import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput, Linking, Animated, PanResponder, KeyboardAvoidingView, Platform, findNodeHandle, UIManager, Image, AppState } from 'react-native';
import { DEMO_COVER_URL, DEMO_LOGO_URL, DEMO_BASKET_PHOTOS } from '@/src/lib/demoData';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { ModalCard } from '@/src/components/ui/ModalCard';
import { AppTextInput } from '@/src/components/ui/AppTextInput';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  ArrowLeft, Globe, Bell as BellIcon, Shield, HelpCircle, Info, LogOut,
  ChevronRight, ChevronDown, ChevronUp, Lock, FileText, Headphones, X, Trash2, Camera, MapPin, Image as ImageIcon, AlertTriangle, Mail, ExternalLink, Hand, Check,
} from 'lucide-react-native';
import { EditIcon8 } from '@/src/components/ui/Icon8';
import { EditProfileModal } from '@/src/components/EditProfileModal';
import { useImageCropper } from '@/src/components/ImageCropper';
import { Dimensions, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useOverlayOriginOffset } from '@/src/components/useOverlayOriginOffset';
import { StatusBar } from 'expo-status-bar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/src/stores/authStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useAddressStore } from '@/src/stores/addressStore';
import { logout, deleteAccount as deleteAccountApi } from '@/src/services/auth';
import { fetchMyReservations } from '@/src/services/reservations';
import { isPendingReservationActive } from '@/src/utils/orderExpiry';
import { updatePassword, requestEmailChange, verifyEmailChange, fetchUserProfile } from '@/src/services/profile';
import { fetchMyContext } from '@/src/services/teams';
import { FeatureFlags } from '@/src/lib/featureFlags';
import i18n from '@/src/i18n';
import Constants from 'expo-constants';
import { Camera as ExpoCamera } from 'expo-camera';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
// Photo permission is read via expo-media-library (NOT expo-image-picker): it's
// the same permission the in-app photo grid uses, and unlike image-picker it
// reports the REAL state on Android 13+ — including "Selected photos" as
// accessPrivileges === 'limited' (image-picker reports granted even when the OS
// shows the permission denied/limited, the Android "shows allowed when it isn't"
// bug).
import * as MediaLibrary from 'expo-media-library';

// Arabic is gated on FeatureFlags.LANGUAGES_AR_ENABLED while the RTL layout is
// audited — see featureFlags.ts for the rationale. When the flag is OFF the
// pill simply isn't rendered; when ON the existing logic handles it.
// Language list — each row carries its native name, a romanized
// label (where useful), and an ISO code shown in the monogram chip.
// Keeps the selector typographically rich without depending on flag
// emojis (they render inconsistently across iOS versions / Android
// OEMs and read as decorative noise rather than as identifiers).
const LANGUAGES: Array<{
  code: string;
  native: string;
  romanized?: string;
  monogram: string;
  dir: 'ltr' | 'rtl';
}> = [
  { code: 'fr', native: 'Français', monogram: 'FR', dir: 'ltr' },
  { code: 'en', native: 'English', monogram: 'EN', dir: 'ltr' },
  ...(FeatureFlags.LANGUAGES_AR_ENABLED
    ? [{ code: 'ar' as const, native: 'العربية', romanized: 'Al-ʿArabīyah', monogram: 'AR', dir: 'rtl' as const }]
    : []),
];

const NOTIF_PREFS_KEY = '@barakeat_notif_prefs';

interface NotifPrefs {
  // ── Grouped "order tracking" channel ──────────────────────────────────
  // One toggle that gates every order-lifecycle push EXCEPT a brand-new
  // order (which keeps its own channel). For customers it covers pickup
  // confirmations, cancellations and pickup reminders; for businesses it
  // covers basket-picked-up and cancellations at their venue. The backend
  // gates all of those on this single `orderUpdates` key. The older
  // per-event keys below are kept for backward-compat with already-synced
  // preference blobs but are no longer rendered as individual rows.
  orderUpdates: boolean;
  // Customer prefs
  orderConfirmed: boolean;
  pickupReminder: boolean;
  // Customer — basket pickup confirmed by the merchant.
  pickupConfirmed: boolean;
  favoritesUpdates: boolean;
  // "Offres et nouveautés" — gates the admin broadcast channel. Replaces the
  // old `suggestions` + `promotions` toggles (kept optional below for
  // backward-compat with already-synced preference blobs). Default ON (opt-out).
  offersNews: boolean;
  // Business prefs
  newOrders: boolean;
  basketPickedUp: boolean;
  // Business — a customer left a review.
  reviews: boolean;
  // Shared key — for business: orders cancelled at their venue; for customer:
  // their own order cancelled by the merchant. Gated per-user so each role only
  // sees its own cancellations.
  cancellations: boolean;
  // Shared (customer + business) — chat message push notifications
  messages: boolean;
  // Deprecated, no longer rendered — preserved so old stored blobs round-trip.
  suggestions?: boolean;
  promotions?: boolean;
}

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  orderUpdates: true,
  orderConfirmed: true,
  pickupReminder: true,
  pickupConfirmed: true,
  favoritesUpdates: true,
  offersNews: true,
  newOrders: true,
  basketPickedUp: true,
  reviews: true,
  cancellations: true,
  messages: true,
};

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { manageLibraryAccess } = useImageCropper();
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
  // Collapsed by default — the per-channel preference list under
  // the push toggle is a long stack of rows, and most users won't
  // change them often. Expanding on demand keeps the settings page
  // visually calm.
  const [notifPrefsExpanded, setNotifPrefsExpanded] = useState(false);
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

  // Name/gender editing now lives here (the profile section is read-only).
  const [showEditProfile, setShowEditProfile] = useState(false);

  // ── Walkthrough final-stage overlay ──────────────────────────────────────
  // Rendered when the business walkthrough reaches its settings step. We
  // measure the Demo Mode row in window coordinates so the cutout sits
  // exactly on top of it, no matter how the user scrolls.
  const showSettingsOverlay = useWalkthroughStore((s) => s.showSettingsOverlay);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  // True for the lifetime of a demo run (welcome cover → walkthrough → end).
  // Used below to gate the "Mode démo" row in this same screen — the demo's
  // final step lands the user HERE with the row highlighted, and without
  // this gate a tap on the row would restart the demo from scratch right
  // when it's supposed to end.
  const demoSequencePending = useWalkthroughStore((s) => s.demoSequencePending);
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

  // Load permission statuses — initially on mount, then whenever the app
  // comes back to the foreground. The user typically toggles a permission
  // by tapping a row, getting kicked out to the OS Settings app, flipping
  // the toggle there, and returning. That returns to our app as a
  // foreground transition, NOT a screen-focus change (the Settings screen
  // never lost focus from React's perspective — only the whole app went
  // to background). Without this listener, the row labels stay stale
  // ("Granted") until the user backs out and re-enters the Settings
  // screen, which is exactly the symptom the user reported.
  // Robust photo-permission read. We consult BOTH expo modules because each is
  // reliable on a different platform:
  //   • accessPrivileges === 'limited' is exposed by expo-image-picker on iOS
  //     ("Allow Limited") and by expo-media-library on Android ("Selected
  //     photos") — accept "limited" from EITHER so the in-app grid opens on both.
  //   • For plain granted/denied we trust media-library (image-picker
  //     over-reports `granted` on Android 13+), falling back to image-picker only
  //     when the media-library native module is absent (Expo Go).
  const readPhotoPerm = useCallback(async () => {
    let ml: any = null, ip: any = null;
    try { ml = await MediaLibrary.getPermissionsAsync(false, ['photo']); } catch {}
    try { ip = await ImagePicker.getMediaLibraryPermissionsAsync(); } catch {}
    const isLimited = ml?.accessPrivileges === 'limited' || ip?.accessPrivileges === 'limited';
    const granted = ml ? (ml.status === 'granted' || ml.granted === true) : (ip?.granted === true);
    const src = ml ?? ip ?? {};
    return {
      isLimited,
      granted,
      status: src.status as string | undefined,
      canAskAgain: src.canAskAgain as boolean | undefined,
    };
  }, []);

  const checkPermissions = useCallback(async () => {
    // IMPORTANT: only READ the statuses here (get*), never request*. This runs
    // on mount + on every foreground (AppState) + on focus, so a request* would
    // fire the native OS permission popup just from OPENING the Settings screen.
    // That's not a no-op even for "already decided" permissions: iOS re-prompts
    // for a location "Allow Once" / one-time grant, and can re-present the
    // limited-photos sheet — which surfaced as "two permission popups appear on
    // their own as soon as I enter Settings". get* gives the live status without
    // any UI. (When the user changes camera/photos in iOS Settings, iOS
    // terminates + relaunches the app, so get* is fresh on return anyway.)
    try {
      const cam = await ExpoCamera.getCameraPermissionsAsync();
      setCameraStatus(cam.granted ? 'Granted' : 'Not Set');
    } catch {
      setCameraStatus('Not Set');
    }
    try {
      const loc = await Location.getForegroundPermissionsAsync();
      const iosScope = (loc as any)?.ios?.scope as 'none' | 'whenInUse' | 'always' | undefined;
      const isGranted =
        loc.granted
        || loc.status === 'granted'
        || iosScope === 'whenInUse'
        || iosScope === 'always';
      setLocationStatus(isGranted ? 'Granted' : 'Not Set');
    } catch {
      setLocationStatus('Not Set');
    }
    try {
      const p = await readPhotoPerm();
      setPhotoLibraryStatus(p.isLimited ? 'Limited' : (p.granted ? 'Granted' : 'Not Set'));
    } catch {
      setPhotoLibraryStatus('Not Set');
    }
  }, [readPhotoPerm]);

  // Tapping a permission row. We branch on the CURRENT status because the OS
  // limits what's possible:
  //   • undetermined → show the native permission popup (the only time iOS
  //     shows it; Android can also re-prompt a 'denied' one while canAskAgain).
  //   • iOS Limited photos → open the in-app photo-access manager.
  //   • already granted → an app CANNOT revoke its own permission, so the only
  //     way to turn it off is the OS Settings page → send them there.
  //   • permanently denied → iOS never re-prompts; only Settings can re-enable.
  const handlePermissionPress = useCallback(async (kind: 'camera' | 'location' | 'photo') => {
    try {
      // ── Photo: handled via the dual-read helper (media-library + image-picker) ──
      if (kind === 'photo') {
        const p = await readPhotoPerm();
        // The in-app grid is iOS-ONLY. On iOS, "Allow Limited" is the SAME
        // PHPhotoLibrary grant expo-media-library reads, so the grid shows the
        // selected photos. On Android, "Selected photos" is NOT readable through
        // expo-media-library's getAssetsAsync (it only errors "permission
        // required") — so on Android a limited grant goes to OS Settings, where
        // the user can switch to "Allow all" (which the app's photo features
        // need) or change their selection. This is the same reason the photo
        // PICKER fails on Android partial access.
        if (p.isLimited) {
          if (Platform.OS === 'ios') { void manageLibraryAccess(); return; }
          await checkPermissions();
          Linking.openSettings();
          return;
        }
        const canPrompt = p.status === 'undetermined'
          || (p.canAskAgain === true && p.status !== 'granted');
        if (canPrompt) {
          try { await MediaLibrary.requestPermissionsAsync(false, ['photo']); }
          catch { await ImagePicker.requestMediaLibraryPermissionsAsync(); }
          await checkPermissions();
          return;
        }
        // Fully granted (turn OFF in Settings) or permanently denied (turn ON in
        // Settings) → the OS Settings page.
        await checkPermissions();
        Linking.openSettings();
        return;
      }

      // ── Camera / location ──
      const before: any = kind === 'camera'
        ? await ExpoCamera.getCameraPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();

      // Can the OS still show a native prompt? Only when never decided (iOS),
      // or on Android while a 'denied' permission is still re-askable.
      const canPrompt = before?.status === 'undetermined'
        || (before?.canAskAgain === true && before?.status !== 'granted');

      if (canPrompt) {
        if (kind === 'camera') await ExpoCamera.requestCameraPermissionsAsync();
        else await Location.requestForegroundPermissionsAsync();
        await checkPermissions();
        return;
      }

      // Already granted (can only be turned OFF in Settings) OR permanently
      // denied (can only be turned ON in Settings) → open the OS Settings page.
      await checkPermissions();
      Linking.openSettings();
    } catch {
      Linking.openSettings();
    }
  }, [checkPermissions, manageLibraryAccess, readPhotoPerm]);

  useEffect(() => {
    void checkPermissions();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void checkPermissions();
    });
    return () => sub.remove();
  }, [checkPermissions]);

  // Also re-check whenever the Settings screen regains focus — covers the
  // case where iOS terminated the app after a permission flip (then the
  // user reopens via Expo Go and navigates to Settings — AppState 'change'
  // doesn't fire because it's a cold launch, but `useFocusEffect` does)
  // AND the case where the user navigated away and came back from another
  // tab. Schedules the read on the next tick so expo-location has a moment
  // to publish the freshly-resolved permission after the relaunch.
  useFocusEffect(
    React.useCallback(() => {
      const t = setTimeout(() => { void checkPermissions(); }, 200);
      return () => clearTimeout(t);
    }, [checkPermissions]),
  );

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
    // Report the new language to the backend so OS push banners localize to it.
    try { require('@/src/services/locale').syncLocaleToBackend(langCode); } catch {}
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
    const { resetWalkthroughCompletion, setShowDemoWelcome, setDemoCustomerActive, setDemoSequencePending } = useWalkthroughStore.getState();
    resetWalkthroughCompletion();
    // Mark the demo sequence so the root layout runs its "demo ended" handler
    // (post-demo add-address / add-location prompt) when this run finishes.
    setDemoSequencePending(true);
    const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
    if (isBiz) {
      // Show the "Start demo" cover first (it routes to the dashboard and starts
      // the walkthrough). Previously this jumped straight into the tour.
      try { router.replace('/(business)/dashboard' as never); } catch {}
      setShowDemoWelcome(true);
      return;
    }
    // Customer: give them a usable demo location when they have no saved address
    // so real cards show a distance and the map works during the demo.
    {
      const addr = useAddressStore.getState();
      if (addr.addresses.length === 0) {
        addr.setDemoAddress({ id: 'demo-grand-tunis', label: 'Grand Tunis', lat: 36.8065, lng: 10.1815 });
      }
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
  // Delete-flow state machine — see handleDeleteConfirm below.
  //   first         → "Are you sure?" with role-aware disclosure
  //   final         → final confirm, fires the API
  //   blocked       → buyer has an active reservation (backend 409 ACTIVE_ORDER)
  //   transfer      → owner-with-other-admins must pick a successor
  //   org-danger    → owner-no-admins must explicitly opt into org dissolution
  type DeleteStep = 'first' | 'final' | 'blocked' | 'transfer' | 'org-danger';
  const [deleteStep, setDeleteStep] = useState<DeleteStep>('first');
  const [transferCandidates, setTransferCandidates] = useState<{ memberId: number; name?: string; email?: string }[]>([]);
  const [transferTo, setTransferTo] = useState<number | null>(null);
  const [orgDangerAck, setOrgDangerAck] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Populated from the backend's 409 ACTIVE_ORDER payload so the 'blocked'
  // step can show exactly WHICH reservations are still considered active —
  // without this list, the user keeps cancelling the order they remember
  // and remains blocked by another row they had no way to know about.
  const [blockingOrders, setBlockingOrders] = useState<{
    id: number;
    pickupCode?: string | null;
    status?: string | null;
    reservationDate?: string | null;
    restaurantName?: string | null;
  }[]>([]);

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

  const resetDeleteFlow = useCallback(() => {
    setDeleteStep('first');
    setTransferCandidates([]);
    setTransferTo(null);
    setOrgDangerAck(false);
    setDeleteError(null);
    setBlockingOrders([]);
  }, []);

  const closeDeleteModal = useCallback(() => {
    setShowDeleteModal(false);
    // Reset on next tick so the closing animation doesn't show step jumps.
    setTimeout(resetDeleteFlow, 250);
  }, [resetDeleteFlow]);

  const deleteAccount = useCallback(() => {
    resetDeleteFlow();
    setShowDeleteModal(true);
  }, [resetDeleteFlow]);

  // Submits the deletion API call. Backend returns 200 on success, or 409 with
  // an error code that tells us which extra step the modal needs to switch
  // into (transfer-ownership picker or org-dissolution warning).
  const submitDelete = useCallback(async (payload: { transferTo?: number; deleteOrg?: boolean } = {}) => {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      // Pre-flight check (buyer only) — fetch the live reservations list
      // BEFORE submitting the delete API call. The customer's /my/reservations
      // endpoint is the source of truth for "what can this user still act on"
      // (it already filters out hidden rows server-side), so any row it
      // returns with an active status will block deletion. Running this on
      // the mobile side guarantees the user gets the correct verdict even
      // when the backend's blocking check hasn't been redeployed yet AND
      // sidesteps the connection-pool race where the just-cancelled order's
      // committed status isn't yet visible to the delete-account query —
      // the previous "delete still blocked right after cancel, then works
      // after a refresh" report. If the user has a genuinely active order,
      // we skip the network round-trip entirely and jump straight to the
      // 'blocked' step with the order list.
      const isBuyer = user?.role !== 'business' && (user as any)?.type !== 'restaurant';
      if (isBuyer) {
        try {
          const reservations = await fetchMyReservations();
          // Use the SHARED `isPendingReservationActive` predicate so the
          // count here is identical to what the orders tab calls
          // "Incoming". The previous status-only filter (which mirrored
          // a since-tightened backend) counted stale 'confirmed' rows
          // whose pickup day was days in the past — the user saw
          // "4 orders en attente" while their incoming tab showed only
          // 1. The backend now filters with the same rule, so this can
          // tighten too without risking a "server blocks but mobile
          // showed nothing" mismatch.
          const blocking = (Array.isArray(reservations) ? reservations : []).filter(
            (r: any) => isPendingReservationActive(r),
          );
          // Diagnostic: log all reservation statuses so the next "blocked
          // after cancel" report can be inspected from the Metro console
          // without a server round-trip.
          console.log(
            '[Delete account] Pre-flight saw',
            Array.isArray(reservations) ? reservations.length : 0,
            'reservation(s); blocking:',
            blocking.length,
            blocking.map((r: any) => `#${r.id}/${r.status}/${r.reservation_date ?? r.reservationDate ?? 'no-date'}`).join(', ')
          );
          if (blocking.length > 0) {
            setBlockingOrders(blocking.map((r: any) => ({
              id: Number(r.id),
              pickupCode: r.pickup_code ?? r.pickupCode ?? null,
              status: r.status ?? null,
              reservationDate: r.reservation_date ?? r.reservationDate ?? null,
              restaurantName: r.restaurant_name ?? r.restaurantName ?? null,
            })));
            setDeleteStep('blocked');
            setDeleteLoading(false);
            return;
          }
        } catch (preflightErr) {
          // Pre-flight failed (network blip, etc.) — fall through to the API call
          // so the backend has the final say. We don't want a stale pre-flight
          // result to wrongly block a user who has no active orders.
          console.log('[Delete account] Pre-flight failed; deferring to server:', preflightErr);
        }
      }
      await deleteAccountApi(payload);
      // ── Apple-specific cleanup ──────────────────────────────────────
      // When the deleted account was an Apple sign-in, attempt to clear
      // the in-app Apple credential cache so the next sign-in goes
      // through the FULL authorization flow again (and Apple re-asks
      // about sharing email/name).
      //
      // Reality check on iOS's privacy model: the Apple ID "trust"
      // relationship is tracked SYSTEM-WIDE, not per-app, so an app
      // can't unilaterally make iOS forget that the user previously
      // authorized us. `signOutAsync` is a no-op on iOS today (the
      // SDK exposes it for symmetry with other platforms).
      //
      // So the realistic outcome is:
      //   • The server has hard-deleted the user row (apple_sub, email,
      //     name all gone) — next sign-in CREATES a fresh account.
      //   • The user will NOT be re-prompted for email/name UNLESS
      //     they manually revoke this app in iOS Settings → Apple ID
      //     → Sign in with Apple. We surface a small note explaining
      //     this in the success popup below so the merchant knows.
      //
      // NOTE: we deliberately do NOT call any expo-apple-authentication method
      // here. `signOutAsync` is not part of the iOS SDK; the previous
      // `(AppleAuthentication as any).signOutAsync?.({})` was dead code, and on
      // SDK versions where a stub exists it could surface the system
      // "Sign in with Apple" sheet the instant the user confirmed deletion —
      // which is exactly the popup users reported. Server-side the account row
      // (apple_sub/email/name) is already hard-deleted; nothing client-side is
      // needed. We still show the iOS-Settings revoke note below.
      const wasApple = String((user as any)?.authProvider ?? '').toLowerCase() === 'apple';
      setShowDeleteModal(false);
      await signOut();
      queryClient.clear();
      triggerSplash(false);
      router.replace('/auth/sign-in' as never);
      if (wasApple) {
        // Show the iOS Settings note AFTER the navigation so the
        // success popup lands on the sign-in screen (clean exit).
        // settings.tsx uses RN's native Alert.alert for delete-flow
        // dialogs (see the existing call ~line 941), so we mirror that
        // here rather than reaching for the CustomAlert hook (which
        // isn't wired in this file).
        setTimeout(() => {
          Alert.alert(
            t('profile.appleCacheNoticeTitle', { defaultValue: 'Compte supprimé' }),
            t('profile.appleCacheNoticeBody', {
              defaultValue: "Pour réinitialiser complètement « Se connecter avec Apple » pour Barakeat, allez dans Réglages iOS › Apple ID › Mot de passe et sécurité › Apps utilisant Apple ID › Barakeat › Ne plus utiliser Apple ID.",
            }),
          );
        }, 800);
      }
    } catch (err: any) {
      // The shared apiClient interceptor (src/lib/api.ts) flattens axios's
      // `err.response.{status,data}` into `err.{status,data}` before rejecting,
      // so both shapes must be checked — without the `err?.data` fallback the
      // body's `error` code is always undefined, every 409 branch below fails
      // to match, and ACTIVE_ORDER / OWNER_NEEDS_TRANSFER_OR_DELETE_ORG /
      // OWNER_NO_ADMIN_NEEDS_DELETE_ORG all fell through to the generic
      // "Une erreur est survenue" instead of the tailored "blocked" /
      // transfer-picker / org-danger step. Same hazard the `err.status` line
      // already guards against.
      const status = err?.response?.status ?? err?.status;
      const data = err?.response?.data ?? err?.data ?? {};
      const code = data?.error;
      if (status === 409 && code === 'ACTIVE_ORDER') {
        // Prefer the server's blockingOrders payload (only present on the
        // updated backend). When the server didn't return one — old backend
        // still in production OR a build that pre-dates the field — fall
        // back to a fresh /my/reservations lookup and surface the
        // active-status rows ourselves, so the user always sees WHAT is
        // blocking instead of just the generic message.
        const serverList = Array.isArray(data?.blockingOrders) ? data.blockingOrders : [];
        if (serverList.length > 0) {
          setBlockingOrders(serverList);
        } else {
          try {
            const reservations = await fetchMyReservations();
            const list = (Array.isArray(reservations) ? reservations : [])
              .filter((r: any) => isPendingReservationActive(r))
              .map((r: any) => ({
                id: Number(r.id),
                pickupCode: r.pickup_code ?? r.pickupCode ?? null,
                status: r.status ?? null,
                reservationDate: r.reservation_date ?? r.reservationDate ?? null,
                restaurantName: r.restaurant_name ?? r.restaurantName ?? null,
              }));
            setBlockingOrders(list);
          } catch {
            setBlockingOrders([]);
          }
        }
        setDeleteStep('blocked');
      } else if (status === 409 && code === 'OWNER_NEEDS_TRANSFER_OR_DELETE_ORG') {
        setTransferCandidates(Array.isArray(data?.candidates) ? data.candidates : []);
        setTransferTo(null);
        setDeleteStep('transfer');
      } else if (status === 409 && code === 'OWNER_NO_ADMIN_NEEDS_DELETE_ORG') {
        setOrgDangerAck(false);
        setDeleteStep('org-danger');
      } else {
        setDeleteError(
          getErrorMessage(err)
            || t('profile.deleteAccountFailed', { defaultValue: "Échec de la suppression du compte. Réessayez." })
        );
      }
    } finally {
      setDeleteLoading(false);
    }
  }, [signOut, queryClient, triggerSplash, router, t]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteStep === 'first') {
      setDeleteStep('final');
      setDeleteError(null);
      return;
    }
    if (deleteStep === 'final') {
      void submitDelete({});
      return;
    }
    if (deleteStep === 'transfer') {
      if (transferTo == null) return;
      void submitDelete({ transferTo });
      return;
    }
    if (deleteStep === 'org-danger') {
      if (!orgDangerAck) return;
      void submitDelete({ deleteOrg: true });
      return;
    }
  }, [deleteStep, transferTo, orgDangerAck, submitDelete]);

  const handleSignOut = useCallback(async () => {
    await logout();
    await signOut();
    queryClient.clear(); // Clear all cached data so next login gets fresh data
    triggerSplash(false); // false = sign-out, no welcome modal
    router.replace('/auth/sign-in' as never);
  }, [signOut, router, triggerSplash, queryClient]);

  const bizRole = bizCtx.data?.role ?? 'member';
  const bizPerms = bizCtx.data?.permissions ?? {};
  const isAdminOrOwner = bizRole === 'owner' || bizRole === 'admin';
  const hasConfirmPickup = isAdminOrOwner || (bizPerms as any).confirm_pickup === 'write' || (bizPerms as any).confirm_pickup === true;

  const NOTIF_ITEMS: { key: keyof NotifPrefs; labelKey: string; descKey: string }[] = isBusiness
    ? [
        // New orders keep their own channel — the one notification a business
        // never wants folded into a quieter "tracking" bucket.
        ...(hasConfirmPickup ? [{ key: 'newOrders' as keyof NotifPrefs, labelKey: 'settings.newOrders', descKey: 'settings.newOrdersDesc' }] : []),
        // Grouped order-tracking: basket-picked-up + cancellations at the venue.
        { key: 'orderUpdates' as keyof NotifPrefs, labelKey: 'settings.orderUpdates', descKey: 'settings.orderUpdatesBizDesc' },
        // Business gets notified when a customer leaves a review.
        { key: 'reviews' as keyof NotifPrefs, labelKey: 'settings.reviews', descKey: 'settings.reviewsDesc' },
        // Business sees messages FROM customers.
        { key: 'messages' as keyof NotifPrefs, labelKey: 'settings.messagesFromCustomer', descKey: 'settings.messagesFromCustomerDesc' },
        // Same storage key as customers' "offers & news", but businesses only
        // ever receive Barakeat platform announcements (never offers/promos).
        { key: 'offersNews' as keyof NotifPrefs, labelKey: 'settings.businessAnnouncements', descKey: 'settings.businessAnnouncementsDesc' },
      ]
    : [
        // Grouped order-tracking: pickup confirmations + cancellations +
        // pickup reminders, all under one toggle.
        { key: 'orderUpdates', labelKey: 'settings.orderUpdates', descKey: 'settings.orderUpdatesDesc' },
        { key: 'messages', labelKey: 'settings.messagesFromMerchant', descKey: 'settings.messagesFromMerchantDesc' },
        { key: 'favoritesUpdates', labelKey: 'settings.favoritesUpdates', descKey: 'settings.favoritesUpdatesDesc' },
        { key: 'offersNews', labelKey: 'settings.offersNews', descKey: 'settings.offersNewsDesc' },
      ];

  const PERMISSION_ITEMS = [
    { labelKey: 'settings.camera', status: cameraStatus, icon: Camera, kind: 'camera' as const },
    { labelKey: 'settings.location', status: locationStatus, icon: MapPin, kind: 'location' as const },
    { labelKey: 'settings.photoLibrary', status: photoLibraryStatus, icon: ImageIcon, kind: 'photo' as const },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <StatusBar style="dark" />
      <View
        style={[
          styles.header,
          {
            paddingHorizontal: theme.spacing.xl,
            paddingVertical: theme.spacing.md,
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 48,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => {
            // Demo hand-off lands the user on /settings via router.push from
            // various entry points inside the business walkthrough; the
            // router-guards wrapper installs `canGoBack()` and swallows
            // back() when the navigator reports nothing to pop. That left
            // the user stranded on /settings with the back arrow doing
            // nothing visibly after the demo ended. Fallback to the
            // role-appropriate root so the back arrow is never a dead end.
            const r = router as any;
            const canGoBack = typeof r.canGoBack === 'function' ? r.canGoBack.call(r) : true;
            if (canGoBack) {
              router.back();
              return;
            }
            if (isBusiness) {
              router.replace('/(business)/dashboard' as never);
            } else {
              router.replace('/(tabs)/' as never);
            }
          }}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          accessibilityLabel={t('common.goBack', { defaultValue: 'Go back' })}
          accessibilityRole="button"
          style={{ position: 'absolute', left: theme.spacing.xl, top: theme.spacing.md }}
        >
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
          {t('settings.title')}
        </Text>
      </View>
      <ScrollView ref={settingsScrollRef} contentContainerStyle={{ padding: theme.spacing.xl }} showsVerticalScrollIndicator={false}>
        {/* User identity card. Avatar = up-to-two-letter initials drawn
            from the first and last words of the name (e.g.
            "Mohamed Ben Ali" → "MA", "Sami" → "S"). Falls back to the
            email prefix's first letter if name is unavailable. Brand
            palette: dark-green (#114b3c) backdrop with the lime accent
            (#e3ff5c) for the letters — replaces the previous
            tinted-primary chip that read as generic. */}
        {user && (
          <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl, padding: theme.spacing.lg, flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: '#e3ff5c', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 0.5 }}>
                {(() => {
                  const raw = (userName ?? '').trim();
                  if (raw) {
                    const parts = raw.split(/\s+/).filter(Boolean);
                    const first = parts[0]?.charAt(0) ?? '';
                    const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
                    const initials = (first + last).toUpperCase();
                    if (initials) return initials;
                  }
                  return (user.email ?? '?').charAt(0).toUpperCase();
                })()}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              {userName ? (
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {userName}
                </Text>
              ) : null}
              {/* Role + org + location, merged into the line that used to
                  show org name alone. Format:
                    org-admin / owner → "Propriétaire - {org}" (no location)
                    location-admin    → "Admin - {org} - {location}"
                    member            → "Membre - {org} - {location}"
                  Location segment omitted when the role is org-scoped
                  (owner / org-admin) or when the backend didn't return a
                  location name (legacy /organizations payload, race). */}
              {isBusiness && bizCtx.data?.role ? (() => {
                const orgLabel = (bizCtx.data?.organization_name ?? '').trim();
                const locLabel = (bizCtx.data?.location_name ?? '').trim();
                const role = bizCtx.data?.role;
                const hasLocation = !!bizCtx.data?.location_id;
                const isOrgScopedAdmin = (role === 'admin' || role === 'owner') && !hasLocation;
                const roleStr = role === 'owner'
                  ? t('business.profile.owner', { defaultValue: 'Propriétaire' })
                  : role === 'admin'
                    ? t('business.profile.admin', { defaultValue: 'Admin' })
                    : t('business.profile.member', { defaultValue: 'Membre' });
                const parts: string[] = [roleStr];
                if (orgLabel) parts.push(orgLabel);
                if (!isOrgScopedAdmin && locLabel) parts.push(locLabel);
                return (
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }} numberOfLines={2}>
                    {parts.join(' - ')}
                  </Text>
                );
              })() : bizName ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                  {bizName}
                </Text>
              ) : null}
              {user.email ? (
                <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 2 }}>
                  {user.email}
                </Text>
              ) : null}
            </View>
            {/* Edit name + gender (moved here from the read-only profile page) */}
            <TouchableOpacity
              onPress={() => setShowEditProfile(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={t('profile.editProfile', { defaultValue: 'Modifier le profil' })}
              accessibilityRole="button"
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center', marginLeft: 8 }}
            >
              <EditIcon8 size={16} tintColor={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}

        <EditProfileModal visible={showEditProfile} onClose={() => setShowEditProfile(false)} />

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
                {currentLangObj.native}
              </Text>
              <ChevronRight size={18} color={theme.colors.muted} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Notifications — push toggle + collapsed preferences list.
            The per-channel preference rows used to live in their own
            standalone card right below this section, which made the
            settings page feel packed. They're now folded INSIDE this
            same card as an expandable section that the user opens on
            demand by tapping a chevron row. Collapsed by default. */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('settings.notifications')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          {/* Push on/off — same behaviour as before. */}
          <View style={[{ padding: theme.spacing.lg, flexDirection: 'row', alignItems: 'center' }]}>
            <BellIcon size={20} color={theme.colors.textSecondary} />
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1, marginLeft: 12 }]}>{t('settings.pushNotifications')}</Text>
            <Switch value={notifications} onValueChange={async (val) => {
              setNotifications(val);
              void AsyncStorage.setItem(PUSH_ENABLED_KEY, String(val));
              if (val) {
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
                const { unregisterPushNotifications } = require('@/src/services/pushNotifications');
                void unregisterPushNotifications();
                // Collapse the preferences list when push is turned
                // off — the rows can't take effect anyway, and
                // leaving them visible reads as a UI bug.
                setNotifPrefsExpanded(false);
              }
            }} trackColor={{ false: theme.colors.divider, true: theme.colors.primary }} thumbColor={notifications ? '#fff' : (Platform.OS === 'android' ? theme.colors.surface : undefined)} ios_backgroundColor={theme.colors.divider} accessibilityLabel={t('settings.pushNotifications')} accessibilityRole="switch" />
          </View>

          {/* Expander row — opens the per-channel preference list
              below. Hidden when push is OFF (the rows are no-ops
              there). The icon flips between Down and Up based on
              expanded state for an unambiguous affordance. */}
          {notifications && (
            <>
              <TouchableOpacity
                onPress={() => setNotifPrefsExpanded((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: notifPrefsExpanded }}
                style={[{
                  padding: theme.spacing.lg,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.divider,
                }]}
              >
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1 }]}>
                  {t('settings.notificationPreferences')}
                </Text>
                {notifPrefsExpanded
                  ? <ChevronUp size={18} color={theme.colors.muted} />
                  : <ChevronDown size={18} color={theme.colors.muted} />}
              </TouchableOpacity>

              {/* Preference rows. Same content as before; only the
                  container changed (inline inside the notifications
                  card, gated on `notifPrefsExpanded`). */}
              {notifPrefsExpanded && NOTIF_ITEMS.map((item) => (
                <View
                  key={item.key}
                  style={[{
                    padding: theme.spacing.lg,
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderTopWidth: 1,
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
                    trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                    thumbColor={notifPrefs[item.key] ? '#fff' : (Platform.OS === 'android' ? theme.colors.surface : undefined)}
                    ios_backgroundColor={theme.colors.divider}
                    accessibilityLabel={t(item.labelKey)}
                    accessibilityRole="switch"
                  />
                </View>
              ))}
            </>
          )}
        </View>

        {/* Permissions */}
        <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
          {t('settings.permissions')}
        </Text>
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
          {PERMISSION_ITEMS.map((item, i) => {
            const IconComponent = item.icon;
            const isGranted = item.status === 'Granted';
            const isLimited = item.status === 'Limited';
            // "Limited" (iOS partial photo access) counts as a positive/active
            // state for styling, but shows its own label so it's not confused
            // with full access.
            const isPositive = isGranted || isLimited;
            const statusLabel = isGranted
              ? t('settings.granted')
              : isLimited
                ? t('settings.limited', { defaultValue: 'Limité' })
                : t('settings.notSet');
            return (
              <TouchableOpacity
                key={item.labelKey}
                style={[styles.menuItem, {
                  padding: theme.spacing.lg,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: theme.colors.divider,
                }]}
                onPress={() => handlePermissionPress(item.kind)}
                accessibilityLabel={`${t(item.labelKey)}: ${statusLabel}`}
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
                    backgroundColor: isPositive ? theme.colors.primary + '18' : theme.colors.muted + '18',
                    borderRadius: theme.radii.pill,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    marginRight: 6,
                  }]}>
                    <Text style={[{
                      color: isPositive ? theme.colors.primary : theme.colors.muted,
                      ...theme.typography.caption,
                      fontWeight: '600' as const,
                    }]}>
                      {statusLabel}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={theme.colors.muted} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Personal info — entirely HIDDEN for Google / Apple users.
            Email + password on an OAuth account are owned by the
            provider, so neither the section header nor the explanatory
            note adds value: the user has nothing actionable here.
            Local-auth users still see Change Email + Change Password. */}
        {(user?.authProvider !== 'google' && user?.authProvider !== 'apple') && (
          <>
            <Text style={[styles.sectionHeader, { color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.sm }]}>
              {t('profile.personalInfo')}
            </Text>
            <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm, marginBottom: theme.spacing.xl }]}>
              <TouchableOpacity
                style={[styles.menuItem, { padding: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
                onPress={() => router.push('/account/change-email-confirm' as never)}
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
                onPress={() => router.push('/account/change-password-confirm' as never)}
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
          </>
        )}

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

          {/* Mode démo — moved here from Account section per UX request.
              Disabled while a demo run is in progress so the user can't
              restart it from the final-step settings highlight (which would
              otherwise loop them back to step 0 of the walkthrough they
              just finished). The row stays visible + measurable so the
              walkthrough's halo still lands on it correctly; only the tap
              is suppressed and the colours dim to read as inactive. */}
          <TouchableOpacity
            ref={demoRowRef as any}
            onLayout={measureDemoRow}
            style={[styles.menuItem, { padding: theme.spacing.lg, opacity: demoSequencePending ? 0.5 : 1 }]}
            onPress={handleDemoRoleSwitch}
            disabled={demoSequencePending}
            accessibilityLabel={t('profile.demoMode')}
            accessibilityRole="button"
            accessibilityState={{ disabled: demoSequencePending }}
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

      {/* Language Modal — sophisticated rows with a monogram chip,
          the native name + romanized transliteration (where useful),
          and a Check on the selected row. A short subtitle under the
          title sets the tone without leaning on AI-ish copy. The
          selected row gets a left-edge accent stripe + brand-tinted
          fill so the chosen language is unmissable. */}
      <ModalCard
        visible={showLanguageModal}
        onClose={() => setShowLanguageModal(false)}
        title={t('profile.selectLanguage')}
        maxWidth={380}
      >
        {/* Subtitle / framing — kept short on purpose; the title
            already says what this is. */}
        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, lineHeight: 16, marginBottom: theme.spacing.lg, marginTop: -theme.spacing.xs }]}>
          {t('settings.languageSubtitle', { defaultValue: 'Le changement s’applique à toute l’application.' })}
        </Text>

        {LANGUAGES.map((lang) => {
          const isSelected = lang.code === currentLang;
          // The monogram chip flips its palette on the selected row:
          // brand-green on the live language to read as "active", the
          // soft tint on the others. Mirrors the identity-card avatar
          // language elsewhere in the app.
          const chipBg = isSelected ? '#114b3c' : (theme.colors.primary + '12');
          const chipFg = isSelected ? '#e3ff5c' : theme.colors.primary;
          return (
            <TouchableOpacity
              key={lang.code}
              onPress={() => handleLanguageChange(lang.code)}
              accessibilityLabel={lang.native}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              activeOpacity={0.85}
              style={[{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.radii.r12,
                marginBottom: theme.spacing.sm,
                backgroundColor: isSelected ? theme.colors.primary + '0F' : theme.colors.surface,
                borderWidth: 1,
                borderColor: isSelected ? theme.colors.primary + '60' : theme.colors.divider,
                overflow: 'hidden',
                gap: 12,
              }]}
            >
              {/* Left-edge accent stripe — only on selected; absolute
                  so it doesn't push the content sideways. The 4 px
                  width reads as a deliberate detail, not decoration. */}
              {isSelected ? (
                <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: theme.colors.primary }} />
              ) : null}

              {/* Monogram chip */}
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: chipBg,
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <Text style={{
                  color: chipFg,
                  fontSize: 13,
                  fontWeight: '700',
                  fontFamily: 'Poppins_700Bold',
                  letterSpacing: 0.5,
                }}>
                  {lang.monogram}
                </Text>
              </View>

              {/* Native name + (where present) romanized transliteration.
                  Direction-aware so the Arabic row anchors right
                  textAlign without flipping the whole layout. */}
              <View style={{ flex: 1 }}>
                <Text
                  style={[{
                    color: isSelected ? theme.colors.primary : theme.colors.textPrimary,
                    ...theme.typography.body,
                    fontWeight: isSelected ? ('700' as const) : ('600' as const),
                    fontFamily: isSelected ? 'Poppins_700Bold' : 'Poppins_600SemiBold',
                    textAlign: lang.dir === 'rtl' ? 'right' : 'left',
                    writingDirection: lang.dir,
                  }]}
                >
                  {lang.native}
                </Text>
                {lang.romanized ? (
                  <Text
                    style={[{
                      color: theme.colors.muted,
                      ...theme.typography.caption,
                      marginTop: 1,
                      fontStyle: 'italic',
                      textAlign: lang.dir === 'rtl' ? 'right' : 'left',
                    }]}
                  >
                    {lang.romanized}
                  </Text>
                ) : null}
              </View>

              {/* Selected indicator — Check icon instead of a tiny dot,
                  which read as a typo more than a signal. */}
              {isSelected ? (
                <View style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: theme.colors.primary,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                  <Check size={14} color="#fff" strokeWidth={3} />
                </View>
              ) : null}
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
              <TouchableOpacity onPress={closeSheet} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
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
              <TouchableOpacity onPress={closeSheet} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
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

      {/* Delete Account Confirmation Modal — state machine across multiple steps */}
      <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={closeDeleteModal}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <PaperSurface radius={20} style={{ padding: 24, width: '100%', maxWidth: 360, alignItems: 'stretch' }}>
            {/* Icon — red tint on the org-danger step for emphasis */}
            <View style={{
              backgroundColor: deleteStep === 'org-danger' ? (theme.colors.error + '20') : theme.colors.surfaceMuted,
              width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16, alignSelf: 'center',
            }}>
              <AlertTriangle size={26} color={deleteStep === 'org-danger' ? theme.colors.error : theme.colors.textSecondary} />
            </View>

            {/* Title */}
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {deleteStep === 'first' && t('profile.deleteAccount', { defaultValue: 'Supprimer le compte' })}
              {deleteStep === 'final' && t('profile.deleteAccountFinalTitle', { defaultValue: 'Confirmation finale' })}
              {deleteStep === 'blocked' && t('profile.deleteBlockedTitle', { defaultValue: 'Suppression impossible' })}
              {deleteStep === 'transfer' && t('profile.deleteOrgOwnerTransferTitle', { defaultValue: 'Transférer la propriété' })}
              {deleteStep === 'org-danger' && t('profile.deleteOrgOwnerDangerTitle', { defaultValue: 'Cela supprimera votre organisation' })}
            </Text>

            {/* Body — role-aware on the first two steps */}
            {deleteStep === 'first' && (
              <View>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', lineHeight: 22, marginBottom: 12 }}>
                  {t('profile.deleteAccountConfirm', { defaultValue: 'Cette action est irréversible. Toutes vos données seront supprimées.' })}
                </Text>
                {!isBusiness && (
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 8 }}>
                    • {t('profile.deleteForfeitCredits', { defaultValue: 'Vos crédits Barakeat seront perdus.' })}
                  </Text>
                )}
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
                  • {isBusiness
                    ? t('profile.deleteNamePersistsBusiness', { defaultValue: 'Votre nom restera visible sur les commandes que vous avez confirmées ou annulées pendant 30 jours.' })
                    : t('profile.deleteNamePersistsBuyer', { defaultValue: 'Votre nom restera visible sur vos commandes pendant 30 jours, puis sera anonymisé.' })}
                </Text>
              </View>
            )}

            {deleteStep === 'final' && (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', lineHeight: 22, marginBottom: 20 }}>
                {t('profile.deleteAccountFinalDesc', { defaultValue: 'Êtes-vous absolument sûr ? Cette action ne peut pas être annulée.' })}
              </Text>
            )}

            {deleteStep === 'blocked' && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', lineHeight: 22, marginBottom: blockingOrders.length > 0 ? 14 : 0 }}>
                  {t('profile.deleteBlockedActiveOrder', { defaultValue: 'Vous ne pouvez pas supprimer votre compte tant qu’une commande est en cours.' })}
                </Text>
                {blockingOrders.length > 0 && (
                  <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, padding: 12, gap: 8 }}>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '600' }}>
                      {t('profile.deleteBlockedListTitle', { defaultValue: 'Commandes bloquantes ({{count}})', count: blockingOrders.length })}
                    </Text>
                    {blockingOrders.map((o) => (
                      <View key={o.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                        <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontFamily: 'Poppins_600SemiBold', minWidth: 70 }}>
                          {o.pickupCode ? String(o.pickupCode).toUpperCase() : `#${o.id}`}
                        </Text>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }} numberOfLines={2}>
                          {o.restaurantName ?? t('common.unknown', { defaultValue: 'Inconnu' })}
                        </Text>
                      </View>
                    ))}
                    <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 4, lineHeight: 16 }}>
                      {t('profile.deleteBlockedListHint', { defaultValue: 'Annulez ces commandes depuis l’onglet « Mes commandes » puis réessayez.' })}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {deleteStep === 'transfer' && (
              <View>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 14 }}>
                  {t('profile.deleteOrgOwnerTransferHelp', { defaultValue: "Si vous ne voyez pas la personne souhaitée, allez dans Gestion d'équipe pour la promouvoir admin d'organisation avant de continuer." })}
                </Text>
                <ScrollView style={{ maxHeight: 220, marginBottom: 14 }}>
                  {transferCandidates.map((c) => {
                    const selected = transferTo === c.memberId;
                    return (
                      <TouchableOpacity
                        key={c.memberId}
                        onPress={() => setTransferTo(c.memberId)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 10,
                          paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12,
                          backgroundColor: selected ? (theme.colors.primary + '14') : theme.colors.bg,
                          borderWidth: 1, borderColor: selected ? theme.colors.primary : theme.colors.divider,
                          marginBottom: 8,
                        }}
                      >
                        <View style={{
                          width: 18, height: 18, borderRadius: 9, borderWidth: 2,
                          borderColor: selected ? theme.colors.primary : theme.colors.divider,
                          justifyContent: 'center', alignItems: 'center',
                        }}>
                          {selected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary }} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }} numberOfLines={1}>
                            {c.name || c.email || `#${c.memberId}`}
                          </Text>
                          {c.email && c.name && (
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }} numberOfLines={1}>{c.email}</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {deleteStep === 'org-danger' && (
              <View>
                <View style={{
                  backgroundColor: theme.colors.error + '14', borderColor: theme.colors.error + '40', borderWidth: 1,
                  borderRadius: 12, padding: 12, marginBottom: 14,
                }}>
                  <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, lineHeight: 20, fontWeight: '600' }}>
                    {t('profile.deleteOrgOwnerDangerBody', { defaultValue: "Vous êtes le seul admin. Supprimer votre compte supprimera également l'organisation et tous ses membres. Cette action est irréversible." })}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setOrgDangerAck((v) => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14, paddingVertical: 6 }}
                >
                  <View style={{
                    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                    borderColor: orgDangerAck ? theme.colors.error : theme.colors.divider,
                    backgroundColor: orgDangerAck ? theme.colors.error : 'transparent',
                    justifyContent: 'center', alignItems: 'center',
                  }}>
                    {orgDangerAck && <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>✓</Text>}
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                    {t('profile.deleteOrgOwnerDangerAck', { defaultValue: "J'ai bien compris" })}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Inline error (network / 500) */}
            {deleteError && (
              <Text style={{ color: theme.colors.error, ...theme.typography.caption, textAlign: 'center', marginBottom: 12 }}>
                {deleteError}
              </Text>
            )}

            {/* Buttons */}
            {deleteStep === 'blocked' ? (
              <TouchableOpacity
                onPress={closeDeleteModal}
                style={{ backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#e3ff5c', ...theme.typography.body, fontWeight: '600' }}>
                  {t('common.ok', { defaultValue: 'OK' })}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                <TouchableOpacity
                  onPress={closeDeleteModal}
                  disabled={deleteLoading}
                  style={{ flex: 1, backgroundColor: theme.colors.bg, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
                >
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>{t('common.cancel', { defaultValue: 'Annuler' })}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDeleteConfirm}
                  disabled={
                    deleteLoading
                    || (deleteStep === 'transfer' && transferTo == null)
                    || (deleteStep === 'org-danger' && !orgDangerAck)
                  }
                  style={{
                    flex: 1, backgroundColor: theme.colors.error, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
                    opacity: (
                      deleteLoading
                      || (deleteStep === 'transfer' && transferTo == null)
                      || (deleteStep === 'org-danger' && !orgDangerAck)
                    ) ? 0.55 : 1,
                  }}
                >
                  <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                    {deleteLoading
                      ? t('common.loading')
                      : deleteStep === 'first'
                        ? t('common.delete', { defaultValue: 'Supprimer' })
                        : t('profile.deleteAccountConfirmButton', { defaultValue: 'Confirmer' })}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
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
              placeholder={t('profile.newEmailPlaceholder', { defaultValue: 'vous@exemple.com' })}
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
