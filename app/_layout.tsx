import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider } from "@/src/theme/ThemeProvider";
import "@/src/i18n";
import { StyleSheet, View, ActivityIndicator, Text, Modal, ScrollView, Dimensions, TouchableOpacity } from "react-native";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import { useAuthStore } from "@/src/stores/authStore";
import { useTranslation } from 'react-i18next';
import { SplashAnimation } from "@/src/components/SplashAnimation";
import { ErrorBoundary } from "@/src/components/ErrorBoundary";
import { useFavoritesStore } from "@/src/stores/favoritesStore";
import { useAddressStore } from "@/src/stores/addressStore";
import { useSplashStore } from "@/src/stores/splashStore";

void SplashScreen.preventAutoHideAsync();

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
      <Stack.Screen name="reserve" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="review" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/create-basket" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/availability" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/menu-items" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/scan-qr" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="business/team" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="map-view" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

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

  const restoreSession = useAuthStore((s) => s.restoreSession);
  const isRestoringSession = useAuthStore((s) => s.isRestoringSession);
  const hydrateFavorites = useFavoritesStore((s) => s.hydrate);
  const hydrateAddresses = useAddressStore((s) => s.hydrate);

  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    void restoreSession();
    void hydrateFavorites();
    void hydrateAddresses();
  }, [restoreSession, hydrateFavorites, hydrateAddresses]);

  useEffect(() => {
    if (fontsLoaded && !isRestoringSession) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isRestoringSession]);

  // ── Central role-based routing guard ──────────────────────────────────────
  // Fires once fonts are loaded and session restore is complete.
  // Avoids running while still restoring (would route before role is known).
  useEffect(() => {
    if (!fontsLoaded || isRestoringSession) return;

    const inBusinessFlow = segments[0] === '(business)';
    const inTabsFlow = segments[0] === '(tabs)';
    const inAuth = segments[0] === 'auth';
    const inOnboarding = segments[0] === 'onboarding';

    if (!isAuthenticated) {
      // Not logged in: send to onboarding / auth — but only if currently in
      // a protected area to avoid overriding the onboarding flow itself.
      if (inBusinessFlow || inTabsFlow) {
        router.replace('/onboarding' as never);
      }
      return;
    }

    // Authenticated — route to the right flow based on role.
    const isBusiness = user?.role === 'business';

    if (isBusiness && !inBusinessFlow && !inAuth) {
      console.log('[RootLayout] Routing business user to (business)/dashboard');
      router.replace('/(business)/dashboard' as never);
    } else if (!isBusiness && !inTabsFlow && !inAuth && !inOnboarding) {
      console.log('[RootLayout] Routing customer user to (tabs)');
      router.replace('/(tabs)' as never);
    }
  }, [fontsLoaded, isRestoringSession, isAuthenticated, user?.role]);

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
        <GestureHandlerRootView style={styles.container}>
          <ErrorBoundary>
          <RootLayoutNav />
          {showSplash && (
            <SplashAnimation onFinish={() => {
              const wasLogin = wasLoginSplash;
              setInitialSplash(false);
              dismissLoginSplash();
              if (wasLogin) {
                setShowWelcomeModal(true);
                setTimeout(() => setShowWelcomeModal(false), 5000);
              }
            }} />
          )}
          {showWelcomeModal && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setShowWelcomeModal(false)}>
              <View style={{
                flex: 1,
                backgroundColor: 'rgba(0,0,0,0.5)',
                justifyContent: 'center',
                alignItems: 'center',
                padding: 24,
              }}>
                <View style={{
                  backgroundColor: '#114b3c',
                  borderRadius: 28,
                  width: WELCOME_WIDTH - 48,
                  maxHeight: 400,
                  overflow: 'hidden',
                }}>
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

                  {/* Carousel */}
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={(e) => {
                      const page = Math.round(e.nativeEvent.contentOffset.x / (WELCOME_WIDTH - 48));
                      setWelcomeCarouselPage(page);
                    }}
                  >
                    {/* Page 1: Welcome */}
                    <View style={{ width: WELCOME_WIDTH - 48, paddingVertical: 60, paddingHorizontal: 30, alignItems: 'center' }}>
                      <Text style={{ fontSize: 40 }}>👋</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 20 }}>
                        {t('home.welcomePopup.back')}
                      </Text>
                      <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginTop: 8, textAlign: 'center' }}>
                        {user?.name ?? 'there'}
                      </Text>
                    </View>

                    {/* Page 2: Updates */}
                    <View style={{ width: WELCOME_WIDTH - 48, paddingVertical: 60, paddingHorizontal: 30, alignItems: 'center' }}>
                      <Text style={{ fontSize: 40 }}>🎉</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 20 }}>
                        {t('home.welcomePopup.whatsNew')}
                      </Text>
                      <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginTop: 8, textAlign: 'center' }}>
                        {t('home.welcomePopup.newPartners')}
                      </Text>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Poppins_400Regular', marginTop: 12, textAlign: 'center' }}>
                        {t('home.welcomePopup.newPartnersDesc')}
                      </Text>
                    </View>
                  </ScrollView>

                  {/* Dot indicators */}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', paddingBottom: 20 }}>
                    {[0, 1].map((i) => (
                      <View
                        key={i}
                        style={{
                          width: welcomeCarouselPage === i ? 20 : 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: welcomeCarouselPage === i ? '#e3ff5c' : 'rgba(255,255,255,0.3)',
                          marginHorizontal: 3,
                        }}
                      />
                    ))}
                  </View>
                </View>
              </View>
            </Modal>
          )}
          </ErrorBoundary>
        </GestureHandlerRootView>
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
