import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Modal, TextInput, Animated, Alert, useWindowDimensions, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { MapPin, Clock, Navigation, ChevronLeft, Star, ShoppingBag, RefreshCw, Flag, X, Tag, Package, Bookmark, AlertTriangle, Camera } from 'lucide-react-native';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { useAuthStore } from '@/src/stores/authStore';
import * as ImagePicker from 'expo-image-picker';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useBottomSafePadding } from '@/src/hooks/useBottomSafePadding';
import { fetchBasketById } from '@/src/services/baskets';
import { fetchLocationById } from '@/src/services/restaurants';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';
import {
  DEMO_BASKET_IDS,
  buildDemoRawBasketById,
} from '@/src/lib/demoData';
import { normalizeRawBasketToBasket } from '@/src/utils/normalizeRestaurant';
import { submitReport } from '@/src/services/reports';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { apiClient } from '@/src/lib/api';
import { DelayedLoader } from '@/src/components/DelayedLoader';

// Two-stage scroll animation:
//   Stage A — image collapse window (first COLLAPSE_DISTANCE pixels).
//     Image shrinks linearly from HERO_FULL → HERO_MINI. Bag stays
//     fully hidden the whole time.
//   Stage B — bag fill-up. Image is clamped at HERO_MINI. Each piece
//     of body content that slides under the image triggers the next
//     bag slot to "shoot up" and dock inside the bag. The bag's
//     existing slots shrink to make room (no empty wasted space).
const HERO_FULL = 200;
const HERO_MINI = 135;
const COLLAPSE_DISTANCE = HERO_FULL - HERO_MINI; // 65

// Bag dimensions. Sits BETWEEN the back button (left:16, width:38)
// and the save/bookmark button (right:16, width:36) — narrower than
// the full screen, hung from the top of the cover photo. The body
// height is fixed; content inside scales down as more slots fill
// in, so a single slot occupies the full available area instead
// of leaving empty wasted space below.
const BAG_TOP = 36;
const BAG_LEFT = 62;
const BAG_RIGHT = 62;
// Three-row text stack (title / org / pickup-time). Each line stacked
// directly on top of the next, all centred, all single-line with
// ellipsis truncation. Height budget for phase 3:
//   title lh18 + 2 + org lh13 + 2 + pickup lh12 = 47
// Bag interior = BAG_BODY_HEIGHT − 2 × BAG_BODY_PAD; 8-px headroom
// covers Android baseline padding so descenders never clip the
// border. `overflow: 'hidden'` on the body is the final safety net.
const BAG_BODY_HEIGHT = 64;
const BAG_BODY_PAD = 6;

// Barakeat neon (theme.colors.secondary). Used for the bag handles
// per the user's spec — adds the brand pop against the cover photo.
const NEON = '#e3ff5c';
const BRAND_GREEN = '#114b3c';

interface ReviewBarProps {
  label: string;
  value: number;
  color: string;
}

function ReviewBar({ label, value, color }: ReviewBarProps) {
  const theme = useTheme();
  const percentage = (value / 5) * 100;

  return (
    <View style={reviewStyles.row}>
      <Text style={[reviewStyles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
        {label} <Text style={{ fontWeight: '700' as const }}>{value.toFixed(1)}</Text>
      </Text>
      <View style={[reviewStyles.barBg, { backgroundColor: theme.colors.divider, borderRadius: 4 }]}>
        <View style={[reviewStyles.barFill, { width: `${percentage}%`, backgroundColor: color, borderRadius: 4 }]} />
      </View>
    </View>
  );
}

const reviewStyles = StyleSheet.create({
  row: {
    marginBottom: 12,
  },
  label: {
    marginBottom: 6,
  },
  barBg: {
    height: 8,
    width: '100%',
  },
  barFill: {
    height: 8,
  },
});

export default function BasketDetailsScreen() {
  const { id, businessPreview } = useLocalSearchParams<{ id: string; businessPreview?: string }>();
  const isBizPreview = businessPreview === 'true';
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const customAlert = useCustomAlert();
  // Bottom-safe padding for the sticky reserve bar — keeps the CTA clear of
  // Samsung virtual nav buttons / iOS home indicator while extending the
  // bar's background colour all the way to the screen edge.
  const bottomSafePadding = useBottomSafePadding(16);

  // ALL hooks must be called before any early returns
  const [showReportModal, setShowReportModal] = useState(false);
  const [warningExpanded, setWarningExpanded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  // Pickup instructions: collapsed to 2 lines by default, tap … to expand.
  // Keeps the page scannable when the merchant writes a long paragraph.
  const [pickupExpanded, setPickupExpanded] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportImage, setReportImage] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Business preview: check if member can edit basket info
  const bizCtxQuery = useQuery({
    queryKey: ['my-context'],
    queryFn: async () => {
      const { fetchMyContext } = await import('@/src/services/teams');
      return fetchMyContext();
    },
    enabled: isBizPreview,
    staleTime: 10_000,
  });
  const bizRole = bizCtxQuery.data?.role ?? 'member';
  const bizPerms = bizCtxQuery.data?.permissions ?? {};
  const canEditBasketFromPreview = isBizPreview && (bizRole === 'owner' || bizRole === 'admin' || (bizPerms as any).edit_basket_info === 'write' || (bizPerms as any).edit_basket_info === true);

  const scrollY = useRef(new Animated.Value(0)).current;

  // Stage A — cover image collapses 200 → 135 over COLLAPSE_DISTANCE.
  const heroHeight = scrollY.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE],
    outputRange: [HERO_FULL, HERO_MINI],
    extrapolate: 'clamp',
  });

  // Three slot-activation thresholds, anchored to where each body row
  // sits in scroll-content coords. Each fires the moment the
  // corresponding piece of body content has slid fully under the
  // CLAMPED cover image (at HERO_MINI, not HERO_FULL — the image
  // has already collapsed by then).
  const TITLE_LINE_H = 28; // empirical: h2 line height + breathing room
  const [merchantRowY, setMerchantRowY] = useState<number | null>(null);
  const [merchantRowH, setMerchantRowH] = useState<number>(56);
  const [pickupRowY, setPickupRowY] = useState<number | null>(null);
  const [pickupRowH, setPickupRowH] = useState<number>(70);
  const MERCHANT_ROW_Y_EST = HERO_FULL + 16;
  const PICKUP_ROW_Y_EST = HERO_FULL + 16 + 56 + 12;
  const mRowY = merchantRowY ?? MERCHANT_ROW_Y_EST;
  const pRowY = pickupRowY ?? PICKUP_ROW_Y_EST;
  // scrollY at which each row segment is fully consumed by the image.
  // Anchored to HERO_MINI (the clamped image height); each is clamped
  // to >= COLLAPSE_DISTANCE so the bag never starts filling during
  // the image-collapse stage — image first, then bag.
  const phase1At = Math.max(COLLAPSE_DISTANCE + 4, mRowY + TITLE_LINE_H - HERO_MINI);
  const phase2At = Math.max(phase1At + 12, mRowY + merchantRowH - HERO_MINI);
  const phase3At = Math.max(phase2At + 16, pRowY + pickupRowH - HERO_MINI);

  // Bag-wide fade-in starts ALONGSIDE phase 1. Tight window — 6 px —
  // so the bag never sits half-loaded on screen.
  const bagOverlayOpacity = scrollY.interpolate({
    inputRange: [Math.max(0, phase1At - 6), phase1At],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Per-slot reveal helper for slots 2 and 3 — short snap window
  // each. Slot 1 (title) is always present from phase 1 onwards,
  // so it doesn't need its own opacity ramp.
  const SLOT_WIN = 8;
  const SLOT_RISE = 14;
  const makeReveal = (at: number) => ({
    opacity: scrollY.interpolate({
      inputRange: [Math.max(0, at - SLOT_WIN), at],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    }),
    translateY: scrollY.interpolate({
      inputRange: [Math.max(0, at - SLOT_WIN), at],
      outputRange: [SLOT_RISE, 0],
      extrapolate: 'clamp',
    }),
  });
  const orgReveal = makeReveal(phase2At);
  const pickupReveal = makeReveal(phase3At);

  // "Fill the space" sizing. The bag's INNER height is fixed; the
  // title fontSize (and the org logo size, in slot 2) interpolate
  // DOWN as more slots activate, so the visible content always
  // occupies the whole bag — no empty padding waiting for the next
  // phase. Three stops: phase 1 alone → big; +phase 2 → medium; +
  // phase 3 → small. Output values are layout props (fontSize,
  // width, height) which is why this animation must run on the
  // JS driver (Stage A's height animation forces that anyway).
  // Phase-driven sizing. Title stays visibly larger than the rest;
  // each piece sits on its own centred line, stacked. As more slots
  // activate, the title shrinks down so the three-line stack fits
  // cleanly inside the bag with safe headroom (no overflow).
  //
  //   phase 1 (title only):           title 20/24 lh    = 24 (fits 52)
  //   phase 2 (title + org):          18/21 + 2 + 13/13 = 36
  //   phase 3 (all three):            14/17 + 2 + 12/13 + 2 + 12 = 46
  const titleFontSize = scrollY.interpolate({
    inputRange: [phase1At, phase2At, phase3At],
    outputRange: [20, 16, 13],
    extrapolate: 'clamp',
  });
  const titleLineHeight = scrollY.interpolate({
    inputRange: [phase1At, phase2At, phase3At],
    outputRange: [24, 19, 16],
    extrapolate: 'clamp',
  });
  const orgFontSize = scrollY.interpolate({
    inputRange: [phase2At, phase3At],
    outputRange: [11, 10],
    extrapolate: 'clamp',
  });

  // Demo short-circuit: any of the three synthetic demo basket ids serves
  // fixture data instead of hitting the backend. URL-based (not flag-based)
  // so the page works even if `demoCustomerActive` is momentarily false due
  // to a race in the walkthrough engine — the basket ids `demo-basket*` are
  // ours and can never collide with real backend records.
  useWalkthroughStore((s) => s.demoCustomerActive); // subscribe for re-render
  const isDemoBasket = (DEMO_BASKET_IDS as readonly string[]).includes(String(id));

  const restaurantQuery = useQuery({
    queryKey: ['basket', id],
    queryFn: () => fetchBasketById(String(id)),
    enabled: !!id && !isDemoBasket,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 2,
  });

  const demoLocationName = t('walkthrough.customer.demoLocationName', { defaultValue: 'Chez Joe (démo)' });
  const demoBasketRaw: any = isDemoBasket
    ? buildDemoRawBasketById(String(id), { restaurantName: demoLocationName })
    : null;

  // Redundant step-advance + currentStep publish: same reason as on
  // /restaurant/demo — the (tabs)/_layout listener lags when backgrounded.
  React.useEffect(() => {
    if (!isDemoBasket) return;
    const state = useWalkthroughStore.getState();
    // Clear the stale rect from any previous demo run BEFORE the page lays
    // out (see restaurant/[id].tsx for the same fix and rationale — kills
    // the "wrong halo first, then corrects" flash when the SubScreen
    // overlay's fast-path would otherwise grab the old rect).
    state.setMeasuredRect('basketReserveBtn', null);
    if (state.currentStep?.measureKey !== 'restaurantSurpriseBasket') return;
    state.nextStep(Number.MAX_SAFE_INTEGER);
    state.setCurrentStep({
      measureKey: 'basketReserveBtn',
      titleKey: 'walkthrough.customer.reserveBtn.title',
      descKey: 'walkthrough.customer.reserveBtn.desc',
      tooltipPosition: 'top',
      isLast: false,
      stepIndex: 3,
      totalSteps: 20,
      requireTap: true,
      target: { bottom: 40, left: 16, width: Dimensions.get('window').width - 32, height: 56, radius: 14 },
    });
  }, [isDemoBasket]);

  // The basket endpoint at chez joe returns pickup_start/end = NULL meaning
  // "inherit the location's current hours". The basket payload itself does
  // NOT embed those hours, so we fetch the parent location separately and
  // pass its pickup window as the inheritance fallback to the normaliser.
  // Without this, the normaliser would slap on its hardcoded 18:00–19:00
  // default and the basket would render expired with a "6 PM – 7 PM" window.
  const rawBasketForLoc = restaurantQuery.data as any;
  const inferredLocationId: string | number | undefined =
    rawBasketForLoc?.location_id
    ?? rawBasketForLoc?.restaurant_id
    ?? rawBasketForLoc?.location?.id
    ?? rawBasketForLoc?.restaurant?.id;
  const basketHasOwnTimes = !!(rawBasketForLoc?.pickup_start_time && rawBasketForLoc?.pickup_end_time);
  const locationDefaultsQuery = useQuery({
    queryKey: ['basket-location-hours', String(inferredLocationId ?? '')],
    queryFn: () => fetchLocationById(String(inferredLocationId!)),
    // Only fire when we actually need location defaults — i.e., the basket
    // has NULL pickup times AND we have a location id to look up.
    enabled: !!inferredLocationId && !basketHasOwnTimes && !isDemoBasket,
    staleTime: 5 * 60_000,
  });
  // Pull whichever shape the basket OR the parallel location query exposes,
  // so future backend changes that DO embed location data on the basket
  // payload still work without a code change.
  const locDefaultStart =
    rawBasketForLoc?.location?.pickup_start_time
    ?? rawBasketForLoc?.location_pickup_start_time
    ?? rawBasketForLoc?.restaurant?.pickup_start_time
    ?? rawBasketForLoc?.restaurant_pickup_start_time
    ?? (locationDefaultsQuery.data as any)?.pickup_start_time
    ?? null;
  const locDefaultEnd =
    rawBasketForLoc?.location?.pickup_end_time
    ?? rawBasketForLoc?.location_pickup_end_time
    ?? rawBasketForLoc?.restaurant?.pickup_end_time
    ?? rawBasketForLoc?.restaurant_pickup_end_time
    ?? (locationDefaultsQuery.data as any)?.pickup_end_time
    ?? null;
  const basket = isDemoBasket && demoBasketRaw
    ? normalizeRawBasketToBasket(demoBasketRaw as any)
    : (restaurantQuery.data
        ? normalizeRawBasketToBasket(restaurantQuery.data as any, undefined, {
            start: locDefaultStart,
            end: locDefaultEnd,
          })
        : null);

  // Fetch menu items — only if business explicitly enabled (show_menu_items === true)
  const rawData = restaurantQuery.data as any;
  const showMenuItems = rawData?.show_menu_items === true;
  // Prefer the backend's COALESCE'd `effective_pickup_instructions` so the
  // buyer sees the location's instructions whenever the basket itself has
  // no override (the "use same as location" checkbox case — basket column
  // is NULL). Falling back to the raw `pickup_instructions` column kept
  // the buyer view blank in that case, even though the location had text
  // set and the partner's edit modal correctly previewed the inherited
  // value.
  const pickupInstructions = rawData?.effective_pickup_instructions ?? rawData?.pickup_instructions ?? null;
  const locationId = basket?.merchantId;
  const basketId = String(id);

  const basketMenuItemsQuery = useQuery({
    queryKey: ['basket-menu-items', basketId],
    queryFn: async () => {
      const res = await apiClient.get<any>(`/api/baskets/${basketId}/menu-items`);
      const data = res.data;
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'items' in data) return data.items;
      return [];
    },
    enabled: showMenuItems && !!basketId,
    retry: 1,
  });

  const locationMenuItemsQuery = useQuery({
    queryKey: ['menu-items', locationId],
    queryFn: async () => {
      const res = await apiClient.get<any>(`/api/locations/${locationId}/menu-items`);
      const data = res.data;
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'items' in data) return data.items;
      return [];
    },
    enabled: showMenuItems && !!locationId && (basketMenuItemsQuery.isError || (basketMenuItemsQuery.isSuccess && (basketMenuItemsQuery.data ?? []).length === 0)),
    retry: 1,
  });

  const menuItems: { id: number; name: string; description?: string | null; image_url?: string | null }[] = showMenuItems
    ? ((basketMenuItemsQuery.data ?? []).length > 0 ? basketMenuItemsQuery.data : locationMenuItemsQuery.data) ?? []
    : [];

  const [selectedMenuItem, setSelectedMenuItem] = useState<{ name: string; description?: string | null } | null>(null);

  const overallRating = basket?.reviews
    ? ((basket.reviews.service + basket.reviews.quantite + basket.reviews.qualite + basket.reviews.variete) / 4).toFixed(1)
    : basket?.merchantRating?.toFixed(1) ?? '0.0';

  // Must be called before early returns (Rules of Hooks)
  const { isBasketTypeStarred, toggleStarredBasketType } = useFavoritesStore();
  const isStarred = isBasketTypeStarred(String(id));
  const authUser = useAuthStore((s) => s.user);
  const isBusiness = authUser?.role === 'business';
  const { width: screenWidth } = useWindowDimensions();
  const isWideScreen = screenWidth > 600;
  // Horizontal padding for the sticky bottom CTA bar, derived as a
  // percentage of screen width so narrow phones (≤360 px Galaxy S) and
  // wider phones (≥412 px Pixel/Pro Max) keep visually equivalent edge
  // breathing room — fixed-px paddings made narrow screens look pinched
  // while wider screens stayed loose. 5.5 % of width works out to ~20 px
  // on a narrow phone and ~24 px on a wide phone; floored at 16 px so
  // truly tiny screens (<290 px, very rare) still get a sensible gap.
  const bottomBarHPadding = isWideScreen ? 40 : Math.max(16, Math.round(screenWidth * 0.055));

  if (restaurantQuery.isLoading && !isDemoBasket) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16, zIndex: 10 }]}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <DelayedLoader />
      </View>
    );
  }

  if ((restaurantQuery.isError && !isDemoBasket) || !basket) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16, zIndex: 10 }]}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center' as const, marginBottom: 16 }]}>
          {t('common.errorOccurred')}
        </Text>
        <TouchableOpacity
          onPress={() => restaurantQuery.refetch()}
          style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: 20, paddingVertical: 12 }]}
        >
          <RefreshCw size={16} color="#fff" />
          <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
            {t('common.retry')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleReserve = () => {
    router.push({ pathname: '/reserve', params: { basketId: basket.id } } as any);
  };

  const handleDirections = () => {
    const query = basket?.hasCoords
      ? `${basket.latitude},${basket.longitude}`
      : encodeURIComponent(basket?.address ?? '');
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };

  const handleReport = async () => {
    const detailsTrimmed = reportDetails.trim();
    if (!reportReason.trim()) return;
    if (!detailsTrimmed) {
      customAlert.showAlert(
        t('common.error'),
        t('report.detailsRequired', { defaultValue: 'Please describe the problem.' }),
      );
      return;
    }
    setReportLoading(true);
    try {
      await submitReport({ restaurant_id: basket?.merchantId ?? String(id), reason: reportReason.trim(), details: detailsTrimmed, image_url: reportImage || undefined });
      customAlert.showAlert(t('common.success'), t('report.success'));
      setShowReportModal(false);
      setReportReason('');
      setReportDetails('');
    } catch {
      customAlert.showAlert(t('common.error'), t('report.error'));
    } finally {
      setReportLoading(false);
    }
  };

  const categoryKey = basket.category?.toLowerCase() ?? '';
  const isGenericCategory = !categoryKey || categoryKey === 'all' || categoryKey === 'tous' || categoryKey === 'all' || categoryKey === 'كل';
  const categoryLabel = !isGenericCategory
    ? t(`categories.${categoryKey}`, { defaultValue: basket.category ?? '' })
    : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />

      {/* Stage A — animated hero. The cover photo shrinks 200 → 135
          on the first ~65 px of scroll, then stays clamped. */}
      <Animated.View style={[styles.heroContainer, { height: heroHeight }]}>
        <Animated.Image
          source={basket.imageUrl ? { uri: basket.imageUrl } : undefined}
          style={styles.heroImage}
        />
        {!basket.imageUrl && (
          <View style={[styles.heroPlaceholder, { backgroundColor: theme.colors.bagsLeftBg }]} />
        )}
        <View style={styles.heroOverlay} />

        {/* Quantity / category badges — bottom-right of photo. The
            quantity pill STAYS HERE through the whole scroll (it is
            NOT docked into the bag) per the latest design call. */}
        <View style={{ position: 'absolute', bottom: 12, right: theme.spacing.lg, flexDirection: 'row', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: basket.quantityLeft <= 0 ? theme.colors.error : NEON, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
            <ShoppingBag size={12} color={basket.quantityLeft <= 0 ? '#fff' : BRAND_GREEN} />
            <Text style={{ color: basket.quantityLeft <= 0 ? '#fff' : BRAND_GREEN, fontSize: 11, fontWeight: '700', marginLeft: 4 }}>
              {basket.quantityLeft}
            </Text>
          </View>
          {categoryLabel ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Tag size={11} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginLeft: 4 }}>
                {categoryLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </Animated.View>

      {/* Stage B — bag overlay. Sits BETWEEN the back button (left:16,
          width:38) and the save/bookmark button (right:16, width:36),
          so it's narrower than the full screen and hangs from the top
          of the cover photo. Stays fully invisible until the title
          slides under the now-clamped image (phase 1). Each subsequent
          slot "shoots up" as another body piece slides behind the
          cover; existing slots SHRINK to keep the bag visually full
          (no empty padding waiting for content). */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: BAG_TOP,
          left: BAG_LEFT,
          right: BAG_RIGHT,
          zIndex: 15,
          opacity: bagOverlayOpacity,
        }}
      >
        {/* Bag handles — two arches in BRAND GREEN, matching the
            bag body's border for a cohesive shopper-bag silhouette
            against the cover photo. */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginBottom: -8 }}>
          {[0, 1].map((i) => (
            <View key={i} style={{
              width: 32,
              height: 14,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderWidth: 3,
              borderBottomWidth: 0,
              borderColor: BRAND_GREEN,
              backgroundColor: 'transparent',
            }} />
          ))}
        </View>

        {/* Bag body — fixed-height stack. Uses brand green border, deep
            shadow, and asymmetric corner radii (slightly more rounded
            at the bottom) so it reads like a soft folded bag bottom.
            `overflow: hidden` clips slots that haven't shot up yet. */}
        <View style={{
          backgroundColor: '#fff',
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          borderBottomLeftRadius: 22,
          borderBottomRightRadius: 22,
          borderWidth: 1.5,
          borderColor: BRAND_GREEN,
          height: BAG_BODY_HEIGHT,
          // Horizontal padding stops text from kissing the green border;
          // combined with `numberOfLines={1}` + `ellipsizeMode="tail"`
          // on each line, a very long basket name / org name truncates
          // cleanly with a "…" instead of bleeding past the corner.
          paddingHorizontal: 12,
          paddingVertical: BAG_BODY_PAD,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.18,
          shadowRadius: 6,
          elevation: 6,
        }}>
          {/* Slot 1 — basket title. Always present from phase 1 on. */}
          <Animated.Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              color: BRAND_GREEN,
              fontFamily: 'Poppins_700Bold',
              fontSize: titleFontSize,
              lineHeight: titleLineHeight,
              textAlign: 'center',
              includeFontPadding: false,
            }}
          >
            {basket.name}
          </Animated.Text>

          {/* Slot 2 — org name, stacked DIRECTLY BELOW the title.
              Single centred line; truncates to ellipsis if too long
              for the bag's interior width. */}
          <Animated.Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              color: theme.colors.textSecondary,
              fontFamily: 'Poppins_500Medium',
              fontSize: orgFontSize,
              lineHeight: 13,
              textAlign: 'center',
              includeFontPadding: false,
              marginTop: 2,
              opacity: orgReveal.opacity,
              transform: [{ translateY: orgReveal.translateY }],
            }}
          >
            {basket.merchantName}
          </Animated.Text>

          {/* Slot 3 — pickup window, stacked BELOW the org name. */}
          <Animated.Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              color: BRAND_GREEN,
              fontFamily: 'Poppins_700Bold',
              fontSize: 10,
              lineHeight: 12,
              textAlign: 'center',
              includeFontPadding: false,
              marginTop: 2,
              opacity: pickupReveal.opacity,
              transform: [{ translateY: pickupReveal.translateY }],
            }}
          >
            {basket.pickupWindow.start}–{basket.pickupWindow.end}
          </Animated.Text>
        </View>
      </Animated.View>

      {/* Always-visible top action buttons. Rendered AS SIBLINGS of the
          hero (not inside it) so they sit above every animated layer and
          never get clipped — the user's request was "shouldn't hide at
          all, always clear". Higher zIndex than the bag (6) so they
          stay readable even where they overlap. */}
      <TouchableOpacity
        style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', ...theme.shadows.shadowMd, zIndex: 20 }]}
        onPress={() => router.back()}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <ChevronLeft size={22} color={theme.colors.textPrimary} />
      </TouchableOpacity>

      {!isBusiness && (
      <View style={{ position: 'absolute', top: 52, right: 16, flexDirection: 'row', gap: 8, zIndex: 20 }}>
        <TouchableOpacity
          onPress={() => toggleStarredBasketType(String(id))}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' }}
        >
          <Bookmark size={18} color={isStarred ? '#e3ff5c' : '#fff'} fill={isStarred ? '#e3ff5c' : 'transparent'} />
        </TouchableOpacity>
      </View>
      )}

      {/* Scrollable content. JS driver on the scroll event because
          Stage A animates the hero `height` (a layout prop), which
          can't run on the native driver. Performance impact is
          minimal on modern devices at 60 FPS, and the tighter snap
          windows below keep the bag transitions feeling crisp. */}
      <Animated.ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        contentContainerStyle={{ paddingBottom: 120 + bottomSafePadding }}
      >
        {/* Spacer so content starts below the hero at its FULL size.
            The spacer doesn't shrink with the image — body always
            starts at y = HERO_FULL in scroll-content coordinates. */}
        <View style={{ height: HERO_FULL }} />

        <View style={[styles.content, { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }]}>
          {/* Name + merchant. Measured via onLayout — the row's y +
              first-line-height anchors phase 1 (title hides), and y +
              full-height anchors phase 2 (org/logo hide). */}
          <View
            style={styles.merchantRow}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              // `y` is relative to the parent .content View, which sits
              // at y = HERO_FULL inside the ScrollView (the spacer above
              // takes that much vertical space). Add HERO_FULL for the
              // absolute scroll-content y.
              const absY = y + HERO_FULL;
              if (merchantRowY !== absY) setMerchantRowY(absY);
              if (merchantRowH !== height) setMerchantRowH(height);
            }}
          >
            {basket.merchantLogo ? (
              <Image source={{ uri: basket.merchantLogo }} style={styles.merchantLogo} />
            ) : (
              <View style={[styles.merchantLogo, { backgroundColor: theme.colors.divider }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {basket.name}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                {basket.merchantName}
              </Text>
            </View>
          </View>

          {/* Dietary / allergen tags — only rendered when the basket has tags
              set (the field is optional on the backend; an empty array hides
              the row entirely so we don't show a placeholder for restaurants
              that haven't filled this in yet). */}
          {(() => {
            const tags: string[] = Array.isArray((basket as any).dietaryTags)
              ? (basket as any).dietaryTags
              : Array.isArray((basket as any).dietary_tags)
                ? (basket as any).dietary_tags
                : [];
            if (tags.length === 0) return null;
            return (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: theme.spacing.sm }}>
                {tags.map((tag) => {
                  const key = String(tag).toLowerCase();
                  const label = t(`basket.dietary.${key}`, { defaultValue: String(tag) });
                  return (
                    <View
                      key={key}
                      style={{
                        backgroundColor: theme.colors.primary + '14',
                        borderColor: theme.colors.primary + '40',
                        borderWidth: 1,
                        borderRadius: theme.radii.pill,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}
                    >
                      <Text style={{ color: theme.colors.primary, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                        {label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })()}

          {/* Pickup time (left) + Address/directions (right). Measured
              via onLayout so phase 3 (pickup hides → row appears in the
              bag) anchors to this row's actual position. No opacity
              animation here — the cover image covers it as it scrolls
              past, no need to fade. */}
          <View
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              const absY = y + HERO_FULL;
              if (pickupRowY !== absY) setPickupRowY(absY);
              if (pickupRowH !== height) setPickupRowH(height);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r12,
              padding: theme.spacing.md,
              marginTop: theme.spacing.md,
              ...theme.shadows.shadowSm,
            }}>
            {/* Left: pickup window */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 12 }}>
              <Clock size={14} color={theme.colors.primary} />
              <View style={{ marginLeft: 6 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular' }}>
                  {t('basket.pickup', { defaultValue: 'Retrait' })}
                </Text>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const }}>
                  {basket.pickupWindow.start} – {basket.pickupWindow.end}
                </Text>
              </View>
            </View>

            {/* Divider */}
            <View style={{ width: 1, height: 32, backgroundColor: theme.colors.divider }} />

            {/* Right: address + itinerary */}
            {basket.address ? (
              <TouchableOpacity onPress={handleDirections} activeOpacity={0.7} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 12 }}>
                <MapPin size={14} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, flex: 1, marginLeft: 6 }} numberOfLines={1}>
                  {basket.address}
                </Text>
                <View style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r8, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 6 }}>
                  <Navigation size={11} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>{t('basket.getDirections')}</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </View>

          {/* Three expandable sections (description, warning, pickup instructions)
              share the same affordance: when the text would overflow at the
              chosen line cap, render an inline "..." in primary colour at the
              end of the truncated text. Tapping anywhere on the section
              toggles expand/collapse. We compute `needsExpand` from a
              char-count + newline heuristic instead of `onTextLayout` —
              `numberOfLines` truncates BEFORE the layout callback fires on
              most RN versions, so the older auto-detection never triggered
              and the affordance never appeared. */}

          {/* What you can find — single text block with inline "..." */}
          <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
              {t('basket.whatInside', { defaultValue: 'Que pouvez-vous trouver dans vos paniers ?' })}
            </Text>
            {(() => {
              const itemsStr = basket.exampleItems?.length ? basket.exampleItems.join(', ') : null;
              // Avoid duplicating description if items are the same text
              const descText = basket.description
                ? (itemsStr && itemsStr !== basket.description ? `${basket.description} — ${itemsStr}` : basket.description)
                : (itemsStr || t('basket.whatInsideDefault', { defaultValue: 'Un assortiment surprise de produits frais du jour, sélectionnés par le commerçant.' }));
              const isPlaceholder = !basket.description && (!basket.exampleItems || basket.exampleItems.length === 0);
              const needsExpand = !isPlaceholder && (descText.length > 140 || /\n/.test(descText));
              return (
                <TouchableOpacity activeOpacity={needsExpand ? 0.7 : 1} onPress={() => { if (needsExpand) setDescExpanded(!descExpanded); }}>
                  <Text
                    style={{ color: isPlaceholder ? theme.colors.muted : theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22, fontStyle: isPlaceholder ? 'italic' : 'normal' }}
                    numberOfLines={descExpanded ? undefined : 3}
                  >
                    {descText}
                    {needsExpand && !descExpanded && (
                      <Text style={{ color: theme.colors.primary, fontWeight: '700' }}> ...</Text>
                    )}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>

          {/* Surprise basket info warning — inline "..." when truncated */}
          {(() => {
            const warningText = t('basket.surpriseWarning', { defaultValue: 'Ceci est un panier surprise ! Le contenu exact varie chaque jour selon les invendus du commerçant. Vous pourriez recevoir des articles différents de ceux indiqués.' });
            const warningNeedsExpand = warningText.length > 90 || /\n/.test(warningText);
            return (
              <TouchableOpacity
                onPress={() => { if (warningNeedsExpand) setWarningExpanded(!warningExpanded); }}
                activeOpacity={warningNeedsExpand ? 0.7 : 1}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  backgroundColor: '#eff35c18',
                  borderRadius: theme.radii.r12,
                  padding: theme.spacing.md,
                  marginTop: theme.spacing.md,
                  gap: 10,
                  borderWidth: 1,
                  borderColor: '#eff35c40',
                }}>
                <AlertTriangle size={16} color="#b8a600" style={{ marginTop: 2 }} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1, lineHeight: 18 }} numberOfLines={warningExpanded ? undefined : 2}>
                  {warningText}
                  {warningNeedsExpand && !warningExpanded && (
                    <Text style={{ color: '#b8a600', fontWeight: '700' }}> ...</Text>
                  )}
                </Text>
              </TouchableOpacity>
            );
          })()}

          {/* Pickup Instructions — inline "..." when truncated */}
          {(() => {
            const text = pickupInstructions || t('basket.noPickupInstructions', { defaultValue: 'Pas d\'instructions spéciales. Présentez votre code de retrait à l\'arrivée.' });
            const isPlaceholder = !pickupInstructions;
            const needsExpand = !isPlaceholder && (text.length > 90 || /\n/.test(text));
            return (
              <TouchableOpacity
                activeOpacity={needsExpand ? 0.7 : 1}
                onPress={() => { if (needsExpand) setPickupExpanded((v) => !v); }}
                style={[styles.section, { marginTop: theme.spacing.lg, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, padding: theme.spacing.md, ...theme.shadows.shadowSm }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.sm }}>
                  <Package size={16} color={theme.colors.primary} />
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginLeft: 8, flex: 1 }]}>
                    {t('basket.pickupInstructions')}
                  </Text>
                </View>
                <Text
                  numberOfLines={pickupExpanded ? undefined : 2}
                  style={[{ color: isPlaceholder ? theme.colors.muted : theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22, fontStyle: isPlaceholder ? 'italic' : 'normal' as const }]}
                >
                  {text}
                  {needsExpand && !pickupExpanded && (
                    <Text style={{ color: theme.colors.primary, fontWeight: '700' }}> ...</Text>
                  )}
                </Text>
              </TouchableOpacity>
            );
          })()}

          {/* Menu Items — only if business explicitly enabled show_menu_items */}
          {FeatureFlags.ENABLE_MENU_ITEMS && showMenuItems && menuItems.length > 0 && (
            <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
                {t('basket.menuItems')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                {menuItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => item.description ? setSelectedMenuItem({ name: item.name, description: item.description }) : undefined}
                    activeOpacity={item.description ? 0.7 : 1}
                    style={{ width: 130, marginHorizontal: 4, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, overflow: 'hidden', ...theme.shadows.shadowSm }}
                  >
                    {item.image_url ? (
                      <Image source={{ uri: item.image_url }} style={{ width: 130, height: 90 }} />
                    ) : (
                      <View style={{ width: 130, height: 90, backgroundColor: theme.colors.divider, justifyContent: 'center', alignItems: 'center' }}>
                        <ShoppingBag size={24} color={theme.colors.muted} />
                      </View>
                    )}
                    <Text numberOfLines={2} style={{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '600', padding: 8, textAlign: 'center' }}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Reviews */}
          {basket.reviews && (
            <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
              <View style={styles.reviewHeader}>
                <View>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                    {t('basket.overallExperience')}
                  </Text>
                  {basket.reviewCount != null && (
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
                      {t('basket.basedOnReviews', { count: basket.reviewCount })}
                    </Text>
                  )}
                </View>
                <View style={[styles.overallBadge, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12 }]}>
                  <Star size={16} color="#fff" fill="#fff" />
                  <Text style={[{ color: '#fff', ...theme.typography.h3, fontWeight: '700', marginLeft: 4 }]}>
                    {overallRating}
                  </Text>
                </View>
              </View>
              <View style={[styles.reviewBarsContainer, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, marginTop: theme.spacing.md, ...theme.shadows.shadowSm }]}>
                <ReviewBar label={t('basket.reviewService')} value={basket.reviews.service} color={theme.colors.primary} />
                <ReviewBar label={t('basket.reviewQualite')} value={basket.reviews.qualite} color={theme.colors.primary} />
                <ReviewBar label={t('basket.reviewVariete')} value={basket.reviews.variete} color={theme.colors.secondary} />
                <ReviewBar label={t('basket.reviewQuantite')} value={basket.reviews.quantite} color={theme.colors.secondary} />
              </View>
            </View>
          )}
        </View>
      </Animated.ScrollView>

      {/* Sticky bottom bar */}
      {isBizPreview ? (
        // Business preview — price + edit button
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.surface, paddingHorizontal: bottomBarHPadding, paddingTop: theme.spacing.lg, paddingBottom: bottomSafePadding, borderTopWidth: 1, borderTopColor: theme.colors.divider, ...theme.shadows.shadowLg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View>
            {basket.originalPrice > 0 && basket.originalPrice > basket.discountedPrice && (
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through' }}>
                {basket.originalPrice} TND
              </Text>
            )}
            <Text style={{ color: theme.colors.primary, fontSize: 22, fontWeight: '800', fontFamily: 'Poppins_700Bold' }}>
              {basket.discountedPrice} TND
            </Text>
          </View>
          <View style={{ width: isWideScreen ? 260 : 180 }}>
            <PrimaryCTAButton
              onPress={() => router.push(`/business/create-basket?editId=${id}` as never)}
              compact
              borderRadius={16}
              title={t(
                isWideScreen ? 'business.baskets.editBasket' : 'business.baskets.editBasketShort',
                { defaultValue: isWideScreen ? 'Modifier le panier' : 'Modifier' },
              )}
            />
          </View>
        </View>
      ) : (
        // Customer view — price + reserve button
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: theme.colors.surface, paddingHorizontal: bottomBarHPadding, paddingTop: theme.spacing.lg, paddingBottom: bottomSafePadding, borderTopWidth: 1, borderTopColor: theme.colors.divider, ...theme.shadows.shadowLg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View>
            {basket.originalPrice > 0 && basket.originalPrice > basket.discountedPrice && (
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through' }}>
                {basket.originalPrice} TND
              </Text>
            )}
            <Text style={{ color: theme.colors.primary, fontSize: 22, fontWeight: '800', fontFamily: 'Poppins_700Bold' }}>
              {basket.discountedPrice} TND
            </Text>
          </View>
          <View
            style={{ width: isWideScreen ? 260 : 180 }}
            onLayout={(e) => {
              (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('basketReserveBtn', { x, y, w, h });
              });
            }}
          >
            <PrimaryCTAButton
              onPress={handleReserve}
              compact
              borderRadius={16}
              title={
                basket.quantityLeft <= 0
                  ? t('basket.soldOut')
                  : isPickupExpiredInTz(basket.pickupWindow?.end)
                  ? t('orders.status.expired')
                  : t('basket.reserve')
              }
              // Demo mode bypasses the sold-out / pickup-expired gates so the
              // walkthrough's reserve step can always be tapped — otherwise
              // a real pickup window that's already closed would freeze the
              // demo at this step.
              disabled={!isDemoBasket && (basket.quantityLeft <= 0 || isPickupExpiredInTz(basket.pickupWindow?.end))}
            />
          </View>
        </View>
      )}

      {/* Menu item description popup */}
      <Modal visible={!!selectedMenuItem} transparent animationType="fade" onRequestClose={() => setSelectedMenuItem(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={() => setSelectedMenuItem(null)}>
          <View style={{ width: '100%', maxWidth: 340, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }} onStartShouldSetResponder={() => true}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, flex: 1 }}>{selectedMenuItem?.name}</Text>
              <TouchableOpacity onPress={() => setSelectedMenuItem(null)} style={{ marginLeft: 8 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22 }}>
              {selectedMenuItem?.description}
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showReportModal} transparent animationType="fade" onRequestClose={() => setShowReportModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={() => setShowReportModal(false)}>
          <View style={{ width: '100%', maxWidth: 400, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }} onStartShouldSetResponder={() => true}>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }}>{t('report.title')}</Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }}>{t('report.reasonLabel')}</Text>
            <TextInput
              style={{ height: 48, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 16, color: theme.colors.textPrimary, ...theme.typography.body }}
              value={reportReason}
              onChangeText={setReportReason}
              placeholder={t('report.reasonPlaceholder')}
              placeholderTextColor={theme.colors.muted}
            />
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }}>
              {t('report.detailsLabel')}
              <Text style={{ color: theme.colors.error }}> *</Text>
            </Text>
            <TextInput
              style={{ height: 100, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 16, paddingTop: 12, color: theme.colors.textPrimary, ...theme.typography.body, textAlignVertical: 'top' }}
              value={reportDetails}
              onChangeText={setReportDetails}
              placeholder={t('report.detailsPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              multiline
            />
            {/* Photo (optional) */}
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  t('common.addPhoto', { defaultValue: 'Ajouter une photo' }),
                  undefined,
                  [
                    { text: t('common.takePhoto', { defaultValue: 'Prendre une photo' }), onPress: async () => {
                      const { status } = await ImagePicker.requestCameraPermissionsAsync();
                      if (status !== 'granted') return;
                      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7 });
                      if (!result.canceled && result.assets?.[0]) setReportImage(result.assets[0].uri);
                    }},
                    { text: t('common.chooseFromGallery', { defaultValue: 'Choisir depuis la galerie' }), onPress: async () => {
                      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                      if (status !== 'granted') return;
                      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, quality: 0.7 });
                      if (!result.canceled && result.assets?.[0]) setReportImage(result.assets[0].uri);
                    }},
                    { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
                  ]
                );
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: theme.spacing.lg, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, borderWidth: 1, borderColor: theme.colors.divider }}
            >
              <Camera size={16} color={theme.colors.textSecondary} />
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, flex: 1 }}>
                {t('report.addPhoto', { defaultValue: 'Ajouter une photo (optionnel)' })}
              </Text>
            </TouchableOpacity>
            {reportImage && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
                <Image source={{ uri: reportImage }} style={{ width: 60, height: 60, borderRadius: 10 }} />
                <TouchableOpacity onPress={() => setReportImage(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <X size={16} color={theme.colors.error} />
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity
              onPress={handleReport}
              disabled={reportLoading || !reportReason.trim() || !reportDetails.trim()}
              style={{ backgroundColor: theme.colors.error, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl, opacity: reportLoading || !reportReason.trim() || !reportDetails.trim() ? 0.5 : 1 }}
            >
              <Text style={{ color: '#fff', ...theme.typography.button, textAlign: 'center' }}>{reportLoading ? t('common.loading') : t('report.submit')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      {/* Customer demo walkthrough overlay — paints the spotlight on the
          reserve CTA so the walkthrough's basketReserveBtn step is visible
          above this pushed Stack screen. */}
      <SubScreenWalkthroughOverlay keys={['basketReserveBtn']} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  heroContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,75,60,0.25)',
  },
  backButton: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  content: {},
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  merchantLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  section: {},
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overallBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reviewBarsContainer: {},
});
