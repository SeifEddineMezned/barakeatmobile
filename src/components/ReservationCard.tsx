import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, ActivityIndicator, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Navigation, X as XIcon, QrCode, Star, ChevronDown, ChevronUp, ShoppingBag } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import type { ReservationFromAPI } from '@/src/services/reservations';
import { fetchReservationQRCode } from '@/src/services/reservations';

interface ReservationCardProps {
  reservation: ReservationFromAPI;
  onCancel?: (id: string) => void;
  onHide?: (id: string) => void;
  overrideExpired?: boolean;
}

// ---------------------------------------------------------------------------
// Data-mapping helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the merchant / business name from the raw reservation object.
 * Priority: top-level restaurant_name → basket.merchantName → basket.merchant_name
 *            → restaurant.name → org_name → 'Unknown'
 */
function resolveMerchantName(r: any): string {
  return (
    r.restaurant_name ??
    r.basket?.merchantName ??
    r.basket?.merchant_name ??
    r.restaurant?.name ??
    r.org_name ??
    ''
  );
}

/**
 * Resolve the basket TYPE name (the value that identifies what kind of basket
 * this reservation is for — e.g. "Panier Surprise Boulangerie").
 *
 * Priority: basket.name → basket.basket_type_name → basket.type_name
 *           → basket.basket_name → top-level basket_name / name
 *           → fallback to translation key
 */
function resolveBasketTypeName(r: any, t: (key: string) => string): string {
  return (
    r.basket?.name ??
    r.basket?.basket_type_name ??
    r.basket?.type_name ??
    r.basket?.basket_name ??
    r.basket_name ??
    r.basket_type_name ??
    r.name ??
    t('orders.surpriseBag')
  );
}

/**
 * Resolve the pickup window from the raw reservation object.
 */
function resolvePickupWindow(
  reservation: ReservationFromAPI
): { start: string; end: string } | null {
  const r = reservation as any;

  if (reservation.pickupWindow?.start && reservation.pickupWindow?.end) {
    return {
      start: reservation.pickupWindow.start.substring(0, 5),
      end: reservation.pickupWindow.end.substring(0, 5),
    };
  }
  if (reservation.basket?.pickupWindow?.start && reservation.basket?.pickupWindow?.end) {
    return {
      start: reservation.basket.pickupWindow.start.substring(0, 5),
      end: reservation.basket.pickupWindow.end.substring(0, 5),
    };
  }
  if (r.pickup_start_time && r.pickup_end_time) {
    return {
      start: String(r.pickup_start_time).substring(0, 5),
      end: String(r.pickup_end_time).substring(0, 5),
    };
  }
  if (reservation.basket?.pickup_start_time && reservation.basket?.pickup_end_time) {
    return {
      start: String(reservation.basket.pickup_start_time).substring(0, 5),
      end: String(reservation.basket.pickup_end_time).substring(0, 5),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReservationCard({ reservation, onCancel, onHide: _onHide, overrideExpired }: ReservationCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const [qrExpanded, setQrExpanded] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const r = reservation as any;
  const basket = reservation.basket;

  // Resolved display values
  const merchantName = resolveMerchantName(r);
  const basketTypeName = resolveBasketTypeName(r, t);
  const address = r.restaurant_address ?? basket?.address ?? r.restaurant?.address ?? '';
  const pickupWindow = resolvePickupWindow(reservation);
  const pickupCode =
    reservation.pickupCode ??
    r.pickup_code ??
    (typeof reservation.id === 'string' ? reservation.id.substring(0, 6).toUpperCase() : '');
  const quantity = reservation.quantity ?? 1;
  const total: number =
    reservation.total ??
    (r.total_price ? Number(r.total_price) : null) ??
    (r.price_tier ? Number(r.price_tier) * quantity : 0);
  const rawStatus = (reservation.status ?? 'reserved').toLowerCase();
  const status = overrideExpired ? 'expired' : rawStatus;
  const latitude = basket?.latitude ?? (basket as any)?.lat ?? 0;
  const longitude = basket?.longitude ?? (basket as any)?.lng ?? 0;

  // Order date
  const orderDate: Date | null = r.pickup_date
    ? new Date(r.pickup_date)
    : r.created_at
    ? new Date(r.created_at)
    : null;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.98, duration: 100, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    setIsExpanded((prev) => !prev);
  };

  const handleToggleQR = async () => {
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
    // If key is not found, i18next returns the key itself — fall back to capitalized status
    if (translated === key) {
      return status.charAt(0).toUpperCase() + status.slice(1);
    }
    return translated;
  };

  const isUpcoming = status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed';
  const isPast = status === 'collected' || status === 'completed' || status === 'picked_up';

  // Live pickup countdown for upcoming orders
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    if (!isUpcoming || !pickupWindow) return;
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, [isUpcoming, pickupWindow]);

  const pickupInfo = (() => {
    if (!isUpcoming || !pickupWindow) return null;
    const today = new Date();
    const [sh, sm] = (pickupWindow.start ?? '').split(':').map(Number);
    const [eh, em] = (pickupWindow.end ?? '').split(':').map(Number);
    if (isNaN(sh) || isNaN(eh)) return null;
    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), sh, sm);
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), eh, em);

    if (now < startDate) {
      const diff = Math.round((startDate.getTime() - now.getTime()) / 60000);
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return { label: t('orders.startsIn'), time: h > 0 ? `${h}h ${m}m` : `${m}m`, color: theme.colors.primary };
    } else if (now <= endDate) {
      const diff = Math.round((endDate.getTime() - now.getTime()) / 60000);
      return { label: t('orders.endsIn'), time: `${diff}m`, color: diff < 15 ? theme.colors.error : theme.colors.accentWarm };
    } else {
      return { label: t('orders.pickupEnded'), time: '', color: theme.colors.muted };
    }
  })();

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
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Left: basket icon */}
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: theme.colors.primary + '12',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
            }}
          >
            <ShoppingBag size={20} color={theme.colors.primary} />
          </View>

          {/* Center: text info */}
          <View style={{ flex: 1 }}>
            <Text
              style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' as const }]}
              numberOfLines={1}
            >
              {basketTypeName}
            </Text>

            {merchantName ? (
              <Text
                style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}
                numberOfLines={1}
              >
                {merchantName}
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
              {total > 0 && (
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                  {total} TND
                </Text>
              )}
              {quantity > 1 && (
                <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
                  x{quantity}
                </Text>
              )}
              {orderDate && (
                <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
                  {orderDate.toLocaleDateString()}
                </Text>
              )}
            </View>

            {/* Live countdown pill */}
            {pickupInfo ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pickupInfo.color }} />
                <Text style={{ color: pickupInfo.color, ...theme.typography.caption, fontWeight: '600' }}>
                  {pickupInfo.label} {pickupInfo.time}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Right: status badge + chevron */}
          <View style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 8 }}>
            <View
              style={{
                backgroundColor: getStatusColor() + '20',
                borderRadius: theme.radii.r8,
                paddingHorizontal: theme.spacing.sm,
                paddingVertical: 3,
              }}
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
                  {pickupWindow.start} – {pickupWindow.end}
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

            {/* Show pickup code only for upcoming orders */}
            {isUpcoming && pickupCode ? (
              <View
                style={[
                  styles.pickupCodeContainer,
                  {
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.radii.r12,
                    padding: theme.spacing.lg,
                    marginTop: theme.spacing.md,
                  },
                ]}
              >
                <View style={styles.pickupCodeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption, marginBottom: theme.spacing.xs }]}>
                      {t('orders.pickupCode')}
                    </Text>
                    <Text
                      style={[{ color: '#fff', ...theme.typography.h2, fontWeight: '700' as const, letterSpacing: 2 }]}
                    >
                      {pickupCode}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleToggleQR}
                    style={[
                      styles.qrButton,
                      {
                        backgroundColor: 'rgba(255,255,255,0.2)',
                        borderRadius: theme.radii.r12,
                        padding: theme.spacing.md,
                      },
                    ]}
                  >
                    {qrLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <QrCode size={22} color="#fff" />
                    )}
                  </TouchableOpacity>
                </View>
                {qrExpanded && qrDataUrl ? (
                  <View style={[styles.qrContainer, { marginTop: theme.spacing.lg, alignItems: 'center' }]}>
                    <Image
                      source={{ uri: qrDataUrl }}
                      style={{ width: 180, height: 180, borderRadius: theme.radii.r8 }}
                      resizeMode="contain"
                    />
                    <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption, marginTop: theme.spacing.sm, textAlign: 'center' }]}>
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
                      const lid = String(r.location_id ?? r.restaurant_id ?? basket?.merchantId ?? '');
                      router.push({
                        pathname: '/review',
                        params: {
                          reservationId: String(reservation.id),
                          locationId: lid,
                          locationName: merchantName,
                          locationLogo: r.restaurant?.image_url ?? r.restaurant_image ?? r.org_image_url ?? '',
                          basketImage: basket?.image_url ?? (basket as any)?.imageUrl ?? (basket as any)?.cover_image_url ?? '',
                          basketName: basketTypeName,
                          quantity: String(quantity),
                          total: String(total),
                        },
                      } as never);
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
