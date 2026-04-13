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
import { useAddressStore } from "@/src/stores/addressStore";
import { useSplashStore } from "@/src/stores/splashStore";
import { useCelebrationStore } from "@/src/stores/celebrationStore";
import { useWalkthroughStore } from "@/src/stores/walkthroughStore";
import { fetchGamificationStats } from "@/src/services/gamification";
import { apiClient } from "@/src/lib/api";
import { Search, ShoppingBag, Trophy, LayoutDashboard, Package, BarChart3 } from "lucide-react-native";
import * as Notifications from 'expo-notifications';
import * as NavigationBar from "expo-navigation-bar";
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
      <Stack.Screen name="business/scan-qr" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/team" options={{ headerShown: false }} />
      <Stack.Screen name="business/member-detail" options={{ headerShown: false }} />
      <Stack.Screen name="business/add-location" options={{ headerShown: false }} />
      <Stack.Screen name="business/add-member" options={{ headerShown: false }} />
      <Stack.Screen name="messages" options={{ headerShown: false }} />
      <Stack.Screen name="message/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="wallet" options={{ headerShown: false }} />
      <Stack.Screen name="address-picker" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
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

  const isRestoringSession = useAuthStore((s) => s.isRestoringSession);
  const hydrateFavorites = useFavoritesStore((s) => s.hydrate);
  const hydrateAddresses = useAddressStore((s) => s.hydrate);

  const router = useRouter();
  const segments = useSegments();
  const qc = useQueryClient();

  useEffect(() => {
    void hydrateFavorites();
    void hydrateAddresses();
  }, [hydrateFavorites, hydrateAddresses]);

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

    if (!isAuthenticated) {
      if (inBusinessFlow || inTabsFlow) {
        router.replace('/onboarding' as never);
      }
      return;
    }

    const isBiz = user?.role === 'business' || (user as any)?.type === 'restaurant';

    if (isBiz && !inBusinessFlow && !inAuth) {
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

  // Check if user needs the post-login tutorial
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession || tutorialCheckedRef.current) return;
    tutorialCheckedRef.current = true;
    (async () => {
      try {
        const res = await apiClient.get('/api/auth/onboarding');
        if (!res.data.onboardingCompleted) {
          setShowTutorial(true);
        }
      } catch {
        // Silently fail — don't block the app
      }
    })();
  }, [isAuthenticated, isRestoringSession]);

  // Register for push notifications and handle taps
  useEffect(() => {
    if (!isAuthenticated || isRestoringSession) return;
    
    const setupPush = async () => {
      const { registerForPushNotifications } = await import('@/src/services/pushNotifications');
      await registerForPushNotifications();
    };
    void setupPush();

    // Handle notification tap
    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.screen) {
        let route = data.screen;
        if (data.conversationId) {
          route = route.replace('[id]', String(data.conversationId));
        } else if (data.entityId) {
          route = route.replace('[id]', String(data.entityId));
        }
        // Small delay to ensure navigation is ready
        setTimeout(() => {
          router.push(route as any);
        }, 500);
      }
    });

    return () => {
      responseListener.remove();
    };
  }, [isAuthenticated, isRestoringSession]);

  const startWalkthrough = useWalkthroughStore((s) => s.startWalkthrough);

  const dismissTutorial = async () => {
    setShowTutorial(false);
    setTutorialPage(0);
    try {
      await apiClient.put('/api/auth/onboarding');
      qc.invalidateQueries({ queryKey: ['gamification-stats'] });
    } catch {}
    // Start interactive tab walkthrough for both customers and business
    setTimeout(() => startWalkthrough(), 500);
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

  const tutorialSlides = isBusiness ? businessSlides : customerSlides;

  return (
    <GestureHandlerRootView style={styles.container}>
      <ErrorBoundary>
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
                    onPress={dismissTutorial}
                    style={{
                      backgroundColor: '#e3ff5c',
                      borderRadius: 14,
                      paddingVertical: 14,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#114b3c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                      {t('tutorial.getStarted')}
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
