import { Tabs } from "expo-router";
import { Search, ShoppingBag, Heart, User, Bell, Settings } from "lucide-react-native";
import React from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, Animated, Dimensions, PanResponder } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getUnreadCount } from "@/src/services/notifications";
import { useNotificationStore } from "@/src/stores/notificationStore";
import { useAuthStore } from "@/src/stores/authStore";
import { useHeroStore } from "@/src/stores/heroStore";

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
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon size={size} color={color} fill={fill ?? 'transparent'} />
    </Animated.View>
  );
}

export default function TabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const brandAnim = React.useRef(new Animated.Value(0)).current;

  const tabCount = 4;
  const navWidth = Dimensions.get('window').width - 64;
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

  const swipePanResponder = React.useMemo(() => PanResponder.create({
    // Only capture clearly horizontal swipes
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
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
      // Flick: velocity > 0.4 nudges to next/prev tab
      let targetIdx = Math.round(raw / tabWidth);
      if (g.vx > 0.4) targetIdx = Math.min(tabCount - 1, Math.floor(raw / tabWidth) + 1);
      else if (g.vx < -0.4) targetIdx = Math.max(0, Math.ceil(raw / tabWidth) - 1);
      targetIdx = Math.max(0, Math.min(tabCount - 1, targetIdx));

      Animated.spring(glassAnim, {
        toValue: targetIdx * tabWidth,
        useNativeDriver: true,
        friction: 10,
        tension: 100,
      }).start();
      setActiveIndex(targetIdx);
      const routes = navStateRef.current?.routes ?? [];
      if (routes[targetIdx]) navRef.current?.navigate(routes[targetIdx].name);
    },
    onPanResponderTerminate: () => {
      glassAnim.flattenOffset();
    },
  }), [glassAnim, tabWidth, tabCount]);

  const heroVisible = useHeroStore((s) => s.heroVisible);
  const isSearchTab = activeIndex === 0;
  const headerIconColor = isSearchTab && heroVisible ? '#e3ff5c' : theme.colors.textPrimary;
  const headerBrandColor = isSearchTab && heroVisible ? '#e3ff5c' : theme.colors.primary;

  // Guard: business accounts must not see the customer flow
  React.useEffect(() => {
    if (isAuthenticated && user?.role === 'business') {
      console.log('[TabLayout] Business user detected, redirecting to (business)/dashboard');
      router.replace('/(business)/dashboard' as never);
    } else if (!isAuthenticated) {
      router.replace('/auth/sign-in' as never);
    }
  }, [isAuthenticated, user?.role]);

  const unreadQuery = useQuery({
    queryKey: ['unread-count'],
    queryFn: getUnreadCount,
    enabled: isAuthenticated,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (unreadQuery.data !== undefined) {
      setUnreadCount(unreadQuery.data);
    }
  }, [unreadQuery.data, setUnreadCount]);

  React.useEffect(() => {
    Animated.spring(brandAnim, {
      toValue: 1,
      friction: 6,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, []);

  const headerBrand = () => (
    <Animated.View style={{
      marginLeft: 16,
      flexDirection: 'row',
      alignItems: 'baseline',
      opacity: brandAnim,
      transform: [
        { translateX: brandAnim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
        { scale: brandAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 1.05, 1] }) },
      ],
    }}>
      <Text style={{
        color: headerBrandColor,
        fontSize: 20,
        fontWeight: '700',
        fontFamily: 'Poppins_700Bold',
      }}>
        Barakeat
      </Text>
      <Text style={{
        color: '#e3ff5c',
        fontSize: 20,
        fontWeight: '700',
        fontFamily: 'Poppins_700Bold',
      }}>
        .
      </Text>
    </Animated.View>
  );

  const headerRight = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TouchableOpacity
        onPress={() => router.push('/settings' as never)}
        style={{ marginRight: 12 }}
      >
        <Settings size={20} color={headerIconColor} />
      </TouchableOpacity>
      {isAuthenticated ? (
        <TouchableOpacity
          onPress={() => router.push('/notifications' as never)}
          style={{ marginRight: 16 }}
        >
          <Bell size={20} color={headerIconColor} />
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
      ) : null}
    </View>
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        headerShown: true,
        headerTitle: '',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.bg },
        headerLeft: headerBrand,
        headerRight: headerRight,
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
              left: 32,
              right: 32,
              height: 60,
              backgroundColor: theme.colors.surface,
              borderRadius: 30,
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
                backgroundColor: theme.colors.primary + '12',
                borderRadius: 22,
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
              const color = isFocused ? theme.colors.primary : theme.colors.textSecondary;
              const iconStroke = isFocused ? '#FFFFFF' : theme.colors.textSecondary;
              const iconFill = isFocused ? theme.colors.primary : 'transparent';

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
                case 'index': icon = <TabIcon icon={Search} color={color} size={iconSize} focused={isFocused} fill={iconFill} />; break;
                case 'orders': icon = <TabIcon icon={ShoppingBag} color={color} size={iconSize} focused={isFocused} fill={iconFill} />; break;
                case 'favorites': icon = <TabIcon icon={Heart} color={color} size={iconSize} focused={isFocused} fill={iconFill} />; break;
                case 'profile': icon = <TabIcon icon={User} color={color} size={iconSize} focused={isFocused} fill={iconFill} />; break;
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
  );
}
