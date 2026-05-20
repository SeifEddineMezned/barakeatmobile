import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Dimensions, Modal } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShoppingBag, AlertTriangle, Clock, XCircle, Zap } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { isPickupExpiredInTz, getNowInBusinessTz, getBusinessDayDateStr, toBizDayMinutes } from '@/src/utils/timezone';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations, hideReservation } from '@/src/services/reservations';
import { fetchConversationUnreads } from '@/src/services/messages';
import { fetchGamificationStats } from '@/src/services/gamification';
import { calcMoneySaved, calcCO2Saved, calcLevelProgress } from '@/src/lib/impactCalculations';
import { ReservationCard } from '@/src/components/ReservationCard';
import { DelayedLoader } from '@/src/components/DelayedLoader';

function PickupCountdown({ startTime, endTime, theme, t }: { startTime: string; endTime: string; theme: any; t: any }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(p => p + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // Use business timezone for countdown, in business-day minutes so overnight
  // windows (e.g. 18:00 → 02:59) are handled correctly.
  const bizNow = getNowInBusinessTz();
  const nowMinutes = toBizDayMinutes(bizNow.hours * 60 + bizNow.minutes);
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMinutes = toBizDayMinutes(sh * 60 + sm);
  const endMinutes = toBizDayMinutes(eh * 60 + em);

  const isBeforePickup = nowMinutes < startMinutes;
  const isDuringPickup = nowMinutes >= startMinutes && nowMinutes <= endMinutes;

  let label = '';
  let color = theme.colors.muted;
  let timeLeft = '';

  if (isBeforePickup) {
    const diff = startMinutes - nowMinutes;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    label = t('orders.startsIn', { defaultValue: 'Starts in' });
    timeLeft = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    color = theme.colors.primary;
  } else if (isDuringPickup) {
    const diff = endMinutes - nowMinutes;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    label = t('orders.endsIn', { defaultValue: 'Ends in' });
    timeLeft = h > 0 ? `${h}h ${m}m` : `${diff}m`;
    color = diff < 15 ? theme.colors.error : theme.colors.accentWarm;
  } else {
    label = t('orders.pickupEnded', { defaultValue: 'Pickup ended' });
    color = theme.colors.muted;
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color, ...theme.typography.bodySm, fontWeight: '600' }}>
        {label} {timeLeft}
      </Text>
    </View>
  );
}

function CarouselBanner({ moneySaved, co2Saved, totalOrders, upcomingOrders, getPickupTimes, theme, t }: any) {
  const scrollRef = useRef<ScrollView>(null);
  const screenWidth = Dimensions.get('window').width;
  const cardWidth = screenWidth - 2 * 20; // padding
  const [activeSlide, setActiveSlide] = useState(0);

  // Find closest upcoming order by pickup end time (using business timezone,
  // in business-day minutes so overnight windows compute a positive diff).
  const closestOrder = useMemo(() => {
    if (!upcomingOrders.length) return null;
    const bizNow = getNowInBusinessTz();
    const nowMinutes = toBizDayMinutes(bizNow.hours * 60 + bizNow.minutes);
    let closest: any = null;
    let closestDiff = Infinity;
    for (const r of upcomingOrders) {
      const { start, end } = getPickupTimes(r);
      if (!end) continue;
      const [eh, em] = end.split(':').map(Number);
      const endMinutes = toBizDayMinutes(eh * 60 + em);
      const diff = endMinutes - nowMinutes;
      if (diff > 0 && diff < closestDiff) {
        closestDiff = diff;
        closest = { reservation: r, start, end, minutesLeft: diff };
      }
    }
    return closest;
  }, [upcomingOrders, getPickupTimes]);

  const slideCount = closestOrder ? 2 : 1;

  return (
    <View style={{ marginBottom: 16 }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
          setActiveSlide(idx);
        }}
        scrollEventThrottle={16}
        style={{ marginHorizontal: -20 }}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        snapToInterval={cardWidth + 10}
        decelerationRate="fast"
      >
        {/* Slide 1: Pickup Countdown (only if upcoming order exists — shown FIRST) */}
        {closestOrder && (
          <View style={{
            backgroundColor: closestOrder.minutesLeft < 30 ? theme.colors.error : '#eff35c',
            borderRadius: theme.radii.r16,
            padding: 20,
            width: cardWidth,
            marginRight: 10,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {closestOrder.minutesLeft < 30 ? (
                <AlertTriangle size={18} color="#fff" />
              ) : (
                <Clock size={18} color="#114b3c" />
              )}
              <Text style={{
                color: closestOrder.minutesLeft < 30 ? '#fff' : '#114b3c',
                ...theme.typography.bodySm,
                fontWeight: '600',
              }}>
                {closestOrder.minutesLeft < 30
                  ? t('orders.pickupExpiring', { defaultValue: 'Pickup ending soon!' })
                  : t('orders.nextPickup', { defaultValue: 'Next Pickup' })}
              </Text>
            </View>
            <Text style={{
              color: closestOrder.minutesLeft < 30 ? '#fff' : '#114b3c',
              ...theme.typography.h2,
              marginTop: 12,
            }} numberOfLines={1}>
              {(closestOrder.reservation as any).restaurant_name
                ?? closestOrder.reservation.basket?.merchantName
                ?? closestOrder.reservation.basket?.merchant_name
                ?? ''}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 }}>
              <View style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: closestOrder.minutesLeft < 30 ? '#fff' : '#114b3c',
              }} />
              <Text style={{
                color: closestOrder.minutesLeft < 30 ? 'rgba(255,255,255,0.85)' : '#114b3c',
                ...theme.typography.bodySm,
                fontWeight: '600',
              }}>
                {closestOrder.start} - {closestOrder.end}
              </Text>
              <Text style={{
                color: closestOrder.minutesLeft < 30 ? '#fff' : '#114b3c',
                ...theme.typography.bodySm,
                fontWeight: '700',
                marginLeft: 'auto',
              }}>
                {closestOrder.minutesLeft > 60
                  ? `${Math.floor(closestOrder.minutesLeft / 60)}h ${closestOrder.minutesLeft % 60}m`
                  : `${closestOrder.minutesLeft}m`}
              </Text>
            </View>
          </View>
        )}

        {/* Impact slide — always shown, after pickup if pickup exists */}
        <View style={{
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radii.r16,
          padding: 20,
          width: cardWidth,
        }}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.bodySm }}>
            {t('orders.yourImpact', { defaultValue: 'Your Impact' })}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', ...theme.typography.h2 }}>{moneySaved.toFixed(0)}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption }}>{t('orders.tndSaved')}</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', ...theme.typography.h2 }}>{co2Saved.toFixed(1)}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption }}>{t('orders.kgCO2')}</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', ...theme.typography.h2 }}>{totalOrders}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption }}>{t('orders.title')}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Dots indicator */}
      {slideCount > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8, gap: 6 }}>
          {Array.from({ length: slideCount }).map((_, i) => (
            <View
              key={i}
              style={{
                width: activeSlide === i ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: activeSlide === i ? theme.colors.primary : theme.colors.divider,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentUser = useAuthStore((s) => s.user);
  // Backend endpoint `/api/reservations/my/reservations` is buyer-only — if a
  // business user ends up rendering this tab (e.g. during a role-mismatch
  // redirect frame) we must NOT fire the query; otherwise every 15 s poll
  // logs a 403. Treat `role` and `type` as customer-equivalent.
  const isBuyer = (() => {
    const role = String(currentUser?.role ?? '').toLowerCase();
    const typ = String((currentUser as any)?.type ?? '').toLowerCase();
    const isBiz = role === 'business' || role === 'restaurant' || typ === 'restaurant' || typ === 'business';
    return !isBiz;
  })();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed' | 'issues'>('upcoming');
  // Customer orders page shows all history; filter UI was removed (kept on business side only).
  const dateFilter: 'all' | 'today' | 'month' | 'year' = 'all';
  const issueTypeFilter: 'all' | 'expired' | 'cancelled' = 'all';
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ordersScrollY = useRef(new Animated.Value(0)).current;
  const ordersHeaderBg = ordersScrollY.interpolate({ inputRange: [0, 30], outputRange: ['transparent', '#ffffff'], extrapolate: 'clamp' });

  // Cancel-warning modal state. The warning stays as a lightweight popup here;
  // only after the user confirms they want to cancel do we navigate to the
  // full-page /cancel-reservation screen to pick a reason.
  const [cancelWarning, setCancelWarning] = useState<{
    id: string; quantity: number; locationId?: string; merchantName?: string;
    xpLoss: number; levelBefore: number; levelAfter: number;
    // 'cash' payments get no refund; 'card' / 'credits' do. The warning text
    // and the confirmation button color flip on this.
    paymentMethod?: 'cash' | 'card' | 'credits';
  } | null>(null);

  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated && isBuyer,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    retry: 2,
  });

  const msgUnreadsQuery = useQuery({
    queryKey: ['conversation-unreads'],
    queryFn: fetchConversationUnreads,
    enabled: isAuthenticated,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
  const msgUnreads = msgUnreadsQuery.data ?? {};

  const gamificationQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const hideMutation = useMutation({
    mutationFn: (id: string) => hideReservation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  const reservations = reservationsQuery.data ?? [];

  // Helper: check if reservation's pickup time has ended (business timezone aware).
  // Uses BUSINESS-DAY date comparison (not calendar date) so overnight pickup
  // windows (e.g. 18:00 → 02:59) stay valid past midnight until the 03:30 reset.
  const isPickupExpiredCheck = useCallback((r: any) => {
    const rr = r as any;
    // Never expire a reservation created less than 5 minutes ago
    const createdAt = rr.created_at ?? rr.createdAt;
    if (createdAt) {
      const ageMs = Date.now() - new Date(createdAt).getTime();
      if (ageMs < 5 * 60 * 1000) return false;
    }
    // Resolve the reservation's business-day date. reservation_date from the
    // backend is a pure "YYYY-MM-DD" string; prefer it as-is (no UTC parsing).
    // Fall back to createdAt timestamp converted to its business-day date.
    let resBizDate: string | null = null;
    const rawResDate = rr.pickup_date ?? rr.reservation_date;
    if (typeof rawResDate === 'string' && rawResDate.length >= 10) {
      resBizDate = rawResDate.substring(0, 10);
    } else if (createdAt) {
      resBizDate = getBusinessDayDateStr(new Date(createdAt));
    }
    if (!resBizDate) return false;

    const todayBizDate = getBusinessDayDateStr(new Date());

    // Past business day = expired
    if (resBizDate < todayBizDate) return true;
    // Same business day: check if pickup end time has passed (overnight-aware)
    if (resBizDate === todayBizDate) {
      const end = rr.pickup_end_time ?? rr.basket?.pickup_end_time ?? rr.restaurant?.pickup_end_time ?? rr.basket?.pickupWindow?.end ?? rr.pickupWindow?.end;
      if (end) {
        return isPickupExpiredInTz(String(end).substring(0, 5));
      }
    }
    return false;
  }, []);

  // Tick every 60s to re-evaluate pickup expiry in real-time
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTimeTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const upcomingOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      if (status !== 'reserved' && status !== 'ready' && status !== 'pending' && status !== 'confirmed') return false;
      return !isPickupExpiredCheck(r);
    }),
    [reservations, isPickupExpiredCheck, timeTick]
  );

  const completedOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'completed' || status === 'picked_up';
    }),
    [reservations]
  );

  const issueOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      if (status === 'cancelled' || status === 'expired') return true;
      if ((status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed') && isPickupExpiredCheck(r)) return true;
      return false;
    }),
    [reservations, isPickupExpiredCheck, timeTick]
  );

  // Alias for impact calculations (only picked_up counts)
  const completedReservations = completedOrders;


  // Apply date filter to completed and issues tabs
  const filterByDate = useCallback((orders: typeof completedOrders) => {
    if (dateFilter === 'all') return orders;
    const now = new Date();
    return orders.filter((r: any) => {
      const d = new Date(r.created_at ?? r.reservation_date);
      if (dateFilter === 'today') return d.toDateString() === now.toDateString();
      if (dateFilter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return d.getFullYear() === now.getFullYear(); // year
    });
  }, [dateFilter]);

  const filteredCompleted = useMemo(() => filterByDate(completedOrders), [completedOrders, filterByDate]);
  const filteredIssues = useMemo(() => {
    let filtered = filterByDate(issueOrders);
    if (issueTypeFilter === 'expired') filtered = filtered.filter((r: any) => (r.status ?? '').toLowerCase() !== 'cancelled');
    else if (issueTypeFilter === 'cancelled') filtered = filtered.filter((r: any) => (r.status ?? '').toLowerCase() === 'cancelled');
    return filtered;
  }, [issueOrders, filterByDate, issueTypeFilter]);

  const displayedOrders = activeTab === 'upcoming' ? upcomingOrders : activeTab === 'completed' ? filteredCompleted : filteredIssues;

  // Hero stats — respond to date filter
  const statsSource = dateFilter === 'all' ? completedReservations : filteredCompleted;
  const moneySaved = useMemo(() => {
    if (dateFilter === 'all') {
      const gStats = gamificationQuery.data as any;
      const gStatsInner = gStats?.stats ?? gStats;
      if (gStatsInner?.money_saved != null) return Math.max(0, parseFloat(gStatsInner.money_saved) || 0);
    }
    return calcMoneySaved(statsSource as any[]);
  }, [statsSource, gamificationQuery.data, dateFilter]);

  const co2Saved = useMemo(() => {
    if (dateFilter === 'all') {
      const gStats = gamificationQuery.data as any;
      const gStatsInner = gStats?.stats ?? gStats;
      if (gStatsInner?.meals_saved != null) return calcCO2Saved(gStatsInner.meals_saved);
    }
    return calcCO2Saved(statsSource.length);
  }, [statsSource, gamificationQuery.data, dateFilter]);

  const totalOrders = useMemo(() => {
    if (dateFilter === 'all') {
      const gStats = gamificationQuery.data as any;
      const gStatsInner = gStats?.stats ?? gStats;
      if (gStatsInner?.meals_saved != null) return gStatsInner.meals_saved;
    }
    return statsSource.length;
  }, [statsSource, gamificationQuery.data, dateFilter]);

  // Expired orders are handled by the isPickupExpiredCheck filter above —
  // they move to the "past" tab automatically. We do NOT auto-cancel from the client
  // because timezone differences between the user's phone and the server (Tunisia)
  // could cause valid reservations to be incorrectly cancelled.

  const handleCancelRequest = useCallback((id: string, quantity: number, locationId?: string, merchantName?: string, paymentMethod?: 'cash' | 'card' | 'credits') => {
    const gStats = queryClient.getQueryData<any>(['gamification-stats']);
    const xp = gStats?.xp ?? (typeof gStats?.level === 'object' ? (gStats.level.xp ?? 0) : 0);
    const xpLoss = quantity * 10;
    const { level: levelBefore } = calcLevelProgress(xp);
    const { level: levelAfter } = calcLevelProgress(Math.max(0, xp - xpLoss));
    setCancelWarning({ id, quantity, locationId, merchantName, xpLoss, levelBefore, levelAfter, paymentMethod });
  }, [queryClient]);

  const handleConfirmCancelFromWarning = useCallback(() => {
    if (!cancelWarning) return;
    const target = cancelWarning;
    setCancelWarning(null);
    router.push({
      pathname: '/cancel-reservation',
      params: {
        reservationId: String(target.id),
        quantity: String(target.quantity),
        locationId: target.locationId ?? '',
        merchantName: target.merchantName ?? '',
        xpLoss: String(target.xpLoss),
        levelBefore: String(target.levelBefore),
        levelAfter: String(target.levelAfter),
      },
    } as never);
  }, [cancelWarning, router]);

  const handleHide = useCallback((id: string) => {
    hideMutation.mutate(id);
  }, [hideMutation]);

  const getPickupTimes = (reservation: any) => {
    const start = reservation.pickup_start_time
      ?? reservation.basket?.pickupWindow?.start
      ?? reservation.basket?.pickup_start_time
      ?? reservation.restaurant?.pickup_start_time
      ?? reservation.pickupWindow?.start;
    const end = reservation.pickup_end_time
      ?? reservation.basket?.pickupWindow?.end
      ?? reservation.basket?.pickup_end_time
      ?? reservation.restaurant?.pickup_end_time
      ?? reservation.pickupWindow?.end;
    return {
      start: start ? String(start).substring(0, 5) : undefined,
      end: end ? String(end).substring(0, 5) : undefined,
    };
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: 50 }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
            {t('orders.loginRequired')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // No orders at all — empty state
  const hasNoOrders = !reservationsQuery.isLoading && !reservationsQuery.isError && reservations.length === 0;

  if (hasNoOrders) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: 50 }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'flex-start', alignItems: 'center', paddingTop: 100, paddingHorizontal: 32 }}>
          <ShoppingBag size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginTop: 24, textAlign: 'center' }}>
            {t('orders.emptyTitle')}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
            {t('orders.emptyDesc')}
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)' as never)}
            style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16, paddingVertical: 16, paddingHorizontal: 40, marginTop: 32 }}
            accessibilityLabel={t('orders.findBasket')}
            accessibilityRole="button"
          >
            <Text style={{ color: '#fff', ...theme.typography.button }}>
              {t('orders.findBasket')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[{ padding: theme.spacing.xl, paddingTop: 50, paddingBottom: 100 }]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: ordersScrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
        </View>
        {reservationsQuery.isLoading ? (
          <DelayedLoader />
        ) : reservationsQuery.isError ? (
          <View style={styles.centerState}>
            <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center' as const, marginBottom: 16 }]}>
              {t('common.errorOccurred')}
            </Text>
            <TouchableOpacity
              onPress={() => reservationsQuery.refetch()}
              style={[styles.retryButton, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12 }]}
              accessibilityLabel={t('common.retry')}
              accessibilityRole="button"
            >
              <RefreshCw size={16} color="#fff" />
              <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
                {t('common.retry')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Carousel: Impact + Pickup Countdown */}
            <CarouselBanner
              moneySaved={moneySaved}
              co2Saved={co2Saved}
              totalOrders={totalOrders}
              upcomingOrders={upcomingOrders}
              getPickupTimes={getPickupTimes}
              theme={theme}
              t={t}
            />

            {/* Tabs for Upcoming / Past */}
            <View style={[styles.tabs, { marginBottom: theme.spacing.sm }]}>
              <TouchableOpacity
                style={[
                  styles.tab,
                  {
                    flex: 1,
                    paddingVertical: theme.spacing.md,
                    borderBottomWidth: 2,
                    borderBottomColor: activeTab === 'upcoming' ? theme.colors.primary : 'transparent',
                  },
                ]}
                onPress={() => setActiveTab('upcoming')}
                accessibilityRole="button"
                accessibilityLabel={t('orders.upcoming')}
                accessibilityState={{ selected: activeTab === 'upcoming' }}
              >
                <Text
                  style={[
                    {
                      color: activeTab === 'upcoming' ? theme.colors.primary : theme.colors.textSecondary,
                      ...theme.typography.body,
                      fontWeight: activeTab === 'upcoming' ? ('600' as const) : ('400' as const),
                      textAlign: 'center',
                    },
                  ]}
                >
                  {t('orders.upcoming')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.tab,
                  {
                    flex: 1,
                    paddingVertical: theme.spacing.md,
                    borderBottomWidth: 2,
                    borderBottomColor: activeTab === 'completed' ? theme.colors.primary : 'transparent',
                  },
                ]}
                onPress={() => setActiveTab('completed')}
                accessibilityRole="button"
                accessibilityLabel={t('orders.completed', { defaultValue: 'Terminées' })}
                accessibilityState={{ selected: activeTab === 'completed' }}
              >
                <Text
                  style={[
                    {
                      color: activeTab === 'completed' ? theme.colors.primary : theme.colors.textSecondary,
                      ...theme.typography.body,
                      fontWeight: activeTab === 'completed' ? ('600' as const) : ('400' as const),
                      textAlign: 'center',
                    },
                  ]}
                >
                  {t('orders.completed', { defaultValue: 'Terminées' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.tab,
                  {
                    flex: 1,
                    paddingVertical: theme.spacing.md,
                    borderBottomWidth: 2,
                    borderBottomColor: activeTab === 'issues' ? theme.colors.error : 'transparent',
                  },
                ]}
                onPress={() => setActiveTab('issues')}
                accessibilityRole="button"
                accessibilityLabel={t('orders.issues', { defaultValue: 'Problèmes' })}
                accessibilityState={{ selected: activeTab === 'issues' }}
              >
                <Text
                  style={[
                    {
                      color: activeTab === 'issues' ? theme.colors.error : theme.colors.textSecondary,
                      ...theme.typography.body,
                      fontWeight: activeTab === 'issues' ? ('600' as const) : ('400' as const),
                      textAlign: 'center',
                    },
                  ]}
                >
                  {t('orders.issues', { defaultValue: 'Problèmes' })}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Order History */}
            {displayedOrders.length === 0 ? (
              <View style={{ alignItems: 'center', paddingTop: 50, paddingHorizontal: 20 }}>
                {/* Illustration — mock order card with a bag icon */}
                <View style={{ marginBottom: 24, alignItems: 'center' }}>
                  <View style={{
                    width: 160, height: 120,
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    ...theme.shadows.shadowMd,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    <View style={{
                      width: 56, height: 56, borderRadius: 28,
                      backgroundColor: theme.colors.primary + '14',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <ShoppingBag size={28} color={theme.colors.primary} />
                    </View>
                    <View style={{ marginTop: 10, flexDirection: 'row', gap: 6 }}>
                      <View style={{ width: 40, height: 6, borderRadius: 3, backgroundColor: theme.colors.divider }} />
                      <View style={{ width: 24, height: 6, borderRadius: 3, backgroundColor: theme.colors.divider }} />
                    </View>
                  </View>
                </View>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center' }}>
                  {activeTab === 'upcoming'
                    ? t('orders.noUpcoming')
                    : t('orders.noPast')}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                  {activeTab === 'upcoming'
                    ? t('orders.emptyDesc')
                    : t('orders.emptyPastDesc')}
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)' as never)}
                  style={{
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.radii.r16,
                    paddingVertical: 14,
                    paddingHorizontal: 32,
                    marginTop: 24,
                  }}
                  accessibilityLabel={t('orders.findBasket')}
                  accessibilityRole="button"
                >
                  <Text style={{ color: '#fff', ...theme.typography.button }}>
                    {t('orders.findBasket')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              displayedOrders.map((reservation) => {
                const rStatus = (reservation.status ?? '').toLowerCase();
                const isStillUpcomingStatus = rStatus === 'reserved' || rStatus === 'ready' || rStatus === 'pending' || rStatus === 'confirmed';
                const expired = isStillUpcomingStatus && isPickupExpiredCheck(reservation);
                return (
                  <ReservationCard
                    key={reservation.id}
                    reservation={reservation}
                    onCancel={handleCancelRequest}
                    onHide={handleHide}
                    overrideExpired={expired}
                    messageUnreadCount={msgUnreads[Number(reservation.id)] ?? 0}
                  />
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* Cancel warning popup — shown when user taps "Annuler" on a reservation.
          Confirming here navigates to /cancel-reservation to pick a reason. */}
      <Modal
        visible={!!cancelWarning}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelWarning(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, width: '100%', maxWidth: 380, overflow: 'hidden', padding: 4 }}>
            <View style={{ alignItems: 'center', paddingTop: 24, paddingHorizontal: 20 }}>
              <View style={{ backgroundColor: theme.colors.error + '15', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <AlertTriangle size={28} color={theme.colors.error} />
              </View>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' as const, textAlign: 'center', marginBottom: 4 }}>
                {t('orders.cancelConfirmTitle', { defaultValue: 'Annuler cette commande ?' })}
              </Text>
              {cancelWarning?.merchantName ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16 }}>
                  {cancelWarning.merchantName}
                </Text>
              ) : null}
            </View>

            <View style={{ paddingHorizontal: 20, paddingBottom: 24 }}>
              <View style={{ backgroundColor: theme.colors.error + '10', borderRadius: 14, padding: 16, gap: 10, marginBottom: 20 }}>
                <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, fontWeight: '700' as const }}>
                  {t('orders.cancelConsequences', { defaultValue: 'Si vous annulez :' })}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Zap size={14} color={theme.colors.error} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                    {t('orders.cancelXpLoss', { defaultValue: 'Vous perdez' })}{' '}
                    <Text style={{ fontWeight: '700' as const }}>−{cancelWarning?.xpLoss ?? 0} XP</Text>
                  </Text>
                </View>
                {cancelWarning && cancelWarning.levelAfter < cancelWarning.levelBefore && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.error, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' as const, lineHeight: 14 }}>▼</Text>
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                      {t('orders.cancelLevelDrop', { defaultValue: 'Niveau' })}{' '}
                      <Text style={{ fontWeight: '700' as const }}>{cancelWarning.levelBefore} → {cancelWarning.levelAfter}</Text>
                    </Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ShoppingBag size={14} color={theme.colors.error} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                    {t('orders.cancelBasketReturned', { defaultValue: 'Le panier est rendu au commerce' })}
                  </Text>
                </View>
                {/* Payment-method-specific refund line — cash gives no refund,
                    card/credits are refunded in credits. */}
                {cancelWarning?.paymentMethod === 'cash' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <AlertTriangle size={14} color="#d97706" />
                    <Text style={{ color: '#d97706', ...theme.typography.bodySm, fontWeight: '600' }}>
                      {t('orders.cancelNoRefundCash', { defaultValue: 'Aucun remboursement — paiement en espèces' })}
                    </Text>
                  </View>
                ) : cancelWarning?.paymentMethod ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <ShoppingBag size={14} color="#16a34a" />
                    <Text style={{ color: '#16a34a', ...theme.typography.bodySm, fontWeight: '600' }}>
                      {t('orders.cancelRefundCredits', { defaultValue: 'Vous serez remboursé en crédits' })}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, fontWeight: '700', textAlign: 'center', marginBottom: 16, lineHeight: 20 }}>
                {t('orders.cancelIrreversible', { defaultValue: 'Cette action est irréversible et ne peut pas être annulée.' })}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setCancelWarning(null)}
                  style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
                    {t('orders.keepOrder', { defaultValue: 'Garder' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleConfirmCancelFromWarning}
                  style={{ flex: 1, backgroundColor: theme.colors.error, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
                    {t('orders.cancelContinue', { defaultValue: 'Annuler' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Error modal */}
      <Modal visible={!!errorMsg} transparent animationType="fade" onRequestClose={() => setErrorMsg(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <XCircle size={28} color="#ef4444" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('auth.error')}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {errorMsg}
            </Text>
            <TouchableOpacity onPress={() => setErrorMsg(null)} style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}>
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>OK</Text>
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
  header: {},
  tabs: {
    flexDirection: 'row',
  },
  tab: {},
  content: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
});
