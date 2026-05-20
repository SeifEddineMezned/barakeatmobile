import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, Dimensions, Keyboard } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { DemoTapHintToast } from '@/src/components/DemoTapHintToast';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock, QrCode, ClipboardList, Check, X as XIcon, ChevronDown, ChevronUp, AlertTriangle, MessageCircle, Star, User, Banknote, Wallet, HelpCircle, Hand } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { StatusBar } from 'expo-status-bar';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTodayOrders, fetchLocationOrders, confirmPickup, type TodayReservationFromAPI } from '@/src/services/business';
import { getErrorMessage, apiClient } from '@/src/lib/api';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { StatusDot } from '@/src/components/StatusDot';
import { FilterChip } from '@/src/components/FilterChip';
import { fetchConversationUnreads } from '@/src/services/messages';
import { fetchMyContext, fetchOrganizationDetails } from '@/src/services/teams';
import { NoLocationCTA } from '@/src/components/NoLocationCTA';
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
  location_id?: number;
  basket_id?: number;
}

/** Map any legacy backend status string into the canonical UI status. */
function normalizeStatus(raw: string | undefined): CanonicalStatus {
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
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const targetOrderId = useBusinessStore((s) => s.targetOrderId);
  const targetOrderLocationId = useBusinessStore((s) => s.targetOrderLocationId);
  const targetOrderTs = useBusinessStore((s) => s.targetOrderTs);
  const setSelectedLocationId = useBusinessStore((s) => s.setSelectedLocationId);
  const [activeTab, setActiveTab] = useState<'incoming' | 'completed' | 'issues'>('incoming');
  const [dateFilter, setDateFilter] = useState<'today' | 'month' | 'all'>('month');
  const [issueTypeFilter, setIssueTypeFilter] = useState<'all' | 'expired' | 'cancelled'>('all');
  const [showBizFilterModal, setShowBizFilterModal] = useState(false);
  const statsScrollRef = useRef<ScrollView>(null);
  const queryClient = useQueryClient();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);

  const todayQuery = useQuery({
    queryKey: ['today-orders', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnMount: 'always',
    retry: 1,
  });

  // Historical orders for completed/issues tabs (supports date filtering)
  const historyQuery = useQuery({
    queryKey: ['location-orders', selectedLocationId, dateFilter],
    queryFn: () => fetchLocationOrders(selectedLocationId, dateFilter),
    staleTime: 15_000,
    refetchOnMount: 'always',
    retry: 2,
  });

  const msgUnreadsQuery = useQuery({
    queryKey: ['conversation-unreads'],
    queryFn: fetchConversationUnreads,
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchOnMount: 'always',
  });
  const msgUnreads = msgUnreadsQuery.data ?? {};

  // Permission checks for granular actions
  const ctxQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 10_000 });
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
  const hasNoLocation = isOrgAdminScope
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
    return {
      id: String(o.id),
      buyerId: o.buyer_id,
      basketName: (o as any).basket_name ?? (o as any).restaurant_name ?? t('orders.surpriseBag', { defaultValue: 'Panier Surprise' }),
      quantity: o.quantity ?? 1,
      total: Number(o.price_tier ?? 0) * (o.quantity ?? 1),
      pickupWindow: { start: pickupStart, end: pickupEnd },
      pickupCode: o.pickup_code ?? '',
      status: normalizeStatus(o.status),
      createdAt: o.created_at ?? new Date().toISOString(),
      updatedAt: (o as any).updated_at ?? o.created_at ?? new Date().toISOString(),
      customerName: o.buyer_name ?? t('business.orders.customer'),
      customerPhone: o.buyer_phone ?? undefined,
      confirmedByName: (o as any).confirmed_by_name ?? undefined,
      review: (o as any).review ?? null,
      cancellationReason: (o as any).cancellation_reason ?? null,
      cancelledBy: (o as any).cancelled_by ?? null,
      cancelledByName: (o as any).cancelled_by_name ?? null,
      payment_method: (o as any).payment_method ?? 'cash',
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
      pickupCode: 'DEMO1',
      status: 'confirmed',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      customerName: t('walkthrough.biz.demoOrderCustomer', { defaultValue: 'Sami (démo)' }),
      payment_method: 'cash',
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
      pushDemoPopup([{
        id: -Date.now(),
        user_id: 0,
        type: 'new_reservation',
        title: t('walkthrough.biz.demoNotifTitle', { defaultValue: 'Nouvelle réservation' }),
        message: t('walkthrough.biz.demoNotifMessage', { defaultValue: 'Sami a réservé 2 Paniers Surprise.' }),
        is_read: false,
        created_at: new Date().toISOString(),
      }]);
    }, 250);
    return () => clearTimeout(timer);
  }, [demoOrderActive, pushDemoPopup, t]);

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
  const isOrderExpired = (o: NormalizedOrder) =>
    o.id !== 'demo-order-1' &&
    o.status === 'confirmed' && o.pickupWindow.end && isPickupExpiredInTz(o.pickupWindow.end);

  const incomingOrders = useMemo(
    () => orders.filter((o) => o.status === 'confirmed' && !isOrderExpired(o)),
    [orders, timeTick]
  );

  const completedOrders = useMemo(
    () => allOrders.filter((o) => o.status === 'picked_up'),
    [allOrders]
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
      return [...todayExpired, ...historicalIssues];
    },
    [orders, allOrders, timeTick]
  );

  const filteredIssueOrders = useMemo(() => {
    if (issueTypeFilter === 'all') return issueOrders;
    if (issueTypeFilter === 'expired') return issueOrders.filter((o) => o.status === 'confirmed' || o.status === 'expired');
    return issueOrders.filter((o) => o.status === 'cancelled');
  }, [issueOrders, issueTypeFilter]);

  const displayedOrders = activeTab === 'incoming' ? incomingOrders : activeTab === 'completed' ? completedOrders : filteredIssueOrders;

  // ── Deep-link: navigate to exact order from activity log / notifications ──
  // Deep-link: find and expand the target order
  const lastOrderTsRef = useRef(0);
  useEffect(() => {
    // Read fresh values from store every time
    const { targetOrderId: tid, targetOrderLocationId: tLocId, targetOrderTs: tTs } = useBusinessStore.getState();
    if (!tid || tTs <= lastOrderTsRef.current) return;
    lastOrderTsRef.current = tTs;

    // Switch location if needed
    if (tLocId && String(tLocId) !== String(selectedLocationId)) {
      setSelectedLocationId(tLocId);
    }
    setDateFilter('all');
    void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['location-orders'] });

    // Retry expanding until the order is found (queries may need to refetch)
    let attempts = 0;
    const loc = useBusinessStore.getState().selectedLocationId;
    const tryExpand = () => {
      // Read fresh data from query cache each attempt
      const todayData: any[] = queryClient.getQueryData(['today-orders', loc]) ?? [];
      const histData: any[] = queryClient.getQueryData(['location-orders', loc, 'all']) ?? queryClient.getQueryData(['location-orders', loc, dateFilter]) ?? [];
      const all = [...todayData, ...histData];
      const found = all.find((o: any) => String(o.id) === String(tid));
      if (found) {
        const status = normalizeStatus(found.status);
        if (status === 'picked_up') setActiveTab('completed');
        else if (status === 'cancelled' || status === 'expired') setActiveTab('issues');
        else setActiveTab('incoming');
        setExpandedOrderId(String(found.id));
        useBusinessStore.getState().setTargetOrder(null);
      } else if (attempts < 8) {
        attempts++;
        setTimeout(tryExpand, 500);
      }
    };
    setTimeout(tryExpand, 200);
  }, [targetOrderId, targetOrderTs]);

  // Auto-scroll stat carousel to active tab
  const statsTabIndex = activeTab === 'incoming' ? 0 : activeTab === 'completed' ? 1 : 2;
  useEffect(() => {
    const screenW = Dimensions.get('window').width;
    const cardW = screenW * 0.38;
    const gap = 8;
    statsScrollRef.current?.scrollTo({ x: statsTabIndex * (cardW + gap) - (screenW - cardW) / 2 + cardW / 2, animated: true });
  }, [statsTabIndex]);

  // ─── Verify-pickup modal state ──────────────────────────────────────────────
  const [verifyModalOrderId, setVerifyModalOrderId] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);

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

  /** Single real flow: verify code → confirmPickup → invalidate queries */
  const handleVerifyCode = useCallback(async () => {
    if (!verifyModalOrderId) return;
    const order = orders.find((o) => o.id === verifyModalOrderId);
    if (!order) return;

    const expected = (order.pickupCode ?? '').trim().toUpperCase();
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

    setVerifyLoading(true);
    try {
      // Pass buyerId so backend can send pickup notification to the buyer
      await confirmPickup(order.id, order.pickupCode, order.buyerId);

      setVerifySuccess(true);

      // Invalidate + refetch after a brief pause to let the DB settle.
      // Both caches matter: today-orders drives the "incoming" tab, location-orders
      // drives the "finished"/"issues" tabs. Without the second invalidation the
      // picked-up order stays invisible on the finished tab until the stale window
      // (15s) passes or the tab remounts.
      setTimeout(async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['today-orders'] }),
          queryClient.invalidateQueries({ queryKey: ['today-orders-count'] }),
          queryClient.invalidateQueries({ queryKey: ['location-orders'] }),
        ]);
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['today-orders', selectedLocationId] }),
          queryClient.refetchQueries({ queryKey: ['location-orders', selectedLocationId, dateFilter] }),
        ]);
      }, 500);

      // Close after showing the success state
      setTimeout(() => {
        closeVerifyModal();
      }, 2000);
    } catch (err) {
      setVerifySuccess(false);
      setVerifyError(getErrorMessage(err));
    } finally {
      setVerifyLoading(false);
    }
  }, [verifyModalOrderId, typedCode, orders, closeVerifyModal, selectedLocationId, dateFilter, queryClient, t]);

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

  // Sync demo-card expansion + verify-modal flags into the walkthrough store
  // so the overlay's 'expand' / 'modal' advance triggers can fire. When the
  // user expands the demo order, hold the flag for ~2.5 s before flipping
  // it true so they have a moment to actually look at the expanded card
  // before the demo moves on to the next step.
  useEffect(() => {
    if (expandedOrderId === 'demo-order-1') {
      const id = setTimeout(() => setExpandedDemoCardFlag(true), 450);
      return () => clearTimeout(id);
    }
    setExpandedDemoCardFlag(false);
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
              // Refetch to update the list
              void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
              void queryClient.invalidateQueries({ queryKey: ['today-orders-count'] });
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
        <StatusBar style="dark" />
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.orders.title')}
        </Text>
        {canViewHistory && (activeTab === 'completed' || activeTab === 'issues') && (
          <FilterChip
            icon={ClipboardList}
            active={dateFilter !== 'today' || issueTypeFilter !== 'all'}
            label={
              dateFilter === 'today' ? t('business.orders.filterToday', { defaultValue: "Auj." })
                : dateFilter === 'month' ? t('business.orders.filterMonth', { defaultValue: 'Mois' })
                : t('business.orders.filterAll', { defaultValue: 'Tout' })
            }
            onPress={() => setShowBizFilterModal(true)}
          />
        )}
      </View>

      {/* Stat carousel — syncs with active tab */}
      {(() => {
        const screenW = Dimensions.get('window').width;
        const cardW = screenW * 0.38;
        const gap = 8;

        const allSlides = [
          { key: 'incoming' as const, icon: Clock, iconColor: '#e3ff5c', bg: theme.colors.primary, textColor: '#fff', subColor: 'rgba(255,255,255,0.7)', count: incomingOrders.length, label: t('business.orders.pendingPickup', { defaultValue: 'en attente de retrait' }) },
          { key: 'completed' as const, icon: Check, iconColor: '#114b3c', bg: '#e3ff5c', textColor: '#114b3c', subColor: theme.colors.textSecondary, count: completedOrders.length, label: t('business.orders.statusPickedUp', { count: completedOrders.length, defaultValue: completedOrders.length === 1 ? 'vendu' : 'vendus' }) },
          { key: 'issues' as const, icon: XIcon, iconColor: theme.colors.error, bg: theme.colors.error + '14', textColor: theme.colors.error, subColor: theme.colors.textSecondary, count: issueOrders.length, label: t('business.orders.issues', { count: issueOrders.length, defaultValue: issueOrders.length === 1 ? 'annulée' : 'annulées' }) },
        ];
        const slides = canViewHistory ? allSlides : allSlides.filter(s => s.key === 'incoming');

        return (
        <ScrollView
          ref={statsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: theme.spacing.sm, flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 20, gap }}
        >
          {slides.map((s) => {
            const isActive = activeTab === s.key;
            const SlideIcon = s.icon;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => setActiveTab(s.key)}
                activeOpacity={0.85}
                style={{
                  width: cardW,
                  backgroundColor: s.bg,
                  borderRadius: theme.radii.r12,
                  height: 60,
                  paddingHorizontal: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  opacity: isActive ? 1 : 0.5,
                  borderWidth: isActive ? 2 : 0,
                  borderColor: isActive ? s.textColor + '40' : 'transparent',
                }}
              >
                <SlideIcon size={14} color={s.iconColor} />
                <Text style={{ color: s.textColor, fontSize: 18, fontFamily: 'Poppins_700Bold' }}>
                  {s.count}
                </Text>
                <Text style={{ color: s.subColor, fontSize: 10, fontFamily: 'Poppins_400Regular', flex: 1 }} numberOfLines={1}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        );
      })()}

      {/* Tab bar — En cours / Terminées / Problèmes */}
      <View style={[styles.tabs, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.sm }]}>
        {(canViewHistory ? ['incoming', 'completed', 'issues'] as const : ['incoming'] as const).map((tab) => {
          const label = tab === 'incoming' ? t('business.orders.incoming')
            : tab === 'completed' ? t('business.orders.completed')
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
        style={styles.content}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {hasNoLocation ? (
          <View style={{ marginTop: 40 }}>
            <NoLocationCTA />
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
                  {activeTab === 'incoming'
                    ? t('business.orders.noOrdersToday', { defaultValue: 'No orders yet today' })
                    : t('business.orders.noCompletedOrders', { defaultValue: 'No completed orders' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 10, textAlign: 'center', lineHeight: 22 }}>
                  {activeTab === 'incoming'
                    ? t('business.orders.noOrdersDesc', { defaultValue: 'Orders will appear here when customers reserve your surprise bags.' })
                    : t('business.orders.noCompletedDesc', { defaultValue: 'Completed and cancelled orders will show up here.' })}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          displayedOrders.map((order) => {
            const orderExpired = isOrderExpired(order) || (activeTab === 'issues' && order.status === 'confirmed');
            const displayStatus = orderExpired ? 'expired' as CanonicalStatus : order.status;
            const statusChip = getStatusTone(displayStatus);
            const isIncoming = order.status === 'confirmed' && !orderExpired;
            const isExpanded = expandedOrderId === order.id;
            const isDemoOrder = order.id === 'demo-order-1';

            return (
              <TouchableOpacity
                key={order.id}
                ref={isDemoOrder ? (demoOrderCardRef as any) : undefined}
                onLayout={isDemoOrder ? measureDemoOrderCard : undefined}
                activeOpacity={0.85}
                onPress={() => {
                  // During the demo, only the demoOrderCard step asks the
                  // user to expand this card. After that step the card must
                  // stay expanded (subsequent steps highlight buttons inside
                  // it), so any tap on the card body — which would toggle
                  // it shut — is silenced with a hint toast.
                  if (isDemoOrder) {
                    if (walkthroughCurrentStep?.measureKey === 'demoOrderCard') {
                      toggleExpand(order.id);
                    } else {
                      useWalkthroughStore.getState().notifyTapHint();
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
                  <View style={{ flex: 1 }}>
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]} numberOfLines={1}>
                      {order.customerName}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
                      <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, flexShrink: 1 }]} numberOfLines={1}>
                        {order.basketName}
                      </Text>
                      {/* Quantity pill — mirrors the badge styling in my-baskets.tsx */}
                      <View style={{
                        backgroundColor: theme.colors.primary,
                        borderRadius: theme.radii.pill,
                        minWidth: 24,
                        height: 22,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 7,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Poppins_700Bold' }}>
                          {order.quantity}
                        </Text>
                      </View>
                    </View>
                  </View>
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
                          // would derail the demo, so they're no-op'd with
                          // a hint toast.
                          if (isDemoOrder) {
                            if (walkthroughCurrentStep?.measureKey === 'orderCardChat') {
                              router.push({ pathname: '/message/[id]', params: { id: `res-${order.id}`, reservationId: String(order.id), buyerId: String(order.buyerId ?? ''), locationId: String(selectedLocationId ?? ''), demo: '1' } } as never);
                            } else {
                              useWalkthroughStore.getState().notifyTapHint();
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
                    {!isIncoming && (
                      <StatusDot tone={statusChip.tone} label={statusChip.label} />
                    )}
                    {isExpanded
                      ? <ChevronUp size={16} color={theme.colors.textSecondary} />
                      : <ChevronDown size={16} color={theme.colors.textSecondary} />}
                  </View>
                </View>

                {/* Order ID — bottom-right when collapsed, hidden when expanded */}
                {!isExpanded && (
                  <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
                    <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
                      {orderIdToCode(order.id)}
                    </Text>
                  </View>
                )}

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
                      <View style={[styles.detailRow, { marginTop: 4 }]}>
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                          {t('reserve.total')}
                        </Text>
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}>
                          {order.total} TND
                        </Text>
                      </View>
                      {/* Payment method — credits orders are prepaid and
                          shouldn't collect cash on pickup, so credits get a
                          success-green dot. Cash reads as neutral copy. */}
                      <View style={[styles.detailRow, { marginTop: 4 }]}>
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                          {t('business.orders.paymentMethod', { defaultValue: 'Paiement' })}
                        </Text>
                        {order.payment_method === 'credits' ? (
                          <StatusDot tone="success" label={t('business.orders.paymentCredits', { defaultValue: 'Payé en crédits' })} />
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Banknote size={13} color={theme.colors.textSecondary} />
                            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                              {t('business.orders.paymentCash', { defaultValue: 'Espèces' })}
                            </Text>
                          </View>
                        )}
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
                            {order.status === 'picked_up'
                              ? t('business.orders.collectedAt', { defaultValue: 'Récupéré le' })
                              : order.status === 'expired'
                              ? t('business.orders.expiredAt', { defaultValue: 'Expiré le' })
                              : t('business.orders.cancelledAt', { defaultValue: 'Annulé le' })}
                          </Text>
                          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                            {new Date(order.updatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(order.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      )}

                      {/* Cancellation detail: who cancelled + free-text reason, if supplied. */}
                      {order.status === 'cancelled' && (
                        <>
                          {order.cancelledBy && (
                            <View style={[styles.detailRow, { marginTop: 4, alignItems: 'flex-start' }]}>
                              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                                {t('business.orders.cancelledBy', { defaultValue: 'Annulé par' })}
                              </Text>
                              <Text
                                style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1, textAlign: 'right', marginLeft: 8 }]}
                                numberOfLines={2}
                                ellipsizeMode="tail"
                              >
                                {order.cancelledBy === 'buyer'
                                  ? t('business.orders.cancelledByBuyer', { defaultValue: 'le client' })
                                  : order.cancelledByName
                                    ? t('business.orders.cancelledByMember', { name: order.cancelledByName, defaultValue: `${order.cancelledByName} (commerce)` })
                                    : t('business.orders.cancelledByBusiness', { defaultValue: 'le commerce' })}
                              </Text>
                            </View>
                          )}
                          {order.cancellationReason ? (
                            <View style={[styles.detailRow, { marginTop: 4, alignItems: 'flex-start' }]}>
                              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                                {t('business.orders.cancelReason', { defaultValue: 'Motif' })}
                              </Text>
                              <Text
                                style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1, textAlign: 'right' }]}
                                numberOfLines={3}
                              >
                                {order.cancellationReason}
                              </Text>
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
                            // (demoOrderCard / orderCardChat) shouldn't let
                            // a stray tap skip ahead, so they no-op with a
                            // hint toast.
                            if (isDemoOrder) {
                              if (walkthroughCurrentStep?.measureKey === 'orderCardConfirmBtn') {
                                openVerifyModal(order.id);
                              } else {
                                useWalkthroughStore.getState().notifyTapHint();
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
                              // TODO (next update): prompt the business to enter a cancellation reason
                              // before confirming — this should discourage abusive cancellations and
                              // give the customer more context in the notification.
                              alert.showAlert(
                                t('business.orders.cancelOrder', { defaultValue: 'Annuler la commande' }),
                                t('business.orders.cancelOrderConfirm', { defaultValue: "Le client sera remboursé si la commande a été payée par carte ou en crédits. Cette action est irréversible." }),
                                [
                                  { text: t('orders.keepOrder', { defaultValue: 'Garder' }), style: 'cancel' },
                                  { text: t('business.orders.confirmCancel', { defaultValue: 'Annuler la commande' }), style: 'destructive', onPress: async () => {
                                    try {
                                      await apiClient.delete(`/api/reservations/${order.id}`);
                                      void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
                                      void queryClient.invalidateQueries({ queryKey: ['location-orders'] });
                                      void queryClient.invalidateQueries({ queryKey: ['locations'] });
                                      void queryClient.invalidateQueries({ queryKey: ['location', order.location_id] });
                                      void queryClient.invalidateQueries({ queryKey: ['baskets'] });
                                      void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', order.location_id] });
                                      if (order.basket_id) void queryClient.invalidateQueries({ queryKey: ['basket', String(order.basket_id)] });
                                      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
                                      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
                                    } catch {}
                                  }},
                                ],
                                { type: 'warning', layout: 'sheet' }
                              );
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
                                t('business.orders.cancelHelpDesc', { defaultValue: "N'annulez qu'en cas d'imprévu : stock manquant, fermeture inattendue, etc. Le client sera notifié et remboursé s'il a payé en avance. Des annulations répétées peuvent affecter votre visibilité." }),
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
            activeOpacity={1}
            onPress={() => {
              // During the verifyModalInput demo step, the backdrop tap
              // must not close the sheet — flash the hint toast so the
              // user knows to follow the popup instead.
              if (walkthroughCurrentStep?.measureKey === 'verifyModalInput') {
                useWalkthroughStore.getState().notifyTapHint();
                return;
              }
              closeVerifyModal();
            }}
          >
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                padding: 24,
                paddingBottom: 40,
                ...theme.shadows.shadowLg,
              }}
              onStartShouldSetResponder={() => true}
            >
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
                  {/* Handle */}
                  <View style={{ alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.divider }} />
                  </View>

                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: 8 }}>
                    {t('business.orders.verifyPickup', { defaultValue: 'Verify Pickup' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 20, lineHeight: 20 }}>
                    {verifyModalOrderId === 'demo-order-1'
                      ? t('business.orders.verifyDescDemo', { defaultValue: 'Mode démo : tapez le code DEMO1 ci-dessous puis « Confirmer le code » pour valider — ou appuyez sur Suivant dans l\'aide pour continuer la visite.' })
                      : t('business.orders.verifyDesc', { defaultValue: 'Ask the customer for their pickup code and enter it below, or use the QR scanner.' })}
                  </Text>

                  {/* Code entry path is shown for ALL orders (including the
                      demo) so the walkthrough can introduce the input. For
                      the demo order, handleVerifyCode short-circuits when
                      DEMO1 is entered — no backend call. */}
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
                    onChangeText={(v) => { setTypedCode(v); setVerifyError(''); }}
                    placeholder={verifyModalOrderId === 'demo-order-1' ? 'DEMO1' : 'ABCD1234'}
                    placeholderTextColor={theme.colors.muted}
                    autoCapitalize="characters"
                    autoCorrect={false}
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
                      // During the verifyModalInput demo step we don't want
                      // the user to escape into /business/scan-qr — flash
                      // the hint toast so they know to use the code input
                      // or Suivant instead.
                      if (walkthroughCurrentStep?.measureKey === 'verifyModalInput') {
                        useWalkthroughStore.getState().notifyTapHint();
                        return;
                      }
                      // Demo order: hand the scan-qr screen the demo pickup code
                      // so it boots in mocked-success mode instead of hitting the API.
                      if (verifyModalOrderId === 'demo-order-1') setDemoScanCode('DEMO1');
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
            </View>
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
                      {t('walkthrough.biz.verifyInput.short', { defaultValue: 'Tapez DEMO1' })}
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
                    {t('walkthrough.biz.verifyInput.desc', { defaultValue: 'Le client vous montre son code de retrait. Tapez-le ici, par exemple DEMO1, puis appuyez sur « Confirmer le code » pour valider la commande — ou appuyez sur Suivant pour continuer la démo.' })}
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
          <View style={{ position: 'absolute', top: 60, right: 20, backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16, minWidth: 220, ...theme.shadows.shadowLg }} onStartShouldSetResponder={() => true}>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 12 }}>
              {t('common.filter', { defaultValue: 'Filtrer' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
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
            {activeTab === 'issues' && (
              <>
                <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: 12 }} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
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
