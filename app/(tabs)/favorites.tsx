import React, { useEffect, useRef, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Heart, Bookmark, Clock, ShoppingBag, TimerOff } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { fetchLocations } from '@/src/services/restaurants';
import { fetchBaskets } from '@/src/services/baskets';
import { normalizeLocationToBasket, normalizeRawBasketToBasket } from '@/src/utils/normalizeRestaurant';
import { isPickupExpiredInTz } from '@/src/utils/timezone';

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

/** Inline basket row card — same layout as in restaurant/[id].tsx */
function StarredBasketRow({ basket, onPress }: { basket: any; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const soldOut = basket.quantityLeft <= 0;
  const pickupExpired = !soldOut && isPickupExpiredInTz(basket.pickupWindow?.end);
  const unavailable = soldOut || pickupExpired;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        {
          backgroundColor: unavailable ? '#f0f0f0' : theme.colors.surface,
          borderRadius: theme.radii.r16,
          marginBottom: 12,
          flexDirection: 'row',
          overflow: 'hidden',
          opacity: unavailable ? 0.55 : 1,
          ...theme.shadows.shadowSm,
        },
      ]}
    >
      {/* Status badge */}
      <View style={{
        position: 'absolute', top: 8, right: 8, zIndex: 2,
        backgroundColor: soldOut ? theme.colors.error : pickupExpired ? '#888' : theme.colors.primary,
        borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
        flexDirection: 'row', alignItems: 'center', gap: 4,
      }}>
        {pickupExpired && !soldOut
          ? <TimerOff size={12} color="#fff" />
          : <ShoppingBag size={12} color="#fff" />}
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
          {soldOut
            ? t('basket.soldOut')
            : pickupExpired
            ? t('orders.pickupEnded', { defaultValue: 'Expired' })
            : basket.quantityLeft}
        </Text>
      </View>

      {/* Left: text info */}
      <View style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
        <Text
          style={[{ color: unavailable ? theme.colors.muted : theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}
          numberOfLines={1}
        >
          {basket.name}
        </Text>
        <Text
          style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}
          numberOfLines={1}
        >
          {basket.merchantName}
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
        {basket.pickupWindow?.start ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
            <Clock size={11} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginLeft: 3 }}>
              {basket.pickupWindow.start}–{basket.pickupWindow.end}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Right: image */}
      <View style={{ width: 90, height: 90, alignSelf: 'center', marginRight: 10 }}>
        {basket.imageUrl ? (
          <Image
            source={{ uri: basket.imageUrl }}
            style={{ width: 90, height: 90, borderRadius: theme.radii.r12 }}
          />
        ) : (
          <View style={{ width: 90, height: 90, borderRadius: theme.radii.r12, backgroundColor: theme.colors.divider, justifyContent: 'center', alignItems: 'center' }}>
            <ShoppingBag size={28} color={theme.colors.muted} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function FavoritesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { favoriteBasketIds, starredBasketTypeIds, toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();
  const [activeTab, setActiveTab] = useState<'favorites' | 'starred'>('favorites');

  const locationsQuery = useQuery({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 60_000,
  });

  const basketsQuery = useQuery({
    queryKey: ['baskets'],
    queryFn: fetchBaskets,
    staleTime: 60_000,
    enabled: starredBasketTypeIds.length > 0,
  });

  const allBaskets = useMemo(() => {
    if (!locationsQuery.data) return [];
    return locationsQuery.data.map(normalizeLocationToBasket);
  }, [locationsQuery.data]);

  const favoriteBaskets = useMemo(
    () => allBaskets.filter((basket) => favoriteBasketIds.includes(basket.id)),
    [allBaskets, favoriteBasketIds]
  );

  const starredBaskets = useMemo(() => {
    if (!starredBasketTypeIds.length) return [];
    // Use fetched baskets data first (full basket types), fall back to normalized locations
    const fromAPI = (basketsQuery.data ?? [])
      .map((b) => normalizeRawBasketToBasket(b as any))
      .filter((b) => starredBasketTypeIds.includes(b.id));
    if (fromAPI.length > 0) return fromAPI;
    // Fallback: match against location-normalized baskets (may not cover all basket type IDs)
    return allBaskets.filter((b) => starredBasketTypeIds.includes(b.id));
  }, [basketsQuery.data, allBaskets, starredBasketTypeIds]);

  const isEmpty = activeTab === 'favorites' ? favoriteBaskets.length === 0 : starredBaskets.length === 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      {/* Header */}
      <View style={{ paddingHorizontal: theme.spacing.xl, paddingTop: 50, paddingBottom: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('favorites.title')}</Text>
          {activeTab === 'favorites' && favoriteBaskets.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary + '14', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, gap: 5 }}>
              <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{favoriteBaskets.length}</Text>
              <Heart size={14} color={theme.colors.primary} fill={theme.colors.primary} />
            </View>
          )}
          {activeTab === 'starred' && starredBaskets.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#e3ff5c33', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, gap: 5 }}>
              <Text style={{ color: theme.colors.primaryDark, fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{starredBaskets.length}</Text>
              <Bookmark size={14} color={theme.colors.primaryDark} fill={theme.colors.primaryDark} />
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
          <TouchableOpacity
            onPress={() => setActiveTab('favorites')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'favorites' }}
            style={{
              flex: 1, paddingVertical: 10, alignItems: 'center',
              borderBottomWidth: 2,
              borderBottomColor: activeTab === 'favorites' ? theme.colors.primary : 'transparent',
              marginBottom: -1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Heart size={15} color={activeTab === 'favorites' ? theme.colors.primary : theme.colors.textSecondary} fill={activeTab === 'favorites' ? theme.colors.primary : 'transparent'} />
              <Text style={{ color: activeTab === 'favorites' ? theme.colors.primary : theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: activeTab === 'favorites' ? '600' : '400' }}>
                {t('favorites.baskets')}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('starred')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'starred' }}
            style={{
              flex: 1, paddingVertical: 10, alignItems: 'center',
              borderBottomWidth: 2,
              borderBottomColor: activeTab === 'starred' ? theme.colors.primary : 'transparent',
              marginBottom: -1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Bookmark size={15} color={activeTab === 'starred' ? theme.colors.primary : theme.colors.textSecondary} fill={activeTab === 'starred' ? theme.colors.primary : 'transparent'} />
              <Text style={{ color: activeTab === 'starred' ? theme.colors.primary : theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: activeTab === 'starred' ? '600' : '400' }}>
                {t('favorites.starred')}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
            {activeTab === 'favorites' ? t('favorites.emptyTitle') : t('favorites.emptyStarredTitle')}
          </Text>
          <Text style={[styles.emptyDesc, { color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.md }]}>
            {activeTab === 'favorites' ? t('favorites.emptyDesc') : t('favorites.emptyStarredDesc')}
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
              {activeTab === 'favorites'
                ? <PulsingHeart color={theme.colors.primary} />
                : (
                  <View style={{ position: 'absolute', top: 8, right: 8 }}>
                    <Bookmark size={22} color={theme.colors.primary} />
                  </View>
                )}
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
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'favorites'
            ? favoriteBaskets.map((basket) => (
                <BasketCard
                  key={basket.id}
                  basket={basket}
                  isFavorite={isBasketFavorite(basket.id)}
                  onFavoritePress={() => toggleBasketFavorite(basket.id)}
                />
              ))
            : starredBaskets.map((basket) => (
                <StarredBasketRow
                  key={basket.id}
                  basket={basket}
                  onPress={() => router.push(`/basket/${basket.id}` as never)}
                />
              ))
          }
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 80,
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
