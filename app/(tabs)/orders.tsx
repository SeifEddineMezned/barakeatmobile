import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Dimensions, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShoppingBag, AlertTriangle, Clock, X, Zap, XCircle } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { isPickupExpiredInTz, getNowInBusinessTz, formatDateInBusinessTz } from '@/src/utils/timezone';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations, cancelReservation, hideReservation, type ReservationFromAPI } from '@/src/services/reservations';
import { fetchConversationUnreads } from '@/src/services/messages';
import { fetchGamificationStats } from '@/src/services/gamification';
import { getErrorMessage } from '@/src/lib/api';
import { calcMoneySaved, calcCO2Saved, calcLevelProgress } from '@/src/lib/impactCalculations';
import { ReservationCard } from '@/src/components/ReservationCard';
import { DelayedLoader } from '@/src/components/DelayedLoader';

function PickupCountdown({ startTime, endTime, theme, t }: { startTime: string; endTime: string; theme: any; t: any }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(p => p + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // Use business timezone for countdown
  const bizNow = getNowInBusinessTz();
  const nowMinutes = bizNow.hours * 60 + bizNow.minutes;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

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

  // Find closest upcoming order by pickup end time (using business timezone)
  const closestOrder = useMemo(() => {
    if (!upcomingOrders.length) return null;
    const bizNow = getNowInBusinessTz();
    const nowMinutes = bizNow.hours * 60 + bizNow.minutes;
    let closest: any = null;
    let closestDiff = Infinity;
    for (const r of upcomingOrders) {
      const { start, end } = getPickupTimes(r);
      if (!end) continue;
      const [eh, em] = end.split(':').map(Number);
      const endMinutes = eh * 60 + em;
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

const CANCEL_REASONS = [
  { key: 'changed_mind', label: 'J\'ai changé d\'avis' },
  { key: 'cant_make_it', label: 'Je ne peux pas me déplacer' },
  { key: 'ordered_mistake', label: 'Commandé par erreur' },
  { key: 'emergency', label: 'Urgence' },
  { key: 'other', label: 'Autre' },
];

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed' | 'issues'>('upcoming');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ordersScrollY = useRef(new Animated.Value(0)).current;
  const ordersHeaderBg = ordersScrollY.interpolate({ inputRange: [0, 30], outputRange: ['transparent', '#ffffff'], extrapolate: 'clamp' });

  // Cancel flow state
  const [cancelTarget, setCancelTarget] = useState<{
    id: string; quantity: number; locationId?: string; merchantName?: string;
    xpLoss: number; levelBefore: number; levelAfter: number;
  } | null>(null);
  const [cancelStep, setCancelStep] = useState<'warning' | 'reason' | 'done'>('warning');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonOther, setCancelReasonOther] = useState('');
  const [showOtherReasonModal, setShowOtherReasonModal] = useState(false);
  const [otherReasonDraft, setOtherReasonDraft] = useState('');
  const xpLossAnim = useRef(new Animated.Value(0)).current;

  // Reset other-reason modal when cancel flow closes
  useEffect(() => {
    if (!cancelTarget) {
      setShowOtherReasonModal(false);
      setOtherReasonDraft('');
    }
  }, [cancelTarget]);

  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: 2,
  });

  const msgUnreadsQuery = useQuery({
    queryKey: ['conversation-unreads'],
    queryFn: fetchConversationUnreads,
    enabled: isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const msgUnreads = msgUnreadsQuery.data ?? {};

  const gamificationQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string; quantity?: number; locationId?: string }) =>
      cancelReservation(id, reason),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['reservations'] });
      const prev = queryClient.getQueryData(['reservations']);
      queryClient.setQueryData<ReservationFromAPI[]>(['reservations'], (old) =>
        old ? old.filter((r) => String(r.id) !== String(id)) : []
      );
      return { prev };
    },
    onSuccess: (_, { quantity, locationId }) => {
      // Refetch authoritative gamification stats from backend.
      // Cancelling a confirmed (not picked_up) order has no effect on real XP.
      void queryClient.invalidateQueries({ queryKey: ['gamification-stats'] });
      // Restore basket: invalidate location & basket queries so quantity ticks back up
      if (locationId) {
        void queryClient.invalidateQueries({ queryKey: ['location', locationId] });
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', locationId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      // Show done step with XP loss animation
      setCancelStep('done');
      xpLossAnim.setValue(0);
      Animated.spring(xpLossAnim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
      setTimeout(() => setCancelTarget(null), 2400);
    },
    onError: (err, _, ctx) => {
      if ((ctx as any)?.prev) queryClient.setQueryData(['reservations'], (ctx as any).prev);
      setCancelTarget(null);
      setErrorMsg(getErrorMessage(err));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  const hideMutation = useMutation({
    mutationFn: (id: string) => hideReservation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  const reservations = reservationsQuery.data ?? [];

  // Helper: check if reservation's pickup time has ended (business timezone aware)
  const isPickupExpiredCheck = useCallback((r: any) => {
    const rr = r as any;
    // Determine the reservation's date
    const dateStr = rr.pickup_date ?? rr.reservation_date ?? rr.created_at ?? rr.createdAt;
    if (!dateStr) return false;
    const reservationDate = new Date(dateStr);
    // Use business timezone for BOTH dates to avoid UTC vs local mismatch
    const now = new Date();
    const todayStr = formatDateInBusinessTz(now);
    const resDateStr = formatDateInBusinessTz(reservationDate);
    // Past date = expired
    if (resDateStr < todayStr) return true;
    // Same date: check if pickup end time has passed in business timezone
    if (resDateStr === todayStr) {
      const end = rr.pickup_end_time ?? rr.basket?.pickup_end_time ?? rr.restaurant?.pickup_end_time ?? rr.basket?.pickupWindow?.end ?? rr.pickupWindow?.end;
      if (end) {
        return isPickupExpiredInTz(String(end).substring(0, 5));
      }
    }
    return false;
  }, []);

  const upcomingOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      if (status !== 'reserved' && status !== 'ready' && status !== 'pending' && status !== 'confirmed') return false;
      // Move to past if pickup time has expired
      return !isPickupExpiredCheck(r);
    }),
    [reservations, isPickupExpiredCheck]
  );

  // "Terminées" — only actually collected/picked_up orders
  const completedOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'completed' || status === 'picked_up';
    }),
    [reservations]
  );

  // "Problèmes" — cancelled, expired, or confirmed-but-pickup-expired
  const issueOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      if (status === 'cancelled' || status === 'expired') return true;
      if ((status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed') && isPickupExpiredCheck(r)) return true;
      return false;
    }),
    [reservations, isPickupExpiredCheck]
  );

  // Alias for impact calculations (only picked_up counts)
  const completedReservations = completedOrders;

  const moneySaved = useMemo(() => {
    const gStats = gamificationQuery.data as any;
    const gStatsInner = gStats?.stats ?? gStats;
    if (gStatsInner?.money_saved != null) return Math.max(0, parseFloat(gStatsInner.money_saved) || 0);
    return calcMoneySaved(completedReservations as any[]);
  }, [completedReservations, gamificationQuery.data]);

  const co2Saved = useMemo(() => {
    const gStats = gamificationQuery.data as any;
    const gStatsInner = gStats?.stats ?? gStats;
    const mealsSaved = gStatsInner?.meals_saved ?? completedReservations.length;
    return calcCO2Saved(mealsSaved);
  }, [completedReservations.length, gamificationQuery.data]);

  // Prefer backend meals_saved (same source as profile.tsx) for consistency
  const totalOrders = useMemo(() => {
    const gStats = gamificationQuery.data as any;
    const gStatsInner = gStats?.stats ?? gStats;
    return gStatsInner?.meals_saved ?? completedReservations.length;
  }, [completedReservations.length, gamificationQuery.data]);


  const displayedOrders = activeTab === 'upcoming' ? upcomingOrders : activeTab === 'completed' ? completedOrders : issueOrders;

  // Expired orders are handled by the isPickupExpiredCheck filter above —
  // they move to the "past" tab automatically. We do NOT auto-cancel from the client
  // because timezone differences between the user's phone and the server (Tunisia)
  // could cause valid reservations to be incorrectly cancelled.

  const handleCancelRequest = useCallback((id: string, quantity: number, locationId?: string, merchantName?: string) => {
    const gStats = queryClient.getQueryData<any>(['gamification-stats']);
    const xp = gStats?.xp ?? (typeof gStats?.level === 'object' ? (gStats.level.xp ?? 0) : 0);
    const xpLoss = quantity * 10;
    const { level: levelBefore } = calcLevelProgress(xp);
    const { level: levelAfter } = calcLevelProgress(Math.max(0, xp - xpLoss));
    setCancelTarget({ id, quantity, locationId, merchantName, xpLoss, levelBefore, levelAfter });
    setCancelStep('warning');
    setCancelReason('');
    setCancelReasonOther('');
  }, [queryClient]);

  const handleConfirmCancel = useCallback(() => {
    if (!cancelTarget || cancelMutation.isPending) return;
    const finalReason = cancelReason === 'Autre'
      ? (cancelReasonOther.trim() || 'Other')
      : cancelReason;
    cancelMutation.mutate({
      id: cancelTarget.id,
      reason: finalReason,
      quantity: cancelTarget.quantity,
      locationId: cancelTarget.locationId,
    });
  }, [cancelTarget, cancelReason, cancelReasonOther, cancelMutation]);

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
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>{t('orders.title')}</Text>
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

      {/* ── Cancel Order Modal ─────────────────────────── */}
      <Modal
        visible={!!cancelTarget}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!cancelMutation.isPending && cancelStep !== 'done') setCancelTarget(null); }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>

          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, width: '100%', maxWidth: 380, overflow: 'hidden', padding: 4 }}>

            {/* ── STEP: Warning ─────────────────────────── */}
            {cancelStep === 'warning' && (
              <>
                <View style={{ alignItems: 'center', paddingTop: 24, paddingHorizontal: 20 }}>
                  <View style={{ backgroundColor: theme.colors.error + '15', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                    <AlertTriangle size={28} color={theme.colors.error} />
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' as const, textAlign: 'center', marginBottom: 4 }}>
                    {t('orders.cancelConfirmTitle', { defaultValue: 'Annuler cette commande ?' })}
                  </Text>
                  {cancelTarget?.merchantName ? (
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16 }}>
                      {cancelTarget.merchantName}
                    </Text>
                  ) : null}
                </View>

                <View style={{ paddingHorizontal: 20, paddingBottom: 24 }}>
                  {/* Consequences list */}
                  <View style={{ backgroundColor: theme.colors.error + '10', borderRadius: 14, padding: 16, gap: 10, marginBottom: 20 }}>
                    <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, fontWeight: '700' as const }}>
                      {t('orders.cancelConsequences', { defaultValue: 'Si vous annulez :' })}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Zap size={14} color={theme.colors.error} />
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                        {t('orders.cancelXpLoss', { defaultValue: 'Vous perdez' })}{' '}
                        <Text style={{ fontWeight: '700' as const }}>−{cancelTarget?.xpLoss ?? 0} XP</Text>
                      </Text>
                    </View>
                    {cancelTarget && cancelTarget.levelAfter < cancelTarget.levelBefore && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.error, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' as const, lineHeight: 14 }}>▼</Text>
                        </View>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                          {t('orders.cancelLevelDrop', { defaultValue: 'Niveau' })}{' '}
                          <Text style={{ fontWeight: '700' as const }}>{cancelTarget.levelBefore} → {cancelTarget.levelAfter}</Text>
                        </Text>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <ShoppingBag size={14} color={theme.colors.error} />
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                        {t('orders.cancelBasketReturned', { defaultValue: 'Le panier est rendu au commerce' })}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => setCancelTarget(null)}
                      style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>{t('orders.keepOrder', { defaultValue: 'Garder' })}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setCancelStep('reason')}
                      style={{ flex: 1, backgroundColor: theme.colors.error, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>{t('orders.cancelContinue', { defaultValue: 'Annuler' })}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}

            {/* ── STEP: Reason ──────────────────────────── */}
            {cancelStep === 'reason' && (
              <>
                <View style={{
                  paddingHorizontal: 20, paddingVertical: 18,
                  flexDirection: 'row', alignItems: 'center',
                }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' as const, flex: 1 }}>
                    {t('orders.cancelReasonTitle', { defaultValue: 'Pourquoi annulez-vous ?' })}
                  </Text>
                  <TouchableOpacity onPress={() => setCancelTarget(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={20} color={theme.colors.muted} />
                  </TouchableOpacity>
                </View>

                <View style={{ paddingHorizontal: 20 }}>
                  {CANCEL_REASONS.map((reason) => (
                    <TouchableOpacity
                      key={reason.key}
                      onPress={() => setCancelReason(reason.label)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 12,
                        paddingVertical: 13, paddingHorizontal: 16,
                        borderRadius: 12, marginBottom: 8,
                        backgroundColor: cancelReason === reason.label
                          ? theme.colors.primary + '12'
                          : theme.colors.bg,
                        borderWidth: 1.5,
                        borderColor: cancelReason === reason.label
                          ? theme.colors.primary
                          : theme.colors.divider,
                      }}
                    >
                      <View style={{
                        width: 20, height: 20, borderRadius: 10,
                        borderWidth: 2,
                        borderColor: cancelReason === reason.label ? theme.colors.primary : theme.colors.divider,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {cancelReason === reason.label && (
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }} />
                        )}
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                        {reason.label}
                      </Text>
                    </TouchableOpacity>
                  ))}

                  {cancelReason === 'Autre' && (
                    <TouchableOpacity
                      onPress={() => { setOtherReasonDraft(cancelReasonOther); setShowOtherReasonModal(true); }}
                      style={{
                        borderWidth: 1, borderColor: theme.colors.divider,
                        borderRadius: 12, padding: 12, marginBottom: 8,
                        backgroundColor: theme.colors.bg, minHeight: 48,
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: cancelReasonOther ? theme.colors.textPrimary : theme.colors.muted, fontSize: 14 }}>
                        {cancelReasonOther || t('orders.cancelReasonPlaceholder', { defaultValue: 'Appuyez pour écrire votre raison...' })}
                      </Text>
                    </TouchableOpacity>
                  )}

                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                    <TouchableOpacity
                      onPress={() => setCancelStep('warning')}
                      style={{
                        flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
                        borderWidth: 1, borderColor: theme.colors.divider,
                      }}
                    >
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.button }}>{t('common.back', { defaultValue: 'Retour' })}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleConfirmCancel}
                      disabled={!cancelReason || cancelMutation.isPending}
                      style={{
                        flex: 2,
                        backgroundColor: !cancelReason ? theme.colors.muted : theme.colors.error,
                        borderRadius: 14, paddingVertical: 14, alignItems: 'center',
                        opacity: !cancelReason ? 0.45 : 1,
                      }}
                    >
                      {cancelMutation.isPending ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={{ color: '#fff', ...theme.typography.button }}>{t('orders.confirmCancellation', { defaultValue: 'Confirmer l\'annulation' })}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}

            {/* ── STEP: Done (XP loss animation) ────────── */}
            {cancelStep === 'done' && cancelTarget && (
              <Animated.View style={{
                paddingHorizontal: 20, paddingVertical: 40, alignItems: 'center',
                transform: [{ scale: xpLossAnim }],
                opacity: xpLossAnim,
              }}>
                <View style={{
                  width: 72, height: 72, borderRadius: 36,
                  backgroundColor: theme.colors.error + '15',
                  alignItems: 'center', justifyContent: 'center',
                  marginBottom: 20,
                }}>
                  <X size={32} color={theme.colors.error} />
                </View>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' as const, textAlign: 'center' }}>
                  {t('orders.orderCancelled', { defaultValue: 'Commande annulée' })}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
                  <Zap size={16} color={theme.colors.error} />
                  <Text style={{ color: theme.colors.error, ...theme.typography.body, fontWeight: '700' as const }}>
                    −{cancelTarget.xpLoss} XP
                  </Text>
                  {cancelTarget.levelAfter < cancelTarget.levelBefore && (
                    <>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>·</Text>
                      <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                        Level {cancelTarget.levelBefore} → {cancelTarget.levelAfter}
                      </Text>
                    </>
                  )}
                </View>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 8, textAlign: 'center' }}>
                  {t('orders.cancelBasketReturned', { defaultValue: 'Le panier a été rendu au commerce' })}
                </Text>
              </Animated.View>
            )}

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

      {/* "Autre" reason text input modal */}
      <Modal visible={showOtherReasonModal} transparent animationType="fade" onRequestClose={() => setShowOtherReasonModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 16 }}>
                {t('orders.otherReasonTitle', { defaultValue: 'Raison de l\'annulation' })}
              </Text>
              <TextInput
                style={{
                  borderWidth: 1, borderColor: theme.colors.divider,
                  borderRadius: 12, padding: 12,
                  color: theme.colors.textPrimary,
                  backgroundColor: theme.colors.bg,
                  fontSize: 14, lineHeight: 20,
                  minHeight: 100, textAlignVertical: 'top',
                }}
                placeholder={t('orders.cancelReasonPlaceholder', { defaultValue: 'Dites-nous en plus...' })}
                placeholderTextColor={theme.colors.muted}
                value={otherReasonDraft}
                onChangeText={setOtherReasonDraft}
                multiline
                maxLength={200}
                autoFocus
              />
              <TouchableOpacity
                onPress={() => { setCancelReasonOther(otherReasonDraft); setShowOtherReasonModal(false); }}
                style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 }}
              >
                <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 15 }}>
                  {t('common.done', { defaultValue: 'Terminé' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
