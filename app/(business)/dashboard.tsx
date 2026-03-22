import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Dimensions, ActivityIndicator, Image, Animated as RNAnimated } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ShoppingBag, Banknote, Clock, Leaf, Star, X, Package, AlertCircle, Store, Settings, Bell } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchStats, fetchTodayOrders, fetchAnalytics } from '@/src/services/business';
import { apiClient } from '@/src/lib/api';
import { LineChart } from '@/src/components/LineChart';
import { FeatureFlags } from '@/src/lib/featureFlags';

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
  const barWidth = Math.min(28, (SCREEN_WIDTH - 140) / data.length - 10);

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {data.map((val, i) => {
          const stackVal = stackData?.[i] ?? 0;
          const total = val + stackVal;
          const height = Math.max(6, (total / allMax) * 110);
          const mainH = total > 0 ? (val / total) * height : 0;
          const stackH = total > 0 ? (stackVal / total) * height : 0;
          return (
            <View key={i} style={chartStyles.barCol}>
              <View style={[chartStyles.barBg, { height: 120, width: barWidth, borderRadius: 6, backgroundColor: 'transparent' }]}>
                <View style={{ flex: 1 }} />
                {stackData && (
                  <View style={{ height: stackH, backgroundColor: stackColor ?? theme.colors.secondary, borderTopLeftRadius: 6, borderTopRightRadius: 6, width: barWidth }} />
                )}
                <View style={{ height: mainH, backgroundColor: color, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, borderTopLeftRadius: stackData ? 0 : 6, borderTopRightRadius: stackData ? 0 : 6, width: barWidth }} />
              </View>
              <Text style={[{ color: theme.colors.muted, fontSize: 10, marginTop: 6, fontFamily: 'Poppins_400Regular' }]}>
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
    paddingTop: 8,
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
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>{label}</Text>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>{value.toFixed(1)}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: theme.colors.divider, borderRadius: 4 }}>
        <View style={{ height: 8, width: `${pct}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
}

function StatMiniCard({ icon: Icon, value, label, suffix, color, theme }: any) {
  return (
    <View style={[miniStyles.card, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm }]}>
      <View style={[miniStyles.iconWrap, { backgroundColor: color + '14', borderRadius: 10 }]}>
        <Icon size={16} color={color} />
      </View>
      <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8 }]}>
        {value}{suffix ? ` ${suffix}` : ''}
      </Text>
      <Text style={[{ color: theme.colors.muted, fontSize: 10, marginTop: 2, fontFamily: 'Poppins_400Regular' }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const miniStyles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 14,
  },
  iconWrap: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default function BusinessDashboard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();

  const statsQuery = useQuery({
    queryKey: ['business-stats'],
    queryFn: fetchStats,
    staleTime: 60_000,
    retry: 1,
  });

  const analyticsQuery = useQuery({
    queryKey: ['business-analytics'],
    queryFn: fetchAnalytics,
    staleTime: 60_000,
    retry: 1,
  });

  const todayQuery = useQuery({
    queryKey: ['today-orders'],
    queryFn: fetchTodayOrders,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const profileQuery = useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const res = await apiClient.get('/api/restaurants/my/profile');
      return res.data as any;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const reviewsQuery = useQuery({
    queryKey: ['my-reviews'],
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

  const isLoading = statsQuery.isLoading && analyticsQuery.isLoading && todayQuery.isLoading && profileQuery.isLoading;

  const stats = {
    totalRevenue: analytics?.summary?.revenue_today ?? statsData?.today_revenue ?? 0,
    totalBasketsSold: analytics?.summary?.baskets_sold_today ?? statsData?.today_baskets ?? 0,
    pendingOrders: todayOrders.filter((o: any) => o.status === 'confirmed' || o.status === 'reserved' || o.status === 'pending').length,
    mealsRescued: analytics?.summary?.pickups_today ?? 0,
    activeBaskets: profileQuery.data?.available_quantity ?? 0,
    averageRating: statsData?.average_rating ?? profileQuery.data?.average_rating ?? 0,
    dailySales: (analytics?.weekly ?? []).map((d: any) => d.baskets_sold ?? 0),
    dailyLabels: (analytics?.weekly ?? []).map((d: any) => d.dayName ?? ''),
    weeklySales: (analytics?.monthly ?? []).map((m: any) => m.baskets_sold ?? 0),
    weeklyLabels: (analytics?.monthly ?? []).map((m: any) => m.monthName ?? ''),
    weeklyRevenue: (analytics?.monthly ?? []).map((m: any) => m.revenue ?? 0),
  };

  const [showRatingModal, setShowRatingModal] = useState(false);

  // Easter egg: Logo tap × 5
  const [logoPressCount, setLogoPressCount] = useState(0);
  const [lastPressTime, setLastPressTime] = useState(0);
  const [showEggModal, setShowEggModal] = useState(false);
  const [eggFact, setEggFact] = useState('');

  const FOOD_FACTS = [
    'Tunisia wastes ~30% of food produced each year 🌾',
    'The average Tunisian household throws away 80kg of food annually 🗑️',
    'Food waste accounts for 10% of global greenhouse gases 🌍',
    'Saving one meal prevents ~2.5kg of CO₂ emissions ♻️',
    'Barakeat has helped rescue thousands of meals this year 🧺',
  ];

  const reviews = reviewsQuery.data ?? { service: 0, quantite: 0, qualite: 0, variete: 0 };

  const handleRatingPress = useCallback(() => {
    setShowRatingModal(true);
  }, []);

  const chartWidth = Math.min(SCREEN_WIDTH - 80, 320);

  // Staggered fade-in animations for dashboard sections
  const fadeAnim1 = React.useRef(new RNAnimated.Value(0)).current;
  const fadeAnim2 = React.useRef(new RNAnimated.Value(0)).current;
  const fadeAnim3 = React.useRef(new RNAnimated.Value(0)).current;

  React.useEffect(() => {
    if (!isLoading) {
      RNAnimated.stagger(150, [
        RNAnimated.timing(fadeAnim1, { toValue: 1, duration: 400, useNativeDriver: true }),
        RNAnimated.timing(fadeAnim2, { toValue: 1, duration: 400, useNativeDriver: true }),
        RNAnimated.timing(fadeAnim3, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]} edges={[]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      {/* Cover photo is always dark/coloured — keep status bar icons white */}
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false}>
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
          {/* Barakeat logo pill */}
          <TouchableOpacity
            activeOpacity={1}
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 20,
              paddingHorizontal: 14,
              paddingVertical: 8,
              flexDirection: 'row',
              alignItems: 'baseline',
              ...theme.shadows.shadowMd,
            }}
            onPress={() => {
              if (!(FeatureFlags.ENABLE_EASTER_EGGS && FeatureFlags.ENABLE_LOGO_TAP_EASTER_EGG)) return;
              const now = Date.now();
              const newCount = now - lastPressTime < 2000 ? logoPressCount + 1 : 1;
              setLastPressTime(now);
              setLogoPressCount(newCount);
              if (newCount >= 5) {
                setLogoPressCount(0);
                setEggFact(FOOD_FACTS[Math.floor(Math.random() * FOOD_FACTS.length)]);
                setShowEggModal(true);
              }
            }}
          >
            <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              Barakeat
            </Text>
            <Text style={{ color: '#e3ff5c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              .
            </Text>
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
            </TouchableOpacity>
          </View>
        </View>

        {/* Cover photo - extends to absolute top of screen */}
        <View style={{ position: 'relative', height: 200 + insets.top, backgroundColor: theme.colors.primary + '20', overflow: 'visible', marginTop: 0 }}>
          {profileQuery.data?.cover_image_url ? (
            <Image source={{ uri: profileQuery.data.cover_image_url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ width: '100%', height: '100%', backgroundColor: theme.colors.primary + '15' }} />
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

        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1, paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.sm }]}>
          {t('business.dashboard.title')}
        </Text>

        <RNAnimated.View style={{ opacity: fadeAnim1, transform: [{ translateY: fadeAnim1.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={[styles.summaryBanner, {
            backgroundColor: theme.colors.primary,
            marginHorizontal: theme.spacing.xl,
            marginTop: theme.spacing.xl,
            borderRadius: theme.radii.r20,
            padding: theme.spacing.lg,
          }]}>
            <Text style={[{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'Poppins_400Regular' }]}>
              {t('business.dashboard.daySummary')}
            </Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Banknote size={14} color={theme.colors.secondary} />
                <Text style={[styles.summaryVal, { color: '#fff' }]}><AnimatedNumber value={stats.totalRevenue} suffix=" TND" /></Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
              <View style={styles.summaryItem}>
                <ShoppingBag size={14} color={theme.colors.secondary} />
                <Text style={[styles.summaryVal, { color: '#fff' }]}><AnimatedNumber value={stats.totalBasketsSold} /></Text>
                <Text style={[styles.summarySuffix, { color: 'rgba(255,255,255,0.7)' }]}>{t('business.dashboard.sold')}</Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
              <View style={styles.summaryItem}>
                <Clock size={14} color={theme.colors.secondary} />
                <Text style={[styles.summaryVal, { color: '#fff' }]}><AnimatedNumber value={stats.pendingOrders} /></Text>
                <Text style={[styles.summarySuffix, { color: 'rgba(255,255,255,0.7)' }]}>{t('business.dashboard.pending')}</Text>
              </View>
              <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
              <View style={styles.summaryItem}>
                <Package size={14} color={theme.colors.secondary} />
                <Text style={[styles.summaryVal, { color: '#fff' }]}><AnimatedNumber value={stats.mealsRescued} /></Text>
                <Text style={[styles.summarySuffix, { color: 'rgba(255,255,255,0.7)' }]}>{t('business.dashboard.rescued')}</Text>
              </View>
            </View>
          </View>
        </RNAnimated.View>

        <RNAnimated.View style={{ opacity: fadeAnim2, transform: [{ translateY: fadeAnim2.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <TouchableOpacity
            onPress={handleRatingPress}
            activeOpacity={0.8}
            style={[styles.ratingCard, {
              backgroundColor: theme.colors.surface,
              marginHorizontal: theme.spacing.xl,
              marginTop: theme.spacing.lg,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            }]}
          >
            <View style={styles.ratingRow}>
              <View style={styles.ratingLeft}>
                <View style={[styles.ratingStarBg, { backgroundColor: theme.colors.starYellow + '18' }]}>
                  <Star size={20} color={theme.colors.starYellow} fill={theme.colors.starYellow} />
                </View>
                <View style={{ marginLeft: 12 }}>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                    {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '--'}
                  </Text>
                  <Text style={[{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular' }]}>
                    {t('business.dashboard.avgRating')}
                  </Text>
                </View>
              </View>
              <View style={[styles.ratingArrow, { backgroundColor: theme.colors.bg }]}>
                <Text style={[{ color: theme.colors.primary, fontSize: 12, fontFamily: 'Poppins_600SemiBold' }]}>{t('business.dashboard.details')} →</Text>
              </View>
            </View>
          </TouchableOpacity>
        </RNAnimated.View>

        <RNAnimated.View style={{ opacity: fadeAnim3, transform: [{ translateY: fadeAnim3.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <View style={[styles.statsGrid, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
              {t('business.dashboard.performance')}
            </Text>
            <View style={styles.statsRow}>
              <StatMiniCard icon={TrendingUp} value={stats.activeBaskets} label={t('business.dashboard.activeBaskets')} color={theme.colors.primary} theme={theme} />
              <View style={{ width: 10 }} />
              <StatMiniCard icon={Leaf} value={`${(stats.mealsRescued * 2.5).toFixed(0)} kg`} label={t('business.dashboard.co2Saved')} color={theme.colors.accentFresh} theme={theme} />
            </View>
            <View style={[styles.statsRow, { marginTop: 10 }]}>
              <StatMiniCard icon={Banknote} value={stats.totalRevenue} suffix="TND" label={t('business.dashboard.revenue')} color={theme.colors.accentWarm} theme={theme} />
              <View style={{ width: 10 }} />
              <StatMiniCard icon={AlertCircle} value={stats.pendingOrders} label={t('business.dashboard.pendingOrders')} color={theme.colors.error} theme={theme} />
            </View>
          </View>
        </RNAnimated.View>

        <View style={[styles.chartSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.salesChart')}
          </Text>
          <View style={[styles.chartCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} />
                <Text style={[{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular' }]}>{t('business.dashboard.salesLegend')}</Text>
              </View>
            </View>
            <View style={{ alignItems: 'center' }}>
              {stats.dailySales.length > 0 ? (
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
                  <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular' }}>
                    {t('business.dashboard.noData', { defaultValue: 'No data available yet' })}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={[styles.chartSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.avgSalesChart')}
          </Text>
          <View style={[styles.chartCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} />
                <Text style={[{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular' }]}>{t('business.dashboard.basketsLegend')}</Text>
              </View>
              <View style={[styles.legendItem, { marginLeft: 12 }]}>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.secondary }]} />
                <Text style={[{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular' }]}>{t('business.dashboard.revenueLegend')}</Text>
              </View>
            </View>
            {stats.weeklySales.length > 0 ? (
              <SimpleBarChart
                data={stats.weeklySales}
                labels={stats.weeklyLabels}
                color={theme.colors.primary}
                stackData={stats.weeklyRevenue}
                stackColor={theme.colors.secondary}
              />
            ) : (
              <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular' }}>
                  {t('business.dashboard.noData', { defaultValue: 'No data available yet' })}
                </Text>
              </View>
            )}
          </View>
        </View>

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
