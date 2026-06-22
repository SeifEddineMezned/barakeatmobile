import { Tabs, useSegments } from "expo-router";
import { Search, ShoppingBag, Heart, User, Map, Bell, Settings, Clock, MapPin, QrCode, CheckCircle, X as XIcon, Navigation, Wallet, Plus, Hand, Banknote, CreditCard } from "lucide-react-native";
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, Animated, Dimensions, PanResponder, Modal, Image, AppState, StyleSheet, ScrollView, Linking, useWindowDimensions, BackHandler } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/src/theme/ThemeProvider";
import { useOverlayOriginOffset } from "@/src/components/useOverlayOriginOffset";
import { getUnreadCount } from "@/src/services/notifications";
import { useNotificationStore } from "@/src/stores/notificationStore";
import { useAuthStore } from "@/src/stores/authStore";
import { useHeroStore } from "@/src/stores/heroStore";
import { useSplashStore } from "@/src/stores/splashStore";
import { useCelebrationStore } from "@/src/stores/celebrationStore";
import { useWalkthroughStore } from "@/src/stores/walkthroughStore";
import { fetchGamificationStats } from "@/src/services/gamification";
import { sharedScrollY, HERO_HEIGHT } from "@/src/lib/topBarScroll";

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

  // Live window-y of the floating tab bar. The computed-formula approach
  // (SCREEN_H - bottom - height - inset) was unreliable on Android with
  // edge-to-edge / different system bar configurations — the tab pill
  // halo ended up below the visible buttons. Measuring the real View
  // gives us the exact rect, regardless of how the navigator's container
  // resolves safe-area insets at runtime.
  const [tabBarTopY, setTabBarTopY] = React.useState<number | null>(null);
  const tabBarRef = React.useRef<View>(null);
  const remeasureTabBar = React.useCallback(() => {
    tabBarRef.current?.measureInWindow((_x, y, _w, h) => {
      if (h > 0) setTabBarTopY(y);
    });
  }, []);

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

  // ── Post-reservation order-confirmed popup ──
  // The XP "Bien joué" celebration modal itself lives globally in
  // app/_layout.tsx (<PostReservationCelebration/>) so it survives the
  // reserve.tsx → /(tabs)/orders navigation transition without a black/white
  // flash. After the user dismisses it, the celebration writes its
  // confirmData to celebrationStore.pendingOrderConfirm — we watch that
  // here and surface the "Votre commande est confirmée !" detail popup
  // once the user is actually on /(tabs)/orders.
  const pendingOrderConfirm = useCelebrationStore((s) => s.pendingOrderConfirm);
  const showOrderConfirmPopupAction = useCelebrationStore((s) => s.showOrderConfirmPopup);
  const hideOrderConfirmPopupAction = useCelebrationStore((s) => s.hideOrderConfirmPopup);
  const orderConfirmPopup = useCelebrationStore((s) => s.orderConfirmPopupData);
  const orderConfirmKey = useCelebrationStore((s) => s.orderConfirmKey);
  const signalClearOverlays = useCelebrationStore((s) => s.signalClearOverlays);
  const [qrExpanded, setQrExpanded] = useState(false);
  // Bridge from the post-reservation celebration. reserve.tsx writes the
  // confirm payload to `pendingOrderConfirm` after the user taps Continue;
  // we pick it up here and show the "Commande confirmée !" detail popup
  // via the store action. The action ALSO clears pendingOrderConfirm in
  // the same write so this effect can never re-fire on the same payload.
  React.useEffect(() => {
    if (!pendingOrderConfirm) return;
    showOrderConfirmPopupAction(pendingOrderConfirm);
    setQrExpanded(false);
    // Defensively clear any badge/streak modal that may have rendered a
    // few ms BEFORE orderConfirmActive could gate it. Cheap and idempotent.
    signalClearOverlays();
  }, [pendingOrderConfirm, showOrderConfirmPopupAction, signalClearOverlays]);

  // Shared close handler for the order-confirmed popup. The popup's
  // visibility is driven by store state (`orderConfirmPopupData !== null`),
  // and `hideOrderConfirmPopupAction` flips that synchronously in a single
  // store write — no React batching, no local-state-vs-store drift, no
  // ref gate needed. Previous attempts kept the popup state local AND
  // mirrored to the store, which left two sources of truth that could
  // disagree for a frame on Android; this collapses to one.
  // Optionally drops a `target=<reservationId>` deep-link param on the
  // orders tab so the orders screen scrolls + highlights + auto-expands
  // the freshly-confirmed card (via its existing target-id pipeline +
  // ReservationCard's initialExpanded false→true edge handler).
  const dismissOrderConfirmPopup = React.useCallback((opts?: { goToOrder?: boolean }) => {
    const resvId = opts?.goToOrder ? orderConfirmPopup?.reservationId : null;
    hideOrderConfirmPopupAction();
    // Tear down ANY competing overlay (badge, streak, address-prompt) in
    // the same gesture. "Voir la commande" must leave a clean orders tab.
    signalClearOverlays();
    if (resvId) {
      try {
        router.replace({ pathname: '/(tabs)/orders', params: { tab: 'upcoming', target: String(resvId) } } as never);
      } catch {
        try { router.setParams({ tab: 'upcoming', target: String(resvId) } as never); } catch {}
      }
    }
  }, [orderConfirmPopup, router, hideOrderConfirmPopupAction, signalClearOverlays]);
  // Keep fetching gamification stats here (no UI): hitting this endpoint is
  // what makes the backend create the `streak_expiring` notification on day 6.
  // The streak-about-to-expire warning is now shown ONLY through the standard
  // notification popup (NotificationDetail) — the old standalone modal was
  // removed so a single popup appears.
  useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });


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

  // Layout-level unread badge poll. NOT focus-gated — the customer needs
  // the badge to update even while they're on a non-notification tab.
  // Bumped 20s → 30s; staleTime 10s → 20s. Result: ~2 req/min instead of
  // ~3 req/min, dropping out of the rate-limit budget squeeze.
  const unreadQuery = useQuery({
    queryKey: ['unread-count'],
    queryFn: getUnreadCount,
    enabled: isAuthenticated,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const prevUnreadRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (unreadQuery.data !== undefined) {
      // When the bell count goes UP, immediately fire the popup poll so the
      // in-app popup catches up to the bell instead of trailing it by up to
      // 30 s (the popup pump's own interval).
      if (prevUnreadRef.current !== undefined && unreadQuery.data > prevUnreadRef.current) {
        void useNotificationStore.getState().triggerPopupPoll();
      }
      prevUnreadRef.current = unreadQuery.data;
      setUnreadCount(unreadQuery.data);
    }
  }, [unreadQuery.data, setUnreadCount]);

  // Refs to the header map button + notif bell so we can re-measure them
  // when the walkthrough's `mapButton` / `notifBell` steps fire. The
  // initial onLayout-driven measurement gets stale if the map button's
  // mapBtnAnim animation is mid-flight or if the layout has shifted since
  // mount — manually measuring at step time gives a fresh, accurate rect.
  const mapBtnRefForMeasure = React.useRef<View>(null);
  const notifBellRefForMeasure = React.useRef<View>(null);
  const walkthroughStepKey = useWalkthroughStore((s) => s.currentStep?.measureKey);
  React.useEffect(() => {
    if (walkthroughStepKey === 'mapButton') {
      // Clear the prior rect so the overlay's fast-path doesn't paint at
      // the previous step's (notifBell) position for a frame before the
      // mapButton re-measure lands. The dim-only fallback covers the gap.
      useWalkthroughStore.getState().setMeasuredRect('mapButton', null);
      // Wait for the mapBtnAnim morph animation (small circle → expanded
      // pill) to fully settle before measuring; otherwise the captured
      // rect is mid-animation and the halo lands off-center for a frame.
      const t = setTimeout(() => {
        mapBtnRefForMeasure.current?.measureInWindow((x, y, w, h) => {
          if (w <= 0 || h <= 0) return;
          // Produce a fixed 42×42 halo centred on the map button — matches
          // the notif bell halo size (34×34 wrapper + 4 expansion = 42×42)
          // so consecutive demo steps feel visually consistent. The map
          // button morphs between a 20×20 collapsed icon (search tab) and
          // a 60×34 pill (other tabs); recentering on the measured wrapper
          // keeps the halo locked to the icon regardless of state.
          const cx = x + w / 2;
          const cy = y + h / 2;
          useWalkthroughStore.getState().setMeasuredRect('mapButton', { x: cx - 21, y: cy - 21, w: 42, h: 42 });
        });
      }, 280);
      return () => clearTimeout(t);
    }
    if (walkthroughStepKey === 'notifBell') {
      // CRITICAL: do NOT publish from the LAYOUT'S bell when we're on the
      // search tab — the layout bell sits at opacity 0 here and is 7 px
      // below the actually-visible index.tsx bell (different paddingTop
      // anchoring). Publishing from the layout's invisible bell would
      // override the index.tsx onLayout publication and anchor the halo
      // to a phantom position. On non-search tabs the layout bell IS the
      // visible one and we want this measurement to win.
      if (activeIndex === 0 /* search tab */) return;
      useWalkthroughStore.getState().setMeasuredRect('notifBell', null);
      const t = setTimeout(() => {
        notifBellRefForMeasure.current?.measureInWindow((x, y, w, h) => {
          if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('notifBell', { x: x - 4, y: y - 4, w: w + 8, h: h + 8 });
        });
      }, 280);
      return () => clearTimeout(t);
    }
  }, [walkthroughStepKey]);



  // Animated map button that lives in the layout and morphs between:
  //   search tab (anim=0): small circle at top-right (where the map button placeholder is)
  //   other tabs (anim=1): expanded pill at top-left
  const insets = useSafeAreaInsets();
  const isSearchTab = activeIndex === 0;
  // Hero-collapse progress (0 = hero fully visible, 1 = hero fully gone),
  // sourced from the SAME shared scroll value the Settings / Bell icons in
  // (tabs)/index.tsx use. Without this the map icon's colour was driven by
  // the `heroVisible` boolean (single-threshold flip) while the rest of the
  // top bar interpolated smoothly — the map icon was "changing on its own
  // timeframe".
  const heroProgress = sharedScrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const heroProgressInv = Animated.subtract(1, heroProgress);
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
            ref={tabBarRef}
            onLayout={remeasureTabBar}
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

              // Active-colour (white) layer opacity, tied to the PILL's live
              // position. The icon + label colour now crossfades in lockstep
              // with the sliding green pill instead of hard-flipping on the
              // navigation state — which used to leave the previous tab's white
              // label sitting on the white bar (invisible) until the pill
              // arrived, then snap to grey. Peaks at 1 when the pill is centred
              // on this tab, fades to 0 over its neighbours.
              const whiteOpacity = glassAnim.interpolate({
                inputRange: [(index - 1) * tabWidth, index * tabWidth, (index + 1) * tabWidth],
                outputRange: [0, 1, 0],
                extrapolate: 'clamp',
              });

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

              const iconSize = 22;
              const renderIcon = (col: string, focused: boolean) => {
                switch (route.name) {
                  case 'index': return <TabIcon icon={Search} color={col} size={iconSize} focused={focused} fill="transparent" />;
                  case 'orders': return <TabIcon icon={ShoppingBag} color={col} size={iconSize} focused={focused} fill="transparent" />;
                  case 'favorites': return <TabIcon icon={Heart} color={col} size={iconSize} focused={focused} fill="transparent" />;
                  case 'profile': return <TabIcon icon={User} color={col} size={iconSize} focused={focused} fill="transparent" />;
                  default: return null;
                }
              };
              const labelStyle = (col: string) => ({
                color: col,
                fontSize: 9,
                fontFamily: 'Poppins_500Medium',
                marginTop: 2,
                maxWidth: tabWidth - 8,
                textAlign: 'center' as const,
              });
              const title = options.title ?? route.name;

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
                  {/* Base (inactive / grey) layer */}
                  {renderIcon(theme.colors.textSecondary, false)}
                  <Text numberOfLines={1} ellipsizeMode="tail" style={labelStyle(theme.colors.textSecondary)}>
                    {title}
                  </Text>
                  {/* Active (white) layer — crossfaded by the pill position. */}
                  <Animated.View
                    pointerEvents="none"
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: whiteOpacity }}
                  >
                    {renderIcon('#FFFFFF', true)}
                    <Text numberOfLines={1} ellipsizeMode="tail" style={labelStyle('#FFFFFF')}>
                      {title}
                    </Text>
                  </Animated.View>
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
          Always visible — no fading in/out of screen. Slides between positions.
          Vertical anchor: `insets.top` then a 34px-tall wrapper around the
          20px icon. This matches the search-tab header row in
          app/(tabs)/index.tsx (which uses `paddingTop: insets.top` with
          34x34 boxes around its bell/settings icons), so the three icons
          share the SAME baseline across devices — particularly on Samsung
          where `insets.top + 7` did NOT line up with the row's centered
          34x34 icons because the icon was rendered at the wrapper's top
          edge instead of vertically centred. */}
      {/* Outer wrapper handles the JS-driver `top` interpolation only —
          isolating it from the native-driver `transform` on the inner view
          below. Putting both animated props on the same Animated.View
          mixes drivers, which RN rejects ("Style property … cannot be
          animated"), cascading into a wave of paddingHorizontal /
          paddingVertical / maxWidth / top errors caught by the
          ErrorBoundary. The two values still interpolate against the same
          gesture: the wrapper picks up `mapBtnStyleAnim` (JS) for `top`,
          the inner view picks up `mapBtnAnim` (native) for `translateX`. */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          // The home-tab top bar uses `paddingTop: insets.top` then a flex
          // row with `alignItems: 'center'`. The address-dropdown carries
          // `marginTop: 4`, so Yoga sizes the row's cross-axis to 34 + 4 =
          // 38 px (the dropdown's outer margin counts toward the line's
          // cross-size). The 34-px right-side cluster then centres inside
          // that 38, sitting 2 px lower than where `insets.top` alone would
          // place a child. Without compensating here, the map button (at
          // `insets.top`) lands 2 px above the Settings/Bell icons.
          // mapBtnStyleAnim=0 (search-tab, bare icon) → insets.top + 2 so
          //   the icon's geometric centre matches the right-side icons.
          // mapBtnStyleAnim=1 (other tabs, "Search" pill with text) → +4
          //   further so the text optical centre tracks the dropdown's
          //   marginTop: 4 nudge.
          top: mapBtnStyleAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [insets.top + 2, insets.top + 6],
          }),
          left: 16,
          zIndex: 999,
          elevation: 999,
          height: 34,
          justifyContent: 'center',
        }}
      >
      <Animated.View
        style={{
          transform: [{
            translateX: mapBtnAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [mapBtnStartX, 0],
            }),
          }],
        }}
      >
        <TouchableOpacity
          ref={mapBtnRefForMeasure as any}
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w <= 0 || h <= 0) return;
              // Produce a fixed 42×42 halo centred on the map button (same
              // visual size as the bell halo so consecutive demo steps
              // feel uniform). See the matching manual re-measure effect
              // above for the rationale.
              const cx = x + w / 2;
              const cy = y + h / 2;
              useWalkthroughStore.getState().setMeasuredRect('mapButton', { x: cx - 21, y: cy - 21, w: 42, h: 42 });
            });
          }}
          onPress={() => router.push('/map-view' as never)}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Animated.View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: mapBtnStyleAnim.interpolate({
                // Keep the pill fully transparent for the first half of the
                // animation, then fade the surface bg in. The previous range
                // [0, 0.15, 1] crossfaded the bg within the first 15 % — so
                // when returning to the search tab (1 → 0), a small round
                // pill with a soft shadow lingered for a frame before the
                // icon settled, reading as "someone tapped the map button".
                // Pushing both fades to the back half hides them while the
                // pill is still small.
                inputRange: [0, 0.5, 1],
                outputRange: ['transparent', 'transparent', theme.colors.surface],
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
                // Aligned with the bg fade window above so the shadow doesn't
                // appear before the pill fills in.
                inputRange: [0, 0.5, 1],
                outputRange: [0, 0, 0.08],
              }),
              shadowRadius: 4,
              elevation: mapBtnStyleAnim.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0, 0, 3],
              }),
              overflow: 'hidden',
              minHeight: 20,
            }}
          >
            {/* Map glyph — on the search tab we render TWO stacked copies and
                crossfade them via `heroProgress` so the colour eases from
                neon (over the dark green hero) to textPrimary (over the
                white sticky sheet) in lock-step with the Settings / Bell
                icons in index.tsx. On other tabs the button reads as a
                "Search" pill, so we render a single static brand-green
                glyph there. */}
            {isSearchTab ? (
              <View style={{ width: 20, height: 20 }}>
                <Animated.View style={{ position: 'absolute', opacity: heroProgressInv }}>
                  <Map size={20} color="#e3ff5c" />
                </Animated.View>
                <Animated.View style={{ position: 'absolute', opacity: heroProgress }}>
                  <Map size={20} color={theme.colors.textPrimary} />
                </Animated.View>
              </View>
            ) : (
              <Map size={20} color={theme.colors.primary} />
            )}
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
        <TouchableOpacity
          onPress={() => router.push('/settings' as never)}
          // Match the bell's 32x32 wrapper so both header icons sit on the
          // same centerline and have an equivalent tap surface.
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          // Small L/R hitSlop because the bell sits ~10 px to the right;
          // larger T/B because there's no vertical neighbour to overlap.
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
        >
          <Settings size={20} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          ref={notifBellRefForMeasure as any}
          onLayout={(e) => {
            // Gated: only publish when the LAYOUT bell is the one the user
            // actually sees (i.e., NOT on the search tab). On the search
            // tab the index.tsx bell is the visible one and publishes its
            // own rect — letting the layout's onLayout fire here would
            // override the index.tsx publication (parent mounts after
            // children in this JSX) and the halo would anchor to a
            // phantom invisible bell.
            if (activeIndex === 0 /* search tab */) return;
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('notifBell', { x: x - 4, y: y - 4, w: w + 8, h: h + 8 });
            });
          }}
          onPress={() => router.push('/notifications' as never)}
          // Fixed-size wrapper so the measured rect is stable regardless of
          // whether the unread badge is rendered (it's absolute-positioned).
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          // Symmetric small L/R with settings sibling (10 px gap between them);
          // larger T/B to make the bell easy to hit without overlapping settings.
          hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
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

      {/* The standalone streak-expiry warning modal was removed — the
          streak-about-to-expire warning now appears solely via the standard
          notification popup (NotificationDetail handles `streak_expiring`). */}

      {/* Post-reservation "Bien joué !" celebration now lives in
          app/_layout.tsx (<PostReservationCelebration/>) so it can span the
          reserve.tsx → /(tabs)/orders navigation without a flash. */}

      {/* ── Order confirmed popup (after celebration) — matches notification detail style ── */}
      <Modal key={`oc-${orderConfirmKey}`} visible={orderConfirmPopup !== null} transparent animationType="fade" onRequestClose={() => dismissOrderConfirmPopup()}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          {/* Backdrop dismiss as an absolutely-positioned SIBLING (not a
              wrapper). Previously a wrapping TouchableOpacity + the inner
              View's onStartShouldSetResponder={() => true} claimed the start
              responder on every touch inside the modal, which blocked the
              ScrollView's pan gesture unless the touch started on a child
              TouchableOpacity (the QR toggle). Same pattern that already
              works for the detail modal in notifications.tsx. */}
          <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => dismissOrderConfirmPopup()} />
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, width: '100%', maxWidth: 420, maxHeight: '90%', overflow: 'hidden', ...theme.shadows.shadowLg }}>
            {/* Coloured top strip — matches notification detail exactly */}
            <View style={{ backgroundColor: '#114b3c', paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' }}>
                <ShoppingBag size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', ...theme.typography.h3, fontWeight: '700' }}>
                  {t('notifications.notif_title_order_confirmed', { defaultValue: 'Commande confirm\u00e9e' })}
                </Text>
              </View>
            </View>

            <View style={{ padding: 24 }}>
              {/* Screen-aware cap: 90% of screen minus header (~70) + body
                  padding (48) + button row (60) + row margin (16) + buffer.
                  Keeps the "Voir la commande" button visible even when the
                  QR is expanded — ScrollView scrolls internally if needed. */}
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: Dimensions.get('window').height * 0.9 - 220 }} contentContainerStyle={{ paddingBottom: 8 }}>
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
                  {/* Combined Paiement row — mirrors the customer expanded
                      order card. Top line: payment-method label. Bottom
                      line (when credits were used): the toDoLine — "À
                      payer à la récupération" / "Réglée entièrement par
                      crédits". Skipped entirely when we have no total
                      to reason about. */}
                  {orderConfirmPopup?.price ? (() => {
                    const totalNum = (orderConfirmPopup.quantity ?? 1) > 1
                      ? orderConfirmPopup.price * (orderConfirmPopup.quantity ?? 1)
                      : orderConfirmPopup.price;
                    const pm = orderConfirmPopup.paymentMethod ?? 'cash';
                    const creditAmt = orderConfirmPopup.creditAmount ?? 0;
                    const isCard = pm === 'card';
                    const cashSlice = Math.max(0, totalNum - creditAmt);
                    const PMIcon = isCard ? CreditCard : Banknote;
                    const methodLabel = isCard
                      ? (creditAmt > 0
                          ? t('orders.paymentByCardWithCredits', { defaultValue: 'Paiement par carte (+ crédits)' })
                          : t('orders.paymentByCard', { defaultValue: 'Paiement par carte' }))
                      : (creditAmt > 0
                          ? t('orders.paymentInCashWithCredits', { defaultValue: 'Paiement en espèces (+ crédits)' })
                          : t('orders.paymentInCash', { defaultValue: 'Paiement en espèces' }));
                    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
                    let toDoLine: string | null = null;
                    if (!isCard && cashSlice > 0) {
                      toDoLine = t('orders.toPayAtPickup', { amount: fmt(cashSlice), defaultValue: 'À payer à la récupération : {{amount}} TND' });
                    } else if (!isCard && cashSlice === 0 && creditAmt > 0) {
                      toDoLine = t('orders.paidEntirelyByCredits', { defaultValue: 'Réglée entièrement par crédits' });
                    }
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                          <PMIcon size={13} color="#e3ff5c" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '700' }}>
                            {methodLabel}
                          </Text>
                          {toDoLine ? (
                            <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600', marginTop: 4 }}>
                              {toDoLine}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })() : null}
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
                        {String(orderConfirmPopup.pickupCode).substring(0, 6).toUpperCase()}
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

              {/* Action button — closes the popup AND drops the new
                  reservation id on the orders tab as a `target=` param so
                  the orders screen scrolls to + highlights the just-confirmed
                  card on first press. The ref-gate inside
                  dismissOrderConfirmPopup absorbs accidental second taps. */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  onPress={() => dismissOrderConfirmPopup({ goToOrder: true })}
                  style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                    {t('notifications.viewOrder', { defaultValue: 'Voir la commande' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Demo welcome cover lives at the ROOT level (app/_layout.tsx)
          now so it can paint the instant the user taps "Mode démo" in
          settings — before the /settings → /(tabs)/ stack pop happens.
          Previously it lived here and only showed after the transition
          completed, leaving a visible flash of the home tab. ── */}
      {/* ── Interactive tab walkthrough overlay ── */}
      <WalkthroughOverlay navRef={navRef} tabWidth={tabWidth} theme={theme} t={t} insets={insets} tabBarTopY={tabBarTopY} />
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
  // What the user taps for a `requireTap` step — drives the tap-hint copy
  // ("Appuyez sur la carte" vs "le bouton"). Defaults to 'button'.
  tapTarget?: 'card' | 'button';
  // Effects that fire when the user enters this step. Mirrors the business
  // demo's `enter` API — used by the customer flow to flip demoCustomerActive
  // on/off so the discover/map lists know whether to inject the demo
  // location card + the /restaurant /basket /reserve screens know whether
  // to short-circuit their data fetches.
  enter?: { demoCustomer?: boolean; demoOrder?: boolean };
  // Final step — the (tabs) overlay returns null for the step itself and
  // the settings.tsx renders its own SettingsDemoOverlay, exactly the way
  // the business demo's last step works. We push /settings on entry.
  isSettings?: boolean;
};

// Live dimensions are read inside WalkthroughOverlay via useWindowDimensions
// — module-load snapshots used to be stale on Pixel-6-class devices whose
// window height grows after edge-to-edge initialises.
// The fallback width below is only consulted for step `target.width` defaults
// when a measureKey rect isn't yet published; the real measured rect always
// wins, so a small staleness here is harmless.
const SCREEN_W_CUST = Dimensions.get('window').width;

// (DemoWelcomeCover moved to app/_layout.tsx so it can render above the
// entire Stack, including /settings — see the lifecycle comment there.)

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
  // Step 0 — Discover tab pill highlight. demoCustomerActive is now set in
  // the same store write as step=0 (see startWalkthrough's init override
  // wired from DemoWelcomeCover.handleStart), so no enter clause is needed
  // here — adding one would only re-flip an already-true flag and trigger
  // a redundant render after step 0 mounts. Step 1 keeps its own
  // `enter: { demoCustomer: true }` as a defensive net.
  { tabIndex: 0, routeName: 'index', icon: Search, titleKey: 'walkthrough.discover.title', descKey: 'walkthrough.discover.desc', highlight: 'tab' },
  // First card on Discover — the user must tap it. The card is the demo
  // location injected at the top of the list while demoCustomerActive is
  // true; entering this step is what flips the flag on so the injection
  // becomes visible. advanceOnPath fires when /restaurant/demo opens.
  {
    routeName: 'index', icon: ShoppingBag,
    titleKey: 'walkthrough.customer.firstCard.title', descKey: 'walkthrough.customer.firstCard.desc',
    highlight: 'element', measureKey: 'firstBasketCard',
    target: { top: 240, left: 16, width: SCREEN_W_CUST - 32, height: 220, radius: 16 },
    tooltipPosition: 'bottom',
    requireTap: true,
    tapTarget: 'card',
    advanceOnPath: '/restaurant/demo',
    enter: { demoCustomer: true },
  },
  // Surprise basket inside the demo location page — tap it to open the
  // basket detail screen. The `target` is a conservative fallback covering
  // roughly where the first basket card sits below the hero; the host page
  // publishes the exact measured rect via setMeasuredRect once the card
  // mounts.
  {
    routeName: 'index', keepStack: true, icon: ShoppingBag,
    titleKey: 'walkthrough.customer.restaurantBasket.title',
    descKey: 'walkthrough.customer.restaurantBasket.desc',
    highlight: 'element', measureKey: 'restaurantSurpriseBasket',
    target: { top: 360, left: 16, width: SCREEN_W_CUST - 32, height: 110, radius: 16 },
    tooltipPosition: 'bottom',
    requireTap: true,
    tapTarget: 'card',
    advanceOnPath: '/basket/demo-basket',
  },
  // Reserve CTA on the basket detail screen.
  {
    routeName: 'index', keepStack: true, icon: ShoppingBag,
    titleKey: 'walkthrough.customer.reserveBtn.title',
    descKey: 'walkthrough.customer.reserveBtn.desc',
    highlight: 'element', measureKey: 'basketReserveBtn',
    target: { bottom: 40, left: 16, width: SCREEN_W_CUST - 32, height: 56, radius: 14 },
    tooltipPosition: 'top',
    requireTap: true,
    advanceOnPath: '/reserve',
  },
  // Quantity selector on /reserve.
  {
    routeName: 'index', keepStack: true, icon: ShoppingBag,
    titleKey: 'walkthrough.customer.reserveQty.title',
    descKey: 'walkthrough.customer.reserveQty.desc',
    highlight: 'element', measureKey: 'reserveQtySection',
    tooltipPosition: 'bottom',
  },
  // Payment method section on /reserve.
  {
    routeName: 'index', keepStack: true, icon: Wallet,
    titleKey: 'walkthrough.customer.reservePayment.title',
    descKey: 'walkthrough.customer.reservePayment.desc',
    highlight: 'element', measureKey: 'reservePaymentSection',
    tooltipPosition: 'top',
  },
  // Confirm reservation button — tap to fake-reserve. The reserve.tsx
  // handler short-circuits the API call when demoCustomerActive is true,
  // flips demoOrderActive=true (so the orders tab injects the demo card),
  // and replaces the nav stack with /(tabs)/orders. The step auto-advances
  // when the pathname matches.
  {
    routeName: 'index', keepStack: true, icon: ShoppingBag,
    titleKey: 'walkthrough.customer.reserveConfirm.title',
    descKey: 'walkthrough.customer.reserveConfirm.desc',
    highlight: 'element', measureKey: 'reserveConfirmBtn',
    tooltipPosition: 'top',
    requireTap: true,
    advanceOnPath: '/(tabs)/orders',
  },
  // Orders demo — the synthetic confirmed reservation injected by
  // (tabs)/orders.tsx now that demoOrderActive=true. Highlight the card
  // first; tapping it expands the accordion to reveal the pickup code.
  {
    routeName: 'orders', icon: ShoppingBag,
    titleKey: 'walkthrough.customer.demoOrderCard.title',
    descKey: 'walkthrough.customer.demoOrderCard.desc',
    highlight: 'element', measureKey: 'customerOrderCard',
    tooltipPosition: 'bottom',
    requireTap: true,
    tapTarget: 'card',
  },
  // Pickup code block inside the expanded order card. requireTap is false
  // here — tapping the dark block doesn't navigate anywhere, so the
  // tooltip's "Next" button drives the advance.
  {
    routeName: 'orders', icon: ShoppingBag,
    titleKey: 'walkthrough.customer.demoPickupCode.title',
    descKey: 'walkthrough.customer.demoPickupCode.desc',
    highlight: 'element', measureKey: 'customerPickupCode',
    tooltipPosition: 'top',
  },
  // Back to Home — bring the user back to the discover tab so the
  // remaining customer steps (favoriteHeart, notifBell, mapButton, etc.)
  // can fire from their native screen.
  { tabIndex: 0, routeName: 'index', icon: Search, titleKey: 'walkthrough.customer.backToHome.title', descKey: 'walkthrough.customer.backToHome.desc', highlight: 'tab' },
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
    // Fallback rect — matches the symmetric +4 px expansion published by
    // both bells (layout's 32×32 wrapper → 40×40 halo on non-search tabs;
    // search-tab index.tsx 34×34 wrapper → 42×42 halo). Using the smaller
    // 40×40 here as the safe first-paint estimate; the live measurement
    // takes over within one frame.
    target: { top: 56, right: 12, width: 40, height: 40, radius: 20 },
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
    // Fallback rect — 42×42 circle (radius 21) matching the notif bell
    // halo and the fixed-size halo published at measure-time. The exact
    // position is approximate; the live measurement takes over within a
    // frame.
    target: { top: 46, left: 28, width: 42, height: 42, radius: 21 },
    tooltipPosition: 'bottom',
    requireTap: true,
    advanceOnPath: '/map-view',
  },
  // Map view radius pill — user already navigated to /map-view themselves.
  // requireTap so the user actually taps the radius pill to expand it
  // (revealing the slider); the map-view component watches for that
  // expansion and advances the walkthrough automatically to the
  // expanded-card explanation step below.
  {
    routeName: 'index', keepStack: true, icon: MapPin,
    titleKey: 'walkthrough.customer.radius.title', descKey: 'walkthrough.customer.radius.desc',
    highlight: 'element', measureKey: 'mapRadiusPill',
    target: { top: 130, left: 16, width: 100, height: 36, radius: 18 },
    tooltipPosition: 'bottom',
    requireTap: true,
  },
  // Expanded radius card — slider + address row. Shown after the user
  // taps the radius pill above. requireTap=false here so the tooltip's
  // Next button advances to the category step.
  {
    routeName: 'index', keepStack: true, icon: MapPin,
    titleKey: 'walkthrough.customer.radiusExpanded.title', descKey: 'walkthrough.customer.radiusExpanded.desc',
    highlight: 'element', measureKey: 'mapRadiusExpanded',
    target: { top: 130, left: 16, width: SCREEN_W_CUST - 32, height: 110, radius: 16 },
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
  // Tabs walk-through — orders is intentionally absent here because the
  // customer already explored it via the demoOrderCard + demoPickupCode
  // steps right after the fake reservation.
  { tabIndex: 2, routeName: 'favorites', icon: Heart, titleKey: 'walkthrough.favorites.title', descKey: 'walkthrough.favorites.desc', highlight: 'tab' },
  { tabIndex: 3, routeName: 'profile', icon: User, titleKey: 'walkthrough.profile.title', descKey: 'walkthrough.profile.desc', highlight: 'tab' },
  // Credits link on the profile tab (the "Crédits Barakeat" row). No static
  // `target` fallback — profile.tsx publishes the real measured rect via
  // onLayout AND re-measures it when this step fires (see the
  // `walletBalance` useEffect there). A hardcoded target was visibly off on
  // devices where the row's actual y differed from `top: 200`.
  {
    routeName: 'profile', icon: Wallet,
    titleKey: 'walkthrough.customer.wallet.title', descKey: 'walkthrough.customer.wallet.desc',
    highlight: 'element', measureKey: 'walletBalance',
    tooltipPosition: 'bottom',
    // The Crédits row's onPress navigates to /wallet. requireTap stays unset so
    // the "Suivant" button still shows — but tapping the highlighted card also
    // advances (the advanceOnPath effect fires on the /wallet match). Both work.
    advanceOnPath: '/wallet',
  },
  // Recharge button (push /wallet). enter clears both demoCustomer (so the
  // demo list injection drops out before the settings hand-off) AND
  // demoOrder (so the demo order card stops appearing on the orders tab).
  // No static target — wallet.tsx re-measures the button when this step
  // fires.
  {
    routeName: 'profile', pushRoute: '/wallet', icon: Plus,
    titleKey: 'walkthrough.customer.recharge.title', descKey: 'walkthrough.customer.recharge.desc',
    highlight: 'element', measureKey: 'walletRecharge',
    tooltipPosition: 'top',
    enter: { demoCustomer: false, demoOrder: false },
  },
  // Settings hand-off — final stage. Same pattern as the business demo:
  // the (tabs) overlay returns null for this step and the settings.tsx
  // screen renders its own SettingsDemoOverlay on top of the highlighted
  // "Mode démo" row, with a "OK, terminer la démo" button that ends the
  // walkthrough cleanly.
  {
    routeName: 'profile', icon: Settings,
    titleKey: 'walkthrough.biz.settingsDemo.title',
    descKey: 'walkthrough.biz.settingsDemo.desc',
    highlight: 'element',
    isSettings: true,
  },
];

// Initial tooltip height estimate, replaced by the live measured height
// once the tooltip View's onLayout fires. Used so the clamp math below
// never lets the tooltip's bottom edge bleed under the tab bar / nav bar.
const LAYOUT_OVERLAY_TOOLTIP_ESTIMATE = 280;
// Visible padding between the tooltip edge and the safe-area edge so
// the popup doesn't sit flush against the device bezel.
const LAYOUT_OVERLAY_EDGE_PADDING = 24;

function WalkthroughOverlay({ navRef, tabWidth, theme, t, insets, tabBarTopY }: { navRef: any; tabWidth: number; theme: any; t: any; insets: any; tabBarTopY: number | null }) {
  const { width: SCREEN_W_CUST, height: SCREEN_H_CUST } = useWindowDimensions();
  // Pre-seed the origin offset with insets.top so the very first paint of
  // the overlay already has a usable Y origin. Without this, the first frame
  // after the demo welcome cover dismisses rendered the cutout + halo at
  // origin (0, 0), then the async measureInWindow snapped them up by
  // insets.top once it returned — the "demo first page snap" the user
  // reported. The async measurement still runs and refines if the actual
  // origin differs from the guess (rare).
  const { originRef, originX, originY, originMeasured, remeasure: remeasureOrigin } = useOverlayOriginOffset({ y: insets?.top ?? 0 });
  const router = useRouter();
  const segments = useSegments();
  const pathname = '/' + (segments as string[]).join('/');
  const step = useWalkthroughStore((s) => s.step);
  const nextStep = useWalkthroughStore((s) => s.nextStep);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  const measuredRects = useWalkthroughStore((s) => s.measuredRects);
  const setCurrentStep = useWalkthroughStore((s) => s.setCurrentStep);
  const setDemoCustomerActive = useWalkthroughStore((s) => s.setDemoCustomerActive);
  const setDemoOrderActive = useWalkthroughStore((s) => s.setDemoOrderActive);
  const demoCustomerActive = useWalkthroughStore((s) => s.demoCustomerActive);
  const demoOrderActive = useWalkthroughStore((s) => s.demoOrderActive);
  const setShowSettingsOverlay = useWalkthroughStore((s) => s.setShowSettingsOverlay);
  // Start fully opaque — no fade-in animation. The user taps "Start
  // demo" in the welcome cover; the cover unmounts at the same moment
  // the walkthrough overlay needs to be visible. A 300 ms fade-in here
  // means the user briefly sees the home tab through a half-transparent
  // dim mask which reads as a jittery handoff. With fadeAnim at 1 the
  // overlay appears INSTANTLY behind the cover-unmount — clean snap.
  const fadeAnim = React.useRef(new Animated.Value(1)).current;
  // Live tooltip height — replaced by onLayout measurement so the
  // widen-if-needed math below uses the REAL size rather than a fixed
  // estimate. Resets per step so each step measures fresh.
  const [tooltipH, setTooltipH] = React.useState<number>(LAYOUT_OVERLAY_TOOLTIP_ESTIMATE);
  React.useEffect(() => { setTooltipH(LAYOUT_OVERLAY_TOOLTIP_ESTIMATE); }, [step]);

  // ── Smooth step transitions ──────────────────────────────────────────────
  // After a step change the host screen often re-layouts (the demo card is
  // injected, the list reflows) and re-publishes the element's rect a beat
  // later. Painting immediately shows the halo at the OLD spot, then it snaps
  // to the new one — the "halo flashes then refreshes" the user reported. We
  // hold a dim-only mask until the layout has settled, then FADE the halo +
  // tooltip in. Keying readyState by `step` also makes `haloReady` false on
  // the very transition render (the effect's setState lags one render), so the
  // stale previous-rect frame never paints either.
  const [readyState, setReadyState] = React.useState<{ step: number | null; ready: boolean }>({ step: null, ready: false });
  const contentAnim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (step === null) { setReadyState({ step: null, ready: false }); contentAnim.setValue(0); return; }
    // Tab-pill steps don't need the 300 ms layout-settle gate — their
    // position is deterministic (tabBarTopY + tabIndex * tabWidth), so
    // there's nothing to wait for. Showing the halo + tooltip instantly
    // for these removes the subtle "fade-in snap" the user reported on
    // demo step 0 (Discover-tab pill) when the welcome cover dismisses:
    // previously the screen sat fully dim for 300 ms before contentAnim
    // started fading from 0, which read as a delayed pop-in. Element
    // steps still need the settle because their measured rect can be
    // republished a beat after the step lands (host screen relayouts,
    // list reflows) and we want the dim to mask that brief drift.
    const stepDef = WALKTHROUGH_STEPS[step];
    const isTabStep = stepDef?.highlight === 'tab';
    if (isTabStep) {
      setReadyState({ step, ready: true });
      contentAnim.setValue(1);
      return;
    }
    setReadyState({ step, ready: false });
    contentAnim.setValue(0);
    const id = setTimeout(() => setReadyState((s) => (s.step === step ? { step, ready: true } : s)), 300);
    return () => clearTimeout(id);
  }, [step, contentAnim]);
  const haloReady = readyState.step === step && readyState.ready;
  React.useEffect(() => {
    if (haloReady) {
      Animated.timing(contentAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }
  }, [haloReady, contentAnim]);

  // ── Tab → tab halo slide ──────────────────────────────────────────────────
  // When two consecutive steps both highlight a bottom-tab pill (e.g.
  // favorites → profile), the halo used to wait out the 300 ms settle behind a
  // full-screen dim, then snap to the new pill — so the glass pill's own slide
  // happened invisibly under the dim and the whole thing read as "the page
  // refreshed" instead of "the nav button moved". Tab-pill positions are
  // deterministic (tabBarTopY + tabIndex), so there's nothing to settle: we
  // skip the dim-settle for a tab→tab move and instead GLIDE the cutout + ring
  // from the previous pill to the new one, in sync with the glass pill spring.
  const TAB_BAR_LEFT = 20;
  const tabSlideX = React.useRef(new Animated.Value(0)).current;
  const [liveTabX, setLiveTabX] = React.useState<number | null>(null);
  const prevTabIdxRef = React.useRef<number | null>(null);
  const [tabSliding, setTabSliding] = React.useState(false);
  React.useEffect(() => {
    const id = tabSlideX.addListener(({ value }) => setLiveTabX(value));
    return () => tabSlideX.removeListener(id);
  }, [tabSlideX]);
  React.useEffect(() => {
    if (step === null) { prevTabIdxRef.current = null; setTabSliding(false); return; }
    const s = WALKTHROUGH_STEPS[step];
    if (!s || s.highlight !== 'tab') {
      // Element step — forget the prior tab so the NEXT tab step fades in
      // fresh (via haloReady) instead of sliding from a stale position.
      prevTabIdxRef.current = null;
      setTabSliding(false);
      return;
    }
    if (tabBarTopY == null || tabWidth <= 0) return; // can't place yet
    const idx = s.tabIndex ?? 0;
    const targetLeft = TAB_BAR_LEFT + (idx * tabWidth) + 6;
    const prevIdx = prevTabIdxRef.current;
    prevTabIdxRef.current = idx;
    if (prevIdx != null && prevIdx !== idx) {
      // tab → tab: slide. The halo is the motion here, so show it immediately
      // (bypass the settle) and keep it fully opaque (no fade).
      const prevLeft = TAB_BAR_LEFT + (prevIdx * tabWidth) + 6;
      tabSlideX.setValue(prevLeft);
      setLiveTabX(prevLeft);
      contentAnim.setValue(1);
      setTabSliding(true);
      Animated.spring(tabSlideX, { toValue: targetLeft, useNativeDriver: false, friction: 14, tension: 80 })
        .start(() => setTabSliding(false));
    } else {
      // First tab step (or re-entry from an element step) — place instantly and
      // let the normal haloReady fade-in handle the appearance.
      tabSlideX.setValue(targetLeft);
      setLiveTabX(targetLeft);
      setTabSliding(false);
    }
  }, [step, tabBarTopY, tabWidth, tabSlideX, contentAnim]);

  // (Reverted) An invalidate-then-remeasure tab-bar effect lived here to
  // chase the step-0 wrong-position flash. It propagated parent re-renders
  // that destabilised the firstBasketCard / restaurantSurpriseBasket halo
  // positions (steps 1 and 2). Per user direction, accuracy of all element
  // steps outweighs eliminating the one-frame snap on the tab-pill halo.

  // Step-driven safety net for the demo flags. The step's `enter` clause is
  // SUPPOSED to flip these on/off, but any race that loses that single set
  // (overlay unmounted mid-transition, fast tap, missing dep, etc.) would
  // leave the demo card un-injected — and the symptom is exactly what users
  // hit: tapping the "first basket card" on Discover routes to a real
  // location because the demo card was never prepended. We re-derive the
  // flag from the active step's measureKey here, on every step change, so a
  // missed enter-set self-corrects on the very next render.
  const stepNeedsDemoCustomer = React.useMemo(() => {
    if (step === null) return false;
    const s = WALKTHROUGH_STEPS[step];
    const k = s?.measureKey;
    return k === 'firstBasketCard'
      || k === 'restaurantSurpriseBasket'
      || k === 'basketReserveBtn'
      || k === 'reserveQtySection'
      || k === 'reservePaymentSection'
      || k === 'reserveConfirmBtn'
      || k === 'customerOrderCard'
      || k === 'customerPickupCode';
  }, [step]);
  const stepNeedsDemoOrder = React.useMemo(() => {
    if (step === null) return false;
    const s = WALKTHROUGH_STEPS[step];
    const k = s?.measureKey;
    return k === 'customerOrderCard' || k === 'customerPickupCode';
  }, [step]);
  React.useEffect(() => {
    if (stepNeedsDemoCustomer && !demoCustomerActive) setDemoCustomerActive(true);
  }, [stepNeedsDemoCustomer, demoCustomerActive, setDemoCustomerActive]);
  React.useEffect(() => {
    if (stepNeedsDemoOrder && !demoOrderActive) setDemoOrderActive(true);
  }, [stepNeedsDemoOrder, demoOrderActive, setDemoOrderActive]);

  // No fade-in animation. `fadeAnim` is initialised at 1 (see ref
  // declaration above) so the overlay is fully opaque the moment the
  // walkthrough starts — the welcome cover unmounts and the dim+halo
  // appears INSTANTLY underneath, no semi-transparent fade-in frames
  // that read as jittery. `fadedInRef` is kept around so the cleanup
  // branch can still reset it for the next walkthrough session.
  const fadedInRef = React.useRef(false);
  React.useEffect(() => {
    if (step !== null) {
      if (!fadedInRef.current) {
        fadeAnim.setValue(1);
        fadedInRef.current = true;
      }
      const s = WALKTHROUGH_STEPS[step];
      if (!s) return;

      // Apply this step's enter effects (mirrors the business overlay).
      if (s.enter?.demoCustomer !== undefined) {
        setDemoCustomerActive(s.enter.demoCustomer);
      }
      if (s.enter?.demoOrder !== undefined) {
        setDemoOrderActive(s.enter.demoOrder);
      }

      // Settings hand-off: route to /settings via the tabs root so the
      // navigation stack doesn't keep whatever Stack screen the demo last
      // pushed (e.g. /wallet for the credits step) AND the underlying
      // tab inside /(tabs) is the search tab. Result: a clean stack of
      // /(tabs)/index → /settings, so when the user taps the back button
      // on the settings overlay they land on the search tab (the natural
      // place to start using the app), not the demo-time credits page or
      // a side tab the demo last selected.
      // settings.tsx then renders the SettingsDemoOverlay over the
      // highlighted "Mode démo" row.
      if (s.isSettings) {
        setCurrentStep(null);
        setShowSettingsOverlay(true);
        try {
          // Plain push — keeps the navigation stack valid so any later
          // back navigation works as expected. The post-demo redirect to
          // the search tab is owned by endDemoSequence in app/_layout.tsx,
          // which now routes ALL customers (not just first-login) back to
          // /(tabs)/ when the demo concludes. That way: demo's last step
          // briefly shows /settings highlighted, user taps "OK, terminer
          // la démo", endDemoSequence pops them straight to the search
          // tab — no stale /wallet in the back stack, no manipulation of
          // the stack here, no POP_TO_TOP or GO_BACK errors.
          router.push('/settings' as never);
        } catch {}
        return;
      }

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
          tapTarget: s.tapTarget,
          radius: s.target?.radius,
          // Forward the step's `target` so the SubScreenWalkthroughOverlay can
          // render a halo + tooltip at a sensible position even if the host
          // screen hasn't published its measured rect yet (slow first paint,
          // off-screen element waiting for scroll, etc.).
          target: s.target,
        });
      } else {
        setCurrentStep(null);
      }

      const onSubScreen = pathname.startsWith('/map-view') || pathname.startsWith('/wallet') || pathname.startsWith('/notifications') || pathname.startsWith('/settings') || pathname.startsWith('/restaurant/') || pathname.startsWith('/basket/') || pathname.startsWith('/reserve');
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

      // Push sub-screen for steps that explicitly request it. Defer to the
      // next frame instead of an arbitrary 100 ms delay — that lets the
      // step's own render (overlay fade, halo reposition) commit before
      // React Navigation begins its stack push animation, so the two
      // transitions don't overlap and produce visible double-paint.
      if (s.pushRoute) {
        requestAnimationFrame(() => {
          if (!pathname.startsWith(s.pushRoute!)) {
            try { router.push(s.pushRoute! as never); } catch {}
          }
        });
      }
    } else {
      // Walkthrough ended — clear the settings overlay flag AND reset the
      // fade-in guard so the NEXT walkthrough session animates in from 0
      // again instead of popping in fully opaque.
      setShowSettingsOverlay(false);
      fadedInRef.current = false;
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

  // Trap Android back press while the walkthrough is active — the only
  // legitimate exit is the "Quitter la démo" link in the tooltip. Returning
  // true from the listener consumes the event so the navigator never sees
  // it. Listener self-removes once `step` returns to null.
  React.useEffect(() => {
    if (step === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [step]);

  if (step === null) return null;
  const current = WALKTHROUGH_STEPS[step];
  if (!current) return null;
  // Settings hand-off — the settings screen renders its own overlay; this
  // overlay must not paint anything (no halo, no dim, no absorbers) over the
  // settings screen.
  if (current.isSettings) return null;
  // Sub-screen steps — these are spotlighted entirely by the
  // `SubScreenWalkthroughOverlay` mounted on /restaurant/[id], /basket/[id]
  // and /reserve. If THIS overlay also renders during a Stack push (the
  // (tabs) layout stays mounted underneath the pushed screen), the user
  // sees a brief flicker of step 1's halo while the new screen slides in —
  // exactly the "jitters by opening step 1 twice" symptom users report on
  // the step 1 → 2 transition. Hide ourselves cleanly for those steps.
  const SUB_SCREEN_MEASURE_KEYS = new Set<string>([
    'restaurantSurpriseBasket',
    'basketReserveBtn',
    'reserveQtySection',
    'reservePaymentSection',
    'reserveConfirmBtn',
  ]);
  if (current.measureKey && SUB_SCREEN_MEASURE_KEYS.has(current.measureKey)) return null;

  const StepIcon = current.icon;
  const isLast = step === WALKTHROUGH_STEPS.length - 1;
  const tabBarLeft = 20;

  // ── Compute cutout + tooltip geometry ─────────────────────────────────
  let rectX = 0, rectY = 0, rectW = 0, rectH = 0, rectRadius = 16;
  let tooltipStyle: any;
  let arrowStyle: any;
  // `ready` = the halo + tooltip can be drawn at their FINAL position. Until
  // then we keep the FULL dim up (a zero-size rect makes buildCutoutPath return
  // the plain outer rectangle — no hole) using the SAME canvas + SVG the ready
  // state uses. Because the dim is never a different element/position between
  // states, there's no dim-only→full tree swap and no -originY positional jump
  // — that swap was the "whole page snaps before the tooltip appears".
  let ready = false;

  if (current.highlight === 'element') {
    const measured = current.measureKey ? (measuredRects[current.measureKey] ?? null) : null;
    const t2 = current.target ?? {};
    // Wait for the host to publish its rect (if the step has a measureKey), the
    // post-step settle, AND the overlay origin to be measured before drawing.
    ready = current.measureKey ? (!!measured && haloReady && originMeasured) : (haloReady && originMeasured);
    if (ready) {
    const w = measured ? measured.w : (t2.width ?? 44);
    const h = measured ? measured.h : (t2.height ?? 44);
    const cx = measured ? measured.x + w / 2
      : (t2.right != null ? SCREEN_W_CUST - t2.right - w / 2 : (t2.left ?? 0) + w / 2);
    const cy = measured ? measured.y + h / 2
      : (t2.bottom != null ? SCREEN_H_CUST - t2.bottom - h / 2 : (t2.top ?? 0) + h / 2);
    // Halo sits flush with the measured element (no 6px expansion) — matches
    // SubScreenWalkthroughOverlay. Inconsistent expansion between the two
    // overlays was visible to the user as the wallet/credits step's halo
    // floating off-target.
    if (measured) {
      rectX = measured.x;
      rectY = measured.y;
      rectW = measured.w;
      // Clamp halo height so it never extends behind the tab bar at the
      // bottom — the tab bar must always stay dimmed for visual consistency,
      // even when the highlighted element (e.g. the expanded demo order
      // card) is taller than the visible content area.
      const TAB_BAR_HEIGHT_CLAMP = 88;
      const maxRectBottom = SCREEN_H_CUST - TAB_BAR_HEIGHT_CLAMP;
      rectH = Math.max(0, Math.min(measured.h, maxRectBottom - measured.y));
      rectRadius = (t2.radius ?? 12);
    } else {
      rectX = cx - w / 2 - 6;
      rectY = cy - h / 2 - 6;
      rectW = w + 12;
      rectH = h + 12;
      rectRadius = (t2.radius ?? 12) + 6;
    }

    // Pick a placement, then verify it fits — flip if not. Same fix as the
    // business overlay (see formConfirm bug).
    // `safeBottom` accounts for BOTH the floating tab bar AND the system
    // bottom inset (Android 3-button nav, iPhone home-indicator). The old
    // hardcoded 88 + 12 ignored insets.bottom and let the tooltip's
    // action row slide under the Android nav buttons on Pixel-class phones.
    const TAB_BAR_HEIGHT = 88;
    // Safe-area edges include the system insets PLUS visible padding
    // so the tooltip never sits flush against the bezel.
    const safeTop = (insets?.top ?? 0) + LAYOUT_OVERLAY_EDGE_PADDING;
    const safeBottom = TAB_BAR_HEIGHT + (insets?.bottom ?? 0) + LAYOUT_OVERLAY_EDGE_PADDING;
    const elementTop = rectY;
    const elementBottom = rectY + rectH;
    // Use live measured tooltip height for fit / widen decisions.
    const tHeight = tooltipH;
    // Adaptive width — when natural placement doesn't have room for a
    // 280-wide tooltip, widen to 360 so the text reflows shorter. Wider
    // is better than clamping into the highlighted element.
    const spaceBelow = (SCREEN_H_CUST - safeBottom) - (elementBottom + 20);
    const spaceAbove = (elementTop - 20) - safeTop;
    // Base the widen decision on the FIXED estimate, not the live measured
    // `tHeight` — using the measured height fed back (widen → shorter → unwiden
    // → taller → …) and made the tooltip jitter between two positions on large
    // screens. Estimate is constant ⇒ stable width; measured height still
    // drives the vertical clamp.
    const needsWiden = LAYOUT_OVERLAY_TOOLTIP_ESTIMATE > Math.max(spaceBelow, spaceAbove);
    // Never wider than the screen (small phones), widen-to-shorten otherwise.
    const tooltipWidth = Math.min(needsWiden ? 360 : 280, SCREEN_W_CUST - 32);
    const GAP = 16;
    const fitsBelow = tHeight <= spaceBelow - GAP;
    const fitsAbove = tHeight <= spaceAbove - GAP;
    let tooltipBelow = current.tooltipPosition
      ? current.tooltipPosition === 'bottom'
      : cy < SCREEN_H_CUST / 2;
    if (tooltipBelow && !fitsBelow && fitsAbove) tooltipBelow = false;
    else if (!tooltipBelow && !fitsAbove && fitsBelow) tooltipBelow = true;
    else if (!fitsBelow && !fitsAbove) tooltipBelow = spaceBelow >= spaceAbove; // neither fits → use the roomier side
    const ttLeft = Math.max(16, Math.min(cx - tooltipWidth / 2, SCREEN_W_CUST - tooltipWidth - 16));
    // SHRINK, don't cover. If the tooltip is taller than the room beside the
    // element, scale it down to fit that room instead of clamping it ON TOP of
    // the highlighted card. Center-origin scale, so layoutTop is offset to keep
    // the VISUAL box sitting in the gap next to the element (never overlapping).
    const available = (tooltipBelow ? spaceBelow : spaceAbove) - GAP;
    const ttScale = tHeight > available ? Math.max(0.7, available / tHeight) : 1;
    const scaledH = tHeight * ttScale;
    const layoutTop = tooltipBelow
      ? (elementBottom + GAP) - (tHeight - scaledH) / 2
      : (elementTop - GAP) - (tHeight + scaledH) / 2;
    tooltipStyle = {
      position: 'absolute' as const,
      top: layoutTop,
      left: ttLeft,
      width: tooltipWidth,
      ...(ttScale < 1 ? { transform: [{ scale: ttScale }] } : null),
    };
    // Arrow only at full scale — center-origin scaling shifts the box edges, so
    // a scaled box's arrow would no longer point at the element.
    arrowStyle = ttScale === 1 ? {
      position: 'absolute' as const,
      left: Math.max(20, Math.min(cx - ttLeft - 8, tooltipWidth - 28)),
      width: 16, height: 16, backgroundColor: '#fff',
      transform: [{ rotate: '45deg' }],
      ...(tooltipBelow ? { top: -8 } : { bottom: -8 }),
    } : null;
    }
  } else {
    // Tab pill. Position is deterministic (tabBarTopY + tabIndex). A tab→tab
    // slide bypasses the settle (the gliding halo IS the transition); a
    // first/standalone tab step waits out the settle + origin measurement.
    ready = tabBarTopY != null && tabWidth > 0 && originMeasured && (haloReady || tabSliding);
    if (ready) {
    // Math: the pill is vertically centered inside the 60-tall tab bar
    // via alignItems:'center', so pill top = tabBarTop + (60-44)/2 = +8.
    // Halo outset 2 px above the pill → rectY = tabBarTop + 8 - 2 = +6.
    const idx = current.tabIndex ?? 0;
    const tabBarTop = tabBarTopY as number;
    // `liveTabX` follows the slide spring (tab→tab); falls back to the
    // deterministic target for the first paint / standalone tab steps.
    const targetLeft = tabBarLeft + (idx * tabWidth) + 6;
    rectX = liveTabX ?? targetLeft;
    rectY = tabBarTop + 6;
    rectW = tabWidth - 12;
    rectH = 44 + 4;
    rectRadius = 14;
    const pillCenterX = rectX + rectW / 2;
    const ttW = Math.min(280, SCREEN_W_CUST - 32);
    const ttLeft = Math.max(16, Math.min(pillCenterX - ttW / 2, SCREEN_W_CUST - ttW - 16));
    tooltipStyle = { position: 'absolute' as const, bottom: 100, left: ttLeft, width: ttW };
    arrowStyle = {
      position: 'absolute' as const, bottom: -8,
      left: Math.max(20, Math.min(pillCenterX - ttLeft - 8, ttW - 28)),
      width: 16, height: 16, backgroundColor: '#fff',
      transform: [{ rotate: '45deg' }],
    };
    }
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

  // Clamp the cutout rect so the four absorber frames can never receive
  // negative widths/heights when the highlight sits near a screen edge.
  // Element steps wrap the cutout with four absorber frames so the user
  // can't tap anything outside the highlighted element during the demo
  // (matches the business overlay; previously a customer-demo step that
  // dimmed the screen still let the user tap unrelated controls).
  const cX = Math.max(0, rectX);
  const cY = Math.max(0, rectY);
  const cW = Math.max(0, Math.min(rectW, SCREEN_W_CUST - cX));
  const cH = Math.max(0, Math.min(rectH, SCREEN_H_CUST - cY));
  const absorb = {
    onStartShouldSetResponder: () => true,
    onResponderRelease: () => { /* absorb silently */ },
  } as const;

  // Each frame: TAB steps treat the surrounding dim area as "tap to advance"
  // (matches the previous customer-overlay UX). ELEMENT steps absorb the tap
  // silently — the user must hit the highlighted element or use the
  // tooltip's Next button to move on.
  const FrameView = (frameStyle: any) =>
    handleMaskTap
      ? <TouchableOpacity activeOpacity={1} onPress={handleMaskTap} style={frameStyle} />
      : <View {...absorb} style={frameStyle} />;

  return (
    <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }} onLayout={remeasureOrigin}>
      <View ref={originRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
      {/* Window-coords canvas — see useOverlayOriginOffset. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: -originY, left: -originX, width: SCREEN_W_CUST, height: SCREEN_H_CUST }}>
        {/* Edge-to-edge dim extensions for Samsung — cover the status bar
            (above the window) and the system nav bar (below the window).
            Same rgba as the cutout SVG so the seams are invisible. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: -insets.top - 100, left: 0, right: 0, height: insets.top + 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', bottom: -insets.bottom - 100, left: 0, right: 0, height: insets.bottom + 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        {/* Visual dim — non-interactive. The four absorber frames below
            handle taps so the user can't reach unrelated UI through the
            dimmed area. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
          <Svg width={SCREEN_W_CUST} height={SCREEN_H_CUST} style={StyleSheet.absoluteFillObject} pointerEvents="none">
            <Path d={cutoutPath} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
          </Svg>
        </View>

        {ready ? (
        <>
        {/* Four absorber frames around the cutout. */}
        {FrameView({ position: 'absolute', left: 0, right: 0, top: 0, height: cY })}
        {FrameView({ position: 'absolute', left: 0, right: 0, top: cY + cH, bottom: 0 })}
        {FrameView({ position: 'absolute', top: cY, height: cH, left: 0, width: cX })}
        {FrameView({ position: 'absolute', top: cY, height: cH, left: cX + cW, right: 0 })}

        {/* Halo ring + tooltip fade in together once the step's layout has
            settled — the dim/cutout stays constant so only the highlight
            glides in, no hard pop. */}
        <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, opacity: contentAnim }}>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: rectX, top: rectY, width: rectW, height: rectH, borderRadius: rectRadius, borderWidth: 3, borderColor: '#e3ff5c' }}
        />

        <View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && Math.abs(h - tooltipH) > 2) setTooltipH(h);
          }}
          style={{
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
                {current.tapTarget === 'card'
                  ? t('walkthrough.tapCardToContinue', { defaultValue: 'Appuyez sur la carte entourée pour continuer.' })
                  : t('walkthrough.tapToContinue', { defaultValue: 'Appuyez sur le bouton entouré pour continuer.' })}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => {
                // Clear all walkthrough + demo state (clearDemoState wipes
                // demoCustomerActive / demoOrderActive so the injected demo
                // basket on Discover and the demo order on the orders tab
                // both disappear immediately) and pop the user back to the
                // Discover tab — they shouldn't be stranded on a non-demo
                // tab (e.g. Profile) when they quit.
                skipWalkthrough();
                try { router.replace('/(tabs)/' as never); } catch {}
              }}
            >
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
          {arrowStyle ? <View style={arrowStyle} /> : null}
        </View>
        </Animated.View>
        </>
        ) : (
          // Not ready yet — keep the full dim up (the SVG above has no cutout
          // because rectW/H are 0) and absorb all taps so nothing underneath is
          // reachable while we wait for measurement + settle.
          <View {...absorb} pointerEvents="auto" style={StyleSheet.absoluteFillObject} />
        )}
      </View>
      </Animated.View>
  );
}

const walkthroughStyles = StyleSheet.create({});
