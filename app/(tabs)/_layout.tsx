import { Tabs, useSegments } from "expo-router";
import { Search, ShoppingBag, Heart, User, Star, Flag, Map, Bell, Settings, Flame, Trophy, Zap, Clock, MapPin, QrCode, CheckCircle, X as XIcon, Navigation, Wallet, Plus, Hand } from "lucide-react-native";
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, Animated, Dimensions, PanResponder, Modal, Image, AppState, StyleSheet, ScrollView, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getUnreadCount } from "@/src/services/notifications";
import { useNotificationStore } from "@/src/stores/notificationStore";
import { useAuthStore } from "@/src/stores/authStore";
import { useHeroStore } from "@/src/stores/heroStore";
import { useSplashStore } from "@/src/stores/splashStore";
import { useCelebrationStore } from "@/src/stores/celebrationStore";
import { useWalkthroughStore } from "@/src/stores/walkthroughStore";
import { fetchMyReservations, dismissReviewPrompt } from "@/src/services/reservations";
import { fetchGamificationStats } from "@/src/services/gamification";
import AsyncStorage from "@react-native-async-storage/async-storage";

const REVIEW_DISMISSED_KEY = 'barakeat_review_dismissed';

function TabIcon({ icon: Icon, color, size, focused, fill }: { icon: any; color: string; size: number; focused: boolean; fill?: string }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1.15 : 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 8,
    }).start();
  }, [focused]);
  const hasFill = focused && fill && fill !== 'transparent';
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {hasFill ? (
        <View>
          <Icon size={size} color={fill} fill={fill} />
          <View style={{ position: 'absolute', top: 0, left: 0 }}>
            <Icon size={size} color={color} fill="transparent" />
          </View>
        </View>
      ) : (
        <Icon size={size} color={color} fill="transparent" />
      )}
    </Animated.View>
  );
}

export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const unreadCount = useNotificationStore((s) => s.unreadCount);


  const tabCount = 4;
  const navWidth = Dimensions.get('window').width - 40;
  const tabWidth = navWidth / tabCount;
  const glassAnim = React.useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Track live glassAnim x for swipe calculations
  const glassX = React.useRef(0);
  React.useEffect(() => {
    const id = glassAnim.addListener(({ value }) => { glassX.current = value; });
    return () => glassAnim.removeListener(id);
  }, [glassAnim]);

  // Refs so PanResponder (created once) can see latest navigation state
  const navStateRef = React.useRef<any>(null);
  const navRef = React.useRef<any>(null);

  // Visible route names (excluding hidden 'nearby') for correct swipe navigation
  const visibleRouteNames = ['index', 'orders', 'favorites', 'profile'];

  const swipePanResponder = React.useMemo(() => PanResponder.create({
    // Only capture clearly horizontal swipes
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
    onPanResponderGrant: () => {
      glassAnim.stopAnimation();
      glassAnim.setOffset(glassX.current);
      glassAnim.setValue(0);
    },
    onPanResponderMove: (_, g) => {
      const maxX = tabWidth * (tabCount - 1);
      const clamped = Math.max(-glassX.current, Math.min(maxX - glassX.current, g.dx));
      glassAnim.setValue(clamped);
    },
    onPanResponderRelease: (_, g) => {
      glassAnim.flattenOffset();
      const raw = glassX.current;
      // Flick: velocity threshold for tab switching
      let targetIdx = Math.round(raw / tabWidth);
      if (g.vx > 0.5) targetIdx = Math.min(tabCount - 1, Math.floor(raw / tabWidth) + 1);
      else if (g.vx < -0.5) targetIdx = Math.max(0, Math.ceil(raw / tabWidth) - 1);
      targetIdx = Math.max(0, Math.min(tabCount - 1, targetIdx));

      Animated.spring(glassAnim, {
        toValue: targetIdx * tabWidth,
        useNativeDriver: true,
        friction: 12,
        tension: 80,
      }).start();
      setActiveIndex(targetIdx);
      // Navigate using visible route names (skips hidden 'nearby' tab)
      const routeName = visibleRouteNames[targetIdx];
      if (routeName) navRef.current?.navigate(routeName);
    },
    onPanResponderTerminate: () => {
      glassAnim.flattenOffset();
    },
  }), [glassAnim, tabWidth, tabCount]);

  // Snap glass pill to correct position when returning from app switcher (iOS swipe away/back)
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        glassAnim.stopAnimation();
        glassAnim.setValue(activeIndex * tabWidth);
      }
    });
    return () => sub.remove();
  }, [activeIndex, tabWidth, glassAnim]);

  // ── Splash done — must be declared before any useEffect that references it ──
  const splashDone = useSplashStore((s) => s.splashDone);

  // ── Review popup on app open (persisted so it only shows once per reservation) ──
  const [reviewPrompt, setReviewPrompt] = useState<{ reservationId: string; locationName: string; locationId: string; locationLogo?: string; basketImage?: string; basketName?: string; quantity?: number; total?: number } | null>(null);
  const [reviewDismissed, setReviewDismissed] = useState<Set<string>>(new Set());
  const [reviewDismissedReady, setReviewDismissedReady] = useState(false);

  // Load persisted dismissed set on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(REVIEW_DISMISSED_KEY);
        if (stored) setReviewDismissed(new Set(JSON.parse(stored)));
      } catch (e) {
        console.warn('[ReviewDismiss] AsyncStorage read failed:', e);
      }
      setReviewDismissedReady(true);
    })();
  }, []);

  // Helper to dismiss + persist (both client-side and server-side)
  const dismissReview = React.useCallback((reservationId: string) => {
    setReviewDismissed(prev => {
      const next = new Set(prev);
      next.add(reservationId);
      AsyncStorage.setItem(REVIEW_DISMISSED_KEY, JSON.stringify([...next])).catch(e => console.warn('[ReviewDismiss] AsyncStorage write failed:', e));
      return next;
    });
    // Persist server-side so popup never reappears even after storage clears
    dismissReviewPrompt(reservationId).catch(e => console.warn('[ReviewDismiss] Server dismiss failed:', e));
    setReviewPrompt(null);
  }, []);

  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const reservations = useMemo(() => reservationsQuery.data ?? [], [reservationsQuery.data]);

  // Show review popup only ONCE per reservation — wait for splash + celebration to finish
  const reviewShownRef = React.useRef(false);
  const hasPendingCelebration = useCelebrationStore((s) => !!s.pending);
  useEffect(() => {
    if (!splashDone) return;
    if (hasPendingCelebration) return; // wait for celebration to finish
    if (!reviewDismissedReady || !reservations.length || reviewShownRef.current) return;
    const needsReview = reservations.find((r) => {
      const status = ((r as any).status ?? '').toLowerCase();
      const hasReview = (r as any).has_review === true;
      const promptDismissed = (r as any).review_prompt_dismissed === true;
      const id = String(r.id ?? '');
      return (status === 'picked_up' || status === 'collected') && !hasReview && !promptDismissed && !reviewDismissed.has(id);
    });
    if (needsReview && !reviewPrompt) {
      const rid = String(needsReview.id);
      const rr = needsReview as any;
      // Persist immediately so this popup never appears again for this reservation
      reviewShownRef.current = true;
      setReviewDismissed(prev => {
        const next = new Set(prev);
        next.add(rid);
        AsyncStorage.setItem(REVIEW_DISMISSED_KEY, JSON.stringify([...next])).catch(e => console.warn('[ReviewDismiss] AsyncStorage write failed:', e));
        return next;
      });
      // Also persist server-side so popup never reappears even after storage clears
      dismissReviewPrompt(rid).catch(e => console.warn('[ReviewDismiss] Server dismiss failed:', e));
      setReviewPrompt({
        reservationId: rid,
        locationName: rr.restaurant_name ?? rr.basket?.merchantName ?? rr.basket?.merchant_name ?? 'this location',
        locationId: String(rr.location_id ?? rr.restaurant_id ?? ''),
        locationLogo: rr.restaurant?.image_url ?? rr.restaurant_image ?? rr.org_image_url ?? undefined,
        basketImage: rr.basket?.image_url ?? rr.basket?.imageUrl ?? rr.basket?.cover_image_url ?? undefined,
        basketName: rr.basket?.name ?? rr.basket?.title ?? undefined,
        quantity: rr.quantity ?? 1,
        total: rr.total_price ?? rr.total ?? rr.basket?.price ?? 0,
      });
    }
  }, [reservations, reviewDismissed, reviewDismissedReady, reviewPrompt, splashDone, hasPendingCelebration]);

  // ── Post-reservation celebration popup ──
  const celebrationPending = useCelebrationStore((s) => s.pending);
  const clearCelebration = useCelebrationStore((s) => s.clearPending);
  const [showCelebration, setShowCelebration] = useState(false);
  const [orderConfirmPopup, setOrderConfirmPopup] = useState<{ pickupCode: string; pickupStart: string; pickupEnd: string; address: string; locationName?: string; basketName?: string; basketImage?: string; quantity?: number; price?: number; qrCodeUrl?: string } | null>(null);
  const [qrExpanded, setQrExpanded] = useState(false);
  const [showLevelUpBanner, setShowLevelUpBanner] = useState(false);
  const flameScale = React.useRef(new Animated.Value(6)).current;
  const celebrationOpacity = React.useRef(new Animated.Value(0)).current;
  const statsOpacity = React.useRef(new Animated.Value(0)).current;
  const xpBarWidth = React.useRef(new Animated.Value(0)).current;
  const levelUpScale = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!celebrationPending) return;
    setShowCelebration(true);
    setShowLevelUpBanner(false);
    flameScale.setValue(celebrationPending.streakChanged ? 9 : 4);
    celebrationOpacity.setValue(1);
    statsOpacity.setValue(0);
    // Start XP bar from previous progress position
    const startProgress = celebrationPending.xpProgressBefore ?? 0;
    xpBarWidth.setValue(celebrationPending.levelAfter > celebrationPending.levelBefore ? startProgress : startProgress);

    // Phase 1: flame shrinks from huge to normal
    Animated.spring(flameScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
      tension: 40,
    }).start();

    // Phase 2 (after 700ms): stats fade in + XP bar animates from previous to new
    setTimeout(() => {
      const isLevelUp = celebrationPending.levelAfter > celebrationPending.levelBefore;
      Animated.parallel([
        Animated.timing(statsOpacity, { toValue: 1, duration: 400, useNativeDriver: false }),
        isLevelUp
          ? // Level up: fill bar to 100% first, then reset to new progress
            Animated.timing(xpBarWidth, { toValue: 1, duration: 600, useNativeDriver: false })
          : // Same level: animate from previous to new progress
            Animated.timing(xpBarWidth, { toValue: celebrationPending.xpProgress, duration: 900, useNativeDriver: false }),
      ]).start(() => {
        if (isLevelUp) {
          // Show level-up banner, then reset bar to new level progress
          setShowLevelUpBanner(true);
          levelUpScale.setValue(0);
          Animated.spring(levelUpScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
          setTimeout(() => {
            xpBarWidth.setValue(0);
            Animated.timing(xpBarWidth, { toValue: celebrationPending.xpProgress, duration: 700, useNativeDriver: false }).start();
          }, 400);
        }
      });
    }, 700);
  }, [celebrationPending]);

  const dismissCelebration = React.useCallback(() => {
    // Save confirmData before clearing celebration
    const confirmData = celebrationPending?.confirmData;
    Animated.timing(celebrationOpacity, { toValue: 0, duration: 250, useNativeDriver: false }).start(() => {
      setShowCelebration(false);
      setShowLevelUpBanner(false);
      clearCelebration();
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      // Show order confirmed popup after celebration
      if (confirmData) {
        setTimeout(() => {
          setOrderConfirmPopup(confirmData);
          setQrExpanded(false);
        }, 300);
      }
    });
  }, [celebrationOpacity, clearCelebration, queryClient, celebrationPending]);

  // ── Streak expiry warning — only after splash animation ends ──
  const [streakWarningShown, setStreakWarningShown] = useState(false);
  const [showStreakWarning, setShowStreakWarning] = useState(false);

  const gamificationQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!splashDone) return; // wait for splash animation to finish
    const gData = gamificationQuery.data as any;
    if (!gData || streakWarningShown) return;
    if (gData.streak_expires_soon && (gData.stats?.current_streak ?? gData.current_streak ?? 0) > 0) {
      setShowStreakWarning(true);
      setStreakWarningShown(true);
    }
  }, [gamificationQuery.data, streakWarningShown, splashDone]);



  // Block only users we can clearly identify as business (restaurant / business
  // type or role). Cross-role redirect is handled by the root layout.
  const normalizedRole = String(user?.role ?? '').toLowerCase();
  const normalizedType = String((user as any)?.type ?? '').toLowerCase();
  const isBusinessUser =
    normalizedRole === 'business' || normalizedRole === 'restaurant' ||
    normalizedType === 'business' || normalizedType === 'restaurant';
  React.useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/auth/sign-in' as never);
    }
  }, [isAuthenticated]);

  const unreadQuery = useQuery({
    queryKey: ['unread-count'],
    queryFn: getUnreadCount,
    enabled: isAuthenticated,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    if (unreadQuery.data !== undefined) {
      setUnreadCount(unreadQuery.data);
    }
  }, [unreadQuery.data, setUnreadCount]);



  // Animated map button that lives in the layout and morphs between:
  //   search tab (anim=0): small circle at top-right (where the map button placeholder is)
  //   other tabs (anim=1): expanded pill at top-left
  const insets = useSafeAreaInsets();
  const isSearchTab = activeIndex === 0;
  const heroVisible = useHeroStore((s) => s.heroVisible);
  const isOnDarkBg = isSearchTab && heroVisible;
  const mapBtnAnim = React.useRef(new Animated.Value(isSearchTab ? 0 : 1)).current;
  // We need a non-native-driver anim for width/padding changes
  const mapBtnStyleAnim = React.useRef(new Animated.Value(isSearchTab ? 0 : 1)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.spring(mapBtnAnim, {
        toValue: isSearchTab ? 0 : 1,
        useNativeDriver: true,
        friction: 10,
        tension: 80,
      }),
      Animated.spring(mapBtnStyleAnim, {
        toValue: isSearchTab ? 0 : 1,
        useNativeDriver: false,
        friction: 10,
        tension: 80,
      }),
    ]).start();
  }, [isSearchTab]);

  // Calculate the X offset so the map icon center aligns with the spacer center in the search tab.
  // Search tab right group: [spacer(34)] [gap:10] [settings(34)] [gap:10] [bell(34)] | 16px right pad
  // Settings/bell are wrapped in 34x34 touch boxes (matches the spacer) so the
  // icons sit on the same centerline on Android; the old 20-wide touchables
  // drifted. Spacer center from right edge = 16 + 34 + 10 + 34 + 10 + 17 = 121
  // Spacer center from left = screenW - 121
  // Overlay icon (20px) at left:16 + translateX → center at 16 + translateX + 10
  // 16 + translateX + 10 = screenW - 121 → translateX = screenW - 147
  const screenW = Dimensions.get('window').width;
  const mapBtnStartX = screenW - 147;

  // Hard render-gate: block the customer UI for unauthenticated users and for
  // business accounts. Prevents the layout from rendering for a single frame
  // while the wrong-account alert/redirect effect above is still pending.
  if (!isAuthenticated || isBusinessUser) {
    return null;
  }

  return (
    <>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        headerShown: false,
      }}
      tabBar={(props) => {
        const { state, descriptors, navigation } = props;
        // Keep refs current for PanResponder
        navStateRef.current = state;
        navRef.current = navigation;

        // Build the filtered (visible) routes — same as what we render below.
        // We need the VISUAL index of the active route so the glass pill
        // lands on the correct tab even though 'nearby' is hidden.
        const visibleRoutes = state.routes.filter((r) => r.name !== 'nearby');
        const focusedRouteName = state.routes[state.index]?.name ?? '';
        const visualActiveIndex = visibleRoutes.findIndex((r) => r.name === focusedRouteName);
        const targetX = Math.max(0, visualActiveIndex) * tabWidth;

        // Defer state update to avoid "cannot update during render" warning
        if (activeIndex !== visualActiveIndex && visualActiveIndex >= 0) {
          requestAnimationFrame(() => {
            Animated.spring(glassAnim, {
              toValue: targetX,
              useNativeDriver: true,
              friction: 10,
              tension: 100,
            }).start();
            setActiveIndex(visualActiveIndex);
          });
        }

        return (
          <View
            {...swipePanResponder.panHandlers}
            style={{
              position: 'absolute',
              bottom: 20,
              left: 20,
              right: 20,
              height: 60,
              backgroundColor: theme.colors.surface,
              borderRadius: 20,
              borderTopWidth: 0,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 10,
              paddingBottom: 0,
              paddingHorizontal: 0,
              flexDirection: 'row',
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            {/* Glass slider indicator */}
            <Animated.View
              style={{
                position: 'absolute',
                width: tabWidth - 12,
                height: 44,
                backgroundColor: theme.colors.primary,
                borderRadius: 14,
                left: 6,
                transform: [{ translateX: glassAnim }],
              }}
            />

            {visibleRoutes
              .map((route, index) => {
              const { options } = descriptors[route.key];
              // Derive isFocused from route NAME, not from filtered array index,
              // so it's always correct regardless of how 'nearby' shifts raw indexes.
              const isFocused = route.name === focusedRouteName;
              const color = isFocused ? '#FFFFFF' : theme.colors.textSecondary;
              const iconStroke = isFocused ? '#FFFFFF' : theme.colors.textSecondary;
              const iconFill = 'transparent';

              const onPress = () => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              let icon = null;
              const iconSize = 22;
              switch (route.name) {
                case 'index': icon = <TabIcon icon={Search} color={iconStroke} size={iconSize} focused={isFocused} fill={iconFill} />; break;
                case 'orders': icon = <TabIcon icon={ShoppingBag} color={iconStroke} size={iconSize} focused={isFocused} fill={iconFill} />; break;
                case 'favorites': icon = <TabIcon icon={Heart} color={iconStroke} size={iconSize} focused={isFocused} fill={iconFill} />; break;
                case 'profile': icon = <TabIcon icon={User} color={iconStroke} size={iconSize} focused={isFocused} fill={iconFill} />; break;
              }

              return (
                <TouchableOpacity
                  key={route.key}
                  onPress={onPress}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 60,
                  }}
                  activeOpacity={0.7}
                >
                  {icon}
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={{
                      color,
                      fontSize: 9,
                      fontFamily: 'Poppins_500Medium',
                      marginTop: 2,
                      maxWidth: tabWidth - 8,
                      textAlign: 'center',
                    }}
                  >
                    {options.title ?? route.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('home.discover'),
          headerShown: false,
          tabBarIcon: ({ size, focused }) => <TabIcon icon={Search} color={focused ? '#FFFFFF' : theme.colors.textSecondary} size={size} focused={focused} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
      {/* nearby = no tab entry; accessed via router.push from Découvrir */}

      {/* nearby is NOT a tab — href:null hides it; filter in custom tabBar removes any residual render */}
      <Tabs.Screen
        name="nearby"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('orders.title'),
          tabBarIcon: ({ size, focused }) => <TabIcon icon={ShoppingBag} color={focused ? '#FFFFFF' : theme.colors.textSecondary} size={size} focused={focused} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: t('favorites.title'),
          tabBarIcon: ({ size, focused }) => (
            <TabIcon icon={Heart} color={focused ? '#FFFFFF' : theme.colors.textSecondary} size={size} focused={focused} fill={focused ? theme.colors.primary : 'transparent'} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile.title'),
          tabBarIcon: ({ size, focused }) => <TabIcon icon={User} color={focused ? '#FFFFFF' : theme.colors.textSecondary} size={size} focused={focused} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
    </Tabs>

      {/* Single map button that morphs between circle (search tab) and pill (other tabs).
          Always visible — no fading in/out of screen. Slides between positions. */}
      <Animated.View
        style={{
          position: 'absolute',
          top: insets.top + 7,
          left: 16,
          zIndex: 999,
          elevation: 999,
          transform: [{
            translateX: mapBtnAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [mapBtnStartX, 0],
            }),
          }],
        }}
      >
        <TouchableOpacity
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('mapButton', { x, y, w, h });
            });
          }}
          onPress={() => router.push('/map-view' as never)}
          activeOpacity={0.7}
        >
          <Animated.View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: mapBtnStyleAnim.interpolate({
                inputRange: [0, 0.15, 1],
                // Transparent at search tab position → surface bg when expanding
                outputRange: ['transparent', theme.colors.surface, theme.colors.surface],
              }),
              borderRadius: 17,
              paddingHorizontal: mapBtnStyleAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 12],
              }),
              paddingVertical: mapBtnStyleAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 6],
              }),
              // Shadow only when expanded (not on bare icon)
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: mapBtnStyleAnim.interpolate({
                inputRange: [0, 0.3, 1],
                outputRange: [0, 0.04, 0.08],
              }),
              shadowRadius: 4,
              elevation: mapBtnStyleAnim.interpolate({
                inputRange: [0, 0.3, 1],
                outputRange: [0, 1, 3],
              }),
              overflow: 'hidden',
              minHeight: 20,
            }}
          >
            <Map size={20} color={isOnDarkBg ? '#e3ff5c' : theme.colors.primary} />
            {/* Text label — only rendered on non-search tabs, expands with animation */}
            <Animated.View style={{
              overflow: 'hidden',
              maxWidth: mapBtnStyleAnim.interpolate({
                inputRange: [0, 0.4, 1],
                outputRange: [0, 0, 120],
              }),
              opacity: mapBtnStyleAnim.interpolate({
                inputRange: [0, 0.6, 1],
                outputRange: [0, 0, 1],
              }),
            }}>
              <Text
                numberOfLines={1}
                style={{
                  color: theme.colors.textPrimary,
                  fontSize: 13,
                  fontWeight: '600',
                  fontFamily: 'Poppins_600SemiBold',
                  marginLeft: 5,
                }}
              >
                {t('home.search')}
              </Text>
            </Animated.View>
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>

      {/* White background behind top icons for non-search tabs — prevents color bleed on scroll */}
      {!isSearchTab && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 44, backgroundColor: '#fff', zIndex: 50 }} pointerEvents="none" />
      )}

      {/* Settings + notifications overlay for non-search tabs (right side) */}
      <Animated.View
        pointerEvents={isSearchTab ? 'none' : 'auto'}
        style={{
          position: 'absolute',
          top: insets.top + 7,
          right: 16,
          zIndex: 100,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          opacity: mapBtnAnim.interpolate({
            inputRange: [0, 0.3, 1],
            outputRange: [0, 0.5, 1],
          }),
        }}
      >
        <TouchableOpacity onPress={() => router.push('/settings' as never)}>
          <Settings size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('notifBell', { x, y, w, h });
            });
          }}
          onPress={() => router.push('/notifications' as never)}
          // Fixed-size wrapper so the measured rect is stable regardless of
          // whether the unread badge is rendered (it's absolute-positioned).
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
        >
          <Bell size={20} color={theme.colors.textPrimary} />
          {unreadCount > 0 && (
            <View style={{
              position: 'absolute',
              top: -4,
              right: -6,
              backgroundColor: theme.colors.error,
              borderRadius: 8,
              minWidth: 16,
              height: 16,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 4,
            }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>

      {/* Streak expiry warning popup */}
      <Modal visible={showStreakWarning} transparent animationType="fade" onRequestClose={() => setShowStreakWarning(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FF6B3518', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Flame size={32} color="#FF6B35" />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('streak.warningTitle', { defaultValue: 'Your streak is about to expire!' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 8 }}>
              {t('streak.warningDesc', { defaultValue: 'Order soon to keep your streak alive. It expires after 7 days of inactivity.' })}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF6B3515', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, gap: 6, marginBottom: 20 }}>
              <Flame size={16} color="#FF6B35" />
              <Text style={{ color: '#FF6B35', ...theme.typography.body, fontWeight: '700' }}>
                {(gamificationQuery.data as any)?.stats?.current_streak ?? (gamificationQuery.data as any)?.current_streak ?? 0} {t('streak.days', { defaultValue: 'day streak' })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={() => { setShowStreakWarning(false); router.push('/(tabs)' as never); }}
                style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                  {t('streak.orderNow', { defaultValue: 'Order Now' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowStreakWarning(false)}
                style={{ paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>
                  {t('streak.later', { defaultValue: 'Later' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Post-reservation celebration popup */}
      <Modal visible={showCelebration} transparent animationType="none" onRequestClose={dismissCelebration}>
        <Animated.View style={{ flex: 1, backgroundColor: 'rgba(17,75,60,0.97)', justifyContent: 'center', alignItems: 'center', padding: 28, opacity: celebrationOpacity }}>
          {/* Flame — starts huge, springs to normal */}
          {celebrationPending?.streakChanged ? (
            <Animated.View style={{ transform: [{ scale: flameScale }], marginBottom: 12 }}>
              <Flame size={56} color="#FF6B35" fill="#FF6B35" />
            </Animated.View>
          ) : (
            <Animated.View style={{ transform: [{ scale: flameScale }], marginBottom: 12 }}>
              <Trophy size={56} color="#e3ff5c" />
            </Animated.View>
          )}

          {/* Stats card fades in */}
          <Animated.View style={{ opacity: statsOpacity, width: '100%', alignItems: 'center' }}>
            {/* Level heading */}
            <Text style={{ color: '#e3ff5c', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
              {t('reserve.goodJob', { defaultValue: 'Bien jou\u00e9 !' })}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, fontFamily: 'Poppins_400Regular', marginTop: 4, textAlign: 'center' }}>
              {t('impact.level', { level: String(showLevelUpBanner ? celebrationPending?.levelAfter : celebrationPending?.levelBefore ?? celebrationPending?.levelAfter ?? 1) })}
            </Text>

            {/* XP gained badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(227,255,92,0.15)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginTop: 16 }}>
              <Zap size={16} color="#e3ff5c" />
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                +{celebrationPending?.xpGained ?? 0} XP
              </Text>
            </View>

            {/* XP bar */}
            <View style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, height: 14, overflow: 'hidden', marginTop: 20 }}>
              <Animated.View style={{
                height: '100%',
                backgroundColor: '#e3ff5c',
                borderRadius: 8,
                width: xpBarWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              }} />
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 6, alignSelf: 'flex-end' }}>
              {celebrationPending?.xpInLevel ?? 0}/{celebrationPending?.xpBandSize ?? 50} XP
            </Text>

            {/* Level up banner */}
            {showLevelUpBanner && (
              <Animated.View style={{ transform: [{ scale: levelUpScale }], backgroundColor: 'rgba(227,255,92,0.18)', borderRadius: 16, paddingHorizontal: 24, paddingVertical: 14, marginTop: 16, alignItems: 'center' }}>
                <Text style={{ color: '#e3ff5c', fontSize: 20, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
                  {t('reserve.congratsLevelUp', { defaultValue: 'F\u00e9licitations !' })}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 4, textAlign: 'center' }}>
                  {t('reserve.youReachedLevel', { level: String(celebrationPending?.levelAfter ?? 1), defaultValue: `Vous avez atteint le niveau ${celebrationPending?.levelAfter ?? 1}` })}
                </Text>
              </Animated.View>
            )}

            {/* Streak row (if changed) */}
            {celebrationPending?.streakChanged && (celebrationPending?.newStreak ?? 0) > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,107,53,0.18)', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10, marginTop: 16 }}>
                <Flame size={18} color="#FF6B35" fill="#FF6B35" />
                <Text style={{ color: '#FF6B35', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {celebrationPending.newStreak} {t('streak.days', { defaultValue: 'jours' })}
                </Text>
                <Text style={{ color: 'rgba(255,107,53,0.8)', fontSize: 13, fontFamily: 'Poppins_400Regular' }}>
                  {t('streak.current', { defaultValue: 'de suite' })}
                </Text>
              </View>
            )}

            {/* Continue button */}
            <TouchableOpacity
              onPress={dismissCelebration}
              style={{ backgroundColor: '#e3ff5c', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 48, marginTop: 28 }}
            >
              <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {t('common.continue', { defaultValue: 'Continuer' })}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* Review popup on app open after pickup */}
      <Modal visible={!!reviewPrompt} transparent animationType="fade" onRequestClose={() => dismissReview(reviewPrompt?.reservationId ?? '')}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            {/* Basket image at top */}
            {reviewPrompt?.basketImage ? (
              <Image source={{ uri: reviewPrompt.basketImage }} style={{ width: '100%', height: 120, borderRadius: 16, marginBottom: 16 }} resizeMode="cover" />
            ) : null}
            {/* Location logo */}
            {reviewPrompt?.locationLogo ? (
              <Image source={{ uri: reviewPrompt.locationLogo }} style={{ width: 56, height: 56, borderRadius: 28, marginBottom: 12, borderWidth: 2, borderColor: theme.colors.divider }} />
            ) : (
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.primary + '14', justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                <Star size={32} color={theme.colors.primary} />
              </View>
            )}
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('orders.reviewPromptTitle', { defaultValue: 'How was your experience?' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
              {t('orders.reviewPromptDesc', { defaultValue: `Your pickup at ${reviewPrompt?.locationName} is complete! Would you like to leave a review?` })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={() => {
                  const rid = reviewPrompt?.reservationId;
                  const lid = reviewPrompt?.locationId;
                  dismissReview(rid ?? '');
                  router.push({ pathname: '/review', params: { reservationId: rid, locationId: lid, locationName: reviewPrompt?.locationName, locationLogo: reviewPrompt?.locationLogo, basketImage: reviewPrompt?.basketImage, basketName: reviewPrompt?.basketName, quantity: String(reviewPrompt?.quantity ?? 1), total: String(reviewPrompt?.total ?? 0) } } as never);
                }}
                style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
              >
                <Star size={16} color="#fff" />
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                  {t('orders.leaveReview')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const lid = reviewPrompt?.locationId;
                  dismissReview(reviewPrompt?.reservationId ?? '');
                  router.push({ pathname: '/review', params: { locationId: lid, report: 'true' } } as never);
                }}
                style={{ paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' }}
              >
                <Flag size={16} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => dismissReview(reviewPrompt?.reservationId ?? '')}
              style={{ marginTop: 12 }}
            >
              <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm }}>
                {t('orders.maybeLater', { defaultValue: 'Maybe later' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Order confirmed popup (after celebration) — matches notification detail style ── */}
      <Modal visible={orderConfirmPopup !== null} transparent animationType="fade" onRequestClose={() => setOrderConfirmPopup(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }} activeOpacity={1} onPress={() => setOrderConfirmPopup(null)}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, width: '100%', maxWidth: 420, maxHeight: '90%', overflow: 'hidden', ...theme.shadows.shadowLg }} onStartShouldSetResponder={() => true}>
            {/* Coloured top strip — matches notification detail exactly */}
            <View style={{ backgroundColor: '#114b3c', paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' }}>
                <ShoppingBag size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', ...theme.typography.h3, fontWeight: '700' }}>
                  {t('notifications.notif_title_order_confirmed', { defaultValue: 'Commande confirm\u00e9e' })}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.75)', ...theme.typography.caption, marginTop: 2 }}>
                  {t('notifications.notif_message_order_confirmed', { defaultValue: 'Votre commande est confirm\u00e9e !', location: orderConfirmPopup?.locationName ?? '' })}
                </Text>
              </View>
            </View>

            <View style={{ padding: 24 }}>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 640 }} contentContainerStyle={{ paddingBottom: 8 }}>
                {/* Message */}
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22, marginBottom: 12 }}>
                  {t('notifications.notif_message_order_confirmed', { defaultValue: 'Votre commande est confirm\u00e9e !', location: orderConfirmPopup?.locationName ?? '' })}
                </Text>

                {/* Basket image + name — side by side */}
                {(orderConfirmPopup?.basketImage || orderConfirmPopup?.basketName || orderConfirmPopup?.locationName) ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    {orderConfirmPopup?.basketImage ? (
                      <Image source={{ uri: orderConfirmPopup.basketImage }} style={{ width: 56, height: 56, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      {orderConfirmPopup?.basketName ? (
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' }} numberOfLines={2}>
                          {orderConfirmPopup.basketName}
                        </Text>
                      ) : null}
                      {orderConfirmPopup?.locationName ? (
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }} numberOfLines={1}>
                          {orderConfirmPopup.locationName}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {/* Info rows — matching notification order card style */}
                <View style={{ backgroundColor: '#114b3c08', borderRadius: 14, padding: 14, marginBottom: 16, gap: 0 }}>
                  {/* Address + itinerary */}
                  {orderConfirmPopup?.address ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                        <MapPin size={13} color="#e3ff5c" />
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                        {orderConfirmPopup.address}
                      </Text>
                      <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(orderConfirmPopup.address)}`)} style={{ backgroundColor: '#114b3c', borderRadius: 10, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' }}>
                        <Navigation size={13} color="#e3ff5c" />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  {/* Quantity */}
                  {orderConfirmPopup?.quantity ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                        <ShoppingBag size={13} color="#e3ff5c" />
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', flex: 1 }}>
                        {orderConfirmPopup.quantity} {orderConfirmPopup.quantity > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}
                      </Text>
                    </View>
                  ) : null}
                  {/* Price */}
                  {orderConfirmPopup?.price ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ color: '#e3ff5c', fontSize: 9, fontWeight: '700' }}>TND</Text>
                      </View>
                      <Text style={{ color: theme.colors.primary, fontSize: 15, fontWeight: '700', flex: 1 }}>
                        {(orderConfirmPopup.quantity ?? 1) > 1 ? (orderConfirmPopup.price * (orderConfirmPopup.quantity ?? 1)).toFixed(2) : orderConfirmPopup.price} TND
                      </Text>
                    </View>
                  ) : null}
                  {/* Pickup time */}
                  {orderConfirmPopup?.pickupStart ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                      <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                        <Clock size={13} color="#e3ff5c" />
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', flex: 1 }}>
                        {t('notifications.pickupAt', { defaultValue: 'Retrait' })} : {orderConfirmPopup.pickupStart} - {orderConfirmPopup.pickupEnd}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* Code de retrait + QR toggle */}
                {orderConfirmPopup?.pickupCode ? (
                  <View style={{ backgroundColor: '#114b3c', borderRadius: 16, padding: 18, marginBottom: 16, alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 6 }}>
                      {t('reserve.success.pickupCode', { defaultValue: 'Code de retrait' })}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Text style={{ color: '#e3ff5c', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 6 }}>
                        {orderConfirmPopup.pickupCode}
                      </Text>
                      <TouchableOpacity onPress={() => setQrExpanded(!qrExpanded)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                        <QrCode size={18} color="#e3ff5c" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {/* QR code expansion */}
                {qrExpanded && orderConfirmPopup?.qrCodeUrl ? (
                  <View style={{ alignItems: 'center', marginBottom: 16 }}>
                    <Image source={{ uri: orderConfirmPopup.qrCodeUrl }} style={{ width: 200, height: 200, borderRadius: 12 }} resizeMode="contain" />
                  </View>
                ) : null}
              </ScrollView>

              {/* Action button */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  onPress={() => setOrderConfirmPopup(null)}
                  style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                    {t('notifications.viewOrder', { defaultValue: 'Voir la commande' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Interactive tab walkthrough overlay ── */}
      <WalkthroughOverlay navRef={navRef} tabWidth={tabWidth} theme={theme} t={t} insets={insets} />
    </>
  );
}

// ── Walkthrough spotlight component ─────────────────────────────────────────
import type { MeasuredKey } from '@/src/stores/walkthroughStore';

type CustomerStep = {
  routeName: string; // tab name (or current tab if pushRoute is set)
  pushRoute?: string; // optional pushed sub-screen
  // True if this step lives on a pushed sub-screen the user navigated to
  // themselves (e.g. /map-view after tapping the map button). The engine
  // skips its auto-pop logic for these so the user stays on screen.
  keepStack?: boolean;
  icon: any;
  titleKey: string;
  descKey: string;
  highlight: 'tab' | 'element';
  tabIndex?: number; // required when highlight === 'tab'
  measureKey?: MeasuredKey;
  // Fallback rect when measurement isn't ready yet.
  target?: { top?: number; bottom?: number; left?: number; right?: number; width?: number; height?: number; radius?: number };
  tooltipPosition?: 'top' | 'bottom';
  // When set, the tooltip hides its "Next" button and the walkthrough waits
  // for the user to tap the highlighted element. advanceOnPath fires the
  // advance when the pathname matches.
  requireTap?: boolean;
  advanceOnPath?: string;
};

const SCREEN_W_CUST = Dimensions.get('window').width;
const SCREEN_H_CUST = Dimensions.get('window').height;

// SVG path: full screen rectangle plus an inner rounded-rectangle hole drawn
// with the opposite winding so even-odd fill renders the dim area minus a
// perfect rounded cutout. Cap radius to half the smaller dimension so we
// never produce an invalid path on small targets.
function buildCutoutPath(sw: number, sh: number, x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (w <= 0 || h <= 0) return `M0 0 H${sw} V${sh} H0 Z`;
  const x2 = x + w;
  const y2 = y + h;
  return [
    `M0 0 H${sw} V${sh} H0 Z`,
    `M${x + radius} ${y}`,
    `H${x2 - radius}`,
    `A${radius} ${radius} 0 0 1 ${x2} ${y + radius}`,
    `V${y2 - radius}`,
    `A${radius} ${radius} 0 0 1 ${x2 - radius} ${y2}`,
    `H${x + radius}`,
    `A${radius} ${radius} 0 0 1 ${x} ${y2 - radius}`,
    `V${y + radius}`,
    `A${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    'Z',
  ].join(' ');
}

const WALKTHROUGH_STEPS: CustomerStep[] = [
  { tabIndex: 0, routeName: 'index', icon: Search, titleKey: 'walkthrough.discover.title', descKey: 'walkthrough.discover.desc', highlight: 'tab' },
  // First card on Discover
  {
    routeName: 'index', icon: ShoppingBag,
    titleKey: 'walkthrough.customer.firstCard.title', descKey: 'walkthrough.customer.firstCard.desc',
    highlight: 'element', measureKey: 'firstBasketCard',
    target: { top: 240, left: 16, width: SCREEN_W_CUST - 32, height: 220, radius: 16 },
    tooltipPosition: 'bottom',
  },
  // Heart on first card
  {
    routeName: 'index', icon: Heart,
    titleKey: 'walkthrough.customer.heart.title', descKey: 'walkthrough.customer.heart.desc',
    highlight: 'element', measureKey: 'favoriteHeart',
    target: { top: 252, right: 28, width: 32, height: 32, radius: 16 },
    tooltipPosition: 'bottom',
  },
  // Notifications bell in header
  {
    routeName: 'index', icon: Bell,
    titleKey: 'walkthrough.customer.notif.title', descKey: 'walkthrough.customer.notif.desc',
    highlight: 'element', measureKey: 'notifBell',
    target: { top: 60, right: 16, width: 32, height: 32, radius: 16 },
    tooltipPosition: 'bottom',
  },
  // Tap the map button (pill in the header) to open the discover map.
  // requireTap waits for the user to actually open /map-view rather than
  // auto-pushing — the original UX let people land on the radius highlight
  // before they understood they were on a map screen.
  {
    routeName: 'index', icon: Map,
    titleKey: 'walkthrough.customer.openMap.title', descKey: 'walkthrough.customer.openMap.desc',
    highlight: 'element', measureKey: 'mapButton',
    target: { top: 50, left: 16, width: 60, height: 34, radius: 17 },
    tooltipPosition: 'bottom',
    requireTap: true,
    advanceOnPath: '/map-view',
  },
  // Map view radius pill — user already navigated to /map-view themselves.
  {
    routeName: 'index', keepStack: true, icon: MapPin,
    titleKey: 'walkthrough.customer.radius.title', descKey: 'walkthrough.customer.radius.desc',
    highlight: 'element', measureKey: 'mapRadiusPill',
    target: { top: 130, left: 16, width: 100, height: 36, radius: 18 },
    tooltipPosition: 'bottom',
  },
  // Map category row
  {
    routeName: 'index', keepStack: true, icon: ShoppingBag,
    titleKey: 'walkthrough.customer.category.title', descKey: 'walkthrough.customer.category.desc',
    highlight: 'element', measureKey: 'mapCategoryRow',
    target: { top: 170, left: 16, width: SCREEN_W_CUST - 32, height: 44, radius: 12 },
    tooltipPosition: 'bottom',
  },
  // Tabs walk-through
  { tabIndex: 1, routeName: 'orders', icon: ShoppingBag, titleKey: 'walkthrough.orders.title', descKey: 'walkthrough.orders.desc', highlight: 'tab' },
  { tabIndex: 2, routeName: 'favorites', icon: Heart, titleKey: 'walkthrough.favorites.title', descKey: 'walkthrough.favorites.desc', highlight: 'tab' },
  { tabIndex: 3, routeName: 'profile', icon: User, titleKey: 'walkthrough.profile.title', descKey: 'walkthrough.profile.desc', highlight: 'tab' },
  // Wallet balance pill
  {
    routeName: 'profile', icon: Wallet,
    titleKey: 'walkthrough.customer.wallet.title', descKey: 'walkthrough.customer.wallet.desc',
    highlight: 'element', measureKey: 'walletBalance',
    target: { top: 200, left: 16, width: SCREEN_W_CUST - 32, height: 60, radius: 14 },
    tooltipPosition: 'bottom',
  },
  // Recharge button (push /wallet)
  {
    routeName: 'profile', pushRoute: '/wallet', icon: Plus,
    titleKey: 'walkthrough.customer.recharge.title', descKey: 'walkthrough.customer.recharge.desc',
    highlight: 'element', measureKey: 'walletRecharge',
    target: { bottom: 80, left: 16, width: SCREEN_W_CUST - 32, height: 52, radius: 14 },
    tooltipPosition: 'top',
  },
];

function WalkthroughOverlay({ navRef, tabWidth, theme, t, insets }: { navRef: any; tabWidth: number; theme: any; t: any; insets: any }) {
  const router = useRouter();
  const segments = useSegments();
  const pathname = '/' + (segments as string[]).join('/');
  const step = useWalkthroughStore((s) => s.step);
  const nextStep = useWalkthroughStore((s) => s.nextStep);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  const measuredRects = useWalkthroughStore((s) => s.measuredRects);
  const setCurrentStep = useWalkthroughStore((s) => s.setCurrentStep);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (step !== null) {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      const s = WALKTHROUGH_STEPS[step];
      if (!s) return;

      // Publish step metadata so SubScreenWalkthroughOverlay (mounted on
      // pushed Stack screens like /map-view) can render the same highlight
      // when the user is above the tabs in the navigator hierarchy.
      if (s.measureKey) {
        setCurrentStep({
          measureKey: s.measureKey,
          titleKey: s.titleKey,
          descKey: s.descKey,
          tooltipPosition: s.tooltipPosition,
          isLast: step === WALKTHROUGH_STEPS.length - 1,
          stepIndex: step,
          totalSteps: WALKTHROUGH_STEPS.length,
          requireTap: !!s.requireTap,
        });
      } else {
        setCurrentStep(null);
      }

      const onSubScreen = pathname.startsWith('/map-view') || pathname.startsWith('/wallet') || pathname.startsWith('/notifications') || pathname.startsWith('/settings');
      if (s.highlight === 'tab') {
        // Tab step: pop pushed sub-screens via REPLACE then switch tabs.
        if (onSubScreen && !s.pushRoute && !s.keepStack) {
          try {
            const tabPath = s.routeName === 'index' ? '/(tabs)/' : `/(tabs)/${s.routeName}`;
            router.replace(tabPath as never);
          } catch {}
        } else if (s.routeName && navRef.current && !s.keepStack) {
          try { navRef.current.navigate(s.routeName); } catch {}
        }
      }
      // Element steps: never call navRef.navigate. The user is either on the
      // tab where the element lives (previous step put them there) OR on a
      // pushed sub-screen they just opened (e.g. /map-view after tapping the
      // map button). Navigating here would pop that fresh push.

      // Push sub-screen for steps that explicitly request it.
      if (s.pushRoute) {
        setTimeout(() => {
          if (!pathname.startsWith(s.pushRoute!)) {
            try { router.push(s.pushRoute! as never); } catch {}
          }
        }, 100);
      }
    }
  }, [step]);

  // Auto-advance when the user navigates to the path the current step is
  // waiting for (requireTap + advanceOnPath). Mirrors the business overlay's
  // mechanic.
  React.useEffect(() => {
    if (step === null) return;
    const s = WALKTHROUGH_STEPS[step];
    if (s?.advanceOnPath && pathname.startsWith(s.advanceOnPath)) {
      nextStep(WALKTHROUGH_STEPS.length);
    }
  }, [pathname, step, nextStep]);

  if (step === null) return null;
  const current = WALKTHROUGH_STEPS[step];
  if (!current) return null;

  const StepIcon = current.icon;
  const isLast = step === WALKTHROUGH_STEPS.length - 1;
  const tabBarLeft = 20;

  // ── Compute cutout + tooltip geometry ─────────────────────────────────
  let rectX = 0, rectY = 0, rectW = 0, rectH = 0, rectRadius = 16;
  let tooltipStyle: any;
  let arrowStyle: any;

  if (current.highlight === 'element') {
    const measured = current.measureKey ? (measuredRects[current.measureKey] ?? null) : null;
    const t2 = current.target ?? {};
    // If a step declares a measureKey, the measured rect is the ONLY source
    // of truth — don't fall back to a hardcoded target. A stale fallback put
    // misplaced cutouts on the navbar / off-screen on the business side; the
    // same pattern lived here. Render the dim mask while we wait.
    if (current.measureKey && !measured) {
      return (
        <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        </Animated.View>
      );
    }
    const w = measured ? measured.w : (t2.width ?? 44);
    const h = measured ? measured.h : (t2.height ?? 44);
    const cx = measured ? measured.x + w / 2
      : (t2.right != null ? SCREEN_W_CUST - t2.right - w / 2 : (t2.left ?? 0) + w / 2);
    const cy = measured ? measured.y + h / 2
      : (t2.bottom != null ? SCREEN_H_CUST - t2.bottom - h / 2 : (t2.top ?? 0) + h / 2);
    rectX = cx - w / 2 - 6;
    rectY = cy - h / 2 - 6;
    rectW = w + 12;
    rectH = h + 12;
    rectRadius = (t2.radius ?? 12) + 6;

    // Pick a placement, then verify it fits — flip if not. Same fix as the
    // business overlay (see formConfirm bug).
    const TAB_BAR_HEIGHT = 88;
    const ESTIMATED_TOOLTIP_HEIGHT = 220;
    const safeTop = (insets?.top ?? 0) + 12;
    const safeBottom = TAB_BAR_HEIGHT + 12;
    const elementTop = rectY;
    const elementBottom = rectY + rectH;
    const fitsBelow = elementBottom + 20 + ESTIMATED_TOOLTIP_HEIGHT <= SCREEN_H_CUST - safeBottom;
    const fitsAbove = elementTop - 20 - ESTIMATED_TOOLTIP_HEIGHT >= safeTop;
    let tooltipBelow = current.tooltipPosition
      ? current.tooltipPosition === 'bottom'
      : cy < SCREEN_H_CUST / 2;
    if (tooltipBelow && !fitsBelow && fitsAbove) tooltipBelow = false;
    else if (!tooltipBelow && !fitsAbove && fitsBelow) tooltipBelow = true;
    const ttLeft = Math.max(16, Math.min(cx - 140, SCREEN_W_CUST - 296));
    if (tooltipBelow) {
      tooltipStyle = {
        position: 'absolute' as const,
        top: elementBottom + 20,
        left: ttLeft,
        width: 280,
      };
      arrowStyle = {
        position: 'absolute' as const, top: -8,
        left: Math.max(20, Math.min(cx - ttLeft - 8, 252)),
        width: 16, height: 16, backgroundColor: '#fff',
        transform: [{ rotate: '45deg' }],
      };
    } else {
      tooltipStyle = {
        position: 'absolute' as const,
        bottom: SCREEN_H_CUST - elementTop + 20,
        left: ttLeft,
        width: 280,
      };
      arrowStyle = {
        position: 'absolute' as const, bottom: -8,
        left: Math.max(20, Math.min(cx - ttLeft - 8, 252)),
        width: 16, height: 16, backgroundColor: '#fff',
        transform: [{ rotate: '45deg' }],
      };
    }
  } else {
    // Tab pill — same math as before
    const idx = current.tabIndex ?? 0;
    const pillCenterX = tabBarLeft + (idx * tabWidth) + (tabWidth / 2);
    rectX = tabBarLeft + (idx * tabWidth) + 6;
    rectY = SCREEN_H_CUST - (20 + 8 + 44) - 2;
    rectW = tabWidth - 12;
    rectH = 44 + 4;
    rectRadius = 14;
    const ttLeft = Math.max(16, Math.min(pillCenterX - 140, SCREEN_W_CUST - 296));
    tooltipStyle = { position: 'absolute' as const, bottom: 100, left: ttLeft, width: 280 };
    arrowStyle = {
      position: 'absolute' as const, bottom: -8,
      left: Math.max(20, Math.min(pillCenterX - ttLeft - 8, 252)),
      width: 16, height: 16, backgroundColor: '#fff',
      transform: [{ rotate: '45deg' }],
    };
  }

  // Cutout mask: dim everything except the highlighted rounded rectangle
  // using a single SVG path with even-odd fill (outer rect minus rounded
  // inner rect = perfect rounded cutout, no rectangle-with-rounded-border
  // mismatch at the corners).
  const handleMaskTap = current.highlight === 'tab'
    ? () => nextStep(WALKTHROUGH_STEPS.length)
    : undefined;
  const showNextButton = !current.requireTap;
  const showTapHint = !!current.requireTap;
  const cutoutPath = buildCutoutPath(SCREEN_W_CUST, SCREEN_H_CUST, rectX, rectY, rectW, rectH, rectRadius);

  return (
    <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }}>
        {/* SVG mask — the dim region exactly follows the rounded cutout shape. */}
        <View pointerEvents={handleMaskTap ? 'auto' : 'none'} style={StyleSheet.absoluteFillObject}>
          {handleMaskTap ? (
            <TouchableOpacity activeOpacity={1} onPress={handleMaskTap} style={StyleSheet.absoluteFillObject}>
              <Svg width={SCREEN_W_CUST} height={SCREEN_H_CUST} style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <Path d={cutoutPath} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
              </Svg>
            </TouchableOpacity>
          ) : (
            <Svg width={SCREEN_W_CUST} height={SCREEN_H_CUST} style={StyleSheet.absoluteFillObject} pointerEvents="none">
              <Path d={cutoutPath} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
            </Svg>
          )}
        </View>

        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: rectX, top: rectY, width: rectW, height: rectH, borderRadius: rectRadius, borderWidth: 3, borderColor: '#e3ff5c' }}
        />

        <View style={{
          ...tooltipStyle,
          backgroundColor: '#fff', borderRadius: 20, padding: 20,
          shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
        }}>
          <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_500Medium', marginBottom: 10 }}>
            {step + 1}/{WALKTHROUGH_STEPS.length}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#114b3c12', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
              <StepIcon size={22} color="#114b3c" />
            </View>
            <Text style={{ color: '#114b3c', fontSize: 17, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1 }}>
              {t(current.titleKey)}
            </Text>
          </View>
          <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, marginBottom: showTapHint ? 10 : 16 }}>
            {t(current.descKey)}
          </Text>
          {showTapHint && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, backgroundColor: '#114b3c0f', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 }}>
              <Hand size={14} color="#114b3c" />
              <Text style={{ color: '#114b3c', fontSize: 12, fontFamily: 'Poppins_600SemiBold', marginLeft: 6, flex: 1 }}>
                {t('walkthrough.tapToContinue', { defaultValue: 'Appuyez sur le bouton entouré pour continuer.' })}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TouchableOpacity onPress={skipWalkthrough}>
              <Text style={{ color: theme.colors.muted, fontSize: 13, fontFamily: 'Poppins_500Medium' }}>
                {t('walkthrough.exitDemo', { defaultValue: 'Quitter la démo' })}
              </Text>
            </TouchableOpacity>
            {showNextButton && (
              <TouchableOpacity
                onPress={() => nextStep(WALKTHROUGH_STEPS.length)}
                style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
              >
                <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {isLast ? t('walkthrough.done', { defaultValue: 'C\'est parti !' }) : t('walkthrough.next', { defaultValue: 'Suivant' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={arrowStyle} />
        </View>
      </Animated.View>
  );
}

const walkthroughStyles = StyleSheet.create({});
