import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { fetchLocations } from '@/src/services/restaurants';
import { normalizeLocationToBasket } from '@/src/utils/normalizeRestaurant';

function PulsingHeart({ color }: { color: string }) {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);
  const fillOpacity = pulseAnim.interpolate({ inputRange: [1, 1.35], outputRange: [0, 1] });
  return (
    <View style={{ position: 'absolute', top: 8, right: 8 }}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Heart size={22} color={color} fill="transparent" />
      </Animated.View>
      <Animated.View style={{ position: 'absolute', opacity: fillOpacity }}>
        <Heart size={22} color={color} fill={color} />
      </Animated.View>
    </View>
  );
}

export default function FavoritesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { favoriteBasketIds, toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();

  const locationsQuery = useQuery({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 60_000,
  });

  const allBaskets = useMemo(() => {
    if (!locationsQuery.data) return [];
    return locationsQuery.data.map(normalizeLocationToBasket);
  }, [locationsQuery.data]);

  const favoriteBaskets = useMemo(
    () => allBaskets.filter((basket) => favoriteBasketIds.includes(basket.id)),
    [allBaskets, favoriteBasketIds]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      {favoriteBaskets.length > 0 ? (
        <>
          <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('favorites.title')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary + '14', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, gap: 5 }}>
              <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{favoriteBaskets.length}</Text>
              <Heart size={14} color={theme.colors.primary} fill={theme.colors.primary} />
            </View>
          </View>
          <ScrollView
            style={styles.content}
            contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          >
            {favoriteBaskets.map((basket) => (
              <BasketCard
                key={basket.id}
                basket={basket}
                isFavorite={isBasketFavorite(basket.id)}
                onFavoritePress={() => toggleBasketFavorite(basket.id)}
              />
            ))}
          </ScrollView>
        </>
      ) : (
        <>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.sm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('favorites.title')}</Text>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
            {t('favorites.emptyTitle')}
          </Text>
          <Text style={[styles.emptyDesc, { color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.md }]}>
            {t('favorites.emptyDesc')}
          </Text>

          <View style={{ marginTop: 32, alignItems: 'center' }}>
            <View style={{
              width: 180, height: 130,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              ...theme.shadows.shadowMd,
              overflow: 'visible',
              position: 'relative',
            }}>
              <View style={{ height: 80, backgroundColor: theme.colors.divider, borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 }} />
              <View style={{ padding: 12 }}>
                <View style={{ width: 80, height: 8, borderRadius: 4, backgroundColor: theme.colors.divider }} />
                <View style={{ width: 50, height: 6, borderRadius: 3, backgroundColor: theme.colors.divider, marginTop: 6 }} />
              </View>
              <PulsingHeart color={theme.colors.primary} />
            </View>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/(tabs)' as never)}
            style={[styles.ctaButton, {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r16,
              paddingVertical: theme.spacing.lg,
              paddingHorizontal: theme.spacing.xxxl,
              marginTop: theme.spacing.xxl,
            }]}
          >
            <Text style={[{ color: '#fff', ...theme.typography.button }]}>
              {t('favorites.findBasket')}
            </Text>
          </TouchableOpacity>
        </View>
        </>
      )}
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 100,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyDesc: {
    textAlign: 'center',
    lineHeight: 22,
  },
  ctaButton: {},
});
