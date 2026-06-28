import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  Modal,
  TextInput,
  Platform,
  Dimensions,
  Linking,
  Animated,
  Keyboard,
  PanResponder,
} from 'react-native';
import type { NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, MapPin, ShoppingBag, Clock, Star, Tag, Flag, X, ChevronRight, TimerOff, Navigation, Heart } from 'lucide-react-native';
import { isPickupExpiredInTz, effectiveLocationHours } from '@/src/utils/timezone';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { StatusBar } from 'expo-status-bar';
import { fetchLocationById } from '@/src/services/restaurants';
import { useSwipeToDismiss } from '@/src/hooks/useSwipeToDismiss';
import { fetchBasketsByLocation } from '@/src/services/baskets';
import { fetchReviewsByRestaurant, ReviewFromAPI } from '@/src/services/reviews';
import { fetchMyReservations } from '@/src/services/reservations';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { normalizeRawBasketToBasket, mapCategory } from '@/src/utils/normalizeRestaurant';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useImageCropper } from '@/src/components/ImageCropper';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { submitReport as submitReportApi } from '@/src/services/reports';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';
import {
  DEMO_LOCATION_ID,
  DEMO_BASKET_ID,
  DEMO_LOCATION_ADDRESS,
  DEMO_LOCATION_CATEGORY,
  DEMO_LATITUDE,
  DEMO_LONGITUDE,
  DEMO_COVER_URL,
  DEMO_LOGO_URL,
  buildDemoRawBaskets,
  getDemoPickupWindow,
} from '@/src/lib/demoData';

const DESC_COLLAPSED_LINES = 3;

// ── Report flow types ──────────────────────────────────────────────────────────
type ReportReason = 'food_quality' | 'wrong_info' | 'insufficient_quantity' | 'behavior' | 'other';

interface ReportState {
  reason: ReportReason | null;
  comment: string;
  submitted: boolean;
  // Data URL for an optional attached photo (for refund evidence). Stored as
  // data:image/…;base64,… so it can go straight to the backend and also render
  // as an <Image source={{ uri }}/> for the in-form preview.
  imageDataUrl?: string | null;
  submitting?: boolean;
  error?: string | null;
}

// Map the app's reason keys to the backend's expected values.
const REPORT_REASON_API_MAP: Record<ReportReason, string> = {
  food_quality: 'quality',
  wrong_info: 'other',
  insufficient_quantity: 'quantity',
  behavior: 'rude',
  other: 'other',
};

// ── Category-average helpers ───────────────────────────────────────────────────
function avg(values: number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function computeCategoryAverages(reviews: ReviewFromAPI[]) {
  if (!reviews.length) return null;
  const serviceAvg = avg(reviews.map((r) => Number(r.rating_service)));
  const qualityAvg = avg(reviews.map((r) => Number(r.rating_quality)));
  const quantityAvg = avg(reviews.map((r) => Number(r.rating_quantity)));
  const varietyAvg = avg(reviews.map((r) => Number(r.rating_variety)));
  const parts = [serviceAvg, qualityAvg, quantityAvg, varietyAvg].filter(
    (v): v is number => v !== null
  );
  const overall = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  return { serviceAvg, qualityAvg, quantityAvg, varietyAvg, overall };
}

// ── CategoryRatingRow ──────────────────────────────────────────────────────────
function CategoryRatingRow({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const theme = useTheme();
  const filled = value != null ? Math.round(value) : 0;

  return (
    <View style={catStyles.row}>
      <Text style={[catStyles.label, { color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
        {label}
      </Text>
      <View style={catStyles.stars}>
        {[1, 2, 3, 4, 5].map((s) => (
          <Star
            key={s}
            size={12}
            color={theme.colors.starYellow}
            fill={s <= filled ? theme.colors.starYellow : 'transparent'}
            style={{ marginRight: 1 }}
          />
        ))}
        <Text style={[catStyles.value, { color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '700' as const }]}>
          {value != null ? value.toFixed(1) : 'N/A'}
        </Text>
      </View>
    </View>
  );
}

const catStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {},
  stars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  value: {
    marginLeft: 6,
    minWidth: 24,
    textAlign: 'right',
  },
});

// ── Main screen ────────────────────────────────────────────────────────────────
export default function RestaurantScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const { pickPhoto } = useImageCropper();
  const [descExpanded, setDescExpanded] = useState(false);
  const [descNeedsSeeMore, setDescNeedsSeeMore] = useState(false);
  const [ratingsPopupVisible, setRatingsPopupVisible] = useState(false);
  const [ratingsExpanded, setRatingsExpanded] = useState(false);
  const screenHeight = Dimensions.get('window').height;
  const ratingsHeight = useRef(new Animated.Value(screenHeight * 0.55)).current;
  // Separate translateY for the dismiss gesture — keeps the height
  // animation (which controls expand/collapse) decoupled from the
  // slide-down animation that closes the sheet.
  const ratingsTranslateY = useRef(new Animated.Value(0)).current;
  // Manually-driven backdrop opacity. With animationType="none" the Modal
  // unmounts instantly, so without this the dim layer would pop in/out hard
  // — exactly the snap the user was complaining about on close.
  const ratingsBackdropOpacity = useRef(new Animated.Value(0)).current;
  // Guards against a re-entrant close: once a close animation starts, further
  // gesture handling is ignored until cleanup runs. Without this, a second
  // flick during the slide-out could leave the sheet stuck off-screen.
  const ratingsClosingRef = useRef(false);

  const expandRatings = useCallback(() => {
    setRatingsExpanded(true);
    Animated.spring(ratingsHeight, { toValue: screenHeight * 0.92, friction: 10, tension: 60, useNativeDriver: false }).start();
  }, [ratingsHeight, screenHeight]);

  const collapseOrCloseRatings = useCallback(() => {
    setRatingsExpanded(prev => {
      if (prev) {
        Animated.spring(ratingsHeight, { toValue: screenHeight * 0.55, friction: 10, tension: 60, useNativeDriver: false }).start();
        return false;
      }
      // Closing (not expanded) — animate slide-down + backdrop-fade in parallel
      // and only unmount on finish. Routes X-button / backdrop-tap / Android-back
      // through the same animation the swipe-dismiss uses, so every close source
      // looks identical (no snap/jitter on unmount).
      if (ratingsClosingRef.current) return false;
      ratingsClosingRef.current = true;
      Animated.parallel([
        Animated.timing(ratingsTranslateY, { toValue: screenHeight, duration: 220, useNativeDriver: true }),
        Animated.timing(ratingsBackdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        setRatingsPopupVisible(false);
        ratingsTranslateY.setValue(0);
        ratingsHeight.setValue(screenHeight * 0.55);
        ratingsClosingRef.current = false;
      });
      return false;
    });
  }, [ratingsHeight, ratingsTranslateY, ratingsBackdropOpacity, screenHeight]);

  // Reset the dismiss slide whenever the popup is re-opened so a previous
  // mid-drag value can't leave it pre-translated. Also fade the backdrop in
  // here (it's manually driven — see ratingsBackdropOpacity above).
  useEffect(() => {
    if (ratingsPopupVisible) {
      ratingsTranslateY.setValue(0);
      ratingsClosingRef.current = false;
      Animated.timing(ratingsBackdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else {
      ratingsBackdropOpacity.setValue(0);
    }
  }, [ratingsPopupVisible, ratingsTranslateY, ratingsBackdropOpacity]);

  // Dynamic dismiss + expand gesture. Drags follow the finger 1:1
  // going down; going up while collapsed pre-pulls the height toward
  // the expanded size (rubber-band-style preview). On release we
  // velocity-project and snap to expanded / collapsed / closed based
  // on intent — same model as src/hooks/useSwipeToDismiss.
  const expandedRef = useRef(false);
  expandedRef.current = ratingsExpanded;
  const ratingsPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (ratingsClosingRef.current) return;
        if (g.dy >= 0) {
          // Drag DOWN — slide the popup down following the finger.
          ratingsTranslateY.setValue(g.dy);
        } else if (!expandedRef.current) {
          // Drag UP from collapsed — pull the popup taller, capped.
          const next = Math.min(screenHeight * 0.92, screenHeight * 0.55 + Math.abs(g.dy));
          ratingsHeight.setValue(next);
        } else {
          // Drag UP from already expanded — light rubber-band.
          ratingsTranslateY.setValue(g.dy / 3);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (ratingsClosingRef.current) return;
        const projection = g.dy + g.vy * 60;
        // Pick an outcome ordered by clarity of intent:
        if (projection > 80 || g.vy > 0.6) {
          // Close. Slide fully off-screen, then ALWAYS clean up — even if the
          // animation was interrupted — so the sheet can never get stuck
          // off-screen-but-visible (an invisible touch-blocking overlay, which
          // was the "app froze after I closed the ratings" symptom).
          ratingsClosingRef.current = true;
          const duration = Math.max(120, Math.min(280, 220 - g.vy * 50));
          // translateY is native-driven (it lives on its own outer node, away
          // from the JS-driven `height`), so the slide-out runs on the UI thread
          // and stays smooth — no jitter/snap even under the close re-render.
          // Fade the backdrop in parallel so the swipe-close matches X-button close.
          Animated.parallel([
            Animated.timing(ratingsTranslateY, { toValue: screenHeight, duration, useNativeDriver: true }),
            Animated.timing(ratingsBackdropOpacity, { toValue: 0, duration, useNativeDriver: true }),
          ]).start(() => {
            setRatingsPopupVisible(false);
            setRatingsExpanded(false);
            ratingsTranslateY.setValue(0);
            ratingsHeight.setValue(screenHeight * 0.55);
            ratingsClosingRef.current = false;
          });
        } else if (!expandedRef.current && g.dy < -40) {
          // Confirmed upward swipe — expand.
          Animated.spring(ratingsTranslateY, { toValue: 0, friction: 10, tension: 80, useNativeDriver: true }).start();
          expandRatings();
        } else {
          // Spring back to whatever resting size the sheet is in. translateY is
          // native, height is JS-driven — they're separate nodes/values, so a
          // mixed-driver parallel is fine.
          Animated.parallel([
            Animated.spring(ratingsTranslateY, { toValue: 0, friction: 10, tension: 80, useNativeDriver: true }),
            Animated.spring(ratingsHeight, {
              toValue: expandedRef.current ? screenHeight * 0.92 : screenHeight * 0.55,
              friction: 10,
              tension: 60,
              useNativeDriver: false,
            }),
          ]).start();
        }
      },
      onPanResponderTerminate: () => {
        ratingsTranslateY.setValue(0);
      },
    })
  ).current;

  // Report modal state — local only, no API
  const [reportVisible, setReportVisible] = useState(false);
  const [report, setReport] = useState<ReportState>({
    reason: null,
    comment: '',
    submitted: false,
  });

  // Keyboard-aware state for the report modal's comment textbox. KeyboardAvoidingView
  // inside a RN <Modal> is unreliable on Android (the modal runs in its own window),
  // so we track keyboard height explicitly and push it into ScrollView padding.
  const reportScrollRef = useRef<ScrollView | null>(null);
  const [reportKbHeight, setReportKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setReportKbHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setReportKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const REPORT_REASONS: { key: ReportReason; label: string }[] = [
    { key: 'food_quality', label: t('report.reasons.food_quality', { defaultValue: 'Food quality issue' }) },
    { key: 'wrong_info', label: t('report.reasons.wrong_info', { defaultValue: 'Wrong information' }) },
    { key: 'insufficient_quantity', label: t('report.reasons.insufficient_quantity', { defaultValue: 'Quantité insuffisante' }) },
    { key: 'behavior', label: t('report.reasons.behavior', { defaultValue: 'Inappropriate behavior' }) },
    { key: 'other', label: t('report.reasons.other', { defaultValue: 'Other' }) },
  ];

  // Demo short-circuit: when the URL points at the synthetic 'demo' location
  // we never want to hit the backend (no such location exists), regardless
  // of the walkthrough's `demoCustomerActive` flag. Tying the short-circuit
  // to the URL alone makes the demo robust against any race where the flag
  // lags behind the navigation: the user could land here via the demo
  // card on Discover even if the flag was momentarily false, and the page
  // would otherwise try to fetch a real location with id='demo' and render
  // empty / error state.
  useWalkthroughStore((s) => s.demoCustomerActive); // subscribe for re-render when the flag flips
  const isDemoLocation = String(id) === DEMO_LOCATION_ID;

  // Redundant step-advance + currentStep publish: the engine's pathname
  // listener in (tabs)/_layout sometimes lags when that layout is rendered
  // as a backgrounded Stack screen (React Navigation can freeze offscreen
  // screens), so step 1 doesn't always advance, and even when it does, the
  // engine's [step] effect (which publishes `currentStep`) fires too late
  // for the SubScreenWalkthroughOverlay to render — user sees a brief
  // flash with no overlay, sometimes nothing at all until they tap. We
  // drive BOTH the step increment AND the currentStep publish from this
  // page on mount so the overlay has everything it needs immediately.
  React.useEffect(() => {
    if (!isDemoLocation) return;
    const state = useWalkthroughStore.getState();
    // Clear the stale rect from any previous demo run BEFORE the page lays
    // out. The SubScreenWalkthroughOverlay's fast-path would otherwise pick
    // up the old rect (e.g. from a previous run at a different scroll
    // offset) and paint the halo there until the basket card's onLayout
    // republishes a few frames later — exactly the "wrong halo first, then
    // corrects itself" flash the user sees on /restaurant/demo. With the
    // rect cleared, the overlay falls through to its dim-mask-only branch
    // until the FRESH onLayout publishes, so the halo only ever appears at
    // the correct position.
    state.setMeasuredRect('restaurantSurpriseBasket', null);
    if (state.currentStep?.measureKey !== 'firstBasketCard') return;
    state.nextStep(Number.MAX_SAFE_INTEGER);
    state.setCurrentStep({
      measureKey: 'restaurantSurpriseBasket',
      titleKey: 'walkthrough.customer.restaurantBasket.title',
      descKey: 'walkthrough.customer.restaurantBasket.desc',
      tooltipPosition: 'bottom',
      isLast: false,
      stepIndex: 2,
      totalSteps: 20,
      requireTap: true,
      target: { top: 360, left: 16, width: Dimensions.get('window').width - 32, height: 110, radius: 16 },
    });
  }, [isDemoLocation]);

  // Fetch location data (replaces restaurant)
  const locationQuery = useQuery({
    queryKey: ['location', id],
    queryFn: () => fetchLocationById(String(id)),
    enabled: !!id && !isDemoLocation,
  });

  // Fetch baskets belonging to this location
  const basketsQuery = useQuery({
    queryKey: ['baskets-by-location', id],
    queryFn: () => fetchBasketsByLocation(String(id)),
    enabled: !!id && !isDemoLocation,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 1,
  });

  // Refetch on focus so quantities stay fresh after navigating back from a basket
  useFocusEffect(
    useCallback(() => {
      if (!id || isDemoLocation) return;
      basketsQuery.refetch();
      locationQuery.refetch();
    }, [id, basketsQuery, locationQuery, isDemoLocation])
  );

  // Gate the "signaler ce commerce" affordance behind having ordered from this location.
  // Reuses the shared ['reservations'] cache used by the orders tab — no extra request in most cases.
  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    staleTime: 60_000,
    enabled: !isDemoLocation,
  });
  const hasOrderedHere = (reservationsQuery.data ?? []).some(
    (r) => Number(r.restaurant_id) === Number(id) || Number((r as any).restaurant?.id) === Number(id),
  );

  // Favorite state for the top-right heart. Home/favorites cards use
  // `favoriteBasketIds` keyed by location id (normalizeLocationToBasket sets
  // basket.id = location.id), so we read/write the same list here — otherwise
  // a location favorited from the home screen wouldn't show as highlighted
  // when the user opens its preview page.
  // Also fall back to `favoriteMerchantIds` for any legacy entries a user
  // toggled from this page before the unification.
  const favoriteBasketIds = useFavoritesStore((s) => s.favoriteBasketIds);
  const favoriteMerchantIds = useFavoritesStore((s) => s.favoriteMerchantIds);
  const toggleBasketFavorite = useFavoritesStore((s) => s.toggleBasketFavorite);
  const isFavorited = id
    ? favoriteBasketIds.includes(String(id)) || favoriteMerchantIds.includes(String(id))
    : false;

  // Demo fixture data — short-circuits the location + basket queries while
  // the customer walkthrough is on the /restaurant/demo step. Now serves THREE
  // baskets (basket #1 is the walkthrough target; #2 and #3 are decorative
  // additional options so the demo location resembles a real one) plus cover
  // photo + merchant logo so the page no longer renders as a placeholder.
  const demoLocationName = t('walkthrough.customer.demoLocationName', { defaultValue: 'Chez Joe (démo)' });
  // Dynamic pickup window — anchored to the current clock so the demo
  // location is never marked closed/expired no matter what time the user
  // explores the demo.
  const demoPickup = isDemoLocation ? getDemoPickupWindow() : null;
  const demoLocation: any = isDemoLocation
    ? {
        id: DEMO_LOCATION_ID,
        name: demoLocationName,
        display_name: demoLocationName,
        address: DEMO_LOCATION_ADDRESS,
        category: DEMO_LOCATION_CATEGORY,
        pickup_start_time: demoPickup!.start,
        pickup_end_time: demoPickup!.end,
        latitude: DEMO_LATITUDE,
        longitude: DEMO_LONGITUDE,
        cover_image_url: DEMO_COVER_URL,
        image_url: DEMO_LOGO_URL,
        avg_rating: 4.8,
        description: t('walkthrough.customer.demoBasketDesc', { defaultValue: 'Démonstration — aucune commande réelle n\'est créée.' }),
      }
    : null;

  const restaurant = isDemoLocation ? demoLocation : locationQuery.data;
  // Location's effective pickup window for TODAY (per-day weekly_schedule wins
  // over the flat widest-span times). Used for the header chip and as the
  // inheritance fallback for baskets with NULL pickup times.
  const restEff = effectiveLocationHours(restaurant as any);

  const rawBaskets = isDemoLocation ? buildDemoRawBaskets({ restaurantName: demoLocationName }) : (basketsQuery.data ?? []);
  const baskets = rawBaskets.map((b: any) =>
    normalizeRawBasketToBasket(b as any, restaurant?.name, {
      // Pass the location's hours so baskets with NULL pickup times
      // inherit them (matches the backend's NULL-means-inherit convention).
      // weekly_schedule lets inheriting baskets resolve TODAY's location hours.
      start: (restaurant as any)?.pickup_start_time,
      end: (restaurant as any)?.pickup_end_time,
      weekly_schedule: (restaurant as any)?.weekly_schedule,
    }),
  );
  // True when the location has at least one basket AND every basket is
  // either sold out or past its pickup window. Used to surface a single
  // "fully unavailable" banner on the header instead of relying on the
  // user to scan each basket card — and to keep the location-level expiry
  // signal consistent with the per-basket expiry badges below.
  const locationFullyExpired = baskets.length > 0 && baskets.every((b) =>
    (b.quantityLeft ?? 0) <= 0 || isPickupExpiredInTz(b.pickupWindow?.end),
  );

  const reviewsQuery = useQuery({
    queryKey: ['restaurant-reviews', id],
    queryFn: () => fetchReviewsByRestaurant(String(id)),
    enabled: !!id && !isDemoLocation,
  });
  const reviews = reviewsQuery.data ?? [];

  // ── Compute 4-category averages ───────────────────────────────────────────────
  const catAvgs = computeCategoryAverages(reviews);

  // Overall rating: derived from 4 category averages, fallback to restaurant.avg_rating
  const overallRating =
    catAvgs?.overall != null
      ? catAvgs.overall
      : (restaurant as any)?.avg_rating != null
      ? Number((restaurant as any).avg_rating)
      : null;

  const reviewCount = reviews.length;

  const isLoading = !isDemoLocation && locationQuery.isLoading;

  const description =
    (restaurant as any)?.bag_description?.trim() || restaurant?.description?.trim() || null;

  const onDescTextLayout = useCallback((e: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (!descExpanded && e.nativeEvent.lines.length >= DESC_COLLAPSED_LINES) {
      setDescNeedsSeeMore(true);
    }
  }, [descExpanded]);

  // ── Report handlers ────────────────────────────────────────────────────────────
  const openReport = () => {
    setReport({ reason: null, comment: '', submitted: false, imageDataUrl: null, submitting: false, error: null });
    setReportVisible(true);
  };

  const closeReport = () => {
    setReportVisible(false);
  };

  // Swipe-down dismiss for the report sheet.
  const reportSwipe = useSwipeToDismiss(closeReport);

  const pickReportPhoto = async () => {
    // Limited-access-aware grid (handles its own permission popup) → data URL.
    const res = await pickPhoto({ base64: true });
    if (res?.dataUrl) setReport((prev) => ({ ...prev, imageDataUrl: res.dataUrl as string }));
  };

  const submitReport = async () => {
    // Description is now required: a bare reason chip with no detail
    // makes the report useless on the support team's side. Block the
    // submit early if it's empty so the disabled CTA isn't the only
    // signal — the user sees an inline error too.
    const detailsTrimmed = report.comment.trim();
    if (!report.reason || report.submitting) return;
    if (!detailsTrimmed) {
      setReport((prev) => ({ ...prev, error: t('report.detailsRequired', { defaultValue: 'Please add a description of the problem.' }) }));
      return;
    }
    if (!id) return;
    setReport((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await submitReportApi({
        location_id: Number(id),
        reason: REPORT_REASON_API_MAP[report.reason],
        details: detailsTrimmed,
        image_data_url: report.imageDataUrl || undefined,
      });
      setReport((prev) => ({ ...prev, submitted: true, submitting: false }));
    } catch (err: any) {
      const msg = getErrorMessage(err, t('report.error', { defaultValue: 'Submission failed' }));
      setReport((prev) => ({ ...prev, submitting: false, error: msg }));
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <StatusBar style="dark" />
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16 }]}
          onPress={() => router.back()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <DelayedLoader />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          {restaurant?.cover_image_url ? (
            <Image source={{ uri: restaurant.cover_image_url }} style={styles.heroImage} />
          ) : (
            <View style={[styles.heroImage, { backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }]}>
              {restaurant?.image_url ? (
                <Image source={{ uri: restaurant.image_url }} style={{ width: 80, height: 80, borderRadius: 40, opacity: 0.6 }} />
              ) : null}
            </View>
          )}
          <View style={styles.heroOverlay} />
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: 'rgba(255,255,255,0.9)', ...theme.shadows.shadowMd }]}
            onPress={() => router.back()}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
            <ChevronLeft size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          {/* Favorite heart — top right. Filled red when this merchant is favorited,
              outlined otherwise. Toggling adds/removes the location from the favorites
              tab (same store as the basket-preview star). */}
          <TouchableOpacity
            style={[
              styles.menuBtn,
              {
                // Keep the button background the same regardless of state so
                // the heart icon itself carries the active/inactive signal —
                // mirrors the heart on basket cards on the search page.
                backgroundColor: 'rgba(255,255,255,0.9)',
                ...theme.shadows.shadowMd,
              },
            ]}
            onPress={() => { if (id) toggleBasketFavorite(String(id)); }}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityLabel={isFavorited
              ? t('favorites.removeFromFavorites', { defaultValue: 'Retirer des favoris' })
              : t('favorites.addToFavorites', { defaultValue: 'Ajouter aux favoris' })}
          >
            <Heart
              size={20}
              color={isFavorited ? theme.colors.error : theme.colors.textSecondary}
              fill={isFavorited ? theme.colors.error : 'transparent'}
            />
          </TouchableOpacity>
          {/* Rating badge — bottom right of hero image */}
          <TouchableOpacity
            onPress={() => { setRatingsExpanded(false); ratingsHeight.setValue(screenHeight * 0.55); setRatingsPopupVisible(true); }}
            activeOpacity={0.7}
            style={{ position: 'absolute', bottom: 36, right: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, ...theme.shadows.shadowSm }}
          >
            <Star size={12} color={overallRating != null ? theme.colors.starYellow : theme.colors.muted} fill={overallRating != null ? theme.colors.starYellow : 'transparent'} />
            <Text style={{ color: overallRating != null ? theme.colors.textPrimary : theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '700', marginLeft: 4 }}>
              {overallRating != null ? overallRating.toFixed(1) : t('review.noRating')}
            </Text>
            {reviewCount > 0 ? (
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginLeft: 3 }}>({reviewCount})</Text>
            ) : null}
            <ChevronRight size={10} color={theme.colors.muted} style={{ marginLeft: 2 }} />
          </TouchableOpacity>
        </View>

        {/* Info card */}
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: theme.colors.surface,
              marginHorizontal: 16,
              marginTop: -28,
              borderRadius: theme.radii.r20,
              padding: 20,
              ...theme.shadows.shadowMd,
            },
          ]}
        >
          {/* Name + logo + category */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {restaurant?.image_url ? (
              <Image source={{ uri: restaurant.image_url }} style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.divider }} />
            ) : null}
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, fontWeight: '700' as const, flex: 1 }]}>
              {restaurant?.name ?? ''}
            </Text>
          </View>
          {locationFullyExpired ? (
            <View style={{ marginTop: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: '#88888822', borderRadius: theme.radii.pill, paddingHorizontal: 10, paddingVertical: 4, gap: 4 }}>
              <TimerOff size={11} color="#666" />
              <Text style={{ color: '#555', fontSize: 11, fontWeight: '600', fontFamily: 'Poppins_600SemiBold' }}>
                {t('basket.allUnavailable', { defaultValue: "Aucun panier n'est disponible" })}
              </Text>
            </View>
          ) : null}

          {/* Info: category + pickup time + address (aligned icons) → rating */}
          <View style={{ marginTop: 14, gap: 8 }}>
            {/* Category — aligned (same icon size + indent) with pickup time & address below */}
            {restaurant?.category ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10 }}>
                <Tag size={12} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }} numberOfLines={1}>
                  {t(`categories.${mapCategory(restaurant.category)}`, { defaultValue: t(`home.categories.${mapCategory(restaurant.category)}`, { defaultValue: restaurant.category }) })}
                </Text>
              </View>
            ) : null}
            {/* Pickup time + Rating on same row. When the location is closed
                for today, swap the time chip for a "Fermé aujourd'hui" chip
                so the customer sees the reason instead of a blank space. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {restEff.closed ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Clock size={12} color={theme.colors.error} />
                  <Text style={{ color: theme.colors.error, ...theme.typography.caption, marginLeft: 4, fontWeight: '600' }}>
                    {t('basket.closedToday', { defaultValue: 'Fermé aujourd\'hui' })}
                  </Text>
                </View>
              ) : restEff.start ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Clock size={12} color={theme.colors.textSecondary} />
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }}>
                    {restEff.start}
                    {restEff.end ? ` - ${restEff.end}` : ''}
                  </Text>
                </View>
              ) : null}
            </View>
            {/* Address + itinerary — 2nd line, pin aligned under clock */}
            {restaurant?.address ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10 }}>
                <MapPin size={12} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }} numberOfLines={2}>
                  {restaurant.address}
                </Text>
                {restaurant.latitude && restaurant.longitude && (
                  <TouchableOpacity
                    onPress={() => {
                      const url = Platform.select({
                        ios: `maps:0,0?q=${restaurant.latitude},${restaurant.longitude}`,
                        android: `geo:${restaurant.latitude},${restaurant.longitude}?q=${restaurant.latitude},${restaurant.longitude}`,
                      });
                      if (url) Linking.openURL(url);
                    }}
                    style={{ backgroundColor: theme.colors.primary, borderRadius: 14, width: 28, height: 28, justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}
                  >
                    <Navigation size={13} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </View>
          {/* Description hidden — info shown in basket preview instead */}
        </View>

        {/* Baskets section */}
        <View style={[styles.body, { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 }]}>
          <Text
            style={[
              {
                color: theme.colors.textPrimary,
                ...theme.typography.h3,
                fontWeight: '600' as const,
                marginBottom: 12,
              },
            ]}
          >
            {t('basket.availableBaskets')}
          </Text>

          {basketsQuery.isLoading ? (
            <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 20 }} />
          ) : basketsQuery.isError ? (
            null
          ) : baskets.length === 0 ? (
            <View style={styles.emptyState}>
              <ShoppingBag size={48} color={theme.colors.muted} />
              <Text
                style={[
                  {
                    color: theme.colors.textSecondary,
                    ...theme.typography.body,
                    marginTop: 12,
                    textAlign: 'center' as const,
                  },
                ]}
              >
                {t('basket.noBaskets')}
              </Text>
            </View>
          ) : (
            baskets.map((basket) => {
              // When the location is closed today, force EVERY basket card
              // to render in the unavailable/expired state regardless of
              // its own stock or pickup window — even one sold-out basket
              // on a closed-today location should read as "Expiré" so the
              // customer doesn't get a mixed signal.
              const locationClosedToday = restEff.closed;
              const soldOut = basket.quantityLeft <= 0;
              // pickupExpired is independent of stock — a sold-out basket
              // whose pickup time has also passed is FIRST AND FOREMOST
              // expired (the time-window miss is the real story; the
              // stockout is a side-detail). The badge below displays
              // pickupExpired before soldOut for the same reason.
              const pickupExpired = locationClosedToday || isPickupExpiredInTz(basket.pickupWindow?.end);
              const unavailable = locationClosedToday || soldOut || pickupExpired;
              const isDemoBasketCard = isDemoLocation && String(basket.id) === DEMO_BASKET_ID;

              return (
              <TouchableOpacity
                key={basket.id}
                onPress={() => router.push(`/basket/${basket.id}` as never)}
                onLayout={isDemoBasketCard ? (e) => {
                  (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                    if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('restaurantSurpriseBasket', { x, y, w, h });
                  });
                } : undefined}
                style={[
                  styles.basketCard,
                  {
                    backgroundColor: unavailable ? '#f0f0f0' : theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    ...theme.shadows.shadowSm,
                    flexDirection: 'row',
                    opacity: unavailable ? 0.55 : 1,
                  },
                ]}
                activeOpacity={0.8}
              >
                {/* Basket quantity badge — top right */}
              {/* Status badge — pickupExpired wins over soldOut so a basket
                  that's both expired AND sold out surfaces the more
                  actionable "expired" state. Grey background + TimerOff
                  icon for expired; red + ShoppingBag for sold-out only;
                  primary + count otherwise. */}
              <View style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, backgroundColor: pickupExpired ? '#888' : soldOut ? theme.colors.error : theme.colors.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {pickupExpired ? (
                  <TimerOff size={12} color="#fff" />
                ) : (
                  <ShoppingBag size={12} color="#fff" />
                )}
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {pickupExpired ? t('orders.pickupEnded', { defaultValue: 'Expired' }) : soldOut ? t('basket.soldOut') : (basket.quantityLeft >= 10 ? '9+' : basket.quantityLeft)}
                </Text>
              </View>
              <View style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
                  <Text style={[{ color: unavailable ? theme.colors.muted : theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]} numberOfLines={1}>
                    {basket.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                    <Text style={[{ color: unavailable ? theme.colors.muted : theme.colors.primary, ...theme.typography.body, fontWeight: '700' as const }]}>
                      {basket.discountedPrice} {t('common.currency', { defaultValue: 'TND' })}
                    </Text>
                    {basket.originalPrice > 0 && (
                      <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through', marginLeft: 6 }]}>
                        {basket.originalPrice} {t('common.currency', { defaultValue: 'TND' })}
                      </Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    {/* Yellow "horaires personnalisés" chip — driven by the
                        normaliser's `hasCustomPickup` flag (true when the
                        basket row's pickup_start_time / pickup_end_time
                        column is non-null). The previous in-line string
                        comparison against location hours suppressed the chip
                        whenever the location's own hours came back empty
                        / sentinel, which is why some locations' baskets
                        showed the badge and others didn't. */}
                    {basket.hasCustomPickup ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#e3ff5c22', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Clock size={11} color="#b8a600" />
                        <Text style={{ color: '#8a7d00', fontSize: 11, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', marginLeft: 3 }}>
                          {basket.pickupWindow.start}-{basket.pickupWindow.end}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {basket.imageUrl ? (
                  <Image source={{ uri: basket.imageUrl }} style={{ width: 90, height: '100%', borderTopRightRadius: theme.radii.r16, borderBottomRightRadius: theme.radii.r16, opacity: unavailable ? 0.4 : 1 }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 90, backgroundColor: theme.colors.primary + '08', justifyContent: 'center', alignItems: 'center', borderTopRightRadius: theme.radii.r16, borderBottomRightRadius: theme.radii.r16 }}>
                    <ShoppingBag size={28} color={theme.colors.muted} />
                  </View>
                )}
              </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Signaler ce commerce — only rendered for customers who have already
            ordered from this location. Keeps the entry point off the top-right
            (replaced by the favorites heart) while preserving access for users
            with legitimate grounds to report. Opens the existing report modal. */}
        {hasOrderedHere && (
          <TouchableOpacity
            onPress={openReport}
            style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, marginTop: 8 }}
            accessibilityLabel={t('report.cta', { defaultValue: 'Report this restaurant' })}
          >
            <Flag size={14} color={theme.colors.textSecondary} />
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, textDecorationLine: 'underline' }}>
              {t('report.cta', { defaultValue: 'Signaler ce commerce' })}
            </Text>
          </TouchableOpacity>
        )}

        {/* Bottom spacing */}
        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── Ratings popup modal ────────────────────────────────────── */}
      {/* animationType="none": RN's native fade was layering an opacity tween
          over our manual slide-down, which produced the close-snap. With "none"
          the modal unmounts only after the slide finishes; the backdrop opacity
          is faded manually in parallel so it doesn't pop. */}
      <Modal
        visible={ratingsPopupVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={collapseOrCloseRatings}
      >
        <Animated.View style={[styles.reportOverlay, { opacity: ratingsBackdropOpacity }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={collapseOrCloseRatings}
          />
          {/* OUTER node — only the dismiss/drag translateY (native driver). */}
          <Animated.View
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              transform: [{ translateY: ratingsTranslateY }],
            }}
          >
          {/* INNER node — the expand/collapse height (JS driver). Separating the
              two means the native translateY never gets forced onto the JS
              thread, so closing the sheet is smooth (no jitter/snap). */}
          <Animated.View
            style={{
              height: ratingsHeight,
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: 26, borderTopRightRadius: 26,
              ...theme.shadows.shadowLg,
            }}
          >
            {/* Top swipe zone — hosts the handle pill AND the gesture
                so the inner ScrollView keeps scrolling normally. Swipe
                down to close, swipe up (while collapsed) to expand. */}
            <View
              {...ratingsPanResponder.panHandlers}
              style={{ paddingVertical: 14, alignItems: 'center' }}
            >
              <View style={[styles.sheetHandle, { backgroundColor: theme.colors.divider }]} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 14 }}>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>
                {t('review.ratingsTitle', { defaultValue: 'Avis' })}
              </Text>
              <TouchableOpacity
                onPress={collapseOrCloseRatings}
                style={[styles.sheetClosePill, { backgroundColor: theme.colors.bg }]}
              >
                <X size={16} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Ratings section — always pinned at top */}
            <View style={{ paddingHorizontal: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <Star size={24} color={theme.colors.starYellow} fill={overallRating != null ? theme.colors.starYellow : 'transparent'} />
                <Text style={{ color: theme.colors.textPrimary, fontSize: 28, fontWeight: '700', marginLeft: 8 }}>
                  {overallRating != null ? overallRating.toFixed(1) : '—'}
                </Text>
                {reviewCount > 0 && (
                  <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, marginLeft: 8 }}>
                    ({t('review.reviewCount', { count: reviewCount, defaultValue: '{{count}} avis' })})
                  </Text>
                )}
              </View>
              <View style={{ backgroundColor: theme.colors.surfaceMuted, borderRadius: 14, padding: 14, marginBottom: 4 }}>
                <CategoryRatingRow label={t('review.service', { defaultValue: 'Service' })} value={catAvgs?.serviceAvg ?? null} />
                <CategoryRatingRow label={t('review.quality', { defaultValue: 'Qualité' })} value={catAvgs?.qualityAvg ?? null} />
                <CategoryRatingRow label={t('review.quantity', { defaultValue: 'Quantité' })} value={catAvgs?.quantityAvg ?? null} />
                <CategoryRatingRow label={t('review.variety', { defaultValue: 'Variété' })} value={catAvgs?.varietyAvg ?? null} />
                {catAvgs == null && (
                  <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textAlign: 'center', marginTop: 8 }}>
                    {t('review.noReviewsYet', { defaultValue: "Aucun avis pour le moment" })}
                  </Text>
                )}
              </View>
            </View>

            {/* Divider */}
            <View style={{ height: 1, backgroundColor: theme.colors.divider, marginHorizontal: 24, marginVertical: 14 }} />

            {/* Comments section — flex: 1 fills remaining height */}
            <View style={{ flex: 1 }}>
              <View style={{ paddingHorizontal: 24, marginBottom: 6 }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                  {t('review.comments', { defaultValue: 'Commentaires' })}
                </Text>
              </View>

              {(() => {
                const commentsWithText = reviews.filter((r) => r.comment?.trim());

                if (commentsWithText.length === 0) return (
                  <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                    <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm }}>
                      {t('review.noComments', { defaultValue: 'Aucun commentaire pour le moment.' })}
                    </Text>
                  </View>
                );

                if (!ratingsExpanded) {
                  // Collapsed: show 1 comment + "voir tous"
                  const first = commentsWithText[0];
                  return (
                    <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
                      <View style={{ paddingVertical: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                          <View style={{ flexDirection: 'row', gap: 2 }}>
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} size={12} color={s <= Math.round(first.rating) ? theme.colors.starYellow : theme.colors.divider} fill={s <= Math.round(first.rating) ? theme.colors.starYellow : 'transparent'} />
                            ))}
                          </View>
                          {first.created_at && (
                            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginLeft: 8 }}>
                              {new Date(first.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                            </Text>
                          )}
                        </View>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, lineHeight: 20 }} numberOfLines={2}>
                          {first.comment}
                        </Text>
                        {first.basket_name ? (
                          <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textAlign: 'right', marginTop: 4 }} numberOfLines={1}>
                            {first.basket_name}
                          </Text>
                        ) : null}
                      </View>
                      {commentsWithText.length > 1 && (
                        <TouchableOpacity onPress={() => { expandRatings(); }} style={{ alignItems: 'center', paddingVertical: 8 }}>
                          <Text style={{ color: theme.colors.primary, fontSize: 20, letterSpacing: 4, fontWeight: '700' }}>...</Text>
                          <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600', marginTop: 2 }}>
                            {t('review.seeAllComments', { defaultValue: 'Voir tous les commentaires' })}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }

                // Expanded: scrollable comments fill remaining space
                return (
                  <ScrollView
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
                    showsVerticalScrollIndicator={false}
                    style={{ flex: 1 }}
                  >
                    {commentsWithText.map((r, idx) => (
                      <View key={r.id ?? idx} style={{ borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: theme.colors.divider, paddingVertical: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                          <View style={{ flexDirection: 'row', gap: 2 }}>
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} size={12} color={s <= Math.round(r.rating) ? theme.colors.starYellow : theme.colors.divider} fill={s <= Math.round(r.rating) ? theme.colors.starYellow : 'transparent'} />
                            ))}
                          </View>
                          {r.created_at && (
                            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginLeft: 8 }}>
                              {new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                            </Text>
                          )}
                        </View>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, lineHeight: 20 }}>
                          {r.comment}
                        </Text>
                        {r.basket_name ? (
                          <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textAlign: 'right', marginTop: 4 }} numberOfLines={1}>
                            {r.basket_name}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                );
              })()}
            </View>
          </Animated.View>
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* ── Report modal ─────────────────────────────────────────── */}
      <Modal
        visible={reportVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={closeReport}
      >
        <View style={styles.reportOverlay}>
          {/* Tappable dim backdrop */}
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={closeReport}
          />

          {/* ── SHEET ──
              marginBottom = keyboard height pushes the whole sheet above the keyboard.
              KeyboardAvoidingView inside a <Modal> is unreliable on Android, so we
              track the keyboard height explicitly and offset the sheet here. */}
          <Animated.View
            style={[
              styles.reportSheet,
              {
                backgroundColor: theme.colors.surface,
                ...theme.shadows.shadowLg,
                marginBottom: reportKbHeight,
                transform: [{ translateY: reportSwipe.translateY }],
              },
            ]}
          >
            {/* Top swipe zone — handle pill + PanResponder so the inner
                report form (TextInput, reason chips) keeps normal tap
                behaviour while the swipe-down only fires from here. */}
            <View
              {...reportSwipe.panHandlers}
              style={{ paddingTop: 10, paddingBottom: 14, alignItems: 'center' }}
            >
              <View style={[styles.sheetHandle, { backgroundColor: theme.colors.divider }]} />
            </View>

            {/* ── Header ── */}
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text
                  style={{
                    color: theme.colors.textPrimary,
                    fontSize: 18,
                    fontWeight: '700',
                    letterSpacing: -0.3,
                  }}
                >
                  {t('report.title')}
                </Text>
                {!report.submitted && (
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: 13,
                      lineHeight: 18,
                      marginTop: 4,
                    }}
                  >
                    {t('report.cta')}
                  </Text>
                )}
              </View>
              {/* Close pill */}
              <TouchableOpacity
                onPress={closeReport}
                style={[
                  styles.sheetClosePill,
                  { backgroundColor: theme.colors.bg },
                ]}
                accessibilityLabel={t('common.close')}
              >
                <X size={16} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* ── Body ── */}
            {report.submitted ? (
              /* Confirmation screen */
              <View style={styles.confirmContainer}>
                <View
                  style={[
                    styles.confirmRing,
                    { backgroundColor: theme.colors.primary + '14', borderColor: theme.colors.primary + '30' },
                  ]}
                >
                  <Flag size={30} color={theme.colors.primary} />
                </View>
                <Text
                  style={{
                    color: theme.colors.textPrimary,
                    fontSize: 17,
                    fontWeight: '700',
                    marginTop: 20,
                    textAlign: 'center',
                    letterSpacing: -0.2,
                  }}
                >
                  {t('report.localConfirmTitle')}
                </Text>
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: 13,
                    lineHeight: 20,
                    marginTop: 8,
                    textAlign: 'center',
                    paddingHorizontal: 12,
                  }}
                >
                  {t('report.localConfirmMsg')}
                </Text>
              </View>
            ) : (
              /* Report form */
              <>
                <ScrollView
                  ref={reportScrollRef}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.sheetScrollContent}
                  style={{ flex: 1 }}
                >
                  {/* ── Motif section ── */}
                  <Text style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                    {t('report.reasonLabel').toUpperCase()}
                  </Text>

                  {(REPORT_REASONS as { key: ReportReason; label: string }[]).map(({ key, label }, index, arr) => {
                    const selected = report.reason === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => setReport((prev) => ({ ...prev, reason: key }))}
                        activeOpacity={0.72}
                        style={[
                          styles.reasonRow,
                          {
                            borderColor: selected
                              ? theme.colors.primary
                              : theme.colors.divider,
                            borderRadius: 14,
                            backgroundColor: selected
                              ? theme.colors.primary + '0d'
                              : theme.colors.surface,
                            marginBottom: index === arr.length - 1 ? 0 : 8,
                            borderWidth: selected ? 1.8 : 1,
                          },
                        ]}
                      >
                        {/* Left radio indicator */}
                        <View
                          style={[
                            styles.radioOuter,
                            {
                              borderColor: selected
                                ? theme.colors.primary
                                : theme.colors.divider,
                              backgroundColor: selected
                                ? theme.colors.primary
                                : 'transparent',
                            },
                          ]}
                        >
                          {selected && (
                            <View style={styles.radioCheckmark} />
                          )}
                        </View>

                        {/* Label */}
                        <Text
                          style={{
                            flex: 1,
                            fontSize: 14,
                            lineHeight: 20,
                            color: selected
                              ? theme.colors.textPrimary
                              : theme.colors.textSecondary,
                            fontWeight: selected ? '600' : '400',
                          }}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}

                  {/* ── Details section ── */}
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: theme.colors.textSecondary, marginTop: 24 },
                    ]}
                  >
                    {t('report.detailsLabel').toUpperCase()}
                    <Text style={{ color: theme.colors.error }}> *</Text>
                  </Text>
                  <TextInput
                    style={[
                      styles.commentInput,
                      {
                        backgroundColor: theme.colors.bg,
                        borderRadius: 14,
                        color: theme.colors.textPrimary,
                        fontSize: 14,
                        lineHeight: 20,
                        borderColor: theme.colors.divider,
                      },
                    ]}
                    placeholder={t('report.detailsPlaceholder')}
                    placeholderTextColor={theme.colors.muted}
                    multiline
                    numberOfLines={4}
                    value={report.comment}
                    onChangeText={(text) => setReport((prev) => ({ ...prev, comment: text }))}
                    onFocus={() => {
                      // Give the keyboard a moment to open, then scroll the input into view.
                      setTimeout(() => reportScrollRef.current?.scrollToEnd({ animated: true }), 250);
                    }}
                    textAlignVertical="top"
                  />
                  {/* ── Optional photo — for refund evidence ── */}
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: theme.colors.textSecondary, marginTop: 20 },
                    ]}
                  >
                    {t('report.photoLabel', { defaultValue: 'Photo (optionnel)' }).toUpperCase()}
                  </Text>
                  {report.imageDataUrl ? (
                    <View style={{ position: 'relative', marginTop: 6 }}>
                      <Image
                        source={{ uri: report.imageDataUrl }}
                        style={{ width: '100%', height: 180, borderRadius: 12, resizeMode: 'cover' }}
                      />
                      <TouchableOpacity
                        onPress={() => setReport((prev) => ({ ...prev, imageDataUrl: null }))}
                        style={{
                          position: 'absolute', top: 8, right: 8,
                          backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 14,
                          width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <X size={16} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={pickReportPhoto}
                      style={{
                        marginTop: 6, padding: 14, borderRadius: 12,
                        borderWidth: 1,
                        borderColor: theme.colors.divider,
                        backgroundColor: theme.colors.surfaceMuted,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, fontWeight: '500' }}>
                        {t('report.addPhoto', { defaultValue: 'Ajouter une photo (pour remboursement)' })}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {report.error ? (
                    <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 8, lineHeight: 16 }}>
                      {report.error}
                    </Text>
                  ) : null}

                  {/* Confidentiality note */}
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 12,
                      marginTop: 8,
                      lineHeight: 16,
                    }}
                  >
                    {t('report.localConfirmMsg', { defaultValue: '' })}
                  </Text>
                </ScrollView>

                {/* ── Fixed CTA footer ── matches the leave-review form
                    (app/review.tsx): same PrimaryCTAButton (pill, white
                    text on primary bg, larger typography, generous padding)
                    so both forms feel like part of the same family. The
                    hairline border above this footer is intentional — it
                    only appears at the screen's bottom now that the sheet
                    is rigid-height (was floating mid-screen previously). */}
                <View
                  style={[
                    styles.sheetFooter,
                    { borderTopColor: theme.colors.divider, backgroundColor: theme.colors.surface, ...theme.shadows.shadowLg },
                  ]}
                >
                  <PrimaryCTAButton
                    onPress={submitReport}
                    title={t('report.submit')}
                    loading={!!report.submitting}
                    disabled={!report.reason || !report.comment.trim()}
                    fullWidth
                  />
                </View>
              </>
            )}
          </Animated.View>
        </View>
      </Modal>
      {/* Customer demo walkthrough overlay — paints the spotlight on the
          demo surprise basket so the walkthrough's restaurantSurpriseBasket
          step is visible above this pushed Stack screen. */}
      <SubScreenWalkthroughOverlay keys={['restaurantSurpriseBasket']} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    position: 'relative',
    width: '100%',
    height: 230,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,75,60,0.18)',
  },
  backBtn: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuBtn: {
    position: 'absolute',
    top: 52,
    right: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuPopup: {
    position: 'absolute',
    top: 100,
    right: 16,
    minWidth: 220,
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  ratingsPopupSheet: {},
  infoCard: {},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ratingsCard: {
    padding: 16,
    marginBottom: 4,
  },
  body: {},
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  basketCard: {
    marginBottom: 12,
    overflow: 'hidden',
  },
  basketImage: {
    width: '100%',
    height: 120,
  },
  basketContent: {},
  basketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
    flex: 1,
  },
  basketChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // Report button
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  // ── Report modal styles ──────────────────────────────────────────
  reportOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'flex-end',
  },
  reportSheet: {
    // Rigid 85% screen height (was maxHeight) so the sheet always extends
    // to a fixed band at the bottom of the screen — matching the leave-
    // review form's full-page sticky-footer feel. Without this, a short
    // form caused the sheet to hug its content, leaving the submit button
    // floating mid-screen and pulling the footer divider close to the
    // title (which read as "title bar has a divider underneath").
    height: Dimensions.get('window').height * 0.85,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 16,
  },
  sheetClosePill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  sheetScrollContent: {
    paddingHorizontal: 24,
    // Base padding — dynamic keyboard-aware padding is added inline in contentContainerStyle.
    paddingBottom: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 12,
    textTransform: 'none',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    marginRight: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCheckmark: {
    // White checkmark square (rendered as a smaller white dot inside filled circle)
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  commentInput: {
    padding: 16,
    minHeight: 110,
    borderWidth: 1,
    lineHeight: 20,
  },
  sheetFooter: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 38 : 22,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Confirmation screen
  confirmContainer: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 36,
  },
  confirmRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmDoneBtn: {
    paddingVertical: 15,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
