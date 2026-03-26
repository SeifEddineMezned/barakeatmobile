import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShoppingBag, Star, Flag } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations, cancelReservation, hideReservation } from '@/src/services/reservations';
import { getErrorMessage } from '@/src/lib/api';
import { ReservationCard } from '@/src/components/ReservationCard';

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

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const [reviewPrompt, setReviewPrompt] = useState<{ reservationId: string; locationName: string; locationId: string } | null>(null);
  const [reviewDismissed, setReviewDismissed] = useState<Set<string>>(new Set());

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

  const upcomingOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed';
    }),
    [reservations]
  );

  const pastOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'cancelled' || status === 'completed' || status === 'expired' || status === 'picked_up';
    }),
    [reservations]
  );

  const completedReservations = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'completed' || status === 'picked_up';
    }),
    [reservations]
  );

  const moneySaved = useMemo(() => completedReservations.reduce((sum, r) => {
    const orig = r.basket?.originalPrice ?? Number((r.basket as any)?.original_price ?? 0);
    const disc = r.basket?.discountedPrice ?? Number((r.basket as any)?.discounted_price ?? 0);
    return sum + (Number(orig) - Number(disc)) * (r.quantity ?? 1);
  }, 0), [completedReservations]);

  const co2Saved = completedReservations.length * 2.5;
  const totalOrders = reservations.length;

  // Auto-show review popup for recently picked-up orders without a review
  useEffect(() => {
    if (!reservations.length) return;
    const needsReview = reservations.find((r) => {
      const status = (r.status ?? '').toLowerCase();
      const hasReview = (r as any).has_review === true;
      const id = String(r.id ?? '');
      return (status === 'picked_up' || status === 'collected') && !hasReview && !reviewDismissed.has(id);
    });
    if (needsReview && !reviewPrompt) {
      const rr = needsReview as any;
      setReviewPrompt({
        reservationId: String(needsReview.id),
        locationName: rr.restaurant_name ?? rr.basket?.merchantName ?? 'this location',
        locationId: String(rr.location_id ?? rr.restaurant_id ?? ''),
      });
    }
  }, [reservations, reviewDismissed, reviewPrompt]);

  const isToday = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  };

  const todayReservations = useMemo(
    () => reservations.filter((r) =>
      isToday(r.created_at ?? r.createdAt ?? '') &&
      (r.status ?? '').toLowerCase() !== 'cancelled'
    ),
    [reservations]
  );

  const displayedOrders = activeTab === 'upcoming' ? upcomingOrders : pastOrders;

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
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }]}>
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
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'flex-start', alignItems: 'center', paddingTop: 100, paddingHorizontal: 32 }}>
          <ShoppingBag size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginTop: 24, textAlign: 'center' }}>
            {t('orders.emptyTitle', { defaultValue: 'No orders yet' })}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
            {t('orders.emptyDesc', { defaultValue: 'Start saving food and money by reserving a surprise bag!' })}
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)' as never)}
            style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16, paddingVertical: 16, paddingHorizontal: 40, marginTop: 32 }}
          >
            <Text style={{ color: '#fff', ...theme.typography.button }}>
              {t('orders.findBasket', { defaultValue: 'Find a Surprise Bag' })}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl, paddingBottom: 100 }]}>
        {reservationsQuery.isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 16 }]}>
              {t('common.loading')}
            </Text>
          </View>
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
            {/* Impact Summary Card */}
            <View style={{
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r16,
              padding: 20,
              marginBottom: 16,
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

            {/* Today's Reservations */}
            {todayReservations.length > 0 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 12 }}>
                  {t('orders.todayPickups', { defaultValue: "Today's Pickups" })}
                </Text>
                {todayReservations.map((reservation) => {
                  const { start, end } = getPickupTimes(reservation);
                  return (
                    <View key={`today-${reservation.id}`} style={{ marginBottom: 8 }}>
                      {start && end && (
                        <View style={{
                          backgroundColor: theme.colors.surface,
                          borderRadius: theme.radii.r12,
                          padding: 12,
                          marginBottom: 4,
                        }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>
                              {reservation.basket?.merchantName ?? reservation.basket?.merchant_name ?? reservation.restaurant?.name ?? ''}
                            </Text>
                            <PickupCountdown startTime={start} endTime={end} theme={theme} t={t} />
                          </View>
                          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
                            {start} - {end}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

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
              <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 20 }}>
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
                    ? t('orders.emptyTitle', { defaultValue: 'No upcoming orders' })
                    : t('orders.emptyState', { defaultValue: 'No past orders' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                  {activeTab === 'upcoming'
                    ? t('orders.emptyDesc', { defaultValue: 'Reserve a surprise bag to save food and money!' })
                    : t('orders.emptyPastDesc', { defaultValue: 'Your completed and cancelled orders will appear here.' })}
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
                    {t('orders.findBasket', { defaultValue: 'Find a Surprise Bag' })}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              displayedOrders.map((reservation) => (
                <ReservationCard
                  key={reservation.id}
                  reservation={reservation}
                  onCancel={handleCancel}
                  onHide={handleHide}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Review/Report popup after pickup */}
      <Modal visible={!!reviewPrompt} transparent animationType="fade" onRequestClose={() => { setReviewDismissed(prev => new Set(prev).add(reviewPrompt?.reservationId ?? '')); setReviewPrompt(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.primary + '14', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Star size={32} color={theme.colors.primary} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('orders.reviewPromptTitle', { defaultValue: 'How was your experience?' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
              {t('orders.reviewPromptDesc', { defaultValue: `Your pickup at ${reviewPrompt?.locationName} is complete! Would you like to leave a review or report an issue?` })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={() => {
                  const rid = reviewPrompt?.reservationId;
                  const lid = reviewPrompt?.locationId;
                  setReviewDismissed(prev => new Set(prev).add(rid ?? ''));
                  setReviewPrompt(null);
                  router.push({ pathname: '/review', params: { reservationId: rid, locationId: lid } } as never);
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
                  setReviewDismissed(prev => new Set(prev).add(reviewPrompt?.reservationId ?? ''));
                  setReviewPrompt(null);
                  router.push({ pathname: '/review', params: { locationId: lid, report: 'true' } } as never);
                }}
                style={{ paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' }}
              >
                <Flag size={16} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => { setReviewDismissed(prev => new Set(prev).add(reviewPrompt?.reservationId ?? '')); setReviewPrompt(null); }}
              style={{ marginTop: 12 }}
            >
              <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm }}>
                {t('orders.maybeLater', { defaultValue: 'Maybe later' })}
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
