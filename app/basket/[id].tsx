import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Clock, Phone, Navigation, ChevronLeft, Star, ShoppingBag, RefreshCw } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchRestaurantById } from '@/src/services/restaurants';
import { normalizeRestaurantToBasket } from '@/src/utils/normalizeRestaurant';



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
  const { id } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const restaurantQuery = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => fetchRestaurantById(String(id)),
    enabled: !!id,
    retry: 2,
  });

  const basket = restaurantQuery.data ? normalizeRestaurantToBasket(restaurantQuery.data) : null;

  if (restaurantQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16, zIndex: 10 }]}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 16 }]}>
          {t('common.loading')}
        </Text>
      </View>
    );
  }

  if (restaurantQuery.isError || !basket) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16, zIndex: 10 }]}
          onPress={() => router.back()}
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

  const handleCall = () => {
    void Linking.openURL(`tel:+21612345678`);
  };

  const handleDirections = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${basket.latitude},${basket.longitude}`;
    void Linking.openURL(url);
  };

  const overallRating = basket.reviews
    ? ((basket.reviews.service + basket.reviews.quantite + basket.reviews.qualite + basket.reviews.variete) / 4).toFixed(1)
    : basket.merchantRating?.toFixed(1) ?? '0.0';

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.heroContainer}>
          {basket.imageUrl ? (
            <Image source={{ uri: basket.imageUrl }} style={styles.heroImage} />
          ) : (
            <View style={[styles.heroPlaceholder, { backgroundColor: theme.colors.bagsLeftBg }]} />
          )}
          <View style={styles.heroOverlay} />
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', ...theme.shadows.shadowMd }]}
            onPress={() => router.back()}
          >
            <ChevronLeft size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>

          <View style={[styles.heroBottomInfo, { paddingHorizontal: theme.spacing.xl }]}>
            <View style={[styles.bagsChip, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r8 }]}>
              <ShoppingBag size={13} color="#fff" />
              <Text style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '700' as const, marginLeft: 4 }]}>
                {basket.quantityLeft} {t('basket.quantity', { count: basket.quantityLeft })}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.content, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
          <View style={styles.merchantRow}>
            {basket.merchantLogo ? (
              <Image source={{ uri: basket.merchantLogo }} style={styles.merchantLogo} />
            ) : (
              <View style={[styles.merchantLogo, { backgroundColor: theme.colors.divider }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {basket.merchantName}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                {basket.name}
              </Text>
            </View>
          </View>

          <View style={[styles.quickInfoRow, { marginTop: theme.spacing.md }]}>
            <View style={[styles.infoChip, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.pill, ...theme.shadows.shadowSm }]}>
              <Clock size={13} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '500' as const, marginLeft: 4 }]}>
                {basket.pickupWindow.start} - {basket.pickupWindow.end}
              </Text>
            </View>
            <View style={[styles.infoChip, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.pill, ...theme.shadows.shadowSm }]}>
              <MapPin size={13} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '500' as const, marginLeft: 4 }]}>
                {basket.distance}km
              </Text>
            </View>
            <View style={[styles.infoChip, { backgroundColor: theme.colors.bagsLeftBg, borderRadius: theme.radii.pill }]}>
              <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const }]}>
                {t('basket.payOnPickup')}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.priceBlock,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                padding: theme.spacing.lg,
                marginTop: theme.spacing.lg,
                ...theme.shadows.shadowSm,
              },
            ]}
          >
            <View style={styles.priceRow}>
              <View>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                  {t('basket.pickupWindow')}
                </Text>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const, marginTop: 2 }]}>
                  {basket.pickupWindow.start} - {basket.pickupWindow.end}
                </Text>
              </View>
              <View style={styles.priceRight}>
                <Text style={[{ color: theme.colors.muted, ...theme.typography.bodySm, textDecorationLine: 'line-through', textAlign: 'right' }]}>
                  {basket.originalPrice} TND
                </Text>
                <Text style={[{ color: theme.colors.primary, ...theme.typography.h1, fontWeight: '700' as const, textAlign: 'right' }]}>
                  {basket.discountedPrice} TND
                </Text>
              </View>
            </View>
          </View>

          {basket.description ? (
            <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
                {t('basket.description')}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22 }]}>
                {basket.description}
              </Text>
            </View>
          ) : null}

          {basket.exampleItems && basket.exampleItems.length > 0 && (
            <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
                {t('basket.whatYouMightGet')}
              </Text>
              <View style={styles.itemsGrid}>
                {basket.exampleItems.map((item, index) => (
                  <View
                    key={index}
                    style={[
                      styles.itemChip,
                      {
                        backgroundColor: theme.colors.surface,
                        borderRadius: theme.radii.r8,
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                        ...theme.shadows.shadowSm,
                      },
                    ]}
                  >
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>{item}</Text>
                  </View>
                ))}
              </View>
              <Text
                style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: theme.spacing.sm, fontStyle: 'italic' }]}
              >
                {t('basket.surpriseNote')}
              </Text>
            </View>
          )}

          <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
              {t('basket.merchantInfo')}
            </Text>
            <View
              style={[
                styles.merchantInfoCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r16,
                  padding: theme.spacing.lg,
                  ...theme.shadows.shadowSm,
                },
              ]}
            >
              <View style={[styles.infoRow, { marginBottom: theme.spacing.md }]}>
                <MapPin size={18} color={theme.colors.primary} />
                <View style={styles.infoText}>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                    {t('basket.address')}
                  </Text>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginTop: 2 }]}>
                    {basket.address}
                  </Text>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: theme.spacing.md, flex: 1 }]}
                  onPress={handleCall}
                >
                  <Phone size={18} color={theme.colors.primary} />
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginTop: 4 }]}>
                    {t('basket.call')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: theme.spacing.md, flex: 1 }]}
                  onPress={handleDirections}
                >
                  <Navigation size={18} color={theme.colors.primary} />
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginTop: 4 }]}>
                    {t('basket.directions')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

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
                  <Text style={[{ color: '#fff', ...theme.typography.h3, fontWeight: '700' as const, marginLeft: 4 }]}>
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

          <View style={{ height: theme.spacing.xxl }} />
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: theme.colors.surface,
            paddingHorizontal: theme.spacing.xl,
            paddingVertical: theme.spacing.md,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            ...theme.shadows.shadowLg,
          },
        ]}
      >
        <PrimaryCTAButton
          onPress={handleReserve}
          title={t('basket.reserveBasket')}
          disabled={basket.quantityLeft === 0}
        />
      </View>
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
    position: 'relative',
    width: '100%',
    height: 240,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
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
  },
  heroBottomInfo: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
  },
  bagsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
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
  quickInfoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  priceBlock: {},
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceRight: {},
  section: {},
  itemsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemChip: {},
  merchantInfoCard: {},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    marginLeft: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  footer: {},
});
