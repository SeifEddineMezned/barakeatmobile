import React, { useState, useCallback, useRef } from 'react';
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
} from 'react-native';
import type { NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, MapPin, ShoppingBag, Clock, Star, Tag, Flag, X, ChevronRight, MoreVertical, TimerOff, Navigation } from 'lucide-react-native';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchBasketsByLocation } from '@/src/services/baskets';
import { fetchReviewsByRestaurant, ReviewFromAPI } from '@/src/services/reviews';
import { normalizeRawBasketToBasket, mapCategory } from '@/src/utils/normalizeRestaurant';
import { DelayedLoader } from '@/src/components/DelayedLoader';

const DESC_COLLAPSED_LINES = 3;

// ── Report flow types ──────────────────────────────────────────────────────────
type ReportReason = 'food_quality' | 'wrong_info' | 'hygiene' | 'behavior' | 'other';

interface ReportState {
  reason: ReportReason | null;
  comment: string;
  submitted: boolean;
}

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
  const [menuVisible, setMenuVisible] = useState(false);

  // Report modal state — local only, no API
  const [reportVisible, setReportVisible] = useState(false);
  const [report, setReport] = useState<ReportState>({
    reason: null,
    comment: '',
    submitted: false,
  });

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
    staleTime: 60_000,
    retry: 1,
  });

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
    setMenuVisible(false);
    setReport({ reason: null, comment: '', submitted: false });
    setReportVisible(true);
  };

  const closeReport = () => {
    setReportVisible(false);
  };

  const submitReport = () => {
    if (!report.reason) return;
    // Local-only: no API call, no fake server submission
    setReport((prev) => ({ ...prev, submitted: true }));
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
          {restaurant?.image_url ? (
            <Image source={{ uri: restaurant.image_url }} style={styles.heroImage} />
          ) : (
            <View style={[styles.heroImage, { backgroundColor: theme.colors.primary + '20' }]} />
          )}
          <View style={styles.heroOverlay} />
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: 'rgba(255,255,255,0.9)', ...theme.shadows.shadowMd }]}
            onPress={() => router.back()}
          >
            <ChevronLeft size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          {/* 3-dots menu — top right */}
          <TouchableOpacity
            style={[styles.menuBtn, { backgroundColor: 'rgba(255,255,255,0.9)', ...theme.shadows.shadowMd }]}
            onPress={() => setMenuVisible(true)}
          >
            <MoreVertical size={20} color={theme.colors.textPrimary} />
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
          {/* Name + category */}
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, fontWeight: '700' as const }]}>
            {restaurant?.name ?? ''}
          </Text>
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

        {/* Bottom spacing */}
        <View style={{ height: 48 }} />
      </ScrollView>

      {/* ── 3-dots menu popup ──────────────────────────────────────── */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        />
        <View style={[styles.menuPopup, { backgroundColor: theme.colors.surface, ...theme.shadows.shadowLg, borderRadius: theme.radii.r12 }]}>
          <TouchableOpacity
            onPress={openReport}
            style={styles.menuItem}
            activeOpacity={0.7}
          >
            <Flag size={16} color={theme.colors.textSecondary} />
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
              {t('report.cta', { defaultValue: 'Report this restaurant' })}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

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

          {/* ── SHEET ── */}
          <View
            style={[
              styles.reportSheet,
              { backgroundColor: theme.colors.surface, ...theme.shadows.shadowLg },
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
                <TouchableOpacity
                  onPress={closeReport}
                  style={[
                    styles.confirmDoneBtn,
                    {
                      backgroundColor: theme.colors.primary,
                      borderRadius: 14,
                      marginTop: 28,
                    },
                  ]}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
                    {t('common.close')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* Report form */
              <>
                <ScrollView
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
                    textAlignVertical="top"
                  />
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
                    disabled={!report.reason}
                    activeOpacity={report.reason ? 0.82 : 1}
                    style={[
                      styles.submitBtn,
                      {
                        backgroundColor: report.reason
                          ? theme.colors.primary
                          : theme.colors.divider,
                        borderRadius: 14,
                        opacity: report.reason ? 1 : 0.6,
                      },
                    ]}
                  >
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
