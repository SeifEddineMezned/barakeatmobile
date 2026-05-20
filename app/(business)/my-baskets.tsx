import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Modal, Animated, Dimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Plus, Clock, Edit3, Trash2, ShoppingBag, MoreVertical, Minus, Camera, X, MapPin, Hand } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { TimePicker } from '@/src/components/TimePicker';
import { StatusBar } from 'expo-status-bar';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { DemoTapHintToast } from '@/src/components/DemoTapHintToast';
import { fetchMyContext, fetchOrganizationDetails } from '@/src/services/teams';
import { NoLocationCTA } from '@/src/components/NoLocationCTA';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyBaskets, deleteBasket as deleteBasketAPI, fetchMyProfile, updateQuantity, updateBasket as updateBasketAPI, updateBasketWithImage, type BusinessBasketFromAPI } from '@/src/services/business';
import * as ImagePicker from 'expo-image-picker';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { effectiveDailyReinit } from '@/src/utils/dailyReinit';

export default function MyBasketsScreen() {
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
  });
  const isOrgAdmin = (myRole === 'owner' || myRole === 'admin') && !contextQuery.data?.location_id;
  const hasNoLocation = isOrgAdmin
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
    staleTime: 60_000,
    retry: 1,
  });

  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 30_000,
  });

  const currentQty = profileQuery.data?.available_quantity ?? 0;
  const pickupStart = profileQuery.data?.pickup_start_time?.substring(0, 5) ?? '--:--';
  const pickupEnd = profileQuery.data?.pickup_end_time?.substring(0, 5) ?? '--:--';

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
      const result = await updateBasketAPI(id, data);
      console.log('[MyBaskets] Server returned:', JSON.stringify({ id: result?.id, quantity: result?.quantity, daily_reinitialization_quantity: result?.daily_reinitialization_quantity, status: result?.status }));
      return result;
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
    onError: (err: any) => {
      console.error('[MyBaskets] Save FAILED:', err?.status, err?.message, JSON.stringify(err?.data));
      alert.showAlert(t('common.error'), err?.data?.error ?? err?.message ?? t('errors.serverError'));
    },
  });

  // Normalize API baskets to match existing Basket type — no fallback to demo data
  const baskets = (basketsQuery.data ?? []).map((b: BusinessBasketFromAPI) => ({
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
        start: b.pickup_start_time?.substring(0, 5) ?? '18:00',
        end: b.pickup_end_time?.substring(0, 5) ?? '19:00',
      },
      quantityLeft: Number(b.quantity) || 0,
      quantityTotal: effectiveDailyReinit(b),
      distance: 0,
      address: '',
      latitude: 0,
      longitude: 0,
      exampleItems: [],
      imageUrl: b.image_url ?? undefined,
      isActive: b.status !== 'deleted' && Number(b.quantity) > 0,
      description: b.description ?? undefined,
      maxPerCustomer: (b as any).max_per_customer ?? 5,
      updatedAt: b.updated_at ?? undefined,
      locationName: (b as any).location_name ?? undefined,
    }));

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
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      if (selectedLocationId) {
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', String(selectedLocationId)] });
      }
    },
    onError: (err) => {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    },
  });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [quantityModalBasket, setQuantityModalBasket] = useState<string | null>(null);
  const [tempQuantity, setTempQuantity] = useState(0);
  const [detailBasket, setDetailBasket] = useState<typeof baskets[0] | null>(null);
  // Custom 180 ms fade for the detail modal. RN's built-in animationType
  // ="fade" runs ~300 ms with no override, which combined with the
  // post-save step advance felt sluggish during the demo. `modalRender`
  // keeps the native Modal mounted through the fade-out so the backdrop
  // animation can play before unmount.
  const modalBackdropAnim = useRef(new Animated.Value(0)).current;
  const [modalRender, setModalRender] = useState(false);
  useEffect(() => {
    if (detailBasket) {
      setModalRender(true);
      Animated.timing(modalBackdropAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    } else if (modalRender) {
      Animated.timing(modalBackdropAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setModalRender(false);
      });
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
  const SW_MODAL = Dimensions.get('window').width;
  const SH_MODAL = Dimensions.get('window').height;
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
  const [descTruncated, setDescTruncated] = useState(false);
  const [showPickupEditor, setShowPickupEditor] = useState(false);
  const [pickupStartTime, setPickupStartTime] = useState('');
  const [pickupEndTime, setPickupEndTime] = useState('');
  const [useBusinessHours, setUseBusinessHours] = useState(false);
  const [detailMaxPerCustomer, setDetailMaxPerCustomer] = useState(1);
  // After the demo Save, override the demo basket's displayed qty so the
  // basket-card pill reflects what the user adjusted in the modal. Without
  // this the post-save "Quantité mise à jour" highlight feels disconnected
  // (the pill would still show the original hard-coded number).
  const [demoBasketQtyOverride, setDemoBasketQtyOverride] = useState<number | null>(null);

  const isSupermarket = profile?.isSupermarket ?? false;

  // Animated flash for time-out-of-range warning in availability modal
  const modalTimeFlash = useRef(new Animated.Value(0)).current;
  const [modalTimeWarning, setModalTimeWarning] = useState(false);
  const flashModalTimeWarning = () => {
    setModalTimeWarning(true);
    modalTimeFlash.setValue(1);
    Animated.sequence([
      Animated.timing(modalTimeFlash, { toValue: 0, duration: 300, useNativeDriver: false }),
      Animated.timing(modalTimeFlash, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.timing(modalTimeFlash, { toValue: 0, duration: 300, useNativeDriver: false }),
      Animated.timing(modalTimeFlash, { toValue: 0.6, duration: 200, useNativeDriver: false }),
    ]).start(() => {
      setTimeout(() => setModalTimeWarning(false), 3000);
    });
  };

  // Auto-expand a basket when targetBasketId is set via store
  const lastBasketTsRef = React.useRef(0);
  useEffect(() => {
    if (targetBasketId && targetBasketTs > lastBasketTsRef.current && baskets.length > 0) {
      const target = baskets.find((b) => String(b.id) === String(targetBasketId));
      if (target) {
        lastBasketTsRef.current = targetBasketTs;
        setDetailBasket(target);
        setDetailTodayQty(target.quantityLeft);
        // Clear the target so it doesn't re-trigger
        useBusinessStore.getState().setTargetBasket(null);
      }
    }
  }, [targetBasketId, targetBasketTs, baskets]);

  const handleToggle = useCallback((id: string) => {
    const target = baskets.find((b) => b.id === id);
    if (!target) return;

    const willBeActive = !target.isActive;
    if (willBeActive && !isSupermarket) {
      const otherActive = baskets.find((b) => b.id !== id && b.isActive);
      if (otherActive) {
        alert.showAlert(
          t('business.baskets.onlyOneActive'),
          `"${otherActive.name}" sera désactivé.`,
          [
            { text: 'Annuler', style: 'cancel' },
            {
              text: t('common.confirm'),
              onPress: () => toggleBasketActive(id),
            },
          ]
        );
        return;
      }
    }
    toggleBasketActive(id);
  }, [toggleBasketActive, baskets, isSupermarket, t]);

  const handleDelete = useCallback((id: string) => {
    setMenuOpenId(null);
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
  }, [deleteBasketMutation, store, t]);

  const handleEdit = useCallback((id: string) => {
    setMenuOpenId(null);
    router.push(`/business/create-basket?editId=${id}` as never);
  }, [router]);

  const handleCreate = useCallback(() => {
    router.push('/business/create-basket' as never);
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
    if (ms === 'modalSave') {
      // Screen y for top edge = qty.y - tooltipHeight - ABOVE_QTY_GAP.
      // Subtract another 16 for padding correction.
      return qty.y - tooltipHeight - (ABOVE_QTY_GAP + 16);
    }
    // Screen y for top edge = qty.y + qty.h + BELOW_QTY_GAP. Subtract 16
    // for padding.
    return qty.y + qty.h + (BELOW_QTY_GAP - 16);
  }, [walkthroughCurrentStep?.measureKey, modalCutoutRects, tooltipHeight]);
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
    distance: 0,
    address: '',
    latitude: 0,
    longitude: 0,
    exampleItems: [],
    imageUrl: undefined as string | undefined,
    isActive: true,
    description: t('walkthrough.biz.demoBasketDesc', { defaultValue: 'Démonstration — modifications sans effet sur vos paniers réels.' }),
    maxPerCustomer: 5,
    updatedAt: new Date().toISOString(),
    locationName: undefined as string | undefined,
  }), [t, pickupStart, pickupEnd, demoBasketQtyOverride]);

  const displayedBaskets = demoBasketActive
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

  // ─── Change Photo ────────────────────────────────────────────────────────────
  const handleChangePhoto = useCallback(async (basketId: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      alert.showAlert(t('common.error'), t('business.menuItems.photoPermRequired'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const formData = new FormData();
    formData.append('image', {
      uri: asset.uri,
      name: asset.fileName ?? 'basket.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    } as any);
    try {
      await updateBasketWithImage(basketId, formData);
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      setDetailBasket(prev => prev ? { ...prev, imageUrl: asset.uri } : prev);
    } catch (err: any) {
      alert.showAlert(t('common.error'), err?.message ?? t('errors.serverError'));
    }
  }, [queryClient]);

  // Bypass the loader during a walkthrough run — otherwise step 3 (Add
  // Basket halo) lands while my-baskets is still in its initial query and
  // the button isn't mounted, so its onLayout never publishes `addBasket`
  // and the overlay paints only the dim mask. With this bypass the page
  // renders immediately (empty list, plus the injected demo basket); the
  // button mounts, publishes its rect, and the halo lands on time.
  if (basketsQuery.isLoading && !basketsQuery.data && !inWalkthrough) {
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

      <ScrollView style={styles.content} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
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
            const isSoldOut = !isDemo && basket.quantityLeft === 0;
            // Demo basket must NEVER show expired / sold-out / inactive —
            // the user's actual pickup window may already be past when the
            // demo runs, but the demo is conceptually "always live".
            const isExpired = !isDemo && !isSoldOut && isPickupExpiredInTz(basket.pickupWindow?.end);
            const isUnavailable = !isDemo && (isSoldOut || isExpired || !basket.isActive);
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
                    opacity: isUnavailable ? 0.65 : 1,
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
                    setMenuOpenId(null);
                    setDetailBasket(basket);
                    setDetailTodayQty(basket.quantityLeft);
                    setShowFullDesc(false);
                    setPickupStartTime(basket.pickupWindow.start);
                    setPickupEndTime(basket.pickupWindow.end);
                    setShowPickupEditor(false);
                    setUseBusinessHours(false);
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
                        <Image source={{ uri: basket.imageUrl }} style={[styles.basketImage, { borderRadius: theme.radii.r12 }]} />
                      ) : (
                        <View style={[styles.basketImage, { borderRadius: theme.radii.r12, backgroundColor: theme.colors.primary + '10', justifyContent: 'center', alignItems: 'center' }]}>
                          <ShoppingBag size={28} color={theme.colors.primary} />
                        </View>
                      )}
                      {/* Quantity badge — display only, overlaid top-right, slightly poking out of image */}
                      <View
                        ref={isDemo ? (demoBasketCardQtyRef as any) : undefined}
                        onLayout={isDemo ? measureDemoCardQty : undefined}
                        collapsable={false}
                        style={{
                        position: 'absolute',
                        top: -4,
                        right: -6,
                        backgroundColor: isExpired ? '#f59e0b' : isSoldOut ? theme.colors.error : theme.colors.primary,
                        borderRadius: theme.radii.pill,
                        minWidth: isExpired || isSoldOut ? 44 : 24,
                        height: 24,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: isExpired || isSoldOut ? 8 : 6,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.25,
                        shadowRadius: 3,
                        elevation: 4,
                        zIndex: 10,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                          {isExpired ? t('orders.status.expired', { defaultValue: 'Expiré' }) : isSoldOut ? t('basket.soldOut', { defaultValue: 'Épuisé' }) : basket.quantityLeft >= 10 ? '9+' : basket.quantityLeft}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.basketInfo}>
                      <View style={styles.basketNameRow}>
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const, flex: 1 }]} numberOfLines={1}>
                          {basket.name}
                        </Text>
                        {(canEditBasketInfo || canCreateDeleteBaskets) && (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === basket.id ? null : basket.id); }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          style={styles.moreButton}
                        >
                          <MoreVertical size={18} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                        )}
                      </View>
                      {!selectedLocationId && (basket as any).locationName && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                          <MapPin size={10} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.muted, fontSize: 11, marginLeft: 4 }} numberOfLines={1}>
                            {(basket as any).locationName}
                          </Text>
                        </View>
                      )}
                      <View style={[styles.priceRow, { marginTop: 6 }]}>
                        <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' as const }]}>
                          {basket.discountedPrice} TND
                        </Text>
                        <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through', marginLeft: 8 }]}>
                          {basket.originalPrice} TND
                        </Text>
                      </View>
                      {/* Meta row: daily reinit qty + custom pickup time (if different from location default) */}
                      <View style={[styles.metaRow, { marginTop: 6 }]}>
                        <View
                          ref={isDemo ? (demoBasketQtyRef as any) : undefined}
                          onLayout={isDemo ? measureDemoQty : undefined}
                          style={[styles.metaChip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 }]}
                        >
                          <ShoppingBag size={10} color={theme.colors.textSecondary} />
                          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }]}>
                            {t('business.baskets.dailyReinit', { defaultValue: 'Réinit.' })} {basket.quantityTotal}
                          </Text>
                        </View>
                        {(basket.pickupWindow.start !== pickupStart || basket.pickupWindow.end !== pickupEnd) && (
                        <View style={[styles.metaChip, { backgroundColor: '#e3ff5c18', borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 }]}>
                          <Clock size={10} color="#8a7d00" />
                          <Text style={[{ color: '#8a7d00', ...theme.typography.caption, marginLeft: 3, fontWeight: '600' }]}>
                            {basket.pickupWindow.start}-{basket.pickupWindow.end}
                          </Text>
                        </View>
                        )}
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>

                {menuOpenId === basket.id && (
                  <View style={[styles.dropdownMenu, {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r12,
                    ...theme.shadows.shadowMd,
                    borderWidth: 1,
                    borderColor: theme.colors.divider,
                  }]}>
                    {canEditBasketInfo && (
                    <TouchableOpacity
                      onPress={() => handleEdit(basket.id)}
                      style={[styles.dropdownItem, { padding: theme.spacing.md, borderBottomWidth: canCreateDeleteBaskets ? 1 : 0, borderBottomColor: theme.colors.divider }]}
                    >
                      <Edit3 size={16} color={theme.colors.primary} />
                      <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                        {t('business.baskets.editBasket')}
                      </Text>
                    </TouchableOpacity>
                    )}
                    {canCreateDeleteBaskets && (
                    <TouchableOpacity
                      onPress={() => handleDelete(basket.id)}
                      style={[styles.dropdownItem, { padding: theme.spacing.md }]}
                    >
                      <Trash2 size={16} color={theme.colors.error} />
                      <Text style={[{ color: theme.colors.error, ...theme.typography.bodySm, marginLeft: 10 }]}>
                        {t('business.baskets.delete')}
                      </Text>
                    </TouchableOpacity>
                    )}
                  </View>
                )}


              </View>
            );
          })
        )}
      </ScrollView>

      {/* Detail Modal — custom 180 ms fade via modalBackdropAnim. */}
      <Modal visible={modalRender} transparent animationType="none" onRequestClose={() => setDetailBasket(null)}>
        <Animated.View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16, opacity: modalBackdropAnim }}>
          <View style={{
            backgroundColor: theme.colors.bg,
            borderRadius: 24,
            maxHeight: '90%',
            width: '100%',
            maxWidth: 420,
            overflow: 'hidden',
            ...theme.shadows.shadowLg,
          }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 0 }}>
              {/* Pause pill + close button header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, marginBottom: 12 }}>
                <View>
                  <TouchableOpacity
                    disabled={!canEditQuantities}
                    onPress={() => handleToggle(detailBasket!.id)}
                    style={{
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
                  {canEditBasketInfo && (
                    <TouchableOpacity onPress={() => { setDetailBasket(null); handleEdit(detailBasket!.id); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <MoreVertical size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => setDetailBasket(null)}>
                    <X size={22} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Photo section */}
              <View style={{ height: 200, backgroundColor: theme.colors.divider, position: 'relative' }}>
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
                {/* Camera button */}
                <TouchableOpacity
                  onPress={() => detailBasket && void handleChangePhoto(detailBasket.id)}
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    right: 12,
                    backgroundColor: theme.colors.primary,
                    borderRadius: 20,
                    width: 40,
                    height: 40,
                    justifyContent: 'center',
                    alignItems: 'center',
                    ...theme.shadows.shadowMd,
                  }}
                >
                  <Camera size={18} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* Info card overlapping photo */}
              <View style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                marginTop: -20,
                marginHorizontal: 16,
                padding: 20,
                ...theme.shadows.shadowSm,
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
                marginTop: 16,
                padding: 20,
                ...theme.shadows.shadowSm,
              }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 16 }}>
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
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, opacity: canEditQuantities ? 1 : 0.4 }}>
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

                {/* Pickup Time editor — only show if basket has custom pickup times
                     (different from location default) */}
                {(detailBasket && canEditBasketInfo && (detailBasket.pickupWindow.start !== pickupStart || detailBasket.pickupWindow.end !== pickupEnd)) && (
                <>
                <TouchableOpacity
                  onPress={() => setShowPickupEditor(!showPickupEditor)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingVertical: 8,
                  }}
                >
                  <Clock size={15} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>
                    {showPickupEditor
                      ? t('business.availability.hidePickupEditor', { defaultValue: 'Masquer l\'éditeur de créneau' })
                      : t('business.availability.editPickupTime', { defaultValue: 'Modifier l\'heure de retrait' })}
                  </Text>
                </TouchableOpacity>
                </>
                )}

                {/* Inline Pickup Time Editor */}
                {showPickupEditor && (
                  <View style={{
                    backgroundColor: theme.colors.bg,
                    borderRadius: theme.radii.r12,
                    padding: 16,
                    marginTop: 8,
                  }}>
                    {/* Business hours hint — flashes red when out of range */}
                    <Animated.Text style={{
                      ...theme.typography.caption,
                      marginBottom: 8,
                      color: modalTimeWarning ? theme.colors.error : theme.colors.muted,
                      fontWeight: modalTimeWarning ? '700' : '400',
                    }}>
                      {modalTimeWarning
                        ? t('business.baskets.timeOutOfRangeShort', { defaultValue: `Doit être dans les horaires du commerce (${pickupStart} - ${pickupEnd})` })
                        : `${t('business.baskets.withinHours', { defaultValue: 'Doit être dans les horaires du commerce' })} (${pickupStart} - ${pickupEnd})`}
                    </Animated.Text>

                    {/* Start & End Time — side-by-side wheel pickers */}
                    <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: 6 }}>
                          {t('business.availability.startTime', { defaultValue: 'Start Time' })}
                        </Text>
                        <TimePicker
                          value={pickupStartTime}
                          onChange={(val) => {
                            const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
                            const locS = toMin(pickupStart);
                            const locE = toMin(pickupEnd);
                            const v = toMin(val);
                            const overnight = locE < locS;
                            const inRange = overnight ? (v >= locS || v <= locE) : (v >= locS && v <= locE);
                            if (!inRange) {
                              flashModalTimeWarning();
                              return; // reject — don't update
                            }
                            setPickupStartTime(val);
                          }}
                          primaryColor={theme.colors.primary}
                          textColor={theme.colors.textPrimary}
                          bgColor={theme.colors.surface}
                          mutedColor={theme.colors.muted}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: 6 }}>
                          {t('business.availability.endTime', { defaultValue: 'End Time' })}
                        </Text>
                        <TimePicker
                          value={pickupEndTime}
                          onChange={(val) => {
                            const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
                            const locS = toMin(pickupStart);
                            const locE = toMin(pickupEnd);
                            const v = toMin(val);
                            const overnight = locE < locS;
                            const inRange = overnight ? (v >= locS || v <= locE) : (v >= locS && v <= locE);
                            if (!inRange) {
                              flashModalTimeWarning();
                              return; // reject
                            }
                            setPickupEndTime(val);
                          }}
                          primaryColor={theme.colors.primary}
                          textColor={theme.colors.textPrimary}
                          bgColor={theme.colors.surface}
                          mutedColor={theme.colors.muted}
                        />
                      </View>
                    </View>

                    {/* Use business hours checkbox */}
                    <TouchableOpacity
                      onPress={() => {
                        const newVal = !useBusinessHours;
                        setUseBusinessHours(newVal);
                        if (newVal) {
                          setPickupStartTime(pickupStart);
                          setPickupEndTime(pickupEnd);
                        }
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}
                    >
                      <View style={{
                        width: 22, height: 22, borderRadius: 6,
                        borderWidth: 2,
                        borderColor: useBusinessHours ? theme.colors.primary : theme.colors.muted,
                        backgroundColor: useBusinessHours ? theme.colors.primary : 'transparent',
                        justifyContent: 'center', alignItems: 'center',
                      }}>
                        {useBusinessHours && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>✓</Text>}
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                        {t('business.availability.useBusinessHours', { defaultValue: 'Use business hours for pickup' })}
                      </Text>
                    </TouchableOpacity>
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
                  marginHorizontal: 13,
                  marginTop: 13,
                  marginBottom: 17,
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
                    // Validate pickup times are within location hours before saving
                    const lsH = parseInt(pickupStart) || 0;
                    const lsM = parseInt(pickupStart.split(':')[1]) || 0;
                    const leH = parseInt(pickupEnd) || 23;
                    const leM = parseInt(pickupEnd.split(':')[1]) || 59;
                    const lsMin = lsH * 60 + lsM;
                    const leMin = leH * 60 + leM;
                    const psH = parseInt(pickupStartTime) || 0;
                    const psM = parseInt(pickupStartTime.split(':')[1]) || 0;
                    const peH = parseInt(pickupEndTime) || 0;
                    const peM = parseInt(pickupEndTime.split(':')[1]) || 0;
                    let psMin = psH * 60 + psM;
                    let peMin = peH * 60 + peM;

                    // Force clamp on save
                    if (psMin < lsMin) psMin = lsMin;
                    if (psMin > leMin) psMin = leMin;
                    if (peMin > leMin) peMin = leMin;
                    if (peMin < lsMin) peMin = lsMin;
                    if (peMin <= psMin) peMin = psMin + 5; // ensure end > start

                    const clampedStart = `${String(Math.floor(psMin / 60)).padStart(2, '0')}:${String(psMin % 60).padStart(2, '0')}`;
                    const clampedEnd = `${String(Math.floor(peMin / 60)).padStart(2, '0')}:${String(peMin % 60).padStart(2, '0')}`;

                    // Only include pickup times if the editor was opened (user explicitly changed them)
                    const saveData: Record<string, any> = {
                      name: detailBasket.name,
                      original_price: detailBasket.originalPrice,
                      selling_price: detailBasket.discountedPrice,
                      quantity: detailTodayQty,
                    };
                    if (showPickupEditor) {
                      saveData.pickup_start_time = `${clampedStart}:00`;
                      saveData.pickup_end_time = `${clampedEnd}:00`;
                    }
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
                  marginTop: 16,
                  marginBottom: 20,
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
                  marginBottom: 20,
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
          </View>

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
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownMenu: {
    position: 'absolute',
    top: 44,
    right: 14,
    zIndex: 100,
    minWidth: 180,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
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
