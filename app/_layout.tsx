import { QueryClient, QueryClientProvider, MutationCache, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "@/src/theme/ThemeProvider";
import i18n from "@/src/i18n";
import { StyleSheet, View, ActivityIndicator, Text, Modal, ScrollView, Dimensions, TouchableOpacity, Animated, Platform, Image, AppState } from "react-native";
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
import { useReviewMapStore } from "@/src/stores/reviewMapStore";
import { fetchReviewMap } from "@/src/services/reviews";
import { fetchLocations } from "@/src/services/restaurants";
import { useSplashStore } from "@/src/stores/splashStore";
import { useCelebrationStore } from "@/src/stores/celebrationStore";
import { useWalkthroughStore } from "@/src/stores/walkthroughStore";
import { fetchGamificationStats } from "@/src/services/gamification";
import { apiClient, getErrorMessage } from "@/src/lib/api";
import { FeatureFlags } from "@/src/lib/featureFlags";
import { Search, ShoppingBag, Trophy, LayoutDashboard, Package, BarChart3, MapPin } from "lucide-react-native";
import { fetchMyContext } from "@/src/services/teams";
import { InAppNotification } from "@/src/components/InAppNotification";
import { useNotificationStore } from "@/src/stores/notificationStore";
// import { registerForPushNotifications } from "@/src/services/pushNotifications";
// NOTE: `expo-notifications` is intentionally NOT imported at module scope.
// SDK 53 Expo Go on Android logs a noisy "Android Push notifications was
// removed from Expo Go" warning the moment certain exports are touched, even
// by a static `import * as Notifications`. We lazy-require it inside the
// effect below (already guarded against the isExpoGo + Android combo).
import { useImmersiveNavBar } from "@/src/hooks/useImmersiveNavBar";
import Constants from "expo-constants";

const isExpoGo = Constants.appOwnership === 'expo';
import { initSentry } from "@/src/lib/sentry";
import { OfflineBanner } from "@/src/components/OfflineBanner";
import { CustomAlertProvider, showGlobalAlert } from "@/src/components/CustomAlert";
import { ImageCropperProvider } from "@/src/components/ImageCropper";

initSentry();
SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  // Global safety net for mutations: any mutation error NOT already handled by
  // the mutation's own onError surfaces a translated Barakeat popup instead of
  // bubbling up to the red Expo error screen. The motivating case is a team
  // member whose permission was revoked server-side acting on stale UI — the
  // backend returns 403 and we now show "Vous n'avez pas la permission…"
  // (via getErrorMessage → errors.forbidden) rather than crashing. Mutations
  // with their own onError keep full control of their UX (rollback, inline
  // field errors, etc.) — we skip those to avoid a double popup.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      // On a permission error, refresh the member's permissions so the stale
      // UI re-gates and the now-blocked option disappears. Runs for EVERY
      // mutation (even ones with their own onError) so the cause self-heals.
      if ((error as any)?.status === 403) {
        void queryClient.invalidateQueries({ queryKey: ['my-context'] });
      }
      if (mutation.options.onError) return;
      showGlobalAlert(i18n.t('common.error', { defaultValue: 'Erreur' }), getErrorMessage(error));
    },
  }),
  defaultOptions: {
    queries: {
      // Keep cached query results in memory for 24h instead of the 5-minute
      // default. Tab revisits feel instant: previously fetched data is still
      // in cache, screens render their last-known content immediately, any
      // refetch happens silently in the background.
      gcTime: 1000 * 60 * 60 * 24,
      // 30s default freshness floor. Within 30s of a fetch, identical query
      // keys (e.g. when two tabs both mount `['locations']`) serve from
      // cache instead of double-fetching. Crucial under the strict
      // express-rate-limit budget on the backend (20 req/min on
      // /api/reservations + /api/messages + /api/reviews) — a fast tab
      // bounce used to fire N parallel refetches; now it fires zero.
      staleTime: 30_000,
      // Bursty reconnect storms used to bring the rate-limit ceiling down
      // on every WiFi/4G flip: every stale query would refire at once. The
      // few queries that genuinely need freshness on reconnect opt back in
      // per-query (locations, my-reservations).
      refetchOnReconnect: false,
      // RN doesn't have window focus, but be explicit so this doesn't
      // change behaviour if the app ever ships a web target.
      refetchOnWindowFocus: false,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="auth/sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="auth/sign-up" options={{ headerShown: false }} />
      <Stack.Screen name="auth/forgot-password" options={{ headerShown: false }} />
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
      <Stack.Screen name="business/select-org-basket" options={{ headerShown: false }} />
      <Stack.Screen name="business/availability" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/menu-items" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/scan-qr" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="business/team" options={{ headerShown: false }} />
      <Stack.Screen name="business/member-detail" options={{ headerShown: false }} />
      <Stack.Screen name="business/add-location" options={{ headerShown: false }} />
      <Stack.Screen name="business/edit-location" options={{ headerShown: false }} />
      <Stack.Screen name="business/add-member" options={{ headerShown: false }} />
      <Stack.Screen name="business/permissions/[membershipId]" options={{ headerShown: false }} />
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
  // Which user id the onboarding/tutorial probe has run for. Keyed by user (not
  // a bare boolean) so a different account logging in — e.g. after a logout, or
  // a partner signing in on a device a customer used — gets its own first-login
  // check instead of being suppressed by the previous user's run.
  const tutorialCheckedForUserRef = useRef<string | null>(null);
  // Mirrors the per-user tutorial probe as state so other effects (notably the
  // in-app notification poll) can gate on it. Without this, notifications
  // fire before the async onboarding probe resolves, racing the tutorial
  // carousel onto the screen.
  const [tutorialChecked, setTutorialChecked] = useState(false);

  const isRestoringSession = useAuthStore((s) => s.isRestoringSession);
  const hydrateFavorites = useFavoritesStore((s) => s.hydrate);
  const hydrateAddresses = useAddressStore((s) => s.hydrate);
  const hydrateOrders = useOrdersStore((s) => s.hydrate);
  const hydrateReviewMap = useReviewMapStore((s) => s.hydrate);
  const setReviewMap = useReviewMapStore((s) => s.setMap);

  const router = useRouter();
  const segments = useSegments();
  const qc = useQueryClient();

  useEffect(() => {
    void hydrateFavorites();
    void hydrateAddresses();
    void hydrateOrders();
    void hydrateReviewMap();
  }, [hydrateFavorites, hydrateAddresses, hydrateOrders, hydrateReviewMap]);

  // Prefetch the location review-aggregate map at app boot so the search
  // tab's rating chips paint instantly on first frame. The map is also
  // persisted to AsyncStorage (see reviewMapStore) so subsequent cold-starts
  // show ratings BEFORE this prefetch resolves. The key signature
  // (sorted location ids) MUST match the one in app/(tabs)/index.tsx so the
  // search tab reuses the cached entry instead of refetching.
  useEffect(() => {
    void (async () => {
      try {
        const locs = await qc.fetchQuery({
          queryKey: ['locations'],
          queryFn: fetchLocations,
          staleTime: 5 * 60_000,
        });
        // Only prefetch ratings the backend did NOT embed. With avg_rating now
        // on /api/locations this is empty and we skip the review fan-out at
        // boot entirely; the key signature still matches index.tsx so the
        // search tab reuses the same (empty) cache entry.
        const ids = (locs ?? [])
          .filter((l) => l.avg_rating == null)
          .map((l) => Number(l.id))
          .filter((n) => !Number.isNaN(n))
          .sort((a, b) => a - b);
        if (ids.length === 0) return;
        const sig = ids.join(',');
        const fresh = await qc.fetchQuery({
          queryKey: ['review-map', sig],
          queryFn: () => fetchReviewMap(ids),
          staleTime: 5 * 60_000,
        });
        if (fresh && Object.keys(fresh).length > 0) setReviewMap(fresh);
      } catch {
        // Non-fatal: search tab falls back to AsyncStorage-hydrated cache.
      }
    })();
  }, [qc, setReviewMap]);

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
    const inAuth = segments[0] === 'auth';
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

    // The in-app admin interface has been removed. Users whose role is still
    // 'admin' on the server are treated as customers in the mobile app — admin
    // tooling lives on the website (admin.html) only.
    if (isBiz && !inBusinessFlow && !inAuth && !inOnboarding) {
      console.log('[RootLayout] Routing business user to (business)/dashboard');
      router.replace('/(business)/dashboard' as never);
    } else if (!isBiz && !inTabsFlow && !inAuth && !inOnboarding) {
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
    if (!isAuthenticated || isRestoringSession) return;
    const uid = user?.id ? String(user.id) : null;
    if (!uid || tutorialCheckedForUserRef.current === uid) return;
    tutorialCheckedForUserRef.current = uid;
    setTutorialChecked(false); // re-gate notifications while we probe this user
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
      // First login for THIS account — the per-user, server-side
      // `onboarding_completed` flag is false. Show the welcome tutorial +
      // interactive demo for customers AND partners. We reset the device-scoped
      // `hasCompletedWalkthrough` gate so a brand-new account still gets it even
      // on a device where a previous user already finished the demo (otherwise
      // that flag would silently suppress it). dismissTutorial() flips the
      // server flag to true afterwards, so it won't re-show on later logins.
      if (!onboardingCompleted) {
        useWalkthroughStore.getState().resetWalkthroughCompletion();
        setShowTutorial(true);
      }
      // Resolve the gate regardless of whether the tutorial shows — downstream
      // popup effects depend on knowing "the onboarding probe has resolved",
      // not on the tutorial actually appearing.
      setTutorialChecked(true);
    })();
  }, [isAuthenticated, isRestoringSession, user?.id, user?.role, (user as any)?.type]);

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

  // Notification-popup pump — exposed via a ref so the push listener can
  // trigger an immediate poll when a push arrives in the foreground,
  // instead of pushing a synthetic popup with a `Date.now()` id (which
  // dedup-collides with the same notification when the poll later picks
  // it up via the real backend id).
  const pollNotifsRef = useRef<() => Promise<void>>(async () => {});

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
    pollNotifsRef.current = poll;
    // Expose the poll to the rest of the app via the store so the per-area
    // unread-count queries (tabs / business layout) can fire it immediately
    // when the count goes up — the bell otherwise advanced its badge well
    // before the next 30 s tick refreshed the popup queue.
    useNotificationStore.getState().setPopupPoller(poll);
    // Trigger model: initial poll 1.5s after gates open, then every 30s while
    // the app is foregrounded, plus an extra poll whenever AppState returns
    // to 'active'. 30s = 2 req/min — same cadence as the unread-count poll
    // in the tab layout, well under the rate-limit budget. The previous
    // "once-only" model meant in-session notifications never surfaced as
    // popups (they only appeared in the bell list).
    const initialTimer = setTimeout(poll, 1500);
    const interval = setInterval(poll, 30_000);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll();
    });
    return () => {
      active = false;
      clearTimeout(initialTimer);
      clearInterval(interval);
      appStateSub.remove();
    };
  }, [isAuthenticated, isRestoringSession, storeHydrated, user?.id, storeUserId, pushPopups, splashDone, tutorialChecked, showTutorial, showWelcomeModal]);

  // Also listen for push notifications if available
  // SDK 53+ removed Android push notification support from Expo Go — we
  // lazy-require expo-notifications here so the warning never fires in Go.
  useEffect(() => {
    if (isExpoGo && Platform.OS === 'android') return;
    const Notifications = require('expo-notifications');
    const subscription = Notifications.addNotificationReceivedListener(() => {
      // Trigger an immediate refetch via the poll function — DO NOT push a
      // synthetic popup with `Date.now()` as id, because the poll-driven
      // copy of the same notification arrives shortly with the real
      // backend id and `pushPopups`'s dedup-by-id would miss the duplicate,
      // surfacing the same notification twice on screen.
      void pollNotifsRef.current?.();
    });
    return () => subscription.remove();
  }, []);

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
      <DemoWelcomeCover />
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
      {/* "Welcome back" — returning users only. Gated on the onboarding probe
          having resolved (tutorialChecked) AND the first-login tutorial NOT
          showing, so a brand-new user never sees "back" (they get the welcome
          tutorial + demo instead), with no flash before the probe resolves. */}
      {showWelcomeModal && user?.role !== 'business' && tutorialChecked && !showTutorial && (
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

  // ── Android navigation bar: keep the on-screen buttons hidden ─────────────
  // Hides the Samsung/virtual nav buttons app-wide and RE-asserts the hidden
  // state on background→foreground, keyboard close, and screen navigation
  // (Android resets immersive mode on all three). See the hook for details.
  useImmersiveNavBar();

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
          <ImageCropperProvider>
            <OfflineBanner />
            <RootLayoutInner />
          </ImageCropperProvider>
        </CustomAlertProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// ── Demo welcome cover ────────────────────────────────────────────────
// Rendered at the ROOT navigator level (above every Stack screen) so it
// can paint the instant the user taps "Mode démo" on /settings, BEFORE
// any navigation transition. The previous (tabs)-layout-level version
// only rendered after /settings transitioned out and /(tabs)/ came in,
// so the user briefly saw the home tab during the transition.
//
// Lifecycle:
//  1. settings.tsx flips `showDemoWelcome = true`. Cover appears over
//     /settings synchronously — the user never sees a flash.
//  2. User taps "Start demo". We `router.replace('/(tabs)/')` to put
//     the home tab in the stack, KEEP the cover visible for ~350 ms
//     (typical stack-pop animation), then flip `showDemoWelcome = false`
//     + call `startWalkthrough` on the next frame. The cover hides
//     exactly as the walkthrough overlay fades in — no visible gap.
//  3. User taps "Quit". `showDemoWelcome = false`, no walkthrough fired.
function DemoWelcomeCover() {
  const show = useWalkthroughStore((s) => s.showDemoWelcome);
  const setShow = useWalkthroughStore((s) => s.setShowDemoWelcome);
  const startWalkthrough = useWalkthroughStore((s) => s.startWalkthrough);
  const setDemoCustomerActive = useWalkthroughStore((s) => s.setDemoCustomerActive);
  const { t } = useTranslation();
  const theme = useTheme();
  if (!show) return null;
  const handleStart = () => {
    // Single store write: startWalkthrough() clears showDemoWelcome (cover
    // unmounts) in the same commit while the init override keeps
    // demoCustomerActive=true so the demo card injection survives the
    // start transition. The walkthrough starts at step 0 (Discover tab
    // intro) — that's the first step users expect to see.
    startWalkthrough({ demoCustomerActive: true });
  };
  const handleQuit = () => {
    // Tidy up: turn off the demo-card injection too, since the user
    // explicitly opted not to start the demo. Otherwise they'd land on
    // a home tab still showing the Chez Joe card with no walkthrough.
    setDemoCustomerActive(false);
    setShow(false);
  };
  return (
    <View
      pointerEvents="auto"
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: theme.colors.bg,
        zIndex: 99999,
        elevation: 99999,
        paddingHorizontal: 28,
        paddingTop: 100,
        paddingBottom: 40,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ alignItems: 'center', marginTop: 40 }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.primary + '14', justifyContent: 'center', alignItems: 'center', marginBottom: 28 }}>
          <Hand size={42} color={theme.colors.primary} />
        </View>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 24, fontFamily: 'Poppins_700Bold', fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>
          {t('walkthrough.demoWelcome.title', { defaultValue: 'Bienvenue dans la démo Barakeat' })}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 8, maxWidth: 320 }}>
          {t('walkthrough.demoWelcome.desc', { defaultValue: "Nous allons vous guider à travers l'application sans créer de vraie commande. Appuyez sur Démarrer quand vous êtes prêt, ou Quitter pour annuler." })}
        </Text>
      </View>
      <View style={{ width: '100%', gap: 12 }}>
        <TouchableOpacity
          onPress={handleStart}
          accessibilityRole="button"
          accessibilityLabel={t('walkthrough.demoWelcome.start', { defaultValue: 'Démarrer la démo' })}
          style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
        >
          <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
            {t('walkthrough.demoWelcome.start', { defaultValue: 'Démarrer la démo' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleQuit}
          accessibilityRole="button"
          accessibilityLabel={t('walkthrough.demoWelcome.quit', { defaultValue: 'Quitter' })}
          style={{ paddingVertical: 14, alignItems: 'center' }}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 14, fontFamily: 'Poppins_500Medium' }}>
            {t('walkthrough.demoWelcome.quit', { defaultValue: 'Quitter' })}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
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
