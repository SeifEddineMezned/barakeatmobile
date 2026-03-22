import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, ActivityIndicator, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Navigation, X as XIcon, QrCode, Star, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import type { ReservationFromAPI } from '@/src/services/reservations';
import { fetchReservationQRCode } from '@/src/services/reservations';

interface ReservationCardProps {
  reservation: ReservationFromAPI;
  onCancel?: (id: string) => void;
  onHide?: (id: string) => void;
}

export function ReservationCard({ reservation, onCancel, onHide: _onHide }: ReservationCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const [qrExpanded, setQrExpanded] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

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
    setIsExpanded((prev) => !prev);
  };

  const handleToggleQR = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (qrExpanded) {
      setQrExpanded(false);
      return;
    }
    if (qrDataUrl) {
      setQrExpanded(true);
      return;
    }
    setQrLoading(true);
    try {
      const url = await fetchReservationQRCode(String(reservation.id));
      setQrDataUrl(url || null);
      setQrExpanded(true);
    } catch {
      console.log('[ReservationCard] Failed to fetch QR code');
    } finally {
      setQrLoading(false);
    }
  };

  const handleDirections = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (latitude && longitude) {
      const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
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
      case 'picked_up':
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
  const isPast = status === 'collected' || status === 'completed' || status === 'picked_up';

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.r16,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          marginBottom: theme.spacing.sm,
          ...theme.shadows.shadowSm,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      {/* Collapsed header — always visible */}
      <TouchableOpacity onPress={handlePress} activeOpacity={0.85}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]} numberOfLines={1}>
              {merchantName}
            </Text>
            {basketName ? (
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]} numberOfLines={1}>
                {basketName} × {quantity}{total > 0 ? ` · ${total} TND` : ''}
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={[
                {
                  backgroundColor: getStatusColor() + '20',
                  borderRadius: theme.radii.r8,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: 3,
                },
              ]}
            >
              <Text style={[{ color: getStatusColor(), ...theme.typography.caption, fontWeight: '600' as const }]}>
                {getStatusLabel()}
              </Text>
            </View>
            {isExpanded
              ? <ChevronUp size={16} color={theme.colors.muted} />
              : <ChevronDown size={16} color={theme.colors.muted} />}
          </View>
        </View>
      </TouchableOpacity>

      {/* Expanded details */}
      {isExpanded && (
        <View>
          <View style={[styles.divider, { marginVertical: theme.spacing.md, backgroundColor: theme.colors.divider }]} />

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
                <View style={styles.pickupCodeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.xs }]}>
                      {t('orders.pickupCode')}
                    </Text>
                    <Text
                      style={[{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const, letterSpacing: 2 }]}
                    >
                      {pickupCode}
                    </Text>
                  </View>
                  {isUpcoming && (
                    <TouchableOpacity
                      onPress={handleToggleQR}
                      style={[
                        styles.qrButton,
                        {
                          backgroundColor: theme.colors.primary + '20',
                          borderRadius: theme.radii.r12,
                          padding: theme.spacing.md,
                        },
                      ]}
                    >
                      {qrLoading ? (
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                      ) : (
                        <QrCode size={22} color={theme.colors.primary} />
                      )}
                    </TouchableOpacity>
                  )}
                </View>
                {qrExpanded && qrDataUrl ? (
                  <View style={[styles.qrContainer, { marginTop: theme.spacing.lg, alignItems: 'center' }]}>
                    <Image
                      source={{ uri: qrDataUrl }}
                      style={{ width: 180, height: 180, borderRadius: theme.radii.r8 }}
                      resizeMode="contain"
                    />
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: theme.spacing.sm, textAlign: 'center' }]}>
                      {t('orders.showQrCode')}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.footer, { marginTop: theme.spacing.lg }]}>
              <View>
                {total > 0 && (
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' as const }]}>
                    {total} TND
                  </Text>
                )}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {isUpcoming && onCancel && (
                  <TouchableOpacity
                    onPress={() => onCancel(reservation.id)}
                    style={[{ padding: 6, backgroundColor: theme.colors.error + '15', borderRadius: theme.radii.r8 }]}
                  >
                    <XIcon size={16} color={theme.colors.error} />
                  </TouchableOpacity>
                )}
                {latitude !== 0 && longitude !== 0 && (
                  <TouchableOpacity
                    style={[
                      styles.directionsButton,
                      {
                        backgroundColor: theme.colors.primary,
                        borderRadius: theme.radii.r12,
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                        flexDirection: 'row',
                        alignItems: 'center',
                      },
                    ]}
                    onPress={handleDirections}
                  >
                    <Navigation size={14} color={theme.colors.surface} />
                    <Text
                      style={[{ color: theme.colors.surface, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}
                    >
                      {t('basket.directions')}
                    </Text>
                  </TouchableOpacity>
                )}

                {isPast && (
                  <TouchableOpacity
                    style={[
                      {
                        backgroundColor: theme.colors.accentWarm,
                        borderRadius: theme.radii.r12,
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                        flexDirection: 'row',
                        alignItems: 'center',
                      },
                    ]}
                    onPress={() => {
                      const restaurantId = basket?.merchantId ?? (basket as any)?.restaurant_id ?? '';
                      router.push(`/review?restaurantId=${restaurantId}&reservationId=${reservation.id}` as never);
                    }}
                  >
                    <Star size={14} color="#fff" fill="#fff" />
                    <Text
                      style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}
                    >
                      {t('orders.leaveReview')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </View>
      )}
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
  pickupCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  qrButton: {},
  qrContainer: {},
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  directionsButton: {},
});
