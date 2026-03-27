import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, ActivityIndicator, Image, Modal, Share, Easing } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Minus, Plus, Banknote, CreditCard, Check, AlertTriangle, Copy, Download, Zap, Flame, Trophy } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchBasketById, fetchBasketsByLocation } from '@/src/services/baskets';
import { createReservation, fetchReservationQRCode } from '@/src/services/reservations';
import { updateStreak, fetchGamificationStats, type StreakUpdateResult } from '@/src/services/gamification';
// import { scheduleLocalNotification } from '@/src/services/pushNotifications';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';

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
  const [confirmPhase, setConfirmPhase] = useState<'bouncing' | 'confirmed'>('bouncing');
  const [confirmData, setConfirmData] = useState<{ pickupCode: string; pickupStart: string; pickupEnd: string; address: string; qrCodeUrl?: string } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [streakData, setStreakData] = useState<StreakUpdateResult | null>(null);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const xpBarAnim = React.useRef(new Animated.Value(0)).current;
  const levelUpScale = React.useRef(new Animated.Value(0)).current;

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
    const animations = letterAnims.map((anim, i) =>
      Animated.sequence([
        Animated.delay(i * 100),
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: -15, duration: 200, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]),
          { iterations: -1 }
        ),
      ])
    );
    Animated.parallel(animations).start();
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

  // ── Step 4: Fetch sibling baskets for quantity/price — same guard ──
  const basketsQuery = useQuery({
    queryKey: ['baskets-by-location', resolvedLocationId],
    queryFn: () => fetchBasketsByLocation(String(resolvedLocationId)),
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

  // Compute quantity and price from sibling baskets; fall back to selected basket
  const rawBaskets = basketsQuery.data ?? [];
  const totalAvailable = rawBaskets.length > 0
    ? rawBaskets.reduce((sum, b: any) => sum + (Number(b.quantity) || 0), 0)
    : Number(rawBasketData?.quantity ?? 0);
  const minPrice = rawBaskets.length > 0
    ? Math.min(...rawBaskets.map((b: any) => Number(b.selling_price || 0)).filter(p => p > 0))
    : Number(rawBasketData?.selling_price ?? location?.price_tier ?? location?.min_basket_price ?? 0);
  const minOriginal = rawBaskets.length > 0
    ? Math.min(...rawBaskets.map((b: any) => Number(b.original_price || 0)).filter(p => p > 0))
    : Number(rawBasketData?.original_price ?? location?.original_price ?? 0);
  const price = isFinite(minPrice) ? minPrice : 0;
  const originalPrice = isFinite(minOriginal) ? minOriginal : 0;

  const reserveMutation = useMutation({
    // Use the real resolved id, not the basket id
    mutationFn: () => createReservation({ location_id: Number(resolvedLocationId), quantity }),
    onSuccess: async (data) => {
      console.log('[Reserve] Reservation created:', data.id);
      const pickupCode = data.pickup_code ?? data.pickupCode ?? '';

      setConfirmData({ pickupCode, pickupStart, pickupEnd, address });
      setShowConfirmation(true);
      setConfirmPhase('bouncing');
      startBouncingAnimation();

      // Only invalidate customer-side queries (not business-side like today-orders)
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      void queryClient.invalidateQueries({ queryKey: ['location', resolvedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', resolvedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['basket', basketId] });
      void queryClient.invalidateQueries({ queryKey: ['gamification-stats'] });

      // Update streak
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

      // Fetch QR code
      if (data.id) {
        try {
          const qrCodeUrl = await fetchReservationQRCode(String(data.id));
          if (qrCodeUrl) {
            setConfirmData((prev) => prev ? { ...prev, qrCodeUrl } : prev);
          }
        } catch (qrErr) {
          console.log('[Reserve] QR fetch failed (non-critical):', qrErr);
        }
      }

      // Transition to confirmed after 3 seconds
      setTimeout(() => {
        setConfirmPhase('confirmed');

        // Animate XP bar after confirmed phase renders
        setTimeout(() => {
          const gamData = gamificationQuery.data as any;
          const currentXp = gamData?.xp ?? 0;
          const currentLevel = gamData?.level ?? 1;
          const xpGained = (quantity ?? 1) * 10;
          const XP_THRESHOLDS = [0, 50, 120, 210, 320, 450, 600, 800, 1050, 1350, 1700, 2100, 2600, 3200, 3900, 4700, 5600, 6600, 7700, 9000];
          const currentLevelThreshold = XP_THRESHOLDS[currentLevel - 1] ?? 0;
          const nextLevelThreshold = XP_THRESHOLDS[currentLevel] ?? (currentLevelThreshold + 500);
          const xpInLevel = currentXp - currentLevelThreshold;
          const xpNeeded = nextLevelThreshold - currentLevelThreshold;
          const pAfter = Math.max(0, Math.min(1, xpInLevel / xpNeeded));

          Animated.timing(xpBarAnim, {
            toValue: pAfter,
            duration: 800,
            useNativeDriver: false,
            easing: Easing.out(Easing.cubic),
          }).start();

          // Check if level up
          if (pAfter >= 1) {
            setTimeout(() => {
              setShowLevelUp(true);
              Animated.spring(levelUpScale, {
                toValue: 1,
                useNativeDriver: true,
                speed: 8,
                bounciness: 12,
              }).start();
            }, 900);
          }
        }, 500);
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

  const handleConfirm = () => {
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
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  // If basket fetch failed or returned no location id we cannot proceed
  if (basketQuery.isError || !resolvedLocationId || !location) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={[{ color: theme.colors.error, ...theme.typography.body }]}>{t('common.errorOccurred')}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={[{ color: theme.colors.primary, ...theme.typography.body }]}>{t('common.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <View style={[styles.header, { padding: theme.spacing.xl }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('reserve.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
          {locationName}
        </Text>

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
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body }]}>
              {locationName} x {quantity}
            </Text>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body }]}>
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
              }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: paymentMethod === 'cash' ? theme.colors.primary + '18' : theme.colors.divider + '60', justifyContent: 'center', alignItems: 'center' }}>
                <Banknote size={24} color={paymentMethod === 'cash' ? theme.colors.primary : theme.colors.textSecondary} />
              </View>
              <Text style={{ color: paymentMethod === 'cash' ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 8 }}>
                {t('reserve.payCash', { defaultValue: 'Pay in Cash' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                {t('reserve.payCashDesc', { defaultValue: 'Pay the merchant at pickup' })}
              </Text>
            </TouchableOpacity>
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
              }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: paymentMethod === 'card' ? theme.colors.primary + '18' : theme.colors.divider + '60', justifyContent: 'center', alignItems: 'center' }}>
                <CreditCard size={24} color={paymentMethod === 'card' ? theme.colors.primary : theme.colors.textSecondary} />
              </View>
              <Text style={{ color: paymentMethod === 'card' ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 8 }}>
                {t('reserve.payCard', { defaultValue: 'Pay by Card' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                {t('reserve.payCardDesc', { defaultValue: 'Coming soon' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider, ...theme.shadows.shadowLg }]}>
        <PrimaryCTAButton onPress={handleConfirm} title={t('reserve.confirmReservation')} loading={reserveMutation.isPending} />
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
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
              {t('reserve.cashWarning', { defaultValue: 'Ready to pick up this basket?\n\nIf your plans change, please cancel early — it frees up the spot for someone else.\n\nHeads up: repeated no-shows without cancelling may lead to a temporary pause on your reservations.' })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowConfirmModal(false)}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center' }}
              >
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, fontWeight: '600' }}>
                  {t('reserve.notYet', { defaultValue: 'Not Yet' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmAndReserve}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: theme.colors.primary, alignItems: 'center' }}
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
            >
              <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Full-screen confirmation overlay with Barakeat bouncing animation */}
      {showConfirmation && (
        <View style={StyleSheet.absoluteFillObject}>
          <View style={{ flex: 1, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
            {confirmPhase === 'bouncing' ? (
              <>
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
                  {t('reserve.processing', { defaultValue: 'Processing your reservation...' })}
                </Text>
              </>
            ) : (
              <>
              <ScrollView contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                <View style={{ backgroundColor: '#e3ff5c', width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
                  <Check size={36} color="#114b3c" />
                </View>
                <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {t('reserve.success.title', { defaultValue: 'Order Confirmed!' })}
                </Text>

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

                {/* Level Progress Card */}
                {(() => {
                  const gamData = gamificationQuery.data as any;
                  const currentXp = gamData?.xp ?? 0;
                  const currentLevel = gamData?.level ?? 1;
                  const xpGained = (quantity ?? 1) * 10;
                  const XP_THRESHOLDS = [0, 50, 120, 210, 320, 450, 600, 800, 1050, 1350, 1700, 2100, 2600, 3200, 3900, 4700, 5600, 6600, 7700, 9000];
                  const currentLevelThreshold = XP_THRESHOLDS[currentLevel - 1] ?? 0;
                  const nextLevelThreshold = XP_THRESHOLDS[currentLevel] ?? (currentLevelThreshold + 500);
                  const xpInLevel = currentXp - currentLevelThreshold;
                  const xpNeeded = nextLevelThreshold - currentLevelThreshold;

                  return (
                    <View style={{
                      backgroundColor: 'rgba(255,255,255,0.08)',
                      borderRadius: 16,
                      padding: 20,
                      marginHorizontal: 24,
                      marginTop: 20,
                      width: '100%',
                    }}>
                      {/* Level header */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Trophy size={18} color="#e3ff5c" />
                          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                            Level {currentLevel}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(227,255,92,0.15)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                          <Zap size={14} color="#e3ff5c" />
                          <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                            +{xpGained} XP
                          </Text>
                        </View>
                      </View>

                      {/* XP Progress Bar */}
                      <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 6, height: 12, overflow: 'hidden' }}>
                        <Animated.View style={{
                          height: '100%',
                          backgroundColor: '#e3ff5c',
                          borderRadius: 6,
                          width: xpBarAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        }} />
                      </View>

                      {/* XP text */}
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 6, textAlign: 'right' }}>
                        {xpInLevel}/{xpNeeded} XP
                      </Text>

                      {/* Streak display */}
                      {streakData && streakData.current_streak > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, backgroundColor: 'rgba(255,107,53,0.15)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start' }}>
                          <Flame size={14} color="#FF6B35" />
                          <Text style={{ color: '#FF6B35', fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold' }}>
                            {streakData.current_streak > (streakData as any).previous_streak
                              ? `Streak ${streakData.current_streak}!`
                              : `Streak ${streakData.current_streak}`}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })()}

                <TouchableOpacity
                  onPress={() => { setShowConfirmation(false); router.replace('/(tabs)/orders' as never); }}
                  style={{ backgroundColor: '#e3ff5c', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 48, marginTop: 20 }}
                >
                  <Text style={{ color: '#114b3c', ...theme.typography.button, fontWeight: '700' }}>
                    {t('reserve.done', { defaultValue: 'Done' })}
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              {/* Level Up Overlay */}
              {showLevelUp && (() => {
                const gamData = gamificationQuery.data as any;
                const currentLevel = gamData?.level ?? 1;
                return (
                  <Animated.View style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    justifyContent: 'center',
                    alignItems: 'center',
                    transform: [{ scale: levelUpScale }],
                  }}>
                    <View style={{ backgroundColor: '#114b3c', borderRadius: 24, padding: 32, alignItems: 'center', width: '80%' }}>
                      <Trophy size={48} color="#e3ff5c" />
                      <Text style={{ color: '#e3ff5c', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginTop: 16 }}>
                        Level Up!
                      </Text>
                      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', marginTop: 8 }}>
                        Level {currentLevel + 1}
                      </Text>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 8, textAlign: 'center' }}>
                        Keep saving food to unlock more rewards!
                      </Text>
                      <TouchableOpacity
                        onPress={() => setShowLevelUp(false)}
                        style={{ backgroundColor: '#e3ff5c', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 24 }}
                      >
                        <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                          Continue
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </Animated.View>
                );
              })()}
            </>
            )}
          </View>
        </View>
      )}
    </View>
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
