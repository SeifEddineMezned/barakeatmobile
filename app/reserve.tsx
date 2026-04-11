import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, ActivityIndicator, Image, Modal, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X, Minus, Plus, Banknote, CreditCard, Check, AlertTriangle, Copy, Download, Zap, ShoppingBag } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchBasketById } from '@/src/services/baskets';
import { createReservation, fetchReservationQRCode } from '@/src/services/reservations';
import { updateStreak, fetchGamificationStats, type StreakUpdateResult } from '@/src/services/gamification';
// import { scheduleLocalNotification } from '@/src/services/pushNotifications';
import { getErrorMessage } from '@/src/lib/api';
import { calcLevelProgress } from '@/src/lib/impactCalculations';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { isPickupWindowOpenInTz } from '@/src/utils/timezone';
import { useCelebrationStore } from '@/src/stores/celebrationStore';

export default function ReserveScreen() {
  const { basketId } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Confirmation animation state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmPhase, setConfirmPhase] = useState<'bouncing' | 'success' | 'details'>('bouncing');
  const [confirmData, setConfirmData] = useState<{ pickupCode: string; pickupStart: string; pickupEnd: string; address: string; qrCodeUrl?: string; basketImageUrl?: string; locationName?: string } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [streakData, setStreakData] = useState<StreakUpdateResult | null>(null);
  const setCelebration = useCelebrationStore((s) => s.setPending);
  const dismissConfirmAndNavigate = () => {
    setShowConfirmation(false);
  };

  // Gamification stats query
  const gamificationQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    staleTime: 60_000,
  });

  const handleCopyCode = async () => {
    if (!confirmData?.pickupCode) return;
    try {
      await Share.share({ message: confirmData.pickupCode });
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleShareQR = async () => {
    if (!confirmData) return;
    try {
      await Share.share({
        message: `Barakeat Pickup Code: ${confirmData.pickupCode}\nPickup: ${confirmData.pickupStart} - ${confirmData.pickupEnd}\n${confirmData.address}`,
      });
    } catch {
      // ignore
    }
  };

  // Letter bounce animations
  const BARAKEAT = 'Barakeat'.split('');
  const letterAnims = React.useRef(BARAKEAT.map(() => new Animated.Value(0))).current;

  const startBouncingAnimation = () => {
    letterAnims.forEach(a => a.setValue(0));
    const runWave = () => {
      letterAnims.forEach(a => a.setValue(0));
      Animated.stagger(80,
        letterAnims.map((anim) =>
          Animated.sequence([
            Animated.timing(anim, { toValue: -15, duration: 160, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }),
          ])
        )
      ).start(({ finished }) => {
        if (finished) setTimeout(runWave, 600);
      });
    };
    runWave();
  };

  // ── Step 1: Fetch the selected basket so we can derive its parent location id ──
  const basketQuery = useQuery({
    queryKey: ['basket', basketId],
    queryFn: () => fetchBasketById(String(basketId)),
    enabled: !!basketId,
    staleTime: 60_000,
  });

  // ── Step 2: Derive the real location/restaurant id from the basket payload ──
  // The basket API returns both location_id and restaurant_id; prefer location_id.
  const rawBasketData = basketQuery.data as any;
  const resolvedLocationId: string | null =
    rawBasketData?.location_id != null ? String(rawBasketData.location_id)
    : rawBasketData?.restaurant_id != null ? String(rawBasketData.restaurant_id)
    : null;

  console.log('[Reserve] basketId:', basketId, '→ resolvedLocationId:', resolvedLocationId);

  // ── Step 3: Fetch location — only when we have the real location id ──
  const locationQuery = useQuery({
    queryKey: ['location', resolvedLocationId],
    queryFn: () => fetchLocationById(String(resolvedLocationId)),
    enabled: !!resolvedLocationId,
  });

  const location = locationQuery.data;
  const locationName = location?.display_name ?? location?.name ?? rawBasketData?.restaurant_name ?? '';
  const address = location?.address ?? rawBasketData?.restaurant_address ?? rawBasketData?.location_address ?? '';

  // Prefer basket-level pickup window, fall back to location
  const pickupStart =
    rawBasketData?.pickup_start_time?.substring(0, 5) ??
    location?.pickup_start_time?.substring(0, 5) ?? '';
  const pickupEnd =
    rawBasketData?.pickup_end_time?.substring(0, 5) ??
    location?.pickup_end_time?.substring(0, 5) ?? '';

  // Use the SELECTED basket's quantity and price — not aggregated from all sibling baskets
  const basketName = rawBasketData?.name ?? rawBasketData?.basket_name ?? t('orders.surpriseBag');
  const basketImage = rawBasketData?.image_url ?? rawBasketData?.cover_image_url ?? null;
  const totalAvailable = Number(rawBasketData?.quantity ?? 0);
  const price = Number(rawBasketData?.selling_price ?? 0);
  const originalPrice = Number(rawBasketData?.original_price ?? 0);

  const reserveMutation = useMutation({
    // Use the real resolved id, not the basket id
    mutationFn: () => createReservation({ location_id: Number(resolvedLocationId), basket_id: basketId ? Number(basketId) : undefined, quantity }),
    onSuccess: async (data) => {
      console.log('[Reserve] Reservation created:', data.id);
      const pickupCode = data.pickup_code ?? data.pickupCode ?? '';

      setConfirmData({ pickupCode, pickupStart, pickupEnd, address, basketImageUrl: basketImage ?? undefined, locationName });
      setShowConfirmation(true);
      setConfirmPhase('bouncing');
      startBouncingAnimation();

      // Only invalidate customer-side queries (not business-side like today-orders)
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      void queryClient.invalidateQueries({ queryKey: ['location', resolvedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', resolvedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['basket', basketId] });

      // Capture pre-reservation XP from the CURRENT cache (not component snapshot)
      // This ensures second/third reservations read the updated value
      const xpGained = (quantity ?? 1) * 10;
      const cachedGam = queryClient.getQueryData<any>(['gamification-stats']);
      const cachedLevel = cachedGam?.level;
      // Read XP from DB values (use ?? not || to avoid 0 being falsy)
      const preReservationXp: number =
        cachedGam?.xp ?? (typeof cachedLevel === 'object' ? (cachedLevel?.xp ?? 0) : 0);

      // Force refetch gamification from DB (backend now persists xp/level)
      // Await so the cache is updated before user navigates to profile
      await queryClient.invalidateQueries({ queryKey: ['gamification-stats'] });
      await queryClient.refetchQueries({ queryKey: ['gamification-stats'] });

      // Update streak only — do NOT invalidate gamification-stats here
      try {
        const streakResult = await updateStreak();
        if (streakResult.streak_changed) {
          setStreakData(streakResult);
        }
      } catch (e) {
        console.log('[Reserve] Streak update failed (non-critical):', e);
      }

      // Schedule local pickup reminders (disabled for Expo Go compatibility)
      // TODO: Re-enable when using development build
      // try {
      //   const now = new Date();
      //   const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      //   if (pickupStart) {
      //     const startDate = new Date(`${today}T${pickupStart}`);
      //     const secsUntilStart = Math.floor((startDate.getTime() - now.getTime()) / 1000);
      //     if (secsUntilStart > 60) {
      //       void scheduleLocalNotification(
      //         t('notifications.pickupStartsTitle', { defaultValue: 'Pickup time!' }),
      //         t('notifications.pickupStartsBody', { defaultValue: 'Your order is ready for pickup.' }),
      //         secsUntilStart,
      //       );
      //     }
      //   }
      //   if (pickupEnd) {
      //     const endDate = new Date(`${today}T${pickupEnd}`);
      //     const secsUntilEnd = Math.floor((endDate.getTime() - now.getTime()) / 1000);
      //     const secsUntilWarning = secsUntilEnd - 1800; // 30 min before end
      //     if (secsUntilWarning > 60) {
      //       void scheduleLocalNotification(
      //         t('notifications.pickupEndingSoonTitle', { defaultValue: 'Pickup ending soon!' }),
      //         t('notifications.pickupEndingSoonBody', { defaultValue: 'Your pickup window closes in 30 minutes.' }),
      //         secsUntilWarning,
      //       );
      //     }
      //   }
      // } catch (e) {
      //   console.log('[Reserve] Notification scheduling failed (non-critical):', e);
      // }

      // Fetch QR code in background while bouncing/success phases play
      let qrUrl: string | undefined;
      fetchReservationQRCode(String(data.id)).then(url => { qrUrl = url; }).catch(() => {});

      // Pre-compute celebration data
      const { level: levelBefore, xpProgress: pBefore } = calcLevelProgress(preReservationXp);
      const { level: levelAfter, xpProgress: pAfter, xpInLevel, xpBandSize } = calcLevelProgress(preReservationXp + xpGained);

      // Phase 1 (bouncing) → Phase 2 (success) after 3s → then fire celebration
      setTimeout(() => {
        setConfirmPhase('success');
        // Phase 2 (success) → dismiss and fire XP celebration after 3s
        setTimeout(() => {
          setShowConfirmation(false);
          setCelebration({
            xpGained,
            levelBefore,
            levelAfter,
            xpProgressBefore: pBefore,
            xpProgress: pAfter,
            xpInLevel,
            xpBandSize,
            streakChanged: !!(streakData?.streak_changed && (streakData?.current_streak ?? 0) > 0),
            newStreak: streakData?.current_streak ?? 0,
            confirmData: { pickupCode, pickupStart, pickupEnd, address, locationName, basketName, basketImage: basketImage ?? undefined, quantity, price, qrCodeUrl: qrUrl },
          });
          router.replace('/(tabs)/orders' as never);
        }, 3000);
      }, 3000);
    },
    onError: (err) => {
      const msg = getErrorMessage(err);
      console.log('[Reserve] Error:', msg);
      setErrorMessage(msg);
    },
  });

  const maxQuantity = Math.max(totalAvailable, 1);

  const handleIncrement = () => {
    if (quantity < maxQuantity) setQuantity((prev) => prev + 1);
  };

  const handleDecrement = () => {
    if (quantity > 1) setQuantity((prev) => prev - 1);
  };

  // Check if current time is within the basket's pickup window (business timezone)
  const isPickupWindowOpen = () => isPickupWindowOpenInTz(pickupStart, pickupEnd);

  const handleConfirm = () => {
    // Frontend validation: check basket pickup window
    if (!isPickupWindowOpen()) {
      setErrorMessage(t('errors.pickupExpired', { defaultValue: 'The pickup window has expired.' }));
      return;
    }
    if (paymentMethod === 'cash') {
      setShowConfirmModal(true);
    } else {
      reserveMutation.mutate();
    }
  };

  const confirmAndReserve = () => {
    setShowConfirmModal(false);
    reserveMutation.mutate();
  };

  // Show loading while the basket or location are loading
  if (basketQuery.isLoading || (!!resolvedLocationId && locationQuery.isLoading)) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  // If basket fetch failed or returned no location id we cannot proceed
  if (basketQuery.isError || !resolvedLocationId || !location) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={[{ color: theme.colors.error, ...theme.typography.body }]}>{t('common.errorOccurred')}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }} accessibilityLabel={t('common.goBack')} accessibilityRole="button">
          <Text style={[{ color: theme.colors.primary, ...theme.typography.body }]}>{t('common.goBack')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <View style={[styles.header, { padding: theme.spacing.xl }]}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel={t('common.close', { defaultValue: 'Close' })} accessibilityRole="button">
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('reserve.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl }]}>
        {/* Basket info: image + name + location */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.lg }}>
          {basketImage ? (
            <Image source={{ uri: basketImage }} style={{ width: 64, height: 64, borderRadius: theme.radii.r12, marginRight: theme.spacing.md }} resizeMode="cover" accessibilityLabel={basketName} />
          ) : (
            <View style={{ width: 64, height: 64, borderRadius: theme.radii.r12, marginRight: theme.spacing.md, backgroundColor: theme.colors.primary + '10', justifyContent: 'center', alignItems: 'center' }}>
              <Zap size={24} color={theme.colors.primary} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, fontWeight: '700' }]} numberOfLines={2}>
              {basketName}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]} numberOfLines={1}>
              {locationName}
            </Text>
          </View>
        </View>

        {/* Quantity selector */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginBottom: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginBottom: theme.spacing.lg }]}>
            {t('reserve.quantity')}
          </Text>
          <View style={styles.quantitySelector}>
            <TouchableOpacity
              style={[styles.quantityButton, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }]}
              onPress={handleDecrement}
              disabled={quantity <= 1}
              accessibilityLabel={t('reserve.decreaseQuantity', { defaultValue: 'Decrease quantity' })}
              accessibilityRole="button"
            >
              <Minus size={20} color={quantity <= 1 ? theme.colors.muted : theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.quantityText, { color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
              {quantity}
            </Text>
            <TouchableOpacity
              style={[styles.quantityButton, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }]}
              onPress={handleIncrement}
              disabled={quantity >= maxQuantity}
              accessibilityLabel={t('reserve.increaseQuantity', { defaultValue: 'Increase quantity' })}
              accessibilityRole="button"
            >
              <Plus size={20} color={quantity >= maxQuantity ? theme.colors.muted : theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: theme.spacing.md }]}>
            {t('reserve.basketsLeft', { count: totalAvailable })}
          </Text>
        </View>

        {/* Summary */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginBottom: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
            {t('reserve.summary')}
          </Text>
          <View style={styles.summaryRow}>
            <Text style={[{ flex: 1, color: theme.colors.textSecondary, ...theme.typography.body }]} numberOfLines={2}>
              {basketName} <Text style={{ fontWeight: '700', color: theme.colors.textPrimary }}>(x {quantity})</Text>
            </Text>
            <Text style={[{ flexShrink: 0, marginLeft: 8, color: theme.colors.textPrimary, ...theme.typography.body }]}>
              {price * quantity} TND
            </Text>
          </View>
          {originalPrice > 0 && originalPrice > price && (
            <View style={[styles.summaryRow, { marginTop: 4 }]}>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
                {t('reserve.originalPrice', { defaultValue: 'Original' })}
              </Text>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through' }]}>
                {originalPrice * quantity} TND
              </Text>
            </View>
          )}
          <View style={[styles.totalRow, { marginTop: theme.spacing.lg, paddingTop: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>{t('reserve.total')}</Text>
            <Text style={[{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const }]}>
              {price * quantity} TND
            </Text>
          </View>
        </View>

        {/* Payment Method — icons instead of emojis */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginBottom: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 12 }}>
            {t('reserve.paymentMethod')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={() => setPaymentMethod('cash')}
              style={{
                flex: 1,
                backgroundColor: paymentMethod === 'cash' ? theme.colors.primary + '12' : theme.colors.bg,
                borderRadius: theme.radii.r16,
                padding: 16,
                borderWidth: paymentMethod === 'cash' ? 2 : 1,
                borderColor: paymentMethod === 'cash' ? theme.colors.primary : theme.colors.divider,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              accessibilityLabel={t('reserve.payCash', { defaultValue: 'Pay in Cash' })}
              accessibilityRole="radio"
              accessibilityState={{ selected: paymentMethod === 'cash' }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: paymentMethod === 'cash' ? theme.colors.primary + '18' : theme.colors.divider + '60', justifyContent: 'center', alignItems: 'center' }}>
                <Banknote size={24} color={paymentMethod === 'cash' ? theme.colors.primary : theme.colors.textSecondary} />
              </View>
              <Text style={{ color: paymentMethod === 'cash' ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
                {t('reserve.payCash', { defaultValue: 'Pay in Cash' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                {t('reserve.payCashDesc', { defaultValue: 'Pay the merchant at pickup' })}
              </Text>
            </TouchableOpacity>
            {FeatureFlags.ENABLE_CARD_PAYMENT && (
              <TouchableOpacity
                onPress={() => setPaymentMethod('card')}
                style={{
                  flex: 1,
                  backgroundColor: paymentMethod === 'card' ? theme.colors.primary + '12' : theme.colors.bg,
                  borderRadius: theme.radii.r16,
                  padding: 16,
                  borderWidth: paymentMethod === 'card' ? 2 : 1,
                  borderColor: paymentMethod === 'card' ? theme.colors.primary : theme.colors.divider,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityLabel={t('reserve.payCard', { defaultValue: 'Pay by Card' })}
                accessibilityRole="radio"
                accessibilityState={{ selected: paymentMethod === 'card' }}
              >
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: paymentMethod === 'card' ? theme.colors.primary + '18' : theme.colors.divider + '60', justifyContent: 'center', alignItems: 'center' }}>
                  <CreditCard size={24} color={paymentMethod === 'card' ? theme.colors.primary : theme.colors.textSecondary} />
                </View>
                <Text style={{ color: paymentMethod === 'card' ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
                  {t('reserve.payCard', { defaultValue: 'Pay by Card' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                  {t('reserve.payCardDesc', { defaultValue: 'Secure card payment' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider, ...theme.shadows.shadowLg }]}>
        <PrimaryCTAButton
          compact
          onPress={handleConfirm}
          title={
            totalAvailable <= 0
              ? t('basket.soldOut')
              : !isPickupWindowOpen()
              ? t('orders.status.expired', { defaultValue: 'Expired' })
              : t('reserve.confirmReservation')
          }
          disabled={totalAvailable <= 0 || !isPickupWindowOpen()}
          loading={reserveMutation.isPending}
        />
      </View>

      {/* Custom confirmation modal (replaces Alert.alert) */}
      <Modal visible={showConfirmModal} transparent animationType="fade" onRequestClose={() => setShowConfirmModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340, ...theme.shadows.shadowLg }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary + '14', justifyContent: 'center', alignItems: 'center' }}>
                <AlertTriangle size={28} color={theme.colors.primary} />
              </View>
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 12 }}>
              {t('reserve.confirmTitle', { defaultValue: 'Confirm Reservation' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 8 }}>
              {t('reserve.cashWarningIntro', { defaultValue: 'Ready to pick up this basket?\n\nIf your plans change, please cancel early, it frees up the spot for someone else.' })}
            </Text>
            <View style={{ backgroundColor: theme.colors.error + '12', borderRadius: 12, padding: 12, marginBottom: 24, borderLeftWidth: 3, borderLeftColor: theme.colors.error }}>
              <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, fontWeight: '700', textAlign: 'center', lineHeight: 20 }}>
                {t('reserve.cashWarningBan', { defaultValue: 'Repeated no shows without cancelling may lead to a temporary pause on your reservations.' })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowConfirmModal(false)}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center' }}
                accessibilityLabel={t('reserve.notYet', { defaultValue: 'Not Yet' })}
                accessibilityRole="button"
              >
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, fontWeight: '600' }}>
                  {t('reserve.notYet', { defaultValue: 'Not Yet' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmAndReserve}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.colors.primary, alignItems: 'center' }}
                accessibilityLabel={t('reserve.yesReserve', { defaultValue: 'Reserve!' })}
                accessibilityRole="button"
              >
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                  {t('reserve.yesReserve', { defaultValue: 'Reserve!' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom error modal (replaces Alert.alert for errors) */}
      <Modal visible={!!errorMessage} transparent animationType="fade" onRequestClose={() => setErrorMessage(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.error + '14', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <X size={28} color={theme.colors.error} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('reserve.error')}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 24 }}>
              {errorMessage}
            </Text>
            <TouchableOpacity
              onPress={() => setErrorMessage(null)}
              style={{ paddingVertical: 14, paddingHorizontal: 40, borderRadius: 14, backgroundColor: theme.colors.primary }}
              accessibilityLabel="OK"
              accessibilityRole="button"
            >
              <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Full-screen confirmation Modal with Barakeat bouncing animation */}
      <Modal
        visible={showConfirmation}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { dismissConfirmAndNavigate(); }}
      >
        <View style={{ flex: 1, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
          {/* Phase 1: Processing animation */}
          {confirmPhase === 'bouncing' ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <View style={{ flexDirection: 'row' }}>
                {BARAKEAT.map((letter, i) => (
                  <Animated.Text
                    key={i}
                    style={{
                      color: '#fff',
                      fontSize: 36,
                      fontWeight: '700',
                      fontFamily: 'Poppins_700Bold',
                      transform: [{ translateY: letterAnims[i] }],
                    }}
                  >
                    {letter}
                  </Animated.Text>
                ))}
                <Text style={{ color: '#e3ff5c', fontSize: 36, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>.</Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.body, marginTop: 16 }}>
                {t('reserve.processing', { defaultValue: 'Traitement de votre réservation...' })}
              </Text>
            </View>

          ) : confirmPhase === 'success' ? (
            /* Phase 2: Confirmed with paper bag */
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setConfirmPhase('details')}
              style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}
            >
              <Image
                source={require('@/assets/images/barakeat_paper_bag.png')}
                style={{ width: 140, height: 140, marginBottom: 24 }}
                resizeMode="cover"
              />
              <View style={{ backgroundColor: '#e3ff5c', width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
                <Check size={28} color="#114b3c" />
              </View>
              <Text style={{ color: '#e3ff5c', fontSize: 22, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {t('reserve.confirmed', { defaultValue: 'Réservation confirmée !' })}
              </Text>
              {confirmData?.locationName ? (
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 8 }}>
                  {confirmData.locationName}
                </Text>
              ) : null}
              <Text style={{ color: 'rgba(255,255,255,0.4)', ...theme.typography.caption, marginTop: 16 }}>
                {t('reserve.tapToContinue', { defaultValue: 'Appuyez pour voir les détails' })}
              </Text>
            </TouchableOpacity>

          ) : (
            /* Phase 3: Details with code, QR, pickup info */
            <>
              <ScrollView contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                {confirmData?.basketImageUrl ? (
                  <Image source={{ uri: confirmData.basketImageUrl }} style={{ width: 64, height: 64, borderRadius: 16, marginBottom: 16, borderWidth: 2, borderColor: '#e3ff5c' }} resizeMode="cover" />
                ) : (
                  <View style={{ backgroundColor: '#e3ff5c', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                    <ShoppingBag size={28} color="#114b3c" />
                  </View>
                )}
                <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {t('reserve.success.title', { defaultValue: 'Order Confirmed!' })}
                </Text>
                {confirmData?.locationName ? (
                  <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 4 }}>
                    {confirmData.locationName}
                  </Text>
                ) : null}

                {/* Pickup code card */}
                <View style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 24, padding: 24, marginTop: 28, width: '100%', alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.caption, textAlign: 'center', marginBottom: 8 }}>
                    {t('reserve.success.pickupCode', { defaultValue: 'Pickup Code' })}
                  </Text>

                  {/* Code display with copy button */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <View style={{ backgroundColor: 'rgba(227,255,92,0.15)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 24 }}>
                      <Text style={{ color: '#e3ff5c', fontSize: 30, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 6, textAlign: 'center' }}>
                        {confirmData?.pickupCode}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={handleCopyCode}
                      style={{ backgroundColor: codeCopied ? 'rgba(227,255,92,0.3)' : 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 12 }}
                      accessibilityLabel={codeCopied ? t('reserve.success.copied', { defaultValue: 'Copied' }) : t('reserve.success.copyCode', { defaultValue: 'Copy pickup code' })}
                      accessibilityRole="button"
                    >
                      {codeCopied ? <Check size={20} color="#e3ff5c" /> : <Copy size={20} color="#fff" />}
                    </TouchableOpacity>
                  </View>

                  {/* QR Code */}
                  {confirmData?.qrCodeUrl ? (
                    <View style={{ alignItems: 'center', marginBottom: 16 }}>
                      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 12 }}>
                        <Image source={{ uri: confirmData.qrCodeUrl }} style={{ width: 160, height: 160 }} resizeMode="contain" />
                      </View>
                      <Text style={{ color: 'rgba(255,255,255,0.5)', ...theme.typography.caption, textAlign: 'center', marginTop: 8 }}>
                        {t('reserve.success.scanQR', { defaultValue: 'Show this QR to the merchant' })}
                      </Text>
                    </View>
                  ) : null}

                  {/* Share button */}
                  <TouchableOpacity
                    onPress={handleShareQR}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 20 }}
                  >
                    <Download size={16} color="#fff" />
                    <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }}>
                      {t('reserve.shareCode', { defaultValue: 'Share pickup info' })}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Pickup details card */}
                <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 20, marginTop: 16, width: '100%', gap: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.bodySm }}>{t('reserve.when', { defaultValue: 'When' })}</Text>
                    <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }}>{confirmData?.pickupStart} - {confirmData?.pickupEnd}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.bodySm }}>{t('reserve.where', { defaultValue: 'Where' })}</Text>
                    <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: 16 }} numberOfLines={2}>{confirmData?.address || ''}</Text>
                  </View>
                </View>

                {/* Go to orders — the only action */}
                <TouchableOpacity
                  onPress={() => { dismissConfirmAndNavigate(); }}
                  style={{ backgroundColor: '#e3ff5c', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 24, width: '100%' }}
                  accessibilityLabel={t('reserve.goToOrders', { defaultValue: 'Mes commandes' })}
                  accessibilityRole="button"
                >
                  <Text style={{ color: '#114b3c', ...theme.typography.body, fontWeight: '700', fontSize: 16 }}>
                    {t('reserve.goToOrders', { defaultValue: 'Mes commandes' })}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  content: { flex: 1 },
  section: {},
  quantitySelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quantityButton: {},
  quantityText: {},
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footer: {},
});
