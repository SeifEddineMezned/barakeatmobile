import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Navigation, X as XIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import type { ReservationFromAPI } from '@/src/services/reservations';

interface ReservationCardProps {
  reservation: ReservationFromAPI;
  onCancel?: (id: string) => void;
  onHide?: (id: string) => void;
}

export function ReservationCard({ reservation, onCancel, onHide: _onHide }: ReservationCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const basket = reservation.basket;
  const merchantName = basket?.merchantName ?? (basket as any)?.merchant_name ?? (basket as any)?.businessName ?? 'Unknown';
  const basketName = basket?.name ?? (basket as any)?.title ?? '';
  const address = basket?.address ?? (basket as any)?.location?.address ?? '';
  const pickupWindow = reservation.pickupWindow ?? basket?.pickupWindow ?? (basket as any)?.pickup_window;
  const pickupCode = reservation.pickupCode ?? (reservation as any)?.pickup_code ?? reservation.id?.substring(0, 6)?.toUpperCase() ?? '';
  const quantity = reservation.quantity ?? 1;
  const total = reservation.total ?? 0;
  const status = (reservation.status ?? 'reserved').toLowerCase();
  const latitude = basket?.latitude ?? (basket as any)?.lat ?? 0;
  const longitude = basket?.longitude ?? (basket as any)?.lng ?? 0;

  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.98, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
  };

  const handleDirections = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (latitude && longitude) {
      const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
      const Linking = require('react-native').Linking;
      void Linking.openURL(url);
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'reserved':
      case 'pending':
      case 'confirmed':
        return theme.colors.primary;
      case 'ready':
        return theme.colors.secondary;
      case 'collected':
      case 'completed':
        return theme.colors.success;
      case 'cancelled':
      case 'expired':
        return theme.colors.error;
      default:
        return theme.colors.textSecondary;
    }
  };

  const getStatusLabel = () => {
    const key = `orders.status.${status}`;
    const translated = t(key);
    if (translated === key) {
      return status.charAt(0).toUpperCase() + status.slice(1);
    }
    return translated;
  };

  const isUpcoming = status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed';

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.r16,
          padding: theme.spacing.xl,
          marginBottom: theme.spacing.lg,
          ...theme.shadows.shadowMd,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <TouchableOpacity onPress={handlePress} activeOpacity={0.9}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {merchantName}
            </Text>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: getStatusColor() + '20',
                  borderRadius: theme.radii.r8,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.xs,
                  marginTop: theme.spacing.sm,
                  alignSelf: 'flex-start',
                },
              ]}
            >
              <Text style={[{ color: getStatusColor(), ...theme.typography.caption, fontWeight: '600' as const }]}>
                {getStatusLabel()}
              </Text>
            </View>
          </View>
          {isUpcoming && onCancel && (
            <TouchableOpacity
              onPress={() => onCancel(reservation.id)}
              style={[{ padding: 4 }]}
            >
              <XIcon size={18} color={theme.colors.error} />
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.divider, { marginVertical: theme.spacing.lg, backgroundColor: theme.colors.divider }]} />

        <View style={styles.details}>
          {pickupWindow && (
            <View style={[styles.row, { marginBottom: theme.spacing.md }]}>
              <Clock size={16} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: theme.spacing.sm }]}>
                {pickupWindow.start} - {pickupWindow.end}
              </Text>
            </View>
          )}

          {address ? (
            <View style={[styles.row, { marginBottom: theme.spacing.md }]}>
              <MapPin size={16} color={theme.colors.textSecondary} />
              <Text
                style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: theme.spacing.sm, flex: 1 }]}
                numberOfLines={1}
              >
                {address}
              </Text>
            </View>
          ) : null}

          {pickupCode ? (
            <View
              style={[
                styles.pickupCodeContainer,
                {
                  backgroundColor: theme.colors.primaryLight,
                  borderRadius: theme.radii.r12,
                  padding: theme.spacing.lg,
                  marginTop: theme.spacing.md,
                },
              ]}
            >
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.xs }]}>
                {t('orders.pickupCode')}
              </Text>
              <Text
                style={[{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const, letterSpacing: 2 }]}
              >
                {pickupCode}
              </Text>
            </View>
          ) : null}

          <View style={[styles.footer, { marginTop: theme.spacing.lg }]}>
            <View>
              {basketName ? (
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                  {basketName} × {quantity}
                </Text>
              ) : null}
              {total > 0 && (
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: theme.spacing.xs }]}>
                  {total} TND
                </Text>
              )}
            </View>

            {latitude !== 0 && longitude !== 0 && (
              <TouchableOpacity
                style={[
                  styles.directionsButton,
                  {
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.radii.r12,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                  },
                ]}
                onPress={handleDirections}
              >
                <Navigation size={16} color={theme.colors.surface} />
                <Text
                  style={[{ color: theme.colors.surface, ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: theme.spacing.sm }]}
                >
                  {t('basket.directions')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
  },
  statusBadge: {},
  divider: {
    height: 1,
  },
  details: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickupCodeContainer: {},
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  directionsButton: {},
});
