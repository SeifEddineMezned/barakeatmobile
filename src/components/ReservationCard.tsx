import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, ActivityIndicator, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Navigation, X as XIcon, QrCode, Star, ChevronDown, ChevronUp, ShoppingBag, MessageCircle, Banknote, CreditCard, Wallet, Info } from 'lucide-react-native';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { FlagIcon8 } from '@/src/components/ui/Icon8';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { getNowInBusinessTz, toBizDayMinutes, isPickupExpiredInTz, getBusinessDayDateStr } from '@/src/utils/timezone';
import { orderIdToCode } from '@/src/utils/orderCode';
import type { ReservationFromAPI } from '@/src/services/reservations';
import { fetchReservationQRCode } from '@/src/services/reservations';
import { useOrdersStore } from '@/src/stores/ordersStore';
import { StatusDot } from '@/src/components/StatusDot';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { DEMO_ORDER_ID } from '@/src/lib/demoData';
import { parseMotifRaw, motifDisplay } from '@/src/utils/motif';

interface ReservationCardProps {
  reservation: ReservationFromAPI;
  onCancel?: (id: string, quantity: number, locationId?: string, merchantName?: string, paymentMethod?: 'cash' | 'card' | 'credits', creditAmount?: number) => void;
  onHide?: (id: string) => void;
  overrideExpired?: boolean;
  messageUnreadCount?: number;
  // Set by the orders screen when this card is the deep-link target of a
  // notification (e.g. "Voir la commande" on a cancelled-order popup). The
  // card mounts already expanded so the user lands on the full details
  // instead of a collapsed row, and a useEffect re-applies the expansion
  // if the prop transitions from false → true after mount (handles the case
  // where the target arrives via a re-navigation while the screen is alive).
  initialExpanded?: boolean;
}

// Mirrors the timeAgo in notification cards so order cards read with the same
// "il y a 3min" cadence the user already knows from the inbox.
function timeAgo(dateStr: string | null | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!dateStr) return '';
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 60) return t('timeAgo.seconds', { count: Math.max(diff, 0) });
  if (diff < 3600) return t('timeAgo.minutes', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('timeAgo.hours', { count: Math.floor(diff / 3600) });
  const days = Math.floor(diff / 86400);
  if (days < 7) return t('timeAgo.days', { count: days });
  if (days < 30) return t('timeAgo.weeks', { count: Math.floor(days / 7) });
  return t('timeAgo.months', { count: Math.floor(days / 30) });
}

// Money formatting that matches the business interface — integer values stay
// integer ("10 TND"), decimal values get two decimals ("10.50 TND"). Without
// this the customer side rendered "10.5" while the business side showed
// "10.50" for the same row, which read inconsistent across interfaces.
const fmtMoney = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

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

// React.memo with a named-function expression. Customer orders page renders
// 10–50 of these cards per tab and switches between three tabs; without memo
// every parent re-render (the polling msgUnreads query, the highlight-target
// effect, the deferredTab transition, the filterByDate state) propagates a
// full re-render to every card, even cards whose own props haven't changed.
// The card body does a lot of work — date parsing, pickup-window resolution,
// status resolution, several hooks — so the cost adds up fast.
//
// The previous attempt at memo used `function Inner() {…}; export const X =
// React.memo(Inner)` which tripped Fast Refresh (Inner and X had different
// identities → HMR lost the fiber → "Rendered more hooks than during the
// previous render" surfaced on unrelated components). The named-function
// expression form preserves the displayName across HMR.
//
// Shallow prop comparison is correct here: `reservation` objects come from
// React Query's cache and are stable references across renders, `onCancel`
// and `onHide` are useCallback'd in orders.tsx, and the primitives
// (overrideExpired, messageUnreadCount, initialExpanded) compare cheaply.
export const ReservationCard = React.memo(function ReservationCard({ reservation, onCancel, onHide: _onHide, overrideExpired, messageUnreadCount = 0, initialExpanded = false }: ReservationCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const [qrExpanded, setQrExpanded] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  // Re-apply expansion when the deep-link target re-fires (parent flips
  // initialExpanded from false → true after the card is already mounted).
  // Only force-expand on the false→true edge so a manually-collapsed card
  // doesn't snap back open on every re-render.
  const prevInitialExpandedRef = React.useRef(initialExpanded);
  React.useEffect(() => {
    if (!prevInitialExpandedRef.current && initialExpanded) {
      setIsExpanded(true);
    }
    prevInitialExpandedRef.current = initialExpanded;
  }, [initialExpanded]);

  const r = reservation as any;
  const basket = reservation.basket;

  // Resolved display values
  const merchantName = resolveMerchantName(r);
  const basketTypeName = resolveBasketTypeName(r, t);
  const address = r.restaurant_address ?? basket?.address ?? r.restaurant?.address ?? '';
  const pickupWindow = resolvePickupWindow(reservation);
  // Pickup code is shown to the customer as a 6-character chip. Backend
  // codes can be longer (legacy 8-char records exist); we always clip to
  // the first 6 chars + upper-case so what the customer reads matches
  // what the merchant types into the verify modal (which is also
  // length-capped at 6). Without this clip, an older reservation whose
  // backend code is "ABCDEFGH" still rendered as "ABCDEFGH" on the card.
  const rawPickupCode =
    reservation.pickupCode ??
    r.pickup_code ??
    (typeof reservation.id === 'string' ? reservation.id : '');
  const pickupCode = String(rawPickupCode).substring(0, 6).toUpperCase();
  const quantity = reservation.quantity ?? 1;
  const total: number =
    reservation.total ??
    (r.total_price ? Number(r.total_price) : null) ??
    (r.price_tier ? Number(r.price_tier) * quantity : 0);
  const rawStatus = (reservation.status ?? 'reserved').toLowerCase();
  // System-expired reservations are stored as `status='cancelled'` with
  // `cancelled_by='system'` + `cancellation_reason='expired_no_pickup'`
  // (the cron-sweep / snapshot-expire / location-hours-change paths all
  // write this triple — see admin.js line 1549 for the same derivation
  // server-side in the analytics view). For display purposes those rows
  // are EXPIRED, not customer/merchant cancelled — they get the orange
  // "Expiré" pill + the time-out icon rather than the red "Annulée".
  // Anything else (`cancelled_by` in {'buyer','business'} OR no reason)
  // stays as a genuine cancellation.
  const cancelledBy = String((r as any).cancelled_by ?? '').toLowerCase();
  const cancellationReason = String((r as any).cancellation_reason ?? '').toLowerCase();
  const isSystemExpired =
    rawStatus === 'cancelled'
    && cancelledBy === 'system'
    && cancellationReason === 'expired_no_pickup';
  const status = overrideExpired || isSystemExpired ? 'expired' : rawStatus;
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

  const getStatusTone = (): 'info' | 'warn' | 'success' | 'danger' | 'neutral' => {
    switch (status) {
      case 'reserved':
      case 'pending':
      case 'confirmed':
        return 'info';
      case 'ready':
        return 'warn';
      case 'collected':
      case 'completed':
      case 'picked_up':
        return 'success';
      case 'cancelled':
      case 'expired':
        return 'danger';
      default:
        return 'neutral';
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
  // Once the customer has filed a claim / report on this reservation, hide
  // both Report and Review actions — they've already communicated their
  // issue and shouldn't be pushed back into the same flow. Tracked locally
  // (ordersStore) until the backend reliably returns has_claim.
  const reportedIds = useOrdersStore((s) => s.reportedReservationIds);
  const hasReport = (r as any).has_claim === true
    || (r as any).has_report === true
    || reportedIds.includes(String(reservation.id));

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
    // Compare in business-day minutes so overnight windows (e.g. 18:00 → 02:59)
    // work correctly — raw clock minutes would always flag evening times as past
    // an after-midnight end time.
    const nowMin = toBizDayMinutes(bizNow.hours * 60 + bizNow.minutes);
    const startMin = toBizDayMinutes(sh * 60 + sm);
    const endMin = toBizDayMinutes(eh * 60 + em);

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

  // Walkthrough handshake — only for the demo order card. Measures the card
  // and the pickup-code block so the customer-side orders walkthrough steps
  // (`customerOrderCard`, `customerPickupCode`) can spotlight them.
  const isDemoCard = String(reservation.id) === DEMO_ORDER_ID;

  // When the demo order card expands (user taps it during the
  // `customerOrderCard` step), advance the walkthrough so the next step
  // (`customerPickupCode`) can spotlight the now-visible pickup code block.
  // Without this advance, the user is stuck on step 8 forever — the card
  // expanding doesn't trigger a navigation, and the step has no
  // `advanceOnPath` to listen for.
  React.useEffect(() => {
    if (!isDemoCard || !isExpanded) return;
    const { currentStep, nextStep } = useWalkthroughStore.getState();
    if (currentStep?.measureKey === 'customerOrderCard') {
      nextStep(Number.MAX_SAFE_INTEGER);
    }
  }, [isDemoCard, isExpanded]);

  // Re-measure the pickup code block after the orders tab's auto-scroll has
  // settled. The block's onLayout publishes its rect on initial layout, but
  // scrolling the page doesn't trigger onLayout — so the rect would still
  // point at the pre-scroll window y and the halo would land off-target.
  // We subscribe to the walkthrough's current step key and, when it
  // becomes `customerPickupCode`, fire a delayed measureInWindow that
  // overwrites the rect with the post-scroll position.
  const pickupCodeRef = React.useRef<View>(null);
  const walkthroughKey = useWalkthroughStore((s) => s.currentStep?.measureKey);
  React.useEffect(() => {
    if (!isDemoCard || !isExpanded) return;
    if (walkthroughKey !== 'customerPickupCode') return;
    // Orders tab scroll is animated=true with ~300 ms duration; 500 ms
    // gives a comfortable buffer for layout to settle before we read the
    // ref's new window position.
    const t = setTimeout(() => {
      pickupCodeRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('customerPickupCode', { x, y, w, h });
      });
    }, 500);
    return () => clearTimeout(t);
  }, [isDemoCard, isExpanded, walkthroughKey]);

  return (
    <Animated.View
      onLayout={(e) => {
        if (!isDemoCard) return;
        (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
          if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('customerOrderCard', { x, y, w, h });
        });
      }}
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
        {/* `alignItems: 'flex-start'` so the right column (chat + chevron)
            sits at the TOP of the card, not vertically centered with the
            text. Per product feedback the icons were "a little under the
            top" — that was the previous `alignItems: 'center'` averaging
            them against the center column's height. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
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

          {/* Center: text info.
              `minWidth: 0` is the canonical fix for "long text refuses to
              shrink in a flex row" — without it a long basket type or
              merchant name pushes the right column (chat + pill + chevron)
              off the card edge instead of truncating. */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' as const }]}
              // When expanded, never truncate — the user explicitly opens
              // the card to see the full name. Same idea on the merchant
              // line below and on the business card.
              numberOfLines={isExpanded ? undefined : 1}
            >
              {basketTypeName}
            </Text>

            {merchantName ? (
              <Text
                style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}
                numberOfLines={isExpanded ? undefined : 1}
              >
                {merchantName}
              </Text>
            ) : null}

            {/* Quantity + date metadata row removed from the collapsed view:
                · quantity now lives in the pill at the top-right of the card
                  (parallels the business card)
                · the formatted date is reserved for the expanded view —
                  collapsed only shows the relative `timeAgo` on the bottom
                  row, so the card has less visual noise. */}

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

          {/* Right column — chat icon + chevron, anchored to the TOP of the
              card (alignItems: 'flex-start' on the column AND
              alignSelf: 'flex-start' on the inner row so they hug the top
              regardless of how tall the center column gets). Quantity
              pill is removed from collapsed per product feedback — lives
              on the expanded card now. */}
          <View style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 8, flexShrink: 0, alignSelf: 'flex-start' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {isUpcoming && (
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
              )}
              {isExpanded
                ? <ChevronUp size={16} color={theme.colors.muted} />
                : <ChevronDown size={16} color={theme.colors.muted} />}
            </View>
            {/* Cancellation / expiry status — stacks DIRECTLY UNDER the
                chat + chevron row, right-aligned. Récupéré (isPast) and
                upcoming states render nothing here. */}
            {!isUpcoming && !isPast && (
              <View accessibilityLabel={`${t('orders.status', { defaultValue: 'Status' })}: ${getStatusLabel()}`}>
                <StatusDot tone={getStatusTone()} label={getStatusLabel()} />
              </View>
            )}
          </View>
        </View>
        {/* Bottom row when collapsed:
              LEFT  → payment-method icon + price (+ credits chip if any)
              RIGHT → time-since-event · order ID
            The chevron is gone from this row — it lives in the top-right
            column now, so the bottom row stays compact. Time-since-event
            picks `updated_at` for past orders (completed / cancelled /
            expired) so it reads "il y a 5 min" from when the event
            happened, not from when the original order was placed — matches
            the user's mental model on the Terminées / Problèmes tabs. */}
        {!isExpanded ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, paddingRight: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
              {(() => {
                // Collapsed view shows the payment-method icon + headline
                // price text. Per product rule the icon is ALWAYS cash or
                // card — never the wallet icon — even when pm='credits'
                // (full-credits is treated as cash with cashToPay=0). The
                // text is tab-aware:
                //   UPCOMING + remaining 0  → "Déjà payé" (card OR full-credits)
                //   UPCOMING + remaining >0 → "À payer : {remaining} TND"
                //   PAST (any method)       → "{total} TND"
                const pm = (r.payment_method ?? (reservation as any).payment_method) as 'cash' | 'card' | 'credits' | undefined;
                const creditAmt = Number(r.credit_amount) || 0;
                const cashToPay = Math.max(0, total - creditAmt);
                // Force cash icon for the credits-only edge case — never
                // surface the wallet icon on its own, per product rule.
                const PMIcon = pm === 'card' ? CreditCard : Banknote;
                let priceText: string;
                if (isUpcoming) {
                  if (pm === 'card' || cashToPay === 0) {
                    priceText = t('orders.alreadyPaid', { defaultValue: 'Déjà payé' });
                  } else {
                    priceText = t('orders.toPayShort', { amount: fmtMoney(cashToPay), defaultValue: 'À payer : {{amount}} TND' });
                  }
                } else {
                  priceText = `${fmtMoney(total)} TND`;
                }
                return (
                  <>
                    <PMIcon size={13} color={theme.colors.textSecondary} />
                    {/* Explicit `Poppins_700Bold` (not just fontWeight: 700)
                        because Android sometimes doesn't render numeric
                        weights as visibly bold without the named family —
                        matches what the business interface does on its
                        collapsed price line so the two stay in sync. */}
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const, fontFamily: 'Poppins_700Bold' }}>
                      {priceText}
                    </Text>
                    {/* Basket-count chip — now on EVERY tab including
                        Upcoming. Previously gated to past tabs only on the
                        theory that pickup-countdown copy hinted quantity,
                        but the user wants the quantity surfaced
                        consistently across tabs (same shape as completed
                        / problems). Font matches the price text so the two
                        read as a single price-+-count cluster. */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                      <ShoppingBag size={14} color={theme.colors.textSecondary} />
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: '700' as const, fontFamily: 'Poppins_700Bold' }}>
                        {quantity}
                      </Text>
                    </View>
                  </>
                );
              })()}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {(() => {
                // Time-since-event: pick the timestamp that the buyer
                // actually cares about for THIS state.
                //   · upcoming → time since the buyer placed the order
                //                (created_at)
                //   · picked_up / cancelled → time since the terminal
                //                event landed; the backend bumps
                //                `updated_at = NOW()` in both UPDATE
                //                queries (pickup confirmation +
                //                cancellation), so updated_at is the
                //                event time
                //   · expired → trickier. The backend NEVER flips the
                //                row to status='expired' — it stays as
                //                'confirmed' or 'reserved' and the
                //                client renders "expired" via the
                //                overrideExpired prop when the pickup
                //                window has passed. So `updated_at` is
                //                still whenever the row was last
                //                modified (usually equal to created_at),
                //                NOT when expiry actually happened. We
                //                synthesise the expiry instant from the
                //                pickup window: reservation_date (or the
                //                date of created_at as fallback) joined
                //                with l.pickup_end_time → "yesterday at
                //                19:30" reads "il y a 14h" instead of
                //                "il y a 16h" (the original reservation
                //                time the user used to see).
                let evTime: string | null | undefined = r.created_at;
                if (status === 'expired' || overrideExpired) {
                  // Preferred source: synthesised expiry instant. Only valid
                  // when pickup_end_time is explicitly set AND lands in the
                  // past — captures the moment the window actually closed,
                  // which matches the user's "time since expiry" mental
                  // model even before the cron has flipped the row.
                  let resolved = false;
                  const dateBasis =
                    (r.reservation_date as string | undefined)
                    ?? (r.pickup_date as string | undefined)
                    ?? (r.created_at as string | undefined)
                    ?? null;
                  const endTime =
                    (r.pickup_end_time as string | undefined)
                    ?? (basket as any)?.pickup_end_time
                    ?? (r.basket?.pickupWindow as any)?.end
                    ?? null;
                  if (dateBasis && endTime) {
                    const datePart = String(dateBasis).substring(0, 10);
                    const timePart = String(endTime).substring(0, 5);
                    const synth = new Date(`${datePart}T${timePart}:00`);
                    if (!isNaN(synth.getTime()) && synth.getTime() <= Date.now()) {
                      evTime = synth.toISOString();
                      resolved = true;
                    }
                  }
                  // Synth failed (pickup_end_time missing, or its calendar
                  // instant landed in the future from a date-mismatch). Fall
                  // through to updated_at — for system-expired rows the
                  // cron-sweep UPDATE bumps updated_at = NOW() when it
                  // marks them, so this is the next-best expiry-acknowledged
                  // timestamp. Only honor it when it's clearly post-creation
                  // (more than a second past created_at) — otherwise it's
                  // just the row's last write at insert time and reads as
                  // "time since reservation", which is the bug we're fixing.
                  if (!resolved) {
                    const upd = r.updated_at as string | undefined;
                    const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
                    const updMs = upd ? new Date(upd).getTime() : 0;
                    if (updMs > createdMs + 1000) {
                      evTime = upd;
                    }
                  }
                } else if (!isUpcoming) {
                  // cancelled / picked_up / collected / completed → the
                  // terminal-state UPDATE always bumps updated_at, so it's
                  // the canonical event time.
                  evTime = (r.updated_at as string | undefined) || r.created_at;
                }
                return evTime ? (
                  <Text style={{ color: theme.colors.muted, ...theme.typography.caption }}>
                    {timeAgo(evTime, t)}
                  </Text>
                ) : null;
              })()}
              {/* Order ID code removed from collapsed — lives in the
                  expanded card now (top of the info block, paired with
                  the date). Keeps the collapsed row uncluttered. */}
            </View>
          </View>
        ) : null}
      </TouchableOpacity>

      {/* Expanded details */}
      {isExpanded && (
        <View>
          <View style={[styles.divider, { marginVertical: theme.spacing.md, backgroundColor: theme.colors.divider }]} />

          <View style={styles.details}>
            {/* Order ID + reservation date — paired on the same line so the
                expanded view carries the date that was removed from the
                collapsed card. Date is rendered as DD/MM/YYYY (fr-FR), same
                format the collapsed metadata row used to use. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption }}>
                {t('orders.orderId', { defaultValue: 'Commande' })} {orderIdToCode(reservation.id)}
              </Text>
              {orderDate && (
                <Text style={{ color: theme.colors.muted, ...theme.typography.caption }}>
                  {orderDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </Text>
              )}
            </View>
            {/* Info rows — UPCOMING keeps the green icon-row card so the
                buyer sees address + itinerary + payment as a single rich
                panel before pickup. PAST and ISSUES drop into a flat
                key/value layout that mirrors the business-side expanded
                order card: no thumbnail circles, no address, no pickup
                window — those facts don't help once the order is closed.
                The branch is rendered inline so a single divider above
                still applies to either layout. */}
            {!isUpcoming ? (
              <View style={{ paddingHorizontal: 2 }}>
                {(() => {
                  const pm = (r.payment_method ?? (reservation as any).payment_method) as 'cash' | 'card' | 'credits' | undefined;
                  const creditAmt = Number(r.credit_amount) || 0;
                  const isCard = pm === 'card';
                  const methodLabel = isCard
                    ? t('orders.paymentByCardShort', { defaultValue: 'En carte' })
                    : t('orders.paymentInCashShort', { defaultValue: 'En espèces' });
                  const cancelledBy = (r as any).cancelled_by as 'buyer' | 'business' | string | undefined;
                  const cancellationReason = ((r as any).cancellation_reason as string | undefined) ?? null;
                  const isCancelled = status === 'cancelled' && !overrideExpired;
                  const isExpired = status === 'expired' || overrideExpired;
                  const closedAt = r.updated_at ? new Date(r.updated_at as string) : null;
                  const fmtDateTime = (d: Date | null) => {
                    if (!d || isNaN(d.getTime())) return null;
                    const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                    return `${date} ${t('orders.atTime', { defaultValue: 'à' })} ${time}`;
                  };
                  const reservedDateTime = orderDate ? fmtDateTime(orderDate) : null;
                  const closedDateTime = fmtDateTime(closedAt);
                  const closedLabel = isPast
                    ? t('orders.pickedUpOnLabel', { defaultValue: 'Récupérée le' })
                    : isExpired
                    ? t('orders.expiredOnLabel', { defaultValue: 'Expirée le' })
                    : t('orders.cancelledOnLabel', { defaultValue: 'Annulée le' });
                  // Inline detail row: caption label on the left, value
                  // bold on the right. Same shape as the business expanded
                  // card's detailRow so the two surfaces visually rhyme.
                  const DetailRow: React.FC<{ label: string; value?: React.ReactNode; valueIsView?: boolean }> = ({ label, value, valueIsView }) => (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 6, gap: 12 }}>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, paddingTop: 2 }}>
                        {label}
                      </Text>
                      {valueIsView ? (
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>{value as any}</View>
                      ) : (
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1, textAlign: 'right' }}>
                          {value as any}
                        </Text>
                      )}
                    </View>
                  );
                  return (
                    <>
                      {reservedDateTime ? (
                        <DetailRow
                          label={t('business.orders.reservedAt', { defaultValue: 'Réservé le' })}
                          value={reservedDateTime}
                        />
                      ) : null}
                      {closedDateTime ? (
                        <DetailRow
                          label={closedLabel}
                          value={closedDateTime}
                        />
                      ) : null}
                      {isCancelled ? (
                        <DetailRow
                          label={t('orders.cancelledByLabel', { defaultValue: 'Annulée par' })}
                          value={cancelledBy === 'business'
                            ? t('orders.byBusinessLabel', { defaultValue: 'Le commerce' })
                            : t('orders.byYouLabel', { defaultValue: 'Vous-même' })}
                        />
                      ) : null}
                      {isCancelled && cancellationReason ? (() => {
                        // Cancellation reason ships from the backend as the raw
                        // form the cancel screen submitted — either a JSON
                        // {key,note} blob, a flat "key: note" string, or a bare
                        // key like "emergency". Without parsing, the row read
                        // "Motif emergency" instead of "Motif Urgence". Run it
                        // through the shared motif helpers (the same pair the
                        // business interface uses) so the key gets translated
                        // into the active locale and any free-text note is
                        // appended after the label. `author` is set to the
                        // canceller so a customer-written "Autre" reason picks
                        // up a "(du client)" tag.
                        const parsed = parseMotifRaw(cancellationReason);
                        const author = cancelledBy === 'business'
                          ? ('business' as const)
                          : cancelledBy === 'buyer'
                            ? ('customer' as const)
                            : null;
                        const display = motifDisplay(parsed.key, parsed.note, author, t as any);
                        return (
                          <DetailRow
                            label={t('orders.cancelReasonLabel', { defaultValue: 'Motif' })}
                            value={display}
                          />
                        );
                      })() : null}
                      <DetailRow
                        label={t('basket.quantityLabel', { defaultValue: 'Quantité' })}
                        value={`${quantity} ${quantity > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}`}
                      />
                      {total > 0 ? (
                        <DetailRow
                          label={t('orders.orderTotalLabel', { defaultValue: 'Prix de la commande' })}
                          value={`${fmtMoney(total)} TND`}
                        />
                      ) : null}
                      <DetailRow
                        label={t('business.orders.paymentMethod', { defaultValue: 'Paiement' })}
                        valueIsView
                        value={
                          <View style={{ alignItems: 'flex-end' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              {isCard ? (
                                <CreditCard size={13} color={theme.colors.textSecondary} />
                              ) : (
                                <Banknote size={13} color={theme.colors.textSecondary} />
                              )}
                              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }}>
                                {methodLabel}
                              </Text>
                            </View>
                            {creditAmt > 0 ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.primary + '14', borderRadius: theme.radii.pill, paddingHorizontal: 8, height: 22 }}>
                                  <Wallet size={11} color={theme.colors.primary} />
                                  <Text style={{ color: theme.colors.primary, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                                    {fmtMoney(creditAmt)} TND
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  onPress={() => {
                                    const credits = fmtMoney(creditAmt);
                                    const cancelledByLocal = (r as any).cancelled_by as 'buyer' | 'business' | string | undefined;
                                    const body = isPast
                                      ? t('orders.creditsInfoPastCollected', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. Cette commande est récupérée.' })
                                      : isExpired
                                      ? t('orders.creditsInfoPastExpired', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. La commande a expiré, vos crédits ont été perdus.' })
                                      : cancelledByLocal === 'business'
                                      ? t('orders.creditsInfoPastCancelledByBusiness', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. Le commerce a annulé la commande, vos crédits vous ont été restitués.' })
                                      : cancelledByLocal === 'buyer'
                                      ? t('orders.creditsInfoPastCancelledByBuyer', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. Vous avez annulé la commande, vos crédits ont été perdus.' })
                                      : t('orders.creditsInfoPastCancelledGeneric', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. La commande a été annulée.' });
                                    alert.showAlert(
                                      t('orders.creditsInfoTitle', { defaultValue: 'Crédits Barakeat utilisés' }),
                                      body,
                                      undefined,
                                      { type: 'info', layout: 'sheet' }
                                    );
                                  }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.colors.primary + '14', justifyContent: 'center', alignItems: 'center' }}
                                >
                                  <Info size={12} color={theme.colors.primary} />
                                </TouchableOpacity>
                              </View>
                            ) : null}
                          </View>
                        }
                      />
                    </>
                  );
                })()}
              </View>
            ) : (
            // Original UPCOMING layout — green icon-row card with address,
            // quantity, price, payment, pickup window.
            <View style={{ backgroundColor: '#114b3c08', borderRadius: 14, padding: 14, gap: 0 }}>
              {/* Row 1: Address + itinerary */}
              {address ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                    <MapPin size={13} color="#e3ff5c" />
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                    {address}
                  </Text>
                  <TouchableOpacity onPress={handleDirections} style={{ backgroundColor: '#114b3c', borderRadius: 10, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' }}>
                    <Navigation size={13} color="#e3ff5c" />
                  </TouchableOpacity>
                </View>
              ) : null}
              {/* Row 2 (consolidated): basket count · total order price.
                  Was two rows (Qty + Total) — collapsed into one to keep
                  the expanded card minimal per product feedback. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: address ? 1 : 0, borderTopColor: theme.colors.divider }}>
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                  <ShoppingBag size={13} color="#e3ff5c" />
                </View>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                  {quantity} {quantity > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}
                </Text>
              </View>
              {/* Order price — its own row so it reads cleanly. Just "Prix
                  de la commande : X TND". */}
              {total > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#e3ff5c', fontSize: 9, fontWeight: '700' }}>TND</Text>
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                    {t('orders.orderTotalLabel', { defaultValue: 'Prix de la commande' })} : {fmtMoney(total)} TND
                  </Text>
                </View>
              )}
              {/* Payment-method row — tab- and method-aware, on its OWN
                  line so it doesn't mix the "À payer" amount with the
                  credits already-applied amount (those were getting read
                  as part of "À payer" before, which was misleading).
                    UPCOMING:
                      · cash    → "À payer en espèces : (total − credits) TND"
                      · card    → "Déjà payé par carte"
                      · credits → "Payé entièrement en crédits"
                    PAST: "Récupéré · Payé : {total} TND" (transaction done)
                  The ⓘ button (right side) opens the personalized
                  credits-applied explainer sheet, scoped to this specific
                  order's payment flow. */}
              {(() => {
                // Two stacked rows replace what used to be one mixed-concept
                // line. Row A names the PAYMENT METHOD; Row B tells the
                // user what's still to do (or what happened).
                //   Row A — "Paiement en espèces (+ crédits)" / "Paiement
                //     par carte (+ crédits)". Cash or card icon — NEVER
                //     the wallet icon (the full-credit edge case is
                //     treated as cash with cashSlice=0, per the product
                //     rule "never label as 'en crédits' alone").
                //   Row B — context-dependent:
                //     · Upcoming + cash + remaining > 0 → "À payer à la
                //       récupération : X TND"
                //     · Upcoming + card OR remaining 0 → row skipped (the
                //       payment is done; no extra ask)
                //     · Terminées with updated_at → "Récupérée le DD/MM/YYYY"
                //     · Problèmes → status sentence ("Annulée par le
                //       client" / "Annulée par le commerce" / "Expirée")
                const pm = (r.payment_method ?? (reservation as any).payment_method) as 'cash' | 'card' | 'credits' | undefined;
                const creditAmt = Number(r.credit_amount) || 0;
                const cashSlice = Math.max(0, total - creditAmt);
                // pm='credits' is treated as cash here so the icon AND
                // method label always speak cash or card. The full-credit
                // case is conveyed by cashSlice=0 + Row B being skipped.
                const isCard = pm === 'card';
                const PMIcon = isCard ? CreditCard : Banknote;
                const methodLabel = isCard
                  ? (creditAmt > 0
                      ? t('orders.paymentByCardWithCredits', { defaultValue: 'Paiement par carte (+ crédits)' })
                      : t('orders.paymentByCard', { defaultValue: 'Paiement par carte' }))
                  : (creditAmt > 0
                      ? t('orders.paymentInCashWithCredits', { defaultValue: 'Paiement en espèces (+ crédits)' })
                      : t('orders.paymentInCash', { defaultValue: 'Paiement en espèces' }));
                const showInfo = creditAmt > 0;
                // Row B — what the user still has to DO, or what
                // HAPPENED. Reads `cancelled_by` (snake_case from backend,
                // accessed via the unknown-index signature on the type).
                const cancelledBy = (r as any).cancelled_by as 'buyer' | 'business' | string | undefined;
                let toDoLine: string | null = null;
                if (isUpcoming) {
                  if (!isCard && cashSlice > 0) {
                    toDoLine = t('orders.toPayAtPickup', { amount: fmtMoney(cashSlice), defaultValue: 'À payer à la récupération : {{amount}} TND' });
                  } else if (!isCard && cashSlice === 0 && creditAmt > 0) {
                    // Full-credits case — user paid the whole order with
                    // wallet credits; nothing left at pickup.
                    toDoLine = t('orders.paidEntirelyByCredits', { defaultValue: 'Réglée entièrement par crédits' });
                  }
                } else if (isPast) {
                  // Terminées — show pickup date if we have one.
                  if (r.updated_at) {
                    const d = new Date(r.updated_at as string);
                    if (!isNaN(d.getTime())) {
                      toDoLine = t('orders.collectedOn', { date: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }), defaultValue: 'Récupérée le {{date}}' });
                    }
                  }
                } else {
                  // Problèmes — explain the row's situation.
                  if (status === 'expired' || overrideExpired) {
                    toDoLine = t('orders.statusExpiredLong', { defaultValue: 'Expirée — non récupérée à temps' });
                  } else if (cancelledBy === 'buyer') {
                    toDoLine = t('orders.statusCancelledByBuyer', { defaultValue: 'Annulée par vous-même' });
                  } else if (cancelledBy === 'business') {
                    toDoLine = t('orders.statusCancelledByBusiness', { defaultValue: 'Annulée par le commerce' });
                  } else {
                    toDoLine = t('orders.statusCancelled', { defaultValue: 'Annulée' });
                  }
                }
                // Status-aware credits-info body. Six base branches +
                // three Problèmes sub-branches (buyer / business / expired)
                // for the "what happened to my credits?" story.
                const infoBody = (() => {
                  const credits = fmtMoney(creditAmt);
                  const cash = fmtMoney(cashSlice);
                  if (isUpcoming) {
                    if (isCard) return cashSlice > 0
                      ? t('orders.creditsInfoUpcomingCard', { credits, cash, defaultValue: 'Vous avez utilisé {{credits}} TND de vos crédits Barakeat. Le reste ({{cash}} TND) a été payé par carte au moment de la réservation.' })
                      : t('orders.creditsInfoUpcomingFull', { credits, defaultValue: 'Vous avez réglé toute la commande ({{credits}} TND) avec vos crédits Barakeat. Aucun paiement supplémentaire à la récupération.' });
                    return cashSlice > 0
                      ? t('orders.creditsInfoUpcomingCash', { credits, cash, defaultValue: 'Vous avez utilisé {{credits}} TND de vos crédits Barakeat. Il vous reste {{cash}} TND à payer en espèces à la récupération.' })
                      : t('orders.creditsInfoUpcomingFull', { credits, defaultValue: 'Vous avez réglé toute la commande ({{credits}} TND) avec vos crédits Barakeat. Aucun paiement supplémentaire à la récupération.' });
                  }
                  if (isPast) {
                    return t('orders.creditsInfoPastCollected', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. Cette commande est récupérée.' });
                  }
                  // Problèmes — three sub-branches by what ended the order
                  if (status === 'expired' || overrideExpired) {
                    return t('orders.creditsInfoPastExpired', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. La commande a expiré, vos crédits ont été perdus.' });
                  }
                  if (cancelledBy === 'business') {
                    return t('orders.creditsInfoPastCancelledByBusiness', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. Le commerce a annulé la commande, vos crédits vous ont été restitués.' });
                  }
                  if (cancelledBy === 'buyer') {
                    return t('orders.creditsInfoPastCancelledByBuyer', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. Vous avez annulé la commande, vos crédits ont été perdus.' });
                  }
                  return t('orders.creditsInfoPastCancelledGeneric', { credits, defaultValue: 'Vous aviez utilisé {{credits}} TND de vos crédits Barakeat. La commande a été annulée.' });
                })();
                return (
                  // Single combined Paiement row. The previous two rows
                  // (4a = method label, 4b = action/status line) became
                  // visual fluff once we had both — same icon column, same
                  // padding, just two short labels. Stacking them inside
                  // one row keeps both pieces of info but cuts the row
                  // count + the duplicate divider. The ⓘ stays on the
                  // right when credits were used.
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <PMIcon size={13} color="#e3ff5c" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' }}>
                        {methodLabel}
                      </Text>
                      {toDoLine ? (
                        <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 4 }}>
                          {toDoLine}
                        </Text>
                      ) : null}
                    </View>
                    {showInfo && (
                      <TouchableOpacity
                        onPress={() => {
                          alert.showAlert(
                            t('orders.creditsInfoTitle', { defaultValue: 'Crédits Barakeat utilisés' }),
                            infoBody,
                            undefined,
                            { type: 'info', layout: 'sheet' }
                          );
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.primary + '14', justifyContent: 'center', alignItems: 'center' }}
                      >
                        <Info size={13} color={theme.colors.primary} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })()}
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
            )}

            {/* Pickup code — dark div, only for upcoming */}
            {isUpcoming && pickupCode ? (
              <View
                ref={pickupCodeRef}
                onLayout={(e) => {
                  if (!isDemoCard) return;
                  // Mirror the payment-section fix: when the walkthrough is at
                  // (or about to advance to) customerPickupCode, this onLayout
                  // would publish the PRE-SCROLL rect — the user briefly sees
                  // the halo at the wrong y before the post-scroll 500 ms
                  // re-measure lands and snaps it into place. Skip publication
                  // here so the only publisher in the demo path is the
                  // post-scroll re-measure below. The layout overlay paints
                  // dim-only in the meantime, then the halo appears directly
                  // at the correct position.
                  const currentMeasureKey = useWalkthroughStore.getState().currentStep?.measureKey;
                  if (currentMeasureKey === 'customerPickupCode' || currentMeasureKey === 'customerOrderCard') return;
                  (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                    if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('customerPickupCode', { x, y, w, h });
                  });
                }}
                style={{ backgroundColor: '#114b3c', borderRadius: 14, padding: 14, marginTop: 10, alignItems: 'center' }}
              >
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
              <View style={{ flexDirection: 'row', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
                {/* Report + Review action pair. Both are now matching
                    outlined pills — flat surface, 1 px hairline border,
                    icon + label. The previous design had Report as a
                    thin ghost button and Review as a solid orange filled
                    button, which read as the "obvious bot-generated
                    flagship CTA" the user flagged. Treating them as
                    siblings (same shape, different accent) makes the
                    surface feel hand-tuned. Report keeps a neutral
                    border; Review's border + icon + label flip to the
                    accent so it still pulls more attention as the
                    primary post-pickup ask. */}
                {isPast && !hasReport && (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/claim', params: { reservationId: String(reservation.id), locationName: merchantName, basketName: basketTypeName } } as never)}
                    style={{
                      borderRadius: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      borderWidth: 1,
                      borderColor: theme.colors.divider,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <FlagIcon8 size={13} tintColor={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' as const, fontFamily: 'Poppins_600SemiBold' }}>
                      {t('orders.reportIssue', { defaultValue: 'Signaler' })}
                    </Text>
                  </TouchableOpacity>
                )}
                {isPast && !hasReview && !hasReport && (
                  <TouchableOpacity
                    onPress={() => {
                      const lid = String(r.location_id ?? r.restaurant_id ?? basket?.merchantId ?? '');
                      router.push({ pathname: '/review', params: { reservationId: String(reservation.id), locationId: lid, locationName: merchantName, locationLogo: r.restaurant?.image_url ?? r.restaurant_image ?? r.org_image_url ?? '', basketImage: basket?.image_url ?? (basket as any)?.imageUrl ?? (basket as any)?.cover_image_url ?? '', basketName: basketTypeName, quantity: String(quantity), total: String(total) } } as never);
                    }}
                    style={{
                      borderRadius: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      borderWidth: 1,
                      borderColor: theme.colors.primary,
                      backgroundColor: theme.colors.primary + '0E',
                    }}
                  >
                    <Star size={13} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600' as const, fontFamily: 'Poppins_600SemiBold' }}>
                      {t('orders.leaveReview')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {isUpcoming && onCancel && (() => {
                // Belt-and-suspenders guard. Even if a stale reservation
                // slipped past the orders-page partition (no pickup_end_time
                // resolvable, biz-day math fooled by an early-morning
                // calendar rollover, etc.), the Cancel button MUST NOT
                // render for a wall-clock-expired pickup — letting the user
                // "cancel" a dead order produces a confusing UX and a
                // pointless backend write. Same predicate the orders tab
                // uses; double-checking here costs nothing.
                const rawResDate = (r as any).pickup_date ?? (r as any).reservation_date;
                const resBizDate = typeof rawResDate === 'string' && rawResDate.length >= 10
                  ? rawResDate.substring(0, 10)
                  : ((r as any).created_at
                      ? getBusinessDayDateStr(new Date(String((r as any).created_at)))
                      : null);
                const todayBizDate = getBusinessDayDateStr(new Date());
                const end = (r as any).pickup_end_time
                  ?? (r as any).basket?.pickup_end_time
                  ?? (r as any).restaurant?.pickup_end_time
                  ?? null;
                const wallClockExpired =
                  (resBizDate && resBizDate < todayBizDate)
                  || (resBizDate === todayBizDate && end
                      ? isPickupExpiredInTz(String(end).substring(0, 5)) : false);
                if (wallClockExpired || overrideExpired) return null;
                return (
                  // Quiet destructive trigger — red text only, no bg/border.
                  // The real red confirm lives in the sheet that follows.
                  <TouchableOpacity
                    onPress={() => onCancel(reservation.id, quantity, String(r.location_id ?? r.restaurant_id ?? ''), merchantName, (r.payment_method ?? (reservation as any).payment_method) as any, Number((r as any).credit_amount) || 0)}
                    style={{ paddingHorizontal: 10, paddingVertical: 8 }}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Text style={{ color: theme.colors.error, fontSize: 13, fontFamily: 'Poppins_600SemiBold', fontWeight: '600' }}>
                      {t('orders.cancelBtn', { defaultValue: 'Annuler' })}
                    </Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>
        </View>
      )}
    </Animated.View>
  );
});

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
