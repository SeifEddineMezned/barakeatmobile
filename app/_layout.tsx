import { QueryClient, QueryClientProvider, MutationCache, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "@/src/theme/ThemeProvider";
import i18n from "@/src/i18n";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet, View, ActivityIndicator, Text, TextInput, Modal, ScrollView, Dimensions, TouchableOpacity, Animated, Platform, Image, AppState, StatusBar } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { useAuthStore } from "@/src/stores/authStore";
import { useTranslation } from 'react-i18next';
import { Hand, Sparkles, Award, Flame } from "lucide-react-native";
import { BarakeatHaloSplash } from "@/src/components/animations/BarakeatHaloSplash";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { useFavoritesStore } from "@/src/stores/favoritesStore";
import { useOrdersStore } from "@/src/stores/ordersStore";
import { useAddressStore } from "@/src/stores/addressStore";
import { useReviewMapStore } from "@/src/stores/reviewMapStore";
import { fetchReviewMap } from "@/src/services/reviews";
import { fetchLocations } from "@/src/services/restaurants";
import { useSplashStore } from "@/src/stores/splashStore";
import { useCelebrationStore } from "@/src/stores/celebrationStore";
import PostReservationCelebration from "@/src/components/animations/PostReservationCelebration";
import { useWalkthroughStore } from "@/src/stores/walkthroughStore";
import { fetchGamificationStats } from "@/src/services/gamification";
import { apiClient, getErrorMessage } from "@/src/lib/api";
import { FeatureFlags } from "@/src/lib/featureFlags";
import { Search, ShoppingBag, Trophy, LayoutDashboard, Package, BarChart3, MapPin, TrendingUp, ClipboardList, Store } from "lucide-react-native";
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
import { resetStackTo } from "@/src/lib/navStack";
import { OfflineBanner } from "@/src/components/OfflineBanner";
import { CustomAlertProvider, showGlobalAlert } from "@/src/components/CustomAlert";
import { ImageCropperProvider } from "@/src/components/ImageCropper";
import { installRouterGuards } from "@/src/lib/routerGuards";

initSentry();
// One-time patch of the expo-router singleton. Dedups rapid double-tap
// navigations (push / replace / navigate / back) so a single user gesture
// can't queue the same destination twice — fixes the "back from a
// double-tapped page peels off two copies" symptom — AND swallows
// router.back() at the root of the stack so React Navigation stops
// logging "GO_BACK was not handled by any navigator". See routerGuards.ts
// for the full rationale.
installRouterGuards();
SplashScreen.preventAutoHideAsync().catch(() => {});

// MODULE-LEVEL (not a component ref) so it survives a RootLayoutInner remount.
// The native splash must be hidden exactly ONCE per process: it shows at launch
// and the in-app BarakeatHaloSplash (re-shown on login etc.) is a separate JS
// overlay. A per-instance ref reset to false whenever this tree remounts — e.g.
// the account-deleted logout resets the nav stack (router.dismissAll), which
// remounts RootLayoutInner — and the splash effect then called hideAsync a
// SECOND time, now targeting a view controller (the alert Modal's, or a freshly
// created one) with no splash registered → "No native splash screen registered
// for given view controller", a rejection expo-splash-screen does NOT route
// through the returned promise's .catch. A process-wide guard prevents that.
let _nativeSplashHidden = false;

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

// Hand the QueryClient to the module-level registry so non-React callers can
// reach it. The api.ts response interceptor uses this to invalidate dependent
// queries when the backend reports `code: 'location_deleted'` — see
// handleLocationDeleted in lib/api.ts.
try {
  const { setGlobalQueryClient } = require('@/src/lib/queryClientRef');
  setGlobalQueryClient(queryClient);
} catch {}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="auth/sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="auth/sign-up" options={{ headerShown: false }} />
      <Stack.Screen name="auth/onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="auth/forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="auth/verify-email" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="impact" options={{ headerShown: false }} />
      {/* No slide animation INTO the home groups. The splash overlay sits
          above the Stack while the post-login redirect lands; with the
          default slide_from_right, the user would see the destination
          slide in for ~250 ms after the overlay dropped, reading as the
          "page refreshes / slides into the dashboard" glitch right after
          the loading-screen animation ends. animation: 'none' makes the
          route swap instant — by the time the overlay lifts, the
          destination is already in place. Going BACK into these groups
          from a pushed screen (e.g. /settings → /(tabs)) uses the back
          animation of the source screen, not this option, so the in-app
          UX is unchanged. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="(business)" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="restaurant/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="business-detail/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="basket/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="reserve" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="review" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="business/create-basket" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="business/refine-description" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="business/select-org-basket" options={{ headerShown: false }} />
      <Stack.Screen name="business/set-password" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="business/availability" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/menu-items" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/scan-qr" options={{ presentation: "card", headerShown: false }} />
      <Stack.Screen name="business/conversations" options={{ headerShown: false }} />
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
      <Stack.Screen name="account/change-password-confirm" options={{ headerShown: false }} />
      <Stack.Screen name="account/change-password-set" options={{ headerShown: false }} />
      <Stack.Screen name="account/change-email-confirm" options={{ headerShown: false }} />
      <Stack.Screen name="account/change-email-new" options={{ headerShown: false }} />
      <Stack.Screen name="account/change-email-verify" options={{ headerShown: false }} />
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
  // Real safe-area insets captured HERE, in the root tree (under
  // SafeAreaProvider). Inside a RN <Modal> the SafeAreaView/useSafeAreaInsets
  // context resolves to ZERO on both iOS and Android (the modal is its own
  // native window outside the provider), so the first-login carousel's top row
  // painted over the status-bar clock/battery. We pad that row with this
  // captured `insets.top` instead of relying on the in-modal SafeAreaView.
  const rootInsets = useSafeAreaInsets();
  const WELCOME_WIDTH = Dimensions.get('window').width;
  const [initialSplash, setInitialSplash] = useState(true);
  const loginSplash = useSplashStore((s) => s.showSplash);
  const wasLoginSplash = useSplashStore((s) => s.wasLoginSplash);
  const dismissLoginSplash = useSplashStore((s) => s.dismissSplash);
  const showSplash = initialSplash || loginSplash;

  // Two-phase splash teardown — kills the "sign-in screen flashes before the
  // auto-login redirect" glitch. Phase 1: the halo animation finishes and flips
  // `splashAnimDone`, but the overlay STAYS up. Phase 2: the routing guard fires
  // its redirect UNDER the still-visible splash, and only once the destination
  // route is actually in place does the teardown effect drop the overlay. See
  // handleSplashFinish + the teardown effect below.
  //
  // `splashAnimDone` lives in the splash STORE (not local state) so a fresh
  // login splash resets it synchronously via triggerSplash — see splashStore.
  const splashAnimDone = useSplashStore((s) => s.animDone);
  const splashTornDownRef = useRef(false);

  // Stable splash-finish handler. Reads zustand-backed values via getState() at
  // dismiss time instead of capturing them in the closure, so the callback's
  // identity never changes and BarakeatHaloSplash's useEffect (keyed on
  // durationMs only after the recent ref fix) is never re-triggered. The
  // `setPendingWelcomeAfterSplash` setter is also stable (React useState
  // setters always are), so it's safe to use directly inside.
  const wasLoginSplashRef = useRef(wasLoginSplash);
  wasLoginSplashRef.current = wasLoginSplash;
  const handleSplashFinish = React.useCallback(async () => {
    // Run any work that was deferred to AFTER the animation (login defers its
    // auth-state flip here so the halo animates on a free JS thread). This
    // runs BEFORE markAnimDone so the routing guard sees the new auth state
    // and can redirect home.
    //
    // The await on `pendingAnimFinish` was previously unbounded: if signIn /
    // session-restore hung (cold Railway dyno, DNS hiccup) the await never
    // resolved, markAnimDone never fired, and the splash B kept bouncing
    // forever. The user-reported "stuck on the bouncing animation" symptom
    // matched exactly this path. Race the callback against an 8 s ceiling so
    // we ALWAYS flip animDone within a bounded time; the deferred work then
    // completes in the background (signIn writes the token regardless of
    // whether we waited for it). The 8 s number is generous enough that the
    // typical 200-1500 ms post-animation work finishes inside it on every
    // device, while still being short enough that the user isn't stuck
    // watching a bouncing B if it doesn't.
    const { pendingAnimFinish } = useSplashStore.getState();
    if (pendingAnimFinish) {
      useSplashStore.setState({ pendingAnimFinish: null });
      try {
        await Promise.race([
          (async () => { await pendingAnimFinish(); })(),
          new Promise<void>((resolve) => setTimeout(resolve, 8000)),
        ]);
      } catch (e) {
        console.error('[Splash] pending onFinish failed:', e);
      }
    }
    // Phase 1 only — flag that the animation is done. We deliberately do NOT
    // tear the overlay down here. The routing guard (gated on the same
    // `splashAnimDone`) now redirects a returning user to their home UNDER the
    // still-visible splash; the teardown effect lifts the overlay once that
    // redirect has landed, so the sign-in screen never flashes underneath.
    useSplashStore.getState().markAnimDone();
  }, []);
  // setPendingWelcomeAfterSplash is declared further down in this function;
  // we capture its setter via a ref so handleSplashFinish (declared up here so
  // the splash JSX can reference it) doesn't need a forward dep.
  const setPendingWelcomeAfterSplashRef = useRef<((v: boolean) => void) | null>(null);

  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const signOut = useAuthStore((s) => s.signOut);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [welcomeCarouselPage, setWelcomeCarouselPage] = useState(0);
  // Deferred trigger for the "Content de vous revoir" popup. Splash onFinish
  // sets this to true if the user came from a fresh login; a resolver useEffect
  // below decides — once the onboarding probe has resolved — whether to ACTUALLY
  // surface the popup or swallow it (first-login flow firing the tutorial /
  // demo cover / walkthrough instead). Without this deferral, the modal popped
  // briefly on top of the white onboarding carousel for first-login users
  // because showTutorial flips to FALSE during the carousel→demo-cover handoff
  // (openDemoCover does setShowTutorial(false)), opening a window where the
  // existing `!showTutorial` gate let the welcome modal paint over the carousel.
  const [pendingWelcomeAfterSplash, setPendingWelcomeAfterSplash] = useState(false);
  // Wire the forward ref declared above handleSplashFinish to the actual setter
  // now that it's been declared. React's useState setters are reference-stable,
  // so this assignment runs once and the splash callback can fire it at dismiss
  // time without taking a closure dep on it.
  setPendingWelcomeAfterSplashRef.current = setPendingWelcomeAfterSplash;

  // Badge popup state
  const [badgePopup, setBadgePopup] = useState<{ icon: string; nameKey: string; descKey: string } | null>(null);
  const badgeShownRef = useRef<Set<string>>(new Set());
  const badgeScale = useRef(new Animated.Value(0)).current;

  // Pickup streak celebration state. The streak is bumped server-side when a
  // basket is PICKED UP (not reserved), so the buyer's app learns about it via
  // the gamification-stats poll. We dedup on last_pickup_date (persisted) so the
  // celebration fires exactly once per pickup.
  const [streakPopup, setStreakPopup] = useState<{ streak: number } | null>(null);
  const streakScale = useRef(new Animated.Value(0)).current;
  const [streakReady, setStreakReady] = useState(false);
  const streakBaselineRef = useRef<string | null>(null);
  const streakInitRef = useRef(false);

  // Tutorial state
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialPage, setTutorialPage] = useState(0);
  // Which user id the onboarding/tutorial probe has run for. Keyed by user (not
  // a bare boolean) so a different account logging in — e.g. after a logout, or
  // a partner signing in on a device a customer used — gets its own first-login
  // check instead of being suppressed by the previous user's run.
  // Mirrors the per-user tutorial probe as state so other effects (notably the
  // in-app notification poll) can gate on it. Without this, notifications
  // fire before the async onboarding probe resolves, racing the tutorial
  // carousel onto the screen.
  const [tutorialChecked, setTutorialChecked] = useState(false);

  // Marks that the demo sequence currently running originated from this account's
  // FIRST login (vs the Settings "Mode démo" re-entry). Only first login flips the
  // server onboarding flag + awards the finished badge at demo end.
  const firstLoginDemoPendingRef = useRef(false);
  // Post-demo nudges shown once the demo sequence ends.
  const [showAddAddressPrompt, setShowAddAddressPrompt] = useState(false);
  // Queued intent to surface the customer "add address" prompt — set when the
  // demo ends, consumed by an effect once any concurrent badge popup has been
  // shown AND dismissed. Without this gate the address prompt could flash up
  // for the ~500-1000 ms window between the gamification refetch starting and
  // the "Premiers pas" badge actually paint. See effect below.
  const [pendingAddressPrompt, setPendingAddressPrompt] = useState(false);
  const badgeWasShownRef = useRef(false);
  // Tracks the uid the onboarding/tutorial probe has actually run for once the
  // user is INSIDE the app. The probe effect's dep list includes segments[0]
  // (so it re-fires when the user leaves the /auth gender screen for their home
  // group), but that also makes it re-fire on every in-app navigation — which
  // during the business demo (e.g. tapping "Add basket") re-ran the probe,
  // re-read onboarding_completed=false, and re-showed the welcome carousel in an
  // endless loop. This ref makes the actual probe run at most once per uid
  // in-app; it's reset on sign-out so a re-login re-probes.
  const probeRanForUidRef = useRef<string | null>(null);
  // Walkthrough signals the root layout watches to sequence the demo + gate the
  // badge popup (carousel → "Start demo" cover → walkthrough → end).
  const walkthroughStep = useWalkthroughStore((s) => s.step);
  const showDemoWelcome = useWalkthroughStore((s) => s.showDemoWelcome);
  const demoSequencePending = useWalkthroughStore((s) => s.demoSequencePending);
  const pendingFirstRun = useWalkthroughStore((s) => s.pendingFirstRun);
  const prevWalkStepRef = useRef<number | null>(null);
  const prevShowDemoWelcomeRef = useRef<boolean>(false);
  // Pre-demo snapshot of the user's favorites. Captured when a demo sequence
  // starts and restored when it ends so any favorite the user toggles inside
  // the walkthrough (e.g. starring the demo Chez Joe location) never persists
  // into their real account.
  const demoFavoritesSnapshotRef = useRef<{ favoriteBasketIds: string[]; favoriteMerchantIds: string[]; starredBasketTypeIds: string[] } | null>(null);
  const prevDemoSequencePendingRef = useRef<boolean>(false);

  // Snapshot on the false→true transition of demoSequencePending. Both demo
  // entry points (first-login auto-show in openDemoCover, Settings "Mode démo"
  // in settings.tsx) flip this flag, so a single watcher here covers both.
  useEffect(() => {
    if (demoSequencePending && !prevDemoSequencePendingRef.current) {
      const fav = useFavoritesStore.getState();
      demoFavoritesSnapshotRef.current = {
        favoriteBasketIds: [...fav.favoriteBasketIds],
        favoriteMerchantIds: [...fav.favoriteMerchantIds],
        starredBasketTypeIds: [...fav.starredBasketTypeIds],
      };
    }
    prevDemoSequencePendingRef.current = demoSequencePending;
  }, [demoSequencePending]);

  const isRestoringSession = useAuthStore((s) => s.isRestoringSession);
  const hydrateFavoritesForUser = useFavoritesStore((s) => s.hydrateForUser);
  const resetFavoritesForLogout = useFavoritesStore((s) => s.resetForLogout);
  const hydrateAddresses = useAddressStore((s) => s.hydrate);
  const hydrateOrders = useOrdersStore((s) => s.hydrate);
  const hydrateReviewMap = useReviewMapStore((s) => s.hydrate);
  const setReviewMap = useReviewMapStore((s) => s.setMap);

  const router = useRouter();
  const segments = useSegments();
  const qc = useQueryClient();

  // Store hydrations deferred until splash dismisses — these are AsyncStorage
  // reads that fire setState cascades into multiple zustand stores. Each
  // cascade triggers re-renders across the React tree, which compete with
  // BarakeatHaloSplash's RAF loop for the JS thread on Android during launch
  // and produce the splash stutter. Running them AFTER splashDone gives the
  // animation a quiet thread and the user doesn't notice the ~50 ms hydration
  // delay because they're still on the splash overlay until it dismisses.
  useEffect(() => {
    if (showSplash) return;
    void hydrateAddresses();
    void hydrateOrders();
    void hydrateReviewMap();
  }, [showSplash, hydrateAddresses, hydrateOrders, hydrateReviewMap]);

  // Per-user favorites: load this account's persisted favorites on sign-in /
  // session-restore, reset to empty on sign-out. Previously hydrated from a
  // single device-global key, which leaked one account's favorites into the
  // next account that signed in on the same device.
  // Also deferred until splashDone for the same JS-thread-quietness reason
  // above. The logout-side resetForLogout still fires immediately so a sign-
  // out during the app's normal lifetime takes effect right away.
  useEffect(() => {
    if (isRestoringSession) return;
    if (showSplash) return;
    if (isAuthenticated && user?.id) {
      void hydrateFavoritesForUser(String(user.id));
    } else {
      resetFavoritesForLogout();
    }
  }, [isAuthenticated, isRestoringSession, user?.id, showSplash, hydrateFavoritesForUser, resetFavoritesForLogout]);

  // Prefetch the location review-aggregate map at app boot so the search
  // tab's rating chips paint instantly on first frame. The map is also
  // persisted to AsyncStorage (see reviewMapStore) so subsequent cold-starts
  // show ratings BEFORE this prefetch resolves. The key signature
  // (sorted location ids) MUST match the one in app/(tabs)/index.tsx so the
  // search tab reuses the cached entry instead of refetching.
  // Deferred until splashDone: this fetch kicks off a network request +
  // response processing + setReviewMap re-render cascade, all of which
  // would otherwise compete with the splash RAF on the JS thread during
  // launch and produce stutter on Android.
  useEffect(() => {
    if (showSplash) return;
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
  }, [showSplash, qc, setReviewMap]);

  // Coordinated native-splash → JS-splash handoff. The native
  // expo-splash-screen must stay up until BarakeatHaloSplash has actually
  // painted at least one frame, otherwise the native splash hides BEFORE
  // the SVG halo finishes its first-frame layout and the user sees the
  // underlying Stack interface for a few frames — the recurring "I saw
  // the app then the loading screen started" bug.
  //
  // Signal chain (each step must complete before the next):
  //   1. BarakeatHaloSplash mounts → its outer View's onLayout fires →
  //      native layout pass complete.
  //   2. Three RAF ticks inside the splash → renderer has flushed the
  //      SVG halo, clipPaths, and Chillax glyph to the framebuffer.
  //   3. splash's onMounted prop fires → we set splashOverlayReady = true.
  //   4. Effect re-runs → one MORE RAF here to ensure the parent React
  //      commit that ack'd splashOverlayReady has also been painted.
  //   5. SplashScreen.hideAsync() → native splash fades, revealing the
  //      already-painted JS splash underneath.
  //
  // If showSplash is FALSE (splash disabled / already dismissed), hide
  // immediately — there's no JS splash to wait for.
  //
  // Safety: if for any reason onMounted never fires (mount error, slow
  // device), a 1500 ms wall-clock timer hides the native splash anyway
  // so the user is never stuck on a frozen native splash. 1500 ms is
  // generous enough that a slow Android device's first paint will have
  // settled by then; the user accepts a brief native-splash hold over a
  // visible "app then splash" glitch.
  const [splashOverlayReady, setSplashOverlayReady] = useState(false);
  // Hide the native splash at most once per process. expo-splash-screen
  // registers ONE native splash per view controller; calling hideAsync after
  // it's already unregistered throws "No native splash screen registered for
  // given view controller" — an async rejection the .catch below does NOT
  // reliably swallow. The effect can legitimately fire from multiple branches
  // (splashOverlayReady=true, then showSplash=false on dismiss; or the safety
  // timer). The module-level `_nativeSplashHidden` gate (above) ensures only
  // the first call ever invokes hideAsync, and unlike the old per-instance ref
  // it survives a RootLayoutInner remount (e.g. the logout nav-stack reset).
  const hideNativeSplashOnce = React.useCallback(() => {
    if (_nativeSplashHidden) return;
    _nativeSplashHidden = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  useEffect(() => {
    if (isRestoringSession) return;
    if (!showSplash) {
      hideNativeSplashOnce();
      return;
    }
    if (splashOverlayReady) {
      // One more frame before hideAsync — by now React has committed the
      // splashOverlayReady=true render, but the commit's paint flush
      // happens AFTER the commit returns. Waiting one RAF guarantees the
      // commit is on screen before we drop the native splash.
      const raf = requestAnimationFrame(() => {
        hideNativeSplashOnce();
      });
      return () => cancelAnimationFrame(raf);
    }
    const safety = setTimeout(() => {
      hideNativeSplashOnce();
    }, 1500);
    return () => clearTimeout(safety);
  }, [isRestoringSession, showSplash, splashOverlayReady, hideNativeSplashOnce]);

  // ── Central role-based routing guard ──────────────────────────────────────
  useEffect(() => {
    if (isRestoringSession) return;
    // Redirect once the halo ANIMATION has finished (`splashAnimDone`), NOT
    // once the overlay has been torn down. The overlay is intentionally held
    // up across this redirect (see handleSplashFinish + the teardown effect
    // below): `router.replace('/(tabs)' | '/(business)/dashboard')` mounts a
    // large tree, so firing it while the halo is still animating would starve
    // BarakeatHaloSplash's RAF on Android. By the time the animation is done
    // the motion has settled, so the heavy mount happens UNDER a static splash
    // (no visible jank), and the teardown effect lifts the overlay only after
    // the destination route is in place — so the sign-in screen never flashes
    // before the auto-login redirect lands.
    if (!splashAnimDone) return;

    const inBusinessFlow = segments[0] === '(business)';
    const inTabsFlow = segments[0] === '(tabs)';
    const inAuth = segments[0] === 'auth';
    // `inOnboarding` was the gate for the deleted pre-login welcome screen.
    // Unauthenticated users now land directly on /auth/sign-in; we kept the
    // variable name for readability of the role-routing check below but
    // anchor it on `inAuth` semantics instead.
    const inOnboarding = false;

    // Prototype mode: block ALL access to the app — bounce out to the
    // sign-in landing (the pre-login carousel was removed).
    if (FeatureFlags.IS_PROTOTYPE) {
      if (isAuthenticated) {
        void signOut();
      }
      if (inBusinessFlow || inTabsFlow) {
        resetStackTo(router, '/auth/sign-in');
      }
      return;
    }

    if (!isAuthenticated) {
      if (inBusinessFlow || inTabsFlow) {
        resetStackTo(router, '/auth/sign-in');
      }
      return;
    }

    // Apple-only first-login NAME step. When Apple withholds the name on first
    // authorization (the user cleared it on the consent sheet, or this is a
    // repeat auth the system already authorized), the backend creates the
    // account with an empty `name` and `nameNeedsInput=true`. We hold the
    // user on /auth/name-input until they fill it in — quitting the app mid-
    // step lands them right back here on next launch (the flag persisted in
    // SecureStore alongside the rest of the user object). Apple-scoped so a
    // Google account (which always returns a name) is never sent here.
    const inNameInputScreen = segments[0] === 'auth' && (segments[1] as string) === 'name-input';
    const isAppleUser =
      (user as any)?.authProvider === 'apple' || (user as any)?.provider === 'apple';
    if ((user as any)?.nameNeedsInput === true && isAppleUser) {
      if (!inNameInputScreen) {
        router.replace('/auth/name-input' as never);
      }
      return;
    }

    // OAuth first-login gender step. Hold the user on /auth/onboarding until
    // the screen flips genderStepCompleted=true and replaces to their home
    // itself. Gated on genderStepCompleted (NOT onboardingCompleted) so the
    // gender step and the welcome-carousel/demo/address flow stay decoupled —
    // otherwise this guard would keep yanking the user back to the gender
    // screen for the entire tutorial. Strict `=== false` so legacy/email
    // accounts (field absent → undefined) are never forced through it. Without
    // this guard the role-routing below yanks the user straight to
    // (tabs)/(business) a few frames after the gender screen mounts — the
    // "intermediary gender page skips itself" bug.
    const inOnboardingScreen = segments[0] === 'auth' && segments[1] === 'onboarding';
    if ((user as any)?.genderStepCompleted === false) {
      if (!inOnboardingScreen) {
        router.replace('/auth/onboarding' as never);
      }
      return;
    }

    const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';

    // The in-app admin interface has been removed. Users whose role is still
    // 'admin' on the server are treated as customers in the mobile app — admin
    // tooling lives on the website (admin.html) only.
    //
    // NOTE: we used to also exempt `inAuth` from this redirect ("don't yank an
    // authenticated user OFF /auth/sign-in"). That assumption broke once
    // /onboarding was deleted: expo-router now sometimes restores an
    // authenticated user to /auth/sign-in on reload (it's the unauthenticated
    // landing route), and with `!inAuth` in the gate the routing guard
    // silently agreed they belonged on the sign-in screen even though the
    // session was already restored — producing the "I got signed out on
    // reload" symptom even though the token was still in storage. Authed
    // users now ALWAYS get routed to their role-appropriate home, regardless
    // of which auth screen they happened to land on.
    if (isBiz && !inBusinessFlow && !inOnboarding) {
      console.log('[RootLayout] Routing business user to (business)/dashboard (segments[0] was:', segments[0], ')');
      // resetStackTo (not replace): wipe any prior-session history so the
      // post-login home is the sole stack entry — Back exits the app instead
      // of popping into a stale, blank screen from before logout.
      resetStackTo(router, '/(business)/dashboard');
    } else if (!isBiz && !inTabsFlow && !inOnboarding) {
      console.log('[RootLayout] Routing customer user to (tabs) (segments[0] was:', segments[0], ')');
      resetStackTo(router, '/(tabs)');
    }
  }, [isRestoringSession, isAuthenticated, user?.role, (user as any)?.genderStepCompleted, splashAnimDone]);

  // ── Splash overlay teardown (phase 2) ─────────────────────────────────────
  // Lift the splash overlay only AFTER the post-restore redirect above has
  // actually landed on the destination route. Until then the overlay stays up
  // (a solid green splash), so a returning user goes straight from the splash
  // to their home with no sign-in flash in between. A wall-clock safety cap
  // guarantees the splash can never hang if the expected route never appears.
  useEffect(() => {
    if (splashTornDownRef.current) return;
    if (!splashAnimDone || isRestoringSession) return;

    const teardown = () => {
      if (splashTornDownRef.current) return;
      splashTornDownRef.current = true;
      setInitialSplash(false);
      dismissLoginSplash();
      useSplashStore.getState().markSplashDone();
      // "Content de vous revoir" welcome-back popup intentionally DISABLED — it
      // fired on every returning login and the team found it repetitive. The
      // resolver machinery (pendingWelcomeAfterSplash + the modal) is left in
      // place but never armed, so it's a one-line revert if we ever want it back.
    };

    // Logged-out: the sign-in screen IS the destination — nothing to hide, so
    // lift on the next frame.
    if (!isAuthenticated) {
      const raf = requestAnimationFrame(teardown);
      return () => cancelAnimationFrame(raf);
    }

    // Authenticated: wait until the role-routing replace has committed (segments
    // reflect the home group) so the sign-in screen is no longer underneath.
    // `segments` updating only means React Navigation has committed the
    // navigation — the dashboard/tabs component itself still has to MOUNT
    // its tree, layout, and paint its first frame. Lifting the overlay one
    // RAF after the segments swap left a 2-4 frame window where the
    // dashboard had committed but not painted, which the user sees as a
    // brief "snap" between the splash and the destination. A 220 ms hold
    // covers that window on every device (typical first-frame settle is
    // 50-150 ms; 220 ms gives a safety buffer without being long enough
    // to feel like an extra wait). The overlay is a static halo by this
    // point so the hold isn't perceived as animation lag.
    const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
    const expected = isBiz ? '(business)' : '(tabs)';
    if (segments[0] === expected) {
      const t = setTimeout(teardown, 220);
      return () => clearTimeout(t);
    }

    // Not there yet — this effect re-runs when `segments` changes (the replace
    // commits) and the branch above then fires. 1200 ms safety cap as a floor.
    const safety = setTimeout(teardown, 1200);
    return () => clearTimeout(safety);
  }, [splashAnimDone, isRestoringSession, isAuthenticated, user?.role, segments, dismissLoginSplash]);

  // Wall-clock ESCAPE for a splash that hasn't dismissed itself in time. The
  // teardown chain already has internal safety caps (8 s on pendingAnimFinish,
  // 1200 ms on the post-redirect hold), so the splash should never linger past
  // ~5 s in the happy path. If it's STILL up at 15 s — auth-restore hanging,
  // routing guard never firing, an unhandled rejection upstream — the user is
  // stuck watching a bouncing B for nothing. Force the overlay down AND
  // surface a friendly "taking longer than expected" prompt so they can
  // restart instead of force-quitting the app. The dismiss happens regardless
  // of whether the user taps the alert, so a returning user lands on whatever
  // route the navigator settled on instead of the splash.
  const splashEscapeFiredRef = useRef(false);
  // Latest router segments captured via ref so the timer callback can read
  // them at fire-time without re-arming the cumulative 15 s wait every time
  // segments change (which would defeat the wall-clock purpose).
  const latestSegmentsRef = useRef(segments);
  useEffect(() => {
    latestSegmentsRef.current = segments;
  }, [segments]);
  useEffect(() => {
    if (!showSplash) {
      splashEscapeFiredRef.current = false;
      return;
    }
    if (splashEscapeFiredRef.current) return;
    const escape = setTimeout(() => {
      if (splashEscapeFiredRef.current) return;
      splashEscapeFiredRef.current = true;
      console.warn('[Splash] 15 s wall-clock hit — forcing teardown');
      // Tear down both possible sources so the overlay disappears even if
      // only one was set. markAnimDone + dismissSplash are both idempotent.
      try {
        useSplashStore.getState().markAnimDone();
        useSplashStore.getState().dismissSplash();
        useSplashStore.getState().markSplashDone();
      } catch {}
      setInitialSplash(false);
      splashTornDownRef.current = true;
      // If routing has already committed to a real home group, the user has
      // reached the app — dismissing the overlay is enough; popping a "taking
      // longer than expected" alert at the exact moment they land on the home
      // screen reads as "I just entered the app and a warning appeared".
      // Only show the alert when we're truly stuck before any usable screen.
      const firstSegment = latestSegmentsRef.current?.[0];
      const reachedApp =
        firstSegment === '(tabs)' ||
        firstSegment === '(business)';
      if (reachedApp) return;
      // Friendly, brand-protective copy. The default action (single OK
      // button) closes the alert — the user can then retry whatever brought
      // them here. We don't auto-relaunch because we can't on iOS and a
      // self-imposed quit feels worse than letting the user choose.
      showGlobalAlert(
        'Chargement plus long que prévu',
        "L'application met plus de temps que d'habitude à se charger. Veuillez réessayer dans quelques instants — si le problème persiste, fermez puis rouvrez l'application.",
      );
    }, 15000);
    return () => clearTimeout(escape);
  }, [showSplash]);

  // Re-arm the one-shot teardown guard for the post-login splash. The cold-boot
  // splash latches `splashTornDownRef`; a fresh sign-in later in the session
  // shows the SAME BarakeatHaloSplash again (loginSplash false→true), so without
  // this reset the new splash's onFinish would find the guard already latched
  // and never tear down — leaving the user stuck on the splash. (`animDone`
  // itself is reset synchronously by triggerSplash in the store, so only the
  // ref needs re-arming here.)
  const prevLoginSplashRef = useRef(loginSplash);
  useEffect(() => {
    if (loginSplash && !prevLoginSplashRef.current) {
      splashTornDownRef.current = false;
    }
    prevLoginSplashRef.current = loginSplash;
  }, [loginSplash]);

  // Check favorite notifications on app open (feature-flagged)
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession) return;
    if (showSplash) return; // defer until the splash dismisses (Android halo lag)
    const { FeatureFlags } = require('@/src/lib/featureFlags');
    if (!FeatureFlags.ENABLE_FAVORITE_NOTIFICATIONS) return;
    const favStore = require('@/src/stores/favoritesStore').useFavoritesStore.getState();
    const ids = favStore.favoriteBasketIds ?? [];
    if (ids.length > 0) {
      const { checkFavoriteNotifications } = require('@/src/services/notifications');
      void checkFavoriteNotifications(ids);
    }
  }, [isAuthenticated, isRestoringSession, showSplash]);

  // Welcome modal resolver. The splash sets `pendingWelcomeAfterSplash=true` on
  // fresh login; we wait for the onboarding probe to resolve (`tutorialChecked`)
  // before deciding whether to surface the popup. If anything in the first-
  // login sequence is firing (tutorial carousel, demo welcome cover, walkthrough
  // step, or the pending-demo ref), swallow the welcome popup — the user is
  // brand new on this account, "vous revoir" makes no sense, and showing it
  // briefly during the carousel→demo-cover handoff (when showTutorial flips to
  // false) read as a glitch.
  useEffect(() => {
    if (!pendingWelcomeAfterSplash) return;
    if (!tutorialChecked) return;
    // Partners never see this popup (it's customer-flavoured copy).
    const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
    if (
      showTutorial
      || showDemoWelcome
      || walkthroughStep !== null
      || firstLoginDemoPendingRef.current
      || isBiz
    ) {
      setPendingWelcomeAfterSplash(false);
      return;
    }
    setShowWelcomeModal(true);
    setPendingWelcomeAfterSplash(false);
    const t = setTimeout(() => setShowWelcomeModal(false), 5000);
    return () => clearTimeout(t);
  }, [pendingWelcomeAfterSplash, tutorialChecked, showTutorial, showDemoWelcome, walkthroughStep]);

  // Check for newly unlocked badges. Gated on `!showSplash` so the fetch +
  // response processing + setState don't run on the JS thread DURING the splash
  // animation. On login (isAuthenticated flips true exactly as the login splash
  // starts) this was a chief cause of the Android halo lag. Fires the moment the
  // splash dismisses; the badge/streak popups already gate on splashDone, so
  // nothing is lost.
  const gamQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    enabled: isAuthenticated && !isRestoringSession && !showSplash,
    staleTime: 60_000,
  });

  const splashDone = useSplashStore((s) => s.splashDone);
  const celebrationPending = useCelebrationStore((s) => s.pending);
  const orderFlowActive = useCelebrationStore((s) => s.orderFlowActive);
  // Gate any global overlay (badge unlock, streak celebration, post-demo
  // address prompt) on the order-confirmed detail popup. Without this, the
  // XP bump from the just-placed reservation refetches gamification stats,
  // the new badge gets detected, and a badgePopup modal renders OVER the
  // order popup — the user sees the "View Order" button close one popup
  // and a second, near-identical celebration remains on screen, which they
  // reported as "a different but duplicate popup".
  const orderConfirmActive = useCelebrationStore((s) => s.orderConfirmActive);
  // Counter that bumps from (tabs)/_layout when the user taps "Voir la
  // commande" — we drop any badge/streak popup that's already on screen
  // in the same tap so the orders tab is fully clean on landing.
  const clearOverlaysSeq = useCelebrationStore((s) => s.clearOverlaysSeq);
  const seenClearSeqRef = useRef(0);
  useEffect(() => {
    if (clearOverlaysSeq === seenClearSeqRef.current) return;
    seenClearSeqRef.current = clearOverlaysSeq;
    setBadgePopup(null);
    setStreakPopup(null);
  }, [clearOverlaysSeq]);
  useEffect(() => {
    // First gate: bail the instant the user is signed out, BEFORE inspecting
    // the still-cached `gamQuery.data` from their last session. The render
    // gate at the modal already checks `isAuthenticated`, but it can lose a
    // race against this effect: the cleanup at line 1170 clears `badgePopup`
    // on logout, then this effect re-fires (because user?.role flipped from
    // 'buyer' to undefined) and re-sets it — leaving a non-null popup queued
    // until the next paint. Also covers a more subtle case: a business user's
    // user?.role gate would not trip post-logout because user is null and
    // user?.role is undefined (NOT 'business'), so without this guard the
    // effect would proceed into the badge-set path with stale buyer-era data.
    if (!isAuthenticated) return;
    if (!splashDone) return; // wait for splash animation to finish
    if (showWelcomeModal) return; // don't overlap with welcome popup
    if (celebrationPending) return; // don't overlap with post-reservation celebration
    if (orderConfirmActive || orderFlowActive) return; // order-confirmed popup owns the foreground — defer
    // Never surface a badge DURING the first-login sequence — the "tutorial
    // finished" badge must appear only AFTER the whole demo is done/skipped.
    if (showTutorial) return; // advantage carousel up
    if (showDemoWelcome) return; // "Start demo" cover up
    if (walkthroughStep !== null) return; // interactive demo running
    if (user?.role === 'business') return; // partners have no badge system
    const gData = gamQuery.data as any;
    if (!gData?.newBadges?.length || !gData?.badges) return;
    for (const newBadgeId of gData.newBadges) {
      if (badgeShownRef.current.has(newBadgeId)) continue;
      badgeShownRef.current.add(newBadgeId);
      const badge = gData.badges.find((b: any) => b.id === newBadgeId);
      if (badge) {
        // Delay badge popup slightly to avoid modal collision
        setTimeout(() => {
          // Re-check the gate inside the timer in case the user opened
          // the order popup in the 500 ms between schedule and fire.
          const s = useCelebrationStore.getState();
          if (s.orderConfirmActive || s.orderFlowActive) return;
          setBadgePopup({ icon: badge.icon, nameKey: badge.nameKey, descKey: badge.descKey });
          badgeScale.setValue(0);
          Animated.spring(badgeScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
          setTimeout(() => setBadgePopup(null), 4000);
        }, 500);
        break;
      }
    }
  }, [gamQuery.data, splashDone, showWelcomeModal, celebrationPending, orderConfirmActive, orderFlowActive, showTutorial, showDemoWelcome, walkthroughStep, user?.role, isAuthenticated]);

  // ── Pickup streak celebration ───────────────────────────────────────────
  // Hydrate the last-celebrated pickup date so a cold start doesn't re-fire the
  // celebration for a pickup we already congratulated.
  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem('barakeat_streak_celebrated_date');
        if (v) { streakBaselineRef.current = v; streakInitRef.current = true; }
      } catch {}
      setStreakReady(true);
    })();
  }, []);

  // Detect a new pickup (last_pickup_date advanced) and celebrate the streak.
  // Dedup is on last_pickup_date — the streak only moves at pickup, so a newly
  // seen date means the buyer just had a basket confirmed picked up.
  useEffect(() => {
    // Same auth-gate as the badge effect above — keep stale buyer-era streak
    // celebrations from materialising on the sign-in screen post-logout.
    if (!isAuthenticated) return;
    if (!splashDone || !streakReady) return;
    if (showWelcomeModal || celebrationPending || showTutorial || showDemoWelcome) return;
    if (walkthroughStep !== null) return;
    if (orderConfirmActive || orderFlowActive) return; // order-confirmed popup owns the foreground — defer
    if (user?.role === 'business') return; // partners have no streak
    const gData = gamQuery.data as any;
    if (!gData) return;
    const pickupDate = gData.last_pickup_date ? String(gData.last_pickup_date).split('T')[0] : 'none';
    const streak = Number(gData.current_streak ?? 0);

    // First run after install/update: adopt the current state as the baseline
    // so a pickup that predates this feature can't fire a stale celebration.
    if (!streakInitRef.current) {
      streakInitRef.current = true;
      streakBaselineRef.current = pickupDate;
      void AsyncStorage.setItem('barakeat_streak_celebrated_date', pickupDate);
      return;
    }

    if (streak < 1 || pickupDate === 'none') return;
    if (streakBaselineRef.current === pickupDate) return; // already celebrated this pickup
    // A pickup that reaches streak 3 or 7 also unlocks a badge. Let the badge
    // popup go first; this effect re-runs when badgePopup clears (it's in the
    // deps) and the streak celebration follows. We DON'T persist the baseline
    // until we actually show it, so deferring never drops the celebration.
    if (badgePopup) return;

    streakBaselineRef.current = pickupDate;
    void AsyncStorage.setItem('barakeat_streak_celebrated_date', pickupDate);
    // Brief delay so we never paint over a modal that's mid-dismiss.
    setTimeout(() => {
      const s = useCelebrationStore.getState();
      if (s.orderConfirmActive || s.orderFlowActive) return;
      setStreakPopup({ streak });
      streakScale.setValue(0);
      Animated.spring(streakScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
      setTimeout(() => setStreakPopup(null), 4500);
    }, 500);
  }, [gamQuery.data, streakReady, splashDone, showWelcomeModal, celebrationPending, orderConfirmActive, orderFlowActive, showTutorial, showDemoWelcome, walkthroughStep, user?.role, badgePopup, isAuthenticated]);

  // Sequence the "Premiers pas" badge popup BEFORE the "add an address" prompt
  // on first login. endDemoSequence() flips `pendingAddressPrompt` true at the
  // end of the demo; this effect surfaces the prompt only once the badge popup
  // has had its turn (shown + dismissed), or once it's clear no badge is
  // coming. Without this gate the two race, and the address prompt flashes
  // up during the ~500-1000 ms window before the badge effect fires.
  useEffect(() => {
    if (badgePopup) {
      badgeWasShownRef.current = true;
      return;
    }
    if (!pendingAddressPrompt) return;
    // Fast follow if the user has already seen the badge dismiss; otherwise
    // grace-wait in case the gamification fetch is still producing one.
    const delay = badgeWasShownRef.current ? 250 : 1500;
    const t = setTimeout(() => {
      if (badgePopup) return; // raced; another effect run will retry
      setShowAddAddressPrompt(true);
      setPendingAddressPrompt(false);
      badgeWasShownRef.current = false;
    }, delay);
    return () => clearTimeout(t);
  }, [pendingAddressPrompt, badgePopup]);

  // Track partner's no-location state so the final tutorial slide knows to
  // show the "add your first location" CTA. Refresh on every onboarding check.
  const [partnerHasNoLocation, setPartnerHasNoLocation] = useState(false);
  // Business onboarding welcome context — the org name + whether the logged-in
  // partner is the org owner/admin (vs an invited member). Drives the first
  // business carousel slide's greeting (owner → "Bienvenue {org}" + owner name;
  // member → "Bienvenue {member name}"). Captured from fetchMyContext in the probe.
  const [bizWelcome, setBizWelcome] = useState<{ orgName: string; isOwner: boolean } | null>(null);
  // Business first-login "set your password" step — shown AFTER the demo and
  // BEFORE the dashboard's add-location popup (which stays gated on
  // onboardingSequenceActive until the password screen releases it). It is now a
  // dedicated route (app/business/set-password.tsx) using the same
  // AccountFlowPage form as settings, not an inline modal.

  // Check if user needs the post-login tutorial.
  //
  // Trigger: server-side `onboarding_completed` flag is false AND the device
  // hasn't already seen the interactive walkthrough. The previous condition
  // also fired whenever a partner had zero locations, but that meant the
  // tutorial + walkthrough re-launched on EVERY reload until they added a
  // location — extremely annoying. The "no location" case is now handled
  // INSIDE the walkthrough itself (via a single dedicated step), not as a
  // re-trigger condition out here.
  // Deferred until splashDone: this probe fires a network call + sets up a
  // Promise.race with a 6 s timeout, runs an AsyncStorage cache read on
  // failure, and ends with a setState burst (setTutorialChecked,
  // setShowTutorial, setPartnerHasNoLocation). All of that runs on the JS
  // thread and was a meaningful contributor to splash stutter on Android.
  // The tutorial / welcome modals downstream are ALREADY gated on
  // splashDone, so deferring the probe doesn't change observed UX —
  // tutorialChecked simply flips true a beat later, after the splash is
  // gone, and downstream effects pick up immediately.
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession) return;
    if (showSplash) return;
    // Don't probe (and don't fire the 3-slide welcome carousel) while the OAuth
    // first-login gender form is up at /auth/onboarding. The carousel is gated
    // on the SAME server `onboarding_completed=false` flag, and on the OAuth
    // path there's no splash to defer behind — so without this guard the
    // carousel pops OVER the gender form. OAuth sign-ups get the gender form as
    // their onboarding; standard/email sign-ups get the carousel. The gender
    // step stamps onboarding_completed=true and routes to /(tabs), where this
    // effect re-runs (segments[0] flips to the home group), the probe reads the
    // now-true flag, and no carousel shows — so each registration type sees
    // exactly one first-run surface, never both, never overlapping.
    if (segments[0] === 'auth') return;
    const uid = user?.id ? String(user.id) : null;
    if (!uid) return;
    // Run the actual probe at most once per uid while in-app. segments[0] is in
    // the dep list ONLY so the effect re-fires when the user crosses from the
    // /auth gender screen into their home group (the OAuth case) — it must NOT
    // re-probe on ordinary in-app navigation, or the welcome carousel re-shows
    // mid-demo (onboarding_completed is still false until the demo finishes),
    // looping forever. Reset on sign-out (effect below) so a re-login re-probes.
    if (probeRanForUidRef.current === uid) return;
    probeRanForUidRef.current = uid;
    setTutorialChecked(false); // re-gate notifications while we probe this user
    // Optimistically suppress home-screen auto-popups (notably the business
    // dashboard's add-location prompt) for the DURATION of this async probe.
    // That popup is gated on `onboardingSequenceActive`; without this, a
    // first-login business account fires it in the gap between the splash
    // ending and the probe resolving, then it gets yanked shut the instant the
    // probe flips the flag true — the "address popup flashed then the dashboard
    // froze" report. Released just below if the probe shows onboarding is done.
    useWalkthroughStore.getState().setOnboardingSequenceActive(true);
    (async () => {
      let onboardingCompleted = false;
      let probeFailed = false;
      // The probe blocks the green holding overlay that sits between splash
      // dismissal and the dashboard (see line ~891). If the server rate-limits
      // us (429 with a 30 s Retry-After), the default api.ts retry loop would
      // sit on this `await` for ~90 s and the user just sees a static green
      // screen. Three safeguards:
      //   1. `skip429Retry: true` makes the api client throw the 429 instantly
      //      instead of retrying.
      //   2. Promise.race with a 6 s wall-clock cap covers any OTHER slow path
      //      (cold backend, captive portal, DNS hiccup).
      //   3. We cache the last-known onboardingCompleted=true result in
      //      AsyncStorage so a transient probe failure (429, timeout, network
      //      blip) on a user who has ALREADY completed onboarding does NOT
      //      re-fire the first-login tutorial. Without this cache, a probe
      //      failure made the gate fall through to `!onboardingCompleted`
      //      which then showed the demo to an onboarded user — extremely
      //      annoying and the regression you just hit.
      const ONBOARDED_USERS_KEY = '@barakeat_onboarded_users';
      const PROBE_TIMEOUT_MS = 6000;
      const probeCall = apiClient
        .get('/api/auth/onboarding', { skip429Retry: true } as any)
        .then((res) => ({ kind: 'ok' as const, completed: !!res.data?.onboardingCompleted }))
        .catch((err) => ({ kind: 'err' as const, err }));
      const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ kind: 'timeout' }), PROBE_TIMEOUT_MS),
      );
      const probeResult = await Promise.race([probeCall, timeoutPromise]);
      if (probeResult.kind === 'ok') {
        onboardingCompleted = probeResult.completed;
      } else if (probeResult.kind === 'timeout') {
        probeFailed = true;
        console.log('[Onboarding] Probe timed out after', PROBE_TIMEOUT_MS, 'ms — releasing gate');
      } else {
        probeFailed = true;
        console.log('[Onboarding] Probe failed:', (probeResult.err as any)?.message ?? probeResult.err);
      }

      // Probe failure recovery: if we previously confirmed onboarding for THIS
      // user, treat them as still onboarded. Stops 429/timeout/network blips
      // from showing the demo to a user who has already completed it.
      if (probeFailed) {
        try {
          const raw = await AsyncStorage.getItem(ONBOARDED_USERS_KEY);
          const set = new Set<string>(raw ? JSON.parse(raw) : []);
          if (set.has(uid)) {
            onboardingCompleted = true;
            console.log('[Onboarding] Probe failed but cached onboardingCompleted=true for uid', uid, '— skipping tutorial');
          }
        } catch {
          // Cache unreadable — fall through; we still won't show the tutorial
          // because we gate on `probeFailed === false` below.
        }
      }
      // Probe success: write the result to the cache so future failures can
      // recover. Add on true, remove on false (so a backend reset re-arms the
      // tutorial as expected).
      if (!probeFailed) {
        try {
          const raw = await AsyncStorage.getItem(ONBOARDED_USERS_KEY);
          const set = new Set<string>(raw ? JSON.parse(raw) : []);
          const before = set.has(uid);
          if (onboardingCompleted) set.add(uid); else set.delete(uid);
          if (set.has(uid) !== before) {
            await AsyncStorage.setItem(ONBOARDED_USERS_KEY, JSON.stringify(Array.from(set)));
          }
        } catch {}
      }

      console.log(
        '[Onboarding] Probe result — uid:', uid,
        '| onboardingCompleted:', onboardingCompleted,
        '| probeFailed:', probeFailed,
      );
      // For partners, still check no-location status so the tutorial CAROUSEL
      // can include the "add your first location" slide on first onboarding —
      // but this no longer forces re-display on subsequent reloads.
      const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
      if (isBiz) {
        try {
          const ctx = await fetchMyContext();
          const locIds = (ctx as any)?.location_ids;
          setPartnerHasNoLocation(!Array.isArray(locIds) || locIds.length === 0);
          // Capture the org name + owner/member status for the welcome slide.
          // Owner/admin → greet with the ORG name (+ their own name); invited
          // members → greet with just their own name.
          const role = String((ctx as any)?.role ?? '').toLowerCase();
          setBizWelcome({
            orgName: String((ctx as any)?.organization_name ?? '').trim(),
            isOwner: role === 'owner' || role === 'admin',
          });
        } catch {
          // Treat fetch failures as "we don't know" — don't force the tutorial.
        }
      }
      // First login for THIS account — the per-user, server-side
      // `onboarding_completed` flag is false AND the probe actually succeeded.
      // `probeFailed === false` is critical: without it, every 429 / timeout
      // / network blip would fire the tutorial on an already-onboarded user.
      // The cache lookup above also flips `onboardingCompleted` to true on
      // recovery; this gate is the last line of defense.
      if (!probeFailed && !onboardingCompleted) {
        firstLoginDemoPendingRef.current = true;
        // Block any other auto-firing popup (the dashboard's
        // "Ajoutez votre premier point de vente" nudge, etc.) for the rest
        // of the onboarding flow — without this the dashboard popup races
        // the probe and presents OVER the splash/carousel because RN
        // modals always paint above plain React views. The flag is
        // cleared in endDemoSequence() (walkthrough finish / skip / quit).
        useWalkthroughStore.getState().setOnboardingSequenceActive(true);
        setShowTutorial(true);
        console.log('[Onboarding] showTutorial → true');
      } else {
        // Onboarding already complete (or the probe failed): release the
        // optimistic suppression set before the await so home-screen popups
        // (e.g. the dashboard add-location prompt) can paint normally. For a
        // genuine first login this branch is skipped, so the flag stays true
        // and the carousel/demo own the screen until endDemoSequence clears it.
        useWalkthroughStore.getState().setOnboardingSequenceActive(false);
      }
      // Resolve the gate regardless of whether the tutorial shows — downstream
      // popup effects depend on knowing "the onboarding probe has resolved",
      // not on the tutorial actually appearing.
      setTutorialChecked(true);
    })();
    // `segments[0]` is in the deps so the probe re-fires once the user leaves
    // /auth/onboarding for their home group — otherwise an OAuth first-login
    // would skip the probe entirely (above) and leave the notification gate
    // (`tutorialChecked`) latched closed.
  }, [isAuthenticated, isRestoringSession, user?.id, user?.role, (user as any)?.type, showSplash, segments[0]]);

  // ── First-run fast-path (brand-new registration) ──────────────────────────
  // verify-email sets `pendingFirstRun` right before signIn for a freshly
  // registered customer. We KNOW this account needs onboarding, so flip the
  // carousel ON immediately — without waiting for the async server probe.
  // Because the carousel mounts on `splashAnimDone` (a Modal, above the splash
  // view), it's already covering the screen the instant the splash tears down,
  // so the home screen never flashes between the two. The probe still runs and
  // confirms the same thing; this just front-runs its network latency. The
  // flag is one-shot — cleared here so ordinary navigation never re-triggers it
  // (which is the loop the demo's "add basket" step used to hit).
  useEffect(() => {
    if (!pendingFirstRun || !isAuthenticated) return;
    firstLoginDemoPendingRef.current = true;
    useWalkthroughStore.getState().setOnboardingSequenceActive(true);
    setShowTutorial(true);
    useWalkthroughStore.getState().setPendingFirstRun(false);
  }, [pendingFirstRun, isAuthenticated]);

  // Re-arm the once-per-uid probe guard on sign-out so a subsequent login
  // (even as the same user within one session) probes again. Also wipe any
  // probe-derived state so the welcome carousel can't render the previous
  // user's data during the next sign-in's race window between login and
  // probe resolution. The reported flash for business members was: the
  // first slide briefly read the prior owner's org name (held in
  // `bizWelcome` from their session) before the new probe resolved and
  // flipped the slide to the member-name branch. Clearing here means a
  // fresh login starts at the safe default (member name only) and only
  // flips to the org-name branch once the new probe confirms it.
  useEffect(() => {
    if (!isAuthenticated) {
      probeRanForUidRef.current = null;
      setBizWelcome(null);
      setPartnerHasNoLocation(false);
      // Also drop any badge / streak / welcome popups that were on screen
      // when the user signed out — see Bug 2 below. Otherwise the celebration
      // modals can linger over the sign-in screen for the 4-sec auto-clear
      // window. Cheap reset, no-op when nothing was open.
      setBadgePopup(null);
      setStreakPopup(null);
      badgeShownRef.current = new Set();
    }
  }, [isAuthenticated]);

  // Companion to the isAuthenticated→false cleanup above. Two purposes:
  //   1. Reset stale per-user probe state on every user.id change so the
  //      carousel never paints the prior user's slide.
  //   2. SEED bizWelcome SYNCHRONOUSLY from organizationName + orgRole on the
  //      user object — both are now included in the sign-in / google / apple
  //      login response, so they're available the instant signIn() returns,
  //      BEFORE the async fetchMyContext probe lands. Previously the probe
  //      was the sole source of bizWelcome, leaving a ~500ms window where the
  //      first carousel slide rendered "Bienvenue, <personal name>" then
  //      snapped to "Bienvenue, <org name>" once the probe resolved — the
  //      reported "snaps mid-animation" flash. With the seed, an owner gets
  //      the right greeting on the very first paint; the probe remains as
  //      the source of truth that confirms / corrects later.
  useEffect(() => {
    const orgName = (user as any)?.organizationName as string | null | undefined;
    const orgRole = String((user as any)?.orgRole ?? '').toLowerCase();
    if (orgName && (orgRole === 'owner' || orgRole === 'admin')) {
      setBizWelcome({ orgName: orgName.trim(), isOwner: true });
    } else {
      setBizWelcome(null);
    }
    setPartnerHasNoLocation(false);
    probeRanForUidRef.current = null;
  }, [user?.id]);

  // Register for push notifications on startup whenever the user has push ON
  // (the default). Previously this was commented out, so the Expo push token was
  // only ever registered when the user MANUALLY toggled the setting — meaning a
  // returning user with push enabled got NO phone notifications until they
  // toggled it off and back on (the bug seen in testing). Re-registering here on
  // every authenticated launch is idempotent (same token) and closes that gap.
  // Skips only when the user explicitly turned push OFF. No-ops in Expo Go.
  // Keep the backend's stored locale in lock-step with the app language so OS
  // push banners switch language the INSTANT the user changes it — from anywhere,
  // not just Settings. i18next emits 'languageChanged' on every switch; the sync
  // is a harmless no-op when logged out (the auth-triggered sync below seeds it
  // after login).
  useEffect(() => {
    const onLang = (lng: string) => {
      try { require('@/src/services/locale').syncLocaleToBackend(lng); } catch {}
    };
    i18n.on('languageChanged', onLang);
    return () => { i18n.off('languageChanged', onLang); };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || isRestoringSession) return;
    // Defer until the splash dismisses — token registration's network + native
    // work otherwise stutters the login splash on Android (this effect fires
    // exactly when isAuthenticated flips true at login).
    if (showSplash) return;
    // Report the app's language to the backend so OS push banners localize to it
    // (independent of the push on/off toggle below).
    try { require('@/src/services/locale').syncLocaleToBackend(); } catch {}
    (async () => {
      try {
        const { ensurePushRegistered } = require('@/src/services/pushNotifications');
        await ensurePushRegistered(user?.id);
      } catch {}
    })();
    // NB: user?.id is in the deps so switching accounts (which keeps
    // isAuthenticated=true) ALSO re-registers. The pref is now per-user
    // (pushPrefKeyForUser) so account A's "OFF" no longer suppresses account
    // B's auto-registration — the global key bug is what made "switched
    // accounts, no pushes" recur every time.
  }, [isAuthenticated, isRestoringSession, user?.id, showSplash]);

  // Safety net: every foreground resume re-registers if (OS perm granted AND
  // per-user pref allows). The PUT is idempotent (ON CONFLICT DO UPDATE on
  // device_push_tokens), so spamming it costs one cheap network call. This
  // covers the case where the user granted OS push permission outside the
  // app (system Settings → Barakeat → Notifications) and returned — the
  // device's token row may still be pinned to a previous user, and without
  // this resume-time rebind the toggle can show ON while pushes silently
  // drop. The Settings-screen-only handler we had before missed every
  // resume the user spent on any other screen.
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession) return;
    const tryRegister = () => {
      try {
        const { ensurePushRegistered } = require('@/src/services/pushNotifications');
        void ensurePushRegistered(user?.id);
      } catch {}
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tryRegister();
    });
    return () => sub.remove();
  }, [isAuthenticated, isRestoringSession, user?.id]);

  // Reset the home-screen app-icon badge when the app is foregrounded or the
  // signed-in user changes. We DELIBERATELY do NOT wipe the notification tray on
  // an ordinary foreground anymore — delivered notifications should persist
  // (Messenger-style) rather than disappearing every time the app is opened
  // (the old behavior made a pickup/cancel notification look like it "deleted"
  // the earlier ones). The tray IS cleared on mount / auth or user change
  // (dismissTray=true) so a freshly-signed-in account never inherits the
  // previous account's notifications.
  useEffect(() => {
    const clearBadge = (dismissTray: boolean) => {
      try {
        const { clearNotificationBadge } = require('@/src/services/pushNotifications');
        void clearNotificationBadge(dismissTray);
      } catch {}
    };
    clearBadge(true); // mount + auth/user change → also clear tray (account switch safety)
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') clearBadge(false); });
    return () => sub.remove();
  }, [isAuthenticated, user?.id]);

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
    if (showSplash) return; // defer hydration until the splash dismisses (Android halo lag)
    if (isAuthenticated && user?.id) {
      if (storeUserId !== user.id) {
        void hydrateNotifForUser(String(user.id));
      }
    } else if (storeUserId) {
      resetNotifForLogout();
    }
  }, [isAuthenticated, isRestoringSession, user?.id, storeUserId, hydrateNotifForUser, resetNotifForLogout, showSplash]);

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
    if (celebrationPending || orderFlowActive) return; // wait for the new-order animation to finish
    if (useWalkthroughStore.getState().step !== null) return;
    if (useWalkthroughStore.getState().showDemoWelcome) return; // "Start demo" cover up
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
          // Parse the message JSON's `key` upfront. Cancellation notifs are
          // routed by message-key, not just type, because the SAME type
          // ('reservation_cancelled') is sent to BOTH parties — the actor and
          // the other side. The key distinguishes which audience: an "internal"
          // / "buyer_cancellation" key means the recipient initiated the cancel,
          // so we suppress the centered popup for them (push + bell list entry
          // still fire — they just don't get an alert on screen for an action
          // they themselves performed).
          const parseMsgKey = (raw?: string | null): string => {
            if (!raw) return '';
            try { const p = JSON.parse(raw); return String(p?.key ?? ''); } catch { return ''; }
          };
          const filtered = newOnes.filter((n: any) => {
            const t = n.type ?? '';
            const msgKey = parseMsgKey(n.message);
            if (isBiz) {
              // Business — skip the popups that would surface noise on top of
              // what the merchant just saw / handled themselves:
              //  · pickup_confirmed / basket_picked_up / collected / picked_up —
              //    they already watched the full-page success animation in
              //    scan-qr.tsx the moment they confirmed.
              //  · order_confirmed — that one is for buyers.
              //  · business_cancelled_internal — the business is the actor on
              //    this one. Push + bell list still fire so they can still
              //    audit it, but the on-screen alert at the actor reads as
              //    redundant.
              // NB: message / reply notifs DO flow through to the popup queue;
              // InAppNotification.tsx detects the type and renders the
              // SpeechBubblePopup (drops from the top of the screen) instead
              // of the centered carousel. The previous "filter chat out" rule
              // assumed a separate icon-launched mechanism existed — it didn't,
              // so the bubble never showed for the merchant.
              if (t.includes('pickup_confirmed')) return false;
              if (t.includes('basket_picked_up')) return false;
              if (t.includes('collected')) return false;
              if (t.includes('picked_up')) return false;
              if (t.includes('order_confirmed')) return false;
              if (msgKey.startsWith('notif_message_business_cancelled_internal')) return false;
              return true;
            }
            // Customer: skip order_confirmed + new_reservation (already shown
            // on reservation success screen), AND skip the buyer_cancellation
            // popup — the customer is the actor on their own cancel, the bell
            // list entry is enough confirmation.
            if (t.includes('order_confirmed')) return false;
            if (t.includes('new_reservation')) return false;
            if (msgKey.startsWith('notif_message_buyer_cancellation')) return false;
            return true;
          });
          if (filtered.length > 0) {
            // Show the 3 newest role-appropriate notifications as a popup carousel.
            // pushPopups is idempotent (it skips already-shown IDs), so repeated polls
            // during the same session won't double-show the same notif.
            const toShow = filtered.sort((a: any, b: any) => b.id - a.id).slice(0, 3);
            pushPopups(toShow);
            // Mirror the OS-push listener: when any of the surfaced notifs is
            // chat-related (message / reply), invalidate the chat caches so the
            // header chat-icon badge bumps the instant the popup appears,
            // instead of waiting up to 30 s for the next conversations poll.
            // Without this the symptom was exactly what the user reported:
            // the "new message" popup arrives via this in-app poll path (not
            // the OS listener, because the device's push channel is gated by
            // the EAS dev build), and the badge stayed at its previous value
            // until the layout-level poll ticked.
            const hasChatNotif = toShow.some((n: any) => {
              const t = String(n.type ?? '');
              return t.includes('message') || t.includes('reply');
            });
            if (hasChatNotif) {
              void qc.invalidateQueries({ queryKey: ['conversation-unreads'] });
              void qc.invalidateQueries({ queryKey: ['conversations'] });
              void qc.invalidateQueries({ queryKey: ['unread-count'] });
            }
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
  }, [isAuthenticated, isRestoringSession, storeHydrated, user?.id, storeUserId, pushPopups, splashDone, tutorialChecked, showTutorial, showWelcomeModal, celebrationPending, orderFlowActive]);

  // Also listen for push notifications if available
  // SDK 53+ removed Android push notification support from Expo Go — we
  // lazy-require expo-notifications here so the warning never fires in Go.
  useEffect(() => {
    if (isExpoGo && Platform.OS === 'android') return;
    const Notifications = require('expo-notifications');
    const subscription = Notifications.addNotificationReceivedListener((notif: any) => {
      // Trigger an immediate refetch via the poll function — DO NOT push a
      // synthetic popup with `Date.now()` as id, because the poll-driven
      // copy of the same notification arrives shortly with the real
      // backend id and `pushPopups`'s dedup-by-id would miss the duplicate,
      // surfacing the same notification twice on screen.
      void pollNotifsRef.current?.();
      // Also invalidate the chat-related caches so the unread badges on the
      // order cards (customer + business) update the moment a new message
      // notif lands, instead of waiting for the next 30 s poll. The
      // notification listener doesn't reliably parse the payload here
      // (multiple notif types share this hook), so we just invalidate
      // unconditionally — the cost is two cheap GETs at the moment of any
      // notif, but the UX gain is the badge appearing in real time when a
      // chat message arrives.
      void qc.invalidateQueries({ queryKey: ['conversation-unreads'] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      // The chat-icon badge in the business header is computed off
      // `['unread-count']`; the business conversations page also reads
      // `['today-orders']` / `['location-orders']` to join each
      // conversation to its reservation. Without these two extra
      // invalidations, a new customer message landed but:
      //   • the merchant header's chat-icon badge waited up to 20 s
      //     for the next unread-count poll (the "after a while" report);
      //   • the new conversation row sat in the list with empty basket /
      //     order-code chips until today-orders polled again, because
      //     the freshly-placed reservation wasn't in that cache yet.
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
      void qc.invalidateQueries({ queryKey: ['today-orders'] });
      void qc.invalidateQueries({ queryKey: ['location-orders'] });
      // member_updated: an admin just changed this user's role / permissions
      // / location membership. Invalidate `my-context` so the next read
      // returns the new values; the (business) layout's role-change
      // detection effect notices the JSON-stringified diff and fires the
      // refresh splash + invalidates the downstream queries (org-details,
      // today-orders, baskets). Parsing the data payload type means this
      // doesn't fire `my-context` invalidations on every chat message
      // — only on the push that actually changed the gate inputs.
      try {
        const data = notif?.request?.content?.data;
        const typ = String(data?.type ?? '').toLowerCase();
        if (typ === 'member_updated') {
          void qc.invalidateQueries({ queryKey: ['my-context'] });
        }
      } catch {}
    });
    return () => subscription.remove();
  }, []);

  // Navigate when the user TAPS an OS push notification. Chat messages open the
  // conversation thread; every other notification opens the notifications page
  // (where the in-app card/popup lives). Reads only the push `data` payload
  // (type / conversationId) so it works for both warm taps and cold starts.
  // Previously tapping a push did nothing — there was no response listener.
  useEffect(() => {
    if (isExpoGo && Platform.OS === 'android') return;
    const Notifications = require('expo-notifications');
    const routeFromData = (data: any) => {
      try {
        const type = String(data?.type ?? '').toLowerCase();
        if (type.includes('message') || type.includes('reply')) {
          const convId = data?.conversationId ?? data?.conversation_id;
          router.push(convId
            ? ({ pathname: '/message/[id]', params: { id: String(convId) } } as never)
            : ('/messages' as never));
          return;
        }
        router.push('/notifications' as never);
      } catch {}
    };
    const sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
      // Auth-gate the foreground tap the same way as the cold-start handler
      // below. A push that lands while the user is on /auth/verify-email or
      // /auth/sign-in (e.g. a broadcast aimed at their pre-verified account,
      // or a stray push from a previous session on the device) used to route
      // unconditionally to /notifications — where the loader spun forever
      // because the fetch 401'd with no auth header. Bailing here keeps the
      // user on the auth screen they're actually trying to use.
      const s = useAuthStore.getState();
      if (!s.isAuthenticated || s.isRestoringSession) return;
      routeFromData(response?.notification?.request?.content?.data);
    });
    // Cold start: app launched by tapping a notification while it was killed.
    // Defer briefly + require an authenticated, restored session so we don't
    // fight the splash → home routing or strand a logged-out user on a screen.
    //
    // CRITICAL de-dupe: getLastNotificationResponseAsync() returns the most
    // recent TAPPED notification and KEEPS returning it on every subsequent
    // cold start — even when the app was opened normally, not via that
    // notification. Without guarding, every launch (once the session restores
    // as authenticated) re-routed to /notifications off a stale tap — the
    // "I reopened the app and randomly landed on the notifications page (with
    // the splash over it)" bug. We persist the handled response's identifier
    // and consume it once, so we only navigate on a genuinely NEW tap.
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (!last) return;
        const HANDLED_KEY = 'lastHandledNotifResponseId';
        const respId = last.notification?.request?.identifier ?? null;
        if (respId) {
          const alreadyHandled = await AsyncStorage.getItem(HANDLED_KEY);
          if (alreadyHandled === respId) return; // stale response from a prior launch
          // Mark consumed NOW so it can never re-fire on a future cold start,
          // regardless of whether the auth gate below lets us route this time.
          await AsyncStorage.setItem(HANDLED_KEY, respId);
        }
        setTimeout(() => {
          const s = useAuthStore.getState();
          if (s.isAuthenticated && !s.isRestoringSession) {
            routeFromData(last.notification?.request?.content?.data);
          }
        }, 1200);
      } catch {}
    })();
    return () => sub.remove();
  }, [router]);

  const startWalkthrough = useWalkthroughStore((s) => s.startWalkthrough);

  const isBusiness = user?.role === 'business' || (user as any)?.type === 'restaurant';

  // Open the "Start demo" cover for the current role, starting the demo sequence
  // (advantage carousel → cover → walkthrough → end). Called by the carousel's
  // final CTA / Skip. Does NOT flip the server onboarding flag — that happens
  // once the WHOLE demo ends (see endDemoSequence) so the finished badge can't
  // appear early.
  const openDemoCover = (forBusiness: boolean) => {
    setShowTutorial(false);
    setTutorialPage(0);
    const w = useWalkthroughStore.getState();
    w.setDemoSequencePending(true);
    if (forBusiness) {
      // The cover's "Start demo" routes to the dashboard before starting the
      // business walkthrough.
      w.setShowDemoWelcome(true);
    } else {
      // Ensure the home tab is mounted under the cover (demo card injects from
      // frame one) and give the customer a usable location when they have no
      // saved address, so real cards show a distance and the map works.
      try { router.replace('/(tabs)/' as never); } catch {}
      const addr = useAddressStore.getState();
      if (addr.addresses.length === 0) {
        addr.setDemoAddress({ id: 'demo-grand-tunis', label: 'Grand Tunis', lat: 36.8065, lng: 10.1815 });
      }
      w.setDemoCustomerActive(true);
      w.setShowDemoWelcome(true);
    }
  };

  // Runs exactly once when a demo sequence ends — walkthrough finished, skipped,
  // or quit at the "Start demo" cover. Idempotent via demoSequencePending.
  const endDemoSequence = async () => {
    const w = useWalkthroughStore.getState();
    if (!w.demoSequencePending) return;
    w.setDemoSequencePending(false);
    // Did the user QUIT ("Quitter la démo") vs reach the end? skipWalkthrough
    // sets demoQuit; completion does not. Combined with wasFirstLogin below it
    // tells us a quit from a Settings → Mode démo run, which should return the
    // user to /settings (vs an onboarding/first-login quit → role home).
    const wasQuit = w.demoQuit;
    // NOTE: `onboardingSequenceActive` is intentionally NOT cleared here. For a
    // business first login we keep it TRUE so the dashboard's add-location popup
    // stays deferred behind the "set your password" step below; it's cleared at
    // the very end of this function (or when the password modal is dismissed).

    // Pull `user` fresh from the store at run-time instead of relying on the
    // closure's `user` value — a stale closure (e.g. captured mid-render
    // before the auth restore completed) was misclassifying a business
    // account as a customer and bouncing them to /(tabs)/ at demo end.
    // Path-aware fallback: if the current route is under any /business/*
    // or /(business)/* segment, treat as business regardless of what the
    // user object happens to say. This is the user-reported "Next on the
    // team-management last step took me to search page" symptom —
    // endDemoSequence was routing to /(tabs)/ because biz=false.
    const freshUser = useAuthStore.getState().user;
    const onBizPath = Array.isArray(segments) && segments.some((s) => s === 'business' || s === '(business)');
    const biz =
      freshUser?.role === 'business' ||
      (freshUser as any)?.type === 'restaurant' ||
      user?.role === 'business' ||
      (user as any)?.type === 'restaurant' ||
      onBizPath;
    // Capture this BEFORE the first-login branch consumes it so we can also
    // use it below for the "land on search tab" routing.
    const wasFirstLogin = firstLoginDemoPendingRef.current;
    // Quit from a Settings-launched demo (NOT first-login onboarding): the user
    // opened "Mode démo" from /settings, so send them straight back there.
    // Onboarding quits fall through to the role-home routing below.
    const wasSettingsDemo = wasQuit && !wasFirstLogin;

    // (a) First login only: mark onboarding complete server-side and refresh
    // gamification so the "tutorial finished" badge surfaces now (post-demo).
    if (wasFirstLogin) {
      firstLoginDemoPendingRef.current = false;
      try {
        await apiClient.put('/api/auth/onboarding');
        // Surface the "Premiers pas" badge directly so it appears whether the
        // user FINISHED or QUIT the demo. The reactive badge effect alone could
        // miss the quit path: the demo ends instantly, so the gamification
        // refetch races the post-demo address prompt and can land in a render
        // gap where a transient gate swallows it. A forced fetch here (the FIRST
        // gamification read after onboarding_completed flips true returns the
        // badge in `newBadges`) makes the popup deterministic; badgeShownRef
        // dedupes against the reactive effect so it never double-fires.
        try {
          const gd: any = await qc.fetchQuery({ queryKey: ['gamification-stats'], queryFn: fetchGamificationStats, staleTime: 0 });
          const newId = (gd?.newBadges ?? []).find((id: string) => !badgeShownRef.current.has(id));
          const badge = newId && gd?.badges ? gd.badges.find((b: any) => b.id === newId) : null;
          const cs = useCelebrationStore.getState();
          if (badge && !biz && !cs.orderConfirmActive && !cs.orderFlowActive) {
            badgeShownRef.current.add(newId);
            setBadgePopup({ icon: badge.icon, nameKey: badge.nameKey, descKey: badge.descKey });
            badgeScale.setValue(0);
            Animated.spring(badgeScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
            setTimeout(() => setBadgePopup(null), 4000);
          }
        } catch {}
        // Mirror the server flag into the local cache so a probe-failure on
        // the very next reload (e.g. backend is still in the 429 window we
        // just escaped) can't re-fire the tutorial we literally just finished.
        try {
          const uid = user?.id ? String(user.id) : null;
          if (uid) {
            const raw = await AsyncStorage.getItem('@barakeat_onboarded_users');
            const set = new Set<string>(raw ? JSON.parse(raw) : []);
            if (!set.has(uid)) {
              set.add(uid);
              await AsyncStorage.setItem('@barakeat_onboarded_users', JSON.stringify(Array.from(set)));
            }
          }
        } catch {}
      } catch {}
    }

    // Customer demo always ends on the search tab — regardless of whether
    // it was a first-login auto-show or a manual Settings → Mode démo
    // replay. The walkthrough's last step pushes /settings (highlighted
    // for the "you can replay the demo anytime" beat), and once the user
    // taps "OK, terminer la démo" we pop /settings off the stack and land
    // them on /(tabs)/ where they can actually start using the app. The
    // previous version gated this on `wasFirstLogin`, leaving Settings →
    // Mode démo replays stranded on /settings with the demo-time
    // /wallet still in the back stack — tapping back went to /wallet
    // instead of the search tab. Business users keep their current
    // end-of-tour position (partner dashboard) — their walkthrough's
    // settings step lands in business settings which is the natural
    // place to leave a partner.
    if (wasSettingsDemo) {
      // Launched from Settings → Mode démo and quit mid-tour: return the user to
      // the settings page they opened it from (customer AND business).
      try { router.replace('/settings' as never); } catch {}
    } else if (!biz) {
      try { router.replace('/(tabs)/' as never); } catch {}
    }

    // (c) Drop the transient demo location.
    useAddressStore.getState().clearDemoAddress();

    // (c.1) Restore the pre-demo favorites snapshot so any favorite added or
    // removed inside the walkthrough (e.g. starring the Chez Joe demo
    // location) doesn't leak into the real account. Idempotent — if the
    // snapshot was never captured (rare race), we leave favorites untouched.
    const favSnapshot = demoFavoritesSnapshotRef.current;
    if (favSnapshot) {
      useFavoritesStore.getState().replaceAll(favSnapshot);
      demoFavoritesSnapshotRef.current = null;
    }

    // (b) Nudge to add an address — customers only. The business
    // "add your first location" nudge used to fire here too, but the
    // dashboard now surfaces its own popup on every focus while the org
    // has no location (see [dashboard.tsx]), so this second prompt is
    // redundant. Customers we still queue via `pendingAddressPrompt` so
    // the badge popup (fires from the gamification refetch above) gets
    // the stage first. The sequencing effect upstream watches
    // `badgePopup` and flips the real `showAddAddressPrompt` once clear.
    if (!biz && !wasSettingsDemo && useAddressStore.getState().addresses.length === 0) {
      badgeWasShownRef.current = false;
      setPendingAddressPrompt(true);
    }

    // (d) Business FIRST login: surface the "set your password" step now —
    // between the demo (just ended) and the dashboard's add-location popup,
    // which stays deferred because we left `onboardingSequenceActive` TRUE
    // above. Dismissing the modal (save or skip) clears that flag so the
    // location popup can finally paint. Non-first-login or customer flows
    // unblock immediately.
    if (wasSettingsDemo) {
      // Already routed to /settings above (Settings-launched demo quit). Just
      // release the onboarding gate so nothing stays deferred behind it.
      useWalkthroughStore.getState().setOnboardingSequenceActive(false);
    } else if (biz && wasFirstLogin) {
      // Send them to the dedicated "set your password" screen (the same
      // AccountFlowPage form as settings). The onboarding gate stays TRUE; that
      // screen releases it when the user saves/skips and lands on the dashboard.
      router.push('/business/set-password' as never);
    } else {
      useWalkthroughStore.getState().setOnboardingSequenceActive(false);
    }
  };

  // Detect the end of a demo sequence: the walkthrough finishing/skipping (step
  // non-null → null) OR the cover being quit (showDemoWelcome true → false while
  // no walkthrough started — pressing "Start demo" flips step to 0 in the same
  // commit, so that path is NOT treated as a quit).
  useEffect(() => {
    const prevStep = prevWalkStepRef.current;
    const prevCover = prevShowDemoWelcomeRef.current;
    prevWalkStepRef.current = walkthroughStep;
    prevShowDemoWelcomeRef.current = showDemoWelcome;
    if (!useWalkthroughStore.getState().demoSequencePending) return;
    const walkthroughJustEnded = prevStep !== null && walkthroughStep === null;
    const coverJustQuit = prevCover && !showDemoWelcome && walkthroughStep === null;
    if (walkthroughJustEnded || coverJustQuit) {
      void endDemoSequence();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkthroughStep, showDemoWelcome]);

  // The first-login advantage carousel — the same WHITE "what is Barakeat" pages
  // that used to show pre-login, now shown once after a brand-new account's first
  // login (the redundant green slides were removed). Business gets its own set.
  // Customer onboarding (3 slides). Order is intentional:
  //   1. proximity (the immediate value prop)
  //   2. savings (the personal benefit)
  //   3. anti-waste (the mission)
  // The 4th "paiement sur place" slide was dropped — payment options are
  // surfaced at reservation time, not at app intro.
  // A slide is either an icon slide (existing intro pages) OR an image slide
  // (the new gendered "Bienvenue sur Barakeat, <Name>" welcome shown first).
  type OnboardingSlide = {
    icon?: React.ReactNode;
    image?: any;
    titleKey?: string;
    descKey?: string;
    title?: string;
    desc?: string;
  };
  // Welcome slide #0 (customers): gendered basket-holder image + the user's
  // first name. Mirrors the OAuth onboarding.tsx welcome screen so both
  // registration paths greet the user the same way. Defaults to the man image
  // when gender was skipped.
  const onboardingFirstName = (user?.name ?? '').trim().split(/\s+/)[0] || '';
  const onboardingWelcomeImg = (user as any)?.gender === 'female'
    ? require('@/assets/images/woman_holding_basket-removebg-preview.png')
    : require('@/assets/images/man_holding_basket-removebg-preview.png');
  const customerSlides: OnboardingSlide[] = [
    {
      image: onboardingWelcomeImg,
      title: onboardingFirstName
        ? t('auth.welcomeNamed', { name: onboardingFirstName, defaultValue: 'Bienvenue sur Barakeat, {{name}} !' })
        : t('auth.welcome', { defaultValue: 'Bienvenue sur Barakeat !' }),
      desc: t('auth.welcomeSubtitle', { defaultValue: 'Ensemble, réduisons le gaspillage alimentaire, un panier à la fois.' }),
    },
    { icon: <MapPin size={56} color="#114b3c" />, titleKey: 'onboarding.slide1.title', descKey: 'onboarding.slide1.description' },
    { icon: <Package size={56} color="#114b3c" />, titleKey: 'onboarding.slide2.title', descKey: 'onboarding.slide2.description' },
    { icon: <ShoppingBag size={56} color="#114b3c" />, titleKey: 'onboarding.slide3.title', descKey: 'onboarding.slide3.description' },
  ];

  // Business welcome slide #0: a big storefront icon + a personalised greeting.
  // Owner/admin sees the ORG name as the headline with their own name beneath;
  // an invited member sees just their own name (no org headline). Mirrors the
  // customer welcome slide so both first-login flows greet the user up front.
  const bizOwnerName = (user?.name ?? '').trim().split(/\s+/)[0] || '';
  const businessWelcomeSlide: OnboardingSlide = bizWelcome?.isOwner && bizWelcome?.orgName
    ? {
        icon: <Store size={56} color="#114b3c" />,
        title: t('onboarding.bizWelcomeOwner', { org: bizWelcome.orgName, defaultValue: 'Bienvenue sur Barakeat, {{org}} !' }),
        desc: bizOwnerName
          ? t('onboarding.bizWelcomeOwnerSub', { name: bizOwnerName, defaultValue: 'Ravis de vous compter parmi nous, {{name}}.' })
          : t('onboarding.bizWelcomeSubtitle', { defaultValue: 'Transformez vos invendus en revenus, un panier à la fois.' }),
      }
    : {
        icon: <Store size={56} color="#114b3c" />,
        title: bizOwnerName
          ? t('onboarding.bizWelcomeMember', { name: bizOwnerName, defaultValue: 'Bienvenue sur Barakeat, {{name}} !' })
          : t('auth.welcome', { defaultValue: 'Bienvenue sur Barakeat !' }),
        desc: t('onboarding.bizWelcomeSubtitle', { defaultValue: 'Transformez vos invendus en revenus, un panier à la fois.' }),
      };
  const businessSlides: OnboardingSlide[] = [
    businessWelcomeSlide,
    { icon: <TrendingUp size={36} color="#114b3c" />, titleKey: 'onboarding.biz1.title', descKey: 'onboarding.biz1.description' },
    { icon: <Package size={36} color="#114b3c" />, titleKey: 'onboarding.biz2.title', descKey: 'onboarding.biz2.description' },
    { icon: <ClipboardList size={36} color="#114b3c" />, titleKey: 'onboarding.biz3.title', descKey: 'onboarding.biz3.description' },
    { icon: <BarChart3 size={36} color="#114b3c" />, titleKey: 'onboarding.biz4.title', descKey: 'onboarding.biz4.description' },
  ];

  const tutorialSlides = isBusiness ? businessSlides : customerSlides;

  return (
    <GestureHandlerRootView style={styles.container}>
      <ErrorBoundary>
      <InAppNotification />
      {/* Stack stays MOUNTED at all times — gating it on `!showSplash`
          previously caused `router.replace(...)` calls made during the splash
          window (e.g. sign-in's redirect to /(tabs)) to fail with "the action
          REPLACE was not handled by any navigator" and stranded the user
          back on /auth/sign-in once the splash ended. The splash now lives
          inside a <Modal> below, which on Android creates its own native
          window above the React Native activity — so the dashboard /tabs
          can't paint over the animation even though the Stack is mounted
          underneath. (No-race version of the unmount approach.) */}
      <RootLayoutNav />
      <DemoWelcomeCover />
      {/* Globally-mounted so it survives the reserve.tsx → /(tabs)/orders
          navigation transition without a black/white flash between the
          "Réservation confirmée" modal and the "Bien joué" celebration. */}
      <PostReservationCelebration />
      {/* Splash overlay. Plain absolutely-positioned wrapper — NOT a Modal.
          Modal on iOS spins up a new UIViewController, and expo-splash-screen
          tracks the native splash per-view-controller; with the splash inside
          a Modal, hideAsync() landed on a VC that had no splash registered
          and threw "No native splash screen registered for given view
          controller." Plain View has no such bookkeeping.
          z-order strategy:
            • zIndex: 99999 — wins the iOS render-order tiebreaker (RN uses
              render order on iOS by default, but zIndex is honored when
              specified, so this is belt-and-braces against any sibling that
              also sets one).
            • elevation: 99999 — Android's drawing order isn't render-order;
              it's elevation. Without this, the Stack's first screen would
              paint over the splash whenever it renders later in the frame,
              which is the "I saw the dashboard for a frame before the
              animation started" symptom we've been chasing.
            • position absolute + StyleSheet.absoluteFillObject inside the
              halo splash itself covers the full screen including the status
              bar strip (the halo's bg is #104A3B and reaches edge-to-edge).
          Only mounted while `showSplash` is true so the wrapper unmounts
          cleanly the moment the splash dismisses. */}
      {showSplash && (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 99999,
            elevation: 99999,
          }}
        >
          <BarakeatHaloSplash
            onFinish={handleSplashFinish}
            onMounted={() => setSplashOverlayReady(true)}
          />
        </View>
      )}
      {/* The post-splash holding overlay was removed in favour of a snappy
          handoff. It used to paint solid brand-green from the moment the
          splash finished until the onboarding probe resolved (~300 ms on a
          good network, longer on a slow one) so that the first-login tutorial
          could land on a green canvas instead of a freshly-rendered
          dashboard. The cost of that polish was a perceived "loading lag" on
          EVERY reload — even for returning users for whom the probe will
          never fire a tutorial. Trade made: returning-user reloads now hand
          off straight into the dashboard, and brand-new accounts see the
          dashboard for ~300 ms before the white advantage carousel paints on
          top (a one-time, per-account event). The carousel itself uses a
          Modal with animationType="fade", so the brief flash reads as a
          fade-in rather than a glitch. If we ever want to bring back the
          full polish, gate it on a hydrated "isLikelyOnboarded" cache flag
          rather than the unconditional `!tutorialChecked` we had here. */}
      {/* "Welcome back" — returning users only. Gated on the onboarding probe
          having resolved (tutorialChecked) AND the first-login tutorial NOT
          showing, so a brand-new user never sees "back" (they get the welcome
          tutorial + demo instead), with no flash before the probe resolves.
          Also gated on splashDone so the modal never paints over the bag-tip
          animation when sign-in is fast (cached session + fast device). */}
      {showWelcomeModal && splashDone && user?.role !== 'business' && tutorialChecked && !showTutorial && (
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
      {/* First-login advantage carousel — full-page takeover (no scrim, no
          centered card). Each slide spans the full window width so the icon
          + copy can breathe. On finish/skip it opens the "Start demo" cover
          instead of jumping straight to the walkthrough. Gated on splashDone
          so the carousel never lands on top of the splash animation. */}
      {/* Gated on `splashDone` so the loading-screen animation plays in FULL and
          the splash is fully torn down BEFORE the welcome / onboarding carousel
          appears — a clean splash → welcome hand-off with no overlap. The flash
          that used to happen here came from the async onboarding probe flipping
          `showTutorial` only AFTER the splash was already gone; `pendingFirstRun`
          now flips it DURING the splash for a fresh registration, so the carousel
          is ready to mount the instant `splashDone` flips. `animationType="none"`
          makes it appear in the same commit the splash unmounts, so there's no
          fade-in window for the home screen to peek through. Non-first-run users
          keep `showTutorial` false, so this never shows. */}
      {showTutorial && splashDone && (
        <Modal visible animationType="none" onRequestClose={() => openDemoCover(isBusiness)} statusBarTranslucent presentationStyle="overFullScreen">
          {/* NO 'top' safe-area edge: the top row is positioned purely by its
              explicit paddingTop (Constants.statusBarHeight + 8), EXACTLY like
              the demo cover's "Quitter" button. Keeping the 'top' edge here
              double-counted the inset on devices where the in-Modal SafeAreaView
              resolves a real top inset, shoving this row well below the Quit
              button — the "still not aligned / move it up" report. */}
          {/* bg matches the demo start cover (DemoWelcomeCover uses
              theme.colors.bg = #fcfcfa) so the carousel → demo-cover hand-off
              has no background-color shift. `theme` isn't in scope here, so the
              token value is inlined. */}
          <SafeAreaView style={{ flex: 1, backgroundColor: '#fcfcfa' }} edges={['bottom']}>
            {/* Single top row: page index on the left, language switcher in
                the centre, Skip on the right. The language pills match the
                pre-welcome onboarding screen — flat rounded rects, solid
                brand-primary fill when active, transparent otherwise, no
                border. Tapping switches i18n + persists the choice to
                AsyncStorage so the carousel re-renders with the chosen copy.

                Safe-area fix (iOS + Android): the in-modal SafeAreaView reports
                a 0 top inset because the Modal is its own native window outside
                the SafeAreaProvider, so the counter/Skip row painted over the
                status-bar clock/battery on BOTH platforms.

                Anchor: match the demo cover's "Quitter" TEXT baseline exactly.
                That button is `top: Constants.statusBarHeight + 8` with
                `paddingVertical: 6`, so its 14px text sits at
                `Constants.statusBarHeight + 14`. This row's Skip/counter text is
                also 14px and starts right at paddingTop, so paddingTop must be
                `Constants.statusBarHeight + 14` for the two to land on the SAME
                line (the earlier +8 left this row 6px too high). */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 8, paddingTop: (Constants.statusBarHeight ?? 0) + 8 }}>
              <Text style={{ color: '#114b3c80', fontSize: 12, fontFamily: 'Poppins_500Medium', minWidth: 36 }}>
                {tutorialPage + 1}/{tutorialSlides.length}
              </Text>

              {/* Language pills removed from the first-login carousel — the
                  app boots in the phone's system language, and once the user
                  is inside the app they can change it from Settings. Keeps a
                  centred empty View so the page-counter / Skip row layout
                  (space-between) stays balanced. */}
              <View style={{ flex: 1 }} />

              <TouchableOpacity
                onPress={() => openDemoCover(isBusiness)}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                style={{ minWidth: 36, alignItems: 'flex-end' }}
              >
                <Text style={{ color: '#114b3c99', fontSize: 14, fontFamily: 'Poppins_500Medium' }}>
                  {t('common.skip')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Carousel — each slide is a full window-width page so swipe
                paging snaps cleanly between them. */}
            <View style={{ flex: 1 }}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onMomentumScrollEnd={(e) => {
                  const page = Math.round(e.nativeEvent.contentOffset.x / WELCOME_WIDTH);
                  setTutorialPage(page);
                }}
              >
                {tutorialSlides.map((slide, idx) => (
                  <View
                    key={idx}
                    style={{
                      width: WELCOME_WIDTH,
                      flex: 1,
                      paddingHorizontal: 32,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {slide.image ? (
                      <Image source={slide.image} style={{ width: WELCOME_WIDTH * 0.64, height: 230, marginBottom: 28 }} resizeMode="contain" />
                    ) : (
                      <View style={{ width: 128, height: 128, borderRadius: 64, backgroundColor: '#114b3c14', justifyContent: 'center', alignItems: 'center', marginBottom: 36 }}>
                        {slide.icon}
                      </View>
                    )}
                    <Text style={{ color: '#1a1a1a', fontSize: 26, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 16 }}>
                      {slide.title ?? (slide.titleKey ? t(slide.titleKey) : '')}
                    </Text>
                    <Text style={{ color: '#666', fontSize: 16, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 24 }}>
                      {slide.desc ?? (slide.descKey ? t(slide.descKey) : '')}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            {/* Dots + button pinned near the bottom safe-area */}
            <View style={{ paddingBottom: 24, paddingTop: 8, paddingHorizontal: 24 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 20 }}>
                {tutorialSlides.map((_, i) => (
                  <View
                    key={i}
                    style={{
                      width: tutorialPage === i ? 24 : 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: tutorialPage === i ? '#114b3c' : '#114b3c33',
                      marginHorizontal: 4,
                    }}
                  />
                ))}
              </View>
              {tutorialPage === tutorialSlides.length - 1 && (
                <TouchableOpacity
                  onPress={() => openDemoCover(isBusiness)}
                  style={{
                    backgroundColor: '#114b3c',
                    borderRadius: 14,
                    paddingVertical: 16,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: '#e3ff5c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                    {t('tutorial.getStarted')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </SafeAreaView>
        </Modal>
      )}
      {/* Badge unlocked popup. Gated on splashDone so a fast gamification
          fetch can't flash an unlocked-badge celebration over the splash
          animation. The Modal renders in its own native window and would
          otherwise sit on top of the splash regardless of zIndex.
          Also gated on isAuthenticated — without it, a badge that was set
          mid-session and not yet auto-cleared could render over the sign-in
          screen after sign-out (the "Premiers Pas" popup-on-logout report).
          The set-side effect already exits for business users (line 822),
          but the render-side gate is independent of who set the badge. */}
      {badgePopup && splashDone && isAuthenticated && (
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
      {/* Pickup streak celebration — fires once when a basket the buyer reserved
          is confirmed PICKED UP and their streak advances. Mirrors the badge
          popup styling and the same auth-gate guard for the same reason. */}
      {streakPopup && splashDone && isAuthenticated && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setStreakPopup(null)}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
            activeOpacity={1}
            onPress={() => setStreakPopup(null)}
          >
            <Animated.View
              style={{
                backgroundColor: '#114b3c',
                borderRadius: 28,
                padding: 32,
                alignItems: 'center',
                width: WELCOME_WIDTH - 80,
                transform: [{ scale: streakScale }],
              }}
              onStartShouldSetResponder={() => true}
            >
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(227,255,92,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Flame size={36} color="#e3ff5c" />
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: 'Poppins_500Medium', marginBottom: 4 }}>
                {t('streak.celebTitle', { defaultValue: 'Panier récupéré !' })}
              </Text>
              <Text style={{ color: '#e3ff5c', fontSize: 26, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 8 }}>
                {t('streak.celebCount', { count: streakPopup.streak, defaultValue: `${streakPopup.streak} jours de série !` })}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
                {t('streak.celebSubtitle', { defaultValue: 'Continuez à sauver des paniers pour faire grandir votre série.' })}
              </Text>
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}
      {/* Post-demo nudge — customer: add a delivery address. Gated on !badgePopup
          so it doesn't collide with the finished-badge popup, and on splashDone
          so it can never paint over the splash animation. */}
      {showAddAddressPrompt && splashDone && !badgePopup && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowAddAddressPrompt(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <View style={{ backgroundColor: '#fffff8', borderRadius: 24, padding: 28, width: '100%', maxWidth: 360, alignItems: 'center' }}>
              <View style={{ backgroundColor: '#114b3c14', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <MapPin size={28} color="#114b3c" />
              </View>
              <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 8 }}>
                {t('home.addAddressPrompt.title', { defaultValue: 'Ajoutez votre adresse' })}
              </Text>
              <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 21, marginBottom: 22 }}>
                {t('home.addAddressPrompt.desc', { defaultValue: 'Ajoutez une adresse pour voir les paniers proches de vous et les distances.' })}
              </Text>
              <TouchableOpacity
                onPress={() => { setShowAddAddressPrompt(false); router.push('/address-picker' as never); }}
                style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center', marginBottom: 8 }}
              >
                <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {t('home.addAddressPrompt.cta', { defaultValue: 'Ajouter une adresse' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowAddAddressPrompt(false)} style={{ paddingVertical: 10, width: '100%', alignItems: 'center' }}>
                <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_500Medium' }}>
                  {t('home.addAddressPrompt.later', { defaultValue: 'Plus tard' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
      {/* The post-demo "add a location" modal that used to render here is
          gone — the dashboard now surfaces its own popup every time it
          regains focus while the org has zero locations, which covers the
          same nudge without doubling up at end-of-demo. */}
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
            onPress={() => { void signOut(); resetStackTo(router, '/auth/sign-in'); }}
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
    // Chillax Bold — used exclusively by the splash B. Sits alongside the
    // Poppins family loader so the splash renders correctly on first
    // paint instead of falling back to system serif while the font
    // resolves async.
    'Chillax-Bold': require('@/assets/fonts/Chillax-Bold.ttf'),
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

  // ── Backend warm-up ────────────────────────────────────────────────────────
  // Railway can let the dyno idle; the FIRST request after launch/resume then
  // pays a cold-start that made login (and other first actions) fail with a
  // spurious connection error. Poll GET /api/health in the background until it
  // answers — each failed attempt also nudges Railway to start the container —
  // so the server is awake BEFORE the user reaches the sign-in button. Runs on
  // boot and on every foreground. Fully silent / best-effort; each GET already
  // auto-retries (idempotent), and the outer loop extends coverage across a
  // slow cold start without ever surfacing anything to the user.
  useEffect(() => {
    let cancelled = false;
    const warmUp = async () => {
      for (let i = 0; i < 4 && !cancelled; i++) {
        try {
          await apiClient.get('/api/health');
          return; // server is up — stop polling
        } catch {
          if (i < 3) await new Promise((r) => setTimeout(r, 4000));
        }
      }
    };
    void warmUp();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void warmUp();
    });
    return () => { cancelled = true; sub.remove(); };
  }, []);

  // Enforce Poppins globally on every <Text> AND <TextInput>. The old
  // defaultProps approach only set Regular (400), so any element with
  // fontWeight: '600' / '700' fell back to Roboto on Android because RN
  // needs BOTH fontFamily AND fontWeight to match a loaded font. We wrap
  // each component's render so the correct Poppins family (Regular /
  // Medium / SemiBold / Bold) is injected based on the resolved fontWeight
  // whenever the caller didn't set fontFamily themselves. Any explicit
  // `fontFamily:` still wins. TextInput is patched alongside Text because
  // it uses a separate render path (and falls back to the system font —
  // SF Pro on iOS, Roboto on Android — without this) and the app has 90+
  // TextInput usages that would otherwise need individual Poppins styling.
  useEffect(() => {
    if (!fontsLoaded) return;
    const familyForWeight = (fw: string) =>
      fw === 'bold' || fw === '700' || fw === '800' || fw === '900'
        ? 'Poppins_700Bold'
        : fw === '600'
          ? 'Poppins_600SemiBold'
          : fw === '500'
            ? 'Poppins_500Medium'
            : 'Poppins_400Regular';
    const patchRender = (Comp: any, marker: string) => {
      if (!Comp || Comp[marker]) return;
      const origRender = Comp.render;
      if (typeof origRender !== 'function') return;
      Comp.render = function patchedRender(this: any, ...args: any[]) {
        const props = args[0];
        const flat = StyleSheet.flatten((props && props.style) as any) || {};
        if (!flat.fontFamily) {
          const family = familyForWeight(String(flat.fontWeight ?? '400'));
          const nextProps = { ...props, style: [{ fontFamily: family }, props.style] };
          return origRender.call(this, nextProps, ...args.slice(1));
        }
        return origRender.apply(this, args);
      };
      Comp[marker] = true;
    };
    patchRender(Text as any, '__poppinsWeightPatched');
    patchRender(TextInput as any, '__poppinsWeightPatched');
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
  const splashDone = useSplashStore((s) => s.splashDone);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';
  // Hold the cover under the splash so the bag-tip animation always plays out
  // first. The Settings "Mode démo" entry is post-splash so this is normally a
  // no-op, but it's belt-and-braces for the first-login auto-show.
  if (!show || !splashDone) return null;
  const handleStart = () => {
    if (isBiz) {
      // The business walkthrough overlay lives in (business)/_layout and assumes
      // the dashboard route is active — hop there first, then start on the next
      // frame. startWalkthrough() clears showDemoWelcome in the same commit so
      // the cover unmounts as the dashboard overlay fades in.
      try { router.replace('/(business)/dashboard' as never); } catch {}
      requestAnimationFrame(() => startWalkthrough());
      return;
    }
    // Customer: keep demoCustomerActive=true through the start so the demo card
    // injection survives the transition. Starts at step 0 (Discover intro).
    startWalkthrough({ demoCustomerActive: true });
  };
  const handleQuit = () => {
    // Tidy up the demo-card injection (customer) and close the cover. The root
    // layout's step-watcher sees showDemoWelcome go true→false with no
    // walkthrough started and runs the "demo ended" handler (badge + prompts).
    setDemoCustomerActive(false);
    setShow(false);
  };
  // Read safe-area top inset synchronously from Constants so the first
  // paint of the cover already has the correct padding. The cover is
  // rendered as a sibling of <Stack/>, so expo-router's SafeAreaProvider
  // (which lives INSIDE the Stack) isn't visible here — SafeAreaView would
  // resolve to (0,0,0,0) on the first render and then snap to the real
  // insets on the second render, shifting the centred title block by
  // ~insets.top / 2 px. The OfflineBanner sitting at this same layer
  // uses the same Constants fallback. Bottom inset isn't reliably available
  // outside a SafeAreaProvider, so we use a stable 24 px padding on the
  // button row — enough to clear the Android nav-bar handle while looking
  // identical between platforms.
  const topInset = Constants.statusBarHeight ?? 0;
  const bottomInset = 24;
  return (
    <View
      pointerEvents="auto"
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: theme.colors.bg,
        zIndex: 99999,
        elevation: 99999,
      }}
    >
      <View style={{ flex: 1, paddingHorizontal: 28, paddingTop: topInset, paddingBottom: bottomInset }}>
        {/* Demo-cover language switcher removed — language is set from the
            phone's system locale on first launch and is changeable from
            Settings once the user is inside the app. */}

        {/* Title block claims the available vertical space between the safe-
            area top and the action buttons. Its own flex centring then puts
            the icon + title + description in the middle of THAT region —
            which lands them in the middle of the screen overall, instead of
            stranded near the top like the old paddingTop: 100 + marginTop: 40
            layout. */}
        {/* Type scale + icon-bubble geometry mirrors the advantage-carousel
            slides above (128 px bubble, 26 px / 16 px text, Poppins 700/400)
            so flipping from the last advantage slide to this cover doesn't
            jump fonts mid-onboarding. */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 128, height: 128, borderRadius: 64, backgroundColor: '#114b3c14', justifyContent: 'center', alignItems: 'center', marginBottom: 36 }}>
            <Hand size={36} color="#114b3c" />
          </View>
          <Text style={{ color: '#1a1a1a', fontSize: 26, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 16 }}>
            {t('walkthrough.demoWelcome.title', { defaultValue: 'Bienvenue dans la démo Barakeat' })}
          </Text>
          <Text style={{ color: '#666', fontSize: 16, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 24, maxWidth: 320 }}>
            {t('walkthrough.demoWelcome.desc', { defaultValue: "Nous allons vous guider à travers l'application sans créer de vraie commande. Appuyez sur Démarrer quand vous êtes prêt, ou Quitter pour annuler." })}
          </Text>
        </View>

        {/* Single Start button at the bottom — Quit moved to the top-right
            (below). With one button here instead of two, the centred title
            block rises to roughly the same vertical level as the advantage
            carousel's slide content, so flipping from the last slide into this
            cover no longer jumps. */}
        <View style={{ width: '100%', paddingBottom: 8 }}>
          <TouchableOpacity
            onPress={handleStart}
            accessibilityRole="button"
            accessibilityLabel={t('walkthrough.demoWelcome.start', { defaultValue: 'Démarrer la démo' })}
            style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
          >
            <Text style={{ color: '#e3ff5c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              {t('walkthrough.demoWelcome.start', { defaultValue: 'Démarrer la démo' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Quit — top-right corner, within the safe area. */}
      <TouchableOpacity
        onPress={handleQuit}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={t('walkthrough.demoWelcome.quit', { defaultValue: 'Quitter' })}
        style={{ position: 'absolute', top: topInset + 8, right: 20, zIndex: 10, paddingVertical: 6, paddingHorizontal: 8 }}
      >
        <Text style={{ color: theme.colors.muted, fontSize: 14, fontFamily: 'Poppins_500Medium' }}>
          {t('walkthrough.demoWelcome.quit', { defaultValue: 'Quitter' })}
        </Text>
      </TouchableOpacity>
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
