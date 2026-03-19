import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Minus, Plus, CreditCard, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchBasketById } from '@/src/services/baskets';
import { createReservation, fetchReservationQRCode } from '@/src/services/reservations';
import { getErrorMessage } from '@/src/lib/api';
import type { Basket } from '@/src/types';

function normalizeBasket(raw: any): Basket {
  return {
    id: String(raw.id ?? raw._id ?? ''),
    merchantId: raw.merchantId ?? raw.merchant_id ?? '',
    merchantName: raw.merchantName ?? raw.merchant_name ?? raw.businessName ?? 'Unknown',
    merchantLogo: raw.merchantLogo ?? raw.merchant_logo ?? undefined,
    merchantRating: raw.merchantRating ?? raw.merchant_rating ?? undefined,
    reviewCount: raw.reviewCount ?? raw.review_count ?? undefined,
    reviews: raw.reviews ?? undefined,
    description: raw.description ?? undefined,
    name: raw.name ?? raw.title ?? 'Basket',
    category: raw.category ?? '',
    originalPrice: Number(raw.originalPrice ?? raw.original_price ?? raw.price ?? 0),
    discountedPrice: Number(raw.discountedPrice ?? raw.discounted_price ?? raw.salePrice ?? 0),
    discountPercentage: Number(raw.discountPercentage ?? raw.discount_percentage ?? 50),
    pickupWindow: raw.pickupWindow ?? raw.pickup_window ?? { start: '18:00', end: '19:00' },
    quantityLeft: Number(raw.quantityLeft ?? raw.quantity_left ?? raw.quantity ?? 0),
    quantityTotal: Number(raw.quantityTotal ?? raw.quantity_total ?? 0),
    distance: Number(raw.distance ?? 0),
    address: raw.address ?? '',
    latitude: Number(raw.latitude ?? 36.8065),
    longitude: Number(raw.longitude ?? 10.1815),
    exampleItems: raw.exampleItems ?? raw.example_items ?? [],
    imageUrl: raw.imageUrl ?? raw.image_url ?? undefined,
    isActive: raw.isActive ?? true,
    isSupermarket: raw.isSupermarket ?? false,
  };
}

export default function ReserveScreen() {
  const { basketId } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [showSuccess, setShowSuccess] = useState(false);
  const [reservationResult, setReservationResult] = useState<{ id: string; pickupCode?: string; qrCode?: string } | null>(null);

  const confettiAnim = React.useRef(new Animated.Value(0)).current;

  const basketQuery = useQuery({
    queryKey: ['basket', basketId],
    queryFn: () => fetchBasketById(String(basketId)),
    enabled: !!basketId,
  });

  const basket = basketQuery.data ? normalizeBasket(basketQuery.data) : null;

  const reserveMutation = useMutation({
    mutationFn: () => createReservation({ basketId: String(basketId), quantity }),
    onSuccess: async (data) => {
      console.log('[Reserve] Reservation created:', data.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      let qrCode = data.qrCode ?? '';
      if (!qrCode && data.id) {
        try {
          qrCode = await fetchReservationQRCode(data.id);
        } catch (err) {
          console.log('[Reserve] Could not fetch QR code:', err);
        }
      }

      setReservationResult({
        id: data.id,
        pickupCode: data.pickupCode ?? data.id?.substring(0, 6)?.toUpperCase(),
        qrCode,
      });
      setShowSuccess(true);

      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['basket', basketId] });

      Animated.sequence([
        Animated.timing(confettiAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(confettiAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();
    },
    onError: (err) => {
      const msg = getErrorMessage(err);
      console.log('[Reserve] Error:', msg);
      Alert.alert(t('reserve.error'), msg);
    },
  });

  const handleIncrement = () => {
    if (basket && quantity < basket.quantityLeft) {
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

  const handleConfirm = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    reserveMutation.mutate();
  };

  const handleViewOrder = () => {
    router.replace('/(tabs)/orders' as never);
  };

  if (basketQuery.isLoading) {
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

  if (showSuccess && reservationResult) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <View style={styles.successContainer}>
          <View style={[styles.successHeader, { padding: theme.spacing.xl }]}>
            <TouchableOpacity onPress={() => router.back()}>
              <X size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.successContent}>
            <Animated.View
              style={{
                transform: [
                  {
                    scale: confettiAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.8, 1.2],
                    }),
                  },
                ],
                opacity: confettiAnim,
              }}
            >
              <View
                style={[
                  styles.successIcon,
                  {
                    backgroundColor: theme.colors.secondary,
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    justifyContent: 'center',
                    alignItems: 'center',
                  },
                ]}
              >
                <Check size={40} color={theme.colors.surface} />
              </View>
            </Animated.View>

            <Text
              style={[
                styles.successTitle,
                {
                  color: theme.colors.textPrimary,
                  ...theme.typography.h1,
                  marginTop: theme.spacing.xxl,
                  marginBottom: theme.spacing.md,
                  textAlign: 'center',
                },
              ]}
            >
              {t('reserve.success.title')}
            </Text>

            <View
              style={[
                styles.pickupCodeCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r16,
                  padding: theme.spacing.xxl,
                  marginTop: theme.spacing.xl,
                  ...theme.shadows.shadowMd,
                },
              ]}
            >
              <Text
                style={[
                  {
                    color: theme.colors.textSecondary,
                    ...theme.typography.bodySm,
                    textAlign: 'center',
                    marginBottom: theme.spacing.md,
                  },
                ]}
              >
                {t('reserve.success.pickupCode')}
              </Text>
              <Text
                style={[
                  styles.pickupCodeText,
                  {
                    color: theme.colors.primary,
                    ...theme.typography.display,
                    textAlign: 'center',
                    letterSpacing: 4,
                  },
                ]}
              >
                {reservationResult.pickupCode}
              </Text>
              <Text
                style={[
                  {
                    color: theme.colors.textSecondary,
                    ...theme.typography.caption,
                    textAlign: 'center',
                    marginTop: theme.spacing.md,
                  },
                ]}
              >
                {t('reserve.success.showThisCode')}
              </Text>
            </View>

            <View style={[styles.successActions, { marginTop: theme.spacing.xxxl }]}>
              <PrimaryCTAButton onPress={handleViewOrder} title={t('reserve.success.viewOrder')} />
            </View>
          </View>
        </View>
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
              disabled={quantity >= basket.quantityLeft}
            >
              <Plus
                size={20}
                color={quantity >= basket.quantityLeft ? theme.colors.muted : theme.colors.textPrimary}
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

        <View
          style={[
            styles.paymentSection,
            {
              backgroundColor: theme.colors.discountBg,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
              borderWidth: 2,
              borderColor: theme.colors.discount,
            },
          ]}
        >
          <View style={styles.paymentHeader}>
            <CreditCard size={24} color={theme.colors.discount} />
            <Text
              style={[
                {
                  color: theme.colors.discount,
                  ...theme.typography.h3,
                  marginLeft: theme.spacing.md,
                },
              ]}
            >
              {t('reserve.paymentMethod')}
            </Text>
          </View>
          <Text
            style={[
              {
                color: theme.colors.textPrimary,
                ...theme.typography.h3,
                marginTop: theme.spacing.md,
                marginBottom: theme.spacing.sm,
              },
            ]}
          >
            {t('basket.payOnPickup')}
          </Text>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body }]}>
            {t('reserve.payOnPickupNote')}
          </Text>
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
  paymentSection: {},
  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footer: {},
  successContainer: {
    flex: 1,
  },
  successHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  successContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successIcon: {},
  successTitle: {},
  pickupCodeCard: {
    width: '100%',
  },
  pickupCodeText: {},
  successActions: {
    width: '100%',
  },
});
