import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Image, Alert,
  TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle, Clock, Minus, Plus, Sparkles, SquareCheck, Square, Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/src/theme/ThemeProvider';
import { TimePicker } from '@/src/components/TimePicker';
import { useBusinessStore } from '@/src/stores/businessStore';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBasketJSON, updateBasket as updateBasketAPI,
  fetchMyBaskets, fetchMyProfile, fetchMyMenuItems,
  duplicateBasketToLocations,
  type MenuItemFromAPI,
} from '@/src/services/business';
import { getErrorMessage, apiClient } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { fetchMyContext, fetchOrganizationDetails, type OrgDetailsFromAPI } from '@/src/services/teams';
import { validateBizDayWindow } from '@/src/utils/timezone';
import { effectiveDailyReinit } from '@/src/utils/dailyReinit';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { DEMO_BASKET_PHOTOS } from '@/src/lib/demoData';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';

export default function CreateBasketScreen() {
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const { baskets: storeBaskets } = useBusinessStore();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const queryClient = useQueryClient();

  // ── Fetch profile for default pickup times. refetchOnMount: 'always'
  // guarantees the form sees the location's CURRENT opening hours every time
  // it opens — without it, a cached profile from before a recent hours edit
  // would leak into the "use business hours" toggle and show stale defaults.
  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 60_000,
    refetchOnMount: 'always',
  });

  // ── Fetch live baskets to populate edit fields
  const basketsQuery = useQuery({
    queryKey: ['my-baskets', selectedLocationId],
    queryFn: () => fetchMyBaskets(selectedLocationId),
    staleTime: 60_000,
  });

  // Permission check — block unauthorized access
  const ctxQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 10_000 });
  const myRole = ctxQuery.data?.role ?? 'member';
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const rawPerms = ctxQuery.data?.permissions ?? {};
  const hasPerm = (key: string) => { const v = (rawPerms as any)[key]; return v === true || v === 'true' || v === 'write'; };
  const canCreateBasket = isAdmin || hasPerm('create_delete_baskets');
  const canEditBasket = isAdmin || hasPerm('edit_basket_info');
  const hasPermission = editId ? canEditBasket : canCreateBasket;
  // Org-admin = admin/owner with NO location scope. Location-admins
  // only manage their own location and shouldn't be able to push a
  // basket into a sibling location, so they don't see the toggle.
  const isOrgAdmin = isAdmin && !ctxQuery.data?.location_id;
  const orgId = ctxQuery.data?.organization_id;
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId && isOrgAdmin,
    staleTime: 60_000,
  });
  const orgLocations = (orgDetailsQuery.data as OrgDetailsFromAPI | undefined)?.locations ?? [];
  // "Use for all locations" — surfaces in BOTH create and edit modes so
  // an org-admin can flip it after the fact. Hidden when there's only
  // a single location to replicate to (would be a no-op) or when the
  // user isn't an org-admin.
  const [useForAllLocations, setUseForAllLocations] = useState(false);
  const showAllLocationsToggle = isOrgAdmin && orgLocations.length > 1;

  // Find the basket to edit — prefer live API data, fall back to store
  const apiBasket = editId
    ? basketsQuery.data?.find((b) => String(b.id) === editId)
    : null;
  const storeBasket = editId
    ? storeBaskets.find((b) => b.id === editId)
    : null;

  const isEditing = !!editId;

  // ── Field state — populate from API basket if editing
  const [name, setName] = useState(
    apiBasket?.name ?? storeBasket?.name ?? ''
  );
  const [description, setDescription] = useState(
    apiBasket?.description ?? storeBasket?.description ?? ''
  );
  const [originalPrice, setOriginalPrice] = useState(
    apiBasket?.original_price != null
      ? String(apiBasket.original_price)
      : storeBasket?.originalPrice?.toString() ?? ''
  );
  const [sellingPrice, setSellingPrice] = useState(
    apiBasket?.selling_price != null
      ? String(apiBasket.selling_price)
      : storeBasket?.discountedPrice?.toString() ?? ''
  );
  const [quantity, setQuantity] = useState(
    apiBasket?.quantity ?? storeBasket?.quantityTotal ?? 5
  );
  const [maxPerCustomer, setMaxPerCustomer] = useState<number>(
    (apiBasket as any)?.max_per_customer ?? (storeBasket as any)?.maxPerCustomer ?? 5
  );

  // ── Daily reinit schedule (edit mode only)
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const DAY_LABELS: Record<string, string> = { mon: 'LUN', tue: 'MAR', wed: 'MER', thu: 'JEU', fri: 'VEN', sat: 'SAM', sun: 'DIM' };
  const [sameAllDays, setSameAllDays] = useState(true);
  const [daySchedule, setDaySchedule] = useState<Record<string, number>>({ mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 });

  // ── Menu items for selection
  const menuItemsQuery = useQuery({
    queryKey: ['my-menu-items'],
    queryFn: fetchMyMenuItems,
    staleTime: 30_000,
  });

  // Parse existing menu_item_ids from the basket being edited
  const existingMenuItemIds: number[] = (() => {
    const raw = (apiBasket as any)?.menu_item_ids;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(Number);
    if (typeof raw === 'string') {
      try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map(Number) : []; } catch { return []; }
    }
    return [];
  })();

  const [selectedMenuItemIds, setSelectedMenuItemIds] = useState<number[]>(existingMenuItemIds);

  const [showMenuItems, setShowMenuItems] = useState<boolean>(
    !!((apiBasket as any)?.show_menu_items)
  );
  const [useDefaultPickupInstructions, setUseDefaultPickupInstructions] = useState(
    !((apiBasket as any)?.pickup_instructions)
  );
  const [pickupInstructions, setPickupInstructions] = useState<string>(
    (apiBasket as any)?.pickup_instructions ?? ''
  );

  // Sync selected menu items when editing basket loads
  React.useEffect(() => {
    if (isEditing && apiBasket) {
      const raw = (apiBasket as any)?.menu_item_ids;
      if (raw) {
        const ids = Array.isArray(raw) ? raw.map(Number) : (() => { try { return JSON.parse(raw).map(Number); } catch { return []; } })();
        setSelectedMenuItemIds(ids);
      }
      const smi = (apiBasket as any)?.show_menu_items;
      if (smi !== undefined) setShowMenuItems(!!smi);
      const pi = (apiBasket as any)?.pickup_instructions;
      if (pi) { setPickupInstructions(pi); setUseDefaultPickupInstructions(false); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBasket?.id]);

  const toggleMenuItem = (itemId: number) => {
    setSelectedMenuItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  // Pickup times: use basket-specific times if editing, else profile-level defaults
  const defaultStart =
    apiBasket?.pickup_start_time?.substring(0, 5) ??
    profileQuery.data?.pickup_start_time?.substring(0, 5) ??
    '18:00';
  const defaultEnd =
    apiBasket?.pickup_end_time?.substring(0, 5) ??
    profileQuery.data?.pickup_end_time?.substring(0, 5) ??
    '19:00';

  const [pickupStart, setPickupStart] = useState(defaultStart);
  const [pickupEnd, setPickupEnd] = useState(defaultEnd);

  const [showZeroQtyWarning, setShowZeroQtyWarning] = useState(false);

  // Custom pickup time toggle — if OFF, basket uses location's default pickup times
  const locationDefaultStart = profileQuery.data?.pickup_start_time?.substring(0, 5) ?? '18:00';
  const locationDefaultEnd = profileQuery.data?.pickup_end_time?.substring(0, 5) ?? '19:00';
  // Inverted from the old `useCustomPickupTime`: when true, the basket
  // inherits the location's hours and the custom pickers are hidden; when
  // false, the user is editing a custom window and the pickers are shown.
  //
  // Canonical "inheriting" signal: the server's pickup_start_time /
  // pickup_end_time columns are NULL. We deliberately do NOT compare basket
  // times against the location defaults — a basket with explicit values that
  // happen to match the location defaults is still a custom override, and
  // must round-trip as "custom" so the user sees the checkbox unchecked
  // after a save. (Bug seen previously: save with custom == defaults →
  // reopen form → checkbox shown checked.)
  const [useBusinessHours, setUseBusinessHours] = useState(() => {
    if (!isEditing) return true;
    return !apiBasket?.pickup_start_time || !apiBasket?.pickup_end_time;
  });

  const [priceError, setPriceError] = useState('');
  const [nameError, setNameError] = useState('');
  const [descError, setDescError] = useState('');
  const [origPriceError, setOrigPriceError] = useState('');
  const [sellingPriceError, setSellingPriceError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  // Mirror the same `apiBasket ?? storeBasket` fallback the other field
  // states use, so the photo shows immediately in edit mode even before the
  // baskets query resolves. Without the storeBasket fallback the input
  // flashed empty on slow connections.
  const [basketImageUri, setBasketImageUri] = useState<string | null>(
    apiBasket?.image_url ?? (storeBasket as any)?.imageUrl ?? null
  );

  // Hydrate from whichever source resolves first / freshest.
  useEffect(() => {
    if (!isEditing) return;
    const next = apiBasket?.image_url ?? (storeBasket as any)?.imageUrl;
    if (next) setBasketImageUri(next);
  }, [isEditing, apiBasket?.image_url, (storeBasket as any)?.imageUrl]);

  // ── Walkthrough demo mode ──────────────────────────────────────────────
  const demoBasketActive = useWalkthroughStore((s) => s.demoBasketActive);
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  const demoPrefillFiredRef = useRef(false);

  // When demo is active and we're creating (not editing), pre-fill the
  // form once on mount so the user sees realistic content while the tour
  // walks through pickup/daily-reset/confirm.
  useEffect(() => {
    if (!demoBasketActive || isEditing || demoPrefillFiredRef.current) return;
    demoPrefillFiredRef.current = true;
    setName(t('walkthrough.biz.demoBasketName', { defaultValue: 'Panier Surprise (démo)' }));
    setDescription(t('walkthrough.biz.demoBasketDesc', { defaultValue: 'Démonstration — modifications sans effet sur vos paniers réels.' }));
    setOriginalPrice('12');
    setSellingPrice('5');
    setQuantity(5);
    // Prefill the same demo "surprise basket" photo so the form preview matches
    // the injected demo card. The demo save short-circuits (no upload), so this
    // is purely visual.
    setBasketImageUri(DEMO_BASKET_PHOTOS[0]);
  }, [demoBasketActive, isEditing, t]);

  // Measure the pickup-time card, daily-reset card, and confirm button so
  // the walkthrough can highlight them pixel-accurately.
  const pickupCardRef = useRef<View | null>(null);
  const reinitCardRef = useRef<View | null>(null);
  const confirmBtnRef = useRef<View | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const measureRect = (ref: React.RefObject<View | null>, key: 'formPickupTime' | 'formDailyReset' | 'formConfirmBtn') => () => {
    requestAnimationFrame(() => {
      ref.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
        // Round to integer pixels — subpixel values from measureInWindow can
        // produce 0.5-1px misalignment between the SVG cutout path (drawn
        // via floating-point coordinates) and the border View ring, which
        // the user perceives as the halo not hugging the element.
        // Give the pickup-time card halo a touch more breathing room (slightly
        // bigger than flush) per design request; other form steps stay flush.
        const pad = key === 'formPickupTime' ? 8 : 0;
        if (w > 0 && h > 0) setMeasuredRect(key, {
          x: Math.round(x - pad),
          y: Math.round(y - pad),
          w: Math.round(w + pad * 2),
          h: Math.round(h + pad * 2),
        });
      });
    });
  };

  // Auto-scroll the form to bring the currently-highlighted field into view
  // when the walkthrough lands on a form step. Each form section (the qty
  // card, the pickup-time card) carries a layout-tracking ref via an extra
  // `onLayout` on its OUTER wrapper. The outer wrappers are direct children
  // of the ScrollView's content container, so `e.nativeEvent.layout.y` is
  // already the offset we need for `scrollTo`. This replaces the previous
  // measureLayout-based path that logged "measureLayout must be called
  // with a ref to a native component" and never actually scrolled.
  const walkthroughCurrentStep = useWalkthroughStore((s) => s.currentStep);
  const scrollOffsetYRef = useRef(0);
  const fieldYsRef = useRef<Record<string, number>>({});
  const captureFieldY = (key: string) => (e: any) => {
    if (e?.nativeEvent?.layout) fieldYsRef.current[key] = e.nativeEvent.layout.y;
  };
  useEffect(() => {
    const key = walkthroughCurrentStep?.measureKey;
    if (!key) return;
    if (key !== 'formPickupTime' && key !== 'formDailyReset' && key !== 'formConfirmBtn') return;
    const targetRef =
      key === 'formPickupTime' ? pickupCardRef :
      key === 'formDailyReset' ? reinitCardRef :
      confirmBtnRef;
    if (!scrollViewRef.current) return;
    // Snapshot the step so async retries don't apply a measurement for an
    // obsolete step (the user may have moved on).
    const stepAtFire = key;
    // Invalidate the previous rect so the overlay falls back to dim-only
    // mode while we scroll — prevents a "halo at the old position" flash.
    setMeasuredRect(stepAtFire as any, null);

    // Re-measure with retry. measureInWindow can return 0×0 if the view
    // hasn't finished laying out / scrolling; we retry up to 8 times at
    // 100ms intervals until we get valid dims. After a successful measure
    // we also schedule a few follow-ups to catch any post-scroll settling.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tryMeasure = (attempt: number) => {
      if (attempt > 8) return;
      // Stop applying measurements if the walkthrough has moved past this step.
      if (useWalkthroughStore.getState().currentStep?.measureKey !== stepAtFire) return;
      const node: any = targetRef.current;
      if (!node?.measureInWindow) {
        timers.push(setTimeout(() => tryMeasure(attempt + 1), 100));
        return;
      }
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        if (w > 0 && h > 0) {
          setMeasuredRect(stepAtFire as any, {
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(w),
            h: Math.round(h),
          });
          // Schedule a follow-up re-measure in case the form is still
          // animating into position when the first valid measure lands.
          if (attempt < 3) timers.push(setTimeout(() => tryMeasure(attempt + 1), 200));
        } else {
          timers.push(setTimeout(() => tryMeasure(attempt + 1), 100));
        }
      });
    };

    const scrollAndMeasure = () => {
      // Confirm button lives in the fixed footer below the ScrollView, so
      // no scroll is needed — only the post-Stack-push re-measure. The
      // initial onLayout fires while the screen is still mid-push, which
      // captures a transitional window y and parks the halo below the
      // button. Re-measuring after the push animation settles fixes it.
      if (stepAtFire !== 'formConfirmBtn') {
        const yPos = fieldYsRef.current[stepAtFire];
        if (yPos != null) {
          scrollViewRef.current?.scrollTo({ y: Math.max(0, yPos - 80), animated: true });
        }
      }
      // Wait for the scroll animation to settle (~250ms default + slack)
      // before re-measuring; otherwise we capture an intermediate frame.
      timers.push(setTimeout(() => tryMeasure(0), 350));
    };

    // Brief delay so any pending layout flush completes.
    timers.push(setTimeout(scrollAndMeasure, 150));
    return () => { timers.forEach(clearTimeout); };
  }, [walkthroughCurrentStep?.measureKey]);

  const pickBasketImage = () => {
    Alert.alert(
      t('common.addPhoto', { defaultValue: 'Photo du panier' }),
      undefined,
      [
        { text: t('common.takePhoto', { defaultValue: 'Prendre une photo' }), onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') return;
          const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7 });
          if (!result.canceled && result.assets?.[0]) setBasketImageUri(result.assets[0].uri);
        }},
        { text: t('common.chooseFromGallery', { defaultValue: 'Choisir depuis la galerie' }), onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') return;
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, quality: 0.7 });
          if (!result.canceled && result.assets?.[0]) setBasketImageUri(result.assets[0].uri);
        }},
        { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
      ]
    );
  };

  const handleAISuggest = async () => {
    setAiLoading(true);
    try {
      const response = await apiClient.post('/api/baskets/ai-suggest', {
        category: profileQuery.data?.category,
        name,
      });
      const data = response.data as { name?: string; description?: string; price?: number };
      if (data.name) setName(data.name);
      if (data.description) setDescription(data.description);
      if (data.price != null) setSellingPrice(String(data.price));
      alert.showAlert(t('business.createBasket.aiSuggestionTitle', { defaultValue: 'Suggestion IA' }), t('business.createBasket.aiSuggestionFilled', { defaultValue: 'Contenu suggéré rempli ! Ajustez-le selon vos besoins.' }));
    } catch (err) {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    } finally {
      setAiLoading(false);
    }
  };

  // Update pickup times when profile/baskets load (only if not yet modified by user)
  React.useEffect(() => {
    if (!isEditing && profileQuery.data) {
      const s = profileQuery.data.pickup_start_time?.substring(0, 5);
      const e = profileQuery.data.pickup_end_time?.substring(0, 5);
      if (s) setPickupStart(s);
      if (e) setPickupEnd(e);
    }
  }, [profileQuery.data, isEditing]);

  // While "use business hours" is selected (i.e. custom is OFF), keep the
  // displayed pickup window in lockstep with the location's current hours.
  // Covers two cases the old toggle handler missed:
  //   1. Profile hadn't finished loading at toggle time → would have applied
  //      the hardcoded 18:00-19:00 fallback. The effect re-runs once data
  //      arrives and snaps to the real hours.
  //   2. Location hours change while the form is mounted (rare but possible
  //      via another tab / invalidation) → effect re-syncs.
  React.useEffect(() => {
    if (!useBusinessHours) return;
    const s = profileQuery.data?.pickup_start_time?.substring(0, 5);
    const e = profileQuery.data?.pickup_end_time?.substring(0, 5);
    if (s && s !== pickupStart) setPickupStart(s);
    if (e && e !== pickupEnd) setPickupEnd(e);
  }, [useBusinessHours, profileQuery.data?.pickup_start_time, profileQuery.data?.pickup_end_time]);

  React.useEffect(() => {
    if (isEditing && apiBasket) {
      setName(apiBasket.name);
      if (apiBasket.description) setDescription(apiBasket.description);
      if (apiBasket.original_price != null) setOriginalPrice(String(apiBasket.original_price));
      if (apiBasket.selling_price != null) setSellingPrice(String(apiBasket.selling_price));
      // In edit mode the label on this field is "Réinit. journalière". Show
      // today's effective value when a per-day schedule is active so the
      // number matches what the baskets page and cron will use; fall back
      // to the flat daily_reinitialization_quantity otherwise. Never use the
      // live `quantity` — that decrements as orders come in during the day.
      const initQty = effectiveDailyReinit(apiBasket);
      if (Number.isFinite(initQty) && initQty > 0) setQuantity(initQty);
      if (apiBasket.pickup_start_time) setPickupStart(apiBasket.pickup_start_time.substring(0, 5));
      if (apiBasket.pickup_end_time) setPickupEnd(apiBasket.pickup_end_time.substring(0, 5));
      // Re-sync the "use business hours" checkbox from the canonical NULL
      // signal on the server columns. Necessary because the useState
      // initializer above runs once at mount; if the basket query was still
      // resolving then, apiBasket was undefined and the checkbox defaulted
      // to true. This effect corrects it once apiBasket actually arrives.
      setUseBusinessHours(!apiBasket.pickup_start_time || !apiBasket.pickup_end_time);
      const mpc = (apiBasket as any).max_per_customer;
      if (mpc != null) setMaxPerCustomer(mpc);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBasket?.id, apiBasket?.pickup_start_time, apiBasket?.pickup_end_time]);

  // Populate daily reinit schedule from API basket when editing
  React.useEffect(() => {
    if (isEditing && apiBasket) {
      const schedule = (apiBasket as any)?.daily_reinit_schedule;
      if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
        setSameAllDays(false);
        setDaySchedule({ mon: schedule.mon ?? 0, tue: schedule.tue ?? 0, wed: schedule.wed ?? 0, thu: schedule.thu ?? 0, fri: schedule.fri ?? 0, sat: schedule.sat ?? 0, sun: schedule.sun ?? 0 });
      } else {
        setSameAllDays(true);
        const qty = Number((apiBasket as any).daily_reinitialization_quantity ?? apiBasket.quantity ?? 5);
        setDaySchedule({ mon: qty, tue: qty, wed: qty, thu: qty, fri: qty, sat: qty, sun: qty });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBasket?.id]);

  const validatePrice = (orig: string, disc: string) => {
    const o = parseFloat(orig);
    const d = parseFloat(disc);
    if (o > 0 && o < 10) {
      setPriceError(t('business.createBasket.minOriginalPrice', { defaultValue: 'Le prix original doit être d\'au moins 10 TND.' }));
      return false;
    }
    // Selling price must be at most 50% of original (at least 50% discount)
    if (o > 0 && d > 0 && d > o * 0.5) {
      setPriceError(t('business.createBasket.priceError', { defaultValue: 'Le prix réduit doit être d\'au moins 50% inférieur au prix original.' }));
      return false;
    }
    setPriceError('');
    return true;
  };

  // ── Ensure time is formatted as HH:MM:SS for the backend
  const toTimeField = (hhmm: string) =>
    hhmm.includes(':') && hhmm.split(':').length === 2 ? `${hhmm}:00` : hhmm;

  // ── Mutations

  const validatePickupTime = (start: string, end: string): { valid: boolean; error?: string; start: string; end: string } => {
    // Bounds-against-location-hours check intentionally removed: a basket's
    // custom pickup window may legitimately fall outside the shop's regular
    // hours (e.g. a 21:00 close-out grab even though the shop "closes" at
    // 20:00). The merchant explicitly chose the window — trust them.
    //
    // Two hard rules though, shared with the location-hours editors via
    // `validateBizDayWindow` so all three surfaces stay in lockstep:
    //   - zero-duration windows are rejected
    //   - windows that straddle the 03:30 daily reset cron are rejected
    //     (the cron resets every basket's stock, so a window that
    //     includes 03:30 would refill mid-window — incoherent).
    const status = validateBizDayWindow(start, end);
    if (status === 'zero') {
      return { valid: false, error: t('business.baskets.endBeforeStart', { defaultValue: 'End time must be after start time' }), start, end };
    }
    if (status === 'crosses-reset') {
      return {
        valid: false,
        error: t('business.availability.crossReset', {
          defaultValue: "Le créneau ne peut pas traverser la réinitialisation quotidienne (03:30). Choisissez un début ≥ 03:30, ou une fin ≤ 03:29.",
        }),
        start,
        end,
      };
    }
    return { valid: true, start, end };
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const effectiveStart = useBusinessHours ? locationDefaultStart : pickupStart;
      const effectiveEnd = useBusinessHours ? locationDefaultEnd : pickupEnd;
      const result = validatePickupTime(effectiveStart, effectiveEnd);
      if (!result.valid) {
        return Promise.reject(new Error(result.error));
      }
      // When the user picked a photo for a new basket, we need multipart —
      // the JSON endpoint can't carry the file. Mirror the edit-mode branch
      // a few lines below. Without this branch the photo state was silently
      // dropped on create.
      const isNewImage = !!basketImageUri && !basketImageUri.startsWith('http');
      // Inheritance contract: if the user left "use business hours" checked,
      // do NOT bake the location's CURRENT pickup times into the basket.
      // Leave the basket's columns NULL so future location updates propagate
      // (backend COALESCEs on read).
      const sendStart = useBusinessHours ? null : toTimeField(result.start);
      const sendEnd = useBusinessHours ? null : toTimeField(result.end);
      if (isNewImage) {
        const formData = new FormData();
        formData.append('name', name.trim());
        if (description.trim()) formData.append('description', description.trim());
        if (originalPrice) formData.append('original_price', String(parseFloat(originalPrice)));
        formData.append('selling_price', String(parseFloat(sellingPrice)));
        formData.append('quantity', String(quantity));
        // Multipart can't carry a real null. Append nothing → backend sees
        // undefined → basket column stays NULL (= inherit). Send the value
        // only when the user opted into a custom time.
        if (sendStart) formData.append('pickup_start_time', sendStart);
        if (sendEnd) formData.append('pickup_end_time', sendEnd);
        if (selectedMenuItemIds.length > 0) formData.append('menu_item_ids', JSON.stringify(selectedMenuItemIds));
        formData.append('show_menu_items', String(!!showMenuItems));
        if (!useDefaultPickupInstructions && pickupInstructions.trim()) {
          formData.append('pickup_instructions', pickupInstructions.trim());
        }
        if (selectedLocationId) formData.append('location_id', String(Number(selectedLocationId)));
        const filename = basketImageUri!.split('/').pop() ?? 'basket.jpg';
        formData.append('image', { uri: basketImageUri, name: filename, type: 'image/jpeg' } as any);
        const { createBasket } = await import('@/src/services/business');
        return createBasket(formData);
      }
      return createBasketJSON({
        name: name.trim(),
        description: description.trim() || undefined,
        original_price: originalPrice ? parseFloat(originalPrice) : undefined,
        selling_price: parseFloat(sellingPrice),
        quantity,
        // JSON path: pass the field through with the actual value or omit /
        // pass undefined. createBasketJSON's type signature requires string,
        // so when sendStart is null we omit the field (column will be NULL
        // by default since it's a new row).
        ...(sendStart ? { pickup_start_time: sendStart } : {}),
        ...(sendEnd ? { pickup_end_time: sendEnd } : {}),
        menu_item_ids: selectedMenuItemIds.length > 0 ? selectedMenuItemIds : undefined,
        show_menu_items: showMenuItems,
        pickup_instructions: useDefaultPickupInstructions ? undefined : pickupInstructions.trim() || undefined,
        location_id: selectedLocationId ? Number(selectedLocationId) : undefined,
      } as any);
    },
    onSuccess: async (created: any) => {
      // "Use for all locations" — after the canonical basket is created at
      // the user's currently-selected location, replicate it into every
      // other org location via the existing /duplicate endpoint. The
      // duplicates are independent rows (per-location edits won't bleed),
      // which matches the user's mental model of "one basket per shop".
      if (showAllLocationsToggle && useForAllLocations && created?.id) {
        const targetIds = orgLocations
          .map((l: any) => Number(l.id))
          .filter((id: number) => Number.isFinite(id) && id !== Number(selectedLocationId));
        if (targetIds.length > 0) {
          try {
            await duplicateBasketToLocations(created.id, targetIds);
          } catch (err: any) {
            // Don't block the success path — surface a warning so the admin
            // knows replication didn't fully complete. The canonical basket
            // at their current location still got created cleanly.
            console.log('[CreateBasket] duplicate-to-all failed:', err?.message);
            alert.showAlert(
              t('common.warning', { defaultValue: 'Avertissement' }),
              t('business.createBasket.replicateFailed', { defaultValue: 'Panier créé mais la copie vers les autres emplacements a échoué.' })
            );
          }
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      if (selectedLocationId) {
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', String(selectedLocationId)] });
        void queryClient.invalidateQueries({ queryKey: ['location', String(selectedLocationId)] });
      }
      setTimeout(() => router.back(), 300);
    },
    onError: (err: any) => {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const effectiveStart = useBusinessHours ? locationDefaultStart : pickupStart;
      const effectiveEnd = useBusinessHours ? locationDefaultEnd : pickupEnd;
      const result = validatePickupTime(effectiveStart, effectiveEnd);
      if (!result.valid) {
        return Promise.reject(new Error(result.error));
      }
      // In edit mode the quantity field represents the daily reinit value,
      // not the current live inventory. We only send quantity on first
      // creation so today's live count isn't clobbered during edits.
      const isNewImage = basketImageUri && !basketImageUri.startsWith('http');
      // Inheritance: when the user has "use business hours" checked, leave
      // the basket's per-row pickup columns NULL so the customer-facing read
      // COALESCEs back to the location. We send the empty-string sentinel
      // through multipart (backend treats '' / null / 'null' as clear) and
      // an explicit `null` on JSON.
      const sendStart = useBusinessHours ? null : toTimeField(result.start);
      const sendEnd = useBusinessHours ? null : toTimeField(result.end);
      if (isNewImage) {
        const formData = new FormData();
        formData.append('name', name.trim());
        if (description.trim()) formData.append('description', description.trim());
        if (originalPrice) formData.append('original_price', String(parseFloat(originalPrice)));
        formData.append('selling_price', String(parseFloat(sellingPrice)));
        if (!isEditing) formData.append('quantity', String(quantity));
        formData.append('daily_reinitialization_quantity', String(quantity));
        // Empty string signals "clear" to the backend's clearOrKeep helper.
        formData.append('pickup_start_time', sendStart ?? '');
        formData.append('pickup_end_time', sendEnd ?? '');
        if (selectedMenuItemIds.length) formData.append('menu_item_ids', JSON.stringify(selectedMenuItemIds));
        // Pickup instructions: same inherit contract via the existing clear handler.
        formData.append('pickup_instructions', useDefaultPickupInstructions ? '' : (pickupInstructions.trim() || ''));
        // Per-day schedule: always send when editing so per-day changes land
        // even during an image update, and so toggling back to "same all days"
        // explicitly clears the schedule column (null string → NULL on server).
        if (isEditing) {
          formData.append('daily_reinit_schedule', sameAllDays ? 'null' : JSON.stringify(daySchedule));
        }
        const filename = basketImageUri.split('/').pop() ?? 'basket.jpg';
        formData.append('image', { uri: basketImageUri, name: filename, type: 'image/jpeg' } as any);
        const { updateBasketWithImage } = await import('@/src/services/business');
        return updateBasketWithImage(editId!, formData);
      }
      return updateBasketAPI(editId!, {
        name: name.trim(),
        description: description.trim() || null,
        original_price: originalPrice ? parseFloat(originalPrice) : undefined,
        selling_price: parseFloat(sellingPrice),
        ...(isEditing ? {} : { quantity }),
        max_per_customer: maxPerCustomer,
        daily_reinitialization_quantity: quantity,
        // Always send when editing: object when per-day is active, null to
        // clear the column otherwise. Omitted on first creation so the
        // default NULL sticks for newly-created baskets.
        ...(isEditing ? { daily_reinit_schedule: sameAllDays ? null : JSON.stringify(daySchedule) } : {}),
        // null clears (inherits from location); a value overrides.
        pickup_start_time: sendStart,
        pickup_end_time: sendEnd,
        menu_item_ids: selectedMenuItemIds,
        show_menu_items: showMenuItems,
        // null clears; non-empty string overrides. Sending null instead of
        // undefined lets the user explicitly switch back to "inherit" after
        // having set a custom value previously.
        pickup_instructions: useDefaultPickupInstructions ? null : pickupInstructions.trim() || null,
      });
    },
    onSuccess: async () => {
      // Edit-mode "use for all locations" — same intent as on create,
      // but here the source basket already exists. We duplicate the
      // freshly-saved basket into every OTHER org location. The user's
      // current location keeps the row they just edited; siblings get
      // a clean copy.
      if (showAllLocationsToggle && useForAllLocations && editId) {
        const targetIds = orgLocations
          .map((l: any) => Number(l.id))
          .filter((id: number) => Number.isFinite(id) && id !== Number(selectedLocationId));
        if (targetIds.length > 0) {
          try {
            await duplicateBasketToLocations(editId, targetIds);
          } catch (err: any) {
            console.log('[CreateBasket] edit-mode replicate failed:', err?.message);
            alert.showAlert(
              t('common.warning', { defaultValue: 'Avertissement' }),
              t('business.createBasket.replicateFailed', { defaultValue: 'Panier créé mais la copie vers les autres emplacements a échoué.' })
            );
          }
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      // Invalidate basket detail so customer preview shows updated data
      if (editId) void queryClient.invalidateQueries({ queryKey: ['basket', String(editId)] });
      if (selectedLocationId) {
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', String(selectedLocationId)] });
        void queryClient.invalidateQueries({ queryKey: ['location', String(selectedLocationId)] });
      }
      setTimeout(() => router.back(), 300);
    },
    onError: (err: any) => {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const requiredMsg = t('common.requiredField', { defaultValue: 'Ce champ est obligatoire.' });

  const handleSave = () => {
    // Demo mode: skip backend mutation entirely. router.replace avoids the
    // dev-only "GO_BACK was not handled" warning that router.back() can
    // trigger when expo-router's navigator state is off; the walkthrough's
    // advanceOnPath listener fires once we land back on my-baskets either way.
    if (demoBasketActive && !isEditing) {
      try { router.replace('/(business)/my-baskets' as never); } catch {
        try { router.back(); } catch {}
      }
      return;
    }
    let hasError = false;
    // Clear previous errors
    setNameError('');
    setDescError('');
    setOrigPriceError('');
    setSellingPriceError('');

    if (!name.trim()) { setNameError(requiredMsg); hasError = true; }
    if (!description.trim()) { setDescError(requiredMsg); hasError = true; }
    const op = parseFloat(originalPrice);
    if (!op || op <= 0) { setOrigPriceError(requiredMsg); hasError = true; }
    const sp = parseFloat(sellingPrice);
    if (!sp || sp <= 0) { setSellingPriceError(requiredMsg); hasError = true; }
    if (hasError) return;
    if (!validatePrice(originalPrice, sellingPrice)) return;
    const doSave = () => {
      if (isEditing) {
        updateMutation.mutate();
      } else {
        createMutation.mutate();
      }
    };
    // Warn if custom time is enabled but matches location defaults
    if (!useBusinessHours && pickupStart === locationDefaultStart && pickupEnd === locationDefaultEnd) {
      alert.showAlert(
        t('business.createBasket.sameAsLocationHours', { defaultValue: 'Horaires identiques' }),
        t('business.createBasket.sameAsLocationHoursDesc', { defaultValue: `Vous avez activé un créneau personnalisé avec les mêmes horaires que le commerce (${locationDefaultStart} - ${locationDefaultEnd}). Êtes-vous sûr ?` }),
        [
          { text: t('business.createBasket.changeTime', { defaultValue: 'Changer' }), style: 'cancel' },
          { text: t('common.confirm', { defaultValue: 'Confirmer' }), onPress: doSave },
        ]
      );
      return;
    }
    if (quantity === 0) {
      setShowZeroQtyWarning(true);
      return;
    }
    doSave();
  };

  // ── Time picker helpers
  const adjustHour = (time: string, delta: number) => {
    const [h, m] = time.split(':').map(Number);
    const newH = ((h + delta + 24) % 24);
    return `${String(newH).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
  };

  // Block unauthorized access
  if (!hasPermission && !ctxQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <AlertCircle size={48} color={theme.colors.muted} />
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 16, textAlign: 'center' }}>
          {t('business.profile.noPermission', { defaultValue: "Vous n'avez pas la permission d'accéder à cette page." })}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20, backgroundColor: theme.colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{t('common.goBack', { defaultValue: 'Retour' })}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <X size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
            {isEditing ? t('business.createBasket.editTitle') : t('business.createBasket.title')}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.form}
          contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e) => { scrollOffsetYRef.current = e.nativeEvent.contentOffset.y; }}
        >
          {/* Basket Image */}
          <TouchableOpacity onPress={pickBasketImage} style={{ marginBottom: theme.spacing.xl, borderRadius: theme.radii.r16, overflow: 'hidden', backgroundColor: theme.colors.surfaceMuted, height: 180, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}>
            {basketImageUri ? (
              <Image source={{ uri: basketImageUri }} style={{ width: '100%', height: 180 }} resizeMode="cover" />
            ) : (
              <View style={{ alignItems: 'center', gap: 8 }}>
                <Camera size={32} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm }}>
                  {t('business.createBasket.addPhoto', { defaultValue: 'Ajouter une photo du panier' })}
                </Text>
              </View>
            )}
            {basketImageUri && (
              <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, width: 36, height: 36, justifyContent: 'center', alignItems: 'center' }}>
                <Camera size={16} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          {/* Name */}
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' }}>
                {t('business.createBasket.name')} *
              </Text>
              {FeatureFlags.ENABLE_AI_BASKET_SUGGESTIONS && (
                <TouchableOpacity
                  onPress={handleAISuggest}
                  disabled={aiLoading}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: theme.colors.primary + '18',
                    borderWidth: 1,
                    borderColor: theme.colors.primary,
                    borderRadius: theme.radii.r12,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: 6,
                  }}
                >
                  {aiLoading ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Sparkles size={14} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }}>
                        {t('business.createBasket.suggest')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: nameError ? theme.colors.error : theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={name}
              onChangeText={(v) => { setName(v); if (v.trim()) setNameError(''); }}
              placeholder={t('business.createBasket.namePlaceholder')}
              placeholderTextColor={theme.colors.muted}
            />
            {nameError !== '' && <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 4 }}>{nameError}</Text>}
          </View>

          {/* Description */}
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm }}>
              {t('business.createBasket.description')} *
            </Text>
            <TextInput
              style={[styles.textArea, { backgroundColor: theme.colors.surface, borderColor: descError ? theme.colors.error : theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={description}
              onChangeText={(v) => { setDescription(v); if (v.trim()) setDescError(''); }}
              placeholder={t('business.createBasket.descriptionPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            {descError !== '' && <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 4 }}>{descError}</Text>}
          </View>

          {/* Prices */}
          <View style={[styles.row, { marginBottom: theme.spacing.xl }]}>
            <View style={[styles.halfField, { marginRight: theme.spacing.md }]}>
              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm }}>
                {t('business.createBasket.originalPrice')} *
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: origPriceError ? theme.colors.error : theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                value={originalPrice}
                onChangeText={(v) => {
                  setOriginalPrice(v);
                  if (v.trim()) setOrigPriceError('');
                  if (v && sellingPrice) validatePrice(v, sellingPrice);
                  else setPriceError('');
                }}
                placeholder="20"
                placeholderTextColor={theme.colors.muted}
                keyboardType="numeric"
              />
              {origPriceError !== '' && <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 4 }}>{origPriceError}</Text>}
            </View>
            <View style={styles.halfField}>
              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm }}>
                {t('business.createBasket.discountedPrice')} *
              </Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: theme.colors.surface,
                  borderColor: (priceError || sellingPriceError) ? theme.colors.error : theme.colors.divider,
                  borderRadius: theme.radii.r12,
                  color: theme.colors.textPrimary,
                  ...theme.typography.body,
                  ...theme.shadows.shadowSm,
                }]}
                value={sellingPrice}
                onChangeText={(v) => {
                  setSellingPrice(v);
                  if (v.trim()) setSellingPriceError('');
                  if (originalPrice && v) validatePrice(originalPrice, v);
                  else setPriceError('');
                }}
                placeholder="10"
                placeholderTextColor={theme.colors.muted}
                keyboardType="numeric"
              />
              {sellingPriceError !== '' && <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 4 }}>{sellingPriceError}</Text>}
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.spacing.sm, marginTop: -theme.spacing.sm, paddingHorizontal: 2 }}>
            <AlertCircle size={12} color={theme.colors.accentWarm} style={{ marginTop: 1 }} />
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginLeft: 6, flex: 1, lineHeight: 15 }}>
              {t('business.createBasket.priceHint', { defaultValue: 'Le prix réduit doit être au moins 50% inférieur au prix original.' })}
            </Text>
          </View>

          {priceError !== '' && (
            <View style={[styles.errorRow, { marginBottom: theme.spacing.lg, marginTop: -theme.spacing.xs }]}>
              <AlertCircle size={14} color={theme.colors.error} />
              <Text style={[{ color: theme.colors.error, ...theme.typography.caption, marginLeft: 6, flex: 1 }]}>
                {priceError}
              </Text>
            </View>
          )}

          {/* Quantity / daily reset. The walkthrough highlight wraps only
              the +/- + input row (not the label or the optional per-day
              schedule) so the user sees a tight halo on the actual control.
              `captureFieldY` on the outer wrapper records this field's Y in
              the scroll content so the walkthrough can auto-scroll to it. */}
          <View
            style={[styles.field, { marginBottom: theme.spacing.xl }]}
            onLayout={captureFieldY('formDailyReset')}
          >
            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm }}>
              {isEditing
                ? t('business.baskets.defaultQty', { defaultValue: 'Réinit. journalière' })
                : t('business.availability.quantity', { defaultValue: 'Quantité' })}{!isEditing ? ' *' : ''}
            </Text>
            {/* NOTE: deliberately NO `onLayout={measureRect(...)}` here.
                The form mounts with the qty row potentially below the fold
                (scrollY=0). If we measured then, the rect would point to a
                wrong screen position, and the overlay would paint the halo
                there for one frame before the auto-scroll effect re-measures.
                The auto-scroll effect (tryMeasure) is the sole publisher for
                this rect, AFTER scrolling has landed. */}
            <View
              ref={reinitCardRef as any}
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <TouchableOpacity
                onPress={() => setQuantity(Math.max(0, quantity - 1))}
                style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Minus size={16} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <TextInput
                style={[{
                  flex: 1, textAlign: 'center', backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r12, color: theme.colors.textPrimary,
                  ...theme.typography.h3, height: 42, marginHorizontal: 12,
                  borderWidth: 1, borderColor: theme.colors.divider,
                }]}
                value={String(quantity)}
                onChangeText={(v) => { const n = parseInt(v); if (!isNaN(n) && n >= 0) setQuantity(n); }}
                keyboardType="number-pad"
              />
              <TouchableOpacity
                onPress={() => setQuantity(quantity + 1)}
                style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Plus size={16} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Same for all days checkbox + per-day schedule — only when editing */}
            {isEditing && (
            <View style={{ marginTop: theme.spacing.md }}>
              <TouchableOpacity
                onPress={() => {
                  const next = !sameAllDays;
                  setSameAllDays(next);
                  if (next) {
                    const reset: Record<string, number> = {};
                    DAYS.forEach(d => { reset[d] = quantity; });
                    setDaySchedule(reset);
                  }
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}
              >
                {sameAllDays ? (
                  <SquareCheck size={20} color={theme.colors.primary} />
                ) : (
                  <Square size={20} color={theme.colors.muted} />
                )}
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                  {t('business.baskets.sameAllDays', { defaultValue: 'Même pour tous les jours' })}
                </Text>
              </TouchableOpacity>

              {!sameAllDays && (
                <View style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: 12, gap: 8 }}>
                  {DAYS.map((day) => (
                    <View key={day} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{
                        width: 42, height: 28, borderRadius: 8,
                        backgroundColor: daySchedule[day] > 0 ? theme.colors.primary + '18' : theme.colors.divider,
                        justifyContent: 'center', alignItems: 'center',
                      }}>
                        <Text style={{
                          color: daySchedule[day] > 0 ? theme.colors.primary : theme.colors.muted,
                          ...theme.typography.bodySm, fontWeight: '700',
                        }}>
                          {DAY_LABELS[day]}
                        </Text>
                      </View>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, flex: 1, marginLeft: 10 }}>
                        {t(`business.baskets.days.${day}`, { defaultValue: day.charAt(0).toUpperCase() + day.slice(1) })}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity
                          onPress={() => setDaySchedule(prev => ({ ...prev, [day]: Math.max(0, prev[day] - 1) }))}
                          style={{ backgroundColor: theme.colors.surface, borderRadius: 6, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' }}
                        >
                          <Minus size={12} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginHorizontal: 10, minWidth: 18, textAlign: 'center' }}>
                          {daySchedule[day]}
                        </Text>
                        <TouchableOpacity
                          onPress={() => setDaySchedule(prev => ({ ...prev, [day]: prev[day] + 1 }))}
                          style={{ backgroundColor: theme.colors.surface, borderRadius: 6, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' }}
                        >
                          <Plus size={12} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
            )}
          </View>

          {/* Max Per Customer — only shown when editing */}
          {isEditing && FeatureFlags.ENABLE_MAX_PER_CUSTOMER && (
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm }}>
              {t('business.baskets.maxPerCustomer', { defaultValue: 'Max par client' })}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => setMaxPerCustomer(Math.max(1, maxPerCustomer - 1))}
                style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Minus size={16} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <TextInput
                style={[{
                  flex: 1, textAlign: 'center', backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r12, color: theme.colors.textPrimary,
                  ...theme.typography.h3, height: 42, marginHorizontal: 12,
                  borderWidth: 1, borderColor: theme.colors.divider,
                }]}
                value={String(maxPerCustomer)}
                onChangeText={(v) => { const n = parseInt(v); if (!isNaN(n) && n >= 1) setMaxPerCustomer(n); }}
                keyboardType="number-pad"
              />
              <TouchableOpacity
                onPress={() => setMaxPerCustomer(maxPerCustomer + 1)}
                style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Plus size={16} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
          )}

          {/* Old duplicate reinit section removed — merged into Quantity section above */}

          {/* Custom Pickup Time Toggle + Pickers. The walkthrough highlight
              wraps only the toggle row (not the title text or the conditional
              time pickers) — the user just needs to know whether to enable
              custom pickup times. `captureFieldY` on the outer wrapper records
              this field's Y in the scroll content for auto-scroll. */}
          <View
            style={[styles.field, { marginBottom: theme.spacing.xl }]}
            onLayout={captureFieldY('formPickupTime')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.sm }}>
              <Clock size={14} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginLeft: 6 }}>
                {t('basket.pickupWindow')}
              </Text>
            </View>

            {/* Toggle: use custom pickup times. The walkthrough ref lives on
                a View WRAPPER (not the TouchableOpacity itself) because
                measureInWindow is only guaranteed on native View refs;
                TouchableOpacity's forwarded ref didn't reliably expose it,
                so the cutout never received a measurement.
                NOTE: deliberately NO `onLayout={measureRect(...)}` here —
                the auto-scroll effect is the sole publisher for this rect,
                AFTER scrolling has landed (otherwise the initial below-fold
                position would leak into the cutout for one frame). */}
            <View
              ref={pickupCardRef as any}
            >
              <TouchableOpacity
                onPress={() => {
                  const next = !useBusinessHours;
                  setUseBusinessHours(next);
                  if (next) {
                    // Snapping back to the location's hours when the user
                    // re-checks "use location hours" so the displayed default
                    // line under the checkbox shows fresh values.
                    setPickupStart(locationDefaultStart);
                    setPickupEnd(locationDefaultEnd);
                  }
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: useBusinessHours ? 0 : theme.spacing.md }}
              >
                {useBusinessHours ? (
                  <SquareCheck size={20} color={theme.colors.primary} />
                ) : (
                  <Square size={20} color={theme.colors.muted} />
                )}
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                  {t('business.createBasket.useBusinessHours', { defaultValue: 'Utiliser les horaires du commerce' })}
                </Text>
              </TouchableOpacity>
            </View>
            {useBusinessHours && (
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 4 }}>
                {t('business.createBasket.usingLocationDefault', { defaultValue: 'Créneau par défaut du commerce' })}: {locationDefaultStart} - {locationDefaultEnd}
              </Text>
            )}

            {/* Daily-reset notice — visible in BOTH inherited and custom
                hours branches. The merchant needs to know that 03:30 is
                when their basket stock refills back to the daily reinit
                quantity; it's the rationale for the cross-reset rule
                below AND the answer to "why is my basket suddenly full
                again at 3am?". */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 }}>
              <Clock size={11} color={theme.colors.muted} style={{ marginTop: 2 }} />
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, flex: 1, lineHeight: 15 }}>
                {t('business.createBasket.dailyResetNotice', {
                  time: '03:30',
                  defaultValue: 'Les paniers sont réinitialisés à leur quantité quotidienne chaque jour à {{time}} (heure tunisienne).',
                })}
              </Text>
            </View>

            {/* Pickup time pickers — only when the checkbox is UNchecked
                (i.e. user has opted out of inheriting the location's hours). */}
            {!useBusinessHours && (
            <>
            <Text style={{ ...theme.typography.caption, marginBottom: 6, color: theme.colors.muted, marginTop: theme.spacing.md }}>
              {t('business.baskets.shopHoursReference', { defaultValue: 'Horaires du commerce' })}: {locationDefaultStart} - {locationDefaultEnd}
            </Text>
            {/* Cross-reset hint — same copy as the location-hours editors. */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
              <Clock size={11} color={theme.colors.muted} style={{ marginTop: 2 }} />
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, flex: 1, lineHeight: 15 }}>
                {t('business.availability.crossResetHint', {
                  defaultValue: 'Le créneau ne doit pas traverser 03:30 (réinitialisation quotidienne). Commencez ≥ 03:30 ou terminez ≤ 03:29.',
                })}
              </Text>
            </View>
            <View style={styles.row}>
              {/* Start */}
              <View style={[styles.halfField, { marginRight: theme.spacing.md }]}>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 4 }}>
                  {t('business.availability.pickupStart')}
                </Text>
                <TimePicker
                  value={pickupStart}
                  onChange={setPickupStart}
                  primaryColor={theme.colors.primary}
                  textColor={theme.colors.textPrimary}
                  bgColor={theme.colors.surface}
                  mutedColor={theme.colors.muted}
                />
              </View>
              {/* End */}
              <View style={styles.halfField}>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 4 }}>
                  {t('business.availability.pickupEnd')}
                </Text>
                <TimePicker
                  value={pickupEnd}
                  onChange={setPickupEnd}
                  primaryColor={theme.colors.primary}
                  textColor={theme.colors.textPrimary}
                  bgColor={theme.colors.surface}
                  mutedColor={theme.colors.muted}
                />
              </View>
            </View>
            </>
            )}
          </View>

          {/* Pickup Instructions */}
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm }}>
              {t('business.createBasket.pickupInstructions', { defaultValue: 'Instructions de retrait' })}
            </Text>
            <TouchableOpacity
              onPress={() => setUseDefaultPickupInstructions((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: theme.spacing.md }}
            >
              {useDefaultPickupInstructions ? (
                <SquareCheck size={20} color={theme.colors.primary} />
              ) : (
                <Square size={20} color={theme.colors.muted} />
              )}
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>
                {t('business.createBasket.useDefaultInstructions', { defaultValue: 'Utiliser celles du commerce' })}
              </Text>
            </TouchableOpacity>
            {!useDefaultPickupInstructions && (
              <TextInput
                style={[
                  styles.textArea,
                  {
                    color: theme.colors.textPrimary,
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                    borderRadius: theme.radii.r12,
                    ...theme.typography.body,
                    minHeight: 80,
                  },
                ]}
                value={pickupInstructions}
                onChangeText={setPickupInstructions}
                placeholder={t('business.createBasket.pickupInstructionsPlaceholder', { defaultValue: 'Ex: Sonnez à l\'entrée arrière' })}
                placeholderTextColor={theme.colors.muted}
                multiline
                textAlignVertical="top"
              />
            )}
            {useDefaultPickupInstructions && profileQuery.data?.pickup_instructions ? (
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, fontStyle: 'italic', marginTop: 4 }}>
                {profileQuery.data.pickup_instructions as string}
              </Text>
            ) : null}
          </View>

          {/* Menu Items — yes/no toggle (feature-flagged) */}
          {FeatureFlags.ENABLE_MENU_ITEMS && <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm }}>
              {t('business.createBasket.showMenuItems', { defaultValue: 'Afficher les articles du menu ?' })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: theme.spacing.md }}>
              <TouchableOpacity
                onPress={() => setShowMenuItems(true)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: theme.radii.r12,
                  alignItems: 'center',
                  backgroundColor: showMenuItems ? theme.colors.primary : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: showMenuItems ? theme.colors.primary : theme.colors.divider,
                }}
              >
                <Text style={{ color: showMenuItems ? '#fff' : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                  {t('common.yes', { defaultValue: 'Yes' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowMenuItems(false)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: theme.radii.r12,
                  alignItems: 'center',
                  backgroundColor: !showMenuItems ? theme.colors.primary : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: !showMenuItems ? theme.colors.primary : theme.colors.divider,
                }}
              >
                <Text style={{ color: !showMenuItems ? '#fff' : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                  {t('common.no', { defaultValue: 'No' })}
                </Text>
              </TouchableOpacity>
            </View>

            {showMenuItems && (
              <>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.md }}>
                  {t('business.createBasket.menuItemsWithPicsDesc', { defaultValue: 'Only items with photos will be shown to customers' })}
                </Text>
                {menuItemsQuery.isLoading ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (() => {
                  const itemsWithPics = (menuItemsQuery.data ?? []).filter((i: MenuItemFromAPI) => !!i.image_url);
                  if (itemsWithPics.length === 0) {
                    return (
                      <View style={{ alignItems: 'center' as const, paddingVertical: theme.spacing.lg }}>
                        <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center' as const, marginBottom: theme.spacing.md }}>
                          {t('business.createBasket.noMenuItemsWithPics', { defaultValue: 'No menu items with photos yet — add photos in Menu Items' })}
                        </Text>
                        <TouchableOpacity
                          onPress={() => router.push('/business/menu-items' as never)}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: theme.colors.primary + '12',
                            borderRadius: theme.radii.r12,
                            paddingHorizontal: theme.spacing.lg,
                            paddingVertical: theme.spacing.md,
                            borderWidth: 1,
                            borderColor: theme.colors.primary + '30',
                          }}
                        >
                          <Plus size={16} color={theme.colors.primary} />
                          <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 6 }}>
                            {t('business.createBasket.goToMenuItems', { defaultValue: 'Go to Menu Items' })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }
                  return (
                    <View>
                      {itemsWithPics.map((item: MenuItemFromAPI) => {
                        const isSelected = selectedMenuItemIds.includes(item.id);
                        return (
                          <TouchableOpacity
                            key={item.id}
                            onPress={() => toggleMenuItem(item.id)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              backgroundColor: isSelected ? theme.colors.primary + '10' : theme.colors.surface,
                              borderRadius: theme.radii.r12,
                              padding: theme.spacing.md,
                              marginBottom: theme.spacing.sm,
                              borderWidth: isSelected ? 1.5 : 1,
                              borderColor: isSelected ? theme.colors.primary : theme.colors.divider,
                              ...theme.shadows.shadowSm,
                            }}
                          >
                            {isSelected ? (
                              <SquareCheck size={20} color={theme.colors.primary} />
                            ) : (
                              <Square size={20} color={theme.colors.muted} />
                            )}
                            <Text
                              style={{
                                color: theme.colors.textPrimary,
                                ...theme.typography.body,
                                flex: 1,
                                marginLeft: theme.spacing.md,
                              }}
                              numberOfLines={2}
                            >
                              {item.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      {selectedMenuItemIds.length > 0 && (
                        <Text style={{ color: theme.colors.primary, ...theme.typography.caption, marginTop: theme.spacing.xs }}>
                          {t('business.createBasket.menuItemsSelected', {
                            count: selectedMenuItemIds.length,
                            defaultValue: `${selectedMenuItemIds.length} item(s) selected`,
                          })}
                        </Text>
                      )}
                    </View>
                  );
                })()}
              </>
            )}
          </View>}

          {/* "Use for all locations" — surfaces for any admin/owner.
              Rendered as a TOP-LEVEL section (not nested under the
              feature-flagged menu-items block) so its visibility is
              independent of ENABLE_MENU_ITEMS. Wrapped in a bordered
              card so it reads as a distinct section, but with NO
              extra horizontal margin (the ScrollView's padding is the
              only outer offset) and the inner checkbox row keeps the
              same row/gap rhythm as the other checkboxes above. */}
          {showAllLocationsToggle && (
            <>
              {/* Divider — marks this toggle as a distinct section while
                  keeping the checkbox row at the SAME left edge as every other
                  form field (no card padding inset). */}
              <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: theme.spacing.lg }} />
              <TouchableOpacity
                onPress={() => setUseForAllLocations((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                {useForAllLocations ? (
                  <SquareCheck size={20} color={theme.colors.primary} />
                ) : (
                  <Square size={20} color={theme.colors.muted} />
                )}
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1, fontFamily: 'Poppins_600SemiBold' }}>
                  {t('business.createBasket.useForAllLocations', { defaultValue: 'Disponible dans tous les emplacements' })}
                </Text>
              </TouchableOpacity>
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 4, marginLeft: 30 }}>
                {t('business.createBasket.useForAllLocationsHint', {
                  count: orgLocations.length,
                  defaultValue: `Crée une copie de ce panier dans chacun des ${orgLocations.length} emplacements de l'organisation.`,
                })}
              </Text>
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
          {/* Full-width + flat (no shadow). Earlier the centered + shadowed
              version made the user perceive a "padding under the button"
              because the elevation/shadow tail extended ~9 px past the
              button's layout box, and the walkthrough halo (at button
              bounds) didn't cover that tail. With `flat` the shadow is
              gone, with `fullWidth` the layout box is deterministic
              (always SCREEN_W − 2 × paddingHorizontal). innerRef points
              the measurement at the inner TouchableOpacity itself, so
              the halo lands exactly on the visible button. */}
          <PrimaryCTAButton
            innerRef={confirmBtnRef}
            onInnerLayout={measureRect(confirmBtnRef, 'formConfirmBtn')}
            fullWidth
            flat
            onPress={handleSave}
            title={isEditing ? t('business.createBasket.save') : t('business.createBasket.create')}
            loading={isPending}
            disabled={(!!priceError || isPending) && !demoBasketActive}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Zero quantity warning modal */}
      <Modal visible={showZeroQtyWarning} transparent animationType="fade" onRequestClose={() => setShowZeroQtyWarning(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ backgroundColor: '#eff35c22', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <AlertCircle size={28} color="#b8a600" />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('business.createBasket.zeroQtyTitle', { defaultValue: 'Quantité à 0' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {t('business.createBasket.zeroQtyMsg', { defaultValue: 'La quantité quotidienne est à 0. Le panier ne sera pas visible par les clients. Continuer ?' })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={() => setShowZeroQtyWarning(false)}
                style={{ flex: 1, backgroundColor: theme.colors.bg, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>
                  {t('common.cancel', { defaultValue: 'Annuler' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowZeroQtyWarning(false); if (isEditing) updateMutation.mutate(); else createMutation.mutate(); }}
                style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                  {t('common.confirm', { defaultValue: 'Confirmer' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Walkthrough overlay — renders pickup/reinit/confirm highlights on
          this pushed Stack screen (the (business) layout's overlay sits
          underneath in the Stack so it would otherwise be invisible here). */}
      <SubScreenWalkthroughOverlay keys={['formPickupTime', 'formDailyReset', 'formConfirmBtn']} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  form: { flex: 1 },
  field: {},
  label: {},
  input: { height: 52, borderWidth: 1, paddingHorizontal: 16 },
  textArea: { minHeight: 100, borderWidth: 1, paddingHorizontal: 16, paddingTop: 14 },
  row: { flexDirection: 'row' },
  halfField: { flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center' },
  footer: {},
});
