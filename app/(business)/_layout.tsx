import { Tabs } from "expo-router";
import { LayoutDashboard, ShoppingBag, ClipboardList, User, Bell, Settings } from "lucide-react-native";
import React from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, Animated, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getUnreadCount } from "@/src/services/notifications";
import { fetchTodayOrders } from "@/src/services/business";
import { useNotificationStore } from "@/src/stores/notificationStore";
import { useAuthStore } from "@/src/stores/authStore";

export default function BusinessTabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const router = useRouter();
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const brandAnim = React.useRef(new Animated.Value(0)).current;

  const tabCount = 4;
  const navWidth = Dimensions.get('window').width - 64;
  const tabWidth = navWidth / tabCount;
  const glassAnim = React.useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = React.useState(0);

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

  const todayOrdersQuery = useQuery({
    queryKey: ['today-orders-count'],
    queryFn: fetchTodayOrders,
    enabled: isAuthenticated,
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
      alignItems: 'baseline',
      opacity: brandAnim,
      transform: [
        { translateX: brandAnim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
        { scale: brandAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 1.05, 1] }) },
      ],
    }}>
      <Text style={{
        color: theme.colors.primary,
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

            {state.routes.map((route, index) => {
              const { options } = descriptors[route.key];
              const isFocused = state.index === index;
              const color = isFocused ? theme.colors.primary : theme.colors.textSecondary;

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
              const fill = isFocused ? color : 'transparent';
              switch (route.name) {
                case 'dashboard': icon = <LayoutDashboard size={iconSize} color={color} fill={fill} />; break;
                case 'my-baskets': icon = <ShoppingBag size={iconSize} color={color} fill={fill} />; break;
                case 'incoming-orders':
                  icon = <ClipboardList size={iconSize} color={color} fill={fill} />;
                  if (pendingOrderCount > 0) {
                    badge = pendingOrderCount;
                  }
                  break;
                case 'business-profile': icon = <User size={iconSize} color={color} fill={fill} />; break;
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
        name="dashboard"
        options={{
          title: t('business.dashboard.title'),
          headerShown: false,
          tabBarIcon: ({ color, size, focused }) => <LayoutDashboard size={size} color={color} fill={focused ? color : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="my-baskets"
        options={{
          title: t('business.baskets.title'),
          tabBarIcon: ({ color, size, focused }) => <ShoppingBag size={size} color={color} fill={focused ? color : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="incoming-orders"
        options={{
          title: t('business.orders.title'),
          tabBarIcon: ({ color, size, focused }) => <ClipboardList size={size} color={color} fill={focused ? color : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="business-profile"
        options={{
          title: t('business.profile.title'),
          tabBarIcon: ({ color, size, focused }) => <User size={size} color={color} fill={focused ? color : 'transparent'} />,
        }}
      />
    </Tabs>
  );
}
