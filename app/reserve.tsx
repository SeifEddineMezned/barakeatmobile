import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Minus, Plus, CreditCard, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchRestaurantById } from '@/src/services/restaurants';
import { normalizeRestaurantToBasket } from '@/src/utils/normalizeRestaurant';
import { createReservation, fetchReservationQRCode } from '@/src/services/reservations';
import { getErrorMessage } from '@/src/lib/api';

export default function ReserveScreen() {
  const { basketId } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');

  // Confirmation animation state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmPhase, setConfirmPhase] = useState<'bouncing' | 'confirmed'>('bouncing');
  const [confirmData, setConfirmData] = useState<{ pickupCode: string; pickupStart: string; pickupEnd: string; address: string } | null>(null);

  // Letter bounce animations
  const BARAKEAT = 'Barakeat'.split('');
  const letterAnims = React.useRef(BARAKEAT.map(() => new Animated.Value(0))).current;

  const startBouncingAnimation = () => {
    // Reset all
    letterAnims.forEach(a => a.setValue(0));

    // Stagger bounce each letter
    const animations = letterAnims.map((anim, i) =>
      Animated.sequence([
        Animated.delay(i * 100),
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: -15, duration: 200, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]),
          { iterations: 3 }
        ),
      ])
    );

    Animated.parallel(animations).start();

    // After 3 seconds, switch to confirmed phase
    setTimeout(() => {
      setConfirmPhase('confirmed');
    }, 3000);
  };

  const restaurantQuery = useQuery({
    queryKey: ['restaurant', basketId],
    queryFn: () => fetchRestaurantById(String(basketId)),
    enabled: !!basketId,
  });

  const basket = restaurantQuery.data ? normalizeRestaurantToBasket(restaurantQuery.data) : null;

  const reserveMutation = useMutation({
    mutationFn: () => createReservation({ restaurant_id: Number(basketId), quantity }),
    onSuccess: async (data) => {
      console.log('[Reserve] Reservation created:', data.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const pickupCode = data.pickupCode ?? data.pickup_code ?? data.id?.substring(0, 6)?.toUpperCase() ?? '------';

      setConfirmData({
        pickupCode,
        pickupStart: basket?.pickupWindow.start ?? '',
        pickupEnd: basket?.pickupWindow.end ?? '',
        address: basket?.address ?? '',
      });
      setShowConfirmation(true);
      setConfirmPhase('bouncing');
      startBouncingAnimation();

      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['restaurants'] });
      void queryClient.invalidateQueries({ queryKey: ['restaurant', basketId] });
    },
    onError: (err) => {
      const msg = getErrorMessage(err);
      console.log('[Reserve] Error:', msg);
      Alert.alert(t('reserve.error'), msg);
    },
  });

  // Respect maxPerCustomer limit if set, otherwise just use quantityLeft
  const maxQuantity = basket
    ? Math.min(basket.quantityLeft, basket.maxPerCustomer ?? basket.quantityLeft)
    : 1;

  const handleIncrement = () => {
    if (basket && quantity < maxQuantity) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setQuantity((prev) => prev + 1);
    }
  };

  const handleDecrement = () => {
    if (quantity > 1) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setQuantity((prev) => prev - 1);
    }
  };

  const submitReservation = () => {
    reserveMutation.mutate();
  };

  const handleConfirm = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (paymentMethod === 'cash') {
      Alert.alert(
        t('reserve.confirmTitle', { defaultValue: 'Confirm Reservation' }),
        t('reserve.cashWarning', { defaultValue: 'Ready to pick up this basket?\n\nIf your plans change, please cancel early \u2014 it frees up the spot for someone else.\n\nHeads up: repeated no-shows without cancelling may lead to a temporary pause on your reservations.' }),
        [
          { text: t('reserve.notYet', { defaultValue: 'Not Yet' }), style: 'cancel' },
          { text: t('reserve.yesReserve', { defaultValue: 'Yes, Reserve!' }), onPress: submitReservation },
        ]
      );
    } else {
      submitReservation();
    }
  };

  if (restaurantQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!basket) {
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
      <View style={[styles.header, { padding: theme.spacing.xl }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('reserve.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl }]}>
        <Text
          style={[
            {
              color: theme.colors.textPrimary,
              ...theme.typography.h3,
              marginBottom: theme.spacing.lg,
            },
          ]}
        >
          {basket.name}
        </Text>

        <View
          style={[
            styles.section,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginBottom: theme.spacing.lg }]}>
            {t('reserve.quantity')}
          </Text>
          <View style={styles.quantitySelector}>
            <TouchableOpacity
              style={[
                styles.quantityButton,
                {
                  backgroundColor: theme.colors.bg,
                  borderRadius: theme.radii.r12,
                  width: 48,
                  height: 48,
                  justifyContent: 'center',
                  alignItems: 'center',
                },
              ]}
              onPress={handleDecrement}
              disabled={quantity <= 1}
            >
              <Minus size={20} color={quantity <= 1 ? theme.colors.muted : theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.quantityText, { color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
              {quantity}
            </Text>
            <TouchableOpacity
              style={[
                styles.quantityButton,
                {
                  backgroundColor: theme.colors.bg,
                  borderRadius: theme.radii.r12,
                  width: 48,
                  height: 48,
                  justifyContent: 'center',
                  alignItems: 'center',
                },
              ]}
              onPress={handleIncrement}
              disabled={quantity >= maxQuantity}
            >
              <Plus
                size={20}
                color={quantity >= maxQuantity ? theme.colors.muted : theme.colors.textPrimary}
              />
            </TouchableOpacity>
          </View>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: theme.spacing.md }]}>
            {t('reserve.basketsLeft', { count: basket.quantityLeft })}
          </Text>
        </View>

        <View
          style={[
            styles.section,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
            {t('reserve.summary')}
          </Text>
          <View style={styles.summaryRow}>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body }]}>
              {basket.name} × {quantity}
            </Text>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body }]}>
              {basket.discountedPrice * quantity} TND
            </Text>
          </View>
          <View
            style={[
              styles.totalRow,
              { marginTop: theme.spacing.lg, paddingTop: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider },
            ]}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>{t('reserve.total')}</Text>
            <Text style={[{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const }]}>
              {basket.discountedPrice * quantity} TND
            </Text>
          </View>
        </View>

        {/* Payment Method Selection */}
        <View
          style={[
            styles.section,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
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
              <Text style={{ fontSize: 24 }}>💵</Text>
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
              <Text style={{ fontSize: 24 }}>💳</Text>
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

      <View
        style={[
          styles.footer,
          {
            backgroundColor: theme.colors.surface,
            paddingHorizontal: theme.spacing.xl,
            paddingVertical: theme.spacing.lg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            ...theme.shadows.shadowLg,
          },
        ]}
      >
        <PrimaryCTAButton onPress={handleConfirm} title={t('reserve.confirmReservation')} loading={reserveMutation.isPending} />
      </View>

      {/* Full-screen confirmation overlay */}
      {showConfirmation && (
        <View style={StyleSheet.absoluteFillObject}>
          <View style={{
            flex: 1,
            backgroundColor: '#114b3c',
            justifyContent: 'center',
            alignItems: 'center',
          }}>
            {confirmPhase === 'bouncing' ? (
              <>
                {/* Bouncing Barakeat text */}
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
                {/* Confirmed phase */}
                <View style={{
                  backgroundColor: '#e3ff5c',
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 24,
                }}>
                  <Text style={{ fontSize: 36 }}>✓</Text>
                </View>
                <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {t('reserve.success.title', { defaultValue: 'Order Confirmed!' })}
                </Text>

                {/* Pickup details card */}
                <View style={{
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  borderRadius: 20,
                  padding: 24,
                  marginTop: 32,
                  marginHorizontal: 32,
                  width: '85%',
                }}>
                  <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption, textAlign: 'center' }}>
                    {t('reserve.success.pickupCode', { defaultValue: 'Pickup Code' })}
                  </Text>
                  <Text style={{
                    color: '#e3ff5c',
                    fontSize: 32,
                    fontWeight: '700',
                    fontFamily: 'Poppins_700Bold',
                    textAlign: 'center',
                    letterSpacing: 6,
                    marginTop: 8,
                  }}>
                    {confirmData?.pickupCode}
                  </Text>

                  <View style={{ marginTop: 20, gap: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.bodySm }}>
                        {t('reserve.when', { defaultValue: 'When' })}
                      </Text>
                      <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }}>
                        {confirmData?.pickupStart} - {confirmData?.pickupEnd}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.bodySm }}>
                        {t('reserve.where', { defaultValue: 'Where' })}
                      </Text>
                      <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }} numberOfLines={1}>
                        {confirmData?.address || t('reserve.seeMap', { defaultValue: 'See map' })}
                      </Text>
                    </View>
                  </View>

                  <Text style={{ color: 'rgba(255,255,255,0.5)', ...theme.typography.caption, textAlign: 'center', marginTop: 16 }}>
                    {t('reserve.success.showThisCode', { defaultValue: 'Show this code to the merchant at pickup' })}
                  </Text>
                </View>

                {/* Done button */}
                <TouchableOpacity
                  onPress={() => {
                    setShowConfirmation(false);
                    router.back();
                    router.back(); // go back past basket detail too
                  }}
                  style={{
                    backgroundColor: '#e3ff5c',
                    borderRadius: 16,
                    paddingVertical: 16,
                    paddingHorizontal: 48,
                    marginTop: 32,
                  }}
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
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  section: {},
  quantitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quantityButton: {},
  quantityText: {},
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footer: {},
});
