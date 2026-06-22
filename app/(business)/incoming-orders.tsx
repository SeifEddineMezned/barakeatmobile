import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, Dimensions, Keyboard, Animated, PanResponder } from 'react-native';
import { useSwipeToDismiss } from '@/src/hooks/useSwipeToDismiss';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { DemoTapHintToast } from '@/src/components/DemoTapHintToast';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, QrCode, ClipboardList, ChevronDown, ChevronUp, AlertTriangle, MessageCircle, Star, User, Banknote, Wallet, HelpCircle, Hand, Info, CreditCard, ShoppingBag, MapPin, Navigation, Clock } from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { isPickupExpiredInTz, getBusinessDayDateStr } from '@/src/utils/timezone';
import { useStatusBarStyleOnFocus } from '@/src/hooks/useStatusBarStyleOnFocus';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { DEMO_BASKET_PHOTOS, DEMO_LOCATION_ADDRESS } from '@/src/lib/demoData';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { fetchTodayOrders, fetchLocationOrders, confirmPickup, type TodayReservationFromAPI } from '@/src/services/business';
import { fetchBasketsByLocation } from '@/src/services/baskets';
import { usePollWhenFocused } from '@/src/hooks/usePollWhenFocused';
import { getErrorMessage, apiClient } from '@/src/lib/api';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { StatusDot } from '@/src/components/StatusDot';
import { FilterChip } from '@/src/components/FilterChip';
import { fetchConversationUnreads } from '@/src/services/messages';
import { fetchMyContext, fetchOrganizationDetails } from '@/src/services/teams';
import { NoLocationCTA } from '@/src/components/NoLocationCTA';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { MotifText } from '@/src/components/MotifText';
import { parseMotifRaw, motifDisplay, type MotifAuthor } from '@/src/utils/motif';
import { orderIdToCode } from '@/src/utils/orderCode';

// ─── Canonical UI status model ────────────────────────────────────────────────
// Backend emits:  confirmed | picked_up | cancelled
// (Legacy values like reserved/pending/collected/completed are tolerated as
//  defensive fallbacks and immediately normalized into the canonical model.)
//
// UI meaning:
//   confirmed  → "Ready for pickup"  (incoming tab)
//   picked_up  → "Picked up"         (completed tab)
//   cancelled  → "Cancelled"         (completed tab)
// ─────────────────────────────────────────────────────────────────────────────

type CanonicalStatus = 'confirmed' | 'picked_up' | 'cancelled' | 'expired';

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

interface OrderReview {
  rating_service?: number;
  rating_quantity?: number;
  rating_quality?: number;
  rating_variety?: number;
  comment?: string;
  review_date?: string;
}

interface NormalizedOrder {
  id: string;
  buyerId: string | number | undefined;
  basketName: string;
  quantity: number;
  total: number;
  pickupWindow: { start: string; end: string };
  pickupCode: string;
  status: CanonicalStatus;
  createdAt: string;
  updatedAt: string;
  // YYYY-MM-DD of the day this order is meant to be picked up. Set on
  // creation by the customer — `reservation_date` on the backend. Used
  // by the incoming-tab filter to ignore stale rows whose pickup day
  // has already passed: a 5-day-old 'confirmed' order whose cron
  // expiry never ran was leaking into the En cours tab because the
  // pickup_end TIME alone said "still within today's window" even
  // though the DATE had long passed. Null on legacy pre-column rows.
  reservationDate?: string;
  customerName: string;
  customerPhone?: string;
  confirmedByName?: string;
  review?: OrderReview | null;
  cancellationReason?: string | null;
  cancelledBy?: 'buyer' | 'business' | null;
  // Readable name of the specific user who triggered the cancel. Populated
  // from reservations.cancelled_by_user_id → users.name; null when the
  // cancellation pre-dates that column or when the buyer cancelled.
  cancelledByName?: string | null;
  // Carried through from the backend so we can show a "Payé en crédits" badge
  // and pass the right ids to cache-invalidation after a cancel.
  payment_method?: 'cash' | 'card' | 'credits';
  // Wallet credits (TND) the customer applied. > 0 means they'll pay less cash
  // at pickup and Barakeat reimburses this slice at settlement.
  creditAmount: number;
  location_id?: number;
  basket_id?: number;
}

// Money formatter — integers stay clean ("5 TND"), fractions show millimes.
const fmtMoney = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Status-aware merchant credits-info copy. Replaces the old single
 * `business.scan.creditsReimburseNote` (present-imperative — "ne lui
 * réclamez pas ce montant. Barakeat vous le rembourse lors de votre
 * prochain versement") which was wrong for vendus (transaction closed,
 * past tense needed) and issues (the merchant won't be reimbursed for
 * cancelled / expired orders).
 *
 * Per product decision, the merchant-side dialog stays focused on
 * SETTLEMENT — what THE MERCHANT will or won't get. Doesn't get into
 * the customer's credit-loss / refund story (that's the customer
 * interface's job, not the merchant's).
 */
function buildMerchantCreditsInfo(
  displayStatus: string,
  isPendingTab: boolean,
  creditAmount: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const credits = fmtMoney(creditAmount);
  if (isPendingTab) {
    return t('business.orders.creditsInfoIncoming', {
      credits,
      defaultValue: 'Le client a payé {{credits}} TND avec des crédits Barakeat — ne lui réclamez pas ce montant. Barakeat vous le remboursera lors de votre prochain versement.',
    });
  }
  if (displayStatus === 'picked_up') {
    return t('business.orders.creditsInfoCompleted', {
      credits,
      defaultValue: 'Le client avait payé {{credits}} TND avec des crédits Barakeat. Ce montant vous a été (ou vous sera) remboursé sur votre versement.',
    });
  }
  if (displayStatus === 'expired') {
    return t('business.orders.creditsInfoExpired', {
      credits,
      defaultValue: 'Le client avait payé {{credits}} TND avec des crédits Barakeat sur cette commande expirée. Vous ne serez pas remboursé pour cette commande.',
    });
  }
  // cancelled (by buyer or business)
  return t('business.orders.creditsInfoCancelled', {
    credits,
    defaultValue: 'Le client avait payé {{credits}} TND avec des crédits Barakeat sur cette commande annulée. Vous ne serez pas remboursé pour cette commande.',
  });
}

/**
 * Reasons the backend stamps when the order wasn't really "cancelled" by a
 * human — it expired or the customer no-showed. These are semantically
 * EXPIRED, not cancelled, even though they arrive with status='cancelled'.
 * The UI re-classifies them so the badge reads "Expiré" (orange) and the
 * "Annulé par" / motif rows don't render.
 */
const EXPIRY_REASONS = new Set([
  'expired_no_pickup',
  'customer_no_show',
  'no_show',
  'expired',
]);

/**
 * Render a cancellation motif from the raw reservation value, tagging the
 * free-text "other" reason with who authored it. Delegates the parsing +
 * translation to the shared util (also used by the notification popup).
 */
function formatMotif(raw: string, t: (k: string, opts?: any) => string, author: MotifAuthor = null): string {
  if (!raw) return '';
  const { key, note } = parseMotifRaw(raw);
  return motifDisplay(key, note, author, t);
}

/** Map any legacy backend status string into the canonical UI status. */
function normalizeStatus(raw: string | undefined, cancelledBy?: string, cancellationReason?: string): CanonicalStatus {
  // System-expired rows are stored on the DB as `status='cancelled'` with
  // `cancelled_by='system'` + `cancellation_reason='expired_no_pickup'`
  // (cron sweep, snapshot-expire on location hours change, etc.). They
  // are displayed as EXPIRED, not cancelled, so the merchant sees the
  // orange "Expiré" badge instead of the red "Annulée". Anything else
  // (cancelled_by='buyer' or 'business', or no reason) stays a genuine
  // cancellation.
  if (
    raw === 'cancelled'
    && String(cancelledBy ?? '').toLowerCase() === 'system'
    && String(cancellationReason ?? '').toLowerCase() === 'expired_no_pickup'
  ) {
    return 'expired';
  }
  switch (raw) {
    case 'confirmed':
    case 'reserved':   // legacy fallback
    case 'pending':    // legacy fallback
      return 'confirmed';
    case 'picked_up':
    case 'collected':  // legacy fallback
    case 'completed':  // legacy fallback
      return 'picked_up';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
    case 'no_show':
      return 'expired';
    default:
      // Unknown status — treat as incoming/confirmed so it is visible
      return 'confirmed';
  }
}

export default function IncomingOrdersScreen() {
  useStatusBarStyleOnFocus('dark');
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const targetOrderId = useBusinessStore((s) => s.targetOrderId);
  const targetOrderLocationId = useBusinessStore((s) => s.targetOrderLocationId);
  const targetOrderTs = useBusinessStore((s) => s.targetOrderTs);
  const setSelectedLocationId = useBusinessStore((s) => s.setSelectedLocationId);
  const [activeTab, setActiveTab] = useState<'incoming' | 'completed' | 'issues'>('incoming');
  const [dateFilter, setDateFilter] = useState<'today' | 'month' | 'all'>('all');
  const [issueTypeFilter, setIssueTypeFilter] = useState<'all' | 'expired' | 'cancelled'>('all');
  // Partial order-code search — applies to all three tabs. The user types
  // any substring of the BK-XXXXX code shown in the expanded card / notifs
  // and we filter the list to matching orders only. Lives in the filter
  // modal alongside the date / issue-type filters.
  const [orderIdSearch, setOrderIdSearch] = useState('');
  const [showBizFilterModal, setShowBizFilterModal] = useState(false);
  const queryClient = useQueryClient();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);

  // Live today's-orders feed for the partner. 15s → 20s, paused when
  // tab unfocused, and `refetchOnMount: 'always'` dropped (the global
  // 30s staleTime now handles the "fresh-on-entry" case without
  // double-firing every tab swap).
  const todayRefetch = usePollWhenFocused(20_000);
  const todayQuery = useQuery({
    queryKey: ['today-orders', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    // Don't fire while selectedLocationId is still hydrating from the store
    // (the layout-level effect snaps it to a valid id within a frame). Without
    // this gate, the page used to fire ['today-orders', null] first, then
    // re-key once the location resolved, polluting the cache with an
    // aggregated-across-all-locations result that the displayed key
    // (`[realId, ...]`) was never refreshed against.
    enabled: selectedLocationId != null,
    staleTime: 15_000,
    refetchInterval: todayRefetch,
    retry: 1,
    // Keep the previous data visible while the key changes — without this,
    // when selectedLocationId initializes from null → a real id, the query
    // briefly displays empty (causing "0 orders" until the user changes
    // filters and back, which only succeeded because the new fetch
    // happened to land first).
    placeholderData: keepPreviousData,
  });

  // Historical orders (completed/issues tabs). No interval poll — the
  // user only consults these on demand. Dropped `refetchOnMount: 'always'`
  // because it was firing a fresh page load every tab swap; the global
  // staleTime floor + the invalidation on confirm/cancel mutations are
  // enough to keep this fresh in practice.
  // Canonical basket-name lookup: the today-orders / location-orders
  // responses return a top-level `basket_name` that is unreliable — observed
  // returning the location's default basket name for every row regardless
  // of which basket type was actually reserved. The reservation row's
  // `basket_id` IS correct (it's the FK used when the customer reserved),
  // so we resolve the displayed name via /api/baskets/location/:id and
  // override per-row. Long staleTime — basket catalogs change rarely.
  const basketsQuery = useQuery({
    queryKey: ['baskets-by-location', selectedLocationId],
    queryFn: () => fetchBasketsByLocation(String(selectedLocationId)),
    enabled: selectedLocationId != null,
    staleTime: 5 * 60_000,
  });
  const basketNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of basketsQuery.data ?? []) {
      if (b?.id != null && b?.name) m.set(String(b.id), b.name);
    }
    return m;
  }, [basketsQuery.data]);

  const historyQuery = useQuery({
    queryKey: ['location-orders', selectedLocationId, dateFilter],
    queryFn: () => fetchLocationOrders(selectedLocationId, dateFilter),
    // Same gate as todayQuery — without this, the "Tout" filter on first
    // mount used to land with the null-key (all-locations-aggregated)
    // fetch result lingering in cache; switching filter to "Mois" and back
    // to "Tout" was the only reliable way to force a refetch against the
    // real selectedLocationId, which is the symptom the user reported.
    enabled: selectedLocationId != null,
    staleTime: 60_000,
    retry: 2,
    placeholderData: keepPreviousData,
  });

  // Force-refresh both queries every time the screen comes into focus so
  // tab swaps and deep-link re-entries can't leave a stale or partial
  // cache visible. Bounded by selectedLocationId/dateFilter so a refetch
  // only runs against the currently-displayed slice.
  useFocusEffect(
    useCallback(() => {
      void todayQuery.refetch();
      void historyQuery.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedLocationId, dateFilter])
  );

  // Conversation unreads — same query key as customer side, focus-gated
  // and slowed to 30s. The interval is paused when the user is on a
  // different tab; reentry runs the 30s staleTime check and only fires
  // a refetch if the cached entry is older than 25s.
  const msgUnreadsRefetch = usePollWhenFocused(30_000);
  const msgUnreadsQuery = useQuery({
    queryKey: ['conversation-unreads'],
    queryFn: fetchConversationUnreads,
    staleTime: 25_000,
    refetchInterval: msgUnreadsRefetch,
  });
  const msgUnreads = msgUnreadsQuery.data ?? {};

  // Permission checks for granular actions. my-context staleTime
  // matches the 5-min floor we set in the business layout — role
  // changes mid-session are a non-issue.
  const ctxQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 5 * 60_000 });
  const myRole = ctxQuery.data?.role ?? 'member';
  const isAdminOrOwner = myRole === 'owner' || myRole === 'admin';

  // Detect "org owner with zero locations" — short-circuit to a single CTA
  // since there's nothing to confirm/cancel without a location.
  const orgIdForNoLoc = ctxQuery.data?.organization_id;
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgIdForNoLoc],
    queryFn: () => fetchOrganizationDetails(orgIdForNoLoc!),
    enabled: !!orgIdForNoLoc,
    staleTime: 300_000,
  });
  const isOrgAdminScope = isAdminOrOwner && !ctxQuery.data?.location_id;
  // Suppressed during the walkthrough — see [_layout.tsx:206] for the
  // rationale (demo runs over a populated UI; the dashboard popup fires
  // immediately after the walkthrough ends).
  const ordersWalkthroughStep = useWalkthroughStore((s) => s.step);
  const hasNoLocation = ordersWalkthroughStep === null
    && isOrgAdminScope
    && !!orgIdForNoLoc
    && !orgDetailsQuery.isLoading
    && (orgDetailsQuery.data?.locations?.length ?? 0) === 0;
  const rawPerms = ctxQuery.data?.permissions ?? {};
  const hasPerm = (key: string) => { const v = (rawPerms as any)[key]; return v === true || v === 'true' || v === 'write'; };
  const canConfirmPickup = isAdminOrOwner || hasPerm('confirm_pickup');
  const canMessage = isAdminOrOwner || hasPerm('messaging');
  const canViewHistory = isAdminOrOwner || hasPerm('view_history');
  const canCancelOrder = isAdminOrOwner || hasPerm('cancel_order');

  // Walkthrough: measure the QR FAB so the tutorial cutout sits exactly on it.
  const qrFabRef = useRef<View>(null);
  const setQrFabRect = useWalkthroughStore((s) => s.setQrFabRect);
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  // Refs for the verify-modal cutout targets. Stable refs + onLayout-driven
  // re-measurement so the cutouts/halos follow the elements when the
  // keyboard slides the KeyboardAvoidingView up or down. The previous
  // callback-ref-only pattern captured the rect once at mount and went
  // stale the moment the user tapped the input and the modal shifted.
  const verifyInputRef = useRef<any>(null);
  const verifyConfirmRef = useRef<any>(null);
  const measureVerifyInput = useCallback(() => {
    requestAnimationFrame(() => {
      verifyInputRef.current?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
        if (w > 0 && h > 0) {
          setMeasuredRect('verifyModalInput', { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
        }
      });
    });
  }, [setMeasuredRect]);
  const measureVerifyConfirm = useCallback(() => {
    requestAnimationFrame(() => {
      verifyConfirmRef.current?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
        if (w > 0 && h > 0) {
          setMeasuredRect('verifyConfirmBtn', { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
        }
      });
    });
  }, [setMeasuredRect]);
  // Re-measure both demo cutout targets whenever the verify-error text
  // appears or clears. The error swaps a 12 px spacer for a multi-line Text,
  // which grows the bottom sheet upward — that shifts the TextInput's
  // absolute window position but does NOT fire its onLayout (only the
  // sibling spacer/error changed, not the input itself). Without this
  // effect the halo stays at the stale window coords and visibly drifts off
  // the input/confirm button until the user dismisses the modal. We measure
  // on the next two frames to let RN/Yoga commit the new layout before we
  // ask for the window coords.
  const setVerifyModalOpenFlag = useWalkthroughStore((s) => s.setVerifyModalOpen);
  const setExpandedDemoCardFlag = useWalkthroughStore((s) => s.setExpandedDemoCard);
  const setDemoScanCode = useWalkthroughStore((s) => s.setDemoScanCode);
  const measureQrFab = useCallback(() => {
    requestAnimationFrame(() => {
      qrFabRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setQrFabRect({ x, y, w, h });
      });
    });
  }, [setQrFabRect]);

  // Refs for demo-order-card highlights — outer card, chat icon, confirm btn.
  const demoOrderCardRef = useRef<View>(null);
  const orderCardChatRef = useRef<View>(null);
  const orderCardConfirmBtnRef = useRef<View>(null);
  const measureDemoOrderCard = useCallback(() => {
    requestAnimationFrame(() => {
      demoOrderCardRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setMeasuredRect('demoOrderCard', { x, y, w, h });
      });
    });
  }, [setMeasuredRect]);
  const measureOrderCardChat = useCallback(() => {
    requestAnimationFrame(() => {
      orderCardChatRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setMeasuredRect('orderCardChat', { x, y, w, h });
      });
    });
  }, [setMeasuredRect]);
  const measureOrderCardConfirm = useCallback(() => {
    requestAnimationFrame(() => {
      orderCardConfirmBtnRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setMeasuredRect('orderCardConfirmBtn', { x, y, w, h });
      });
    });
  }, [setMeasuredRect]);

  // Normalize API orders
  const normalizeOrder = (o: TodayReservationFromAPI): NormalizedOrder => {
    const pickupStart = (o.pickup_start_time as string)?.substring(0, 5) ?? '';
    const pickupEnd = (o.pickup_end_time as string)?.substring(0, 5) ?? '';
    // Resolve the displayed basket type name. Priority:
    //   1. Look up by `basket_id` in basketNameById (built from
    //      /api/baskets/location/:id) — this is the only source we trust
    //      end-to-end because the today-orders endpoint's top-level
    //      `basket_name` was observed returning the location's default
    //      basket for every row regardless of which one was reserved.
    //   2. Nested `basket.name` etc. (kept for resilience if the row ever
    //      ships the nested object with the correct name).
    //   3. Top-level `basket_name` / `restaurant_name` as last-resort.
    const oa = o as any;
    const bidStr = oa.basket_id != null ? String(oa.basket_id) : null;
    const basketName: string =
      (bidStr ? basketNameById.get(bidStr) : undefined)
      ?? oa.basket?.name
      ?? oa.basket?.basket_type_name
      ?? oa.basket?.type_name
      ?? oa.basket?.basket_name
      ?? oa.basket_type_name
      ?? oa.basket_name
      ?? oa.restaurant_name
      ?? t('orders.surpriseBag', { defaultValue: 'Panier Surprise' });
    return {
      id: String(o.id),
      buyerId: o.buyer_id,
      basketName,
      quantity: o.quantity ?? 1,
      // Prefer the authoritative settlement amount; fall back to the location
      // price tier × qty for older rows with no transaction.
      total: (oa.txn_amount != null ? Number(oa.txn_amount) : Number(o.price_tier ?? 0) * (o.quantity ?? 1)),
      pickupWindow: { start: pickupStart, end: pickupEnd },
      pickupCode: String(o.pickup_code ?? '').substring(0, 6).toUpperCase(),
      status: normalizeStatus(o.status, (o as any).cancelled_by, (o as any).cancellation_reason),
      createdAt: o.created_at ?? new Date().toISOString(),
      updatedAt: (o as any).updated_at ?? o.created_at ?? new Date().toISOString(),
      reservationDate: typeof (o as any).reservation_date === 'string'
        ? String((o as any).reservation_date).substring(0, 10)
        : undefined,
      // Backend returns null when both the live user row and the
      // deleted_users archive row are gone (30+ days post-deletion).
      // For the buyer name we always substitute the localized "Compte
      // supprimé" label so business UIs never render an empty name.
      // confirmedByName / cancelledByName stay nullable — the JSX uses them
      // as conditional render gates ("Confirmé par X" line is skipped when
      // there's nothing to show), so passing a stub label here would
      // incorrectly add the line for orders that were never confirmed.
      customerName: o.buyer_name ?? t('orders.deletedAccountName', { defaultValue: 'Compte supprimé' }),
      customerPhone: o.buyer_phone ?? undefined,
      confirmedByName: (o as any).confirmed_by_name ?? undefined,
      review: (o as any).review ?? null,
      cancellationReason: (o as any).cancellation_reason ?? null,
      cancelledBy: (o as any).cancelled_by ?? null,
      cancelledByName: (o as any).cancelled_by_name ?? null,
      payment_method: (o as any).payment_method ?? 'cash',
      creditAmount: Number((o as any).credit_amount ?? 0),
      location_id: (o as any).location_id ?? undefined,
      basket_id: (o as any).basket_id ?? undefined,
    };
  };

  // Today's orders (for incoming/pending tab)
  const realOrders: NormalizedOrder[] = (todayQuery.data ?? []).map(normalizeOrder);

  // Walkthrough demo — inject a fake "ready for pickup" order while the
  // walkthrough's orders-tour stage is active. Driven by the demoOrderActive
  // flag so injection turns on/off precisely on step entry/exit rather than
  // the whole walkthrough's lifetime.
  const walkthroughStep = useWalkthroughStore((s) => s.step);
  const demoOrderActive = useWalkthroughStore((s) => s.demoOrderActive);
  const demoOrder = useMemo<NormalizedOrder>(() => {
    const now = new Date();
    // Anchor the demo order's pickup window to a slot that's guaranteed to
    // sit ahead of "now" in business-day terms (which wraps at 03:30). The
    // previous `(hours+3) % 24` formula wrapped past midnight when the demo
    // was run late in the evening, which flipped the order into "expired"
    // and the incoming tab rendered empty — the user saw nothing.
    const pad = (n: number) => String(n).padStart(2, '0');
    const startH = (now.getHours() + 1) % 24;
    // End within the same calendar day so the time string never wraps —
    // clamp at 23:30 if start is already late.
    const endH = startH <= 21 ? startH + 2 : 23;
    const endM = startH <= 21 ? 0 : 30;
    const pickupStart = `${pad(startH)}:00`;
    const pickupEnd = `${pad(endH)}:${pad(endM)}`;
    return {
      id: 'demo-order-1',
      buyerId: 'demo-buyer',
      basketName: t('walkthrough.biz.demoOrderBasket', { defaultValue: 'Panier Surprise' }),
      quantity: 2,
      total: 10,
      pickupWindow: { start: pickupStart, end: pickupEnd },
      pickupCode: 'DEMO',
      status: 'confirmed',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      customerName: t('walkthrough.biz.demoOrderCustomer', { defaultValue: 'Sami (démo)' }),
      payment_method: 'cash',
      creditAmount: 0,
    };
  }, [t]);

  const orders: NormalizedOrder[] = demoOrderActive
    ? [demoOrder, ...realOrders.filter((o) => o.id !== demoOrder.id)]
    : realOrders;

  // Walkthrough demo — pop a fake "new reservation" in-app notification the
  // first time the orders sub-tour is active, so the demo showcases the
  // notification experience alongside the incoming order. The fake ID is
  // time-based so re-running the walkthrough re-fires it.
  const pushDemoPopup = useNotificationStore((s) => s.pushPopups);
  const demoNotifFiredRef = useRef(false);
  useEffect(() => {
    if (!demoOrderActive) {
      demoNotifFiredRef.current = false;
      return;
    }
    if (demoNotifFiredRef.current) return;
    demoNotifFiredRef.current = true;
    const timer = setTimeout(() => {
      // Build a FULLY-POPULATED reservation notification so the demo popup
      // shows exactly what a real "Nouvelle réservation" looks like — basket
      // photo, customer, quantity, total, pickup window and code. The popup
      // (NotificationDetail) reads these from the message JSON's `params`, and
      // resolveNotifText renders the headline from `notif_message_new_reservation`
      // (the same key real reservation notifications use). Values mirror the
      // demo order card so the notif and the card stay consistent.
      const notifParams = {
        customerName: demoOrder.customerName,
        count: demoOrder.quantity,
        quantity: demoOrder.quantity,
        location: t('walkthrough.biz.demoNotifLocation', { defaultValue: 'Barakeat — Tunis Centre' }),
        basketName: demoOrder.basketName,
        basketImage: DEMO_BASKET_PHOTOS[0],
        price: demoOrder.total / demoOrder.quantity,
        pickupStart: demoOrder.pickupWindow.start,
        pickupEnd: demoOrder.pickupWindow.end,
        code: demoOrder.pickupCode,
        address: DEMO_LOCATION_ADDRESS,
      };
      pushDemoPopup([{
        id: -Date.now(),
        user_id: 0,
        type: 'new_reservation',
        title: 'notif_title_new_reservation',
        message: JSON.stringify({ key: 'notif_message_new_reservation', params: notifParams }),
        is_read: false,
        created_at: new Date().toISOString(),
      }]);
    }, 250);
    return () => clearTimeout(timer);
  }, [demoOrderActive, pushDemoPopup, t, demoOrder]);

  // Historical orders (for completed/issues tabs — uses date filter)
  const allOrders: NormalizedOrder[] = (historyQuery.data ?? []).map(normalizeOrder);

  // Tick every 60s to re-evaluate pickup expiry in real-time
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTimeTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Tab filters
  // Confirmed orders whose pickup window has passed are treated as expired (shown in issues).
  // The demo order is always live — its pickup window is synthetic and
  // shouldn't drop it into the issues tab when the user runs the demo late
  // at night.
  //
  // Two-stage check:
  //   1. Calendar day — pickup-day before today's business day → expired
  //      regardless of time. Without this, 5-day-old 'confirmed' rows
  //      that the cron expiry never reaped were leaking into the
  //      En cours tab because the time-of-day check was the ONLY
  //      gate and "18:00" < now=14:00 looked unexpired.
  //      Effective pickup day = reservationDate when set, else
  //      createdAt's biz day (legacy rows pre-reservation_date column).
  //   2. Time-of-day — only checked when the pickup day IS today.
  //      A future-dated pickup (Monday-for-Tuesday flow) is never
  //      flagged expired by the time check.
  const todayBizDateStr = getBusinessDayDateStr(new Date());
  const isOrderExpired = (o: NormalizedOrder) => {
    if (o.id === 'demo-order-1') return false;
    if (o.status !== 'confirmed') return false;
    const effectiveDay = o.reservationDate
      ?? (o.createdAt ? getBusinessDayDateStr(new Date(o.createdAt)) : null);
    if (effectiveDay && effectiveDay < todayBizDateStr) return true;
    if (effectiveDay && effectiveDay > todayBizDateStr) return false;
    return !!(o.pickupWindow.end && isPickupExpiredInTz(o.pickupWindow.end));
  };

  const incomingOrders = useMemo(
    () => orders.filter((o) => o.status === 'confirmed' && !isOrderExpired(o)),
    [orders, timeTick]
  );

  // Event-time helper for Vendus / Problèmes sorting. Same shape as the
  // customer side: cancelled / picked_up read updated_at directly (the
  // backend bumps it on both transitions), client-side "expired" rows
  // synthesise their event instant from the day of createdAt + the
  // basket's pickup_end_time so the moment the window actually closed
  // is what ranks. createdAt is the final fallback.
  const eventTimeMs = useCallback((o: NormalizedOrder): number => {
    if (o.status === 'cancelled' || o.status === 'picked_up') {
      const ts = o.updatedAt ? new Date(o.updatedAt).getTime() : NaN;
      if (!isNaN(ts)) return ts;
    }
    if (o.status === 'confirmed' || o.status === 'expired') {
      const dayBasis = o.createdAt ? new Date(o.createdAt) : null;
      if (dayBasis && !isNaN(dayBasis.getTime()) && o.pickupWindow?.end) {
        const yyyy = dayBasis.getFullYear();
        const mm = String(dayBasis.getMonth() + 1).padStart(2, '0');
        const dd = String(dayBasis.getDate()).padStart(2, '0');
        const timePart = String(o.pickupWindow.end).substring(0, 5);
        const ts = new Date(`${yyyy}-${mm}-${dd}T${timePart}:00`).getTime();
        if (!isNaN(ts)) return ts;
      }
    }
    const fallback = o.createdAt ? new Date(o.createdAt).getTime() : 0;
    return isNaN(fallback) ? 0 : fallback;
  }, []);

  const completedOrders = useMemo(
    () =>
      allOrders
        .filter((o) => o.status === 'picked_up')
        // Most recent pickup at the top — Vendus reads as "I just sold
        // this", not "this order was placed an hour ago".
        .sort((a, b) => eventTimeMs(b) - eventTimeMs(a)),
    [allOrders, eventTimeMs]
  );

  const issueOrders = useMemo(
    () => {
      const todayExpired = orders.filter((o) => isOrderExpired(o));
      const todayExpiredIds = new Set(todayExpired.map((o) => o.id));
      const todayStr = new Date().toDateString();
      const historicalIssues = allOrders.filter((o) => {
        if (todayExpiredIds.has(o.id)) return false; // Already in todayExpired
        if (o.status === 'cancelled' || o.status === 'expired') return true; // Always an issue
        // Confirmed orders are only issues if they're from a PAST day (missed pickup)
        if (o.status === 'confirmed') {
          const orderDate = new Date(o.createdAt).toDateString();
          return orderDate !== todayStr; // Not today = missed/expired
        }
        return false;
      });
      // Sort by event time so the cancellation that came in 3 minutes
      // ago tops the one that came in 3 hours ago, regardless of when
      // the original orders were placed.
      return [...todayExpired, ...historicalIssues].sort((a, b) => eventTimeMs(b) - eventTimeMs(a));
    },
    [orders, allOrders, timeTick, eventTimeMs]
  );

  const filteredIssueOrders = useMemo(() => {
    if (issueTypeFilter === 'all') return issueOrders;
    if (issueTypeFilter === 'expired') return issueOrders.filter((o) => o.status === 'confirmed' || o.status === 'expired');
    return issueOrders.filter((o) => o.status === 'cancelled');
  }, [issueOrders, issueTypeFilter]);

  const tabDisplayedOrders = activeTab === 'incoming' ? incomingOrders : activeTab === 'completed' ? completedOrders : filteredIssueOrders;

  // Apply the order-code search on top of the tab-specific list. Substring
  // match against the displayed BK-XXXXX code, case-insensitive — the user
  // can type just "K7X3" or "BK-K7X3" and both work. Empty query is a
  // no-op so the unfiltered list shows by default.
  const displayedOrders = useMemo(() => {
    const q = orderIdSearch.trim().toUpperCase();
    if (!q) return tabDisplayedOrders;
    return tabDisplayedOrders.filter((o) => orderIdToCode(o.id).toUpperCase().includes(q));
  }, [tabDisplayedOrders, orderIdSearch]);

  // ── Deep-link: navigate to exact order from activity log / notifications ──
  // Deep-link: find, expand, AND scroll to the target order. The scroll
  // step matters because the order list can be long — "Tout" + completed
  // / issues often pushes the target card well below the fold, and a
  // user tapping a review expects to LAND on that order, not on the top
  // of the orders page.
  const ordersScrollRef = useRef<ScrollView | null>(null);
  const orderCardYRef = useRef<Map<string, number>>(new Map());
  const pendingScrollIdRef = useRef<string | null>(null);
  const lastOrderTsRef = useRef(0);
  // Reset scroll to top THE MOMENT any demo arms (under the welcome cover).
  // Tab screens preserve scroll across navigation, so without this an
  // incoming-orders halo (`demoOrderCard`) would land offset by whatever
  // scroll position the user had before they triggered the demo.
  const demoSequencePending = useWalkthroughStore((s) => s.demoSequencePending);
  useEffect(() => {
    if (!demoSequencePending) return;
    ordersScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [demoSequencePending]);
  useEffect(() => {
    // Read fresh values from store every time
    const { targetOrderId: tid, targetOrderLocationId: tLocId, targetOrderTs: tTs } = useBusinessStore.getState();
    if (!tid || tTs <= lastOrderTsRef.current) return;
    lastOrderTsRef.current = tTs;

    // Resolve the target's location. The notification handlers
    // (InAppNotification + notifications.tsx) try to pull
    // location_id out of the notif's message params, but some
    // upstream pushes don't include it — and even when they do, the
    // payload can be stripped by Android's collapsible-FCM coalescing.
    // So we fall back to scanning the shared all-locations cache
    // (`['today-orders-count']`, populated by both this layout's
    // badge query and the dashboard dropdown) to look up the
    // location_id of the target reservation. That way "View order"
    // ALWAYS lands the user on the correct venue regardless of which
    // location they had selected, even if the notification payload
    // omitted the field.
    let resolvedLocId: number | string | null = tLocId ?? null;
    if (!resolvedLocId) {
      const all: any[] = queryClient.getQueryData(['today-orders-count']) ?? [];
      const match = all.find((o) => String(o.id) === String(tid));
      if (match?.location_id != null) resolvedLocId = match.location_id;
    }

    // Switch location if needed (only when we have a resolved id AND
    // it differs from the current selection — otherwise we'd
    // trigger an unnecessary refetch of the badge / orders queries).
    if (resolvedLocId && String(resolvedLocId) !== String(selectedLocationId)) {
      setSelectedLocationId(resolvedLocId);
    }
    // Force "Tout" — without this, a review for an order outside the
    // current date filter (today / this month) would never appear in
    // the list and the deep-link would silently no-op. The user's
    // expectation: tapping the review always lands them on the order
    // regardless of which date filter they had selected.
    setDateFilter('all');
    setIssueTypeFilter('all');
    // Clear any stale search so the deep-linked order isn't filtered out.
    setOrderIdSearch('');
    void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['location-orders'] });

    // Retry expanding until the order is found (queries may need to refetch)
    let attempts = 0;
    const loc = useBusinessStore.getState().selectedLocationId;
    const tryExpand = () => {
      // Read fresh data from query cache each attempt. Three sources
      // in priority order so the deep-link can resolve quickly even
      // mid-refetch:
      //   1. today-orders (per-location, fastest after a location
      //      switch — but empty until the per-location query refetches)
      //   2. location-orders (historical per-location cache)
      //   3. today-orders-count (the SHARED all-locations cache used by
      //      the nav-bar badge + dashboard chips). Always has fresh
      //      data because it's polled by the always-mounted layout.
      //      Critical for the fresh-location-switch case: without it,
      //      a "View order" tap from a notification that switches the
      //      user to a never-before-visited location would have to
      //      wait the full refetch round-trip before finding the row.
      const todayData: any[] = queryClient.getQueryData(['today-orders', loc]) ?? [];
      const histData: any[] = queryClient.getQueryData(['location-orders', loc, 'all']) ?? queryClient.getQueryData(['location-orders', loc, dateFilter]) ?? [];
      const allLocsData: any[] = queryClient.getQueryData(['today-orders-count']) ?? [];
      const all = [...todayData, ...histData, ...allLocsData];
      const found = all.find((o: any) => String(o.id) === String(tid));
      if (found) {
        const status = normalizeStatus(found.status, found.cancelled_by, found.cancellation_reason);
        if (status === 'picked_up') setActiveTab('completed');
        else if (status === 'cancelled' || status === 'expired') setActiveTab('issues');
        else setActiveTab('incoming');
        setExpandedOrderId(String(found.id));
        // Flag the id we want to scroll to — onLayout below will fire
        // once the card mounts in the now-correct tab/filter and trigger
        // the scrollTo. We can't scroll immediately: the cards haven't
        // remounted under the new activeTab/filter yet.
        pendingScrollIdRef.current = String(found.id);
        // If the card is already measured (was visible before the deep
        // link fired), jump now — the onLayout path won't re-fire.
        const knownY = orderCardYRef.current.get(String(found.id));
        if (knownY != null) {
          setTimeout(() => {
            ordersScrollRef.current?.scrollTo({ y: Math.max(0, knownY - 12), animated: true });
          }, 50);
        }
        useBusinessStore.getState().setTargetOrder(null);
      } else if (attempts < 8) {
        attempts++;
        setTimeout(tryExpand, 500);
      }
    };
    setTimeout(tryExpand, 200);
  }, [targetOrderId, targetOrderTs]);

  // ─── Verify-pickup modal state ──────────────────────────────────────────────
  const [verifyModalOrderId, setVerifyModalOrderId] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // Re-measure the verify-modal input + confirm button whenever the
  // verifyError state flips. The error swaps a fixed 12 px spacer for a
  // multi-line Text below the TextInput, growing the bottom sheet upward —
  // which shifts the input's WINDOW position (the halo lives in window
  // coords) without firing the TextInput's own onLayout (only siblings
  // moved). This effect refreshes both rects after the layout commit so
  // the halo follows the shifted positions instead of drifting off-target.
  // The double-RAF gives Yoga + the native layout commit time to settle
  // before we ask for window coords.
  useEffect(() => {
    if (verifyModalOrderId !== 'demo-order-1') return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        measureVerifyInput();
        measureVerifyConfirm();
      });
    });
  }, [verifyError, verifyModalOrderId, measureVerifyInput, measureVerifyConfirm]);

  // Cancel flow — mirrors the customer experience: a warning bottom-sheet
  // first, then the shared full-page reason picker (/cancel-reservation in
  // ?mode=business). The reason picker performs the DELETE + cache refresh,
  // so this screen only needs to capture which order is being cancelled and
  // hand off the details.
  const [cancelWarning, setCancelWarning] = useState<{
    id: string; customerName?: string; quantity: number; locationId?: string; paymentMethod?: string;
  } | null>(null);
  // Entrance: backdrop fade-in + sheet slide-up fire IN PARALLEL so the
  // user sees one continuous motion. The offset uses the device screen
  // height (not a fixed 420px) so the sheet TOP starts fully BELOW the
  // viewport — the old 420px offset wasn't enough for tall sheets, so the
  // top edge of the card was visible at translateY: 420 for the 200ms
  // backdrop-fade window, which the user called out as "shows the tip
  // real quick and then slides up". Both fixes together make a single
  // smooth slide from off-screen, in parallel with the backdrop fading.
  const CANCEL_SHEET_OFFSET = Dimensions.get('window').height;
  const cancelBackdropOpacity = useRef(new Animated.Value(0)).current;
  const cancelSheetY = useRef(new Animated.Value(CANCEL_SHEET_OFFSET)).current;
  useEffect(() => {
    if (!cancelWarning) return;
    cancelBackdropOpacity.setValue(0);
    cancelSheetY.setValue(CANCEL_SHEET_OFFSET);
    Animated.parallel([
      Animated.timing(cancelBackdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      // Deterministic slide (not an underdamped spring). With useNativeDriver
      // the button's touch target sits at the settled position while the sheet
      // is still visually moving/overshooting, so a tap during that window
      // missed and the user had to tap "Continuer" twice. A short, non-
      // overshooting slide settles the hit area almost immediately. (Same fix
      // as the customer reserve sheet.)
      Animated.timing(cancelSheetY, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [cancelWarning, cancelBackdropOpacity, cancelSheetY]);
  // Reverse the order on the way out: sheet slides down while the backdrop
  // fades, then we unmount and run any follow-up (e.g. navigation).
  const animateCloseCancelWarning = useCallback((after?: () => void) => {
    Animated.parallel([
      Animated.timing(cancelSheetY, { toValue: CANCEL_SHEET_OFFSET, duration: 180, useNativeDriver: true }),
      Animated.timing(cancelBackdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setCancelWarning(null);
      after?.();
    });
  }, [cancelBackdropOpacity, cancelSheetY]);
  const closeCancelWarning = useCallback(() => animateCloseCancelWarning(), [animateCloseCancelWarning]);
  // Drag-to-dismiss from the handle: the sheet follows the finger 1:1
  // downward (rubber-bands a third when dragged up) and the backdrop fades
  // proportionally, so the whole sheet slides down continuously as you drag.
  // Release past the threshold / with downward velocity dismisses; otherwise
  // it springs back. Mounted on the handle zone only.
  const cancelDragResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const dy = g.dy >= 0 ? g.dy : g.dy / 3;
        cancelSheetY.setValue(dy);
        cancelBackdropOpacity.setValue(Math.max(0, Math.min(1, 1 - Math.max(0, g.dy) / CANCEL_SHEET_OFFSET)));
      },
      onPanResponderRelease: (_, g) => {
        const projection = g.dy + g.vy * 60;
        if (projection > 80 || g.vy > 0.6) {
          const duration = Math.max(120, Math.min(280, 220 - g.vy * 50));
          Animated.parallel([
            Animated.timing(cancelSheetY, { toValue: CANCEL_SHEET_OFFSET, duration, useNativeDriver: true }),
            Animated.timing(cancelBackdropOpacity, { toValue: 0, duration, useNativeDriver: true }),
          ]).start(() => setCancelWarning(null));
        } else {
          Animated.parallel([
            Animated.spring(cancelSheetY, { toValue: 0, friction: 10, tension: 80, useNativeDriver: true }),
            Animated.timing(cancelBackdropOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
          ]).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(cancelSheetY, { toValue: 0, friction: 10, tension: 80, useNativeDriver: true }).start();
        cancelBackdropOpacity.setValue(1);
      },
    })
  ).current;
  const proceedToCancelReason = useCallback(() => {
    if (!cancelWarning) return;
    const target = cancelWarning;
    animateCloseCancelWarning(() => {
      router.push({
        pathname: '/cancel-reservation',
        params: {
          mode: 'business',
          reservationId: String(target.id),
          quantity: String(target.quantity ?? 1),
          locationId: target.locationId ?? '',
          merchantName: target.customerName ?? '',
        },
      } as never);
    });
  }, [cancelWarning, router, animateCloseCancelWarning]);

  const openVerifyModal = useCallback((orderId: string) => {
    setTypedCode('');
    setVerifyError('');
    setVerifySuccess(false);
    setVerifyModalOrderId(orderId);
  }, []);

  const closeVerifyModal = useCallback(() => {
    setVerifyModalOrderId(null);
    setTypedCode('');
    setVerifyError('');
    setVerifySuccess(false);
  }, []);

  // Swipe-down-to-close on the verify-pickup sheet. Disabled while a
  // confirmation call is in flight so the user can't accidentally
  // dismiss the loading state mid-network-call.
  const verifySwipe = useSwipeToDismiss(closeVerifyModal, { disabled: verifyLoading });

  /** Single real flow: verify code → confirmPickup → invalidate queries */
  const handleVerifyCode = useCallback(async () => {
    if (!verifyModalOrderId) return;
    const order = orders.find((o) => o.id === verifyModalOrderId);
    if (!order) return;

    // Backend codes may still be 8 chars on legacy orders; the customer
    // and the manual input on this screen are both clipped to the first
    // 6 characters, so the verify check must also compare on a 6-char
    // prefix or "ABCDEF" would never equal "ABCDEFGH".
    const expected = (order.pickupCode ?? '').trim().toUpperCase().substring(0, 6);
    const entered = typedCode.trim().toUpperCase();

    if (!entered) {
      setVerifyError(t('business.orders.enterPickupCode', { defaultValue: 'Please enter the pickup code.' }));
      return;
    }
    if (entered !== expected) {
      setVerifyError(t('business.orders.incorrectCode', { defaultValue: 'Incorrect code. Please try again.' }));
      return;
    }

    // Demo short-circuit: 'demo-order-1' / pickup code DEMO1 must NEVER hit
    // the backend (there's no such reservation server-side). Brief loading
    // → success → close modal → advance the walkthrough past the
    // verifyModalInput step so the user lands on the qrFab tour stop.
    if (verifyModalOrderId === 'demo-order-1') {
      setVerifyLoading(true);
      setTimeout(() => {
        setVerifyLoading(false);
        setVerifySuccess(true);
      }, 250);
      setTimeout(() => {
        closeVerifyModal();
        const cur = useWalkthroughStore.getState().currentStep?.measureKey;
        if (cur === 'verifyModalInput') {
          useWalkthroughStore.getState().nextStep(999);
        }
      }, 1500);
      return;
    }

    // Unified confirmation flow: instead of calling confirmPickup inline
    // (which left the user with a tiny ✓ in a bottom sheet), hand off to
    // /business/scan-qr with the code pre-filled. That screen owns the
    // RICH review (basket photo, address, pickup window, à-encaisser
    // breakdown) and the FULL-PAGE success animation — same UX whether
    // the merchant scanned the QR or typed the code by hand. The code
    // validation we just did is a fast-fail; scan-qr re-runs verifyQR
    // server-side before confirming, so there's no security regression.
    closeVerifyModal();
    router.push({ pathname: '/business/scan-qr', params: { prefillCode: entered } } as never);
  }, [verifyModalOrderId, typedCode, orders, closeVerifyModal, router, t]);

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const toggleExpand = useCallback((id: string) => {
    setExpandedOrderId((prev) => (prev === id ? null : id));
  }, []);

  // Reset the expanded-order state when the orders demo begins. Without
  // this, the demo order card starts expanded on the second run (the
  // expandedOrderId state from the previous run lingers because the orders
  // screen stays mounted in the tab cache) — which makes the "tap the card
  // to see details" prompt nonsensical (the only effect would be CLOSING
  // the card). Also covers the case where the user pressed "Voir la
  // commande" from the in-app notification popup earlier.
  useEffect(() => {
    if (demoOrderActive) setExpandedOrderId(null);
  }, [demoOrderActive]);

  // Tapping the demo order card to EXPAND it advances the orderCard
  // walkthrough step — mirrors how the demo BASKET card works (tap = advance)
  // and matches the "Appuyez sur la carte" hint. The walkthrough store only
  // acts on this flag while the current step has advanceOnFlag: 'expand'
  // (orderCard); every other step resets it on entry, so flipping it here is
  // a no-op outside that step.
  useEffect(() => {
    setExpandedDemoCardFlag(expandedOrderId === 'demo-order-1');
  }, [expandedOrderId, setExpandedDemoCardFlag]);
  useEffect(() => {
    setVerifyModalOpenFlag(verifyModalOrderId !== null);
  }, [verifyModalOrderId, setVerifyModalOpenFlag]);

  // Track keyboard visibility so the verify-modal instruction popup can
  // shrink to one short line when the keyboard is up (otherwise the popup
  // covers the input). Also re-measures the input + confirm-button rects
  // on every keyboard transition: KeyboardAvoidingView shifts the modal
  // sheet up/down, but onLayout doesn't fire for the inner children on
  // iOS (padding behaviour adds padding to the wrapper, not the children),
  // so the cached window rects go stale until we trigger a remeasure.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    if (verifyModalOrderId !== 'demo-order-1') return;
    const remeasure = () => {
      measureVerifyInput();
      measureVerifyConfirm();
    };
    const onShow = () => { setKeyboardVisible(true); remeasure(); setTimeout(remeasure, 250); };
    const onHide = () => { setKeyboardVisible(false); remeasure(); setTimeout(remeasure, 250); };
    const showSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', onHide);
    return () => { showSub.remove(); hideSub.remove(); };
  }, [verifyModalOrderId, measureVerifyInput, measureVerifyConfirm]);

  // Auto-close the verify modal once the walkthrough moves on to the qrFab
  // step. The orderConfirm step advances the demo as soon as the modal opens
  // (advanceOnFlag: 'modal'), and the next step highlights the FAB underneath
  // the modal — leaving the modal mounted would block the user from tapping
  // the FAB. Only fires for the demo order so real verifications aren't
  // interrupted mid-flow.
  const walkthroughCurrentStep = useWalkthroughStore((s) => s.currentStep);
  const measuredRects = useWalkthroughStore((s) => s.measuredRects);
  const insets = useSafeAreaInsets();
  const SW = Dimensions.get('window').width;
  const SH = Dimensions.get('window').height;
  useEffect(() => {
    if (
      walkthroughCurrentStep?.measureKey === 'qrFab' &&
      verifyModalOrderId === 'demo-order-1'
    ) {
      setVerifyModalOrderId(null);
    }
  }, [walkthroughCurrentStep?.measureKey, verifyModalOrderId]);
  // Defensive re-measure: when the walkthrough advances to `qrFab`, force a
  // fresh measurement of the FAB. The cached rect can go stale after a demo
  // restart (`startWalkthrough` clears `measuredRects`, but the FAB's
  // onLayout has already fired and won't re-fire without a remount), which
  // leaves the overlay in its dim-only fallback — the user sees the whole
  // page fade out with no halo.
  useEffect(() => {
    if (walkthroughCurrentStep?.measureKey === 'qrFab') {
      measureQrFab();
    }
  }, [walkthroughCurrentStep?.measureKey, measureQrFab]);

  const handleCancel = useCallback((orderId: string) => {
    alert.showAlert(
      t('business.orders.cancelOrder'),
      '',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              // Call backend to cancel the reservation
              await apiClient.delete(`/api/reservations/${orderId}`);
              // Refetch to update the list + dashboard tiles
              void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
              void queryClient.invalidateQueries({ queryKey: ['today-orders-count'] });
              void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
              void queryClient.invalidateQueries({ queryKey: ['business-analytics'] });
            } catch (err) {
              alert.showAlert(t('common.error'), getErrorMessage(err));
            }
          },
        },
      ]
    );
  }, [queryClient, t, alert]);

  // Status → tone mapping for the <StatusDot> component. Replaces the old
  // tinted-pill config (color + bg + icon + label). Icons are now inline
  // elsewhere when needed; the status chip itself is dot-first.
  const getStatusTone = (status: CanonicalStatus): { tone: 'warn' | 'info' | 'danger'; label: string } => {
    switch (status) {
      case 'confirmed':
        return { tone: 'warn', label: t('business.orders.statusReadyForPickup', { defaultValue: 'Ready for pickup' }) };
      case 'picked_up':
        return { tone: 'info', label: t('business.orders.statusPickedUpCard', { defaultValue: 'Vendu' }) };
      case 'cancelled':
        return { tone: 'danger', label: t('business.orders.statusCancelled', { defaultValue: 'Annulé' }) };
      case 'expired':
        return { tone: 'warn', label: t('business.orders.statusExpired', { defaultValue: 'Expiré' }) };
    }
  };

  // Show the loader for real data — but NOT during the demo walkthrough,
  // since the demo order is rendered synchronously and we don't want the
  // user to land on a blank loading screen mid-tour (which is what made
  // the walkthrough appear to get stuck after the notification fired).
  if (todayQuery.isLoading && !todayQuery.data && !demoOrderActive) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.orders.title')}
        </Text>
        {/* Render the FilterChip on every tab and hide it visually on
            'incoming' via opacity + pointerEvents='none'. That keeps the
            occupied width identical across tabs so the "Commandes" title's
            left edge never moves. An empty View with minWidth wasn't
            reliable because flex-row + justify-content:'space-between' was
            collapsing it when there was no child content. */}
        {(() => {
          // Always show the chip on every tab — it now also opens the
          // order-code search input, which is useful on incoming too
          // (the merchant may need to look up a specific reservation by
          // its code). Date / issue-type sections of the modal are still
          // contextual but the chip itself is now universal.
          const chipVisible = canViewHistory;
          // Chip label priority:
          //   1. Active search → show the query
          //   2. Incoming tab (no date filter exposed) → "Filtrer"
          //   3. Other tabs → the current date-filter label
          const chipLabel = orderIdSearch.trim()
            ? orderIdSearch.trim()
            : activeTab === 'incoming'
              ? t('common.filter', { defaultValue: 'Filtrer' })
              : dateFilter === 'today' ? t('business.orders.filterToday', { defaultValue: "Auj." })
              : dateFilter === 'month' ? t('business.orders.filterMonth', { defaultValue: 'Mois' })
              : t('business.orders.filterAll', { defaultValue: 'Tout' });
          return (
            <View style={{ opacity: chipVisible ? 1 : 0 }} pointerEvents={chipVisible ? 'auto' : 'none'}>
              <FilterChip
                icon={ClipboardList}
                active
                label={chipLabel}
                onPress={() => setShowBizFilterModal(true)}
              />
            </View>
          );
        })()}
      </View>

      {/* Fixed 3-stat green panel — mirrors the customer orders page's Impact
          slide so business + customer interfaces share one visual language.
          Always visible regardless of active tab. Restricted users (no
          view_history permission) get only the "en attente" cell. */}
      <View style={{
        backgroundColor: theme.colors.primary,
        borderRadius: theme.radii.r16,
        padding: 20,
        marginHorizontal: 20,
        marginTop: theme.spacing.sm,
      }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 4 }}>
            <Text style={{ color: activeTab === 'incoming' ? theme.colors.secondary : '#fff', ...theme.typography.h2 }}>{incomingOrders.length}</Text>
            <Text
              style={{
                color: activeTab === 'incoming' ? theme.colors.secondary : 'rgba(255,255,255,0.7)',
                ...theme.typography.caption,
                textAlign: 'center',
              }}
            >
              {t('business.orders.pendingPickup', { defaultValue: 'En attente' })}
            </Text>
          </View>
          {canViewHistory && (
            <>
              <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: activeTab === 'completed' ? theme.colors.secondary : '#fff', ...theme.typography.h2 }}>{completedOrders.length}</Text>
                <Text
                  style={{
                    color: activeTab === 'completed' ? theme.colors.secondary : 'rgba(255,255,255,0.7)',
                    ...theme.typography.caption,
                    textAlign: 'center',
                  }}
                >
                  {t('business.orders.statusPickedUp', {
                    count: completedOrders.length,
                    defaultValue: completedOrders.length === 1 ? 'Vendu' : 'Vendus',
                  })}
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: activeTab === 'issues' ? theme.colors.secondary : '#fff', ...theme.typography.h2 }}>{issueOrders.length}</Text>
                <Text
                  style={{
                    color: activeTab === 'issues' ? theme.colors.secondary : 'rgba(255,255,255,0.7)',
                    ...theme.typography.caption,
                    textAlign: 'center',
                  }}
                >
                  {t('business.orders.issues', { defaultValue: 'Problèmes' })}
                </Text>
              </View>
            </>
          )}
        </View>
      </View>

      {/* Tab bar — labels deliberately reuse the same i18n keys as the green
          info panel above so the tabs read as "En attente / Vendus / Problèmes"
          and stay in lock-step with the stat-cell copy. */}
      <View style={[styles.tabs, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.sm }]}>
        {(canViewHistory ? ['incoming', 'completed', 'issues'] as const : ['incoming'] as const).map((tab) => {
          const label = tab === 'incoming' ? t('business.orders.pendingPickup', { defaultValue: 'En attente' })
            : tab === 'completed' ? t('business.orders.statusPickedUp', { count: completedOrders.length, defaultValue: completedOrders.length === 1 ? 'Vendu' : 'Vendus' })
            : t('business.orders.issues', { defaultValue: 'Problèmes' });
          const count = tab === 'incoming' ? incomingOrders.length : tab === 'completed' ? completedOrders.length : issueOrders.length;
          return (
          <TouchableOpacity
            key={tab}
            activeOpacity={1}
            style={[
              styles.tab,
              {
                flex: 1,
                paddingVertical: theme.spacing.md,
                borderBottomWidth: 2,
                borderBottomColor: activeTab === tab ? (tab === 'issues' ? theme.colors.error : theme.colors.primary) : 'transparent',
              },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                {
                  color: activeTab === tab ? (tab === 'issues' ? theme.colors.error : theme.colors.primary) : theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                  fontWeight: activeTab === tab ? ('600' as const) : ('400' as const),
                  textAlign: 'center' as const,
                },
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        ref={ordersScrollRef}
        style={styles.content}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {hasNoLocation ? (
          // Compact variant + tight top margin so the empty-state card
          // sits just under the tabs strip instead of floating 100+px
          // below it (the old default-mode `<NoLocationCTA />` added
          // its own 60 px paddingTop on top of the 40 px marginTop here).
          <View style={{ marginTop: 8 }}>
            <NoLocationCTA compact />
          </View>
        ) : displayedOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 24 }}>
              <View style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r20,
                padding: 32,
                alignItems: 'center',
                width: '100%',
                ...theme.shadows.shadowSm,
              }}>
                <View style={{
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  backgroundColor: theme.colors.primary + '10',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 20,
                }}>
                  <ClipboardList size={40} color={theme.colors.primary} />
                </View>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center' }}>
                  {orderIdSearch.trim()
                    ? t('business.orders.noMatchingOrders', { defaultValue: 'Aucune commande trouvée' })
                    : activeTab === 'incoming'
                    ? t('business.orders.noOrdersToday', { defaultValue: 'No orders yet today' })
                    : t('business.orders.noCompletedOrders', { defaultValue: 'No completed orders' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 10, textAlign: 'center', lineHeight: 22 }}>
                  {orderIdSearch.trim()
                    ? t('business.orders.noMatchingOrdersDesc', { defaultValue: 'Aucune commande ne correspond à votre recherche. Effacez le filtre pour revoir la liste complète.' })
                    : activeTab === 'incoming'
                    ? t('business.orders.noOrdersDesc', { defaultValue: 'Orders will appear here when customers reserve your surprise bags.' })
                    : t('business.orders.noCompletedDesc', { defaultValue: 'Completed and cancelled orders will show up here.' })}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          displayedOrders.map((order) => {
            // Re-classify status='cancelled' rows that carry an expiry-type
            // reason (expired_no_pickup, customer_no_show, …) as EXPIRED.
            // Server sends `status='cancelled'` for these, but semantically
            // nobody cancelled — the window lapsed. UI must distinguish:
            // expired = orange badge, no "Annulé par" / motif row.
            const reasonIsExpiry =
              order.status === 'cancelled'
              && !!order.cancellationReason
              && EXPIRY_REASONS.has(order.cancellationReason);
            const orderExpired = isOrderExpired(order)
              || (activeTab === 'issues' && order.status === 'confirmed')
              || reasonIsExpiry;
            const displayStatus = orderExpired ? 'expired' as CanonicalStatus : order.status;
            const statusChip = getStatusTone(displayStatus);
            const isIncoming = order.status === 'confirmed' && !orderExpired;
            const isExpanded = expandedOrderId === order.id;
            const isDemoOrder = order.id === 'demo-order-1';

            return (
              <TouchableOpacity
                key={order.id}
                ref={isDemoOrder ? (demoOrderCardRef as any) : undefined}
                onLayout={(e) => {
                  // Two purposes: (1) record the y-position of each card
                  // so the deep-link effect can scroll to it; (2) keep
                  // the demo measurement working when it's the demo card.
                  const y = e.nativeEvent.layout.y;
                  orderCardYRef.current.set(String(order.id), y);
                  if (isDemoOrder) measureDemoOrderCard();
                  // If a deep-link is waiting for THIS card to mount,
                  // scroll now. Cleared so subsequent layout passes
                  // don't yank the scroll position back.
                  if (pendingScrollIdRef.current === String(order.id)) {
                    pendingScrollIdRef.current = null;
                    setTimeout(() => {
                      ordersScrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
                    }, 60);
                  }
                }}
                activeOpacity={0.85}
                onPress={() => {
                  // During the demo, only the demoOrderCard step asks the
                  // user to expand this card. After that step the card
                  // must stay expanded (subsequent steps highlight inner
                  // buttons), so card-body taps just no-op.
                  //
                  // The previous version fired `notifyTapHint` from this
                  // outer handler whenever the step wasn't demoOrderCard,
                  // but on some devices the touch responder hands the
                  // press to BOTH the inner button (chat / confirm /
                  // Suivant) AND this outer TouchableOpacity for the same
                  // tap — so the user saw the "Suivez les instructions"
                  // toast flash *right after* a perfectly correct button
                  // tap. The inner per-button gates already show the
                  // toast when a wrong button is tapped, so dropping the
                  // outer trigger is harmless and stops the spurious
                  // flashes. See the user report about the second half
                  // of the demo throwing the hint constantly.
                  if (isDemoOrder) {
                    if (walkthroughCurrentStep?.measureKey === 'demoOrderCard') {
                      toggleExpand(order.id);
                    }
                    return;
                  }
                  toggleExpand(order.id);
                }}
                style={[
                  styles.orderCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    padding: theme.spacing.lg,
                    marginBottom: theme.spacing.md,
                    ...theme.shadows.shadowSm,
                  },
                ]}
              >
                {/* Compact header — always visible */}
                <View style={styles.orderTop}>
                  {/* `minWidth: 0` + `marginRight: 8` is the canonical fix for
                      the "long text refuses to shrink inside a flex row" gotcha
                      on RN: without minWidth the text would push the right
                      column (pill + chevron + chat icon) off the right edge
                      instead of truncating. With minWidth: 0 the column
                      collapses to whatever room remains, and numberOfLines={1}
                      ellipsizes the customer / basket names cleanly. */}
                  <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                    <Text
                      style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}
                      // Show full name when expanded — collapsed truncates to
                      // one line, expanded wraps so the merchant sees the
                      // whole customer name (matches the customer-side card).
                      numberOfLines={isExpanded ? undefined : 1}
                    >
                      {order.customerName}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <Text
                        style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, flex: 1, minWidth: 0 }]}
                        numberOfLines={isExpanded ? undefined : 1}
                      >
                        {order.basketName}
                      </Text>
                      {/* Status badge is no longer rendered here — it lives
                          directly UNDER the pill + chevron in the right
                          column (see below) so it sits vertically aligned
                          with them on the right edge of the card. */}
                    </View>
                    {/* Price line moved out of the upper section — see the
                        unified bottom row below (price + payment icon on the
                        LEFT, time + order ID on the RIGHT). The bottom row
                        is tab-aware: incoming/en-attente shows "À encaisser"
                        and the credits chip; vendus/issues just show the
                        total price (credits info lives in the expanded
                        view's payment row). */}
                  </View>
                  {/* Right column — outer wrapper is a COLUMN so the
                      [chat / pill / chevron] inner row sits on top and the
                      issues-tab status badge stacks directly underneath them,
                      right-aligned. `alignItems: 'flex-end'` keeps the status
                      dot tight against the card's right edge.
                      `flexShrink: 0` guarantees the right column keeps its
                      natural width — so even with a very long customer name,
                      the icons stay at the right edge instead of being
                      squeezed. The text column's `minWidth: 0` does the
                      corresponding shrink work. */}
                  <View style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {isIncoming && canMessage && (
                      <TouchableOpacity
                        ref={isDemoOrder ? (orderCardChatRef as any) : undefined}
                        onLayout={isDemoOrder ? measureOrderCardChat : undefined}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          // During the demo, only allow the chat tap when
                          // the walkthrough is on the orderChat step — that
                          // step asks the user to open the chat. Other taps
                          // are silently no-op'd (no hint toast) — the
                          // halo already tells the user where to tap, and
                          // the previous "fire toast" branch could double-
                          // fire on a correct tap when RN's responder
                          // system handed the gesture to both this button
                          // AND the outer card.
                          if (isDemoOrder) {
                            if (walkthroughCurrentStep?.measureKey === 'orderCardChat') {
                              router.push({ pathname: '/message/[id]', params: { id: `res-${order.id}`, reservationId: String(order.id), buyerId: String(order.buyerId ?? ''), locationId: String(selectedLocationId ?? ''), demo: '1' } } as never);
                            }
                            return;
                          }
                          router.push({ pathname: '/message/[id]', params: { id: `res-${order.id}`, reservationId: String(order.id), buyerId: String(order.buyerId ?? ''), locationId: String(selectedLocationId ?? '') } } as never);
                        }}
                        style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <MessageCircle size={15} color={theme.colors.primary} />
                        {(msgUnreads[Number(order.id)] ?? 0) > 0 && (
                          <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, borderWidth: 2, borderColor: theme.colors.surface }}>
                            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{msgUnreads[Number(order.id)] > 9 ? '9+' : msgUnreads[Number(order.id)]}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    )}
                    {/* Quantity pill was here — moved to the expanded card
                        only per product feedback. Collapsed right column is
                        just [chat (incoming only) + chevron]. */}
                    {isExpanded
                      ? <ChevronUp size={16} color={theme.colors.textSecondary} />
                      : <ChevronDown size={16} color={theme.colors.textSecondary} />}
                  </View>
                  {/* Issues-tab status badge — stacks directly UNDER the
                      pill + chevron row, right-aligned (via the parent
                      column's `alignItems: 'flex-end'`). Vendus / Incoming
                      tabs skip it entirely. */}
                  {!isIncoming && displayStatus !== 'picked_up' && (
                    <StatusDot
                      tone={statusChip.tone}
                      label={statusChip.label}
                      dotColor={displayStatus === 'expired' ? '#ee7b3c' : undefined}
                    />
                  )}
                  </View>
                </View>

                {/* Collapsed-card bottom row — matches the customer
                    ReservationCard's compact shape:
                      LEFT  → payment-method icon + price + basket count
                              · incoming → cash-to-collect (or "Déjà payé"
                                for card and full-credit cases)
                              · completed / issues → order total
                      RIGHT → time-since-event only (order code removed —
                              it lives in the expanded view, and the user
                              can also search by code in the filter modal)
                    The bold action sentence on issues ("Annulée par le
                    client" etc.) is gone — it duplicates info already
                    shown in the expanded card and the status badge. The
                    ⓘ credits tap-target is also gone from collapsed; it
                    still exists on the expanded "Crédits utilisés" row. */}
                {!isExpanded && (() => {
                  const pm = order.payment_method ?? 'cash';
                  const isPendingTab = activeTab === 'incoming';
                  // Always cash or card icon — never wallet.
                  const isCard = pm === 'card';
                  const PMIcon = isCard ? CreditCard : Banknote;
                  const cashToCollect = Math.max(0, order.total - order.creditAmount);
                  let priceText: string;
                  if (isPendingTab) {
                    if (isCard || cashToCollect === 0) {
                      priceText = t('business.orders.alreadyPaid', { defaultValue: 'Déjà payé' });
                    } else {
                      priceText = t('business.orders.toCollectShort', { amount: fmtMoney(cashToCollect), defaultValue: 'À encaisser : {{amount}} TND' });
                    }
                  } else {
                    priceText = `${fmtMoney(order.total)} TND`;
                  }
                  return (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                        <PMIcon size={13} color={theme.colors.textSecondary} />
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const, fontFamily: 'Poppins_700Bold' }]}>
                          {priceText}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                          {/* Basket icon (ShoppingBag) — was ClipboardList,
                              which read as a "todo / clipboard" glyph and
                              didn't match the customer collapsed card. The
                              quantity is a count of BASKETS so the bag icon
                              matches the meaning directly. */}
                          <ShoppingBag size={14} color={theme.colors.textSecondary} />
                          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: '700' as const, fontFamily: 'Poppins_700Bold' }}>
                            {order.quantity}
                          </Text>
                        </View>
                      </View>
                      {(() => {
                        const evTime = isPendingTab ? order.createdAt : (order.updatedAt || order.createdAt);
                        return evTime ? (
                          <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
                            {timeAgo(evTime, t)}
                          </Text>
                        ) : null;
                      })()}
                    </View>
                  );
                })()}

                {/* Expanded details */}
                {isExpanded && (
                  <>
                    <View style={[styles.orderDetails, { marginTop: theme.spacing.md }]}>
                      {/* Order ID */}
                      <View style={styles.detailRow}>
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                          {t('orders.orderId', { defaultValue: 'Commande' })}
                        </Text>
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                          {orderIdToCode(order.id)}
                        </Text>
                      </View>
                      {/* Quantity — basket count for this order. Was missing
                          from the expanded business card before; the
                          collapsed view shows a small number next to the
                          basket icon but the expanded view skipped the
                          explicit row, so on completed/issues orders the
                          merchant couldn't see at a glance how many bags
                          were involved. Mirrors the "N paniers" row the
                          customer ReservationCard already has. */}
                      <View style={[styles.detailRow, { marginTop: 4 }]}>
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                          {t('business.orders.quantityLabel', { defaultValue: 'Quantité' })}
                        </Text>
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                          {order.quantity} {order.quantity > 1
                            ? t('basket.baskets', { defaultValue: 'paniers' })
                            : t('basket.basket', { defaultValue: 'panier' })}
                        </Text>
                      </View>
                      <View style={[styles.detailRow, { marginTop: 4 }]}>
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                          {t('reserve.total')}
                        </Text>
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}>
                          {fmtMoney(order.total)} TND
                        </Text>
                      </View>
                      {/* Payment method — ALWAYS rendered now, regardless of
                          whether the customer used credits. Previously the
                          credit-amount split was visible on the collapsed
                          card via the in-card credits chip, so the expanded
                          view skipped this row for credit orders. With the
                          collapsed card on the vendus / issues tabs now
                          hiding the credits chip (per the product rule that
                          credits/À-encaisser detail belongs ONLY to the
                          incoming tab), the expanded view becomes the
                          authoritative place to see "how much did this
                          customer use credits for". */}
                      {/* Combined Paiement row. Was two separate rows
                          (Paiement → method label, then Crédits utilisés →
                          credit chip). Now stacks both pieces of info in
                          one row's value column so the expanded card
                          carries less duplicate visual weight. The credit
                          chip + ⓘ are gated on creditAmount > 0; for cash/
                          card-only orders the second line is dropped and
                          this collapses back to the one-line "Paiement"
                          row it used to be. */}
                      <View style={[styles.detailRow, { marginTop: 4, alignItems: 'flex-start' }]}>
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, paddingTop: 2 }]}>
                          {t('business.orders.paymentMethod', { defaultValue: 'Paiement' })}
                        </Text>
                        {(() => {
                          const pm = order.payment_method ?? 'cash';
                          const isCard = pm === 'card';
                          const PMIcon = isCard ? CreditCard : Banknote;
                          const label = isCard
                            ? t('business.orders.paymentByCardShort', { defaultValue: 'En carte' })
                            : t('business.orders.paymentInCashShort', { defaultValue: 'En espèces' });
                          return (
                            <View style={{ flex: 1, alignItems: 'flex-end' }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <PMIcon size={13} color={theme.colors.textSecondary} />
                                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>{label}</Text>
                              </View>
                              {order.creditAmount > 0 ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: theme.colors.primary + '14', borderRadius: theme.radii.pill, paddingHorizontal: 7, height: 20 }}>
                                    <Wallet size={11} color={theme.colors.primary} />
                                    <Text style={{ color: theme.colors.primary, fontSize: 10, fontFamily: 'Poppins_600SemiBold' }}>
                                      {t('business.orders.creditsChip', { amount: fmtMoney(order.creditAmount), defaultValue: '{{amount}} TND en crédits' })}
                                    </Text>
                                  </View>
                                  <TouchableOpacity
                                    onPress={(e) => {
                                      e.stopPropagation?.();
                                      alert.showAlert(
                                        t('business.orders.creditsInfoTitle', { defaultValue: 'Paiement en crédits Barakeat' }),
                                        buildMerchantCreditsInfo(displayStatus, activeTab === 'incoming', order.creditAmount, t),
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
                          );
                        })()}
                      </View>
                      <View style={[styles.detailRow, { marginTop: 4 }]}>
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                          {t('basket.pickupWindow')}
                        </Text>
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                          {order.pickupWindow.start} - {order.pickupWindow.end}
                        </Text>
                      </View>
                      {/* Reservation date for incoming orders */}
                      {isIncoming && (
                        <View style={[styles.detailRow, { marginTop: 4 }]}>
                          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                            {t('business.orders.reservedAt', { defaultValue: 'Réservé le' })}
                          </Text>
                          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                            {new Date(order.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(order.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      )}
                      {/* Date of collection, cancellation, or expiry */}
                      {!isIncoming && (
                        <View style={[styles.detailRow, { marginTop: 4 }]}>
                          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                            {displayStatus === 'picked_up'
                              ? t('business.orders.collectedAt', { defaultValue: 'Récupéré le' })
                              : displayStatus === 'expired'
                              ? t('business.orders.expiredAt', { defaultValue: 'Expiré le' })
                              : t('business.orders.cancelledAt', { defaultValue: 'Annulé le' })}
                          </Text>
                          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                            {new Date(order.updatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(order.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      )}

                      {/* Cancellation detail. ALWAYS renders for a cancelled
                          order (even if backend didn't populate `cancelled_by`)
                          — we default the actor to "Commerce" since the row
                          must always tell the merchant who cancelled. Buyer
                          path is the literal word "client" (not the customer
                          name) per the merchant's spec; the member name only
                          appears as a sub-line for Commerce cancellations.
                          Suppressed when displayStatus is 'expired' — the
                          orange "Expiré" badge already conveys that. */}
                      {order.status === 'cancelled' && displayStatus !== 'expired' && (
                        <>
                          <View style={[styles.detailRow, { marginTop: 4, alignItems: 'flex-start' }]}>
                            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                              {t('business.orders.cancelledBy', { defaultValue: 'Annulé par' })}
                            </Text>
                            <View style={{ flex: 1, marginLeft: 8, alignItems: 'flex-end' }}>
                              {order.cancelledBy === 'buyer' ? (
                                <Text
                                  style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', textAlign: 'right' }]}
                                  numberOfLines={1}
                                >
                                  {t('business.orders.cancelledByBuyer', { defaultValue: 'client' })}
                                </Text>
                              ) : (
                                <>
                                  <Text
                                    style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', textAlign: 'right' }]}
                                    numberOfLines={1}
                                  >
                                    {t('business.orders.cancelledByBusiness', { defaultValue: 'Commerce' })}
                                  </Text>
                                  {order.cancelledByName ? (
                                    <Text
                                      style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'right', marginTop: 2 }]}
                                    >
                                      {t('business.orders.cancelledByMemberSub', { name: order.cancelledByName, defaultValue: `— ${order.cancelledByName}` })}
                                    </Text>
                                  ) : null}
                                </>
                              )}
                            </View>
                          </View>
                          {order.cancellationReason ? (
                            <View style={[styles.detailRow, { marginTop: 4, alignItems: 'flex-start', gap: 10 }]}>
                              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                                {t('business.orders.cancelReason', { defaultValue: 'Motif' })}
                              </Text>
                              {/* Collapses past 2 lines with a "Voir plus" toggle
                                  when the motif is long; tags the free-text
                                  reason with who cancelled. */}
                              <MotifText
                                value={formatMotif(
                                  order.cancellationReason,
                                  t,
                                  order.cancelledBy === 'business' ? 'business' : order.cancelledBy === 'buyer' ? 'customer' : null,
                                )}
                                textStyle={{ ...theme.typography.bodySm }}
                                color={theme.colors.textPrimary}
                                linkColor={theme.colors.primary}
                                align="right"
                                collapsedLines={2}
                                t={t}
                              />
                            </View>
                          ) : null}
                        </>
                      )}

                      {/* Confirmed by — who scanned the QR (permission-gated) */}
                      {canViewHistory && order.confirmedByName && order.status === 'picked_up' && (
                        <View style={[styles.detailRow, { marginTop: 4 }]}>
                          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                            {t('business.orders.confirmedBy', { defaultValue: 'Confirmé par' })}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <User size={12} color={theme.colors.primary} />
                            <Text style={[{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }]}>
                              {order.confirmedByName}
                            </Text>
                          </View>
                        </View>
                      )}

                      {/* Review — stars + comment (permission-gated) */}
                      {canViewHistory && order.review && (
                        <View style={{ marginTop: 8, backgroundColor: theme.colors.bg, borderRadius: 10, padding: 10 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: order.review.comment ? 6 : 0 }}>
                            <Star size={13} color="#f59e0b" fill="#f59e0b" />
                            <Text style={{ color: theme.colors.textPrimary, fontSize: 12, fontWeight: '700' }}>
                              {((Number(order.review.rating_service ?? 0) + Number(order.review.rating_quantity ?? 0) + Number(order.review.rating_quality ?? 0) + Number(order.review.rating_variety ?? 0)) / 4).toFixed(1)}
                            </Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>/5</Text>
                            {order.review.review_date && (
                              <Text style={{ color: theme.colors.muted, fontSize: 10, marginLeft: 'auto' }}>
                                {new Date(order.review.review_date).toLocaleDateString('fr-FR')}
                              </Text>
                            )}
                          </View>
                          {order.review.comment ? (
                            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontStyle: 'italic', lineHeight: 17 }} numberOfLines={3}>
                              « {order.review.comment} »
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </View>

                    {/* Action row — only for incoming confirmed orders */}
                    {isIncoming && (canConfirmPickup || canCancelOrder) && (
                      <View style={[styles.actionRow, { marginTop: theme.spacing.lg, paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider, gap: 8 }]}>
                        {canConfirmPickup && (
                        <TouchableOpacity
                          ref={isDemoOrder ? (orderCardConfirmBtnRef as any) : undefined}
                          onLayout={isDemoOrder ? measureOrderCardConfirm : undefined}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            // During the demo, only the orderCardConfirmBtn
                            // step opens the verify modal. Earlier steps
                            // (demoOrderCard / orderCardChat) silently
                            // no-op so accidental taps don't flash the
                            // "Suivez les instructions" toast when the
                            // user is doing the right thing elsewhere.
                            if (isDemoOrder) {
                              if (walkthroughCurrentStep?.measureKey === 'orderCardConfirmBtn') {
                                openVerifyModal(order.id);
                              }
                              return;
                            }
                            openVerifyModal(order.id);
                          }}
                          style={[
                            styles.actionBtn,
                            {
                              flex: 1,
                              backgroundColor: theme.colors.primary,
                              borderRadius: theme.radii.r12,
                              paddingHorizontal: 14,
                              paddingVertical: 10,
                              justifyContent: 'center',
                            },
                          ]}
                        >
                          <CheckCircle size={16} color="#fff" />
                          <Text style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 6 }]}>
                            {t('business.orders.confirmPickup', { defaultValue: 'Confirmer' })}
                          </Text>
                        </TouchableOpacity>
                        )}
                        {canCancelOrder && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {/* Quiet destructive trigger — just red text, no bg,
                              no border. The loud red fill lives in the sheet
                              confirmation below. */}
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation?.();
                              // No demo step ever asks to cancel — always a
                              // no-op for the demo order.
                              if (isDemoOrder) {
                                useWalkthroughStore.getState().notifyTapHint();
                                return;
                              }
                              // Open the warning sheet first; confirming there
                              // routes to the shared reason picker (which does
                              // the DELETE). Backend rejects business
                              // cancellations without a reason, and the buyer's
                              // notification reads the reason + payment context
                              // to explain what happens next.
                              setCancelWarning({
                                id: String(order.id),
                                customerName: order.customerName,
                                quantity: order.quantity,
                                locationId: order.location_id != null ? String(order.location_id) : undefined,
                                paymentMethod: order.payment_method,
                              });
                            }}
                            style={{ paddingHorizontal: 10, paddingVertical: 8 }}
                            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                          >
                            <Text style={{ color: theme.colors.error, fontSize: 13, fontFamily: 'Poppins_600SemiBold', fontWeight: '600' }}>
                              {t('business.orders.cancelOrder', { defaultValue: 'Annuler' })}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation?.();
                              alert.showAlert(
                                t('business.orders.cancelHelpTitle', { defaultValue: "À propos de l'annulation" }),
                                t('business.orders.cancelHelpDesc', { defaultValue: "N'annulez qu'en cas d'imprévu : stock manquant, fermeture inattendue, etc. Le client sera notifié et remboursé s'il a payé en avance." }),
                                undefined,
                                { type: 'info', layout: 'sheet' }
                              );
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={{ width: 22, height: 22, justifyContent: 'center', alignItems: 'center' }}
                          >
                            <HelpCircle size={14} color={theme.colors.textSecondary} />
                          </TouchableOpacity>
                        </View>
                        )}
                      </View>
                    )}

                    {/* Demo Suivant — replaces the previous 450 ms auto-advance
                        timer. Visible only while the walkthrough is on the
                        `demoOrderCard` step and the demo order card is
                        expanded; tapping flips `expandedDemoCard` true which
                        the walkthrough store watches via `advanceOnFlag`. */}
                    {isDemoOrder && walkthroughCurrentStep?.measureKey === 'demoOrderCard' && (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setExpandedDemoCardFlag(true);
                        }}
                        style={{
                          backgroundColor: '#114b3c',
                          borderRadius: theme.radii.r12,
                          paddingVertical: 12,
                          alignItems: 'center',
                          marginTop: theme.spacing.md,
                        }}
                      >
                        <Text style={{ color: '#fff', fontFamily: 'Poppins_700Bold', fontWeight: '700', fontSize: 14 }}>
                          {t('walkthrough.next', { defaultValue: 'Suivant' })}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* QR scanner FAB — only if member can confirm pickups. During the
          walkthrough's qrFab step we no-op the tap: the step is purely
          informational ("there's a shortcut here"), and the demo must never
          navigate into /business/scan-qr from the tour. */}
      {canConfirmPickup && <TouchableOpacity
        ref={qrFabRef as any}
        onLayout={measureQrFab}
        onPress={() => {
          // During the qrFab demo step, navigate to the scan screen with a
          // demoBack flag so the screen renders the "tap back to return"
          // instruction popup and skips its own demoScanCode manual flow.
          if (walkthroughCurrentStep?.measureKey === 'qrFab') {
            router.push({ pathname: '/business/scan-qr', params: { demoBack: '1' } } as never);
            return;
          }
          router.push('/business/scan-qr' as never);
        }}
        style={[styles.fabButton, {
          position: 'absolute',
          bottom: 100,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: theme.colors.primary,
          justifyContent: 'center',
          alignItems: 'center',
          ...theme.shadows.shadowLg,
        }]}
      >
        <QrCode size={24} color="#fff" />
      </TouchableOpacity>}

      {/* Verify Pickup modal — single purpose: enter code → confirmPickup */}
      <Modal
        visible={verifyModalOrderId !== null}
        transparent
        animationType="fade"
        onRequestClose={closeVerifyModal}
      >
        {/* backgroundColor on the KeyboardAvoidingView so the keyboard
            push-up region paints with the same dim color as the rest of
            the backdrop — without it the window's default (white)
            background leaks through beneath the keyboard. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <TouchableOpacity
            style={{ flex: 1, justifyContent: 'flex-end' }}
            activeOpacity={1}
            onPress={() => {
              // During the verifyModalInput demo step, the backdrop tap
              // is silently absorbed — the inline instruction popup at
              // the top of the screen is enough cue. Firing the hint
              // toast here used to flood the user with "Suivez les
              // instructions" notifications when the modal sheet sat
              // close to the screen edges.
              if (walkthroughCurrentStep?.measureKey === 'verifyModalInput') {
                return;
              }
              closeVerifyModal();
            }}
          >
            <Animated.View
              style={{
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                paddingHorizontal: 24,
                paddingBottom: 40,
                transform: [{ translateY: verifySwipe.translateY }],
                ...theme.shadows.shadowLg,
              }}
              onStartShouldSetResponder={() => true}
            >
              {/* Swipe zone — covers the full top strip of the sheet
                  (no left/right exclusions, generous vertical padding)
                  so the user can grab anywhere from the top edge down
                  to past the handle pill to start the swipe-down. */}
              <View
                {...verifySwipe.panHandlers}
                style={{ paddingTop: 10, paddingBottom: 14, alignItems: 'center' }}
              >
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.divider }} />
              </View>

              {/* Success state */}
              {verifySuccess ? (
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.primary + '18', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ fontSize: 32 }}>✓</Text>
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: 4 }}>
                    {t('business.orders.pickupConfirmed', { defaultValue: 'Pickup confirmed!' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>
                    {t('business.orders.orderMovedToPickedUp', { defaultValue: 'Order moved to picked up.' })}
                  </Text>
                </View>
              ) : (
                <>

                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: 8 }}>
                    {t('business.orders.verifyPickup', { defaultValue: 'Verify Pickup' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 20, lineHeight: 20 }}>
                    {verifyModalOrderId === 'demo-order-1'
                      ? t('business.orders.verifyDescDemo', { defaultValue: 'Mode démo : tapez le code DEMO ci-dessous puis « Confirmer le code » pour valider — ou appuyez sur Suivant dans l\'aide pour continuer la visite.' })
                      : t('business.orders.verifyDesc', { defaultValue: 'Ask the customer for their pickup code and enter it below, or use the QR scanner.' })}
                  </Text>

                  {/* Code entry path is shown for ALL orders (including the
                      demo) so the walkthrough can introduce the input. For
                      the demo order, handleVerifyCode short-circuits when
                      DEMO1 is entered — no backend call. */}
                  {/* Demo input is fully editable — the walkthrough copy
                      tells the user "Tapez DEMO01" and the verify handler's
                      demo short-circuit (line ~984) accepts the typed code
                      and advances the walkthrough. The earlier non-editable
                      wrapper was a UX dead-end (user reads "type DEMO01"
                      but the input refuses focus). The soft keyboard
                      shifting the modal sheet on Android is acceptable —
                      the halos re-measure after the keyboard settles. */}
                  <TextInput
                    ref={verifyInputRef}
                    onLayout={verifyModalOrderId === 'demo-order-1' ? measureVerifyInput : undefined}
                    style={{
                      height: 56,
                      backgroundColor: theme.colors.bg,
                      borderRadius: theme.radii.r12,
                      paddingHorizontal: 18,
                      color: theme.colors.textPrimary,
                      ...theme.typography.h3,
                      letterSpacing: 3,
                      textAlign: 'center',
                      borderWidth: verifyError ? 1 : 0,
                      borderColor: verifyError ? theme.colors.error : 'transparent',
                      marginBottom: 8,
                    }}
                    value={typedCode}
                    // Strip non-digits defensively for real orders (Android
                    // hardware keyboards / quirky keyboard skins can still
                    // inject letters past the number-pad hint). Demo order
                    // keeps its alphanumeric "DEMO01" code so the user can
                    // type exactly what the walkthrough prompt shows.
                    onChangeText={(v) => {
                      const next = verifyModalOrderId === 'demo-order-1'
                        ? v.toUpperCase().slice(0, 6)
                        : v.replace(/\D/g, '').slice(0, 6);
                      setTypedCode(next);
                      setVerifyError('');
                    }}
                    placeholder={verifyModalOrderId === 'demo-order-1' ? 'DEMO' : '123456'}
                    placeholderTextColor={theme.colors.muted}
                    keyboardType={verifyModalOrderId === 'demo-order-1' ? 'default' : 'number-pad'}
                    autoCapitalize={verifyModalOrderId === 'demo-order-1' ? 'characters' : 'none'}
                    autoCorrect={false}
                    maxLength={6}
                  />
                  {verifyError ? (
                    <Text style={{ color: theme.colors.error, ...theme.typography.caption, textAlign: 'center', marginBottom: 12 }}>
                      {verifyError}
                    </Text>
                  ) : <View style={{ height: 12 }} />}

                  <TouchableOpacity
                    ref={verifyConfirmRef}
                    onLayout={verifyModalOrderId === 'demo-order-1' ? measureVerifyConfirm : undefined}
                    onPress={handleVerifyCode}
                    disabled={verifyLoading}
                    style={{
                      backgroundColor: verifyLoading ? theme.colors.muted : theme.colors.primary,
                      borderRadius: theme.radii.r12,
                      paddingVertical: 16,
                      alignItems: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <Text style={{ color: '#fff', ...theme.typography.button }}>
                      {verifyLoading
                        ? t('common.loading', { defaultValue: 'Loading...' })
                        : t('business.orders.confirmCode', { defaultValue: 'Confirm Code' })}
                    </Text>
                  </TouchableOpacity>

                  {/* OR divider */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                    <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginHorizontal: 12, fontWeight: '600' as const }}>
                      {t('common.or', { defaultValue: 'OR' })}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                  </View>

                  <TouchableOpacity
                    ref={(r: any) => {
                      if (verifyModalOrderId === 'demo-order-1' && r) {
                        requestAnimationFrame(() => {
                          r.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                            if (w > 0 && h > 0) setMeasuredRect('verifyModalScanBtn', { x, y, w, h });
                          });
                        });
                      }
                    }}
                    onPress={() => {
                      // During the verifyModalInput demo step the Scan QR
                      // shortcut is silently disabled — the inline
                      // instruction popup already tells the user to type
                      // DEMO1 or tap Suivant. No hint toast: the previous
                      // version flooded the user with "Suivez les
                      // instructions" the moment they brushed this button.
                      if (walkthroughCurrentStep?.measureKey === 'verifyModalInput') {
                        return;
                      }
                      // Demo order: hand the scan-qr screen the demo pickup code
                      // so it boots in mocked-success mode instead of hitting the API.
                      if (verifyModalOrderId === 'demo-order-1') setDemoScanCode('DEMO');
                      closeVerifyModal();
                      router.push('/business/scan-qr' as never);
                    }}
                    style={{
                      borderRadius: theme.radii.r12,
                      paddingVertical: 14,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: theme.colors.primary,
                      flexDirection: 'row',
                      justifyContent: 'center',
                    }}
                  >
                    <QrCode size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
                    <Text style={{ color: theme.colors.primary, ...theme.typography.button }}>
                      {t('business.orders.scanQR', { defaultValue: 'Scan QR Code' })}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </Animated.View>
          </TouchableOpacity>

          {/* ── Walkthrough overlay for the verifyModalInput step ──────────
              Renders an SVG dim with cutouts on the code TextInput and the
              "Confirm Code" button, four absorber frames around the union of
              both rects to block accidental taps on dimmed surfaces, and a
              floating instruction popup at the top of the screen — OUTSIDE
              the modal sheet so it doesn't move with the sheet content.
              Quitter la démo closes BOTH the walkthrough and this modal. */}
          {(walkthroughCurrentStep?.measureKey === 'verifyModalInput' && verifyModalOrderId === 'demo-order-1' && !verifySuccess) && (() => {
            const inputRect = measuredRects.verifyModalInput;
            const confirmRect = measuredRects.verifyConfirmBtn;
            if (!inputRect || !confirmRect) {
              // Rects not measured yet — show full dim so the user doesn't
              // see un-dimmed Scan QR / OR divider mid-render.
              return (
                <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 9999 }}>
                  <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' }} />
                </View>
              );
            }
            // Combined bounding rect for the absorber frame.
            const bbX = Math.min(inputRect.x, confirmRect.x);
            const bbY = Math.min(inputRect.y, confirmRect.y);
            const bbR = Math.max(inputRect.x + inputRect.w, confirmRect.x + confirmRect.w);
            const bbB = Math.max(inputRect.y + inputRect.h, confirmRect.y + confirmRect.h);
            const bbW = bbR - bbX;
            const bbH = bbB - bbY;
            // SVG path with two rounded holes (one per highlighted element).
            const buildHole = (parts: string[], x: number, y: number, w: number, h: number, r: number) => {
              const radius = Math.max(0, Math.min(r, w / 2, h / 2));
              if (w <= 0 || h <= 0) return;
              const x2 = x + w, y2 = y + h;
              parts.push(
                `M${x + radius} ${y}`,
                `H${x2 - radius}`,
                `A${radius} ${radius} 0 0 1 ${x2} ${y + radius}`,
                `V${y2 - radius}`,
                `A${radius} ${radius} 0 0 1 ${x2 - radius} ${y2}`,
                `H${x + radius}`,
                `A${radius} ${radius} 0 0 1 ${x} ${y2 - radius}`,
                `V${y + radius}`,
                `A${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
                'Z',
              );
            };
            const parts: string[] = [`M0 0 H${SW} V${SH} H0 Z`];
            buildHole(parts, inputRect.x, inputRect.y, inputRect.w, inputRect.h, 12);
            buildHole(parts, confirmRect.x, confirmRect.y, confirmRect.w, confirmRect.h, 12);
            const absorb = {
              onStartShouldSetResponder: () => true,
              onResponderRelease: () => { /* absorb silently — see other
                  overlays. The hint toast fires only on real blocked
                  button taps (Scan QR, backdrop close), not on empty
                  space around the cutouts. */ },
            } as const;
            return (
              <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 9999 }}>
                {/* Visual dim with two cutouts — non-interactive. */}
                <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                  <Svg width={SW} height={SH} style={StyleSheet.absoluteFillObject} pointerEvents="none">
                    <Path d={parts.join(' ')} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
                  </Svg>
                </View>
                {/* Halo borders on each highlighted element. */}
                <View pointerEvents="none" style={{ position: 'absolute', left: inputRect.x, top: inputRect.y, width: inputRect.w, height: inputRect.h, borderRadius: 12, borderWidth: 3, borderColor: '#e3ff5c' }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: confirmRect.x, top: confirmRect.y, width: confirmRect.w, height: confirmRect.h, borderRadius: 12, borderWidth: 3, borderColor: '#e3ff5c' }} />
                {/* Four absorber frames around the combined bounding rect.
                    The input and Confirm button stay tappable through the
                    cutouts; everything else (Scan QR, OR divider, backdrop,
                    modal close gesture) is blocked. */}
                <View {...absorb} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: bbY }} />
                <View {...absorb} style={{ position: 'absolute', left: 0, right: 0, top: bbY + bbH, bottom: 0 }} />
                <View {...absorb} style={{ position: 'absolute', top: bbY, height: bbH, left: 0, width: bbX }} />
                <View {...absorb} style={{ position: 'absolute', top: bbY, height: bbH, left: bbX + bbW, right: 0 }} />
                {/* Floating instruction popup at the top of the screen.
                    When the keyboard is up we shrink to a single short line
                    ("Tapez DEMO1") so the popup doesn't crowd the input. */}
                {keyboardVisible ? (
                  <View style={{
                    position: 'absolute',
                    top: insets.top + 12,
                    left: 16,
                    right: 16,
                    backgroundColor: '#fff',
                    borderRadius: 14,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    flexDirection: 'row',
                    alignItems: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 6 },
                    shadowOpacity: 0.18,
                    shadowRadius: 14,
                    elevation: 10,
                  }}>
                    <Hand size={16} color="#114b3c" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#114b3c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                      {t('walkthrough.biz.verifyInput.short', { defaultValue: 'Tapez DEMO' })}
                    </Text>
                  </View>
                ) : (
                <View style={{
                  position: 'absolute',
                  top: insets.top + 20,
                  left: 16,
                  right: 16,
                  backgroundColor: '#fff',
                  borderRadius: 20,
                  padding: 18,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.18,
                  shadowRadius: 20,
                  elevation: 12,
                }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_500Medium', marginBottom: 8 }}>
                    {(walkthroughCurrentStep?.stepIndex ?? 0) + 1}/{walkthroughCurrentStep?.totalSteps ?? '?'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#114b3c12', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                      <Hand size={20} color="#114b3c" />
                    </View>
                    <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1 }}>
                      {t('walkthrough.biz.verifyInput.title', { defaultValue: 'Entrer le code de retrait' })}
                    </Text>
                  </View>
                  <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, marginBottom: 14 }}>
                    {t('walkthrough.biz.verifyInput.desc', { defaultValue: 'Le client vous montre son code de retrait. Tapez-le ici, par exemple DEMO, puis appuyez sur « Confirmer le code » pour valider la commande — ou appuyez sur Suivant pour continuer la démo.' })}
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => {
                      // Close the verify modal as part of quitting the demo,
                      // per user request — leaving the sheet open after Quit
                      // would be jarring.
                      closeVerifyModal();
                      useWalkthroughStore.getState().skipWalkthrough();
                    }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 13, fontFamily: 'Poppins_500Medium' }}>
                        {t('walkthrough.exitDemo', { defaultValue: 'Quitter la démo' })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        closeVerifyModal();
                        useWalkthroughStore.getState().nextStep(999);
                      }}
                      style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 9 }}
                    >
                      <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                        {t('walkthrough.next', { defaultValue: 'Suivant' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
                )}
                {/* Toast anchored at the bottom so it doesn't overlap the
                    top-aligned instruction popup. */}
                <DemoTapHintToast anchor="bottom" />
              </View>
            );
          })()}
        </KeyboardAvoidingView>
      </Modal>

      {/* Filter Modal */}
      <Modal visible={showBizFilterModal} transparent animationType="fade" onRequestClose={() => setShowBizFilterModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setShowBizFilterModal(false)}>
          <View style={{ position: 'absolute', top: 60, right: 20, backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16, minWidth: 240, ...theme.shadows.shadowLg }} onStartShouldSetResponder={() => true}>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 12 }}>
              {t('common.filter', { defaultValue: 'Filtrer' })}
            </Text>
            {/* Order code search — replaces the order code we removed from
                the collapsed bottom row. Substring match; runs on the
                currently-active tab's list. */}
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'none', letterSpacing: 0.5, marginBottom: 8 }}>
              {t('business.orders.orderCode', { defaultValue: 'Code commande' })}
            </Text>
            <TextInput
              value={orderIdSearch}
              onChangeText={setOrderIdSearch}
              placeholder={t('business.orders.orderCodePlaceholder', { defaultValue: 'BK-...' })}
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={{ borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: theme.colors.textPrimary, fontSize: 13, marginBottom: 12 }}
            />
            {/* Période — only relevant on completed / issues tabs. The
                en-attente tab feeds from today-orders, so every row is
                already today and the date filter would be a no-op
                (worse: setting it to "Mois" or "Tout" would just
                reshape the FUTURE completed/issues queries, confusing
                the user). Hidden on incoming. */}
            {activeTab !== 'incoming' && (
              <>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'none', letterSpacing: 0.5, marginBottom: 8 }}>
                  {t('business.orders.period', { defaultValue: 'Période' })}
                </Text>
                {(['today', 'month', 'all'] as const).map((f) => {
                  const label = f === 'today' ? t('business.orders.filterToday', { defaultValue: "Aujourd'hui" })
                    : f === 'month' ? t('business.orders.filterMonth', { defaultValue: 'Ce mois' })
                    : t('business.orders.filterAll', { defaultValue: 'Tout' });
                  const active = dateFilter === f;
                  return (
                    <TouchableOpacity key={f} onPress={() => setDateFilter(f)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: active ? theme.colors.primary : theme.colors.muted, backgroundColor: active ? theme.colors.primary : 'transparent', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                        {active && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />}
                      </View>
                      <Text style={{ color: active ? theme.colors.textPrimary : theme.colors.textSecondary, fontSize: 14, fontWeight: active ? '600' : '400' }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
            {activeTab === 'issues' && (
              <>
                <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: 12 }} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'none', letterSpacing: 0.5, marginBottom: 8 }}>
                  {t('business.orders.statusFilter', { defaultValue: 'Statut' })}
                </Text>
                {(['all', 'expired', 'cancelled'] as const).map((f) => {
                  const label = f === 'all' ? t('common.all', { defaultValue: 'Tout' })
                    : f === 'expired' ? t('business.orders.expiredFilter', { defaultValue: 'Expirées' })
                    : t('business.orders.cancelledFilter', { defaultValue: 'Annulées' });
                  const active = issueTypeFilter === f;
                  return (
                    <TouchableOpacity key={f} onPress={() => setIssueTypeFilter(f)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: active ? theme.colors.primary : theme.colors.muted, backgroundColor: active ? theme.colors.primary : 'transparent', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                        {active && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />}
                      </View>
                      <Text style={{ color: active ? theme.colors.textPrimary : theme.colors.textSecondary, fontSize: 14, fontWeight: active ? '600' : '400' }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
            <TouchableOpacity onPress={() => setShowBizFilterModal(false)} style={{ backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 14 }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{t('common.done', { defaultValue: 'Appliquer' })}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Cancel warning sheet — mirrors the customer's bottom-sheet warning.
          Confirming here routes to the shared /cancel-reservation reason
          picker (?mode=business), which records the motif and performs the
          DELETE. Keeps the destructive confirmation a two-step flow. */}
      <Modal
        visible={!!cancelWarning}
        transparent
        animationType="none"
        onRequestClose={closeCancelWarning}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {/* Dim backdrop — fades in/out in place, never slides. */}
          <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', opacity: cancelBackdropOpacity }} />
          <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={closeCancelWarning} />
          {/* Sheet — slides up after the backdrop has faded in. */}
          <Animated.View style={{ transform: [{ translateY: cancelSheetY }] }}>
          <PaperSurface radius={24} shadow="lg" style={{ width: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingTop: 10, paddingBottom: insets.bottom + 20 }}>
            {/* Drag zone — grab here to slide the sheet down to dismiss. */}
            <View {...cancelDragResponder.panHandlers} style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 14 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.divider }} />
            </View>
            <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
              <View style={{ backgroundColor: theme.colors.error + '15', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <AlertTriangle size={28} color={theme.colors.error} />
              </View>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' as const, textAlign: 'center', marginBottom: 4 }}>
                {t('orders.cancelConfirmTitle', { defaultValue: 'Annuler cette commande ?' })}
              </Text>
              {cancelWarning?.customerName ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16 }}>
                  {cancelWarning.customerName}
                </Text>
              ) : null}
            </View>

            <View style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
              <View style={{ backgroundColor: theme.colors.surfaceMuted, borderRadius: 14, padding: 16, gap: 10, marginBottom: 20, borderWidth: 1, borderColor: theme.colors.border }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const }}>
                  {t('orders.cancelConsequences', { defaultValue: 'Si vous annulez :' })}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <User size={14} color={theme.colors.textSecondary} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                    {t('business.orders.cancelWarnNotified', { defaultValue: 'Le client sera notifié de l\'annulation' })}
                  </Text>
                </View>
                {cancelWarning?.paymentMethod === 'cash' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Banknote size={14} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                      {t('business.orders.cancelWarnNoRefundCash', { defaultValue: 'Aucun remboursement — paiement en espèces' })}
                    </Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Wallet size={14} color="#16a34a" />
                    <Text style={{ color: '#16a34a', ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                      {t('business.orders.cancelWarnRefund', { defaultValue: 'Le client sera remboursé en crédits' })}
                    </Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ShoppingBag size={14} color={theme.colors.textSecondary} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                    {t('business.orders.cancelWarnBasketReturned', { defaultValue: 'Le panier retourne en stock' })}
                  </Text>
                </View>
              </View>

              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16, lineHeight: 20 }}>
                {t('orders.cancelIrreversible', { defaultValue: 'Cette action est irréversible et ne peut pas être annulée.' })}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={closeCancelWarning}
                  style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
                    {t('orders.keepOrder', { defaultValue: 'Garder' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={proceedToCancelReason}
                  style={{ flex: 1, backgroundColor: theme.colors.error, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
                    {t('business.orders.cancelContinue', { defaultValue: 'Continuer' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </PaperSurface>
          </Animated.View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {},
  tabs: { flexDirection: 'row' },
  tab: {},
  content: { flex: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center' },
  orderCard: {},
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  statusBadge: { flexDirection: 'row', alignItems: 'center' },
  orderDetails: {},
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center' },
  fabButton: {},
});
