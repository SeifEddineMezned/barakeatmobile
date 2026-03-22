import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, MapPin, ShoppingBag, Clock, Star, Tag } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import { fetchRestaurantById } from '@/src/services/restaurants';
import { fetchBasketsByLocation } from '@/src/services/baskets';
import { normalizeRawBasketToBasket } from '@/src/utils/normalizeRestaurant';

const DESC_COLLAPSED_LINES = 3;

export default function RestaurantScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation();
  const [descExpanded, setDescExpanded] = useState(false);

  const restaurantQuery = useQuery({
    queryKey: ['restaurant', id],
    queryFn: () => fetchRestaurantById(String(id)),
    enabled: !!id,
  });

  const basketsQuery = useQuery({
    queryKey: ['restaurant-baskets', id],
    queryFn: () => fetchBasketsByLocation(String(id)),
    enabled: !!id,
  });

  const restaurant = restaurantQuery.data;

  const rawBaskets = basketsQuery.data ?? [];
  const baskets = rawBaskets.map((b) => normalizeRawBasketToBasket(b as any, restaurant?.name));

  const isLoading = restaurantQuery.isLoading;

  const avgRating = (restaurant as any)?.avg_rating != null
    ? Number((restaurant as any).avg_rating)
    : null;

  // Use bag_description as the primary description, fall back to description
  const description = (restaurant as any)?.bag_description?.trim() || restaurant?.description?.trim() || null;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style="dark" />
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16 }]} onPress={() => router.back()}>
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
        </View>

        {/* Info card */}
        <View style={[styles.infoCard, {
          backgroundColor: theme.colors.surface,
          marginHorizontal: 16,
          marginTop: -28,
          borderRadius: theme.radii.r20,
          padding: 20,
          ...theme.shadows.shadowMd,
        }]}>
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
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }]} numberOfLines={1}>
                  {restaurant.address}
                </Text>
              </View>
            ) : null}
            {restaurant?.pickup_start_time ? (
              <View style={[styles.chip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill }]}>
                <Clock size={12} color={theme.colors.textSecondary} />
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }]}>
                  {restaurant.pickup_start_time.substring(0, 5)}{restaurant.pickup_end_time ? ` - ${restaurant.pickup_end_time.substring(0, 5)}` : ''}
                </Text>
              </View>
            ) : null}
            <View style={[styles.chip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill }]}>
              <Star size={12} color={avgRating != null ? theme.colors.starYellow : theme.colors.muted} fill={avgRating != null ? theme.colors.starYellow : 'transparent'} />
              <Text style={[{ color: avgRating != null ? theme.colors.textPrimary : theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '700' as const, marginLeft: 4 }]}>
                {avgRating != null ? avgRating.toFixed(1) : t('review.noRating')}
              </Text>
              {avgRating == null && (
                <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, marginLeft: 3 }]}>
                  {t('review.noReviews')}
                </Text>
              )}
            </View>
          </View>

          {/* Description with "see more" */}
          {description ? (
            <View style={{ marginTop: 14 }}>
              <Text
                style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20 }]}
                numberOfLines={descExpanded ? undefined : DESC_COLLAPSED_LINES}
              >
                {description}
              </Text>
              <TouchableOpacity onPress={() => setDescExpanded((v) => !v)} style={{ marginTop: 4 }}>
                <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const }]}>
                  {descExpanded ? t('common.seeLess', { defaultValue: 'See less' }) : t('common.seeMore', { defaultValue: 'See more' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* Baskets section */}
        <View style={[styles.body, { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 60 }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '600' as const, marginBottom: 12 }]}>
            {t('basket.availableBaskets')}
          </Text>

          {basketsQuery.isLoading ? (
            <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 20 }} />
          ) : baskets.length === 0 ? (
            <View style={styles.emptyState}>
              <ShoppingBag size={48} color={theme.colors.muted} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 12, textAlign: 'center' as const }]}>
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
                    ...theme.shadows.shadowMd,
                  },
                ]}
                activeOpacity={0.8}
              >
                {basket.imageUrl ? (
                  <Image
                    source={{ uri: basket.imageUrl }}
                    style={[styles.basketImage, { borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 }]}
                  />
                ) : null}
                <View style={[styles.basketContent, { padding: theme.spacing.md }]}>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}>
                    {basket.name}
                  </Text>
                  {basket.category && basket.category !== 'Tous' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                      <Tag size={10} color={theme.colors.textSecondary} />
                      <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }]}>
                        {basket.category}
                      </Text>
                    </View>
                  ) : null}
                  {basket.description ? (
                    <Text
                      style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 4, lineHeight: 19 }]}
                      numberOfLines={2}
                    >
                      {basket.description}
                    </Text>
                  ) : null}
                  <View style={styles.basketFooter}>
                    <View style={styles.chipsRow}>
                      <View style={[styles.basketChip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill }]}>
                        <Clock size={11} color={theme.colors.textSecondary} />
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }]}>
                          {basket.pickupWindow.start}-{basket.pickupWindow.end}
                        </Text>
                      </View>
                      <View style={[styles.basketChip, { backgroundColor: basket.quantityLeft > 0 ? theme.colors.primary : theme.colors.divider, borderRadius: theme.radii.pill }]}>
                        <ShoppingBag size={11} color={basket.quantityLeft > 0 ? '#fff' : theme.colors.muted} />
                        <Text style={[{ color: basket.quantityLeft > 0 ? '#fff' : theme.colors.muted, ...theme.typography.caption, marginLeft: 3, fontWeight: '600' as const }]}>
                          {basket.quantityLeft}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {basket.originalPrice > 0 ? (
                        <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through' }]}>
                          {basket.originalPrice} TND
                        </Text>
                      ) : null}
                      <Text style={[{ color: theme.colors.primary, ...theme.typography.h3, fontWeight: '700' as const }]}>
                        {basket.discountedPrice} TND
                      </Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
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
  infoCard: {},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
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
});
