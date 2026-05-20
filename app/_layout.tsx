import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "@/src/theme/ThemeProvider";
import "@/src/i18n";
import { StyleSheet, View, ActivityIndicator, Text, Modal, ScrollView, Dimensions, TouchableOpacity, Animated, Platform, Image } from "react-native";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { useAuthStore } from "@/src/stores/authStore";
import { useTranslation } from 'react-i18next';
import { Hand, Sparkles, Award } from "lucide-react-native";
import { SplashAnimation } from "@/src/components/SplashAnimation";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { useFavoritesStore } from "@/src/stores/favoritesStore";
import { useOrdersStore } from "@/src/stores/ordersStore";
import { useAddressStore } from "@/src/stores/addressStore";
import { useSplashStore } from "@/src/stores/splashStore";
import { useCelebrationStore } from "@/src/stores/celebrationStore";
import { useWalkthroughStore } from "@/src/stores/walkthroughStore";
import { fetchGamificationStats } from "@/src/services/gamification";
import { apiClient } from "@/src/lib/api";
import { FeatureFlags } from "@/src/lib/featureFlags";
import { Search, ShoppingBag, Trophy, LayoutDashboard, Package, BarChart3, MapPin } from "lucide-react-native";
import { fetchMyContext } from "@/src/services/teams";
import { InAppNotification } from "@/src/components/InAppNotification";
import { useNotificationStore } from "@/src/stores/notificationStore";
// import { registerForPushNotifications } from "@/src/services/pushNotifications";
import * as Notifications from "expo-notifications";
import * as NavigationBar from "expo-navigation-bar";
import Constants from "expo-constants";

const isExpoGo = Constants.appOwnership === 'expo';
import { initSentry } from "@/src/lib/sentry";
import { OfflineBanner } from "@/src/components/OfflineBanner";
import { CustomAlertProvider } from "@/src/components/CustomAlert";

initSentry();
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="auth/sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="auth/sign-up" options={{ headerShown: false }} />
      <Stack.Screen name="auth/forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="admin/sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="(admin)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="impact" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(business)" options={{ headerShown: false }} />
      <Stack.Screen name="restaurant/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="business-detail/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="basket/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="reserve" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="review" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/create-basket" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="business/availability" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/menu-items" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/scan-qr" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="business/team" options={{ headerShown: false }} />
      <Stack.Screen name="business/member-detail" options={{ headerShown: false }} />
      <Stack.Screen name="business/add-location" options={{ headerShown: false }} />
      <Stack.Screen name="business/edit-location" options={{ headerShown: false }} />
      <Stack.Screen name="business/add-member" options={{ headerShown: false }} />
      <Stack.Screen name="messages" options={{ headerShown: false }} />
      <Stack.Screen name="message/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="wallet" options={{ headerShown: false }} />
      <Stack.Screen name="address-picker" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="legal" options={{ headerShown: false }} />
      <Stack.Screen name="faq" options={{ headerShown: false }} />
      <Stack.Screen name="stat-detail" options={{ headerShown: false }} />
      <Stack.Screen name="claim" options={{ headerShown: false }} />
      <Stack.Screen name="cancel-reservation" options={{ headerShown: false }} />
      <Stack.Screen name="map-view" options={{ headerShown: false }} />
      <Stack.Screen name="leaderboard" options={{ headerShown: false }} />
    </Stack>
  );
}

/** Inner component that can safely use useQuery (inside QueryClientProvider) */
function RootLayoutInner() {
  const { t } = useTranslation();
  const WELCOME_WIDTH = Dimensions.get('window').width;
  const [initialSplash, setInitialSplash] = useState(true);
  const loginSplash = useSplashStore((s) => s.showSplash);
  const wasLoginSplash = useSplashStore((s) => s.wasLoginSplash);
  const dismissLoginSplash = useSplashStore((s) => s.dismissSplash);
  const showSplash = initialSplash || loginSplash;

  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const signOut = useAuthStore((s) => s.signOut);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [welcomeCarouselPage, setWelcomeCarouselPage] = useState(0);

  // Badge popup state
  const [badgePopup, setBadgePopup] = useState<{ icon: string; nameKey: string; descKey: string } | null>(null);
  const badgeShownRef = useRef<Set<string>>(new Set());
  const badgeScale = useRef(new Animated.Value(0)).current;

  // Tutorial state
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialPage, setTutorialPage] = useState(0);
  const tutorialCheckedRef = useRef(false);
  // Mirrors `tutorialCheckedRef` as state so other effects (notably the
  // in-app notification poll) can gate on it. Without this, notifications
  // fire before the async onboarding probe resolves, racing the tutorial
  // carousel onto the screen.
  const [tutorialChecked, setTutorialChecked] = useState(false);

  const isRestoringSession = useAuthStore((s) => s.isRestoringSession);
  const hydrateFavorites = useFavoritesStore((s) => s.hydrate);
  const hydrateAddresses = useAddressStore((s) => s.hydrate);
  const hydrateOrders = useOrdersStore((s) => s.hydrate);

  const router = useRouter();
  const segments = useSegments();
  const qc = useQueryClient();

  useEffect(() => {
    void hydrateFavorites();
    void hydrateAddresses();
    void hydrateOrders();
  }, [hydrateFavorites, hydrateAddresses, hydrateOrders]);

  useEffect(() => {
    if (!isRestoringSession) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isRestoringSession]);

  // ── Central role-based routing guard ──────────────────────────────────────
  useEffect(() => {
    if (isRestoringSession) return;

    const inBusinessFlow = segments[0] === '(business)';
    const inTabsFlow = segments[0] === '(tabs)';
    const inAdminFlow = segments[0] === '(admin)';
    const inAuth = segments[0] === 'auth' || segments[0] === 'admin';
    const inOnboarding = segments[0] === 'onboarding';

    // Prototype mode: block ALL access to the app
    if (FeatureFlags.IS_PROTOTYPE) {
      if (isAuthenticated) {
        void signOut();
      }
      // Only allow onboarding and auth screens (for viewing, not submitting)
      if (inBusinessFlow || inTabsFlow) {
        router.replace('/onboarding' as never);
      }
      return;
    }

    if (!isAuthenticated) {
      if (inBusinessFlow || inTabsFlow) {
        router.replace('/onboarding' as never);
      }
      return;
    }

    const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
    const isAdmin = user?.role === 'admin';

    if (isAdmin && !inAdminFlow && !inAuth && !inOnboarding) {
      console.log('[RootLayout] Routing admin user to (admin)/users');
      router.replace('/(admin)/users' as never);
    } else if (isBiz && !inBusinessFlow && !inAuth && !inOnboarding) {
      console.log('[RootLayout] Routing business user to (business)/dashboard');
      router.replace('/(business)/dashboard' as never);
    } else if (!isBiz && !isAdmin && !inTabsFlow && !inAuth && !inOnboarding) {
      console.log('[RootLayout] Routing customer user to (tabs)');
      router.replace('/(tabs)' as never);
    }
  }, [isRestoringSession, isAuthenticated, user?.role]);

  // Check favorite notifications on app open (feature-flagged)
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession) return;
    const { FeatureFlags } = require('@/src/lib/featureFlags');
    if (!FeatureFlags.ENABLE_FAVORITE_NOTIFICATIONS) return;
    const favStore = require('@/src/stores/favoritesStore').useFavoritesStore.getState();
    const ids = favStore.favoriteBasketIds ?? [];
    if (ids.length > 0) {
      const { checkFavoriteNotifications } = require('@/src/services/notifications');
      void checkFavoriteNotifications(ids);
    }
  }, [isAuthenticated, isRestoringSession]);

  // Check for newly unlocked badges
  const gamQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    enabled: isAuthenticated && !isRestoringSession,
    staleTime: 60_000,
  });

  const splashDone = useSplashStore((s) => s.splashDone);
  const celebrationPending = useCelebrationStore((s) => s.pending);
  useEffect(() => {
    if (!splashDone) return; // wait for splash animation to finish
    if (showWelcomeModal) return; // don't overlap with welcome popup
    if (celebrationPending) return; // don't overlap with post-reservation celebration
    const gData = gamQuery.data as any;
    if (!gData?.newBadges?.length || !gData?.badges) return;
    for (const newBadgeId of gData.newBadges) {
      if (badgeShownRef.current.has(newBadgeId)) continue;
      badgeShownRef.current.add(newBadgeId);
      const badge = gData.badges.find((b: any) => b.id === newBadgeId);
      if (badge) {
        // Delay badge popup slightly to avoid modal collision
        setTimeout(() => {
          setBadgePopup({ icon: badge.icon, nameKey: badge.nameKey, descKey: badge.descKey });
          badgeScale.setValue(0);
          Animated.spring(badgeScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
          setTimeout(() => setBadgePopup(null), 4000);
        }, 500);
        break;
      }
    }
  }, [gamQuery.data, splashDone, showWelcomeModal, celebrationPending]);

  // Track partner's no-location state so the final tutorial slide knows to
  // show the "add your first location" CTA. Refresh on every onboarding check.
  const [partnerHasNoLocation, setPartnerHasNoLocation] = useState(false);

  // Check if user needs the post-login tutorial.
  //
  // Trigger: server-side `onboarding_completed` flag is false AND the device
  // hasn't already seen the interactive walkthrough. The previous condition
  // also fired whenever a partner had zero locations, but that meant the
  // tutorial + walkthrough re-launched on EVERY reload until they added a
  // location — extremely annoying. The "no location" case is now handled
  // INSIDE the walkthrough itself (via a single dedicated step), not as a
  // re-trigger condition out here.
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession || tutorialCheckedRef.current) return;
    tutorialCheckedRef.current = true;
    (async () => {
      let onboardingCompleted = false;
      try {
        const res = await apiClient.get('/api/auth/onboarding');
        onboardingCompleted = !!res.data?.onboardingCompleted;
      } catch {
        // Silently fail — don't block the app
      }
      // For partners, still check no-location status so the tutorial CAROUSEL
      // can include the "add your first location" slide on first onboarding —
      // but this no longer forces re-display on subsequent reloads.
      const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
      if (isBiz) {
        try {
          const ctx = await fetchMyContext();
          const locIds = (ctx as any)?.location_ids;
          setPartnerHasNoLocation(!Array.isArray(locIds) || locIds.length === 0);
        } catch {
          // Treat fetch failures as "we don't know" — don't force the tutorial.
        }
      }
      const hasCompleted = useWalkthroughStore.getState().hasCompletedWalkthrough;
      if (!onboardingCompleted && !hasCompleted) {
        setShowTutorial(true);
      }
      // Resolve the gate regardless of whether the tutorial shows — downstream
      // popup effects depend on knowing "the onboarding probe has resolved",
      // not on the tutorial actually appearing.
      setTutorialChecked(true);
    })();
  }, [isAuthenticated, isRestoringSession, user?.role, (user as any)?.type]);

  // Register for push notifications (disabled for Expo Go compatibility)
  // useEffect(() => {
  //   if (!isAuthenticated || isRestoringSession) return;
  //   void registerForPushNotifications();
  // }, [isAuthenticated, isRestoringSession]);

  // In-app notification popups — poll for new notifications and show centered popup
  const pushPopups = useNotificationStore((s) => s.pushPopups);
  const storeHydrated = useNotificationStore((s) => s.hydrated);
  const storeUserId = useNotificationStore((s) => s.currentUserId);
  const hydrateNotifForUser = useNotificationStore((s) => s.hydrateForUser);
  const resetNotifForLogout = useNotificationStore((s) => s.resetForLogout);

  // Scope the popup state to the current user. Each member tracks their own
  // "already popped" IDs, so one member consuming popups doesn't hide them
  // from another member on another device.
  useEffect(() => {
    if (isRestoringSession) return;
    if (isAuthenticated && user?.id) {
      if (storeUserId !== user.id) {
        void hydrateNotifForUser(String(user.id));
      }
    } else if (storeUserId) {
      resetNotifForLogout();
    }
  }, [isAuthenticated, isRestoringSession, user?.id, storeUserId, hydrateNotifForUser, resetNotifForLogout]);

  useEffect(() => {
    if (!isAuthenticated || isRestoringSession || !storeHydrated) return;
    // Sequencing gate: never fire notification popups while the splash is
    // still on screen, while we're still probing the onboarding flag, while
    // the tutorial carousel or welcome modal is up, or while the interactive
    // walkthrough is running. This keeps the launch sequence to ONE thing on
    // screen at a time — previously the first poll fired before splash had
    // even finished, so notification toasts collided with the splash/tutorial.
    if (!splashDone) return;
    if (!tutorialChecked) return;
    if (showTutorial || showWelcomeModal) return;
    if (useWalkthroughStore.getState().step !== null) return;
    // Guard: only poll when the hydrated store actually belongs to the signed-in user.
    // Prevents a just-switched user from polling with the previous user's lastSeenNotifId.
    if (user?.id && storeUserId !== String(user.id)) return;
    let active = true;
    const poll = async () => {
      try {
        // Re-check ownership on each tick — hydrateForUser may have started swapping.
        if (user?.id && useNotificationStore.getState().currentUserId !== String(user.id)) return;
        const { fetchNotifications } = require('@/src/services/notifications');
        const notifs = await fetchNotifications();
        if (!active || notifs.length === 0) return;
        const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
        const currentLast = useNotificationStore.getState().lastSeenNotifId;

        // Candidate popups: not yet seen (id > lastSeen) and not already read on the server
        const newOnes = notifs.filter((n: any) => n.id > currentLast && !n.is_read);
        if (newOnes.length > 0) {
          const filtered = newOnes.filter((n: any) => {
            const t = n.type ?? '';
            if (isBiz) {
              // Business: skip pickup_confirmed (they confirmed it themselves) and order_confirmed (for buyers)
              return !t.includes('pickup_confirmed') && !t.includes('order_confirmed');
            }
            // Customer: skip order_confirmed + new_reservation (already shown on reservation success screen)
            return !t.includes('order_confirmed') && !t.includes('new_reservation');
          });
          if (filtered.length > 0) {
            // Show the 3 newest role-appropriate notifications as a popup carousel.
            // pushPopups is idempotent (it skips already-shown IDs), so repeated polls
            // during the same session won't double-show the same notif.
            const toShow = filtered.sort((a: any, b: any) => b.id - a.id).slice(0, 3);
            pushPopups(toShow);
            // NB: we deliberately do NOT markRead here nor advance lastSeenNotifId.
            // Both happen in the store's acknowledgePopup(), which InAppNotification
            // calls when the user actually dismisses the popup on screen. That way
            // a popup that never gets presented (e.g. app backgrounded) stays on the
            // queue for next foreground open.
          }
        }
      } catch {}
    };
    // Delay the first poll 1.5s so badge / streak / review effects (also
    // splashDone-gated) have a clean turn to fire first. Then poll every 15s.
    const initialTimer = setTimeout(poll, 1500);
    const interval = setInterval(poll, 15000);
    return () => { active = false; clearTimeout(initialTimer); clearInterval(interval); };
  }, [isAuthenticated, isRestoringSession, storeHydrated, user?.id, storeUserId, pushPopups, splashDone, tutorialChecked, showTutorial, showWelcomeModal]);

  // Also listen for push notifications if available
  // SDK 53+ removed Android push notification support from Expo Go
  useEffect(() => {
    if (isExpoGo && Platform.OS === 'android') return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const { title, body, data } = notification.request.content;
      pushPopups([{
        id: Date.now(),
        user_id: 0,
        title: title ?? '',
        message: body ?? '',
        type: (data?.type as string) ?? '',
        is_read: false,
        created_at: new Date().toISOString(),
      }]);
    });
    return () => subscription.remove();
  }, [pushPopups]);

  const startWalkthrough = useWalkthroughStore((s) => s.startWalkthrough);

  const dismissTutorial = async () => {
    setShowTutorial(false);
    setTutorialPage(0);
    try {
      await apiClient.put('/api/auth/onboarding');
      qc.invalidateQueries({ queryKey: ['gamification-stats'] });
    } catch {}
    // Only start the interactive walkthrough if the user hasn't already
    // completed (or skipped) it. Otherwise dismissing the tutorial carousel
    // would re-launch the cutout tour on every onboarding refresh.
    const hasCompleted = useWalkthroughStore.getState().hasCompletedWalkthrough;
    if (!hasCompleted) {
      setTimeout(() => startWalkthrough(), 500);
    }
  };

  const isBusiness = user?.role === 'business';

  const customerSlides = [
    { icon: <Search size={36} color="#e3ff5c" />, titleKey: 'tutorial.customer.discoverTitle', descKey: 'tutorial.customer.discoverDesc' },
    { icon: <ShoppingBag size={36} color="#e3ff5c" />, titleKey: 'tutorial.customer.reserveTitle', descKey: 'tutorial.customer.reserveDesc' },
    { icon: <Package size={36} color="#e3ff5c" />, titleKey: 'tutorial.customer.pickupTitle', descKey: 'tutorial.customer.pickupDesc' },
    { icon: <Trophy size={36} color="#e3ff5c" />, titleKey: 'tutorial.customer.rewardsTitle', descKey: 'tutorial.customer.rewardsDesc' },
  ];

  const businessSlides = [
    { icon: <LayoutDashboard size={36} color="#e3ff5c" />, titleKey: 'tutorial.business.dashboardTitle', descKey: 'tutorial.business.dashboardDesc' },
    { icon: <Package size={36} color="#e3ff5c" />, titleKey: 'tutorial.business.basketsTitle', descKey: 'tutorial.business.basketsDesc' },
    { icon: <ShoppingBag size={36} color="#e3ff5c" />, titleKey: 'tutorial.business.ordersTitle', descKey: 'tutorial.business.ordersDesc' },
    { icon: <BarChart3 size={36} color="#e3ff5c" />, titleKey: 'tutorial.business.performanceTitle', descKey: 'tutorial.business.performanceDesc' },
  ];

  // Append a partner-specific "add your first location" final slide when
  // the org has no locations yet. The CTA below uses partnerHasNoLocation to
  // route to /business/add-location instead of just dismissing.
  const businessSlidesWithLocation = partnerHasNoLocation
    ? [
        ...businessSlides,
        {
          icon: <MapPin size={36} color="#e3ff5c" />,
          titleKey: 'business.noLocation.tutorialTitle',
          descKey: 'business.noLocation.tutorialDesc',
        },
      ]
    : businessSlides;

  const tutorialSlides = isBusiness ? businessSlidesWithLocation : customerSlides;

  return (
    <GestureHandlerRootView style={styles.container}>
      <ErrorBoundary>
      <InAppNotification />
      <RootLayoutNav />
      {showSplash && (
        <SplashAnimation onFinish={() => {
          const wasLogin = wasLoginSplash;
          setInitialSplash(false);
          dismissLoginSplash();
          useSplashStore.getState().markSplashDone();
          if (wasLogin) {
            setShowWelcomeModal(true);
            setTimeout(() => setShowWelcomeModal(false), 5000);
          }
        }} />
      )}
      {showWelcomeModal && user?.role !== 'business' && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowWelcomeModal(false)}>
          <TouchableOpacity style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }} activeOpacity={1} onPress={() => setShowWelcomeModal(false)}>
            <View style={{
              backgroundColor: '#114b3c',
              borderRadius: 28,
              width: WELCOME_WIDTH - 48,
              maxHeight: 400,
              overflow: 'hidden',
            }} onStartShouldSetResponder={() => true}>
              {/* Close button */}
              <TouchableOpacity
                onPress={() => setShowWelcomeModal(false)}
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  zIndex: 10,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  borderRadius: 14,
                  width: 28,
                  height: 28,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>✕</Text>
              </TouchableOpacity>

              {/* Single welcome page with gendered basket holder image */}
              <View style={{ paddingTop: 40, paddingBottom: 30, paddingHorizontal: 30, alignItems: 'center' }}>
                <Image
                  source={(user as any)?.gender === 'female'
                    ? require('@/assets/images/woman_holding_basket-removebg-preview.png')
                    : require('@/assets/images/man_holding_basket-removebg-preview.png')}
                  style={{ width: 90, height: 120, marginBottom: 12 }}
                  resizeMode="contain"
                />
                <Hand size={32} color="rgba(255,255,255,0.9)" />
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 12 }}>
                  {t('home.welcomePopup.back')}
                </Text>
                <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginTop: 8, textAlign: 'center' }}>
                  {user?.name ?? 'there'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
      {/* Post-login tutorial */}
      {showTutorial && (
        <Modal visible transparent animationType="fade" onRequestClose={dismissTutorial}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <View style={{
              backgroundColor: '#114b3c',
              borderRadius: 28,
              width: WELCOME_WIDTH - 48,
              overflow: 'hidden',
            }}>
              {/* Skip button */}
              <TouchableOpacity
                onPress={dismissTutorial}
                style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Poppins_500Medium' }}>
                  {t('common.skip')}
                </Text>
              </TouchableOpacity>

              {/* Step indicator */}
              <View style={{ paddingTop: 16, paddingHorizontal: 24 }}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: 'Poppins_500Medium' }}>
                  {tutorialPage + 1}/{tutorialSlides.length}
                </Text>
              </View>

              {/* Carousel */}
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onMomentumScrollEnd={(e) => {
                  const page = Math.round(e.nativeEvent.contentOffset.x / (WELCOME_WIDTH - 48));
                  setTutorialPage(page);
                }}
              >
                {tutorialSlides.map((slide, idx) => (
                  <View key={idx} style={{ width: WELCOME_WIDTH - 48, paddingVertical: 40, paddingHorizontal: 30, alignItems: 'center' }}>
                    <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(227,255,92,0.12)', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
                      {slide.icon}
                    </View>
                    <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
                      {t(slide.titleKey)}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 20 }}>
                      {t(slide.descKey)}
                    </Text>
                  </View>
                ))}
              </ScrollView>

              {/* Dots + button */}
              <View style={{ paddingBottom: 24, paddingHorizontal: 24 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 16 }}>
                  {tutorialSlides.map((_, i) => (
                    <View
                      key={i}
                      style={{
                        width: tutorialPage === i ? 20 : 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: tutorialPage === i ? '#e3ff5c' : 'rgba(255,255,255,0.3)',
                        marginHorizontal: 3,
                      }}
                    />
                  ))}
                </View>
                {tutorialPage === tutorialSlides.length - 1 && (
                  <TouchableOpacity
                    onPress={async () => {
                      // If we're on the partner "add your first location" slide,
                      // dismiss the tutorial AND route to the add-location form.
                      const onAddLocSlide = isBusiness && partnerHasNoLocation;
                      await dismissTutorial();
                      if (onAddLocSlide) {
                        setTimeout(() => router.push('/business/add-location' as never), 300);
                      }
                    }}
                    style={{
                      backgroundColor: '#e3ff5c',
                      borderRadius: 14,
                      paddingVertical: 14,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#114b3c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                      {(isBusiness && partnerHasNoLocation)
                        ? t('business.noLocation.cta')
                        : t('tutorial.getStarted')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}
      {/* Badge unlocked popup */}
      {badgePopup && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setBadgePopup(null)}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
            activeOpacity={1}
            onPress={() => setBadgePopup(null)}
          >
            <Animated.View
              style={{
                backgroundColor: '#114b3c',
                borderRadius: 28,
                padding: 32,
                alignItems: 'center',
                width: WELCOME_WIDTH - 80,
                transform: [{ scale: badgeScale }],
              }}
              onStartShouldSetResponder={() => true}
            >
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(227,255,92,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Award size={36} color="#e3ff5c" />
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: 'Poppins_500Medium', marginBottom: 4 }}>
                {t('badges.newBadge', { defaultValue: 'New Badge Unlocked!' })}
              </Text>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 8 }}>
                {t(`badges.${badgePopup.nameKey}`, { defaultValue: badgePopup.nameKey })}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
                {t(`badges.${badgePopup.descKey}`, { defaultValue: badgePopup.descKey })}
              </Text>
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}
      {/* Prototype mode: full-screen blocking overlay if user somehow reaches protected screens */}
      {FeatureFlags.IS_PROTOTYPE && isAuthenticated && (
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#fffff8', zIndex: 99999, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Image source={require('@/assets/images/barakeat_paper_bag.png')} style={{ width: 100, height: 100, marginBottom: 24 }} resizeMode="contain" />
          <Text style={{ color: '#114b3c', fontSize: 24, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 12 }}>
            Barakeat.
          </Text>
          <Text style={{ color: '#114b3c90', fontSize: 15, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 32, paddingHorizontal: 20 }}>
            {t('auth.prototypeClosed', { defaultValue: 'Nous pr\u00e9parons le lancement officiel de notre application. L\'acc\u00e8s sera bient\u00f4t disponible. Merci pour votre patience !' })}
          </Text>
          <TouchableOpacity
            onPress={() => { void signOut(); router.replace('/onboarding' as never); }}
            style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14 }}
          >
            <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              {t('common.ok', { defaultValue: 'OK' })}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const isRestoringSession = useAuthStore((s) => s.isRestoringSession);
  const restoreSession = useAuthStore((s) => s.restoreSession);

  // Must run here (not in RootLayoutInner) to avoid deadlock:
  // RootLayoutInner only renders after isRestoringSession becomes false
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // ── Android navigation bar: hide globally on app open ─────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    (async () => {
      try {
        await NavigationBar.setVisibilityAsync('hidden');
        await NavigationBar.setBehaviorAsync('overlay-swipe');
      } catch (e) {
        console.warn('[RootLayout] Failed to hide Android navigation bar:', e);
      }
    })();
  }, []);

  // Enforce Poppins globally on every <Text>. The old defaultProps approach
  // only set Regular (400), so any Text with fontWeight: '600' / '700' fell
  // back to Roboto on Android because RN needs BOTH fontFamily AND fontWeight
  // to match a loaded font. We wrap Text.render so the correct Poppins family
  // (Regular / Medium / SemiBold / Bold) is injected based on the resolved
  // fontWeight whenever the caller didn't set fontFamily themselves. Any
  // explicit `fontFamily:` still wins.
  useEffect(() => {
    if (!fontsLoaded) return;
    const T = Text as any;
    if (T.__poppinsWeightPatched) return;
    const origRender = T.render;
    if (typeof origRender !== 'function') return;
    T.render = function patchedRender(this: any, ...args: any[]) {
      const props = args[0];
      const flat = StyleSheet.flatten((props && props.style) as any) || {};
      if (!flat.fontFamily) {
        const fw = String(flat.fontWeight ?? '400');
        const family =
          fw === 'bold' || fw === '700' || fw === '800' || fw === '900'
            ? 'Poppins_700Bold'
            : fw === '600'
              ? 'Poppins_600SemiBold'
              : fw === '500'
                ? 'Poppins_500Medium'
                : 'Poppins_400Regular';
        const nextProps = { ...props, style: [{ fontFamily: family }, props.style] };
        return origRender.call(this, nextProps, ...args.slice(1));
      }
      return origRender.apply(this, args);
    };
    T.__poppinsWeightPatched = true;
  }, [fontsLoaded]);

  if (!fontsLoaded || isRestoringSession) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#114b3c" />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CustomAlertProvider>
          <OfflineBanner />
          <RootLayoutInner />
        </CustomAlertProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9f9f6',
  },
});
