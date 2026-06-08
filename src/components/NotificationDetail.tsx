/**
 * Shared notification detail card — used by both the notifications page modal
 * and the in-app popup overlay. Renders the exact same UI in both places.
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Linking, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShoppingBag, Star, XCircle, Bell, CheckCircle, Clock, MapPin, Navigation, User, MessageCircle, Zap, Flame, X as XIcon } from 'lucide-react-native';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationFromAPI } from '@/src/services/notifications';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchOrganization } from '@/src/services/teams';
import { motifDisplay, type MotifAuthor } from '@/src/utils/motif';
import { MotifText } from '@/src/components/MotifText';

function resolveNotifText(
  raw: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
  fallback = ''
): string {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.key === 'string') {
      const params = { ...(parsed.params ?? {}) };
      // Ensure 'location' param is always present — old notifications used 'locationName' instead
      if (!params.location) {
        params.location = params.locationName ?? params.restaurant ?? params.restaurantName ?? '';
      }
      // Backfill `count` from the legacy field names so old notifications (saved
      // before the i18next plural conversion) still pick the right _one/_other
      // variant instead of falling through to the missing base key.
      if (params.count == null) {
        params.count = params.quantity ?? params.qty ?? params.streak ?? params.rating;
      }
      const i18nKey = `notifications.${parsed.key}`;
      const translated = t(i18nKey, params);
      return translated !== i18nKey ? translated : fallback;
    }
  } catch {}
  const i18nKey = `notifications.${raw}`;
  const translated = t(i18nKey, {});
  if (translated !== i18nKey) return translated;
  // Last-resort fallback: if the caller passed a pre-translated string (e.g.
  // the demo walkthrough's notification popup), don't render blank. Render
  // the raw text itself — it's better than an empty card.
  return raw || fallback;
}

function timeAgo(dateStr: string, t: any): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return t('timeAgo.seconds', { count: diff });
  if (diff < 3600) return t('timeAgo.minutes', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('timeAgo.hours', { count: Math.floor(diff / 3600) });
  const days = Math.floor(diff / 86400);
  if (days < 7) return t('timeAgo.days', { count: days });
  if (days < 30) return t('timeAgo.weeks', { count: Math.floor(days / 7) });
  return t('timeAgo.months', { count: Math.floor(days / 30) });
}

function getNotifIcon(type?: string | null, title?: string | null) {
  const key = type ?? title ?? '';
  if (key.includes('order_confirmed') || key.includes('new_reservation'))
    return { Icon: ShoppingBag, color: '#114b3c', bg: '#114b3c18' };
  if (key.includes('basket_picked_up'))
    return { Icon: CheckCircle, color: '#22c55e', bg: '#22c55e18' };
  if (key.includes('pickup_confirmed') || key.includes('collected'))
    return { Icon: CheckCircle, color: '#22c55e', bg: '#22c55e18' };
  if (key.includes('cancelled'))
    return { Icon: XCircle, color: '#ef4444', bg: '#ef444418' };
  if (key.includes('review'))
    return { Icon: Star, color: '#f59e0b', bg: '#f59e0b18' };
  if (key.includes('message') || key.includes('reply'))
    return { Icon: MessageCircle, color: '#3b82f6', bg: '#3b82f618' };
  if (key.includes('streak'))
    return { Icon: Flame, color: '#FF6B35', bg: '#FF6B3518' };
  return { Icon: Bell, color: '#6b7280', bg: '#6b728018' };
}

interface NotificationDetailProps {
  notif: NotificationFromAPI;
  theme: any;
  t: any;
  isBusiness?: boolean;
  onClose: () => void;
  onAction?: () => void;
  /** When true, the action button gets a yellow-green halo border so the
   *  demo walkthrough can point the user at it inside the in-app popup. */
  demoHighlightAction?: boolean;
  /** Optional node rendered in the card header to the left of the X close
   *  button. The in-app popup uses this to inject a notifications-bell shortcut
   *  on single-popup mode. Undefined leaves the header layout unchanged. */
  topRightAction?: React.ReactNode;
}

export function NotificationDetail({ notif, theme, t, isBusiness, onClose, onAction, demoHighlightAction, topRightAction }: NotificationDetailProps) {
  const { Icon, color } = getNotifIcon(notif.type, notif.title);
  const queryClient = useQueryClient();
  // Screen-aware scroll height for the body. Reserve the card chrome (header +
  // action button + paddings ~150 px), the safe-area insets, plus headroom for
  // the in-app popup's extra chrome (the demo "Voir la commande" banner /
  // carousel indicator that can sit above the card, ~70 px) and a little screen
  // breathing room — so the WHOLE popup always fits on screen and the content
  // scrolls inside the body instead of the card overflowing and clipping the
  // bottom / action button (the cut-off the user hit on the new-reservation
  // popup). Floor at 160 so the body is always usable on tiny screens.
  const { height: winHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bodyMaxHeight = Math.max(160, winHeight - insets.top - insets.bottom - 250);
  const notifType = notif.type ?? '';
  const titleStr = notif.title ?? '';
  // Some backends route the discriminator through the message JSON's `key`
  // field instead of (or in addition to) `type` / `title`. Parse upfront and
  // include that key in the type checks so the rich pickup-confirmed UI
  // matches regardless of which field the backend populates.
  let msgParams: Record<string, any> = {};
  let msgKey = '';
  try {
    const parsed = JSON.parse(notif.message);
    if (parsed?.params) msgParams = parsed.params;
    if (typeof parsed?.key === 'string') msgKey = parsed.key;
  } catch {}
  const typeBlob = `${notifType} ${titleStr} ${msgKey}`.toLowerCase();
  const isNewReservation = typeBlob.includes('new_reservation') || typeBlob.includes('order_confirmed');
  const isCancelled = typeBlob.includes('cancelled');
  const isReview = typeBlob.includes('review');
  const isPickupConfirmed =
    typeBlob.includes('pickup_confirmed')
    || typeBlob.includes('basket_picked_up')
    || typeBlob.includes('collected')
    || typeBlob.includes('picked_up');
  // Match on `notifType` only (authoritative). The msgKey can't be used here
  // because the i18n convention `notif_message_*` makes every notification's
  // key contain the substring "message", which made every popup render the
  // chat block + "Voir la conversation" action.
  const isMessage =
    notifType.toLowerCase().includes('message')
    || notifType.toLowerCase().includes('reply');
  // Streak-about-to-expire — renders the flame medallion + a "Dernière
  // commande - <date>" chip + "Order Now" CTA so this popup fully replaces the
  // old standalone streak-warning modal.
  const isStreakExpiring = typeBlob.includes('streak_expiring');
  const streakDays = msgParams.streak ?? msgParams.streakDays ?? msgParams.count ?? null;
  // Last-order date: prefer the notification param; fall back to the cached
  // gamification stats (days_since_last_pickup) so older notifications that
  // shipped before the param was added still render a date.
  const lastOrderDate: Date | null = (() => {
    const raw = msgParams.last_order_date ?? msgParams.lastOrderDate ?? null;
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
    if (isStreakExpiring) {
      const gam = queryClient.getQueryData<any>(['gamification-stats']);
      const daysSince = gam?.days_since_last_pickup ?? gam?.stats?.days_since_last_pickup ?? null;
      if (daysSince != null) return new Date(Date.now() - Number(daysSince) * 86400000);
    }
    return null;
  })();
  const lastOrderDateStr = lastOrderDate
    ? lastOrderDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const basketName = msgParams.basketName ?? msgParams.basket_name ?? null;
  const locationName = msgParams.location ?? msgParams.locationName ?? msgParams.restaurantName ?? msgParams.restaurant_name ?? null;
  const customerName = msgParams.customerName ?? msgParams.customer_name ?? null;
  const pickupStart = msgParams.pickupStart ?? msgParams.pickup_start ?? null;
  const pickupEnd = msgParams.pickupEnd ?? msgParams.pickup_end ?? null;
  const pickupTime = msgParams.time ?? ((pickupStart && pickupEnd) ? `${String(pickupStart).substring(0,5)} – ${String(pickupEnd).substring(0,5)}` : null);
  const qty = msgParams.quantity ?? msgParams.qty ?? msgParams.count ?? null;
  const rating = msgParams.rating ?? null;
  const comment = msgParams.comment ?? msgParams.review ?? null;
  const price = msgParams.price ?? msgParams.total ?? msgParams.amount ?? null;
  const pickupCode = msgParams.code ?? msgParams.pickupCode ?? msgParams.pickup_code ?? null;
  const locationImage = msgParams.locationImage ?? msgParams.location_image ?? null;
  const basketImage = msgParams.basketImage ?? msgParams.basket_image ?? null;
  const notifAddress = msgParams.address ?? msgParams.restaurant_address ?? null;
  const senderName = msgParams.senderName ?? msgParams.sender_name ?? null;
  const messageText = msgParams.messageText ?? msgParams.message_text ?? null;
  // The cancellation reason is normally carried in the notification params,
  // but some backends omit it from the buyer's copy. Fall back to the matching
  // reservation in the React Query cache (keyed by the notif's reference_id),
  // which holds `cancellation_reason` — so the motif still renders. The raw
  // value can be a plain string or a JSON `{key, note}` blob; both are handled
  // by the same resolver below.
  const cachedReservationReason = (() => {
    if (notif.reference_id == null) return null;
    const lists = queryClient.getQueriesData<any[]>({ queryKey: ['reservations'] });
    for (const [, data] of lists) {
      if (!Array.isArray(data)) continue;
      const match = data.find((r: any) => r?.id === notif.reference_id || String(r?.id) === String(notif.reference_id));
      if (match?.cancellation_reason) return match.cancellation_reason as string;
    }
    return null;
  })();
  // Treat an empty/whitespace param reason as ABSENT (use `||`, not `??`) — the
  // backend ships `reason: ''` on a buyer's own cancellation, and we still want
  // to fall through to the reservation-cache reason so the motif renders.
  const paramReason = String(msgParams.reason ?? msgParams.cancellation_reason ?? '').trim();
  const cancellationReasonRaw: string | null = paramReason || cachedReservationReason || null;
  // Newer cancellation payloads ship a structured (key, note) pair so the
  // label can be translated into the recipient's locale (a French app user
  // reading a customer-cancellation notif should see "Autre" not the raw
  // "other" key). Older notifications — and the reservation-cache fallback —
  // ship the reason as a flat string: either a JSON `{key, note}` blob or a
  // "key: note" / bare-"key" form. Normalise all of them to (key, note) here
  // so the single translator below works for every shape.
  let cancellationReasonKey: string | null = msgParams.reason_key ?? msgParams.reasonKey ?? null;
  let cancellationReasonNote: string | null = msgParams.reason_note ?? msgParams.reasonNote ?? null;
  if (!cancellationReasonKey && typeof cancellationReasonRaw === 'string' && cancellationReasonRaw.trim().length > 0) {
    const rawTrim = cancellationReasonRaw.trim();
    if (rawTrim.startsWith('{')) {
      try {
        const parsedReason = JSON.parse(rawTrim);
        if (parsedReason && typeof parsedReason === 'object') {
          if (typeof parsedReason.key === 'string') cancellationReasonKey = parsedReason.key;
          if (typeof parsedReason.note === 'string') cancellationReasonNote = parsedReason.note;
        }
      } catch {}
    } else {
      // Flattened "key: note" (or bare "key"). The key never contains ": ",
      // so split on the first occurrence; the remainder is the free-text note.
      const sep = rawTrim.indexOf(': ');
      if (sep > 0) {
        cancellationReasonKey = rawTrim.slice(0, sep);
        cancellationReasonNote = rawTrim.slice(sep + 2);
      } else {
        cancellationReasonKey = rawTrim;
      }
    }
  }
  // Who authored the cancellation — derived from the message discriminator so
  // the motif can be tagged "(du commerce)" / "(du client)". The keys carrying
  // "business_cancelled" are the only business-authored ones; everything else
  // (buyer_cancellation, reservation_cancelled) is customer-authored.
  const cancelAuthor: MotifAuthor = isCancelled
    ? (typeBlob.includes('business_cancelled') ? 'business' : 'customer')
    : null;
  const cancellationReason = (cancellationReasonKey || cancellationReasonNote || cancellationReasonRaw)
    ? motifDisplay(cancellationReasonKey, cancellationReasonNote, cancelAuthor, t)
    : null;
  const paymentContext = msgParams.context ?? null; // 'cash' | 'refunded' | 'not_charged' | null
  const paymentMethodLabel = msgParams.payment_method_label ?? null;
  const refundAmount = msgParams.refund_amount ?? null;
  const ratingService = msgParams.rating_service ?? null;
  const ratingQuality = msgParams.rating_quality ?? null;
  const ratingQuantity = msgParams.rating_quantity ?? null;
  const ratingVariety = msgParams.rating_variety ?? null;

  // Order-summary qty/price line shared between the pickup-confirmed and
  // the cancellation summary divs. Robust to a missing field so the line
  // never renders as orphan "1 × " when the backend payload skipped the
  // price (the old cancellation div did exactly that).
  const qtyNum = qty != null ? Number(qty) : null;
  const priceNum = price != null ? Number(price) : null;
  const basketWord = (qtyNum ?? 1) > 1
    ? t('basket.baskets', { defaultValue: 'paniers' })
    : t('basket.basket', { defaultValue: 'panier' });
  const qtyPriceLine: string | null = (() => {
    if (qtyNum != null && priceNum != null) {
      const total = qtyNum > 1 ? (priceNum * qtyNum).toFixed(2) : priceNum;
      return `${qtyNum} × ${total} TND`;
    }
    if (priceNum != null) return `${priceNum} TND`;
    if (qtyNum != null) return `${qtyNum} ${basketWord}`;
    return null;
  })();

  // Single source of truth for the panier-récupéré "order summary" div —
  // basket image (56×56), basket name, qty × price. Called from BOTH the
  // pickup-confirmed render and the cancellation render so the two cards
  // are pixel-identical except for the borderColor passed in (green tint
  // for pickup-confirmed, red for cancellation). Falls back to a neutral
  // placeholder when the backend payload is sparse so the card never
  // disappears entirely.
  const renderOrderSummary = (borderColor: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, backgroundColor: '#114b3c08', borderRadius: 14, padding: 14, borderWidth: 1, borderColor }}>
      {basketImage ? (
        <Image
          source={{ uri: basketImage }}
          style={{ width: 56, height: 56, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider }}
          resizeMode="cover"
        />
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: theme.colors.divider, justifyContent: 'center', alignItems: 'center' }}>
          <ShoppingBag size={22} color={theme.colors.textSecondary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        {basketName ? (
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' }} numberOfLines={1}>
            {basketName}
          </Text>
        ) : null}
        {qtyPriceLine ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }}>
            {qtyPriceLine}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const hasAction = isNewReservation || isReview || isPickupConfirmed || isMessage;

  // Pickup-confirmed notifs from the backend don't carry org branding, so
  // chain TWO lookups:
  //   1. /api/locations/:id  → resolves display_name and organization_id
  //   2. /api/teams/organizations/:orgId  → resolves the canonical org name
  //                                          and the organization's LOGO
  // Order summary uses the basket image (msgParams.basketImage); row 1 shows
  // the org logo + org name on top + location name beneath.
  // The org-branding header (org logo + name + location) now sits at the top
  // of EVERY customer notification popup, so the location/org lookups run for
  // any customer notif that carries a location_id — not just pickup-confirmed.
  const locId = msgParams.location_id ?? msgParams.locationId ?? null;
  const locationQuery = useQuery({
    queryKey: ['location-photo', locId],
    queryFn: () => fetchLocationById(String(locId)),
    enabled: !isBusiness && locId != null,
    staleTime: 60_000,
  });
  const orgId = locationQuery.data?.organization_id ?? null;
  const organizationQuery = useQuery({
    queryKey: ['organization', orgId],
    queryFn: () => fetchOrganization(String(orgId)),
    enabled: !isBusiness && orgId != null,
    staleTime: 5 * 60_000,
  });
  // Prefer the ORG logo (brand identity). Backend-provided org_logo_url wins
  // because it has no query latency — the chained location/org lookups stay as
  // graceful fallbacks for older notifications saved before the payload was
  // enriched.
  const effectiveOrgImage =
    msgParams.org_logo_url
    ?? organizationQuery.data?.image_url
    ?? locationQuery.data?.cover_image_url
    ?? locationQuery.data?.image_url
    ?? locationImage
    ?? null;
  const effectiveOrgName =
    msgParams.org_name
    ?? organizationQuery.data?.name
    ?? locationQuery.data?.org_name
    ?? null;
  const effectiveLocationName =
    locationQuery.data?.display_name
    ?? locationQuery.data?.name
    ?? locationName
    ?? null;

  // Shared org-branding header — circular org logo + org name (top) /
  // location name (bottom). Rendered at the TOP of every CUSTOMER notification
  // popup (the business is already inside its own org, so the brand chip would
  // be redundant there). Returns null when there's no org/location context to
  // show so generic notifs (streak, wallet, etc.) don't get an empty chip.
  const renderOrgHeader = () => {
    if (isBusiness) return null;
    if (!effectiveOrgImage && !effectiveOrgName && !effectiveLocationName) return null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {effectiveOrgImage ? (
          <Image
            source={{ uri: effectiveOrgImage }}
            style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: theme.colors.divider }}
          />
        ) : (
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary + '14', justifyContent: 'center', alignItems: 'center' }}>
            <MapPin size={24} color={theme.colors.primary} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          {effectiveOrgName ? (
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' }} numberOfLines={1}>
              {effectiveOrgName}
            </Text>
          ) : null}
          {effectiveLocationName && effectiveLocationName !== effectiveOrgName ? (
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }} numberOfLines={1}>
              {effectiveLocationName}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <PaperSurface radius={20} style={{ width: '100%', maxWidth: 420, borderLeftWidth: 4, borderLeftColor: color }}>
      {/* The card's actual LEFT BORDER is thickened and tinted by notification
          type (no overlay strip) so the type signal reads as part of the popup
          frame rather than a line floating on top of it. */}
      {/* Header — everything on ONE centered line so the type logo (left),
          title, the relative time, the optional bell shortcut, and the close
          button all align vertically. The time sits inline before the action
          buttons instead of on its own line under the title. The type icon is
          tinted with the notification's color. */}
      <View style={{ paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon size={22} color={color} />
        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 16, fontFamily: 'Poppins_700Bold', letterSpacing: -0.2 }}>
          {notif.title ? resolveNotifText(notif.title, t) : ''}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular' }}>
          {timeAgo(notif.created_at, t)}
        </Text>
        {topRightAction}
        <TouchableOpacity
          onPress={onClose}
          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.surfaceMuted, justifyContent: 'center', alignItems: 'center' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <XIcon size={17} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
        <ScrollView showsVerticalScrollIndicator={true} style={{ maxHeight: bodyMaxHeight }} contentContainerStyle={{ paddingBottom: 0 }}>
          {/* Org-branding header (org logo + name + location) at the very top
              of every customer popup. Customer-only; returns null when there's
              no org context. */}
          {renderOrgHeader()}

          {/* Top image header — only rendered for the legacy "other" types
              (review, message, etc.). New-reservation, cancellation, and
              pickup-confirmed each render their own basket-centric image
              inside their respective body blocks below. */}
          {(locationImage || basketImage) && !isPickupConfirmed && !isCancelled && !isNewReservation ? (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16, justifyContent: 'center' }}>
              {locationImage ? <Image source={{ uri: locationImage }} style={{ width: 70, height: 70, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" /> : null}
              {basketImage && basketImage !== locationImage ? <Image source={{ uri: basketImage }} style={{ width: 70, height: 70, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" /> : null}
            </View>
          ) : null}

          {/* Message — rendered for every type EXCEPT the customer-side
              pickup_confirmed, which uses its own "How was your experience?"
              prompt block below. The business-side pickup_confirmed
              ('panier récupéré') DOES render this line because the user
              wants the "{customerName} a récupéré {count} panier(s) chez
              {Org - location}" header to sit above the order-summary card. */}
          {!(isPickupConfirmed && !isBusiness) && (
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22, marginBottom: 12 }}>
              {resolveNotifText(notif.message, t)}
            </Text>
          )}

          {/* Streak-expiring — same content as the old standalone warning:
              a flame medallion + the day-streak chip. The "Order Now" CTA is
              rendered by the shared action button below. */}
          {isStreakExpiring && (
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FF6B3518', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
                <Flame size={32} color="#FF6B35" />
              </View>
              {streakDays != null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF6B3515', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, gap: 6, marginBottom: 8 }}>
                  <Flame size={16} color="#FF6B35" />
                  <Text style={{ color: '#FF6B35', ...theme.typography.body, fontWeight: '700' }}>
                    {streakDays} {t('streak.days', { count: Number(streakDays), defaultValue: 'jours de série' })}
                  </Text>
                </View>
              ) : null}
              {lastOrderDateStr ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF6B3515', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, gap: 6 }}>
                  <Clock size={16} color="#FF6B35" />
                  <Text style={{ color: '#FF6B35', ...theme.typography.body, fontWeight: '700' }}>
                    {t('streak.lastOrder', { defaultValue: 'Dernière commande' })} - {lastOrderDateStr}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Order confirmed details */}
          {(isNewReservation || notifType.includes('order_confirmed')) && (
            <>
              {basketName && (
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700', marginBottom: 12 }}>
                  {basketName}{locationName ? ` — ${locationName}` : ''}
                </Text>
              )}
              {basketImage ? (
                <View style={{ marginBottom: 14 }}>
                  <Image
                    source={{ uri: basketImage }}
                    style={{ width: '100%', height: 140, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }}
                    resizeMode="cover"
                  />
                </View>
              ) : null}
              <View style={{ backgroundColor: '#114b3c08', borderRadius: 14, padding: 14, marginBottom: 16, gap: 0, borderWidth: 1, borderColor: '#114b3c1f' }}>
                {isBusiness && customerName ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <User size={13} color="#e3ff5c" />
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>{customerName}</Text>
                  </View>
                ) : null}
                {notifAddress ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: (isBusiness && customerName) ? 1 : 0, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <MapPin size={13} color="#e3ff5c" />
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }} numberOfLines={1}>{notifAddress}</Text>
                    <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(notifAddress)}`)} style={{ backgroundColor: '#114b3c', borderRadius: 10, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' }}>
                      <Navigation size={13} color="#e3ff5c" />
                    </TouchableOpacity>
                  </View>
                ) : null}
                {qty ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <ShoppingBag size={13} color="#e3ff5c" />
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                      {qty} {Number(qty) > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}
                    </Text>
                  </View>
                ) : null}
                {price && !isCancelled ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: '#e3ff5c', fontSize: 9, fontFamily: 'Poppins_700Bold' }}>TND</Text>
                    </View>
                    <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', flex: 1 }}>
                      {Number(qty ?? 1) > 1 ? (Number(price) * Number(qty ?? 1)).toFixed(2) : price} TND
                    </Text>
                  </View>
                ) : null}
                {pickupTime ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <Clock size={13} color="#e3ff5c" />
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                      {t('notifications.pickupAt', { defaultValue: 'Retrait' })} : {pickupTime}
                    </Text>
                  </View>
                ) : null}
              </View>
              {pickupCode ? (
                <View style={{ backgroundColor: '#114b3c', borderRadius: 16, padding: 18, marginBottom: 16, alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.caption, marginBottom: 6 }}>
                    {t('reserve.success.pickupCode', { defaultValue: 'Code de retrait' })}
                  </Text>
                  <Text style={{ color: '#e3ff5c', fontSize: 28, fontFamily: 'Poppins_700Bold', letterSpacing: 6 }}>{pickupCode}</Text>
                </View>
              ) : null}
            </>
          )}

          {/* Cancelled — REUSES the pickup-confirmed Row 2 summary card
              verbatim (same green tint, same image + name + qty × price
              layout) but with a RED border to signal the cancellation.
              Motif is rendered as plain red text BELOW the card, not inside
              a callout box. Identical for customer and business surfaces;
              the text ABOVE the card (the message line) is what carries
              the surface-specific copy. */}
          {isCancelled ? renderOrderSummary('#ef4444') : null}
          {isCancelled && cancellationReason ? (
            <View style={{ marginBottom: 16 }}>
              {/* "Motif : <reason>" — the label in semibold, the reason in the
                  regular body weight. Collapses past 2 lines with a "Voir
                  plus" toggle when the reason is long. */}
              <MotifText
                label={`${t('notifications.cancellationReasonLabel', { defaultValue: 'Motif' })} : `}
                value={cancellationReason}
                textStyle={{ ...theme.typography.bodySm, lineHeight: 18 }}
                color="#ef4444"
                linkColor="#ef4444"
                collapsedLines={2}
                t={t}
              />
            </View>
          ) : null}

          {/* Payment context — explains the refund / no-charge state to the
              buyer when the business cancels. Rendered as a calm paragraph
              under the red callout so it reads as informational rather than
              alarming. Only shown when the backend provided a context. */}
          {isCancelled && paymentContext && paymentContext !== 'default' ? (
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20, marginBottom: 16 }}>
              {t(
                `notifications.cancellation_payment_${paymentContext}`,
                {
                  payment_method_label: paymentMethodLabel ?? '',
                  refund_amount: refundAmount ?? '',
                  defaultValue: '',
                }
              )}
            </Text>
          ) : null}

          {/* Pickup confirmed / basket picked up — rich summary card.
                Customer ("Retrait confirmé"): "Bravo !" text ABOVE the order
                  summary card (the two were switched on request), then the
                  Laisser-un-avis CTA below.
                Business ("Panier récupéré"): order summary first, with the
                  "Bravo !" congratulation BELOW it.
                The org-branding header (org logo + name + location) now sits at
                the very top of the popup for every customer notification, so it
                is no longer rendered inside this block. */}
          {isPickupConfirmed && (
            <View style={{ marginBottom: 16 }}>
              {!isBusiness ? (
                <>
                  {/* Customer — "Bon Appétit !" greeting first, order summary
                      beneath it. (Business keeps "Bravo !" below.) */}
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 6 }}>
                    {t('notifications.bonAppetitTitle', { defaultValue: 'Bon Appétit !' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20, marginBottom: 14 }}>
                    {t('notifications.bravoCustomerDesc', { location: effectiveLocationName ?? '', defaultValue: `Votre retrait chez ${effectiveLocationName ?? ''} est terminé. Voulez-vous partager votre expérience ?` })}
                  </Text>
                  {renderOrderSummary('#114b3c1f')}
                </>
              ) : (
                <>
                  {/* Business — order summary first, Bravo congratulation below. */}
                  {renderOrderSummary('#114b3c1f')}
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 14, marginBottom: 6 }}>
                    {t('notifications.bravoTitle', { defaultValue: 'Bravo !' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20 }}>
                    {t('notifications.bravoBusinessDesc', { defaultValue: 'Vous avez transformé un invendu en revenu tout en protégeant l\'environnement. Continuez à réduire le gaspillage alimentaire avec Barakeat !' })}
                  </Text>
                </>
              )}
            </View>
          )}

          {/* Review */}
          {isReview && (
            <View style={{ backgroundColor: '#f59e0b10', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#f59e0b33' }}>
              {customerName ? <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700', marginBottom: 10 }}>{customerName}</Text> : null}
              {rating ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }}>
                  {[1,2,3,4,5].map(s => <Star key={s} size={22} color="#f59e0b" fill={s <= Math.round(Number(rating)) ? '#f59e0b' : 'transparent'} />)}
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700', marginLeft: 8 }}>{Number(rating).toFixed(1)}</Text>
                </View>
              ) : null}
              {comment ? (
                <View style={{ borderTopWidth: 1, borderTopColor: '#f59e0b30', paddingTop: 10 }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontStyle: 'italic', lineHeight: 20 }}>« {comment} »</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Generic detail rows — for types not covered above */}
          {!isNewReservation && !isReview && !isMessage && !isPickupConfirmed && !isCancelled && !isStreakExpiring && (basketName || locationName || customerName || qty || price) ? (
            <View style={{ backgroundColor: theme.colors.bg, borderRadius: 14, padding: 16, marginBottom: 16, gap: 12, borderWidth: 1, borderColor: theme.colors.border }}>
              {basketName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.basket', { defaultValue: 'Panier' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }} numberOfLines={1}>{basketName}</Text>
                </View>
              ) : null}
              {locationName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.location', { defaultValue: 'Commerce' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }} numberOfLines={1}>{locationName}</Text>
                </View>
              ) : null}
              {customerName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.customer', { defaultValue: 'Client' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>{customerName}</Text>
                </View>
              ) : null}
              {qty ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.quantity', { defaultValue: 'Quantité' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>{qty}</Text>
                </View>
              ) : null}
              {price ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.price', { defaultValue: 'Prix' })}</Text>
                  <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', flex: 2, textAlign: 'right' }}>{price} TND</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Message */}
          {isMessage ? (
            <View style={{ backgroundColor: '#3b82f610', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#3b82f626' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: messageText ? 12 : 0 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#3b82f620', justifyContent: 'center', alignItems: 'center' }}>
                  <MessageCircle size={18} color="#3b82f6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' }}>
                    {senderName || t('notifications.someone', { defaultValue: 'Quelqu\'un' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                    {t('notifications.messageReceived', { defaultValue: 'vous a envoyé un message' })}
                  </Text>
                </View>
              </View>
              {messageText ? (
                <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#3b82f620' }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 20 }}>
                    {messageText}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* Action button — close lives in the header X now. Sits just below the
            last content block (content blocks carry a ~16px trailing margin, so
            a small marginTop keeps the button close without crowding it). */}
        {onAction ? (
          <View style={demoHighlightAction
            ? { marginTop: 6, borderRadius: 17, borderWidth: 3, borderColor: '#e3ff5c' }
            : { marginTop: 6 }}>
            <TouchableOpacity onPress={onAction} style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
              {/* Pickup-confirmed → "Laisser un avis": prefix the label with a
                  filled star so the CTA reads as a review action at a glance
                  (matches the star usage on the review screen). All other
                  branches keep the plain label. */}
              {isPickupConfirmed && !isBusiness ? (
                <Star size={18} color="#fff" fill="#fff" />
              ) : isStreakExpiring ? (
                <Flame size={18} color="#fff" fill="#fff" />
              ) : null}
              <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                {isMessage ? t('notifications.viewConversation', { defaultValue: 'Voir la conversation' })
                  : isPickupConfirmed && !isBusiness ? t('notifications.leaveReview', { defaultValue: 'Laisser un avis' })
                  : isStreakExpiring ? t('streak.orderNow', { defaultValue: 'Commander' })
                  : isReview ? t('notifications.viewDashboard', { defaultValue: 'Tableau de bord' })
                  : isCancelled ? t('notifications.viewOrder', { defaultValue: 'Voir les commandes' })
                  : t('notifications.viewOrder', { defaultValue: 'Voir la commande' })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </PaperSurface>
  );
}
