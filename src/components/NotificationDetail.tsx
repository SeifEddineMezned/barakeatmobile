/**
 * Shared notification detail card — used by both the notifications page modal
 * and the in-app popup overlay. Renders the exact same UI in both places.
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Linking, useWindowDimensions, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShoppingBag, Star, XCircle, Bell, CheckCircle, Clock, MapPin, Navigation, User, MessageCircle, Zap, Flame, X as XIcon, Banknote, CreditCard, Info, QrCode } from 'lucide-react-native';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationFromAPI } from '@/src/services/notifications';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchOrganization } from '@/src/services/teams';
import { motifDisplay, type MotifAuthor } from '@/src/utils/motif';
import { MotifText } from '@/src/components/MotifText';
import { orderIdToCode } from '@/src/utils/orderCode';
import { adminBroadcastContent } from '@/src/utils/adminBroadcast';

function resolveNotifText(
  raw: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
  fallback = '',
  // Override values for specific interpolation params. The caller injects
  // `location: "Org Name - Location Name"` here once it has resolved the
  // org context, so EVERY notif title/body gets the org-prefixed location
  // string regardless of which i18n key fires.
  overrideParams: Record<string, unknown> = {},
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
      // Caller overrides win — non-empty values only, so an override of ''
      // doesn't blank out a legitimate fallback location string.
      for (const [k, v] of Object.entries(overrideParams)) {
        if (v != null && v !== '') params[k] = v;
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

// Build the canonical "Org — Location" display string. Returns just one
// side if the other is missing, and never returns a dash with empty
// halves. Used everywhere a notif surface needs to refer to "the place".
//
// Defensive strip: when locationName already starts with "<orgName> - "
// (the /api/locations endpoint's `display_name` field IS pre-joined
// "Org Name - Location Name"; older notif payloads may also carry that
// compound form in `locationName`), peel the org prefix off so we don't
// emit "Org - Org - Location". The user reported this triple-name leak in
// every notif popup that fell back to display_name when location_name
// wasn't on the row.
function formatOrgLocation(orgName?: string | null, locationName?: string | null): string {
  const o = orgName?.trim() ?? '';
  let l = locationName?.trim() ?? '';
  if (o && l) {
    const prefix = `${o} - `;
    if (l.startsWith(prefix)) l = l.slice(prefix.length);
  }
  if (o && l && o !== l) return `${o} - ${l}`;
  return o || l || '';
}

function timeAgo(dateStr: string, t: any): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  // Under a minute reads "À l'instant" on the popup (this component) — the
  // notifications-LIST cards keep their own timeAgo (seconds) in notifications.tsx.
  if (diff < 60) return t('timeAgo.justNow', { defaultValue: "À l'instant" });
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
  if (key.includes('low_stock'))
    return { Icon: Clock, color: '#f59e0b', bg: '#f59e0b18' };
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
  /** Extra vertical chrome the CALLER has rendered above/below this card
   * inside the same modal (demo instruction banner, carousel paginator,
   * etc.). The scrollable body shrinks by this amount so the WHOLE popup
   * — including the caller's chrome — still fits on small phones. Pre-fix
   * the new-order demo notif rendered a ~85 px banner above the card; on
   * iPhone SE the bottom action button slid under the home indicator. */
  outerReservedHeight?: number;
  /** When true, the action button gets a yellow-green halo border so the
   *  demo walkthrough can point the user at it inside the in-app popup. */
  demoHighlightAction?: boolean;
  /** Optional node rendered in the card header to the left of the X close
   *  button. The in-app popup uses this to inject a notifications-bell shortcut
   *  on single-popup mode. Undefined leaves the header layout unchanged. */
  topRightAction?: React.ReactNode;
}

export function NotificationDetail({ notif, theme, t, isBusiness, onClose, onAction, outerReservedHeight = 0, demoHighlightAction, topRightAction }: NotificationDetailProps) {
  const { Icon } = getNotifIcon(notif.type, notif.title);
  const queryClient = useQueryClient();
  // Cap the WHOLE popup card so the inner ScrollView (declared below
  // with flex shrink + minHeight 0) reliably absorbs the overflow. See
  // popupMaxHeight on the PaperSurface around line 559 for the rationale
  // — the old per-ScrollView maxHeight setup left the parent View free
  // to grow past the screen for the longer business notif types
  // (new_reservation, basket_picked_up) and the body refused to scroll.
  const { height: winHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
  // Order expired (cron-flipped, not a deliberate cancel). Carries the
  // pickup code + reservation_id in params so the popup can flash a "if
  // you're really close, here's your code and QR — try the venue" panel
  // that the customer can show at the counter (the merchant can still
  // confirm late via the scan-qr override). The flag is intentionally
  // matched on the notif key / type and NOT just typeBlob.includes
  // ('expired') so a future "subscription_expired" / "code_expired" etc.
  // doesn't accidentally route here.
  const isOrderExpired = notifType === 'order_expired'
    || msgKey === 'notif_message_order_expired'
    || typeBlob.includes('order_expired');
  // Pickup-window-edge customer notifs (~1h-before-start reminder, ~1h-
  // before-end last call, merchant-granted extension). They all render
  // through the generic detail-rows fallback below. The popup's org
  // header already shows "{Org} - {Location}" at the top, so the
  // "Commerce: …" row inside the detail card is a duplicate for these
  // three types — hidden via this flag. If no quantity is in the params
  // (the cron only sends location + time for these), the row swaps to a
  // "Quantité: 1" line so the slot doesn't go empty.
  const isPickupWindowEdgeNotif = typeBlob.includes('pickup_reminder')
    || typeBlob.includes('pickup_closing')
    || typeBlob.includes('pickup_extended');
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
  // Admin/platform broadcast — title/message come from the admin (multilingual
  // blob, resolved to the CURRENT app language), so render them directly, show
  // the Barakeat logo instead of the bell, surface the attached image, and hide
  // the action button (there's nothing to open).
  const isAdminBroadcast = notifType.toLowerCase().includes('admin_broadcast')
    || notifType.toLowerCase().includes('broadcast')
    || notifType.toLowerCase().includes('announcement');
  const broadcast = isAdminBroadcast ? adminBroadcastContent(notif) : null;
  const broadcastTitle = broadcast?.title ?? '';
  const broadcastBody = broadcast?.body ?? '';
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
  // Pickup codes are always rendered as 6-character chips across the app;
  // older notifications still carry the legacy 8-char value in their
  // payload, so we clip on read so the displayed code matches what the
  // customer sees on the order card and what the merchant types in.
  const pickupCodeRaw = msgParams.code ?? msgParams.pickupCode ?? msgParams.pickup_code ?? null;
  const pickupCode = pickupCodeRaw ? String(pickupCodeRaw).substring(0, 6).toUpperCase() : null;
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

  // Order-confirmed payment context — mirrors the combined Paiement row
  // on the customer ReservationCard. Reads paymentMethod and creditAmount
  // from msgParams first (the new-reservation notif now carries them),
  // then falls back to the freshly-created reservation in React Query's
  // cache so older payloads still render the row correctly.
  const cachedReservationForPayment = (() => {
    if (notif.reference_id == null) return null;
    const lists = queryClient.getQueriesData<any[]>({ queryKey: ['reservations'] });
    for (const [, data] of lists) {
      if (!Array.isArray(data)) continue;
      const match = data.find((r: any) => r?.id === notif.reference_id || String(r?.id) === String(notif.reference_id));
      if (match) return match;
    }
    return null;
  })();
  const orderPaymentMethod: 'cash' | 'card' | 'credits' = (
    msgParams.payment_method ?? msgParams.paymentMethod
    ?? cachedReservationForPayment?.payment_method
    ?? 'cash'
  ) as 'cash' | 'card' | 'credits';
  const orderCreditAmount = Number(
    msgParams.credit_amount ?? msgParams.creditAmount
    ?? cachedReservationForPayment?.credit_amount
    ?? 0
  );
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
    // Was customer-only — bumped to ALSO fire on the business side so the
    // org/location lookup is available for the new "Org — Location" label
    // that goes into every notif title/body and into the renderOrgHeader
    // chip. The queries are React-Query-cached, so the per-tab business
    // notifs all share one location fetch.
    enabled: locId != null,
    staleTime: 60_000,
  });
  const orgId = locationQuery.data?.organization_id ?? null;
  const organizationQuery = useQuery({
    queryKey: ['organization', orgId],
    queryFn: () => fetchOrganization(String(orgId)),
    // `/api/teams/organizations/:id` is membership-gated — only org
    // members can hit it. The customer's account is NEVER a member of a
    // partner org, so firing this for them produces the noisy
    //   [API] Error: 403 Not a member of this organization
    //   /api/teams/organizations/<id>
    // line on EVERY notif popup open. The customer surface already has
    // two safer fallbacks for the org logo + name — msgParams.org_*
    // (the cron writes those into the notif body for every modern type)
    // and locationQuery.data?.org_name (public /api/locations row) —
    // so skipping the teams call costs nothing visually. Gated to
    // business recipients, who genuinely need the canonical org record
    // for surfaces that show team-only fields.
    enabled: orgId != null && !!isBusiness,
    staleTime: 5 * 60_000,
  });
  // QR code for order_expired notifications. Lazy-fetched per reservation
  // so the QR only renders for expired orders (gated by isOrderExpired
  // via enabled below). Cached 5 min so reopening the popup doesn't refetch.
  // The backend returns a data-URL string; <Image source={{uri}}> renders
  // it directly.
  //
  // qrExpanded mirrors the ReservationCard pattern — the QR isn't shown
  // upfront; instead the customer taps a small QrCode button next to the
  // pickup code text and the image expands inline. Both sides (popup and
  // bell-list detail) share this state so the customer's choice persists
  // as the popup re-renders on other re-fetches.
  const qrReservationId = notif.reference_id ?? null;
  const [qrExpanded, setQrExpanded] = React.useState(false);
  const qrQuery = useQuery({
    // Only fetch once the user actually wants to see the QR — keeps the
    // popup-open round-trip light for the common "I just saw the push
    // and dismissed it" path.
    queryKey: ['notif-qr', qrReservationId],
    queryFn: async () => {
      const { fetchReservationQRCode } = require('@/src/services/reservations');
      return fetchReservationQRCode(String(qrReservationId));
    },
    enabled: isOrderExpired && qrExpanded && qrReservationId != null,
    staleTime: 5 * 60_000,
    retry: 1,
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
    // location_name is the PLAIN location name on the /api/locations row
    // (e.g. "Centre Ville"). `display_name` and `name` are pre-joined
    // "Org Name - Location Name" — useful for one-line labels elsewhere,
    // but here it would double up with effectiveOrgName below and produce
    // "Org — Org - Location". Prefer the plain form; fall through to the
    // compound (formatOrgLocation strips the org prefix defensively).
    locationQuery.data?.location_name
    ?? locationQuery.data?.display_name
    ?? locationQuery.data?.name
    ?? locationName
    ?? null;

  // Canonical "Org — Location" string injected as the `location` override
  // into every resolveNotifText call below. Means every i18n template
  // that uses {{location}} renders the full "Org Name - Location Name"
  // pair instead of just the location name on its own — applies to both
  // title and body, customer and business sides. Falls back gracefully
  // when only one of the two is known.
  const orgLocationLabel = formatOrgLocation(effectiveOrgName, effectiveLocationName);
  const titleOverrides = orgLocationLabel ? { location: orgLocationLabel } : {};

  // Shared org-branding header — circular org logo + org name (top) /
  // location name (bottom). Rendered at the TOP of every notification
  // popup that carries org/location context, regardless of role. Was
  // customer-only previously; bumped to render on business too so the
  // merchant can see WHICH of their locations the notif is about (some
  // orgs run multiple). Returns null when there's no org/location
  // context (streak / wallet / generic notifs).
  const renderOrgHeader = () => {
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

  // Hard upper bound on the WHOLE popup card (title bar + scrollable body
  // + action button). Without this cap the PaperSurface would grow to fit
  // the natural body height and could exceed the screen — exactly what
  // the business new_reservation case was hitting: 6+ rows in the order
  // card, the Combined Paiement block, pickup time, address row,
  // generic detail rows + action button push the natural height past a
  // typical phone's available vertical space, and the inner ScrollView's
  // `maxHeight` alone couldn't pull the parent down. Capping the
  // PaperSurface here AND letting the inner ScrollView take flex: 1
  // (below) makes the body shrink to whatever room is left and scroll
  // reliably regardless of how much content the type renders.
  const popupMaxHeight = Math.max(280, winHeight - insets.top - insets.bottom - 24 - outerReservedHeight);
  return (
    <PaperSurface radius={20} style={{ width: '100%', maxWidth: 420, maxHeight: popupMaxHeight, borderWidth: 0, overflow: 'hidden' }}>
      {/* No type-tinted left border on the popup — the colored left accent is
          kept only on the notifications-LIST card rows (notifications.tsx),
          which carry their own strip. Here the default 1 px paper border is
          dropped (borderWidth: 0) and the surface is clipped (overflow:
          'hidden') so the brand-green title bar reaches the actual top edge of
          the card — without this, a thin sliver of the paper gradient was
          visible above the green band. */}
      {/* Header — everything on ONE centered line so the type logo (left),
          title, the relative time, the optional bell shortcut, and the close
          button all align vertically. The time sits inline before the action
          buttons instead of on its own line under the title. The type icon is
          tinted with the notification's color. */}
      {/* Brand-green title bar — matches the "Commande confirmée" detail
          popup ((tabs)/_layout.tsx:800) so every in-app notification reads
          as part of the same family. The type icon sits inside a soft white
          circle (~25 % alpha) for contrast against the green; everything
          else flips to white / white-translucent. */}
      {/* Title-bar layout: type icon (left), then title + time stacked or
          inline using the FULL remaining width. The close button and the
          optional bell shortcut are pulled OUT of the row and pinned at
          the top-right corner via position: absolute. The user reported
          that the prior single-row layout — [icon] [title] [time] [bell]
          [X] — was eating into the title's horizontal budget so long
          titles got truncated at "...". Floating the buttons clears that
          budget; the title row now reserves trailing padding equal to
          the buttons' footprint so the text never runs under them. */}
      <View style={{ paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#114b3c' }}>
        {isAdminBroadcast ? (
          <Image source={require('@/assets/images/barakeat_halo_logo_ios.png')} style={{ width: 32, height: 32, borderRadius: 16 }} resizeMode="cover" />
        ) : (
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)', justifyContent: 'center', alignItems: 'center' }}>
            <Icon size={18} color="#fff" />
          </View>
        )}
        {/* Title takes everything that's left, with a trailing safety pad
            (paddingRight: 76) reserving room for the floating button stack
            so we never collide with the X. */}
        <View style={{ flex: 1, paddingRight: 76 }}>
          <Text numberOfLines={1} style={{ color: '#fff', fontSize: 16, fontFamily: 'Poppins_700Bold', letterSpacing: -0.2 }}>
            {isAdminBroadcast ? broadcastTitle : (notif.title ? resolveNotifText(notif.title, t, '', titleOverrides) : '')}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 2 }}>
            {timeAgo(notif.created_at, t)}
          </Text>
        </View>
        {/* Floating button cluster — top-right corner of the title bar.
            Pinned with position: absolute so it doesn't push the title
            row's content. Bell shortcut (when present) sits to the left
            of the close X with a small gap. */}
        <View style={{ position: 'absolute', top: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {topRightAction}
          <TouchableOpacity
            onPress={onClose}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center', alignItems: 'center' }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <XIcon size={17} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* flexShrink: 1 + minHeight: 0 are the React Native incantation
          that lets this wrapper actually shrink inside the capped
          PaperSurface. Without minHeight: 0 the wrapper's intrinsic
          content size wins on iOS and the ScrollView grows to fit its
          children rather than scrolling. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, flexShrink: 1, minHeight: 0 }}>
        <ScrollView
          showsVerticalScrollIndicator={true}
          // flexShrink: 1 + minHeight: 0 again — same reason as the
          // wrapper above. We removed the old `maxHeight: bodyMaxHeight`
          // because the popup-level cap now drives the available space:
          // the ScrollView simply takes whatever's left after the
          // title bar + action button.
          style={{ flexShrink: 1, minHeight: 0 }}
          // Android needs nestedScrollEnabled on inner ScrollViews
          // sitting under any Animated.View / responder wrapper, or the
          // outer view eats the scroll-start gesture and the body
          // refuses to scroll. iOS handles this automatically; setting
          // it on both is harmless.
          nestedScrollEnabled
          contentContainerStyle={{ paddingBottom: 0 }}
        >
          {/* Org-branding header (org logo + name + location) at the very top
              of every customer popup. Customer-only; returns null when there's
              no org context. */}
          {renderOrgHeader()}

          {/* Top image header — only rendered for the legacy "other" types
              (review, message, etc.). New-reservation, cancellation,
              pickup-confirmed, and order-expired each render their own
              basket-centric image inside their respective body blocks
              below, so excluding them here keeps the basket image from
              appearing twice in the same popup. */}
          {(locationImage || basketImage) && !isPickupConfirmed && !isCancelled && !isNewReservation && !isOrderExpired ? (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16, justifyContent: 'center' }}>
              {locationImage ? <Image source={{ uri: locationImage }} style={{ width: 70, height: 70, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" /> : null}
              {basketImage && basketImage !== locationImage ? <Image source={{ uri: basketImage }} style={{ width: 70, height: 70, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" /> : null}
            </View>
          ) : null}

          {/* Admin broadcast image — the picture the admin attached, shown as a
              large banner above the message text. */}
          {isAdminBroadcast && broadcast?.image ? (
            <Image
              source={{ uri: broadcast.image }}
              style={{ width: '100%', height: 160, borderRadius: 14, marginBottom: 14, borderWidth: 1, borderColor: theme.colors.divider }}
              resizeMode="cover"
            />
          ) : null}

          {/* Order-summary card for order_expired — same horizontal layout
              ("Retrait confirmé" / cancelled use it too): basket image on
              the LEFT, basket name + qty × price on the right. Replaces
              the old vertical detail-rows block at this position so the
              expiry notif visually matches the other lifecycle popups.
              Border is the warm-orange used for the expiry tone (mirrors
              the orange hint and the "Expiré" badge elsewhere) instead of
              the green tint pickup-confirmed uses or the red cancelled
              uses. The bottom generic block continues to skip
              order_expired so the same content can't render twice. */}
          {isOrderExpired && !isBusiness && (basketName || locationName || customerName || qty || price)
            ? renderOrderSummary('#ee7b3c66')
            : null}

          {/* Message — rendered for every type EXCEPT the customer-side
              pickup_confirmed, which uses its own "How was your experience?"
              prompt block below. The business-side pickup_confirmed
              ('panier récupéré') DOES render this line because the user
              wants the "{customerName} a récupéré {count} panier(s) chez
              {Org - location}" header to sit above the order-summary card. */}
          {!(isPickupConfirmed && !isBusiness) && (
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22, marginBottom: 12 }}>
              {isAdminBroadcast ? broadcastBody : resolveNotifText(notif.message, t, '', titleOverrides)}
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
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF6B3515', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, gap: 6 }}>
                    <Clock size={16} color="#FF6B35" />
                    <Text style={{ color: '#FF6B35', ...theme.typography.body, fontWeight: '700' }}>
                      {t('streak.lastOrder', { defaultValue: 'Dernière commande' })} - {lastOrderDateStr}
                    </Text>
                  </View>
                  {/* Disambiguates "Dernière commande" — the streak counts
                      RETRAITS (picked-up orders), not reservations. The
                      tiny line under the chip clarifies that without
                      bloating the chip itself ("Dernière commande" is
                      already at its width limit). */}
                  <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 6, fontStyle: 'italic' }}>
                    {t('streak.lastOrderHint', { defaultValue: 'commande récupérée' })}
                  </Text>
                </>
              ) : null}
            </View>
          )}

          {/* Order confirmed details */}
          {(isNewReservation || notifType.includes('order_confirmed')) && (
            <>
              {basketName && (
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700', marginBottom: 12 }}>
                  {basketName}{orgLocationLabel ? ` — ${orgLocationLabel}` : (locationName ? ` — ${locationName}` : '')}
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
                {/* Combined Paiement row — mirrors the customer expanded
                    card. Line 1: method label (Paiement en espèces /
                    Paiement par carte). Line 2 (only when credits were
                    used): the toDoLine — "À payer à la récupération",
                    "Réglée entièrement par crédits" — so the user sees
                    the same payment story they'll see again on the
                    expanded order card later. */}
                {!isCancelled ? (() => {
                  const totalNum = Number(qty ?? 1) > 1 ? Number(price ?? 0) * Number(qty ?? 1) : Number(price ?? 0);
                  if (!Number.isFinite(totalNum) || totalNum <= 0) return null;
                  const isCard = orderPaymentMethod === 'card';
                  const cashSlice = Math.max(0, totalNum - orderCreditAmount);
                  const PMIcon = isCard ? CreditCard : Banknote;
                  const methodLabel = isCard
                    ? (orderCreditAmount > 0
                        ? t('orders.paymentByCardWithCredits', { defaultValue: 'Paiement par carte (+ crédits)' })
                        : t('orders.paymentByCard', { defaultValue: 'Paiement par carte' }))
                    : (orderCreditAmount > 0
                        ? t('orders.paymentInCashWithCredits', { defaultValue: 'Paiement en espèces (+ crédits)' })
                        : t('orders.paymentInCash', { defaultValue: 'Paiement en espèces' }));
                  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
                  let toDoLine: string | null = null;
                  if (!isCard && cashSlice > 0) {
                    toDoLine = t('orders.toPayAtPickup', { amount: fmt(cashSlice), defaultValue: 'À payer à la récupération : {{amount}} TND' });
                  } else if (!isCard && cashSlice === 0 && orderCreditAmount > 0) {
                    toDoLine = t('orders.paidEntirelyByCredits', { defaultValue: 'Réglée entièrement par crédits' });
                  }
                  return (
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
                    </View>
                  );
                })() : null}
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

          {/* Order-expired panel — warning text + pickup code (big) + QR
              code (fetched on demand by qrQuery). Customer can show this
              at the counter if they get there minutes late; the merchant
              CAN still confirm via the scan-qr "Confirmer malgré le
              retard" override, but is not obligated to. Renders ONLY on
              the customer side; a business-side recipient would never get
              this type. */}
          {isOrderExpired && !isBusiness ? (
            <View style={{ marginBottom: 16 }}>
              <View style={{ backgroundColor: '#fff4e6', borderRadius: 12, padding: 14, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#ee7b3c' }}>
                <Text style={{ color: '#7a3b0c', ...theme.typography.bodySm, lineHeight: 20 }}>
                  {t('notifications.orderExpiredHint', {
                    defaultValue: "Si vous êtes très proche, présentez votre code et votre QR au commerçant. Il peut encore confirmer le retrait s'il le souhaite — mais il n'est plus tenu de vous remettre le panier.",
                  })}
                </Text>
              </View>
              {/* Pickup code box with inline QR toggle — mirrors the
                  ReservationCard pattern (code on the left, small QR
                  button on the right). Tapping the button lazy-fetches
                  the QR; on success the image collapses in below the
                  code so the customer can flash it at the counter. The
                  loading spinner replaces the icon while the fetch is in
                  flight so the user gets feedback. */}
              {pickupCode ? (
                <View style={{ backgroundColor: '#114b3c', borderRadius: 16, padding: 18, marginBottom: 12, alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.caption, marginBottom: 6 }}>
                    {t('reserve.success.pickupCode', { defaultValue: 'Code de retrait' })}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text style={{ color: '#e3ff5c', fontSize: 28, fontFamily: 'Poppins_700Bold', letterSpacing: 6 }}>{pickupCode}</Text>
                    {qrReservationId != null ? (
                      <TouchableOpacity
                        onPress={() => setQrExpanded((v) => !v)}
                        style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: 8 }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {qrQuery.isLoading
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <QrCode size={18} color="#fff" />}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  {qrExpanded && qrQuery.data ? (
                    <Image
                      source={{ uri: qrQuery.data as string }}
                      style={{ width: 180, height: 180, borderRadius: 8, marginTop: 14, backgroundColor: '#fff' }}
                      resizeMode="contain"
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
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
                    {t('notifications.bravoCustomerDesc', { location: orgLocationLabel || (effectiveLocationName ?? ''), defaultValue: `Votre retrait chez ${orgLocationLabel || (effectiveLocationName ?? '')} est terminé. Voulez-vous partager votre expérience ?` })}
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

          {/* Generic detail rows — for types not covered above. Skips
              order_expired because we render the same content higher up
              (right under the basket image) for that flow.
              For pickup-window-edge notifs (reminder / closing / extended)
              the Commerce row is suppressed (the org header at the top
              already shows the venue) and the qty row falls back to "1"
              when missing — see isPickupWindowEdgeNotif above. */}
          {!isNewReservation && !isReview && !isMessage && !isPickupConfirmed && !isCancelled && !isStreakExpiring && !isOrderExpired && (basketName || locationName || customerName || qty || price || isPickupWindowEdgeNotif) ? (
            <View style={{ backgroundColor: theme.colors.bg, borderRadius: 14, padding: 16, marginBottom: 16, gap: 12, borderWidth: 1, borderColor: theme.colors.border }}>
              {basketName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.basket', { defaultValue: 'Panier' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }} numberOfLines={1}>{basketName}</Text>
                </View>
              ) : null}
              {!isPickupWindowEdgeNotif && (orgLocationLabel || locationName) ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.location', { defaultValue: 'Commerce' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }} numberOfLines={1}>{orgLocationLabel || locationName}</Text>
                </View>
              ) : null}
              {customerName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.customer', { defaultValue: 'Client' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>{customerName}</Text>
                </View>
              ) : null}
              {/* Quantity row — shows the data's qty when present.
                  Pickup-window-edge notifs don't ship qty (cron only
                  sends location + time), but we still want a Quantité
                  row in the card so the slot left by the hidden Commerce
                  row reads as a real order detail. Default to 1 which is
                  the dominant case (one-basket reservations); if the
                  customer ordered more, the original qty row above wins. */}
              {qty ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.quantity', { defaultValue: 'Quantité' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>{qty}</Text>
                </View>
              ) : isPickupWindowEdgeNotif ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.quantity', { defaultValue: 'Quantité' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>1</Text>
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

          {/* Message — clean single-block design.
              · Customer side header reads "{Org Name} – {Location} vous a
                envoyé un message" (was just the location name).
              · Business side reads "{customerName} vous a envoyé un message".
              · Subline shows the order context — "À propos de la commande
                BK-XXX" — resolved from notif.reference_id or msgParams.
              · The chat icon sits inside the message bubble itself, next to
                the actual message text (was floating in a separate row).
              The blue tint + blue border are gone; the bubble uses the
              warm paper background + neutral divider so it reads as part
              of the popup family (matches the order-confirmed info card). */}
          {isMessage ? (() => {
            // Resolve a human-readable sender label per interface side.
            // CUSTOMER side: prefer the chained "{Org} – {Location}" so the
            // user knows BOTH the brand and the specific restaurant chip
            // (the earlier copy only said location, which was ambiguous for
            // chains). Fall back to whatever single name we have.
            // BUSINESS side: the sender is the customer; senderName carries
            // their name.
            const senderHeader = (() => {
              if (isBusiness) {
                return senderName || customerName || t('notifications.someone', { defaultValue: 'Quelqu\'un' });
              }
              const org = effectiveOrgName ?? null;
              const loc = effectiveLocationName ?? null;
              if (org && loc && org !== loc) return `${org} – ${loc}`;
              return org ?? loc ?? senderName ?? t('notifications.someone', { defaultValue: 'Quelqu\'un' });
            })();
            // Order code for the "concerning order X" line. reference_id is
            // the reservation row id; msgParams.reservation_id is a fallback
            // for older payloads that didn't fill reference_id.
            const refId = notif.reference_id ?? msgParams.reservation_id ?? msgParams.reservationId ?? msgParams.order_id ?? msgParams.orderId ?? null;
            const orderRef = refId != null ? orderIdToCode(refId) : null;
            return (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' }} numberOfLines={2}>
                  {senderHeader}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                  {t('notifications.messageReceived', { defaultValue: 'vous a envoyé un message' })}
                </Text>
                {orderRef ? (
                  <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 2 }}>
                    {t('notifications.aboutOrder', { code: orderRef, defaultValue: 'À propos de la commande {{code}}' })}
                  </Text>
                ) : null}
                {messageText ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#114b3c08', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#114b3c1f', marginTop: 12 }}>
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <MessageCircle size={15} color="#e3ff5c" />
                    </View>
                    <Text style={{ flex: 1, color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 21 }}>
                      {messageText}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })() : null}
        </ScrollView>

        {/* Action button — close lives in the header X now. Sits just below the
            last content block (content blocks carry a ~16px trailing margin, so
            a small marginTop keeps the button close without crowding it). */}
        {onAction && !isAdminBroadcast ? (
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
                  : t('notifications.viewOrder', { defaultValue: 'Voir la commande' })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </PaperSurface>
  );
}
