import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable, Image, Modal, Animated, Dimensions, useWindowDimensions, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Plus, Clock, ShoppingBag, MoreVertical, Minus, X, MapPin, Hand, TimerOff, Pause, AlertTriangle, ChevronRight, Info } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useStatusBarStyleOnFocus } from '@/src/hooks/useStatusBarStyleOnFocus';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { DEMO_BASKET_PHOTOS } from '@/src/lib/demoData';
import { DemoTapHintToast } from '@/src/components/DemoTapHintToast';
import { fetchMyContext, fetchOrganizationDetails } from '@/src/services/teams';
import { NoLocationCTA } from '@/src/components/NoLocationCTA';
import { isPickupExpiredInTz, effectiveLocationHours } from '@/src/utils/timezone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyBaskets, deleteBasket as deleteBasketAPI, fetchMyProfile, updateQuantity, updateBasket as updateBasketAPI, updateBasketWithImage, type BusinessBasketFromAPI } from '@/src/services/business';
import { verifyOrAlarm, createVerifyDisappeared } from '@/src/hooks/useVerifyOnError';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { ActionMenuCard, ActionMenuItem, ActionMenuDivider } from '@/src/components/ui/ActionMenu';
import { EditIcon8, DeleteIcon8, PlayIcon8, PauseIcon8, Icon8Preloader } from '@/src/components/ui/Icon8';
import { effectiveDailyReinit, nextReinitQuantity, hasPerDayReinit, reinitScheduleEntries, nextResetDayKey } from '@/src/utils/dailyReinit';
import { formatLocationName } from '@/src/utils/formatLocation';

// Map reinit day keys (mon…sun) to the i18n label keys used elsewhere (Mon…Sun).
const DAY_KEY_TO_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

export default function MyBasketsScreen() {
  useStatusBarStyleOnFocus('dark');
  const targetBasketId = useBusinessStore((s) => s.targetBasketId);
  const targetBasketTs = useBusinessStore((s) => s.targetBasketTs);
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const store = useBusinessStore();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const queryClient = useQueryClient();
  const alert = useCustomAlert();

  // Permission check — granular basket permissions
  const contextQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 10_000 });
  const myRole = contextQuery.data?.role ?? 'member';
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  // Detect "org owner with zero locations" — same logic as the dashboard.
  // When true the screen short-circuits to a single "add a location" CTA;
  // baskets can't exist without a location.
  const orgIdForNoLoc = contextQuery.data?.organization_id;
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgIdForNoLoc],
    queryFn: () => fetchOrganizationDetails(orgIdForNoLoc!),
    enabled: !!orgIdForNoLoc,
    staleTime: 300_000,
    // Force a fresh fetch every mount so the per-location pickup hours used
    // by the inheritance fallback in `baskets` (below) reflect any recent
    // location-hours edits made from business-profile.
    refetchOnMount: 'always',
  });
  const isOrgAdmin = (myRole === 'owner' || myRole === 'admin') && !contextQuery.data?.location_id;
  // Suppressed during the walkthrough — see [_layout.tsx:206]. The demo
  // injects fake baskets via demoBasketActive, so the empty-state CTA
  // must step aside while the tour is running.
  const basketsWalkthroughStep = useWalkthroughStore((s) => s.step);
  const hasNoLocation = basketsWalkthroughStep === null
    && isOrgAdmin
    && !!orgIdForNoLoc
    && !orgDetailsQuery.isLoading
    && (orgDetailsQuery.data?.locations?.length ?? 0) === 0;
  const rawPerms = contextQuery.data?.permissions ?? {};
  const hasPerm = (key: string) => { const v = (rawPerms as any)[key]; return v === true || v === 'true' || v === 'write'; };
  const canEditQuantities = isAdmin || hasPerm('edit_quantities');
  const canEditBasketInfo = isAdmin || hasPerm('edit_basket_info');
  const canCreateDeleteBaskets = isAdmin || hasPerm('create_delete_baskets');
  const canEditBaskets = canEditQuantities || canEditBasketInfo || canCreateDeleteBaskets;

  const basketsQuery = useQuery({
    queryKey: ['my-baskets', selectedLocationId],
    queryFn: () => fetchMyBaskets(selectedLocationId),
    // Stock count is the fastest-changing field, but the mutations
    // for quantity / pause / delete all invalidate this key. 2 min
    // is plenty of room.
    staleTime: 2 * 60_000,
    retry: 1,
  });

  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 30_000,
    // Force a fresh fetch on every mount so the inline pickup-editor's
    // "use business hours" toggle always snaps to the location's CURRENT
    // opening hours, not a possibly-stale cached snapshot.
    refetchOnMount: 'always',
  });

  const currentQty = profileQuery.data?.available_quantity ?? 0;
  // Show the location's hours for TODAY (per-day weekly_schedule wins over the
  // flat widest span), resolved client-side from weekly_schedule.
  const todayProfileHours = effectiveLocationHours(profileQuery.data as any);
  const isLocationClosedToday = todayProfileHours.closed === true;
  const pickupStart = todayProfileHours.start || '--:--';
  const pickupEnd = todayProfileHours.end || '--:--';

  const qtyMutation = useMutation({
    mutationFn: (qty: number) => updateQuantity(qty),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
    },
  });

  const basketUpdateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      console.log('[MyBaskets] Saving basket', id, 'with:', JSON.stringify(data));
      // Silent retry on transient network failures. The first attempt
      // can drop on a Railway hiccup / SSL handshake glitch / cellular
      // dead air, and the merchant tap then surfaces a hard error
      // popup for what's actually a flake. Retry ONCE after a short
      // backoff before letting onError fire. We don't retry on real
      // 4xx/5xx because those are deterministic — only the
      // "no response arrived" failures (no err.status, or a 502/503/
      // 504 gateway code).
      const isTransient = (e: any) => {
        if (!e) return false;
        const status = Number(e?.status ?? e?.response?.status ?? 0);
        if (!status) return true; // no response at all → network error
        return status === 502 || status === 503 || status === 504;
      };
      try {
        const result = await updateBasketAPI(id, data);
        console.log('[MyBaskets] Server returned:', JSON.stringify({ id: result?.id, quantity: result?.quantity, daily_reinitialization_quantity: result?.daily_reinitialization_quantity, status: result?.status }));
        return result;
      } catch (firstErr: any) {
        if (!isTransient(firstErr)) throw firstErr;
        console.log('[MyBaskets] First attempt failed transiently, retrying once...');
        await new Promise((r) => setTimeout(r, 800));
        const result = await updateBasketAPI(id, data);
        console.log('[MyBaskets] Server returned (after retry):', JSON.stringify({ id: result?.id, quantity: result?.quantity, daily_reinitialization_quantity: result?.daily_reinitialization_quantity, status: result?.status }));
        return result;
      }
    },
    onSuccess: (updatedBasket: BusinessBasketFromAPI) => {
      console.log('[MyBaskets] Basket saved OK, quantity:', updatedBasket?.quantity);
      // Immediately patch the React Query cache so the UI updates without waiting for refetch
      queryClient.setQueryData<BusinessBasketFromAPI[]>(['my-baskets'], (old) => {
        if (!old) return old;
        return old.map((b) =>
          String(b.id) === String(updatedBasket.id)
            ? { ...b, ...updatedBasket }
            : b
        );
      });
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      const locId = updatedBasket?.location_id ? String(updatedBasket.location_id) : null;
      if (locId) {
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', locId] });
        void queryClient.invalidateQueries({ queryKey: ['location', locId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['basket', String(updatedBasket.id)] });
    },
    onError: async (err: any, variables) => {
      console.error('[MyBaskets] Save FAILED:', err?.status, err?.message, JSON.stringify(err?.data));
      // Verify-before-alarming. The basket save sometimes succeeds
      // server-side but the response never arrives (cellular packet
      // drop, Railway slowness past the 30 s axios timeout). Before
      // showing a popup that would lie to the user, refetch the
      // basket list and see whether the change is actually there.
      //
      // verify() compares each top-level key in the just-sent
      // `variables.data` against the freshly-refetched basket row.
      // If every requested field matches, the write committed and we
      // silently treat as success (invalidate the standard caches and
      // dismiss). If anything still differs, we fall through to the
      // soft "refresh and retry" popup. Image / blob fields are
      // skipped by the comparator since they're not directly diffable.
      await verifyOrAlarm<BusinessBasketFromAPI[]>({
        error: err,
        queryClient,
        verifyKey: ['my-baskets'],
        verify: (fresh) => {
          if (!Array.isArray(fresh)) return false;
          const live = fresh.find((b) => String(b.id) === String(variables.id));
          if (!live) return false;
          // Every primitive field in `variables.data` should match
          // `live` for us to confidently treat the save as confirmed.
          for (const [k, v] of Object.entries(variables.data ?? {})) {
            if (v === undefined || v === null) continue;
            if (k === 'image' || k === 'image_url') continue;
            if (typeof v === 'object') continue;
            if (String((live as any)[k] ?? '') !== String(v)) return false;
          }
          return true;
        },
        onConfirmed: () => {
          console.log('[MyBaskets] Save SUCCEEDED silently — server committed, response was lost');
          // Reflect on every dependent cache the same way onSuccess does.
          void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
          void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
          void queryClient.invalidateQueries({ queryKey: ['locations'] });
        },
        onUnconfirmed: () => {
          // Soft, brand-protective copy. Raw "Failed to update basket"
          // / network exception text reads as "our server is broken"
          // — alarming when most are transient blips. The merchant
          // gets a calm "refresh and retry" prompt instead.
          const status = Number(err?.status ?? err?.response?.status ?? 0);
          const isNetwork = !status || status === 502 || status === 503 || status === 504;
          alert.showAlert(
            t('business.baskets.saveErrorTitle', { defaultValue: 'Connexion instable' }),
            isNetwork
              ? t('business.baskets.saveErrorRetry', {
                  defaultValue: 'Un petit souci de connexion. Veuillez actualiser l’application puis réessayer.',
                })
              : t('business.baskets.saveErrorGeneric', {
                  defaultValue: 'Modification non enregistrée. Veuillez actualiser l’application puis réessayer.',
                }),
          );
        },
      });
    },
  });

  // Map of location_id -> location row from org-details, so a basket that
  // inherits its pickup window from its location (basket columns NULL) can
  // still display the right times even in "all locations" mode where every
  // basket may belong to a different location than `selectedLocationId`.
  const locationsById = React.useMemo(() => {
    const m = new Map<number, { pickup_start_time?: string; pickup_end_time?: string; name?: string; weekly_schedule?: any }>();
    for (const loc of orgDetailsQuery.data?.locations ?? []) {
      if (typeof loc.id === 'number') m.set(loc.id, loc);
    }
    return m;
  }, [orgDetailsQuery.data?.locations]);

  // Normalize API baskets to match existing Basket type — no fallback to demo data
  const baskets = (basketsQuery.data ?? []).map((b: BusinessBasketFromAPI) => {
    // Inheritance fallback: when the basket's pickup columns are NULL (the
    // "use business hours" contract), surface the basket's specific
    // location's hours. Previously this fell back to a hardcoded
    // '18:00'-'19:00', which is what produced the bug where saving with
    // "use business hours" checked made the basket display 18:00-19:00
    // regardless of the location's real hours.
    const ownLoc = b.location_id != null ? locationsById.get(Number(b.location_id)) : undefined;
    // Resolve TODAY's hours for the basket's own location (per-day
    // weekly_schedule wins over the flat widest span), then the current profile.
    const ownLocToday = ownLoc ? effectiveLocationHours(ownLoc as any) : null;
    const fallbackStart = (ownLocToday?.start || undefined)
      ?? (todayProfileHours.start || undefined)
      ?? '09:00';
    const fallbackEnd = (ownLocToday?.end || undefined)
      ?? (todayProfileHours.end || undefined)
      ?? '18:00';
    return {
      id: String(b.id),
      merchantId: String(b.location_id ?? ''),
      merchantName: '',
      name: b.name,
      category: b.category ?? '',
      originalPrice: Number(b.original_price ?? 0),
      discountedPrice: Number(b.selling_price ?? 0),
      discountPercentage: Number(b.original_price ?? 0) > 0
        ? Math.round(((Number(b.original_price ?? 0) - Number(b.selling_price ?? 0)) / Number(b.original_price ?? 0)) * 100)
        : 0,
      pickupWindow: {
        start: b.pickup_start_time?.substring(0, 5) ?? fallbackStart,
        end: b.pickup_end_time?.substring(0, 5) ?? fallbackEnd,
      },
      // Raw pickup-override flag — true iff the basket has its own pickup
      // time set on the row (i.e. NOT inheriting from the location). The
      // edit modal reads this to default the "use business hours" checkbox.
      hasPickupOverride: !!(b.pickup_start_time && b.pickup_end_time),
      quantityLeft: Number(b.quantity) || 0,
      quantityTotal: effectiveDailyReinit(b),
      // What the basket will RESET to at the next 03:30 (today's value if before
      // 03:30, else tomorrow's), plus the per-day schedule for the popup.
      nextReinit: nextReinitQuantity(b),
      perDayReinit: hasPerDayReinit(b),
      reinitSchedule: reinitScheduleEntries(b),
      distance: 0,
      address: '',
      latitude: 0,
      longitude: 0,
      exampleItems: [],
      imageUrl: b.image_url ?? undefined,
      // A basket is active iff:
      //   - it hasn't been soft-deleted, AND
      //   - it hasn't been manually paused (`status === 'paused'`), AND
      //   - it has stock available.
      // The explicit `paused` status takes precedence so the merchant can
      // stop reservations without zeroing their stock count.
      isActive: b.status !== 'deleted' && b.status !== 'paused' && Number(b.quantity) > 0,
      isPaused: b.status === 'paused',
      description: b.description ?? undefined,
      maxPerCustomer: (b as any).max_per_customer ?? 5,
      updatedAt: b.updated_at ?? undefined,
      // Resolve via orgDetails lookup so the label is a pure function of
      // (location_id, orgDetails). The basket row's `location_name` field
      // returns stale right after a location switch, which surfaced as the
      // "Gourmandise basket shows Lac 1's label after switching" bug.
      locationName: ownLoc?.name ?? (b as any).location_name ?? undefined,
    };
  });

  const { toggleBasketActive, updateBasket, profile } = store;

  const updateQuantityMutation = useMutation({
    mutationFn: async ({ basketId, quantity }: { basketId: string; quantity: number }) => {
      return updateBasketAPI(basketId, { quantity });
    },
    onSuccess: (updated: any) => {
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      const locId = updated?.location_id ? String(updated.location_id) : null;
      if (locId) {
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', locId] });
        void queryClient.invalidateQueries({ queryKey: ['location', locId] });
      }
      if (updated?.id) {
        void queryClient.invalidateQueries({ queryKey: ['basket', String(updated.id)] });
      }
    },
  });

  const deleteBasketMutation = useMutation({
    mutationFn: (id: string) => deleteBasketAPI(id),
    onSuccess: () => {
      // Land the user back on the full baskets list after a delete — never
      // on a stray detail modal or action popover left over from the flow
      // that triggered the delete.
      setDetailBasket(null);
      setActionMenu(null);
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      if (selectedLocationId) {
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', String(selectedLocationId)] });
      }
    },
    onError: async (err, deletedId) => {
      // Verify-before-alarming. The DELETE may have succeeded server-side
      // even when the response was lost; refetch the list and check
      // whether the basket is gone before showing a popup.
      await verifyOrAlarm<BusinessBasketFromAPI[]>({
        error: err,
        queryClient,
        verifyKey: ['my-baskets'],
        verify: createVerifyDisappeared((cache) => cache as any, deletedId),
        onConfirmed: () => {
          console.log('[MyBaskets] Delete confirmed via refetch — server actually committed');
          setDetailBasket(null);
          setActionMenu(null);
          void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
          void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
          void queryClient.invalidateQueries({ queryKey: ['locations'] });
        },
        onUnconfirmed: () => alert.showAlert(t('common.error'), getErrorMessage(err)),
      });
    },
  });
  const [quantityModalBasket, setQuantityModalBasket] = useState<string | null>(null);
  const [tempQuantity, setTempQuantity] = useState(0);
  const [detailBasket, setDetailBasket] = useState<typeof baskets[0] | null>(null);
  // Inline delete-confirmation overlay shown *inside* the detail modal.
  // We can't reuse the global CustomAlert here because iOS won't render a
  // second native <Modal> on top of an already-open one — the alert would
  // silently vanish. This state drives an absolute-positioned card painted
  // within the detail modal's own tree, so the confirmation visibly stacks
  // on top of the availability sheet.
  const [modalDeleteId, setModalDeleteId] = useState<string | null>(null);
  // Anchored action popover (Modifier / Supprimer). Holds the screen-space
  // anchor coordinates measured from the 3-dots button at open time so the
  // popover renders next to the button. `surface` distinguishes the two
  // call sites: 'list' = card 3-dots on the my-baskets page, 'modal' =
  // 3-dots inside the basket detail modal. The list surface renders as a
  // root-level <Modal> for clipping-proof overlay; the modal surface
  // renders inline inside the detail modal (no nested Modals).
  const [actionMenu, setActionMenu] = useState<{
    basketId: string;
    top: number;
    right: number;
    surface: 'list' | 'modal';
  } | null>(null);
  // Only the detail modal still has its own 3-dot menu; the card itself
  // no longer renders one, so cardDotsRefs / openCardMenu are gone.
  const modalDotsRef = React.useRef<View | null>(null);

  const openModalMenu = useCallback(() => {
    const screenW = Dimensions.get('window').width;
    const id = detailBasket?.id;
    if (!id) return;
    const node = modalDotsRef.current;
    if (!node || typeof (node as any).measureInWindow !== 'function') {
      setActionMenu({ basketId: id, top: 80, right: 20, surface: 'modal' });
      return;
    }
    (node as any).measureInWindow((x: number, y: number, w: number, h: number) => {
      setActionMenu({
        basketId: id,
        top: y + h + 6,
        right: Math.max(8, screenW - (x + w)),
        surface: 'modal',
      });
    });
  }, [detailBasket?.id]);
  // Custom 180 ms fade for the detail modal. RN's built-in animationType
  // ="fade" runs ~300 ms with no override, which combined with the
  // post-save step advance felt sluggish during the demo. `modalRender`
  // keeps the native Modal mounted through the fade-out so the backdrop
  // animation can play before unmount.
  const modalBackdropAnim = useRef(new Animated.Value(0)).current;
  const [modalRender, setModalRender] = useState(false);
  // Open with a 180 ms fade-in; close instantly. A fade-out left the
  // inner cards (title/price block + qty +/− block) visibly hanging for
  // ~200 ms because their background colors had to fade through opacity
  // and Android elevation shadows linger separately. Snapping closed is
  // the cleanest fix — no lingering rectangles, no ghost shadows.
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (detailBasket) {
      setClosing(false);
      setModalRender(true);
      Animated.timing(modalBackdropAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    } else if (modalRender) {
      setClosing(true);
      modalBackdropAnim.setValue(0);
      setModalRender(false);
    }
  }, [detailBasket]);

  // ── In-modal walkthrough dim layer ─────────────────────────────────────
  // During the modalQtyMinus / modalQtyPlus / modalSave sub-steps the rest
  // of the demo dims the page around the haloed control. The Modal's
  // contents weren't covered by that dim (the layout-level overlay is
  // beneath the Modal in z-order, and renders null for inline-modal steps),
  // so the modal sheet stayed at full brightness with just a halo on the
  // active button — visually out of step with the rest of the tour. This
  // dim layer mounts inside the Modal, covers the whole window, and cuts
  // out only the active control and the instruction tooltip so both stay
  // crisp and tappable.
  const { width: SW_MODAL, height: SH_MODAL } = useWindowDimensions();
  const qtyMinusBtnRef = useRef<View>(null);
  const qtyPlusBtnRef = useRef<View>(null);
  const qtySaveBtnRef = useRef<View>(null);
  const [modalCutoutRects, setModalCutoutRects] = useState<{
    minus?: { x: number; y: number; w: number; h: number };
    plus?: { x: number; y: number; w: number; h: number };
    save?: { x: number; y: number; w: number; h: number };
  }>({});
  // Animated `top` for the floating instruction popup. The popup is always
  // anchored to the qty row (top edge measured via onLayout). During the
  // qty sub-steps it sits BELOW the qty row (so the −/+ buttons stay clear)
  // and extends downward, naturally covering the disabled Save button.
  // When the demo reaches modalSave it slides UP to above the qty row.
  // popupHeight is needed for the above-qty math (top = qty.y - height - 16);
  // it self-corrects via onLayout below.
  const tooltipTopAnim = useRef(new Animated.Value(0)).current;
  const tooltipPrimedRef = useRef(false);
  const [tooltipHeight, setTooltipHeight] = useState(240);

  const measureModalCutout = useCallback(
    (key: 'minus' | 'plus' | 'save', ref: React.RefObject<View | null>) => () => {
      requestAnimationFrame(() => {
        ref.current?.measureInWindow((x, y, w, h) => {
          if (w > 0 && h > 0) {
            setModalCutoutRects((prev) => {
              const next = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
              const cur = prev[key];
              if (cur && cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h) return prev;
              return { ...prev, [key]: next };
            });
          }
        });
      });
    },
    [],
  );

  const [detailTodayQty, setDetailTodayQty] = useState(0);
  // Demo-only: gate the Save button until the user has actually changed the
  // quantity (tapped − or +). The walkthrough's expected flow is
  // modalQtyMinus → modalQtyPlus → modalSave, but Save is on screen the
  // whole time — without this flag, a user could short-circuit by tapping
  // Save first and skip the demo's intended interaction. Resets to false
  // every time the demo modal opens. Real (non-demo) Save is unaffected.
  const [demoQtyChanged, setDemoQtyChanged] = useState(false);
  useEffect(() => {
    if (detailBasket?.id === 'demo-basket-1') setDemoQtyChanged(false);
  }, [detailBasket?.id]);
  const [showFullDesc, setShowFullDesc] = useState(false);
  // Per-day reinit schedule popup (opened from the availability modal).
  const [schedulePopup, setSchedulePopup] = useState<{ name: string; entries: Array<{ day: string; qty: number }> } | null>(null);
  const nextResetDayKeyForPopup = nextResetDayKey();
  // Responsive sizing for the availability detail modal so it fits short
  // screens without the Save/customer-view buttons falling off. The card is
  // already capped at 90% height with an inner ScrollView, but the fixed
  // photo + 20px paddings made small screens cramped — these shrink them
  // proportionally. The qty/cutout halos are measurement-based (onLayout)
  // so they follow automatically; only the Save-button halo wrapper needs
  // its margins kept at `button margin − 3` (done below) to stay flush.
  const modalCompact = SH_MODAL < 720;
  const modalPhotoH = Math.round(Math.max(132, Math.min(200, SH_MODAL * 0.23)));
  const modalCardPad = modalCompact ? 14 : 20;
  const modalCardGap = modalCompact ? 12 : 16;
  const modalSaveMV = modalCompact ? 12 : 16; // Save button vertical margin
  const [descTruncated, setDescTruncated] = useState(false);
  const [detailMaxPerCustomer, setDetailMaxPerCustomer] = useState(1);
  // After the demo Save, override the demo basket's displayed qty so the
  // basket-card pill reflects what the user adjusted in the modal. Without
  // this the post-save "Quantité mise à jour" highlight feels disconnected
  // (the pill would still show the original hard-coded number).
  const [demoBasketQtyOverride, setDemoBasketQtyOverride] = useState<number | null>(null);

  const isSupermarket = profile?.isSupermarket ?? false;

  // Auto-expand a basket when targetBasketId is set via store (set by
  // dashboard when the user taps a basket card there). Single-shot: clear
  // the target BEFORE opening so React's batched re-renders can't re-fire
  // this effect with the same `(targetBasketId, targetBasketTs)` after the
  // user closes the modal. Symptom we fixed: pressing X once did nothing
  // because the effect re-opened the modal in the same tick.
  const lastBasketTsRef = React.useRef(0);
  useEffect(() => {
    if (!(targetBasketId && targetBasketTs > lastBasketTsRef.current && baskets.length > 0)) return;
    const target = baskets.find((b) => String(b.id) === String(targetBasketId));
    if (!target) return;
    lastBasketTsRef.current = targetBasketTs;
    useBusinessStore.getState().setTargetBasket(null);  // clear FIRST
    setDetailBasket(target);
    setDetailTodayQty(target.quantityLeft);
  }, [targetBasketId, targetBasketTs, baskets]);

  // Pause / resume a basket. Persists via PUT /baskets/:id (status =
  // 'paused' | 'available'); the local store flip is just an optimistic
  // reflection while the network round-trip lands. Without backend
  // persistence, the toggle reverted on every reload — useless in
  // production.
  const handleToggle = useCallback((id: string) => {
    const target = baskets.find((b) => b.id === id);
    if (!target) return;

    const willBeActive = !target.isActive;
    const persistRemote = async () => {
      try {
        const { setBasketPaused } = await import('@/src/services/business');
        await setBasketPaused(id, !willBeActive);
        await queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
        await queryClient.invalidateQueries({ queryKey: ['baskets-by-location'] });
        await queryClient.invalidateQueries({ queryKey: ['locations'] });
      } catch (err: any) {
        // Roll back the optimistic local flip so the UI matches reality.
        toggleBasketActive(id);
        alert.showAlert(t('common.error', { defaultValue: 'Erreur' }), getErrorMessage(err));
      }
    };
    toggleBasketActive(id);
    void persistRemote();
  }, [toggleBasketActive, baskets, t, alert, queryClient]);

  const handleDelete = useCallback((id: string) => {
    // List-surface only — the detail-modal version uses an inline overlay
    // (see modalDeleteId) because iOS won't stack a second native <Modal>
    // on top of the detail modal.
    alert.showAlert(
      t('business.baskets.deleteConfirm'),
      t('business.baskets.deleteMessage'),
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            deleteBasketMutation.mutate(id);
            store.deleteBasket(id);
          },
        },
      ]
    );
  }, [deleteBasketMutation, store, t, alert]);

  const handleEdit = useCallback((id: string) => {
    router.push(`/business/create-basket?editId=${id}` as never);
  }, [router]);

  const handleCreate = useCallback(() => {
    // Route through the intermediary picker so the user can choose between an
    // existing org basket or the manual create flow. The picker itself
    // gracefully falls back when the org has zero baskets (it shows the
    // manual-create CTA as the only action), so we don't need a fast-path
    // here to skip it.
    router.push('/business/select-org-basket' as never);
  }, [router]);

  // ── Walkthrough: report the Add-basket button's window-coords rectangle so
  // the business tutorial overlay can draw a pixel-perfect cutout on it.
  const addBasketRef = useRef<View>(null);
  const setAddBasketRect = useWalkthroughStore((s) => s.setAddBasketRect);
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  const walkthroughStep = useWalkthroughStore((s) => s.step);
  const walkthroughCurrentStep = useWalkthroughStore((s) => s.currentStep);
  const demoBasketActive = useWalkthroughStore((s) => s.demoBasketActive);
  // The `demoBasketCard` step that prompts the user to tap the demo card has
  // `advanceOnFlag: 'expand'`. Setting this flag in the card's onPress is
  // what advances the walkthrough into the modal sub-steps (modalQtyMinus →
  // modalQtyPlus → modalSave). Without it the demo dead-ends at the modal.
  const setExpandedDemoCardFlag = useWalkthroughStore((s) => s.setExpandedDemoCard);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  // Reset my-baskets scroll to top THE MOMENT any demo arms (under the
  // welcome cover, before any halo paints). Tab screens preserve scroll
  // across navigation, so the demoBasketCard halo would otherwise land
  // offset by the user's pre-demo scroll position.
  const myBasketsScrollRef = useRef<ScrollView>(null);
  const demoSequencePending = useWalkthroughStore((s) => s.demoSequencePending);
  useEffect(() => {
    if (!demoSequencePending) return;
    myBasketsScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [demoSequencePending]);

  // Compute the popup's target `top` value (in the padding-corrected space
  // of the Animated.View backdrop) based on the active step and the
  // qty-row's measured rect. The animation slides the popup between two
  // positions:
  //   • modalQtyMinus / modalQtyPlus → top edge 12 px BELOW the qty row,
  //     so the −/+ buttons stay clear. The popup extends downward and
  //     naturally overlays the disabled Save button.
  //   • modalSave → top edge `tooltipHeight + 16` px ABOVE the qty row,
  //     so the popup sits clear of the now-active Save button.
  // The Animated.View backdrop has `padding: 16`, so `top: T` puts the
  // child's top edge at screen y `16 + T`. We return the padded value.
  const tooltipTopTarget = useMemo(() => {
    const ms = walkthroughCurrentStep?.measureKey;
    if (ms !== 'modalQtyMinus' && ms !== 'modalQtyPlus' && ms !== 'modalSave') return null;
    const qty = modalCutoutRects.minus ?? modalCutoutRects.plus;
    if (!qty) return null;
    // Gap tuning per user request: qty steps push the popup further down
    // (more space between qty row and popup, so it sits more clearly over
    // the Save button); save step lifts the popup further up (well clear of
    // the qty row).
    const BELOW_QTY_GAP = 40;
    const ABOVE_QTY_GAP = 80;
    const MARGIN = 24;
    // Backdrop has padding:16, so a child `top: T` renders at screen y 16 + T.
    const aboveT = qty.y - tooltipHeight - (ABOVE_QTY_GAP + 16);
    const belowT = qty.y + qty.h + (BELOW_QTY_GAP - 16);
    // Does the below placement fit fully on-screen?
    const belowFitsOnScreen = (16 + belowT + tooltipHeight) <= (SH_MODAL - MARGIN);
    // modalSave always sits above the qty row; the qty steps prefer below but
    // flip above when there isn't room (small phones) so the tooltip never runs
    // off the bottom of the screen — the bug the user hit on step 12 (modal +).
    let T = (ms === 'modalSave' || !belowFitsOnScreen) ? aboveT : belowT;
    // Final clamp so the whole tooltip stays within [MARGIN, SH_MODAL - MARGIN].
    const minT = MARGIN - 16;
    const maxT = SH_MODAL - tooltipHeight - MARGIN - 16;
    T = Math.max(minT, Math.min(T, maxT));
    return T;
  }, [walkthroughCurrentStep?.measureKey, modalCutoutRects, tooltipHeight, SH_MODAL]);
  useEffect(() => {
    if (tooltipTopTarget == null) {
      tooltipPrimedRef.current = false;
      return;
    }
    if (!tooltipPrimedRef.current) {
      tooltipTopAnim.setValue(tooltipTopTarget);
      tooltipPrimedRef.current = true;
    } else {
      Animated.timing(tooltipTopAnim, {
        toValue: tooltipTopTarget,
        duration: 280,
        useNativeDriver: false,
      }).start();
    }
  }, [tooltipTopTarget, tooltipTopAnim]);
  // During the walkthrough we always let the "add basket" button fire its
  // onPress, even if the viewing member doesn't have create-basket permission.
  // Without this, demo mode hangs on the "press the + button" step because
  // the disabled button swallows the tap and the walkthrough can't advance.
  const inWalkthrough = walkthroughStep !== null;
  const measureAddBasket = useCallback(() => {
    requestAnimationFrame(() => {
      addBasketRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setAddBasketRect({ x, y, w, h });
      });
    });
  }, [setAddBasketRect]);
  // Re-publish the Add Basket rect whenever the walkthrough's step changes.
  // `startWalkthrough()` wipes `measuredRects` to kill cross-run pollution,
  // and the button's `onLayout` only fires on initial mount — so if the
  // user reaches this screen via Settings → Mode démo (where my-baskets is
  // already mounted from a prior business session), the rect would stay
  // null and step 3 would render only the dim mask. Forcing a re-measure
  // on every step change restores the rect cheaply.
  React.useEffect(() => {
    if (walkthroughStep !== null) measureAddBasket();
  }, [walkthroughStep, measureAddBasket]);

  // Refs for demo basket card + its quantity-edit affordance — measured so
  // the walkthrough cutout lands precisely on them.
  const demoBasketCardRef = useRef<View>(null);
  const demoBasketQtyRef = useRef<View>(null);
  const demoBasketCardQtyRef = useRef<View>(null);
  const measureDemoCard = useCallback(() => {
    requestAnimationFrame(() => {
      demoBasketCardRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setMeasuredRect('demoBasketCard', { x, y, w, h });
      });
    });
  }, [setMeasuredRect]);
  // The qty-pill badge on the demo basket card (post-save highlight step).
  // Rounded measurements avoid the 0.5–1 px drift between the SVG cutout
  // and the border View that's been the source of "halo misaligned" reports.
  const measureDemoCardQty = useCallback(() => {
    requestAnimationFrame(() => {
      demoBasketCardQtyRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setMeasuredRect('demoBasketCardQty', {
          x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
        });
      });
    });
  }, [setMeasuredRect]);
  // Re-publish the qty-pill rect whenever the walkthrough step changes.
  // Same defensive pattern as `addBasket` — handles the case where the
  // badge laid out before the walkthrough reached the basketCardQty step.
  React.useEffect(() => {
    if (walkthroughStep !== null) measureDemoCardQty();
  }, [walkthroughStep, measureDemoCardQty, demoBasketQtyOverride]);
  // Close the demo availability sheet once the walkthrough moves past the
  // basket sub-tour (otherwise the React Native Modal floats above the
  // orders screen the user has just been navigated to). Now also keep the
  // modal open during the new in-modal sub-steps (modalQtyMinus / Plus /
  // Save) so the user can interact with the form for the whole sequence.
  useEffect(() => {
    if (detailBasket?.id !== 'demo-basket-1') return;
    const k = walkthroughCurrentStep?.measureKey;
    const onBasketStep =
      k === 'demoBasketCard' || k === 'demoBasketQty' ||
      k === 'modalQtyMinus' || k === 'modalQtyPlus' || k === 'modalSave';
    if (!onBasketStep) setDetailBasket(null);
  }, [walkthroughCurrentStep?.measureKey, detailBasket?.id]);

  const measureDemoQty = useCallback(() => {
    requestAnimationFrame(() => {
      demoBasketQtyRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) setMeasuredRect('demoBasketQty', { x, y, w, h });
      });
    });
  }, [setMeasuredRect]);

  // Fake basket injected at the top of the list during the walkthrough so
  // the user sees a created basket without touching the backend.
  const demoBasket = useMemo(() => ({
    id: 'demo-basket-1',
    merchantId: '',
    merchantName: '',
    name: t('walkthrough.biz.demoBasketName', { defaultValue: 'Panier Surprise (démo)' }),
    category: 'restaurant',
    originalPrice: 12,
    discountedPrice: 5,
    discountPercentage: 58,
    pickupWindow: {
      start: pickupStart === '--:--' ? '18:00' : pickupStart,
      end: pickupEnd === '--:--' ? '19:00' : pickupEnd,
    },
    quantityLeft: demoBasketQtyOverride ?? 5,
    quantityTotal: 5,
    nextReinit: 5,
    perDayReinit: false,
    reinitSchedule: [],
    distance: 0,
    address: '',
    latitude: 0,
    longitude: 0,
    exampleItems: [],
    // Use the shared demo "surprise basket" photo (meal-img2.jpeg) so the
    // injected demo card looks like a real basket instead of the empty
    // placeholder icon.
    imageUrl: DEMO_BASKET_PHOTOS[0] as string | undefined,
    isActive: true,
    isPaused: false,
    hasPickupOverride: false,
    description: t('walkthrough.biz.demoBasketDesc', { defaultValue: 'Démonstration — modifications sans effet sur vos paniers réels.' }),
    maxPerCustomer: 5,
    updatedAt: new Date().toISOString(),
    locationName: undefined as string | undefined,
  }), [t, pickupStart, pickupEnd, demoBasketQtyOverride]);

  // Show the demo basket only AFTER the create-basket flow finishes. While
  // the user is still on the `addBasket` step (about to tap Add Basket and
  // walk through the form), the card hasn't logically been "created" yet —
  // surfacing it on the list early gives away the demo and lets the user
  // tap it before they're meant to.
  const showDemoBasketInList = demoBasketActive
    && walkthroughCurrentStep?.measureKey !== 'addBasket';
  const displayedBaskets = showDemoBasketInList
    ? [demoBasket, ...baskets.filter((b) => b.id !== demoBasket.id)]
    : baskets;

  const handleSupermarketQuantity = useCallback((id: string) => {
    const basket = baskets.find((b) => b.id === id);
    if (basket) {
      setTempQuantity(basket.quantityLeft);
      setQuantityModalBasket(id);
    }
  }, [baskets]);

  const handleSaveQuantity = useCallback(() => {
    if (quantityModalBasket) {
      updateBasket(quantityModalBasket, { quantityLeft: tempQuantity });
      setQuantityModalBasket(null);
    }
  }, [quantityModalBasket, tempQuantity, updateBasket]);

  // The handleChangePhoto callback used to live here for the camera button
  // on the availability sheet. Photo editing now lives only in the
  // edit-basket form, so the sole call site is gone and the helper plus
  // its ImagePicker / pickAndCrop deps were dead code — removed.

  // Bypass the loader during a walkthrough run — otherwise step 3 (Add
  // Basket halo) lands while my-baskets is still in its initial query and
  // the button isn't mounted, so its onLayout never publishes `addBasket`
  // and the overlay paints only the dim mask. With this bypass the page
  // renders immediately (empty list, plus the injected demo basket); the
  // button mounts, publishes its rect, and the halo lands on time.
  if (basketsQuery.isLoading && !basketsQuery.data && !inWalkthrough) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      {/* Warm the icons8 PNG cache (edit / pause / play) the moment this screen
          mounts. Without this, those three icons inside the 3-dots action menu
          take a visible second to appear when the menu opens, because their
          <Image>s are decoding for the first time in-place — meanwhile delete
          (an inline SVG) shows instantly. The preloader is offscreen 1×1 and
          has no visual / layout impact. */}
      <Icon8Preloader />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.md }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.baskets.title')}
        </Text>
        <TouchableOpacity
          ref={addBasketRef as any}
          onLayout={measureAddBasket}
          onPress={handleCreate}
          disabled={(!canCreateDeleteBaskets && !inWalkthrough) || hasNoLocation}
          style={[styles.addButton, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: 16, paddingVertical: 10, opacity: hasNoLocation ? 0.4 : ((canCreateDeleteBaskets || inWalkthrough) ? 1 : 0.4) }]}
          activeOpacity={0.8}
        >
          <Plus size={18} color="#fff" />
          <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 6 }]}>
            {t('business.baskets.addBasket')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView ref={myBasketsScrollRef} style={styles.content} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Location pickup hours summary — shows what time window the baskets
            for this location inherit by default. Hidden in "all locations"
            admin mode (selectedLocationId is null) because there's no single
            location whose hours to display. */}
        {selectedLocationId && profileQuery.data?.pickup_start_time && profileQuery.data?.pickup_end_time && (
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: isLocationClosedToday ? theme.colors.error + '12' : theme.colors.primary + '10',
            borderRadius: theme.radii.r12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginTop: theme.spacing.sm,
          }}>
            <Clock size={14} color={isLocationClosedToday ? theme.colors.error : theme.colors.primary} />
            <Text style={{ color: isLocationClosedToday ? theme.colors.error : theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>
              {t('business.baskets.locationHoursLabel', { defaultValue: 'Horaires du commerce' })} :
            </Text>
            <Text style={{ color: isLocationClosedToday ? theme.colors.error : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }}>
              {isLocationClosedToday
                ? t('basket.closedToday', { defaultValue: 'Fermé aujourd\'hui' })
                : `${pickupStart} - ${pickupEnd}`}
            </Text>
          </View>
        )}

        {hasNoLocation ? (
          <View style={{ marginTop: 40 }}>
            <NoLocationCTA />
          </View>
        ) : displayedBaskets.length === 0 ? (
          <View style={[styles.emptyState, { marginTop: 80 }]}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: 40, width: 80, height: 80 }]}>
              <ShoppingBag size={36} color={theme.colors.primary} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: theme.spacing.xl, textAlign: 'center' as const }]}>
              {t('business.baskets.noBaskets')}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.sm, textAlign: 'center' as const }]}>
              {t('business.baskets.createFirst')}
            </Text>
          </View>
        ) : (
          displayedBaskets.map((basket) => {
            const isDemo = basket.id === 'demo-basket-1';
            const isPaused = !isDemo && (basket as any).isPaused === true;
            const isSoldOut = !isDemo && basket.quantityLeft === 0;
            // Demo basket must NEVER show expired / sold-out / inactive —
            // the user's actual pickup window may already be past when the
            // demo runs, but the demo is conceptually "always live".
            // When the LOCATION is closed for the entire business day, force
            // every basket card into the expired state — matches what the
            // customer side now shows, and removes any "sold-out vs closed"
            // ambiguity for the merchant.
            // selectedLocationId is set when the user is viewing a SINGLE
            // location; the baskets displayed all belong to it. In that mode
            // the location's "closed today" verdict applies blanket-wide. In
            // "all locations" admin mode we can't apply it without per-basket
            // location lookup, so we only fall through to the per-basket
            // pickup-window check.
            const blanketClosed = !!(selectedLocationId && isLocationClosedToday);
            // isExpired is independent of isSoldOut — a sold-out basket
            // whose pickup time has also passed should display as
            // "Expiré" (more actionable info than "Épuisé" — the time
            // window was missed, the stock count is a side-effect). The
            // status pill below renders Expiré when isExpired is true,
            // and the stock badge over the image is hidden in that case,
            // so the two never conflict. Still gated on !isPaused because
            // paused baskets get their own "En pause" treatment.
            const isExpired = !isDemo && (
              blanketClosed
              || (!isPaused && isPickupExpiredInTz(basket.pickupWindow?.end))
            );
            const isUnavailable = !isDemo && (isSoldOut || isExpired || isPaused || !basket.isActive);
            return (
              <View
                key={basket.id}
                ref={isDemo ? (demoBasketCardRef as any) : undefined}
                onLayout={isDemo ? measureDemoCard : undefined}
                style={[
                  styles.basketCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    marginTop: theme.spacing.md,
                    ...theme.shadows.shadowSm,
                    // NOTE: the unavailable "fade" is applied to the inner
                    // content (image + text) individually — NOT here — so the
                    // quantity / Épuisé / Expiré badges stay at full opacity on
                    // top instead of being dimmed with the rest of the card.
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    // During the walkthrough, only the demo basket on the
                    // step that explicitly prompts a tap (demoBasketCard
                    // with requireTap=true) may open the modal. Tapping
                    // the *same* demo card during its informational pass
                    // is silently no-op'd — the card is haloed, so a hint
                    // toast there would be misleading. Other taps (wrong
                    // basket or wrong step) trigger the hint as before.
                    if (inWalkthrough) {
                      const k = walkthroughCurrentStep?.measureKey;
                      const onDemoCardStep = k === 'demoBasketCard';
                      const isDemoCardTapStep = onDemoCardStep && !!walkthroughCurrentStep?.requireTap;
                      if (basket.id === 'demo-basket-1' && onDemoCardStep) {
                        if (!isDemoCardTapStep) return; // informational pass — silent
                        // fall through to open the modal
                      } else {
                        useWalkthroughStore.getState().notifyTapHint();
                        return;
                      }
                    }
                    setDetailBasket(basket);
                    setDetailTodayQty(basket.quantityLeft);
                    setShowFullDesc(false);
                    setDetailMaxPerCustomer((basket as any).maxPerCustomer ?? 5);
                    // Advance the walkthrough into the modal sub-steps the
                    // moment the demo card is tapped. The auto-close effect
                    // keeps the modal open for modalQtyMinus/Plus/Save, so
                    // there's no flash-close race.
                    if (basket.id === 'demo-basket-1') setExpandedDemoCardFlag(true);
                  }}
                >
                  <View style={styles.cardRow}>
                    {/* Image with quantity badge overlay */}
                    <View style={{ position: 'relative' }}>
                      {basket.imageUrl ? (
                        <Image source={{ uri: basket.imageUrl }} style={[styles.basketImage, { borderRadius: theme.radii.r12 }, isUnavailable && { opacity: 0.65 }]} />
                      ) : (
                        <View style={[styles.basketImage, { borderRadius: theme.radii.r12, backgroundColor: theme.colors.primary + '10', justifyContent: 'center', alignItems: 'center' }, isUnavailable && { opacity: 0.65 }]}>
                          <ShoppingBag size={28} color={theme.colors.primary} />
                        </View>
                      )}
                      {/* Stock badge over the image — quantity number, or
                          "Épuisé" when sold out. NEVER "Expiré" here:
                          expiration is time-based (not stock-based) and gets
                          its own pill at the top-right of the CARD below.
                          Hidden entirely when the basket is expired — the
                          stock count is meaningless at that point and the
                          Expiré pill already conveys the status. */}
                      {!isExpired && (
                        <View
                          ref={isDemo ? (demoBasketCardQtyRef as any) : undefined}
                          onLayout={isDemo ? measureDemoCardQty : undefined}
                          collapsable={false}
                          style={{
                          position: 'absolute',
                          top: -4,
                          right: -6,
                          backgroundColor: isSoldOut ? theme.colors.error : theme.colors.primary,
                          borderRadius: theme.radii.pill,
                          minWidth: isSoldOut ? 44 : 24,
                          height: 24,
                          justifyContent: 'center',
                          alignItems: 'center',
                          paddingHorizontal: isSoldOut ? 8 : 6,
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.25,
                          shadowRadius: 3,
                          elevation: 4,
                          zIndex: 10,
                        }}>
                          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                            {isSoldOut ? t('basket.soldOut', { defaultValue: 'Épuisé' }) : basket.quantityLeft >= 10 ? '9+' : basket.quantityLeft}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.basketInfo}>
                      <View style={styles.basketNameRow}>
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const, flex: 1 }, isUnavailable && { opacity: 0.65 }]} numberOfLines={1}>
                          {basket.name}
                        </Text>
                        {/* Status pill at the top-right of the card.
                            Priority: Pausé > Expiré (paused baskets aren't
                            "expired" in a meaningful sense — the merchant
                            intentionally took them offline). Both share the
                            same slot so the merchant always sees the most
                            actionable label without competing badges. */}
                        {isPaused ? (
                          <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: theme.colors.muted,
                            borderRadius: theme.radii.pill,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            gap: 4,
                            marginLeft: 8,
                          }}>
                            <Pause size={11} color="#fff" />
                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                              {t('business.baskets.pausedBadge', { defaultValue: 'En pause' })}
                            </Text>
                          </View>
                        ) : isExpired ? (
                          <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: '#f59e0b',
                            borderRadius: theme.radii.pill,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            gap: 4,
                            marginLeft: 8,
                          }}>
                            <TimerOff size={11} color="#fff" />
                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                              {t('orders.status.expired', { defaultValue: 'Expiré' })}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {!selectedLocationId && (basket as any).locationName && (
                        <View style={[{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }, isUnavailable && { opacity: 0.65 }]}>
                          <MapPin size={10} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.muted, fontSize: 11, marginLeft: 4 }} numberOfLines={1}>
                            {formatLocationName(contextQuery.data?.organization_name, (basket as any).locationName)}
                          </Text>
                        </View>
                      )}
                      <View style={[styles.priceRow, { marginTop: 6 }, isUnavailable && { opacity: 0.65 }]}>
                        <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' as const }]}>
                          {basket.discountedPrice} TND
                        </Text>
                        <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through', marginLeft: 8 }]}>
                          {basket.originalPrice} TND
                        </Text>
                      </View>
                      {/* Meta row: daily reinit qty + custom pickup time (if different from location default) */}
                      <View style={[styles.metaRow, { marginTop: 6 }, isUnavailable && { opacity: 0.65 }]}>
                        <View
                          ref={isDemo ? (demoBasketQtyRef as any) : undefined}
                          onLayout={isDemo ? measureDemoQty : undefined}
                          style={[styles.metaChip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 }]}
                        >
                          <ShoppingBag size={10} color={theme.colors.textSecondary} />
                          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }]}>
                            {t('business.baskets.dailyReinit', { defaultValue: 'Réinit.' })} {(basket as any).nextReinit ?? basket.quantityTotal}
                          </Text>
                        </View>
                        {/* Pickup time chip — yellow when basket has its own
                            custom window, neutral when it's inheriting the
                            location's hours. Driven by hasPickupOverride (the
                            canonical inheritance flag) rather than a string
                            compare against the SELECTED location, so it stays
                            correct in "all locations" mode too. */}
                        {(basket as any).hasPickupOverride ? (
                          <View style={[styles.metaChip, { backgroundColor: '#e3ff5c18', borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 }]}>
                            <Clock size={10} color="#8a7d00" />
                            <Text
                              numberOfLines={1}
                              style={[{ color: '#8a7d00', ...theme.typography.caption, marginLeft: 3, fontWeight: '600' }]}
                            >
                              {/* Non-breaking hyphen so "15:10-16:00" can never
                                  split onto two lines when the chip row is tight. */}
                              {`${basket.pickupWindow.start}‑${basket.pickupWindow.end}`}
                            </Text>
                          </View>
                        ) : (
                          <View style={[styles.metaChip, { backgroundColor: theme.colors.primary + '12', borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 }]}>
                            <Clock size={10} color={theme.colors.primary} />
                            <Text
                              numberOfLines={1}
                              style={[{ color: theme.colors.primary, ...theme.typography.caption, marginLeft: 3, fontWeight: '600', flexShrink: 1 }]}
                            >
                              {t('business.baskets.usingLocationHours', { defaultValue: 'Horaire commerce' })}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Detail Modal — custom 180 ms fade via modalBackdropAnim. The card
          itself is also an Animated.View driven by the same value: relying
          on parent-opacity composition alone left the card's rounded-rect
          silhouette visible for ~1 frame on Android (background colour +
          borderRadius + overflow:hidden re-composite a tick after the
          backdrop drops). Animating the card's own opacity in lockstep
          hides the form entirely with no border flash. Shadow is dropped
          synchronously the moment closing starts so the native elevation
          halo doesn't outlive the fade. */}
      <Modal visible={modalRender} transparent animationType="none" onRequestClose={() => setDetailBasket(null)}>
        <Animated.View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 16,
          opacity: modalBackdropAnim,
          ...(Platform.OS === 'android' && { elevation: 0 }),
        }}>
          <Animated.View style={{
            backgroundColor: theme.colors.bg,
            borderRadius: 24,
            maxHeight: '90%',
            width: '100%',
            maxWidth: 420,
            overflow: 'hidden',
            opacity: modalBackdropAnim,
            ...(closing ? null : theme.shadows.shadowLg),
          }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 0 }}>
              {/* Pause pill + close button header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, marginBottom: 12 }}>
                <View>
                  <TouchableOpacity
                    disabled={!canEditQuantities}
                    onPress={() => handleToggle(detailBasket!.id)}
                    style={{
                      // `alignSelf: 'flex-start'` so the pill hugs its
                      // content width ("Actif" + dot + padding) instead
                      // of stretching to match the parent column's width
                      // — which was being pushed wide by the long
                      // "Dernier changement" timestamp line below it.
                      alignSelf: 'flex-start',
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: detailBasket?.isActive ? '#114b3c18' : '#114b3c10',
                      borderRadius: theme.radii.pill,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      gap: 6,
                    }}
                  >
                    <View style={{
                      width: 8, height: 8, borderRadius: 4,
                      backgroundColor: detailBasket?.isActive ? '#114b3c' : '#999',
                    }} />
                    <Text style={{
                      color: '#114b3c',
                      ...theme.typography.caption,
                      fontWeight: '600',
                    }}>
                      {detailBasket?.isActive ? t('business.baskets.active') : t('business.baskets.inactive')}
                    </Text>
                  </TouchableOpacity>
                  {detailBasket?.updatedAt ? (
                    <Text style={{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 4, paddingLeft: 4 }}>
                      {t('business.baskets.lastChanged', { defaultValue: 'Dernier changement' })} : {new Date(detailBasket.updatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(detailBasket.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  {(canEditBasketInfo || canCreateDeleteBaskets) && (
                    <TouchableOpacity
                      ref={modalDotsRef as any}
                      onPress={openModalMenu}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MoreVertical size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => setDetailBasket(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <X size={22} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Photo section */}
              <View style={{ height: modalPhotoH, backgroundColor: theme.colors.divider, position: 'relative' }}>
                {detailBasket?.imageUrl ? (
                  <Image source={{ uri: detailBasket.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.primary + '08' }}>
                    <ShoppingBag size={48} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, marginTop: 8 }}>
                      {t('business.baskets.addPhoto', { defaultValue: 'Add Photo' })}
                    </Text>
                  </View>
                )}
                {/* Camera button removed — photo editing now lives only in
                    the edit-basket form so the availability sheet has a
                    single, focused job (today's quantity + per-day
                    schedule) and the merchant can't accidentally change
                    the photo while just adjusting stock. */}
              </View>

              {/* Info card overlapping photo. Shadow gated on !closing for
                  the same reason as the outer card: Android elevation
                  shadows aren't covered by parent opacity. */}
              <View style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                marginTop: -20,
                marginHorizontal: 16,
                padding: modalCardPad,
                ...(closing ? null : theme.shadows.shadowSm),
              }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }}>
                  {detailBasket?.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 8 }}>
                  <Text style={{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' }}>
                    {detailBasket?.discountedPrice} TND
                  </Text>
                  <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textDecorationLine: 'line-through', marginLeft: 10 }}>
                    {detailBasket?.originalPrice} TND
                  </Text>
                </View>
                {detailBasket?.description ? (
                  <TouchableOpacity onPress={() => setShowFullDesc(!showFullDesc)} style={{ marginTop: 8 }}>
                    <Text
                      style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20 }}
                      numberOfLines={showFullDesc ? undefined : 2}
                      onTextLayout={(e) => { if (!showFullDesc && e.nativeEvent.lines.length > 2) setDescTruncated(true); }}
                    >
                      {detailBasket.description}
                    </Text>
                    {!showFullDesc && descTruncated && (
                      <Text style={{ color: theme.colors.primary, ...theme.typography.caption, marginTop: 2 }}>
                        {t('common.seeMore', { defaultValue: '...voir plus' })}
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Availability Controls — only shown to members with edit permissions */}
              {canEditBaskets && (
              <View style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                marginHorizontal: 16,
                marginTop: modalCardGap,
                padding: modalCardPad,
                ...(closing ? null : theme.shadows.shadowSm),
              }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: modalCardGap }}>
                  {t('business.availability.title', { defaultValue: 'Availability' })}
                </Text>

                {/* Today's Quantity — in demo mode, the active sub-step's
                    button gets a yellow-green halo. The other buttons stay
                    plain. Halos are computed from the walkthrough step's
                    measureKey ('modalQtyMinus' / 'modalQtyPlus'). */}
                {(() => {
                  const ms = walkthroughCurrentStep?.measureKey;
                  const haloOn = (key: string) => ms === key ? { borderWidth: 3, borderColor: '#e3ff5c' as const } : null;
                  return (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: modalCardGap, opacity: canEditQuantities ? 1 : 0.4 }}>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body }}>
                        {t('business.baskets.todayQty')}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity
                          ref={qtyMinusBtnRef as any}
                          onLayout={measureModalCutout('minus', qtyMinusBtnRef)}
                          disabled={!canEditQuantities}
                          onPress={() => {
                            setDetailTodayQty(Math.max(0, detailTodayQty - 1));
                            if (detailBasket?.id === 'demo-basket-1') setDemoQtyChanged(true);
                            if (ms === 'modalQtyMinus') {
                              useWalkthroughStore.getState().nextStep(999);
                            }
                          }}
                          style={{ backgroundColor: theme.colors.bg, borderRadius: 8, width: 36, height: 36, justifyContent: 'center', alignItems: 'center', ...haloOn('modalQtyMinus') }}
                        >
                          <Minus size={16} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginHorizontal: 16, minWidth: 24, textAlign: 'center' }}>
                          {detailTodayQty}
                        </Text>
                        <TouchableOpacity
                          ref={qtyPlusBtnRef as any}
                          onLayout={measureModalCutout('plus', qtyPlusBtnRef)}
                          disabled={!canEditQuantities}
                          onPress={() => {
                            setDetailTodayQty(detailTodayQty + 1);
                            if (detailBasket?.id === 'demo-basket-1') setDemoQtyChanged(true);
                            if (ms === 'modalQtyPlus') {
                              useWalkthroughStore.getState().nextStep(999);
                            }
                          }}
                          style={{ backgroundColor: theme.colors.bg, borderRadius: 8, width: 36, height: 36, justifyContent: 'center', alignItems: 'center', ...haloOn('modalQtyPlus') }}
                        >
                          <Plus size={16} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })()}

                {/* Tomorrow's quantity — INFO row, not editable. The
                    user wanted a clear visual contrast with the Today
                    row above (which carries −/+ controls) so it reads
                    as "this is what will happen next" rather than
                    "tap to change". Same Poppins family + 600 weight
                    so it still looks intentional, but smaller font
                    (bodySm vs the h3 number above) and a muted color
                    (textSecondary). Per-day schedules tuck a small ⓘ
                    next to the number — tap opens the schedule popup. */}
                {detailBasket && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    {/* Single label for both flat and per-day reinit —
                        the ⓘ icon to the right already tells the user
                        when there's a custom schedule, so the label
                        doesn't need to repeat that and can stay short
                        + grammatical ("Quantité de demain"). */}
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, flex: 1, paddingRight: 12 }}>
                      {t('business.baskets.tomorrowReset', { defaultValue: 'Quantité de demain' })}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                        {(detailBasket as any).nextReinit}
                      </Text>
                      {(detailBasket as any).perDayReinit && (
                        <TouchableOpacity
                          onPress={() => setSchedulePopup({ name: detailBasket.name, entries: (detailBasket as any).reinitSchedule ?? [] })}
                          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                          style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.primary + '14', justifyContent: 'center', alignItems: 'center' }}
                          accessibilityLabel={t('business.baskets.perDayInfo', { defaultValue: 'Voir le détail par jour' })}
                          accessibilityRole="button"
                        >
                          <Info size={12} color={theme.colors.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
              </View>
              )}

              {/* Save Changes — only for members with edit permissions.
                  In demo mode the halo only appears when the walkthrough's
                  active sub-step is `modalSave` (i.e. AFTER the user has
                  tapped − and +). The halo border is sized so its 3px
                  inset border lands flush with the button's outer edge. */}
              {canEditBaskets && (
              <View
                ref={qtySaveBtnRef as any}
                onLayout={measureModalCutout('save', qtySaveBtnRef)}
                style={walkthroughCurrentStep?.measureKey === 'modalSave' ? {
                  // Kept at `button margin − 3` so the 3px border lands flush
                  // around the button on every screen size (see modalSaveMV).
                  marginHorizontal: 13,
                  marginTop: modalSaveMV - 3,
                  marginBottom: modalSaveMV - 3,
                  borderRadius: theme.radii.r16 + 3,
                  borderWidth: 3,
                  borderColor: '#e3ff5c',
                } : null}
              >
              <TouchableOpacity
                disabled={detailBasket?.id === 'demo-basket-1' && !demoQtyChanged}
                onPress={() => {
                  if (detailBasket) {
                    // Validate price: original must be at least 10 TND
                    if (detailBasket.originalPrice > 0 && detailBasket.originalPrice < 10) {
                      alert.showAlert(t('common.error'), t('business.createBasket.minOriginalPrice', { defaultValue: 'Le prix original doit être d\'au moins 10 TND.' }));
                      return;
                    }
                    // Validate price: selling price must be at most 50% of original
                    if (detailBasket.originalPrice > 0 && detailBasket.discountedPrice > detailBasket.originalPrice * 0.5) {
                      alert.showAlert(t('common.error'), t('business.createBasket.priceError'));
                      return;
                    }
                    // Pickup times are not edited in this modal anymore — the
                    // full edit-basket form owns that. Save only the fields
                    // this modal actually exposes.
                    const saveData: Record<string, any> = {
                      name: detailBasket.name,
                      original_price: detailBasket.originalPrice,
                      selling_price: detailBasket.discountedPrice,
                      quantity: detailTodayQty,
                    };
                    // Demo basket never hits the backend — there's no row
                    // server-side. Mirror the user's chosen qty onto the
                    // demo basket so the post-save "Quantité mise à jour"
                    // highlight on the basket card shows the right number,
                    // close the sheet, and advance the walkthrough in the
                    // same tick. The custom 180 ms modal fade-out reveals
                    // the qty-pill halo behind it as it fades — no dead
                    // time, no perceptible "demo paused" gap.
                    if (detailBasket.id === 'demo-basket-1') {
                      setDemoBasketQtyOverride(detailTodayQty);
                      setDetailBasket(null);
                      useWalkthroughStore.getState().nextStep(999);
                      return;
                    }
                    basketUpdateMutation.mutate(
                      {
                        id: detailBasket.id,
                        data: saveData,
                      },
                      {
                        onSuccess: () => {
                          setDetailBasket(null);
                        },
                      }
                    );
                  }
                }}
                style={{
                  backgroundColor: theme.colors.primary,
                  borderRadius: theme.radii.r16,
                  padding: 16,
                  marginHorizontal: 16,
                  marginTop: modalSaveMV,
                  marginBottom: modalSaveMV,
                  alignItems: 'center',
                  opacity: (detailBasket?.id === 'demo-basket-1' && !demoQtyChanged) ? 0.4 : 1,
                }}
              >
                <Text style={{ color: '#fff', ...theme.typography.button }}>
                  {t('business.baskets.saveChanges')}
                </Text>
              </TouchableOpacity>
              </View>
              )}

              {/* See from customer view button */}
              <TouchableOpacity
                onPress={() => {
                  const basketId = detailBasket?.id;
                  setDetailBasket(null);
                  if (basketId) router.push({ pathname: '/basket/[id]', params: { id: String(basketId), businessPreview: 'true' } } as never);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  marginHorizontal: 20,
                  marginBottom: modalSaveMV,
                  paddingVertical: 12,
                  borderRadius: theme.radii.r12,
                  borderWidth: 1,
                  borderColor: theme.colors.divider,
                  backgroundColor: theme.colors.surface,
                }}
              >
                <ShoppingBag size={16} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>
                  {t('business.baskets.seeCustomerView', { defaultValue: 'Voir comme client' })}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>

          {/* Per-day reinit schedule — IN-MODAL overlay (a second <Modal>
              stacks unreliably on iOS). Cleaner redesign:
                - No more rounded-card highlight on the next-reset day —
                  the user said it looked like a tappable button. Now
                  the rows are flat (no per-row background), separated
                  by a thin hairline so the seven entries read as a
                  list. The next-reset day is signalled by a brand-
                  green dot to the left of the day name + the day name
                  itself in primary color + "Demain" tag at the right —
                  same information, no fake-button visual. */}
          {schedulePopup && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => setSchedulePopup(null)} />
              <View style={{ width: '100%', maxWidth: 360, maxHeight: '80%', backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, ...theme.shadows.shadowLg }}>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                      {t('business.baskets.perDayScheduleTitle', { defaultValue: 'Quantité par jour' })}
                    </Text>
                    {schedulePopup.name ? (
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }} numberOfLines={1}>
                        {schedulePopup.name}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    onPress={() => setSchedulePopup(null)}
                    hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                    style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }}
                  >
                    <X size={16} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 6, marginBottom: 12 }}>
                  {t('business.baskets.perDayScheduleHint', { defaultValue: 'Quantité restaurée chaque jour à 03:30.' })}
                </Text>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {(schedulePopup.entries ?? []).map((e, idx, arr) => {
                    const isNext = e.day === nextResetDayKeyForPopup;
                    const isLast = idx === arr.length - 1;
                    return (
                      <View
                        key={e.day}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 12,
                          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
                          borderBottomColor: theme.colors.divider,
                        }}
                      >
                        {/* Day name — fixed width column so the qty
                            numbers stay right-aligned on the same x. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 }}>
                          <View
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: isNext ? theme.colors.primary : 'transparent',
                            }}
                          />
                          <Text
                            style={{
                              color: isNext ? theme.colors.primary : theme.colors.textPrimary,
                              ...theme.typography.body,
                              fontWeight: isNext ? '700' : '500',
                              fontFamily: isNext ? 'Poppins_700Bold' : 'Poppins_500Medium',
                            }}
                          >
                            {t(`business.dashboard.days.${DAY_KEY_TO_LABEL[e.day]}`, { defaultValue: DAY_KEY_TO_LABEL[e.day] })}
                          </Text>
                          {isNext ? (
                            <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600', marginLeft: 4 }}>
                              · {t('business.baskets.tomorrowTag', { defaultValue: 'demain' })}
                            </Text>
                          ) : null}
                        </View>
                        <Text
                          style={{
                            color: isNext ? theme.colors.primary : theme.colors.textPrimary,
                            ...theme.typography.body,
                            fontWeight: '700',
                            fontFamily: 'Poppins_700Bold',
                          }}
                        >
                          {e.qty}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          )}

          {/* In-modal walkthrough dim — covers the whole window during the
              modalQty/modalSave sub-steps, with a cutout for the active
              control so it stays crisp and tappable. The instruction tooltip
              is rendered AFTER this layer so it naturally sits on top — no
              cutout needed for it. `pointerEvents="none"` lets taps reach
              the active control through the cutout. */}
          {(() => {
            const ms = walkthroughCurrentStep?.measureKey;
            const active =
              ms === 'modalQtyMinus' ? modalCutoutRects.minus :
              ms === 'modalQtyPlus' ? modalCutoutRects.plus :
              ms === 'modalSave' ? modalCutoutRects.save : null;
            if (!active) return null;
            // Active control corner radius: −/+ buttons are 8, Save wrapper is r16+3.
            const activeRadius =
              ms === 'modalSave' ? (theme.radii.r16 + 3) : 8;
            const appendHole = (
              parts: string[],
              x: number, y: number, w: number, h: number, r: number,
            ) => {
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
            const parts: string[] = [`M0 0 H${SW_MODAL} V${SH_MODAL} H0 Z`];
            appendHole(parts, active.x, active.y, active.w, active.h, activeRadius);
            // Four absorber frames around the active control's rect — block
            // taps on the modal close X, basket-photo camera, "Voir comme
            // client", and the pause/active pill so the user can't quit the
            // demo mid-sub-step. The active rect itself has no absorber so
            // the user can still tap the highlighted − / + / Save button.
            const cX = Math.max(0, active.x);
            const cY = Math.max(0, active.y);
            const cW = Math.max(0, Math.min(active.w, SW_MODAL - cX));
            const cH = Math.max(0, Math.min(active.h, SH_MODAL - cY));
            const absorb = {
              onStartShouldSetResponder: () => true,
              onResponderRelease: () => { /* absorb silently — the hint
                  toast only fires when a blocked button is actually
                  tapped, not on empty-space taps inside the modal. */ },
            } as const;
            return (
              <View style={StyleSheet.absoluteFillObject}>
                <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                  <Svg width={SW_MODAL} height={SH_MODAL} style={StyleSheet.absoluteFillObject} pointerEvents="none">
                    <Path d={parts.join(' ')} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
                  </Svg>
                </View>
                <View {...absorb} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: cY }} />
                <View {...absorb} style={{ position: 'absolute', left: 0, right: 0, top: cY + cH, bottom: 0 }} />
                <View {...absorb} style={{ position: 'absolute', top: cY, height: cH, left: 0, width: cX }} />
                <View {...absorb} style={{ position: 'absolute', top: cY, height: cH, left: cX + cW, right: 0 }} />
                <DemoTapHintToast />
              </View>
            );
          })()}

          {/* Floating instruction tooltip — two anchor positions that animate
              between each other on step change:
                • modalQtyMinus / modalQtyPlus → sits OVER the (disabled) Save
                  button at the bottom of the sheet, since the user can't act
                  on Save yet — visually saves space and reinforces the qty
                  controls as the active surface.
                • modalSave → slides up to above the qty row, clearing the
                  Save button so the user can see and tap it.
              Rendered OUTSIDE the ScrollView (here at the modal backdrop
              level) so scrolling the form doesn't move it. Rendered AFTER
              the dim layer so it sits opaque on top without a cutout. */}
          {(() => {
            const ms = walkthroughCurrentStep?.measureKey;
            const titleKey =
              ms === 'modalQtyMinus' ? 'walkthrough.biz.modalMinus.title' :
              ms === 'modalQtyPlus' ? 'walkthrough.biz.modalPlus.title' :
              ms === 'modalSave' ? 'walkthrough.biz.modalSave.title' : null;
            const descKey =
              ms === 'modalQtyMinus' ? 'walkthrough.biz.modalMinus.desc' :
              ms === 'modalQtyPlus' ? 'walkthrough.biz.modalPlus.desc' :
              ms === 'modalSave' ? 'walkthrough.biz.modalSave.desc' : null;
            if (!titleKey || !descKey || !walkthroughCurrentStep || tooltipTopTarget == null) return null;
            return (
              <Animated.View
                pointerEvents="box-none"
                style={{ position: 'absolute', left: 0, right: 0, top: tooltipTopAnim, alignItems: 'center' }}
              >
                <View
                  onLayout={(e) => {
                    const h = Math.round(e.nativeEvent.layout.height);
                    if (h > 0) setTooltipHeight((prev) => (prev === h ? prev : h));
                  }}
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 20,
                    padding: 20,
                    width: '100%',
                    maxWidth: 388,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 8 },
                    shadowOpacity: 0.15,
                    shadowRadius: 20,
                    elevation: 10,
                  }}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_500Medium', marginBottom: 10 }}>
                    {walkthroughCurrentStep.stepIndex + 1}/{walkthroughCurrentStep.totalSteps}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#114b3c12', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                      <Hand size={22} color="#114b3c" />
                    </View>
                    <Text style={{ color: '#114b3c', fontSize: 17, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1 }}>
                      {t(titleKey)}
                    </Text>
                  </View>
                  <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, marginBottom: 10 }}>
                    {t(descKey)}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, backgroundColor: '#114b3c0f', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 }}>
                    <Hand size={14} color="#114b3c" />
                    <Text style={{ color: '#114b3c', fontSize: 12, fontFamily: 'Poppins_600SemiBold', marginLeft: 6, flex: 1 }}>
                      {t('walkthrough.tapToContinue', { defaultValue: 'Appuyez sur le bouton entouré pour continuer.' })}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={skipWalkthrough}>
                    <Text style={{ color: theme.colors.muted, fontSize: 13, fontFamily: 'Poppins_500Medium' }}>
                      {t('walkthrough.exitDemo', { defaultValue: 'Quitter la démo' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            );
          })()}

          {/* Anchored action popover for the MODAL surface (detail-modal
              3-dots). Rendered inline INSIDE this Modal so we don't have
              to nest a second <Modal> (called out as flaky on Android
              elsewhere). The transparent Pressable captures outside-taps
              to dismiss without closing the detail modal itself. */}
          {actionMenu?.surface === 'modal' && (
            <View
              pointerEvents="box-none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            >
              <Pressable
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                onPress={() => setActionMenu(null)}
              />
              <View
                onStartShouldSetResponder={() => true}
                style={{ position: 'absolute', top: actionMenu.top, right: actionMenu.right }}
              >
                <ActionMenuCard>
                  {canEditBasketInfo && (
                    <ActionMenuItem
                      icon={<EditIcon8 size={16} />}
                      label={t('business.baskets.editBasket')}
                      onPress={() => {
                        const id = actionMenu.basketId;
                        setActionMenu(null);
                        setDetailBasket(null);
                        handleEdit(id);
                      }}
                    />
                  )}
                  {(() => {
                    const target = baskets.find((b) => b.id === actionMenu.basketId);
                    const paused = (target as any)?.isPaused === true;
                    return (
                      <>
                        <ActionMenuDivider />
                        <ActionMenuItem
                          icon={paused ? <PlayIcon8 size={16} /> : <PauseIcon8 size={16} />}
                          label={paused
                            ? t('business.baskets.resumeBasket', { defaultValue: 'Reprendre' })
                            : t('business.baskets.pauseBasket', { defaultValue: 'Mettre en pause' })}
                          onPress={() => {
                            const id = actionMenu.basketId;
                            setActionMenu(null);
                            setDetailBasket(null);
                            handleToggle(id);
                          }}
                        />
                      </>
                    );
                  })()}
                  {canCreateDeleteBaskets && <ActionMenuDivider />}
                  {canCreateDeleteBaskets && (
                    <ActionMenuItem
                      destructive
                      icon={<DeleteIcon8 size={16} />}
                      label={t('business.baskets.delete')}
                      onPress={() => {
                        const id = actionMenu.basketId;
                        setActionMenu(null);
                        // Trigger the inline confirm overlay rendered below
                        // (still inside this Modal). Using a nested native
                        // <Modal> via the global alert would never appear on
                        // iOS — see modalDeleteId state declaration above.
                        setModalDeleteId(id);
                      }}
                    />
                  )}
                </ActionMenuCard>
              </View>
            </View>
          )}

          {/* Inline delete-confirmation overlay. Lives inside the detail
              modal's tree so it visually stacks on top of the availability
              sheet — using the global CustomAlert here would launch a second
              native <Modal>, which iOS will not render while another Modal
              is already presented. */}
          {modalDeleteId && (
            <View
              pointerEvents="box-none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 24 }}
            >
              <Pressable
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                onPress={() => setModalDeleteId(null)}
              />
              <View
                onStartShouldSetResponder={() => true}
                style={{
                  width: '100%',
                  maxWidth: 340,
                  backgroundColor: theme.colors.surface,
                  borderRadius: 20,
                  padding: 24,
                  alignItems: 'center',
                  ...theme.shadows.shadowLg,
                }}
              >
                {/* Warning icon — matches CustomAlert's destructive/warning
                    treatment so this inline overlay feels native to the rest
                    of the app's confirmation dialogs. */}
                <View style={{ backgroundColor: '#f5f5f1', width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
                  <AlertTriangle size={26} color="#e8a838" />
                </View>
                <Text style={{ color: '#1a1a1a', fontSize: 17, fontFamily: 'Poppins_700Bold', fontWeight: '700' as const, textAlign: 'center', marginBottom: 8, letterSpacing: -0.2 }}>
                  {t('business.baskets.deleteConfirm')}
                </Text>
                <Text style={{ color: '#6b6b6b', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>
                  {t('business.baskets.deleteMessage')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                  <TouchableOpacity
                    onPress={() => setModalDeleteId(null)}
                    style={{
                      flex: 1,
                      backgroundColor: theme.colors.bg,
                      borderRadius: theme.radii.r12,
                      paddingVertical: 14,
                      alignItems: 'center',
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.button }}>
                      {t('common.cancel', { defaultValue: 'Annuler' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      const id = modalDeleteId;
                      deleteBasketMutation.mutate(id);
                      store.deleteBasket(id);
                      setModalDeleteId(null);
                      setDetailBasket(null);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: theme.colors.error,
                      borderRadius: theme.radii.r12,
                      paddingVertical: 14,
                      alignItems: 'center',
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: '#fff', ...theme.typography.button }}>
                      {t('business.baskets.delete', { defaultValue: 'Supprimer' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </Animated.View>
      </Modal>

      <Modal visible={quantityModalBasket !== null} transparent animationType="fade" onRequestClose={() => setQuantityModalBasket(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setQuantityModalBasket(null)}>
          <View
            style={[styles.quantityModal, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center' as const, marginBottom: theme.spacing.lg }]}>
              {t('business.baskets.quantityAvailable')}
            </Text>
            <View style={styles.quantitySelector}>
              <TouchableOpacity
                onPress={() => setTempQuantity(Math.max(0, tempQuantity - 1))}
                style={[styles.qtyBtn, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48 }]}
              >
                <Minus size={20} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.display, marginHorizontal: theme.spacing.xxl }]}>
                {tempQuantity}
              </Text>
              <TouchableOpacity
                onPress={() => setTempQuantity(tempQuantity + 1)}
                style={[styles.qtyBtn, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48 }]}
              >
                <Plus size={20} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={handleSaveQuantity}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('business.baskets.saveChanges')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Anchored action popover for the LIST surface (card 3-dots).
          Rendered as a root-level <Modal> so it can never be clipped by
          sibling cards in the ScrollView. Outside-tap closes via the
          backdrop TouchableOpacity (standard app pattern). The popover is
          absolute-positioned at the top/right coordinates measured from
          the 3-dots button at open time. */}
      <Modal
        visible={actionMenu?.surface === 'list'}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMenu(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setActionMenu(null)}
          style={{ flex: 1, backgroundColor: 'transparent' }}
        >
          {actionMenu?.surface === 'list' && (
            <View
              onStartShouldSetResponder={() => true}
              style={{ position: 'absolute', top: actionMenu.top, right: actionMenu.right }}
            >
              <ActionMenuCard>
                {canEditBasketInfo && (
                  <ActionMenuItem
                    icon={<EditIcon8 size={16} />}
                    label={t('business.baskets.editBasket')}
                    onPress={() => {
                      const id = actionMenu.basketId;
                      setActionMenu(null);
                      handleEdit(id);
                    }}
                  />
                )}
                {(() => {
                  const target = baskets.find((b) => b.id === actionMenu.basketId);
                  const paused = (target as any)?.isPaused === true;
                  return (
                    <>
                      <ActionMenuDivider />
                      <ActionMenuItem
                        icon={paused ? <PlayIcon8 size={16} /> : <PauseIcon8 size={16} />}
                        label={paused
                          ? t('business.baskets.resumeBasket', { defaultValue: 'Reprendre' })
                          : t('business.baskets.pauseBasket', { defaultValue: 'Mettre en pause' })}
                        onPress={() => {
                          const id = actionMenu.basketId;
                          setActionMenu(null);
                          handleToggle(id);
                        }}
                      />
                    </>
                  );
                })()}
                {canCreateDeleteBaskets && <ActionMenuDivider />}
                {canCreateDeleteBaskets && (
                  <ActionMenuItem
                    destructive
                    icon={<DeleteIcon8 size={16} />}
                    label={t('business.baskets.delete')}
                    onPress={() => {
                      const id = actionMenu.basketId;
                      setActionMenu(null);
                      handleDelete(id);
                    }}
                  />
                )}
              </ActionMenuCard>
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  basketCard: {
    overflow: 'visible',
  },
  cardRow: {
    flexDirection: 'row',
    padding: 14,
  },
  basketImage: {
    width: 80,
    height: 80,
  },
  basketInfo: {
    flex: 1,
    marginLeft: 12,
  },
  basketNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moreButton: {
    padding: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  quantityModal: {
    width: '100%',
    maxWidth: 340,
  },
  quantitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
