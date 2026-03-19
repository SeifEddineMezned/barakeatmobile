import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { fetchBaskets } from '@/src/services/baskets';
import type { Basket } from '@/src/types';

function normalizeBasket(raw: any): Basket {
  return {
    id: String(raw.id ?? raw._id ?? ''),
    merchantId: raw.merchantId ?? raw.merchant_id ?? '',
    merchantName: raw.merchantName ?? raw.merchant_name ?? raw.businessName ?? 'Unknown',
    merchantLogo: raw.merchantLogo ?? raw.merchant_logo ?? undefined,
    merchantRating: raw.merchantRating ?? raw.merchant_rating ?? undefined,
    reviewCount: raw.reviewCount ?? raw.review_count ?? undefined,
    reviews: raw.reviews ?? undefined,
    description: raw.description ?? undefined,
    name: raw.name ?? raw.title ?? 'Basket',
    category: raw.category ?? raw.type ?? '',
    originalPrice: Number(raw.originalPrice ?? raw.original_price ?? 0),
    discountedPrice: Number(raw.discountedPrice ?? raw.discounted_price ?? 0),
    discountPercentage: Number(raw.discountPercentage ?? raw.discount_percentage ?? 50),
    pickupWindow: raw.pickupWindow ?? raw.pickup_window ?? { start: '18:00', end: '19:00' },
    quantityLeft: Number(raw.quantityLeft ?? raw.quantity_left ?? 0),
    quantityTotal: Number(raw.quantityTotal ?? raw.quantity_total ?? 0),
    distance: Number(raw.distance ?? 0),
    address: raw.address ?? '',
    latitude: Number(raw.latitude ?? 36.8065),
    longitude: Number(raw.longitude ?? 10.1815),
    exampleItems: raw.exampleItems ?? raw.example_items ?? [],
    imageUrl: raw.imageUrl ?? raw.image_url ?? undefined,
    isActive: raw.isActive ?? raw.is_active ?? true,
    isSupermarket: raw.isSupermarket ?? false,
  };
}

export default function FavoritesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { favoriteBasketIds, toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();

  const basketsQuery = useQuery({
    queryKey: ['baskets'],
    queryFn: fetchBaskets,
    staleTime: 60_000,
  });

  const allBaskets = useMemo(() => {
    if (!basketsQuery.data) return [];
    return basketsQuery.data.map(normalizeBasket);
  }, [basketsQuery.data]);

  const favoriteBaskets = useMemo(
    () => allBaskets.filter((basket) => favoriteBasketIds.includes(basket.id)),
    [allBaskets, favoriteBasketIds]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('favorites.title')}</Text>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={[{ padding: theme.spacing.xl }]}
      >
        {favoriteBaskets.length === 0 ? (
          <View style={styles.emptyState}>
            <Text
              style={[
                {
                  color: theme.colors.textSecondary,
                  ...theme.typography.body,
                  textAlign: 'center',
                },
              ]}
            >
              {t('favorites.emptyState')}
            </Text>
          </View>
        ) : (
          favoriteBaskets.map((basket) => (
            <BasketCard
              key={basket.id}
              basket={basket}
              isFavorite={isBasketFavorite(basket.id)}
              onFavoritePress={() => toggleBasketFavorite(basket.id)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {},
  content: {
    flex: 1,
  },
  emptyState: {
    paddingTop: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
