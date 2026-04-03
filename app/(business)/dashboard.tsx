import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Dimensions, Image, Animated as RNAnimated } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ShoppingBag, Banknote, Clock, Leaf, Star, X, Package, AlertCircle, Store, Settings, Bell, ChevronDown, Check, Building2 } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/src/stores/authStore';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { fetchStats, fetchTodayOrders, fetchAnalytics, fetchMyProfile } from '@/src/services/business';
import { fetchMyContext, fetchOrganizationDetails } from '@/src/services/teams';
import { apiClient } from '@/src/lib/api';
import { LineChart } from '@/src/components/LineChart';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;

function AnimatedNumber({ value, suffix, duration = 800 }: { value: number; suffix?: string; duration?: number }) {
  const animVal = React.useRef(new RNAnimated.Value(0)).current;
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    animVal.setValue(0);
    RNAnimated.timing(animVal, {
      toValue: value,
      duration,
      useNativeDriver: false,
    }).start();

    const listener = animVal.addListener(({ value: v }) => {
      setDisplay(Math.round(v));
    });
    return () => animVal.removeListener(listener);
  }, [value]);

  return <>{display}{suffix ?? ''}</>;
}

function SimpleBarChart({ data, labels, color, stackData, stackColor }: { data: number[]; labels: string[]; color: string; stackData?: number[]; stackColor?: string }) {
  const theme = useTheme();
  const allMax = Math.max(...data.map((v, i) => v + (stackData?.[i] ?? 0)), 1);
  const barWidth = Math.min(26, (SCREEN_WIDTH - 140) / data.length - 10);

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {data.map((val, i) => {
          const stackVal = stackData?.[i] ?? 0;
          const total = val + stackVal;
          const height = Math.max(4, (total / allMax) * 100);
          const mainH = total > 0 ? (val / total) * height : 0;
          const stackH = total > 0 ? (stackVal / total) * height : 0;
          const isLast = i === data.length - 1;
          return (
            <View key={i} style={chartStyles.barCol}>
              {/* Value label above bar */}
              <Text style={{ color: total > 0 ? theme.colors.textSecondary : 'transparent', fontSize: 9, fontFamily: 'Poppins_600SemiBold', marginBottom: 3 }}>
                {total > 0 ? total : ''}
              </Text>
              <View style={[chartStyles.barBg, { height: 104, width: barWidth, borderRadius: 4, backgroundColor: theme.colors.primary + '08' }]}>
                <View style={{ flex: 1 }} />
                {stackData && (
                  <View style={{ height: stackH, backgroundColor: stackColor ?? theme.colors.secondary, borderTopLeftRadius: 4, borderTopRightRadius: 4, width: barWidth }} />
                )}
                <View style={{
                  height: mainH,
                  backgroundColor: color,
                  borderRadius: 4,
                  width: barWidth,
                  opacity: 0.85 + 0.15 * (val / allMax),
                }} />
              </View>
              <Text style={[{ color: theme.colors.muted, fontSize: 9, marginTop: 6, fontFamily: 'Poppins_400Regular', letterSpacing: 0.1 }]}>
                {labels[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    paddingTop: 4,
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  barCol: {
    alignItems: 'center',
  },
  barBg: {
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
});

function ReviewBar({ label, value, color }: { label: string; value: number; color: string }) {
  const theme = useTheme();
  const pct = (value / 5) * 100;
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontFamily: 'Poppins_400Regular', letterSpacing: 0.1 }}>{label}</Text>
        <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold' }}>{value.toFixed(1)}</Text>
      </View>
      <View style={{ height: 5, backgroundColor: theme.colors.divider, borderRadius: 3 }}>
        <View style={{ height: 5, width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

function StatMiniCard({ icon: Icon, value, label, suffix, color, theme }: any) {
  return (
    <View style={[miniStyles.card, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16 }]}>
      {/* Subtle top-edge rule for visual framing */}
      <View style={{ height: 3, width: 24, backgroundColor: color, borderRadius: 2, marginBottom: 14 }} />
      <View style={[miniStyles.iconWrap, { backgroundColor: color + '12' }]}>
        <Icon size={15} color={color} strokeWidth={2.2} />
      </View>
      <Text style={[
        { color: theme.colors.textPrimary, fontSize: 22, fontFamily: 'Poppins_700Bold', marginTop: 12, letterSpacing: -0.5 },
      ]} numberOfLines={1} adjustsFontSizeToFit>
        {value}{suffix ? ` ${suffix}` : ''}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 3, fontFamily: 'Poppins_400Regular', letterSpacing: 0.1 }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const miniStyles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.045)',
    // soft consistent shadow
    shadowColor: '#114b3c',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default function BusinessDashboard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const insets = useSafeAreaInsets();

  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const setSelectedLocationId = useBusinessStore((s) => s.setSelectedLocationId);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [isSwitchingLocation, setIsSwitchingLocation] = useState(false);
  const switchSpinAnim = React.useRef(new RNAnimated.Value(0)).current;

  const handleLocationSwitch = React.useCallback((id: number | null) => {
    setShowLocationModal(false);
    setIsSwitchingLocation(true);
    switchSpinAnim.setValue(0);
    RNAnimated.loop(
      RNAnimated.timing(switchSpinAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
        easing: (t) => t,
      })
    ).start();
    setTimeout(() => {
      setSelectedLocationId(id);
      setIsSwitchingLocation(false);
      switchSpinAnim.stopAnimation();
    }, 700);
  }, [switchSpinAnim]);

  const statsQuery = useQuery({
    queryKey: ['business-stats', selectedLocationId],
    queryFn: () => fetchStats(selectedLocationId),
    staleTime: 60_000,
    retry: 1,
  });

  const analyticsQuery = useQuery({
    queryKey: ['business-analytics', selectedLocationId],
    queryFn: () => fetchAnalytics(selectedLocationId),
    staleTime: 60_000,
    retry: 1,
  });

  const todayQuery = useQuery({
    queryKey: ['today-orders', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 60_000,
    retry: 1,
  });

  const reviewsQuery = useQuery({
    queryKey: ['my-reviews', selectedLocationId, profileQuery.data?.id],
    queryFn: async () => {
      const profileData = profileQuery.data;
      const restaurantId = profileData?.id;
      if (!restaurantId) return null;
      const res = await apiClient.get(`/api/reviews/restaurant/${restaurantId}`);
      const data = res.data;
      const reviews = Array.isArray(data) ? data : (data as any)?.reviews ?? [];
      if (reviews.length === 0) return null;
      const avgService = reviews.reduce((s: number, r: any) => s + (r.rating_service ?? 0), 0) / reviews.length;
      const avgQuantity = reviews.reduce((s: number, r: any) => s + (r.rating_quantity ?? 0), 0) / reviews.length;
      const avgQuality = reviews.reduce((s: number, r: any) => s + (r.rating_quality ?? 0), 0) / reviews.length;
      const avgVariety = reviews.reduce((s: number, r: any) => s + (r.rating_variety ?? 0), 0) / reviews.length;
      return { service: avgService, quantite: avgQuantity, qualite: avgQuality, variete: avgVariety };
    },
    enabled: !!profileQuery.data?.id,
    staleTime: 60_000,
    retry: 1,
  });

  const analytics = analyticsQuery.data;
  const statsData = statsQuery.data;
  const todayOrders = todayQuery.data ?? [];

  // Show loader until ALL primary queries have either resolved or errored.
  // Using || (not &&) so one fast query resolving doesn't prematurely dismiss
  // the loader and fire animations with still-empty analytics/chart data.
  const hasAnyData = !!(statsQuery.data || analyticsQuery.data || profileQuery.data);
  const isLoading =
    !hasAnyData &&
    (statsQuery.isLoading || analyticsQuery.isLoading || todayQuery.isLoading || profileQuery.isLoading);

  // Compute average rating from all sources — fall back to reviewsQuery averages
  // so even a single user review shows the real score instead of '--'
  const reviewAvg = reviewsQuery.data
    ? ((reviewsQuery.data.service + reviewsQuery.data.quantite + reviewsQuery.data.qualite + reviewsQuery.data.variete) / 4)
    : null;

  // Defensive raw access — handles both camelCase and snake_case API responses.
  // The service layer already normalizes where possible; these local aliases
  // act as a second safety net in case of unexpected response shapes.
  const analyticsRaw = analytics as any;
  const statusBreakdown = analyticsRaw?.statusBreakdown ?? analyticsRaw?.status_breakdown ?? {};
  const weeklySeries: any[] = analyticsRaw?.weekly ?? [];
  const monthlySeries: any[] = analyticsRaw?.monthly ?? [];
  const summaryData = analyticsRaw?.summary ?? {};

  const stats = {
    // ─ Today ─────────────────────────────────────────────
    totalRevenue: summaryData?.revenue_today ?? statsData?.today_revenue ?? 0,
    totalBasketsSold: summaryData?.baskets_sold_today ?? statsData?.today_baskets ?? 0,
    pendingOrders: todayOrders.filter((o: any) => ['confirmed', 'reserved', 'pending'].includes(o.status ?? '')).length,
    mealsRescued: summaryData?.pickups_today ?? 0,
    // ─ Overview ──────────────────────────────────────────
    activeBaskets: profileQuery.data?.available_quantity ?? 0,
    averageRating: (statsData?.average_rating && statsData.average_rating > 0)
      ? statsData.average_rating
      : ((profileQuery.data?.average_rating && profileQuery.data.average_rating > 0)
        ? profileQuery.data.average_rating
        : (reviewAvg ?? 0)),
    // ─ Monthly totals ─────────────────────────────────────
    monthlyRevenue: statsData?.monthly_revenue ?? statsData?.total_revenue ?? 0,
    monthlyBaskets: statsData?.monthly_baskets ?? statsData?.total_completed ?? 0,
    totalOrders: statsData?.total_reservations ?? 0,
    totalCompleted: statsData?.total_completed ?? 0,
    totalCancelled: statsData?.total_cancelled ?? 0,
    // ─ Weekly chart (baskets + revenue per weekday) ───────
    dailySales: weeklySeries.map((d: any) => d.baskets_sold ?? 0),
    dailyRevenue: weeklySeries.map((d: any) => d.revenue ?? 0),
    // dayName may come as 'dayName' (camelCase) or 'day_name' (snake_case);
    // service normalizes but we guard here too.
    dailyLabels: weeklySeries.map((d: any) =>
      (d.dayName ?? d.day_name ?? d.day ?? '').toString().substring(0, 3)
    ),
    // ─ Monthly chart (baskets per month) ─────────────────
    monthlySales: monthlySeries.map((m: any) => m.baskets_sold ?? 0),
    monthlyLabels: monthlySeries.map((m: any) =>
      (m.monthName ?? m.month_name ?? m.month ?? '').toString().substring(0, 3)
    ),
    monthlyRevenueArr: monthlySeries.map((m: any) => m.revenue ?? 0),
    // ─ Status breakdown ───────────────────────────────────
    // API may send 'statusBreakdown' (camelCase) or 'status_breakdown' (snake_case).
    statusConfirmed: statusBreakdown?.confirmed ?? 0,
    statusPickedUp: statusBreakdown?.picked_up ?? 0,
    statusCancelled: statusBreakdown?.cancelled ?? 0,
  };

  const weeklyRevenueTotal = stats.dailyRevenue.reduce((a: number, b: number) => a + b, 0);

  const [showRatingModal, setShowRatingModal] = useState(false);

  const teamContextQuery = useQuery({
    queryKey: ['team-context'],
    queryFn: fetchMyContext,
    staleTime: 300_000,
    retry: 1,
  });

  const orgId = teamContextQuery.data?.organization_id;

  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 300_000,
    retry: 1,
  });

  const orgLocations = orgDetailsQuery.data?.locations ?? [];
  const isAdmin = (teamContextQuery.data?.role ?? '') === 'admin' || (teamContextQuery.data?.role ?? '') === 'owner';
  const selectedLocationName = selectedLocationId
    ? (orgLocations.find((l) => l.id === selectedLocationId)?.name ?? `${t('business.location')} ${selectedLocationId}`)
    : (isAdmin ? (teamContextQuery.data?.organization_name ?? t('business.allLocations')) : (teamContextQuery.data?.location_name ?? t('business.team.locationLabel')));

  const reviews = reviewsQuery.data ?? { service: 0, quantite: 0, qualite: 0, variete: 0 };

  const handleRatingPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowRatingModal(true);
  }, []);

  const chartWidth = Math.min(SCREEN_WIDTH - 80, 320);

  // Staggered fade-in animations — 5 groups for fine-grained entrance rhythm
  const fadeAnim1 = React.useRef(new RNAnimated.Value(0)).current;
  const fadeAnim2 = React.useRef(new RNAnimated.Value(0)).current;
  const fadeAnim3 = React.useRef(new RNAnimated.Value(0)).current;
  const fadeAnim4 = React.useRef(new RNAnimated.Value(0)).current;
  const fadeAnim5 = React.useRef(new RNAnimated.Value(0)).current;
  // Ensures the entrance animation fires exactly once — when data is ready —
  // and never re-fires on subsequent refetches or location switches.
  const animFired = React.useRef(false);

  React.useEffect(() => {
    if (!isLoading && !animFired.current) {
      animFired.current = true;
      RNAnimated.stagger(110, [
        RNAnimated.timing(fadeAnim1, { toValue: 1, duration: 450, useNativeDriver: true }),
        RNAnimated.timing(fadeAnim2, { toValue: 1, duration: 450, useNativeDriver: true }),
        RNAnimated.timing(fadeAnim3, { toValue: 1, duration: 450, useNativeDriver: true }),
        RNAnimated.timing(fadeAnim4, { toValue: 1, duration: 450, useNativeDriver: true }),
        RNAnimated.timing(fadeAnim5, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]).start();
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      {/* Cover photo is always dark/coloured — keep status bar icons white */}
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Floating header - overlays the cover image */}
        <View style={{
          position: 'absolute',
          top: insets.top + 8,
          left: 16,
          right: 16,
          zIndex: 10,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          {/* Team / location switcher */}
          <TouchableOpacity
            onPress={() => setShowLocationModal(true)}
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 8,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              ...theme.shadows.shadowMd,
              maxWidth: 200,
            }}
          >
            <Building2 size={14} color={theme.colors.primary} />
            <Text
              style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flexShrink: 1 }}
              numberOfLines={1}
            >
              {selectedLocationName}
            </Text>
            {orgLocations.length > 0 && (
              <ChevronDown size={13} color={theme.colors.textSecondary} />
            )}
          </TouchableOpacity>

          {/* Settings + Notifications pills */}
          <View style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 20,
            paddingHorizontal: 10,
            paddingVertical: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            ...theme.shadows.shadowMd,
          }}>
            <TouchableOpacity onPress={() => router.push('/settings' as never)}>
              <Settings size={18} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/notifications' as never)}>
              <Bell size={18} color={theme.colors.textPrimary} />
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
          </View>
        </View>

        {/* Cover photo - extends to absolute top of screen */}
        <View style={{ position: 'relative', height: 200 + insets.top, backgroundColor: theme.colors.primary + '20', overflow: 'visible', marginTop: 0 }}>
          {profileQuery.data?.cover_image_url ? (
            <Image source={{ uri: profileQuery.data.cover_image_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <LinearGradient
              colors={['#1a6b54', '#0d3d30']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </View>

        {/* Profile card overlay */}
        <View style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.r16,
          padding: theme.spacing.xl,
          marginTop: -30,
          marginHorizontal: theme.spacing.lg,
          ...theme.shadows.shadowMd,
          flexDirection: 'row',
          alignItems: 'center',
        }}>
          <View style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            borderWidth: 3,
            borderColor: theme.colors.bg,
            overflow: 'hidden',
            backgroundColor: theme.colors.surface,
          }}>
            {profileQuery.data?.image_url ? (
              <Image source={{ uri: profileQuery.data.image_url }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <View style={{ width: '100%', height: '100%', backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
                <Store size={22} color={theme.colors.primary} />
              </View>
            )}
          </View>
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {profileQuery.data?.name ?? user?.name ?? ''}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
              {profileQuery.data?.category ?? ''}
            </Text>
          </View>
        </View>

        <Text style={{ color: theme.colors.textPrimary, fontSize: 26, fontFamily: 'Poppins_700Bold', letterSpacing: -0.4, paddingHorizontal: theme.spacing.xl, marginTop: 14 }}>
          {t('business.dashboard.title')}
        </Text>

        <RNAnimated.View style={{ opacity: fadeAnim1, transform: [{ translateY: fadeAnim1.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <LinearGradient
            colors={['#16604a', '#0c3829']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              marginHorizontal: theme.spacing.xl,
              marginTop: theme.spacing.xl,
              borderRadius: theme.radii.r20,
              padding: theme.spacing.xl,
              overflow: 'hidden',
            }}
          >
            {/* Decorative background circle */}
            <View style={{ position: 'absolute', right: -24, top: -24, width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(227,255,92,0.07)' }} />
            {/* Label */}
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14 }}>
              {t('business.dashboard.daySummary')}
            </Text>
            {/* 4 metrics on same line */}
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Banknote size={13} color={theme.colors.secondary} />
                <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Poppins_700Bold', marginTop: 4, letterSpacing: -0.4 }}>
                  <AnimatedNumber value={stats.totalRevenue} />
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>TND</Text>
              </View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <ShoppingBag size={13} color={theme.colors.secondary} />
                <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Poppins_700Bold', marginTop: 4, letterSpacing: -0.4 }}>
                  <AnimatedNumber value={stats.totalBasketsSold} />
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>{t('business.dashboard.sold')}</Text>
              </View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Clock size={13} color={theme.colors.secondary} />
                <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Poppins_700Bold', marginTop: 4, letterSpacing: -0.4 }}>
                  <AnimatedNumber value={stats.pendingOrders} />
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>{t('business.dashboard.pending')}</Text>
              </View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Package size={13} color={theme.colors.secondary} />
                <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Poppins_700Bold', marginTop: 4, letterSpacing: -0.4 }}>
                  <AnimatedNumber value={stats.mealsRescued} />
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>{t('business.dashboard.rescued')}</Text>
              </View>
            </View>
          </LinearGradient>
        </RNAnimated.View>

        <RNAnimated.View style={{ opacity: fadeAnim2, transform: [{ translateY: fadeAnim2.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <TouchableOpacity
            onPress={handleRatingPress}
            activeOpacity={0.85}
            style={{
              backgroundColor: theme.colors.surface,
              marginHorizontal: theme.spacing.xl,
              marginTop: theme.spacing.lg,
              borderRadius: theme.radii.r16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(0,0,0,0.045)',
              shadowColor: '#114b3c',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.07,
              shadowRadius: 8,
              elevation: 2,
            }}
          >
            {/* Accent stripe along the top*/}
            <View style={{ height: 3, backgroundColor: theme.colors.starYellow, borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
              {/* Left: star icon + score */}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: theme.colors.starYellow + '15',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                  <Star size={20} color={theme.colors.starYellow} fill={theme.colors.starYellow} strokeWidth={1.5} />
                </View>
                <View style={{ marginLeft: 14 }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 26, fontFamily: 'Poppins_700Bold', letterSpacing: -0.5 }}>
                    {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '--'}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular', letterSpacing: 0.2, marginTop: -2 }}>
                    {t('business.dashboard.avgRating').toUpperCase()}
                  </Text>
                </View>
              </View>
              {/* Right: details pill */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.primary,
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 7,
                gap: 4,
              }}>
                <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.2 }}>{t('business.dashboard.details')}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </RNAnimated.View>

        <View style={{ paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }}>
          {/* Section header */}
          <RNAnimated.View style={{ opacity: fadeAnim3, transform: [{ translateY: fadeAnim3.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 3, height: 16, backgroundColor: theme.colors.primary, borderRadius: 2, marginRight: 8 }} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, textTransform: 'uppercase' as const }}>
                {t('business.dashboard.performance')}
              </Text>
            </View>
            <View style={styles.statsRow}>
              <StatMiniCard icon={TrendingUp} value={stats.activeBaskets} label={t('business.dashboard.activeBaskets')} color={theme.colors.primary} theme={theme} />
              <View style={{ width: 10 }} />
              <StatMiniCard icon={Banknote} value={`${stats.monthlyRevenue}`} suffix="TND" label="Revenus ce mois" color={theme.colors.accentWarm} theme={theme} />
            </View>
          </RNAnimated.View>
          {/* Row 2 — delayed via fadeAnim4 */}
          <RNAnimated.View style={{ opacity: fadeAnim4, transform: [{ translateY: fadeAnim4.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }], marginTop: 10 }}>
            <View style={styles.statsRow}>
              <StatMiniCard icon={ShoppingBag} value={stats.monthlyBaskets} label="Paniers ce mois" color={theme.colors.accentFresh} theme={theme} />
              <View style={{ width: 10 }} />
              <StatMiniCard icon={AlertCircle} value={stats.pendingOrders} label={t('business.dashboard.pendingOrders')} color={theme.colors.error} theme={theme} />
            </View>
          </RNAnimated.View>
        </View>

        {/* Order Status Breakdown moved to incoming-orders screen */}

        {/* ── Sales This Week + Monthly Performance — animated as group 5 ── */}
        <RNAnimated.View style={{ opacity: fadeAnim5, transform: [{ translateY: fadeAnim5.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
        {/* ── Sales This Week (Line Chart) ── */}
        <View style={{ paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl }}>
          {/* Section header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 3, height: 16, backgroundColor: theme.colors.primary, borderRadius: 2, marginRight: 8 }} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, textTransform: 'uppercase' as const }}>
                {'Ventes cette semaine'}
              </Text>
            </View>
            {weeklyRevenueTotal > 0 && (
              <View style={{ backgroundColor: theme.colors.accentWarm + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: theme.colors.accentWarm, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                  {`${weeklyRevenueTotal.toFixed(0)} TND`}
                </Text>
              </View>
            )}
          </View>
          {/* Chart panel */}
          <View style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r20,
            borderWidth: 1,
            borderColor: 'rgba(0,0,0,0.04)',
            shadowColor: '#114b3c',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.07,
            shadowRadius: 10,
            elevation: 3,
            overflow: 'hidden',
          }}>
            {/* Panel header strip — LinearGradient accent */}
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
              <LinearGradient
                colors={[theme.colors.primary, theme.colors.accentFresh]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: 3, height: 14, borderRadius: 2, marginRight: 8 }}
              />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontFamily: 'Poppins_400Regular', letterSpacing: 0.3 }}>{'Paniers vendus / jour'}</Text>
            </View>
            <View style={{ paddingHorizontal: 12, paddingBottom: 16, alignItems: 'center' }}>
              {stats.dailySales.length > 0 && stats.dailySales.some((v: number) => v > 0) ? (
                <LineChart
                  data={stats.dailySales}
                  labels={stats.dailyLabels}
                  color={theme.colors.primary}
                  gradientColor={theme.colors.accentFresh}
                  width={chartWidth}
                  height={150}
                />
              ) : (
                <View style={{ height: 150, justifyContent: 'center', alignItems: 'center' }}>
                  <ShoppingBag size={26} color={theme.colors.divider} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 10 }}>
                    {'Pas encore de ventes cette semaine'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Monthly Performance (Bar Chart) ── */}
        <View style={{ paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }}>
          {/* Section header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 3, height: 16, backgroundColor: theme.colors.accentWarm, borderRadius: 2, marginRight: 8 }} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, textTransform: 'uppercase' as const }}>
                {'Performance mensuelle'}
              </Text>
            </View>
            {stats.monthlyBaskets > 0 && (
              <View style={{ backgroundColor: theme.colors.accentFresh + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: theme.colors.accentFresh, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                  {`${stats.monthlyBaskets} paniers`}
                </Text>
              </View>
            )}
          </View>
          {/* Chart panel */}
          <View style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r20,
            borderWidth: 1,
            borderColor: 'rgba(0,0,0,0.04)',
            shadowColor: '#114b3c',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.07,
            shadowRadius: 10,
            elevation: 3,
            overflow: 'hidden',
          }}>
            {/* Panel header strip — LinearGradient accent */}
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
              <LinearGradient
                colors={[theme.colors.accentWarm, '#f5c842']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: 3, height: 14, borderRadius: 2, marginRight: 8 }}
              />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontFamily: 'Poppins_400Regular', letterSpacing: 0.3 }}>{'Paniers / mois'}</Text>
            </View>
            <View style={{ paddingHorizontal: 12, paddingBottom: 16 }}>
              {stats.monthlySales.length > 0 ? (
                <SimpleBarChart
                  data={stats.monthlySales}
                  labels={stats.monthlyLabels}
                  color={theme.colors.primary}
                />
              ) : (
                <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
                  <TrendingUp size={26} color={theme.colors.divider} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 10 }}>
                    {'Pas encore de données mensuelles'}
                  </Text>
                </View>
              )}
              {stats.monthlySales.length > 0 && stats.monthlyRevenue > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: 10 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontFamily: 'Poppins_400Regular' }}>
                    {'Revenus ce mois:\u00A0'}
                  </Text>
                  <Text style={{ color: theme.colors.accentWarm, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                    {`${stats.monthlyRevenue.toFixed(0)} TND`}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        </RNAnimated.View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={showRatingModal} transparent animationType="slide" onRequestClose={() => setShowRatingModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}>
            <View style={[styles.modalHandle, { backgroundColor: theme.colors.divider, alignSelf: 'center', marginBottom: theme.spacing.lg }]} />
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('business.dashboard.ratingDetails')}
              </Text>
              <TouchableOpacity onPress={() => setShowRatingModal(false)} style={[styles.modalCloseBtn, { backgroundColor: theme.colors.bg }]}>
                <X size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.overallRatingBlock, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
              <Star size={28} color={theme.colors.secondary} fill={theme.colors.secondary} />
              <Text style={[{ color: '#fff', ...theme.typography.display, marginLeft: 12 }]}>
                {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '--'}
              </Text>
              <Text style={[{ color: 'rgba(255,255,255,0.6)', fontSize: 18, marginLeft: 4, fontFamily: 'Poppins_400Regular' }]}>/5</Text>
            </View>

            <View style={{ marginTop: theme.spacing.xl }}>
              <ReviewBar label={t('basket.reviewService')} value={reviews.service} color={theme.colors.primary} />
              <ReviewBar label={t('basket.reviewQuantite')} value={reviews.quantite} color={theme.colors.accentFresh} />
              <ReviewBar label={t('basket.reviewQualite')} value={reviews.qualite} color={theme.colors.accentWarm} />
              <ReviewBar label={t('basket.reviewVariete')} value={reviews.variete} color={theme.colors.secondary} />
            </View>

            <TouchableOpacity
              onPress={() => setShowRatingModal(false)}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('common.close')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Location / team switcher modal */}
      <Modal visible={showLocationModal} transparent animationType="fade" onRequestClose={() => setShowLocationModal(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setShowLocationModal(false)} />
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}>
            <TouchableOpacity activeOpacity={0.6} onPress={() => setShowLocationModal(false)}>
              <View style={[styles.modalHandle, { backgroundColor: theme.colors.divider, alignSelf: 'center', marginBottom: theme.spacing.lg }]} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.lg }}>
              <Building2 size={18} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, marginLeft: 10, flex: 1 }]}>
                {teamContextQuery.data?.organization_name ?? t('business.profile.allLocationsLabel')}
              </Text>
              <TouchableOpacity onPress={() => setShowLocationModal(false)}>
                <X size={22} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* "All locations" option — admin only */}
            {isAdmin && (
              <TouchableOpacity
                onPress={() => handleLocationSwitch(null)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
              >
                <Store size={18} color={selectedLocationId === null ? theme.colors.primary : theme.colors.textSecondary} />
                <Text style={[{ ...theme.typography.body, color: selectedLocationId === null ? theme.colors.primary : theme.colors.textPrimary, flex: 1, marginLeft: 12, fontWeight: selectedLocationId === null ? ('600' as const) : ('400' as const) }]}>
                  All locations
                </Text>
                {selectedLocationId === null && <Check size={18} color={theme.colors.primary} />}
              </TouchableOpacity>
            )}

            {/* Individual locations */}
            {orgLocations.map((loc) => {
              const isSelected = selectedLocationId === loc.id;
              return (
                <TouchableOpacity
                  key={loc.id}
                  onPress={() => handleLocationSwitch(loc.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
                >
                  <Building2 size={18} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[{ ...theme.typography.body, color: theme.colors.textPrimary, fontWeight: isSelected ? ('600' as const) : ('400' as const) }]}>
                      {loc.name ?? `Location ${loc.id}`}
                    </Text>
                    {loc.address ? (
                      <Text style={[{ ...theme.typography.caption, color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {loc.address}
                      </Text>
                    ) : null}
                  </View>
                  {isSelected && <Check size={18} color={theme.colors.primary} />}
                </TouchableOpacity>
              );
            })}

            {orgLocations.length === 0 && !orgDetailsQuery.isLoading && (
              <Text style={[{ ...theme.typography.bodySm, color: theme.colors.muted, textAlign: 'center', marginTop: 16 }]}>
                No additional locations found
              </Text>
            )}
          </View>
        </View>
      </Modal>

      {/* Location switching animation overlay */}
      {isSwitchingLocation && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(17,75,60,0.88)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }]}>
          <View style={{ width: 80, height: 80, justifyContent: 'center', alignItems: 'center' }}>
            <RNAnimated.View style={{
              position: 'absolute',
              width: 80,
              height: 80,
              borderRadius: 40,
              borderWidth: 3,
              borderColor: '#e3ff5c',
              borderTopColor: 'transparent',
              transform: [{ rotate: switchSpinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
            }} />
            <Text style={{ color: '#e3ff5c', fontSize: 32, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>B</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {},
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryBanner: {},
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryVal: {
    fontSize: 20,
    fontWeight: '700' as const,
    marginTop: 4,
    fontFamily: 'Poppins_700Bold',
  },
  summarySuffix: {
    fontSize: 10,
    marginTop: 2,
    fontFamily: 'Poppins_400Regular',
  },
  summaryDivider: {
    width: 1,
    height: 36,
  },
  ratingCard: {},
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ratingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingStarBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingArrow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statsGrid: {},
  statsRow: {
    flexDirection: 'row',
  },
  chartSection: {},
  chartCard: {},
  chartLegend: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '85%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overallRatingBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
