import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import type { NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, MapPin, ShoppingBag, Clock, Star, Tag, Flag, X, ChevronRight, MoreVertical } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchBasketsByLocation } from '@/src/services/baskets';
import { fetchReviewsByRestaurant, ReviewFromAPI } from '@/src/services/reviews';
import { normalizeRawBasketToBasket } from '@/src/utils/normalizeRestaurant';

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
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style="dark" />
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16 }]}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <ActivityIndicator size="large" color={theme.colors.primary} />
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
                {restaurant.category}
              </Text>
            </View>
          ) : null}

          {/* Info chips row */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {restaurant?.address ? (
              <View style={[styles.chip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill }]}>
                <MapPin size={12} color={theme.colors.textSecondary} />
                <Text
                  style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }]}
                  numberOfLines={1}
                >
                  {restaurant.address}
                </Text>
              </View>
            ) : null}
            {restaurant?.pickup_start_time ? (
              <View style={[styles.chip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill }]}>
                <Clock size={12} color={theme.colors.textSecondary} />
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }]}>
                  {restaurant.pickup_start_time.substring(0, 5)}
                  {restaurant.pickup_end_time ? ` - ${restaurant.pickup_end_time.substring(0, 5)}` : ''}
                </Text>
              </View>
            ) : null}
            {/* Overall rating chip — tap to expand detailed ratings */}
            <TouchableOpacity
              onPress={() => setRatingsPopupVisible(true)}
              activeOpacity={0.7}
              style={[styles.chip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill }]}
            >
              <Star
                size={12}
                color={overallRating != null ? theme.colors.starYellow : theme.colors.muted}
                fill={overallRating != null ? theme.colors.starYellow : 'transparent'}
              />
              <Text
                style={[
                  {
                    color: overallRating != null ? theme.colors.textPrimary : theme.colors.textSecondary,
                    ...theme.typography.caption,
                    fontWeight: '700' as const,
                    marginLeft: 4,
                  },
                ]}
              >
                {overallRating != null ? overallRating.toFixed(1) : t('review.noRating')}
              </Text>
              {reviewCount > 0 ? (
                <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, marginLeft: 3 }]}>
                  ({reviewCount})
                </Text>
              ) : overallRating == null ? (
                <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, marginLeft: 3 }]}>
                  {t('review.noReviews')}
                </Text>
              ) : null}
              <ChevronRight size={10} color={theme.colors.muted} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          </View>

          {/* Description with "see more" — only shows toggle when text actually overflows */}
          {description ? (
            <View style={{ marginTop: 14 }}>
              <Text
                style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20 }]}
                numberOfLines={descExpanded ? undefined : DESC_COLLAPSED_LINES}
                onTextLayout={onDescTextLayout}
              >
                {description}
              </Text>
              {(descNeedsSeeMore || descExpanded) && (
                <TouchableOpacity onPress={() => setDescExpanded((v) => !v)} style={{ marginTop: 4 }}>
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const }]}>
                    {descExpanded
                      ? t('common.seeLess', { defaultValue: 'See less' })
                      : t('common.seeMore', { defaultValue: 'See more' })}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}
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
            baskets.map((basket) => (
              <TouchableOpacity
                key={basket.id}
                onPress={() => router.push(`/basket/${basket.id}` as never)}
                style={[
                  styles.basketCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    ...theme.shadows.shadowSm,
                    flexDirection: 'row',
                  },
                ]}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]} numberOfLines={1}>
                    {basket.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                    <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' as const }]}>
                      {basket.discountedPrice} TND
                    </Text>
                    {basket.originalPrice > 0 && (
                      <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through', marginLeft: 6 }]}>
                        {basket.originalPrice} TND
                      </Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    {basket.pickupWindow.start ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Clock size={11} color={theme.colors.muted} />
                        <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginLeft: 3 }}>
                          {basket.pickupWindow.start}-{basket.pickupWindow.end}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={{ color: basket.quantityLeft > 0 ? theme.colors.primary : theme.colors.error, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                      {basket.quantityLeft > 0 ? `${basket.quantityLeft} left` : 'Sold out'}
                    </Text>
                  </View>
                </View>
                {basket.imageUrl ? (
                  <Image source={{ uri: basket.imageUrl }} style={{ width: 90, height: '100%', borderTopRightRadius: theme.radii.r16, borderBottomRightRadius: theme.radii.r16 }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 90, backgroundColor: theme.colors.primary + '08', justifyContent: 'center', alignItems: 'center', borderTopRightRadius: theme.radii.r16, borderBottomRightRadius: theme.radii.r16 }}>
                    <ShoppingBag size={28} color={theme.colors.muted} />
                  </View>
                )}
              </TouchableOpacity>
            ))
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
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setRatingsPopupVisible(false)}
      >
        <View style={styles.reportOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setRatingsPopupVisible(false)}
          />
          <View style={[styles.ratingsPopupSheet, { backgroundColor: theme.colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, ...theme.shadows.shadowLg }]}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.colors.divider }]} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16 }}>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>
                {t('review.ratingsTitle', { defaultValue: 'Ratings' })}
              </Text>
              <TouchableOpacity
                onPress={() => setRatingsPopupVisible(false)}
                style={[styles.sheetClosePill, { backgroundColor: theme.colors.bg }]}
              >
                <X size={16} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={{ paddingHorizontal: 24, paddingBottom: 32 }}>
              {/* Overall rating */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
                <Star size={24} color={theme.colors.starYellow} fill={overallRating != null ? theme.colors.starYellow : 'transparent'} />
                <Text style={{ color: theme.colors.textPrimary, fontSize: 28, fontWeight: '700', marginLeft: 8 }}>
                  {overallRating != null ? overallRating.toFixed(1) : '—'}
                </Text>
                {reviewCount > 0 && (
                  <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, marginLeft: 8 }}>
                    ({reviewCount} {reviewCount === 1 ? 'review' : 'reviews'})
                  </Text>
                )}
              </View>
              {catAvgs == null ? (
                <Text style={[{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center' as const }]}>
                  {t('review.noReviews', { defaultValue: 'No ratings yet' })}
                </Text>
              ) : (
                <>
                  <CategoryRatingRow label={t('review.service', { defaultValue: 'Service' })} value={catAvgs.serviceAvg} />
                  <CategoryRatingRow label={t('review.quality', { defaultValue: 'Quality' })} value={catAvgs.qualityAvg} />
                  <CategoryRatingRow label={t('review.quantity', { defaultValue: 'Quantity' })} value={catAvgs.quantityAvg} />
                  <CategoryRatingRow label={t('review.variety', { defaultValue: 'Variety' })} value={catAvgs.varietyAvg} />
                </>
              )}
            </View>
          </View>
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
                  Signaler ce restaurant
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
                    Dites-nous ce qui ne va pas. Votre retour nous aide à améliorer l’expérience.
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
                accessibilityLabel="Fermer"
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
                  Merci pour votre signalement
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
                  Votre message a bien été enregistré. Notre équipe en prendra connaissance.
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
                    Fermer
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
                    MOTIF
                  </Text>

                  {([
                    { key: 'food_quality' as ReportReason, label: 'Mauvaise qualité de nourriture' },
                    { key: 'wrong_info' as ReportReason, label: 'Informations incorrectes' },
                    { key: 'hygiene' as ReportReason, label: "Problème d’hygiène" },
                    { key: 'behavior' as ReportReason, label: 'Comportement inapproprié' },
                    { key: 'other' as ReportReason, label: 'Autre' },
                  ] as { key: ReportReason; label: string }[]).map(({ key, label }, index, arr) => {
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
                    DÉTAILS SUPPLÉMENTAIRES
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
                    placeholder="Ajoutez des détails (optionnel)"
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
                    Votre message restera confidentiel.
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
                      Envoyer le signalement
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
  ratingsPopupSheet: {
    maxHeight: Dimensions.get('window').height * 0.5,
  },
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