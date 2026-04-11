import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, ActivityIndicator, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Navigation, X as XIcon, QrCode, Star, ChevronDown, ChevronUp, ShoppingBag, MessageCircle } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { getNowInBusinessTz } from '@/src/utils/timezone';
import type { ReservationFromAPI } from '@/src/services/reservations';
import { fetchReservationQRCode } from '@/src/services/reservations';

interface ReservationCardProps {
  reservation: ReservationFromAPI;
  onCancel?: (id: string, quantity: number, locationId?: string, merchantName?: string) => void;
  onHide?: (id: string) => void;
  overrideExpired?: boolean;
  messageUnreadCount?: number;
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

export function ReservationCard({ reservation, onCancel, onHide: _onHide, overrideExpired, messageUnreadCount = 0 }: ReservationCardProps) {
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
  const latitude = Number(r.latitude ?? basket?.latitude ?? (basket as any)?.lat ?? 0);
  const longitude = Number(r.longitude ?? basket?.longitude ?? (basket as any)?.lng ?? 0);

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
      void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);
    } else if (address) {
      void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
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
  const hasReview = (r as any).has_review === true;

  // Live pickup countdown for upcoming orders (business timezone aware)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isUpcoming || !pickupWindow) return;
    const timer = setInterval(() => setTick(p => p + 1), 60000);
    return () => clearInterval(timer);
  }, [isUpcoming, pickupWindow]);

  const pickupInfo = (() => {
    if (!isUpcoming || !pickupWindow) return null;
    const [sh, sm] = (pickupWindow.start ?? '').split(':').map(Number);
    const [eh, em] = (pickupWindow.end ?? '').split(':').map(Number);
    if (isNaN(sh) || isNaN(eh)) return null;
    const bizNow = getNowInBusinessTz();
    const nowMin = bizNow.hours * 60 + bizNow.minutes;
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (nowMin < startMin) {
      const diff = startMin - nowMin;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return { label: t('orders.startsIn'), time: h > 0 ? `${h}h ${m}m` : `${m}m`, color: theme.colors.primary };
    } else if (nowMin <= endMin) {
      const diff = endMin - nowMin;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      const timeStr = h > 0 ? `${h}h ${m}m` : `${diff}m`;
      return { label: t('orders.endsIn'), time: timeStr, color: diff < 15 ? theme.colors.error : theme.colors.accentWarm };
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
      <TouchableOpacity onPress={handlePress} activeOpacity={0.85} accessibilityLabel={`${basketTypeName}, ${merchantName}, ${total > 0 ? total + ' TND' : ''}, ${getStatusLabel()}`} accessibilityRole="button" accessibilityHint={t('orders.tapToExpand', { defaultValue: 'Tap to expand details' })}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Left: location/basket image */}
          {(() => {
            const imgUrl = (basket as any)?.image_url ?? (basket as any)?.imageUrl ?? (basket as any)?.cover_image_url ?? r.restaurant_image ?? r.org_image_url ?? r.restaurant?.image_url ?? null;
            return imgUrl ? (
              <Image source={{ uri: imgUrl }} style={{ width: 44, height: 44, borderRadius: 12, marginRight: 12 }} resizeMode="cover" />
            ) : (
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.primary + '12', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <ShoppingBag size={20} color={theme.colors.primary} />
              </View>
            );
          })()}

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
                  {orderDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
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

          {/* Right: chat icon (upcoming) or status badge (past) */}
          <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
            {isUpcoming ? (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/message/[id]', params: { id: `res-${reservation.id}`, reservationId: String(reservation.id), buyerId: String(r.buyer_id ?? ''), locationId: String(r.location_id ?? r.restaurant_id ?? basket?.merchantId ?? '') } } as never); }}
                style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <MessageCircle size={17} color={theme.colors.primary} />
                {messageUnreadCount > 0 && (
                  <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, borderWidth: 2, borderColor: theme.colors.surface }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{messageUnreadCount > 9 ? '9+' : messageUnreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : (
              <View
                accessibilityLabel={`${t('orders.status', { defaultValue: 'Status' })}: ${getStatusLabel()}`}
                style={{ backgroundColor: getStatusColor() + '20', borderRadius: theme.radii.r8, paddingHorizontal: theme.spacing.sm, paddingVertical: 3 }}
              >
                <Text style={[{ color: getStatusColor(), ...theme.typography.caption, fontWeight: '600' as const }]}>
                  {getStatusLabel()}
                </Text>
              </View>
            )}
          </View>
        </View>
        {/* Chevron — bottom right */}
        <View style={{ alignItems: 'flex-end', paddingTop: 6, paddingRight: 4 }}>
          {isExpanded
            ? <ChevronUp size={16} color={theme.colors.muted} />
            : <ChevronDown size={16} color={theme.colors.muted} />}
        </View>
      </TouchableOpacity>

      {/* Expanded details */}
      {isExpanded && (
        <View>
          <View style={[styles.divider, { marginVertical: theme.spacing.md, backgroundColor: theme.colors.divider }]} />

          <View style={styles.details}>
            {/* Info rows — same structure as order confirmed notification */}
            <View style={{ backgroundColor: '#114b3c08', borderRadius: 14, padding: 14, gap: 0 }}>
              {/* Row 1: Address + itinerary */}
              {address ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                    <MapPin size={13} color="#e3ff5c" />
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                    {address}
                  </Text>
                  <TouchableOpacity onPress={handleDirections} style={{ backgroundColor: '#114b3c', borderRadius: 10, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' }}>
                    <Navigation size={13} color="#e3ff5c" />
                  </TouchableOpacity>
                </View>
              ) : null}
              {/* Row 2: Quantity */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: address ? 1 : 0, borderTopColor: theme.colors.divider }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                  <ShoppingBag size={13} color="#e3ff5c" />
                </View>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                  {quantity} {quantity > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}
                </Text>
              </View>
              {/* Row 2: Price */}
              {total > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#e3ff5c', fontSize: 9, fontWeight: '700' }}>TND</Text>
                  </View>
                  <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', flex: 1 }}>
                    {total} TND
                  </Text>
                </View>
              )}
              {/* Row 3: Pickup time */}
              {pickupWindow && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                    <Clock size={13} color="#e3ff5c" />
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                    {t('notifications.pickupAt', { defaultValue: 'Retrait' })} : {pickupWindow.start} - {pickupWindow.end}
                  </Text>
                </View>
              )}
            </View>

            {/* Pickup code — dark div, only for upcoming */}
            {isUpcoming && pickupCode ? (
              <View style={{ backgroundColor: '#114b3c', borderRadius: 14, padding: 14, marginTop: 10, alignItems: 'center' }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, marginBottom: 4 }}>
                  {t('orders.pickupCode')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Text style={{ color: '#e3ff5c', fontSize: 22, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 4 }}>
                    {pickupCode}
                  </Text>
                  <TouchableOpacity
                    onPress={handleToggleQR}
                    style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: 8 }}
                  >
                    {qrLoading ? <ActivityIndicator size="small" color="#fff" /> : <QrCode size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>
                {qrExpanded && qrDataUrl ? (
                  <Image source={{ uri: qrDataUrl }} style={{ width: 160, height: 160, borderRadius: 8, marginTop: 12 }} resizeMode="contain" />
                ) : null}
              </View>
            ) : null}

            {/* Footer: review (past) + cancel (upcoming) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {isPast && !hasReview && (
                  <TouchableOpacity
                    onPress={() => {
                      const lid = String(r.location_id ?? r.restaurant_id ?? basket?.merchantId ?? '');
                      router.push({ pathname: '/review', params: { reservationId: String(reservation.id), locationId: lid, locationName: merchantName, locationLogo: r.restaurant?.image_url ?? r.restaurant_image ?? r.org_image_url ?? '', basketImage: basket?.image_url ?? (basket as any)?.imageUrl ?? (basket as any)?.cover_image_url ?? '', basketName: basketTypeName, quantity: String(quantity), total: String(total) } } as never);
                    }}
                    style={{ backgroundColor: theme.colors.accentWarm, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  >
                    <Star size={12} color="#fff" fill="#fff" />
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{t('orders.leaveReview')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {isUpcoming && onCancel && (
                <TouchableOpacity
                  onPress={() => onCancel(reservation.id, quantity, String(r.location_id ?? r.restaurant_id ?? ''), merchantName)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.error + '12' }}
                >
                  <XIcon size={12} color={theme.colors.error} />
                  <Text style={{ color: theme.colors.error, fontSize: 12, fontWeight: '600' }}>{t('orders.cancelBtn', { defaultValue: 'Annuler' })}</Text>
                </TouchableOpacity>
              )}
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
