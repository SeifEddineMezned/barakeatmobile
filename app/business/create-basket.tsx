import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Image,
  TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Modal, Animated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle, Clock, Minus, Plus, Sparkles, SquareCheck, Square, Camera, Lightbulb } from 'lucide-react-native';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';
import * as ImagePicker from 'expo-image-picker';
import { ensureCameraAccess } from '@/src/lib/photoPermission';
import { useImageCropper } from '@/src/components/ImageCropper';
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
import { getErrorMessage, apiClient, makeAttemptKey } from '@/src/lib/api';
import { verifyOrAlarm, createVerifyAppeared } from '@/src/hooks/useVerifyOnError';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { fetchMyContext, fetchOrganizationDetails, type OrgDetailsFromAPI } from '@/src/services/teams';
import { validateBizDayWindow, effectiveLocationHours } from '@/src/utils/timezone';
import { effectiveDailyReinit } from '@/src/utils/dailyReinit';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useAiRefineStore } from '@/src/stores/aiRefineStore';
import { DEMO_BASKET_PHOTOS } from '@/src/lib/demoData';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';

export default function CreateBasketScreen() {
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { t, i18n } = useTranslation();
  const { pickAndCrop } = useImageCropper();
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
  // AI-improved multilingual variants. Null = no AI version (the plain text is
  // the single source). Set when the merchant accepts an AI suggestion; cleared
  // when they edit the text by hand afterwards (so we never submit a stale
  // translation that no longer matches the visible text).
  const [descriptionI18n, setDescriptionI18n] = useState<Record<string, string> | null>(
    ((apiBasket as any)?.description_i18n as Record<string, string>) ?? null
  );
  const [pickupInstrI18n, setPickupInstrI18n] = useState<Record<string, string> | null>(
    ((apiBasket as any)?.pickup_instructions_i18n as Record<string, string>) ?? null
  );
  // Which field currently has an AI improve request in flight ('description' |
  // 'pickup_instructions' | null), plus the pending suggestion to preview.
  const [aiImproveField, setAiImproveField] = useState<null | 'description' | 'pickup_instructions'>(null);
  const [aiPreview, setAiPreview] = useState<null | { field: 'description' | 'pickup_instructions'; fr: string; en: string; ar: string; hint: string }>(null);
  // Interactive description refinement runs on its own full-screen page
  // (app/business/refine-description.tsx) so the answer field + keyboard have
  // room. We hand the starting text over via this store and pick the accepted
  // result back up below.
  const setRefineInput = useAiRefineStore((s) => s.setInput);
  const refineResult = useAiRefineStore((s) => s.result);
  const clearRefine = useAiRefineStore((s) => s.clear);
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
  // Initial value covers two cases:
  //   • New basket → user starts at 0 and dials it up via +/− or text input.
  //   • Resumed create (cached store) → the in-progress quantityTotal.
  // EDIT mode is intentionally NOT seeded here from `apiBasket.quantity` —
  // that column is the LIVE inventory (decrements as orders come in), not
  // the saved daily reinit value. Edit mode is populated from
  // `effectiveDailyReinit(apiBasket)` in the useEffect below once the API
  // basket lands, so the value the merchant sees in the "Réinit. journalière"
  // field matches what the cron will reset to each morning.
  const [quantity, setQuantity] = useState(storeBasket?.quantityTotal ?? 0);
  const [maxPerCustomer, setMaxPerCustomer] = useState<number>(
    (apiBasket as any)?.max_per_customer ?? (storeBasket as any)?.maxPerCustomer ?? 5
  );

  // ── Daily reinit schedule (shown in BOTH create and edit modes so the
  // forms render identically — the user explicitly asked for parity).
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const DAY_LABELS: Record<string, string> = { mon: 'LUN', tue: 'MAR', wed: 'MER', thu: 'JEU', fri: 'VEN', sat: 'SAM', sun: 'DIM' };
  const [sameAllDays, setSameAllDays] = useState(true);
  const [daySchedule, setDaySchedule] = useState<Record<string, number>>({ mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 });
  // Flag set in handleSave when the merchant confirms the "all per-day
  // values are identical — collapse to single value?" warning. After the
  // state collapse (setSameAllDays(true) + setQuantity(commonValue))
  // commits, the effect below fires the actual save. We can't call the
  // mutation directly inside the warning's onPress because the mutation's
  // mutationFn captures sameAllDays/quantity via closure at render time;
  // those captures wouldn't see the just-issued setState updates without
  // a re-render in between.
  const pendingCollapseSaveRef = useRef(false);
  // Fade the global quantity picker when the user unchecks "Même pour tous
  // les jours" — at that point the per-day schedule below is the source of
  // truth and the global counter no longer drives anything, so dimming it
  // (and disabling its touch surface) signals "this control is inactive
  // right now". 180 ms easing roughly matches the schedule row's mount.
  const qtyPickerOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(qtyPickerOpacity, {
      toValue: sameAllDays ? 1 : 0.35,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [sameAllDays, qtyPickerOpacity]);

  // Fires the save after the per-day → single-value collapse confirmed by the
  // warning popup in handleSave has actually committed to state. Trigger is
  // a sameAllDays false → true transition driven only by that warning's
  // onPress (the ref guards against any other path flipping the same flag).
  useEffect(() => {
    if (!pendingCollapseSaveRef.current) return;
    if (!sameAllDays) return;
    pendingCollapseSaveRef.current = false;
    if (isEditing) {
      updateMutation.mutate({});
    } else {
      createMutation.mutate();
    }
    // updateMutation / createMutation / isEditing intentionally omitted from
    // deps — the effect must only react to the sameAllDays transition; the
    // mutations are stable refs from useMutation and the editing mode is set
    // once at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sameAllDays]);

  // Same fade pattern as the quantity picker — used by the pickup-time
  // pickers and the pickup-instructions editor, both of which now sit ABOVE
  // their "use location values" checkbox. When the box is checked we still
  // render the control (pre-filled with the location's values) but dim +
  // lock it, so the user can see what they're inheriting at a glance.
  // The matching useEffects that drive these values live AFTER the two
  // checkbox state declarations (search "pickupPickerOpacity sync effect").
  const pickupPickerOpacity = useRef(new Animated.Value(1)).current;
  const instructionsOpacity = useRef(new Animated.Value(1)).current;
  // "Voir plus" toggle for the location-default pickup instructions preview.
  const [defaultInstructionsExpanded, setDefaultInstructionsExpanded] = useState(false);

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

  // The location's effective hours for TODAY (per-day weekly_schedule wins over
  // the flat widest span). Drives the "use business hours" default text and the
  // custom-picker seed so the form reflects the current day's window. Resolved
  // client-side because /my/profile returns the RAW flat hours (the editors that
  // read it save it back, so the backend must not pre-resolve them).
  const todayLocHours = effectiveLocationHours(profileQuery.data as any);

  // Pickup times: use basket-specific times if editing, else today's location hours
  const defaultStart =
    apiBasket?.pickup_start_time?.substring(0, 5) ??
    (todayLocHours.start || undefined) ??
    '18:00';
  const defaultEnd =
    apiBasket?.pickup_end_time?.substring(0, 5) ??
    (todayLocHours.end || undefined) ??
    '19:00';

  const [pickupStart, setPickupStart] = useState(defaultStart);
  const [pickupEnd, setPickupEnd] = useState(defaultEnd);

  const [showZeroQtyWarning, setShowZeroQtyWarning] = useState(false);

  // Custom pickup time toggle — if OFF, basket uses location's default pickup times
  const locationDefaultStart = todayLocHours.start || '18:00';
  const locationDefaultEnd = todayLocHours.end || '19:00';
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
  // Block the X close button while the walkthrough is running so a stray
  // tap can't pop the route mid-demo and orphan the SubScreenOverlay.
  const inWalkthrough = useWalkthroughStore((s) => s.step !== null);
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
        // Per design request, the pickup-time and daily-reset card
        // halos both want VISIBLE breathing room — they don't trace
        // the element border, they highlight the whole control area
        // around it. 28 px clears the TimePicker / quantity-stepper
        // edges with a clear visible margin all the way around. The
        // confirm-button step stays flush (pad 0) — its halo is the
        // pill cutout that already hugs the CTA.
        const pad = (key === 'formPickupTime' || key === 'formDailyReset') ? 28 : 0;
        // Reject mid-push measurements that land off-screen — the form is
        // pushed onto the Stack with a slide-in animation, and the first
        // onLayout can fire while the screen is still translating in from
        // the right edge (so x ≈ SW). Persisting that captured-mid-slide
        // rect makes the next step's overlay paint its cutout off-screen,
        // leaving the user with full dim and no visible halo. The form's
        // step-entry effect runs a second measurement pass that publishes
        // the correct on-screen rect once the push settles.
        const SW = Dimensions.get('window').width;
        const SH = Dimensions.get('window').height;
        const onScreen = x + w > 0 && y + h > 0 && x < SW && y < SH;
        if (w > 0 && h > 0 && onScreen) setMeasuredRect(key, {
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
    //
    // EXCEPTION: formConfirmBtn lives in a fixed footer that DOESN'T scroll
    // or move between steps. Wiping its rect just creates a 500 ms window
    // where the overlay paints dim-only + falls back to the bottom-of-
    // screen target — which the user perceives as "the form clears and the
    // halo covers the navbar" because the form behind goes dark and the
    // fallback pill lands where the (business) tab bar would sit if they
    // were back on /my-baskets. For this step we KEEP the existing valid
    // rect so the overlay paints continuously at the right position; the
    // re-measure pass below still runs as cheap insurance against a stale
    // initial onLayout (push-animation transient y).
    if (stepAtFire !== 'formConfirmBtn') {
      setMeasuredRect(stepAtFire as any, null);
    }

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
        // Reject measurements that land outside the visible viewport —
        // those typically come from a mid-push frame where the screen is
        // still translating in from the right edge. Without this guard,
        // an off-screen rect (e.g. x ≈ SW because the screen hasn't
        // finished sliding) gets persisted in the store, and on the next
        // step entry the overlay paints its cutout off-screen — leaving
        // the user with full dim and no visible halo (the "form clears"
        // symptom for the confirm-button step). Retry until the screen
        // settles into its on-screen frame.
        const SW = Dimensions.get('window').width;
        const SH = Dimensions.get('window').height;
        const onScreen = x + w > 0 && y + h > 0 && x < SW && y < SH;
        if (w > 0 && h > 0 && onScreen) {
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
      // EXCEPTION: formConfirmBtn doesn't scroll, so the 350 ms wait just
      // delays the corrected rect from landing — leaving the overlay
      // staring at a stale (push-transient, possibly off-screen) rect
      // for half a second. Fire immediately for it.
      const measureDelay = stepAtFire === 'formConfirmBtn' ? 0 : 350;
      timers.push(setTimeout(() => tryMeasure(0), measureDelay));
    };

    // Brief delay so any pending layout flush completes — also reduced to
    // 0 for formConfirmBtn so the first measure attempt lands within a
    // frame of step entry, before the SubScreen overlay's displayedStep
    // swap completes. Other steps still get the 150 ms beat because they
    // need to wait for the scroll to begin before measuring.
    const initialDelay = stepAtFire === 'formConfirmBtn' ? 0 : 150;
    timers.push(setTimeout(scrollAndMeasure, initialDelay));
    return () => { timers.forEach(clearTimeout); };
  }, [walkthroughCurrentStep?.measureKey]);

  // Clear the form's published measureRects on unmount. Without this, the
  // confirm-button submit's `router.replace('/(business)/my-baskets')`
  // pops this screen — but its `formConfirmBtn` rect lingers in the
  // walkthrough store, and the underlying BizOverlay (which has been
  // mounted underneath the pushed Stack screen the whole time) takes
  // over the display still on `displayedStep = formConfirmBtn`, then
  // paints a halo at that stale rect over the tab bar at the bottom of
  // /my-baskets — reading as "step 8 flashes again before advancing".
  // Clearing the rects forces BizOverlay's render to the dim-only
  // fallback during the ~180 ms it takes for `advanceOnPath` to fire
  // and the displayedStep to flip to step 9 (demoBasketCard).
  useEffect(() => {
    return () => {
      setMeasuredRect('formPickupTime', null);
      setMeasuredRect('formDailyReset', null);
      setMeasuredRect('formConfirmBtn', null);
    };
  }, [setMeasuredRect]);

  // Business image pickers go DIRECTLY to the photo library — the "take
  // photo" option has been removed from every business surface (basket,
  // logo, cover, menu items, location). Customer-side surfaces (review,
  // report basket) still keep the camera option because the photo IS the
  // proof. The previous take-photo / choose-gallery action sheet for the
  // basket photo lives in git history if it ever needs to come back.
  const pickBasketImage = async () => {
    const uri = await pickAndCrop({ aspect: [4, 3], quality: 0.7 });
    if (uri) setBasketImageUri(uri);
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

  // The app's active language, narrowed to one of the 3 supported codes. Used
  // to decide which of the AI trio to drop into the visible textbox on accept
  // and to preview, so the merchant sees the suggestion in the language they're
  // working in.
  const previewLang: 'fr' | 'en' | 'ar' = (() => {
    const code = (i18n.language || 'fr').slice(0, 2);
    return code === 'en' || code === 'ar' ? code : 'fr';
  })();

  // Language codes shown in the "Traduit en …" note. Arabic is omitted while
  // it's disabled in feature flags (the translation is still stored, it's just
  // not surfaced to users yet), so the note matches what's actually selectable.
  const translatedLangsLabel = ['FR', 'EN', ...(FeatureFlags.LANGUAGES_AR_ENABLED ? ['AR'] : [])].join(' · ');

  // AI improve + translate for a free-text field. Sends the merchant's typed
  // text to /ai-improve; the result (an {fr,en,ar} trio) is staged in aiPreview
  // for confirmation rather than applied directly, so the merchant always
  // reviews before it replaces their text.
  const handleAIImprove = async (field: 'description' | 'pickup_instructions') => {
    const sourceText = (field === 'description' ? description : pickupInstructions).trim();
    if (!sourceText) {
      alert.showAlert(
        t('business.createBasket.aiImproveEmptyTitle', { defaultValue: 'Rien à améliorer' }),
        t('business.createBasket.aiImproveEmptyBody', { defaultValue: "Écrivez d'abord votre texte, puis appuyez sur Améliorer." }),
      );
      return;
    }
    setAiImproveField(field);
    try {
      const response = await apiClient.post('/api/baskets/ai-improve', {
        text: sourceText,
        field,
        category: profileQuery.data?.category,
      });
      const data = response.data as { fr?: string; en?: string; ar?: string; hint?: string };
      setAiPreview({
        field,
        fr: data.fr || sourceText,
        en: data.en || sourceText,
        ar: data.ar || sourceText,
        hint: data.hint || '',
      });
    } catch (err: any) {
      if (err?.response?.status === 429) {
        alert.showAlert(
          t('business.createBasket.aiLimitTitle', { defaultValue: 'Limite atteinte' }),
          err?.response?.data?.message
            || t('business.createBasket.aiLimitBody', { defaultValue: "Vous avez atteint votre limite de suggestions IA pour aujourd'hui. Réessayez demain." }),
        );
      } else {
        alert.showAlert(t('common.error'), getErrorMessage(err));
      }
    } finally {
      setAiImproveField(null);
    }
  };

  // Apply the staged AI suggestion: drop the merchant-language variant into the
  // visible textbox and keep the full trio for submission.
  const acceptAiSuggestion = () => {
    if (!aiPreview) return;
    const trio = { fr: aiPreview.fr, en: aiPreview.en, ar: aiPreview.ar };
    if (aiPreview.field === 'description') {
      setDescription(trio[previewLang]);
      setDescriptionI18n(trio);
      setDescError('');
    } else {
      setPickupInstructions(trio[previewLang]);
      setPickupInstrI18n(trio);
      setUseDefaultPickupInstructions(false);
    }
    setAiPreview(null);
  };

  // ── Interactive description refinement (Q&A) ───────────────────────────────
  // Apply the refined description handed back by the full-screen refine page.
  useEffect(() => {
    if (!refineResult) return;
    setDescription(refineResult[previewLang]);
    setDescriptionI18n(refineResult);
    setDescError('');
    clearRefine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refineResult]);

  // Description "Améliorer" entry point: hand the text to the refine page.
  const handleAIRefineStart = () => {
    const sourceText = description.trim();
    if (!sourceText) {
      alert.showAlert(
        t('business.createBasket.aiImproveEmptyTitle', { defaultValue: 'Rien à améliorer' }),
        t('business.createBasket.aiImproveEmptyBody', { defaultValue: "Écrivez d'abord votre texte, puis appuyez sur Améliorer." }),
      );
      return;
    }
    setRefineInput({ description: sourceText, title: name.trim(), category: (profileQuery.data as any)?.category });
    router.push('/business/refine-description' as never);
  };

  // When the merchant switches the app language, swap any AI-translated field to
  // the matching variant so the visible text follows the active language. Only
  // runs when an AI trio exists (a hand-typed field, where descriptionI18n /
  // pickupInstrI18n is null, is left exactly as the merchant wrote it).
  useEffect(() => {
    if (descriptionI18n && descriptionI18n[previewLang]) setDescription(descriptionI18n[previewLang]);
    if (pickupInstrI18n && pickupInstrI18n[previewLang]) setPickupInstructions(pickupInstrI18n[previewLang]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewLang]);

  // Update pickup times when profile/baskets load (only if not yet modified by user)
  React.useEffect(() => {
    if (!isEditing && profileQuery.data) {
      const eff = effectiveLocationHours(profileQuery.data as any);
      if (eff.start) setPickupStart(eff.start);
      if (eff.end) setPickupEnd(eff.end);
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
    const eff = effectiveLocationHours(profileQuery.data as any);
    if (eff.start && eff.start !== pickupStart) setPickupStart(eff.start);
    if (eff.end && eff.end !== pickupEnd) setPickupEnd(eff.end);
  }, [useBusinessHours, profileQuery.data?.pickup_start_time, profileQuery.data?.pickup_end_time, (profileQuery.data as any)?.weekly_schedule]);

  // pickupPickerOpacity sync effect — fades the time-picker row when the
  // "Utiliser les horaires du commerce" checkbox is on. The pickers stay
  // mounted (pre-filled with the inherited values) so the user sees what
  // they'll inherit at a glance; the dim + pointerEvents lock signals
  // "read-only right now". Lives down here (not next to the Animated.Value
  // ref above) because it depends on `useBusinessHours`, which is declared
  // further down in the component body and would be in the TDZ up top.
  useEffect(() => {
    Animated.timing(pickupPickerOpacity, {
      toValue: useBusinessHours ? 0.35 : 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [useBusinessHours, pickupPickerOpacity]);
  // Same pattern for the pickup-instructions editor.
  useEffect(() => {
    Animated.timing(instructionsOpacity, {
      toValue: useDefaultPickupInstructions ? 0.4 : 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [useDefaultPickupInstructions, instructionsOpacity]);

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
      //
      // Apply the value even when it's 0 — a merchant who paused daily
      // replenishment for this basket explicitly saved 0 and re-opening
      // the form should surface that 0, not the live (today's-remaining)
      // count. The previous `initQty > 0` guard silently dropped the
      // legitimate 0 and the useState initializer's stale value won.
      const initQty = effectiveDailyReinit(apiBasket);
      if (Number.isFinite(initQty)) setQuantity(initQty);
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

  // Populate daily reinit schedule from API basket when editing.
  //
  // For the "same all days" fallback we read straight from
  // `daily_reinitialization_quantity` — NEVER the live `quantity` (which
  // decrements as orders come in) and NEVER a hardcoded 5. A value of 0
  // is a legitimate saved state (merchant paused daily replenishment) and
  // is preserved; if the column itself is missing/null we land on 0 too
  // (no replenishment) instead of a misleading "5".
  React.useEffect(() => {
    if (isEditing && apiBasket) {
      const schedule = (apiBasket as any)?.daily_reinit_schedule;
      if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
        setSameAllDays(false);
        setDaySchedule({ mon: schedule.mon ?? 0, tue: schedule.tue ?? 0, wed: schedule.wed ?? 0, thu: schedule.thu ?? 0, fri: schedule.fri ?? 0, sat: schedule.sat ?? 0, sun: schedule.sun ?? 0 });
      } else {
        setSameAllDays(true);
        const rawDaily = (apiBasket as any).daily_reinitialization_quantity;
        const qty = rawDaily == null ? 0 : Number(rawDaily);
        const safeQty = Number.isFinite(qty) ? qty : 0;
        setDaySchedule({ mon: safeQty, tue: safeQty, wed: safeQty, thu: safeQty, fri: safeQty, sat: safeQty, sun: safeQty });
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

  // Live validation of the EFFECTIVE pickup window — re-evaluated on every
  // pickupStart / pickupEnd / useBusinessHours flip. Status drives:
  //   - the hint text below the pickers (muted-grey default OR red error)
  //   - the Save button's disabled state (fades it the same way priceError
  //     does, matching the price-discount pattern the user requested).
  // When "use business hours" is checked we trust the location's already-
  // validated times and skip — the local pickers reflect those values but
  // aren't authoritative; the backend resolves NULL columns via COALESCE.
  const pickupWindowStatus = React.useMemo(
    () => (useBusinessHours ? 'ok' : validateBizDayWindow(pickupStart, pickupEnd)),
    [useBusinessHours, pickupStart, pickupEnd],
  );

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
      return { valid: false, error: t('business.baskets.endBeforeStart', { defaultValue: "L'heure de fin doit être différente de l'heure de début." }), start, end };
    }
    if (status === 'too-short') {
      return {
        valid: false,
        error: t('business.availability.tooShort', { defaultValue: 'Le créneau de retrait doit durer au moins 15 minutes.' }),
        start,
        end,
      };
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

  // Per-attempt idempotency key for the create POST. Minted lazily inside the
  // mutationFn on first submit; cleared on success so a follow-up "create
  // another basket" gets a fresh key. The form-state-change reset that
  // reserve.tsx uses isn't needed here because the create-basket form has
  // many inputs — a stale key surviving a typo edit and a re-submit would
  // ALWAYS resolve to the same row (which is the correct behavior: same
  // attempt, same target). The reset happens on submit-success and on a
  // genuine error you can recover from.
  const createAttemptKeyRef = useRef<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const effectiveStart = useBusinessHours ? locationDefaultStart : pickupStart;
      const effectiveEnd = useBusinessHours ? locationDefaultEnd : pickupEnd;
      const result = validatePickupTime(effectiveStart, effectiveEnd);
      if (!result.valid) {
        return Promise.reject(new Error(result.error));
      }
      if (!createAttemptKeyRef.current) createAttemptKeyRef.current = makeAttemptKey();
      const attemptKey = createAttemptKeyRef.current;
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
        // Send the daily reinit fields on CREATE too so the form behaves
        // identically to edit-mode — the user explicitly asked for parity.
        // The per-day schedule is serialized when "Même pour tous les jours"
        // is off, NULL otherwise (matches the edit-mode contract at line ~698).
        formData.append('daily_reinitialization_quantity', String(quantity));
        formData.append('daily_reinit_schedule', sameAllDays ? 'null' : JSON.stringify(daySchedule));
        formData.append('max_per_customer', String(maxPerCustomer));
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
        // AI multilingual variants — only sent when an AI version exists and
        // (for instructions) the merchant isn't inheriting the location's.
        if (descriptionI18n) formData.append('description_i18n', JSON.stringify(descriptionI18n));
        if (!useDefaultPickupInstructions && pickupInstrI18n) formData.append('pickup_instructions_i18n', JSON.stringify(pickupInstrI18n));
        if (selectedLocationId) formData.append('location_id', String(Number(selectedLocationId)));
        const filename = basketImageUri!.split('/').pop() ?? 'basket.jpg';
        formData.append('image', { uri: basketImageUri, name: filename, type: 'image/jpeg' } as any);
        const { createBasket } = await import('@/src/services/business');
        return createBasket(formData, attemptKey);
      }
      return createBasketJSON({
        name: name.trim(),
        description: description.trim() || undefined,
        original_price: originalPrice ? parseFloat(originalPrice) : undefined,
        selling_price: parseFloat(sellingPrice),
        quantity,
        // Parity with edit-mode: send the daily reinit quantity, the per-day
        // schedule (object when active, null when "Même pour tous les jours"
        // is checked), and the max-per-customer cap. The backend already
        // accepts these on POST /api/baskets — they were just missing from
        // the create payload while the form hid the controls.
        daily_reinitialization_quantity: quantity,
        daily_reinit_schedule: sameAllDays ? null : JSON.stringify(daySchedule),
        max_per_customer: maxPerCustomer,
        // JSON path: pass the field through with the actual value or omit /
        // pass undefined. createBasketJSON's type signature requires string,
        // so when sendStart is null we omit the field (column will be NULL
        // by default since it's a new row).
        ...(sendStart ? { pickup_start_time: sendStart } : {}),
        ...(sendEnd ? { pickup_end_time: sendEnd } : {}),
        menu_item_ids: selectedMenuItemIds.length > 0 ? selectedMenuItemIds : undefined,
        show_menu_items: showMenuItems,
        pickup_instructions: useDefaultPickupInstructions ? undefined : pickupInstructions.trim() || undefined,
        // AI multilingual variants (omitted when none / inheriting location).
        description_i18n: descriptionI18n ?? undefined,
        pickup_instructions_i18n: useDefaultPickupInstructions ? undefined : (pickupInstrI18n ?? undefined),
        location_id: selectedLocationId ? Number(selectedLocationId) : undefined,
      } as any, attemptKey);
    },
    onSuccess: async (created: any) => {
      // Basket is durably committed; clear the attempt key so any next
      // create on this screen mints a fresh one.
      createAttemptKeyRef.current = null;
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
    onMutate: () => {
      // Snapshot the current list of basket ids BEFORE the server call.
      // The error path uses this to detect "a new basket matching my
      // form actually got created" even if the response was lost — so
      // we never tell the merchant it failed when it didn't, and they
      // never re-tap and end up with duplicates.
      const existing = queryClient.getQueryData<any[]>(['my-baskets']) ?? [];
      const preIds = new Set(existing.map((b: any) => b?.id).filter((id: any) => id != null));
      return { preIds, expectedName: name.trim() };
    },
    onError: async (err: any, _vars, context) => {
      // Local-validation reject — see the matching guard in updateMutation
      // below for the rationale. Without this, validatePickupTime's thrown
      // Error falls into verifyOrAlarm and surfaces "Connexion instable".
      const isLocalValidation = !err?.status && !err?.response && !err?.isApiError && typeof err?.message === 'string' && err.message.length > 0;
      if (isLocalValidation) {
        alert.showAlert(t('common.error'), err.message);
        return;
      }
      await verifyOrAlarm<any[]>({
        error: err,
        queryClient,
        verifyKey: ['my-baskets'],
        verify: createVerifyAppeared<any>(
          (cache) => cache,
          context?.preIds ?? new Set(),
          (item) => String(item?.name ?? '').trim() === String(context?.expectedName ?? '').trim(),
        ),
        onConfirmed: () => {
          console.log('[CreateBasket] Recovered ghost-create — basket appeared in list');
          void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
          void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
          void queryClient.invalidateQueries({ queryKey: ['locations'] });
          setTimeout(() => router.back(), 300);
        },
        onUnconfirmed: () => alert.showAlert(t('common.error'), getErrorMessage(err)),
      });
    },
  });

  // Silent retry on transient network failures — mirrors my-baskets.tsx save.
  // The first attempt to save a basket edit can drop on a Railway hiccup /
  // SSL handshake glitch / cellular dead air, and the user then sees a hard
  // "Une erreur est survenue" popup for what's actually a transient blip
  // that resolves on a second tap. Retry ONCE after a short backoff before
  // letting onError fire. Only retried for "no response" / 502 / 503 / 504
  // shapes — real 4xx/5xx are deterministic and bypass the retry.
  const isTransient = (e: any) => {
    if (!e) return false;
    const status = Number(e?.status ?? e?.response?.status ?? 0);
    if (!status) return true;
    return status === 502 || status === 503 || status === 504;
  };

  const updateMutation = useMutation({
    mutationFn: async (vars?: { confirmPickupChange?: boolean }) => {
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
      // Build the actual send action as a closure so the silent-retry layer
      // below can call it twice. Anything ABOVE this (validation, payload
      // construction) is pure and must not retry.
      const performSend = async () => {
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
          // AI multilingual variants. Empty string clears the column (backend's
          // normalizeI18n treats '' as null) so removing the AI version (or
          // switching instructions back to "inherit") falls back to plain text.
          formData.append('description_i18n', descriptionI18n ? JSON.stringify(descriptionI18n) : '');
          formData.append('pickup_instructions_i18n', useDefaultPickupInstructions ? '' : (pickupInstrI18n ? JSON.stringify(pickupInstrI18n) : ''));
          // Per-day schedule: always send when editing so per-day changes land
          // even during an image update, and so toggling back to "same all days"
          // explicitly clears the schedule column (null string → NULL on server).
          if (isEditing) {
            formData.append('daily_reinit_schedule', sameAllDays ? 'null' : JSON.stringify(daySchedule));
          }
          // Merchant confirmed the pickup-window change despite a live order.
          if (vars?.confirmPickupChange) formData.append('confirm_pickup_change', 'true');
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
          // AI multilingual variants — null clears (falls back to plain text).
          description_i18n: descriptionI18n ?? null,
          pickup_instructions_i18n: useDefaultPickupInstructions ? null : (pickupInstrI18n ?? null),
          // Merchant confirmed the pickup-window change despite a live order.
          ...(vars?.confirmPickupChange ? { confirm_pickup_change: true } : {}),
        });
      };

      try {
        return await performSend();
      } catch (firstErr: any) {
        if (!isTransient(firstErr)) throw firstErr;
        console.log('[CreateBasket] First save attempt failed transiently, retrying once...');
        await new Promise((r) => setTimeout(r, 800));
        return performSend();
      }
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
    onError: async (err: any) => {
      const code = err?.data?.error;
      // Pickup-window change rejected outright (later start / earlier end while
      // an order is live). Show the clear, translated reason — getErrorMessage
      // would otherwise collapse it to a generic "une erreur est survenue".
      if (code === 'pickup_window_too_restrictive') {
        alert.showAlert(
          t('business.createBasket.pickupBlockedTitle', { defaultValue: 'Modification impossible' }),
          t('business.createBasket.pickupBlockedMsg', {
            defaultValue: "Une commande est déjà en cours pour ce panier. Vous pouvez avancer l'heure de début ou prolonger l'heure de fin, mais pas retarder le début ni raccourcir la fin du créneau.",
          }),
        );
        return;
      }
      // Pickup-window change is allowed but an order is live → confirm, then
      // re-save with the confirm flag. The customer will be notified.
      if (code === 'pickup_change_needs_confirm') {
        const window = err?.data?.window;
        alert.showAlert(
          t('business.createBasket.pickupConfirmTitle', { defaultValue: 'Une commande est en cours' }),
          t('business.createBasket.pickupConfirmMsg', {
            window,
            defaultValue: window
              ? `Un client a déjà réservé ce panier. Assurez-vous que le nouveau créneau de retrait (${window}) reste compatible avec sa commande. Voulez-vous vraiment le modifier ? Le client sera notifié.`
              : 'Un client a déjà réservé ce panier. Assurez-vous que le nouveau créneau de retrait reste compatible avec sa commande. Voulez-vous vraiment le modifier ? Le client sera notifié.',
          }),
          [
            { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
            {
              text: t('business.createBasket.pickupConfirmCta', { defaultValue: 'Oui, modifier' }),
              style: 'default',
              onPress: () => updateMutation.mutate({ confirmPickupChange: true }),
            },
          ],
        );
        return;
      }
      // LOCAL validation reject (e.g. validatePickupTime threw a plain
      // Error before the API was even called). The promise rejected with
      // an Error instance — no HTTP status, no `.data` — so the 4xx
      // branch and the verify-before-alarming branch both treat it as a
      // network failure and surface "Connexion instable". Catch it here
      // and show the actual error message the local check produced.
      // Symptom this fixes: picking 18:05-18:05 (start = end) used to
      // fall to "Connexion instable" even though the local rule clearly
      // identified the problem.
      const isLocalValidation = !err?.status && !err?.response && !err?.isApiError && typeof err?.message === 'string' && err.message.length > 0;
      if (isLocalValidation) {
        alert.showAlert(t('common.error'), err.message);
        return;
      }
      // 4xx with a specific backend error string → surface it directly. This
      // is a user-correctable validation issue (e.g. price-too-high, invalid
      // pickup time format, location-out-of-hours), NOT a network problem,
      // and hiding it behind "Connexion instable" trained the user to ignore
      // the popup (or worse: blame the network for a backend rejection). The
      // verify-before-alarming path below is the right call only for 5xx /
      // network failures where the server might have committed the change
      // despite the response getting lost.
      const httpStatus = Number(err?.status ?? err?.response?.status ?? 0);
      const backendErrCode = err?.data?.error ?? err?.response?.data?.error;
      const isClientValidation = httpStatus >= 400 && httpStatus < 500 && typeof backendErrCode === 'string' && backendErrCode.length > 0;
      if (isClientValidation) {
        alert.showAlert(t('common.error'), getErrorMessage(err));
        return;
      }
      // Verify-before-alarming. The save can fail with a transient network
      // error AFTER the server already committed the change (Railway slowness
      // past axios's 30 s timeout, cellular packet drop on the response).
      // Before showing "Une erreur est survenue" — which is a lie when the
      // change actually persisted — refetch the basket list and check whether
      // a basket matching editId now has the fields we requested. If yes,
      // treat as success silently and navigate back like onSuccess would. If
      // no, surface the soft "couldn't save, refresh and retry" copy
      // (matching my-baskets.tsx's onError pattern) instead of getErrorMessage.
      if (!editId) {
        alert.showAlert(t('common.error'), getErrorMessage(err));
        return;
      }
      const expectedName = name.trim();
      const expectedSellingPrice = parseFloat(sellingPrice);
      await verifyOrAlarm<any[]>({
        error: err,
        queryClient,
        verifyKey: ['my-baskets'],
        verify: (fresh) => {
          if (!Array.isArray(fresh)) return false;
          const live = fresh.find((b: any) => String(b?.id) === String(editId));
          if (!live) return false;
          // Lightweight diff on two stable, user-visible fields — that's
          // enough signal that the update reached the row.
          if (String(live.name ?? '').trim() !== expectedName) return false;
          if (Number(live.selling_price) !== expectedSellingPrice) return false;
          return true;
        },
        onConfirmed: () => {
          console.log('[CreateBasket] Edit save SUCCEEDED silently — server committed, response was lost');
          void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
          void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
          void queryClient.invalidateQueries({ queryKey: ['locations'] });
          if (editId) void queryClient.invalidateQueries({ queryKey: ['basket', String(editId)] });
          setTimeout(() => router.back(), 300);
        },
        onUnconfirmed: () => {
          // Soft, brand-protective copy. Raw getErrorMessage(err) would yield
          // "Une erreur est survenue" / "Network Error" which alarms the
          // merchant for a transient flake; this calmer copy points them at
          // the actual recovery (refresh + retry, no data lost).
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
        updateMutation.mutate({});
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
    // Zero-reinit warning fires only when the EFFECTIVE reinit value (the
    // one the cron will use) is 0. In sameAllDays mode that's the global
    // `quantity` field. In per-day mode the global field is faded/inactive
    // and `daySchedule` is the source of truth — only warn if EVERY day is
    // 0 (i.e. the basket would never restock). The previous check looked
    // at `quantity` alone and fired the warning even when per-day mode had
    // valid non-zero values, because the global field is initialised to 0.
    const effectiveAllZero = sameAllDays
      ? quantity === 0
      : Object.values(daySchedule).every((v) => v === 0);
    if (effectiveAllZero) {
      setShowZeroQtyWarning(true);
      return;
    }
    // Per-day mode collapse warning. If the merchant picked "different value
    // for each day" but typed the SAME value into all seven, save would
    // persist a per-day schedule that's behaviourally identical to the
    // single-value mode — and the availability page would then render the
    // "réinit. par jour" calendar card for a basket whose values are all
    // the same. Surface a one-step confirm: keep going as a per-day save,
    // OR collapse to the single-value mode and save that instead.
    if (!sameAllDays) {
      const values = Object.values(daySchedule);
      const common = values[0];
      const allEqual = values.every((v) => v === common);
      if (allEqual && common > 0) {
        alert.showAlert(
          t('business.createBasket.sameValueCollapseTitle', {
            defaultValue: 'Quantités identiques',
          }),
          t('business.createBasket.sameValueCollapseBody', {
            value: common,
            defaultValue: 'Vous avez activé une réinitialisation différente par jour, mais vous avez entré le même nombre de paniers ({{value}}) pour tous les jours. Voulez-vous plutôt utiliser une réinitialisation unique pour tous les jours ?',
          }),
          [
            { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
            {
              text: t('common.confirm', { defaultValue: 'Confirmer' }),
              onPress: () => {
                // Collapse state, then let the useEffect upstream fire the
                // actual mutation once the new sameAllDays/quantity values
                // are visible to the mutationFn's closure.
                setQuantity(common);
                pendingCollapseSaveRef.current = true;
                setSameAllDays(true);
              },
            },
          ],
        );
        return;
      }
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
        <BarakeatErrorIcon size={48} color={theme.colors.muted} />
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
          <TouchableOpacity
            onPress={inWalkthrough ? undefined : () => router.back()}
            disabled={inWalkthrough}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            style={{ opacity: inWalkthrough ? 0.3 : 1 }}
          >
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
                {t('business.createBasket.name')}<Text style={{ color: theme.colors.error }}> *</Text>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' }}>
                {t('business.createBasket.description')}<Text style={{ color: theme.colors.error }}> *</Text>
              </Text>
              {FeatureFlags.ENABLE_AI_TEXT_IMPROVE && (
                <TouchableOpacity
                  onPress={handleAIRefineStart}
                  disabled={aiImproveField !== null}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    opacity: aiImproveField !== null && aiImproveField !== 'description' ? 0.4 : 1,
                  }}
                >
                  {aiImproveField === 'description' ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Sparkles size={14} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '700' as const, marginLeft: 4 }}>
                        {t('business.createBasket.aiImprove', { defaultValue: 'Améliorer avec l\'IA' })}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={[styles.textArea, { backgroundColor: theme.colors.surface, borderColor: descError ? theme.colors.error : theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={description}
              onChangeText={(v) => { setDescription(v); if (v.trim()) setDescError(''); setDescriptionI18n(null); }}
              placeholder={t('business.createBasket.descriptionPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            {descError !== '' && <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 4 }}>{descError}</Text>}
            {FeatureFlags.ENABLE_AI_TEXT_IMPROVE && descriptionI18n && (
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 4, fontStyle: 'italic' }}>
                {t('business.createBasket.aiTranslatedNote', { langs: translatedLangsLabel, defaultValue: 'Traduit en {{langs}}' })}
              </Text>
            )}
          </View>

          {/* Prices.
              Both price-row labels reserve enough vertical space for
              the label to occupy TWO lines, regardless of which
              language is active. Without this, English's "Discounted
              Price (TND)" wraps to 2 lines while "Original Price
              (TND)" stays on 1, and the two TextInputs land at
              different Y positions — the visible misalignment the
              user reported.
              The reserved height MUST be derived from the body
              typography's lineHeight, not fontSize. An earlier draft
              used `fontSize * 1.4 * 2`, which evaluated to 42 px on
              the body token (`fontSize: 15`); the actual rendered
              two-line height is `lineHeight * 2 = 44 px`. The 2-px
              gap was the residual slip the user kept seeing — the
              minHeight wasn't quite reserving enough for the
              wrapped label, so the one-line side rendered 2 px
              taller than the wrapped side and the inputs offset. */}
          <View style={[styles.row, { marginBottom: theme.spacing.xl }]}>
            <View style={[styles.halfField, { marginRight: theme.spacing.md }]}>
              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm, minHeight: (theme.typography.body.lineHeight ?? 22) * 2 }}>
                {t('business.createBasket.originalPrice')}<Text style={{ color: theme.colors.error }}> *</Text>
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
              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', marginBottom: theme.spacing.sm, minHeight: (theme.typography.body.lineHeight ?? 22) * 2 }}>
                {t('business.createBasket.discountedPrice')}<Text style={{ color: theme.colors.error }}> *</Text>
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

          {/* Single notice element for the 50%-discount rule. Two states:
              - Default (hint): muted text + warm icon. Always visible so the
                merchant knows the rule before they enter anything.
                - Error: same row, swap to red text + red icon, and replace
                copy with the violation message. Previously this was TWO
                stacked rows (hint + error) which looked duplicative. */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.spacing.sm, marginTop: -theme.spacing.sm, paddingHorizontal: 2 }}>
            <AlertCircle size={12} color={priceError ? theme.colors.error : theme.colors.accentWarm} style={{ marginTop: 1 }} />
            <Text style={{ color: priceError ? theme.colors.error : theme.colors.textSecondary, fontSize: 11, marginLeft: 6, flex: 1, lineHeight: 15 }}>
              {priceError
                ? priceError
                : t('business.createBasket.priceHint', { defaultValue: 'Le prix réduit doit être au moins 50% inférieur au prix original.' })}
            </Text>
          </View>

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
              {t('business.baskets.defaultQty', { defaultValue: 'Réinit. journalière' })}
            </Text>
            {/* NOTE: deliberately NO `onLayout={measureRect(...)}` here.
                The form mounts with the qty row potentially below the fold
                (scrollY=0). If we measured then, the rect would point to a
                wrong screen position, and the overlay would paint the halo
                there for one frame before the auto-scroll effect re-measures.
                The auto-scroll effect (tryMeasure) is the sole publisher for
                this rect, AFTER scrolling has landed. */}
            <Animated.View
              ref={reinitCardRef as any}
              pointerEvents={sameAllDays ? 'auto' : 'none'}
              style={{ flexDirection: 'row', alignItems: 'center', opacity: qtyPickerOpacity }}
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
                  // Android's default TextInput padding (~8px top/bottom) plus
                  // Poppins's includeFontPadding glyph-bound padding biased
                  // the digit upward inside the 42px-tall input and clipped
                  // its top. Zero the vertical padding + drop the font
                  // padding so the number sits exactly centered.
                  paddingVertical: 0,
                  textAlignVertical: 'center',
                  includeFontPadding: false,
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
            </Animated.View>

            {/* Same for all days checkbox + per-day schedule — rendered in
                BOTH create and edit modes so the two forms look identical. */}
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
          </View>

          {/* Max Per Customer — gated only by the feature flag so it
              renders identically in create and edit modes. */}
          {FeatureFlags.ENABLE_MAX_PER_CUSTOMER && (
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
                  // Vertical-centering fix — see the matching daily-reinit
                  // picker above for the rationale (Android default padding
                  // + Poppins font-padding cropping the top of the digit).
                  paddingVertical: 0,
                  textAlignVertical: 'center',
                  includeFontPadding: false,
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

            {/* Time pickers FIRST, always rendered. When the "Utiliser les
                horaires du commerce" checkbox below is on, the pickers stay
                visible (pre-filled with the location's hours via the sync
                effect upstream) but dim and ignore touches, so the user can
                see the inherited times at a glance without un-checking the
                box. When the box is off, the pickers are fully editable.

                Walkthrough ref lives on THIS wrapper (the row that
                contains the two TimePicker boxes), not on the
                checkbox wrapper below — the demo's halo is supposed
                to draw attention to the time-of-day entry, not to
                the "use business hours" toggle. measureInWindow is
                guaranteed on native View refs; Animated.View
                forwards the ref through to its underlying View, so
                the cutout receives a measurement just like before. */}
            <Animated.View
              ref={pickupCardRef as any}
              style={{ opacity: pickupPickerOpacity, marginBottom: theme.spacing.md }}
              pointerEvents={useBusinessHours ? 'none' : 'auto'}
            >
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
            </Animated.View>

            {/* Toggle: use custom pickup times. No walkthrough ref
                here — the halo target moved up to the time-pickers
                wrapper so the demo highlights the actual time entry
                rather than the toggle below. */}
            <View>
              <TouchableOpacity
                onPress={() => {
                  const next = !useBusinessHours;
                  setUseBusinessHours(next);
                  if (next) {
                    // Snapping back to the location's hours when the user
                    // re-checks "use location hours" so the pickers above
                    // immediately reflect the inherited values.
                    setPickupStart(locationDefaultStart);
                    setPickupEnd(locationDefaultEnd);
                  }
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
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

            {/* Error-only hint — the muted "explains the 03:30 reset rule"
                caption was removed by user request: it surfaced on every
                visit even though crossing 03:30 is a vanishingly rare
                accident, and the actual error already explains the
                violation in plain language when it fires. Now the row
                appears ONLY when pickupWindowStatus !== 'ok', and it
                swaps in the specific violation (zero window, < 15 min,
                or crosses 03:30). */}
            {(() => {
              if (pickupWindowStatus === 'ok') return null;
              const message =
                pickupWindowStatus === 'zero'
                  ? t('business.baskets.endBeforeStart', { defaultValue: "L'heure de fin doit être différente de l'heure de début." })
                  : pickupWindowStatus === 'too-short'
                    ? t('business.availability.tooShort', { defaultValue: 'Le créneau de retrait doit durer au moins 15 minutes.' })
                    : t('business.availability.crossReset', { defaultValue: "Le créneau ne peut pas traverser la réinitialisation quotidienne (03:30). Choisissez un début ≥ 03:30, ou une fin ≤ 03:29." });
              return (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 }}>
                  <Clock size={11} color={theme.colors.error} style={{ marginTop: 2 }} />
                  <Text style={{ color: theme.colors.error, ...theme.typography.caption, flex: 1, lineHeight: 15 }}>
                    {message}
                  </Text>
                </View>
              );
            })()}
          </View>

          {/* Pickup Instructions — same structure as the pickup-time block:
              the editable / preview surface sits ABOVE the checkbox. When
              "Utiliser celles du commerce" is checked the location's actual
              instructions are previewed (truncated to 2 lines with a
              "Voir plus" expander) and the surface is dimmed + locked.
              When unchecked the user's own TextInput renders in the same
              slot, fully editable. */}
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' }}>
                {t('business.createBasket.pickupInstructions', { defaultValue: 'Instructions de retrait' })}
              </Text>
              {FeatureFlags.ENABLE_AI_TEXT_IMPROVE && !useDefaultPickupInstructions && (
                <TouchableOpacity
                  onPress={() => handleAIImprove('pickup_instructions')}
                  disabled={aiImproveField !== null}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    opacity: aiImproveField !== null && aiImproveField !== 'pickup_instructions' ? 0.4 : 1,
                  }}
                >
                  {aiImproveField === 'pickup_instructions' ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Sparkles size={14} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '700' as const, marginLeft: 4 }}>
                        {t('business.createBasket.aiImprove', { defaultValue: 'Améliorer avec l\'IA' })}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
            {/* Wrapper deliberately keeps `pointerEvents` at its default ('auto')
                — when the checkbox is checked and the preview shows, the only
                interactive child is the "Voir plus / Voir moins" expander, and
                the user explicitly wanted that to remain tappable even while
                the rest of the surface is visually faded. The earlier
                `pointerEvents="none"` was killing the toggle. */}
            <Animated.View
              style={{ opacity: instructionsOpacity, marginBottom: theme.spacing.md }}
            >
              {useDefaultPickupInstructions ? (
                profileQuery.data?.pickup_instructions ? (
                  // Read-only preview of the location's instructions. Same
                  // surface/border treatment as the editable TextInput
                  // below so the slot doesn't jump dimensions on toggle.
                  // Truncation cutoff at ~120 chars is a "is this worth
                  // collapsing?" heuristic — shorter strings render fully
                  // with no Voir plus affordance, longer ones get clipped
                  // to 2 lines with the standard ... ellipsis + tap-to-
                  // expand toggle below.
                  <View
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderWidth: 1,
                      borderColor: theme.colors.divider,
                      borderRadius: theme.radii.r12,
                      padding: 12,
                      minHeight: 80,
                    }}
                  >
                    <Text
                      numberOfLines={defaultInstructionsExpanded ? undefined : 2}
                      style={{ color: theme.colors.textPrimary, ...theme.typography.body }}
                    >
                      {profileQuery.data.pickup_instructions as string}
                    </Text>
                    {String(profileQuery.data.pickup_instructions).length > 120 && (
                      <TouchableOpacity onPress={() => setDefaultInstructionsExpanded((v) => !v)} style={{ marginTop: 6 }}>
                        <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' }}>
                          {defaultInstructionsExpanded
                            ? t('common.seeLess', { defaultValue: 'Voir moins' })
                            : t('common.seeMore', { defaultValue: 'Voir plus' })}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  // No location-side instructions configured — show a
                  // placeholder so the slot doesn't collapse and the user
                  // understands "inheriting from location" means "nothing"
                  // for this particular merchant.
                  <View
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderWidth: 1,
                      borderColor: theme.colors.divider,
                      borderRadius: theme.radii.r12,
                      padding: 12,
                      minHeight: 80,
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, fontStyle: 'italic' }}>
                      {t('business.createBasket.noDefaultInstructions', { defaultValue: 'Aucune instruction de retrait définie sur le commerce.' })}
                    </Text>
                  </View>
                )
              ) : (
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
                  onChangeText={(v) => { setPickupInstructions(v); setPickupInstrI18n(null); }}
                  placeholder={t('business.createBasket.pickupInstructionsPlaceholder', { defaultValue: 'Ex: Sonnez à l\'entrée arrière' })}
                  placeholderTextColor={theme.colors.muted}
                  multiline
                  textAlignVertical="top"
                />
              )}
            </Animated.View>
            <TouchableOpacity
              onPress={() => {
                setUseDefaultPickupInstructions((v) => !v);
                // Collapse the preview each time the user re-checks so the
                // next un-check → re-check cycle starts from the truncated state.
                setDefaultInstructionsExpanded(false);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
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
            {FeatureFlags.ENABLE_AI_TEXT_IMPROVE && !useDefaultPickupInstructions && pickupInstrI18n && (
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 6, fontStyle: 'italic' }}>
                {t('business.createBasket.aiTranslatedNote', { langs: translatedLangsLabel, defaultValue: 'Traduit en {{langs}}' })}
              </Text>
            )}
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

          {/* "Use for all locations" — only surfaces when CREATING a basket.
              The toggle's behavior is to clone this basket into every
              location of the organization, which has no meaning when
              editing an existing basket (it's already in place at one
              specific location), so it's suppressed in edit mode. */}
          {showAllLocationsToggle && !isEditing && (
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
            disabled={(!!priceError || isPending || pickupWindowStatus !== 'ok') && !demoBasketActive}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Zero quantity warning modal */}
      <Modal visible={showZeroQtyWarning} transparent animationType="fade" onRequestClose={() => setShowZeroQtyWarning(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ backgroundColor: '#e3ff5c22', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
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
                onPress={() => { setShowZeroQtyWarning(false); if (isEditing) updateMutation.mutate({}); else createMutation.mutate(); }}
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


      {/* AI improve suggestion preview — the merchant reviews the rewritten
          text (shown in their app language) before it replaces what they
          typed. Accepting keeps the full FR/EN/AR trio for submission. */}
      <Modal visible={!!aiPreview} transparent animationType="fade" onRequestClose={() => setAiPreview(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 360, ...theme.shadows.shadowLg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ backgroundColor: theme.colors.primary + '22', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                <Sparkles size={20} color={theme.colors.primary} />
              </View>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, flex: 1 }}>
                {t('business.createBasket.aiPreviewTitle', { defaultValue: 'Suggestion IA' })}
              </Text>
            </View>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 10 }}>
              {FeatureFlags.LANGUAGES_AR_ENABLED
                ? t('business.createBasket.aiPreviewSubtitle', { defaultValue: 'Version améliorée, traduite automatiquement en français, anglais et arabe :' })
                : t('business.createBasket.aiPreviewSubtitleNoAr', { defaultValue: 'Version améliorée, traduite automatiquement en français et anglais :' })}
            </Text>
            <View style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: theme.colors.divider, marginBottom: 14 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 22 }}>
                {aiPreview ? aiPreview[previewLang] : ''}
              </Text>
            </View>
            {!!aiPreview?.hint && (
              <View style={{ flexDirection: 'row', backgroundColor: '#e3ff5c22', borderRadius: 12, padding: 12, marginBottom: 14 }}>
                <Lightbulb size={16} color="#b8a600" style={{ marginRight: 8, marginTop: 1 }} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20, flex: 1 }}>
                  {aiPreview.hint}
                </Text>
              </View>
            )}
            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginBottom: 18 }}>
              {t('business.createBasket.aiDisclaimer', { defaultValue: 'Les suggestions sont générées par IA — vérifiez-les avant de publier.' })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={() => setAiPreview(null)}
                style={{ flex: 1, backgroundColor: theme.colors.bg, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>
                  {t('business.createBasket.aiKeepMine', { defaultValue: 'Garder mon texte' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={acceptAiSuggestion}
                style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                  {t('business.createBasket.aiUse', { defaultValue: 'Utiliser' })}
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
