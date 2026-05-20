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
} from 'react-native';
import type { NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, MapPin, ShoppingBag, Clock, Star, Tag, Flag, X, ChevronRight, TimerOff, Navigation, Heart } from 'lucide-react-native';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchBasketsByLocation } from '@/src/services/baskets';
import { fetchReviewsByRestaurant, ReviewFromAPI } from '@/src/services/reviews';
import { fetchMyReservations } from '@/src/services/reservations';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { normalizeRawBasketToBasket, mapCategory } from '@/src/utils/normalizeRestaurant';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import * as ImagePicker from 'expo-image-picker';
import { submitReport as submitReportApi } from '@/src/services/reports';

const DESC_COLLAPSED_LINES = 3;

// ── Report flow types ──────────────────────────────────────────────────────────
type ReportReason = 'food_quality' | 'wrong_info' | 'hygiene' | 'behavior' | 'other';

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
  hygiene: 'hygiene',
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
          {value != null ? value.toFixed(1) : '—'}
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
  const [descExpanded, setDescExpanded] = useState(false);
  const [descNeedsSeeMore, setDescNeedsSeeMore] = useState(false);
  const [ratingsPopupVisible, setRatingsPopupVisible] = useState(false);
  const [ratingsExpanded, setRatingsExpanded] = useState(false);
  const ratingsStartY = useRef(0);
  const screenHeight = Dimensions.get('window').height;
  const ratingsHeight = useRef(new Animated.Value(screenHeight * 0.55)).current;

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
      setRatingsPopupVisible(false);
      return false;
    });
  }, [ratingsHeight, screenHeight]);

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
    { key: 'hygiene', label: t('report.reasons.hygiene', { defaultValue: 'Hygiene concern' }) },
    { key: 'behavior', label: t('report.reasons.behavior', { defaultValue: 'Inappropriate behavior' }) },
    { key: 'other', label: t('report.reasons.other', { defaultValue: 'Other' }) },
  ];

  // Fetch location data (replaces restaurant)
  const locationQuery = useQuery({
    queryKey: ['location', id],
    queryFn: () => fetchLocationById(String(id)),
    enabled: !!id,
  });

  // Fetch baskets belonging to this location
  const basketsQuery = useQuery({
    queryKey: ['baskets-by-location', id],
    queryFn: () => fetchBasketsByLocation(String(id)),
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 1,
  });

  // Refetch on focus so quantities stay fresh after navigating back from a basket
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      basketsQuery.refetch();
      locationQuery.refetch();
    }, [id, basketsQuery, locationQuery])
  );

  // Gate the "signaler ce commerce" affordance behind having ordered from this location.
  // Reuses the shared ['reservations'] cache used by the orders tab — no extra request in most cases.
  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    staleTime: 60_000,
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

  const restaurant = locationQuery.data;

  const rawBaskets = basketsQuery.data ?? [];
  const baskets = rawBaskets.map((b) => normalizeRawBasketToBasket(b as any, restaurant?.name));

  const reviewsQuery = useQuery({
    queryKey: ['restaurant-reviews', id],
    queryFn: () => fetchReviewsByRestaurant(String(id)),
    enabled: !!id,
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

  const isLoading = locationQuery.isLoading;

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

  const assetToDataUrl = (asset: ImagePicker.ImagePickerAsset): string | null => {
    if (!asset.base64) return null;
    const mime = asset.mimeType || 'image/jpeg';
    return `data:${mime};base64,${asset.base64}`;
  };

  const pickReportPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets?.[0]) {
      const dataUrl = assetToDataUrl(result.assets[0]);
      if (dataUrl) setReport((prev) => ({ ...prev, imageDataUrl: dataUrl }));
    }
  };

  const submitReport = async () => {
    if (!report.reason || report.submitting) return;
    if (!id) return;
    setReport((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await submitReportApi({
        location_id: Number(id),
        reason: REPORT_REASON_API_MAP[report.reason],
        details: report.comment.trim() || undefined,
        image_data_url: report.imageDataUrl || undefined,
      });
      setReport((prev) => ({ ...prev, submitted: true, submitting: false }));
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Submission failed';
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
          {restaurant?.category ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Tag size={12} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }]}>
                {t(`home.categories.${mapCategory(restaurant.category)}`, { defaultValue: restaurant.category })}
              </Text>
            </View>
          ) : null}

          {/* Info: pickup time + address (aligned icons) → rating */}
          <View style={{ marginTop: 14, gap: 8 }}>
            {/* Pickup time + Rating on same row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {restaurant?.pickup_start_time ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Clock size={12} color={theme.colors.textSecondary} />
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }}>
                    {restaurant.pickup_start_time.substring(0, 5)}
                    {restaurant.pickup_end_time ? ` - ${restaurant.pickup_end_time.substring(0, 5)}` : ''}
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
              const soldOut = basket.quantityLeft <= 0;
              const pickupExpired = !soldOut && isPickupExpiredInTz(basket.pickupWindow?.end);
              const unavailable = soldOut || pickupExpired;

              return (
              <TouchableOpacity
                key={basket.id}
                onPress={() => router.push(`/basket/${basket.id}` as never)}
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
              <View style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, backgroundColor: soldOut ? theme.colors.error : pickupExpired ? '#888' : theme.colors.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {pickupExpired && !soldOut ? (
                  <TimerOff size={12} color="#fff" />
                ) : (
                  <ShoppingBag size={12} color="#fff" />
                )}
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {soldOut ? t('basket.soldOut') : pickupExpired ? t('orders.pickupEnded', { defaultValue: 'Expired' }) : (basket.quantityLeft >= 10 ? '9+' : basket.quantityLeft)}
                </Text>
              </View>
              <View style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
                  <Text style={[{ color: unavailable ? theme.colors.muted : theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]} numberOfLines={1}>
                    {basket.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                    <Text style={[{ color: unavailable ? theme.colors.muted : theme.colors.primary, ...theme.typography.body, fontWeight: '700' as const }]}>
                      {basket.discountedPrice} TND
                    </Text>
                    {basket.originalPrice > 0 && (
                      <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through', marginLeft: 6 }]}>
                        {basket.originalPrice} TND
                      </Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    {(() => {
                      const locStart = restaurant?.pickup_start_time?.substring(0, 5) ?? '';
                      const locEnd = restaurant?.pickup_end_time?.substring(0, 5) ?? '';
                      const isCustom = basket.pickupWindow.start && (basket.pickupWindow.start !== locStart || basket.pickupWindow.end !== locEnd);
                      if (!isCustom) return null;
                      return (
                        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#e3ff5c22', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Clock size={11} color="#b8a600" />
                          <Text style={{ color: '#8a7d00', fontSize: 11, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', marginLeft: 3 }}>
                            {basket.pickupWindow.start}-{basket.pickupWindow.end}
                          </Text>
                          <Text style={{ color: '#a89800', fontSize: 9, fontFamily: 'Poppins_400Regular', marginLeft: 4 }}>
                            (personnalisé)
                          </Text>
                        </View>
                      );
                    })()}
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
      <Modal
        visible={ratingsPopupVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={collapseOrCloseRatings}
      >
        <View style={styles.reportOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={collapseOrCloseRatings}
          />
          <Animated.View
            onTouchStart={(e) => { ratingsStartY.current = e.nativeEvent.pageY; }}
            onTouchEnd={(e) => {
              const dy = e.nativeEvent.pageY - ratingsStartY.current;
              if (dy < -30 && !ratingsExpanded) expandRatings();
              else if (dy > 30) collapseOrCloseRatings();
            }}
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: ratingsHeight,
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: 26, borderTopRightRadius: 26,
              ...theme.shadows.shadowLg,
            }}
          >
            {/* Handle bar */}
            <View style={{ paddingVertical: 14, alignItems: 'center' }}>
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
                    ({reviewCount} {t('review.reviewCount', { defaultValue: 'avis' })})
                  </Text>
                )}
              </View>
              {catAvgs != null ? (
                <>
                  <CategoryRatingRow label={t('review.service', { defaultValue: 'Service' })} value={catAvgs.serviceAvg} />
                  <CategoryRatingRow label={t('review.quality', { defaultValue: 'Qualité' })} value={catAvgs.qualityAvg} />
                  <CategoryRatingRow label={t('review.quantity', { defaultValue: 'Quantité' })} value={catAvgs.quantityAvg} />
                  <CategoryRatingRow label={t('review.variety', { defaultValue: 'Variété' })} value={catAvgs.varietyAvg} />
                </>
              ) : (
                <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 12 }}>
                  {t('review.noReviews', { defaultValue: 'Pas encore d\'avis' })}
                </Text>
              )}
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
                      </View>
                    ))}
                  </ScrollView>
                );
              })()}
            </View>
          </Animated.View>
        </View>
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
          <View
            style={[
              styles.reportSheet,
              {
                backgroundColor: theme.colors.surface,
                ...theme.shadows.shadowLg,
                marginBottom: reportKbHeight,
              },
            ]}
          >
            {/* Grab handle */}
            <View style={[styles.sheetHandle, { backgroundColor: theme.colors.divider }]} />

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

                {/* ── Fixed CTA footer ── */}
                <View
                  style={[
                    styles.sheetFooter,
                    { borderTopColor: theme.colors.divider },
                  ]}
                >
                  <TouchableOpacity
                    onPress={submitReport}
                    disabled={!report.reason || !!report.submitting}
                    activeOpacity={report.reason && !report.submitting ? 0.82 : 1}
                    style={[
                      styles.submitBtn,
                      {
                        backgroundColor: report.reason
                          ? theme.colors.primary
                          : theme.colors.divider,
                        borderRadius: 14,
                        opacity: report.reason && !report.submitting ? 1 : 0.6,
                      },
                    ]}
                  >
                    {report.submitting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text
                        style={{
                          color: report.reason ? '#fff' : theme.colors.muted,
                          fontSize: 15,
                          fontWeight: '600',
                          textAlign: 'center',
                          letterSpacing: 0.1,
                        }}
                      >
                        {t('report.submit')}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
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
    // maxHeight in concrete px so inner ScrollView can size correctly
    maxHeight: Dimensions.get('window').height * 0.85,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    // No overflow:hidden — clips children; no flex:1 — let content size the sheet
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
    textTransform: 'uppercase',
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
