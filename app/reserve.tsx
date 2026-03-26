import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, ActivityIndicator, Image, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Minus, Plus, Banknote, CreditCard, Check, AlertTriangle } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchBasketsByLocation } from '@/src/services/baskets';
import { createReservation, fetchReservationQRCode } from '@/src/services/reservations';
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

  // Fetch location info
  const locationQuery = useQuery({
    queryKey: ['location', basketId],
    queryFn: () => fetchLocationById(String(basketId)),
    enabled: !!basketId,
  });

  // Fetch actual baskets for this location to get correct quantity
  const basketsQuery = useQuery({
    queryKey: ['baskets-by-location', basketId],
    queryFn: () => fetchBasketsByLocation(String(basketId)),
    enabled: !!basketId,
  });

  const location = locationQuery.data;
  const locationName = location?.display_name ?? location?.name ?? '';
  const address = location?.address ?? '';
  const pickupStart = location?.pickup_start_time?.substring(0, 5) ?? '';
  const pickupEnd = location?.pickup_end_time?.substring(0, 5) ?? '';

  // Compute quantity and price from actual baskets
  const rawBaskets = basketsQuery.data ?? [];
  const totalAvailable = rawBaskets.reduce((sum, b: any) => sum + (Number(b.quantity) || 0), 0);
  const minPrice = rawBaskets.length > 0
    ? Math.min(...rawBaskets.map((b: any) => Number(b.selling_price || 0)).filter(p => p > 0))
    : Number(location?.price_tier ?? location?.min_basket_price ?? 0);
  const minOriginal = rawBaskets.length > 0
    ? Math.min(...rawBaskets.map((b: any) => Number(b.original_price || 0)).filter(p => p > 0))
    : Number(location?.original_price ?? 0);
  const price = isFinite(minPrice) ? minPrice : 0;
  const originalPrice = isFinite(minOriginal) ? minOriginal : 0;

  const reserveMutation = useMutation({
    mutationFn: () => createReservation({ location_id: Number(basketId), quantity }),
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
      void queryClient.invalidateQueries({ queryKey: ['location', basketId] });
      void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', basketId] });
      void queryClient.invalidateQueries({ queryKey: ['basket', basketId] });

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
      setTimeout(() => setConfirmPhase('confirmed'), 3000);
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

  if (locationQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!location) {
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
                <View style={{ backgroundColor: '#e3ff5c', width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
                  <Check size={40} color="#114b3c" />
                </View>
                <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {t('reserve.success.title', { defaultValue: 'Order Confirmed!' })}
                </Text>

                <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 24, marginTop: 32, marginHorizontal: 32, width: '85%', alignItems: 'center' }}>
                  {confirmData?.qrCodeUrl ? (
                    <>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption, textAlign: 'center', marginBottom: 12 }}>
                        {t('reserve.success.scanQR', { defaultValue: 'Show this QR to the merchant' })}
                      </Text>
                      <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 8, marginBottom: 16 }}>
                        <Image source={{ uri: confirmData.qrCodeUrl }} style={{ width: 180, height: 180 }} resizeMode="contain" />
                      </View>
                    </>
                  ) : null}

                  <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption, textAlign: 'center' }}>
                    {t('reserve.success.pickupCode', { defaultValue: 'Pickup Code' })}
                  </Text>
                  <Text style={{ color: '#e3ff5c', fontSize: 32, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', letterSpacing: 6, marginTop: 8 }}>
                    {confirmData?.pickupCode}
                  </Text>

                  <View style={{ marginTop: 20, gap: 12, alignSelf: 'stretch' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.bodySm }}>{t('reserve.when', { defaultValue: 'When' })}</Text>
                      <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }}>{confirmData?.pickupStart} - {confirmData?.pickupEnd}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.bodySm }}>{t('reserve.where', { defaultValue: 'Where' })}</Text>
                      <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }} numberOfLines={1}>{confirmData?.address || ''}</Text>
                    </View>
                  </View>

                  <Text style={{ color: 'rgba(255,255,255,0.5)', ...theme.typography.caption, textAlign: 'center', marginTop: 16 }}>
                    {t('reserve.success.showThisCode', { defaultValue: 'Show this code to the merchant at pickup' })}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => { setShowConfirmation(false); router.replace('/(tabs)/orders' as never); }}
                  style={{ backgroundColor: '#e3ff5c', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 48, marginTop: 32 }}
                >
                  <Text style={{ color: '#114b3c', ...theme.typography.button, fontWeight: '700' }}>
                    {t('reserve.done', { defaultValue: 'Done' })}
                  </Text>
                </TouchableOpacity>
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
