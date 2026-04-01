import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Animated, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShoppingBag, AlertTriangle, Clock } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations, cancelReservation, hideReservation, type ReservationFromAPI } from '@/src/services/reservations';
import { getErrorMessage } from '@/src/lib/api';
import { ReservationCard } from '@/src/components/ReservationCard';
import { DelayedLoader } from '@/src/components/DelayedLoader';

function PickupCountdown({ startTime, endTime, theme, t }: { startTime: string; endTime: string; theme: any; t: any }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const today = new Date();
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm);
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em);

  const isBeforePickup = now < startDate;
  const isDuringPickup = now >= startDate && now <= endDate;

  let label = '';
  let color = theme.colors.muted;
  let timeLeft = '';

  if (isBeforePickup) {
    const diff = Math.round((startDate.getTime() - now.getTime()) / 60000);
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    label = t('orders.startsIn', { defaultValue: 'Starts in' });
    timeLeft = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    color = theme.colors.primary;
  } else if (isDuringPickup) {
    const diff = Math.round((endDate.getTime() - now.getTime()) / 60000);
    const mins = diff;
    label = t('orders.endsIn', { defaultValue: 'Ends in' });
    timeLeft = `${mins}m`;
    color = mins < 15 ? theme.colors.error : theme.colors.accentWarm;
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

  // Find closest upcoming order by pickup end time
  const closestOrder = useMemo(() => {
    if (!upcomingOrders.length) return null;
    const now = new Date();
    let closest: any = null;
    let closestDiff = Infinity;
    for (const r of upcomingOrders) {
      const { start, end } = getPickupTimes(r);
      if (!end) continue;
      const [eh, em] = end.split(':').map(Number);
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em);
      const diff = endDate.getTime() - now.getTime();
      if (diff > 0 && diff < closestDiff) {
        closestDiff = diff;
        closest = { reservation: r, start, end, minutesLeft: Math.round(diff / 60000) };
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
        {/* Slide 1: Impact */}
        <View style={{
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radii.r16,
          padding: 20,
          width: cardWidth,
          marginRight: closestOrder ? 10 : 0,
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

        {/* Slide 2: Pickup Countdown (only if upcoming order exists) */}
        {closestOrder && (
          <View style={{
            backgroundColor: closestOrder.minutesLeft < 30 ? theme.colors.error : theme.colors.surface,
            borderRadius: theme.radii.r16,
            padding: 20,
            width: cardWidth,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {closestOrder.minutesLeft < 30 ? (
                <AlertTriangle size={18} color="#fff" />
              ) : (
                <Clock size={18} color={theme.colors.primary} />
              )}
              <Text style={{
                color: closestOrder.minutesLeft < 30 ? '#fff' : theme.colors.textPrimary,
                ...theme.typography.bodySm,
                fontWeight: '600',
              }}>
                {closestOrder.minutesLeft < 30
                  ? t('orders.pickupExpiring', { defaultValue: 'Pickup ending soon!' })
                  : t('orders.nextPickup', { defaultValue: 'Next Pickup' })}
              </Text>
            </View>
            <Text style={{
              color: closestOrder.minutesLeft < 30 ? '#fff' : theme.colors.textPrimary,
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
                backgroundColor: closestOrder.minutesLeft < 30 ? '#fff' : closestOrder.minutesLeft < 60 ? theme.colors.accentWarm : theme.colors.primary,
              }} />
              <Text style={{
                color: closestOrder.minutesLeft < 30 ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary,
                ...theme.typography.bodySm,
                fontWeight: '600',
              }}>
                {closestOrder.start} - {closestOrder.end}
              </Text>
              <Text style={{
                color: closestOrder.minutesLeft < 30 ? '#fff' : theme.colors.primary,
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
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');

  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: 2,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelReservation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
    onError: (err) => {
      Alert.alert(t('common.error'), getErrorMessage(err));
    },
  });

  const hideMutation = useMutation({
    mutationFn: (id: string) => hideReservation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  const reservations = reservationsQuery.data ?? [];

  // Helper: check if reservation's pickup time has ended
  const isPickupExpired = useCallback((r: any) => {
    const now = new Date();
    const rr = r as any;
    // Determine the reservation's date
    const dateStr = rr.pickup_date ?? rr.reservation_date ?? rr.created_at ?? rr.createdAt;
    if (!dateStr) return false;
    const reservationDate = new Date(dateStr);
    const todayStr = now.toISOString().split('T')[0];
    const resDateStr = reservationDate.toISOString().split('T')[0];
    // Past date = expired
    if (resDateStr < todayStr) return true;
    // Same date: check if pickup end time has passed
    if (resDateStr === todayStr) {
      const end = rr.pickup_end_time ?? rr.basket?.pickup_end_time ?? rr.restaurant?.pickup_end_time ?? rr.basket?.pickupWindow?.end ?? rr.pickupWindow?.end;
      if (end) {
        const [eh, em] = String(end).split(':').map(Number);
        if (!isNaN(eh) && !isNaN(em)) {
          const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em);
          if (now > endDate) return true;
        }
      }
    }
    return false;
  }, []);

  const upcomingOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      if (status !== 'reserved' && status !== 'ready' && status !== 'pending' && status !== 'confirmed') return false;
      // Move to past if pickup time has expired
      return !isPickupExpired(r);
    }),
    [reservations, isPickupExpired]
  );

  const pastOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      // Explicitly past statuses
      if (status === 'collected' || status === 'cancelled' || status === 'completed' || status === 'expired' || status === 'picked_up') return true;
      // Upcoming status but pickup expired = show in past
      if ((status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed') && isPickupExpired(r)) return true;
      return false;
    }),
    [reservations, isPickupExpired]
  );

  const completedReservations = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'completed' || status === 'picked_up';
    }),
    [reservations]
  );

  const moneySaved = useMemo(() => completedReservations.reduce((sum, r) => {
    const rr = r as any;

    // Original (full) price — check basket, then restaurant sub-object, then reservation top level
    const orig = Number(
      r.basket?.originalPrice ??
      rr.basket?.original_price ??
      rr.restaurant?.original_price ??   // ← API stores original_price here
      rr.original_price ??
      0
    );

    // Discounted (paid) price — check basket, then restaurant sub-object, then reservation top level / total
    const disc = Number(
      r.basket?.discountedPrice ??
      rr.basket?.price_tier ??
      rr.basket?.discounted_price ??
      rr.basket?.selling_price ??
      rr.restaurant?.price_tier ??       // ← API stores selling price here
      rr.price_tier ??
      r.total ??                         // total paid is the discounted price
      0
    );

    const saving = orig > 0 && disc > 0 ? (orig - disc) : 0;
    return sum + saving * (r.quantity ?? 1);
  }, 0), [completedReservations]);

  const co2Saved = completedReservations.length * 2.5;
  const totalOrders = reservations.length;


  const displayedOrders = activeTab === 'upcoming' ? upcomingOrders : pastOrders;

  // Auto-cancel expired orders (pickup end time passed)
  const expireCancelledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!upcomingOrders.length) return;
    const now = new Date();
    const expiredIds: string[] = [];
    for (const r of upcomingOrders) {
      const id = String(r.id);
      if (expireCancelledRef.current.has(id)) continue;
      const { end } = getPickupTimes(r);
      if (!end) continue;
      const [eh, em] = end.split(':').map(Number);
      if (isNaN(eh) || isNaN(em)) continue;

      // Check reservation date — if not today, it's expired
      const createdAt = (r as any).created_at ?? (r as any).createdAt;
      const reservationDate = createdAt ? new Date(createdAt).toDateString() : now.toDateString();
      const isToday = reservationDate === now.toDateString();

      if (!isToday) {
        expiredIds.push(id);
        continue;
      }

      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em);
      if (now > endDate) {
        expiredIds.push(id);
      }
    }

    if (expiredIds.length > 0) {
      expiredIds.forEach(async (id) => {
        expireCancelledRef.current.add(id);
        try {
          await cancelReservation(id);
        } catch (e) {
          console.log('[Orders] Auto-cancel failed for', id, e);
        }
      });
      // Refetch after a short delay to update the list
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      }, 1500);
    }
  }, [upcomingOrders, queryClient]);

  const handleCancel = useCallback((id: string) => {
    Alert.alert(
      t('orders.cancelTitle'),
      t('orders.cancelConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => cancelMutation.mutate(id) },
      ]
    );
  }, [cancelMutation, t]);

  const handleHide = useCallback((id: string) => {
    hideMutation.mutate(id);
  }, [hideMutation]);

  const getPickupTimes = (reservation: any) => {
    const start = reservation.basket?.pickupWindow?.start
      ?? reservation.basket?.pickup_start_time
      ?? reservation.restaurant?.pickup_start_time
      ?? reservation.pickupWindow?.start;
    const end = reservation.basket?.pickupWindow?.end
      ?? reservation.basket?.pickup_end_time
      ?? reservation.restaurant?.pickup_end_time
      ?? reservation.pickupWindow?.end;
    return { start, end };
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
      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl, paddingTop: 50, paddingBottom: 100 }]}>
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
                    borderBottomColor: activeTab === 'past' ? theme.colors.primary : 'transparent',
                  },
                ]}
                onPress={() => setActiveTab('past')}
              >
                <Text
                  style={[
                    {
                      color: activeTab === 'past' ? theme.colors.primary : theme.colors.textSecondary,
                      ...theme.typography.body,
                      fontWeight: activeTab === 'past' ? ('600' as const) : ('400' as const),
                      textAlign: 'center',
                    },
                  ]}
                >
                  {t('orders.past')}
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
                const expired = isStillUpcomingStatus && isPickupExpired(reservation);
                return (
                  <ReservationCard
                    key={reservation.id}
                    reservation={reservation}
                    onCancel={handleCancel}
                    onHide={handleHide}
                    overrideExpired={expired}
                  />
                );
              })
            )}
          </>
        )}
      </ScrollView>

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
