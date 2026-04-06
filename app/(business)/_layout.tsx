import { Tabs } from "expo-router";
import { LayoutDashboard, ShoppingBag, ClipboardList, User, Bell, Settings, ChevronDown, MapPin, Check } from "lucide-react-native";
import React from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, Animated, Dimensions, PanResponder, Modal } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getUnreadCount } from "@/src/services/notifications";
import { fetchTodayOrders } from "@/src/services/business";
import { fetchMyContext, fetchOrganizationDetails } from "@/src/services/teams";
import { useNotificationStore } from "@/src/stores/notificationStore";
import { useAuthStore } from "@/src/stores/authStore";
import { useBusinessStore } from "@/src/stores/businessStore";

export default function BusinessTabLayout() {
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

  // Guard: customer accounts must not see the business flow
  React.useEffect(() => {
    if (isAuthenticated && user?.role !== 'business') {
      console.log('[BusinessLayout] Non-business user detected, redirecting to (tabs)');
      router.replace('/(tabs)' as never);
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

  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const setSelectedLocationId = useBusinessStore((s) => s.setSelectedLocationId);

  // Fetch org context & locations for the location dropdown
  const [locationModalVisible, setLocationModalVisible] = React.useState(false);

  const myContextQuery = useQuery({
    queryKey: ['my-context'],
    queryFn: fetchMyContext,
    enabled: isAuthenticated && user?.role === 'business',
    staleTime: 5 * 60_000,
  });

  const orgId = myContextQuery.data?.organization_id;
  const myRole = myContextQuery.data?.role;

  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });

  const orgLocations = orgDetailsQuery.data?.locations ?? [];
  const isAdminOrOwner = myRole === 'admin' || myRole === 'owner';

  // Derive the current location name for display
  const selectedLocationName = React.useMemo(() => {
    if (!selectedLocationId) return myContextQuery.data?.organization_name ?? (isAdminOrOwner ? t('business.allLocations', { defaultValue: 'Tous les emplacements' }) : (orgLocations[0]?.name ?? t('business.location', { defaultValue: 'Emplacement' })));
    const loc = orgLocations.find((l) => l.id === Number(selectedLocationId));
    return loc?.name ?? t('business.location', { defaultValue: 'Location' });
  }, [selectedLocationId, orgLocations, isAdminOrOwner, t]);

  // PanResponder for swipe-to-dismiss on the location modal
  const modalPanResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
    onPanResponderRelease: (_, g) => {
      if (g.dy > 60) {
        setLocationModalVisible(false);
      }
    },
  }), []);

  const todayOrdersQuery = useQuery({
    queryKey: ['today-orders-count', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    enabled: isAuthenticated && user?.role === 'business',
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const pendingOrderCount = (todayOrdersQuery.data ?? []).filter(
    (o: any) => o.status === 'confirmed' || o.status === 'reserved' || o.status === 'pending'
  ).length;

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
      alignItems: 'center',
      opacity: brandAnim,
      transform: [
        { translateX: brandAnim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
        { scale: brandAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 1.05, 1] }) },
      ],
    }}>
      <TouchableOpacity
        onPress={() => setLocationModalVisible(true)}
        style={{ flexDirection: 'row', alignItems: 'center' }}
        activeOpacity={0.7}
      >
        <MapPin size={18} color={theme.colors.primary} style={{ marginRight: 6 }} />
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.textPrimary,
            fontSize: 16,
            fontWeight: '600',
            fontFamily: 'Poppins_700Bold',
            maxWidth: 180,
          }}
        >
          {selectedLocationName}
        </Text>
        <ChevronDown size={18} color={theme.colors.textSecondary} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    </Animated.View>
  );

  const headerRight = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TouchableOpacity
        onPress={() => router.push('/settings' as never)}
        style={{ marginRight: 12 }}
      >
        <Settings size={20} color={theme.colors.textPrimary} />
      </TouchableOpacity>
      {isAuthenticated ? (
        <TouchableOpacity
          onPress={() => router.push('/notifications' as never)}
          style={{ marginRight: 16 }}
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
      ) : null}
    </View>
  );

  return (
    <>
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
        navStateRef.current = state;
        navRef.current = navigation;

        // Defer state update to avoid "cannot update during render" warning
        const targetX = state.index * tabWidth;
        if (activeIndex !== state.index) {
          requestAnimationFrame(() => {
            Animated.spring(glassAnim, {
              toValue: targetX,
              useNativeDriver: true,
              friction: 10,
              tension: 100,
            }).start();
            setActiveIndex(state.index);
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
              height: 68,
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
                height: 52,
                backgroundColor: theme.colors.primary,
                borderRadius: 22,
                left: 6,
                transform: [{ translateX: glassAnim }],
              }}
            />

            {state.routes.map((route, index) => {
              const { options } = descriptors[route.key];
              const isFocused = state.index === index;
              const color = isFocused ? '#FFFFFF' : theme.colors.textSecondary;
              const iconColor = isFocused ? '#FFFFFF' : theme.colors.textSecondary;

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
              let badge = 0;
              const iconSize = 22;
              // Single clean icon — no double-stacking which caused washout on dark bg
              const renderBizIcon = (IconComp: any) => (
                <IconComp size={iconSize} color={iconColor} />
              );
              switch (route.name) {
                case 'dashboard': icon = renderBizIcon(LayoutDashboard); break;
                case 'my-baskets': icon = renderBizIcon(ShoppingBag); break;
                case 'incoming-orders':
                  icon = renderBizIcon(ClipboardList);
                  if (pendingOrderCount > 0) {
                    badge = pendingOrderCount;
                  }
                  break;
                case 'business-profile': icon = renderBizIcon(User); break;
              }

              return (
                <TouchableOpacity
                  key={route.key}
                  onPress={onPress}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 68,
                    paddingHorizontal: 4,
                  }}
                  activeOpacity={0.7}
                >
                  <View style={{ position: 'relative' }}>
                    {icon}
                    {badge > 0 && (
                      <View style={{
                        position: 'absolute',
                        top: -4,
                        right: -10,
                        backgroundColor: theme.colors.error,
                        borderRadius: 8,
                        minWidth: 16,
                        height: 16,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 4,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{badge > 99 ? '99+' : badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={{
                      color,
                      fontSize: 8,
                      fontFamily: 'Poppins_500Medium',
                      marginTop: 3,
                      width: tabWidth - 16,
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
        name="dashboard"
        options={{
          title: t('business.dashboard.tabLabel', { defaultValue: 'Accueil' }),
          headerShown: false,
          tabBarIcon: ({ size, focused }) => <LayoutDashboard size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="my-baskets"
        options={{
          title: t('business.baskets.title'),
          tabBarIcon: ({ size, focused }) => <ShoppingBag size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="incoming-orders"
        options={{
          title: t('business.orders.title'),
          tabBarIcon: ({ size, focused }) => <ClipboardList size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="business-profile"
        options={{
          title: t('business.profile.title'),
          tabBarIcon: ({ size, focused }) => <User size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
    </Tabs>

    {/* Location selector modal */}
    <Modal
      visible={locationModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setLocationModalVisible(false)}
    >
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        activeOpacity={1}
        onPress={() => setLocationModalVisible(false)}
      >
        <View
          {...modalPanResponder.panHandlers}
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 12,
            paddingBottom: 40,
            paddingHorizontal: 20,
            maxHeight: '60%',
          }}
          onStartShouldSetResponder={() => true}
        >
          {/* Drag handle */}
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.divider, marginBottom: 16 }} />

          <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginBottom: 16 }}>
            {t('business.selectLocation', { defaultValue: 'Select location' })}
          </Text>

          {/* "All locations" option for admin/owner */}
          {isAdminOrOwner && (
            <TouchableOpacity
              onPress={() => { setSelectedLocationId(null); setLocationModalVisible(false); }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderRadius: 12,
                backgroundColor: !selectedLocationId ? theme.colors.primary + '12' : 'transparent',
                marginBottom: 4,
              }}
              activeOpacity={0.7}
            >
              <MapPin size={20} color={!selectedLocationId ? theme.colors.primary : theme.colors.textSecondary} />
              <Text style={{
                flex: 1,
                marginLeft: 12,
                color: !selectedLocationId ? theme.colors.primary : theme.colors.textPrimary,
                fontSize: 15,
                fontWeight: !selectedLocationId ? '700' : '500',
                fontFamily: !selectedLocationId ? 'Poppins_700Bold' : 'Poppins_500Medium',
              }}>
                {t('business.allLocations', { defaultValue: 'All locations' })}
              </Text>
              {!selectedLocationId && <Check size={20} color={theme.colors.primary} />}
            </TouchableOpacity>
          )}

          {/* Individual locations */}
          {orgLocations.map((loc) => {
            const isSelected = Number(selectedLocationId) === loc.id;
            return (
              <TouchableOpacity
                key={loc.id}
                onPress={() => { setSelectedLocationId(loc.id); setLocationModalVisible(false); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: isSelected ? theme.colors.primary + '12' : 'transparent',
                  marginBottom: 4,
                }}
                activeOpacity={0.7}
              >
                <MapPin size={20} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{
                    color: isSelected ? theme.colors.primary : theme.colors.textPrimary,
                    fontSize: 15,
                    fontWeight: isSelected ? '700' : '500',
                    fontFamily: isSelected ? 'Poppins_700Bold' : 'Poppins_500Medium',
                  }}>
                    {loc.name ?? t('business.unnamedLocation', { defaultValue: 'Unnamed location' })}
                  </Text>
                  {loc.address ? (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 2 }} numberOfLines={1}>
                      {loc.address}
                    </Text>
                  ) : null}
                </View>
                {isSelected && <Check size={20} color={theme.colors.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    </Modal>
    </>
  );
}
