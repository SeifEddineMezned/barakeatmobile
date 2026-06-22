import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Navigation, Banknote } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import type { Order } from '@/src/types';

interface OrderCardProps {
  order: Order;
}

export function OrderCard({ order }: OrderCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.98,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleDirections = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${order.basket.latitude},${order.basket.longitude}`;
    void Linking.openURL(url);
  };

  const getStatusColor = () => {
    switch (order.status) {
      case 'reserved':
        return theme.colors.primary;
      case 'ready':
        return theme.colors.secondary;
      case 'collected':
        return theme.colors.success;
      case 'cancelled':
        return theme.colors.error;
      default:
        return theme.colors.textSecondary;
    }
  };

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
              {order.basket.merchantName}
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
              <Text
                style={[
                  {
                    color: getStatusColor(),
                    ...theme.typography.caption,
                    fontWeight: '600' as const,
                  },
                ]}
              >
                {t(`orders.status.${order.status}`)}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.divider, { marginVertical: theme.spacing.lg, backgroundColor: theme.colors.divider }]} />

        <View style={styles.details}>
          <View style={[styles.row, { marginBottom: theme.spacing.md }]}>
            <Clock size={16} color={theme.colors.textSecondary} />
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: theme.spacing.sm }]}>
              {order.pickupWindow.start} - {order.pickupWindow.end}
            </Text>
          </View>

          <View style={[styles.row, { marginBottom: theme.spacing.md }]}>
            <MapPin size={16} color={theme.colors.textSecondary} />
            <Text
              style={[
                {
                  color: theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                  marginLeft: theme.spacing.sm,
                  flex: 1,
                },
              ]}
              numberOfLines={1}
            >
              {order.basket.address}
            </Text>
          </View>

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
              style={[
                {
                  color: theme.colors.primary,
                  ...theme.typography.h2,
                  fontWeight: '700' as const,
                  letterSpacing: 2,
                },
              ]}
            >
              {String(order.pickupCode ?? '').substring(0, 6).toUpperCase()}
            </Text>
          </View>

          {/* Per-order impact pills — only for picked-up orders, so a
              pending reservation doesn't claim credit it hasn't earned yet.
              The status set mirrors how the orders screen decides "done":
              collected / completed / picked_up (legacy spelling from earlier
              backend versions). */}
          {(() => {
            const doneStatuses = ['collected', 'completed', 'picked_up'] as const;
            const isDone = doneStatuses.includes(order.status as any);
            if (!isDone) return null;
            // CO₂ pill removed: the per-meal kgCO₂ estimate was not accurate
            // enough to claim on individual orders. Money saved stays because
            // it's the literal price delta the customer didn't pay.
            const savedTnd = Math.max(0, (order.basket.originalPrice - order.basket.discountedPrice) * order.quantity);
            if (savedTnd <= 0) return null;
            return (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r8, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs, gap: 4 }}>
                  <Banknote size={12} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, fontSize: 12, fontFamily: 'Poppins_600SemiBold', fontWeight: '600' as const }}>
                    {t('impact.perOrderMoney', { value: savedTnd.toFixed(0), defaultValue: `+${savedTnd.toFixed(0)} TND économisés` })}
                  </Text>
                </View>
              </View>
            );
          })()}

          <View style={[styles.footer, { marginTop: theme.spacing.lg }]}>
            <View>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                {order.basket.name} × {order.quantity}
              </Text>
              <Text
                style={[
                  {
                    color: theme.colors.textPrimary,
                    ...theme.typography.h3,
                    marginTop: theme.spacing.xs,
                  },
                ]}
              >
                {order.total} TND
              </Text>
            </View>

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
                style={[
                  {
                    color: theme.colors.surface,
                    ...theme.typography.bodySm,
                    fontWeight: '600' as const,
                    marginLeft: theme.spacing.sm,
                  },
                ]}
              >
                {t('basket.directions')}
              </Text>
            </TouchableOpacity>
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
  headerLeft: {},
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
