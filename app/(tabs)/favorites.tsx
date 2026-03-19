import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { fetchRestaurants } from '@/src/services/restaurants';
import { normalizeRestaurantToBasket } from '@/src/utils/normalizeRestaurant';

export default function FavoritesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { favoriteBasketIds, toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();

  const restaurantsQuery = useQuery({
    queryKey: ['restaurants'],
    queryFn: fetchRestaurants,
    staleTime: 60_000,
  });

  const allBaskets = useMemo(() => {
    if (!restaurantsQuery.data) return [];
    return restaurantsQuery.data.map(normalizeRestaurantToBasket);
  }, [restaurantsQuery.data]);

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
