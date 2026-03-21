import React, { useMemo } from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, Clock, Star, ShoppingBag } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchRestaurants } from '@/src/services/restaurants';
import { normalizeRestaurantToBasket } from '@/src/utils/normalizeRestaurant';
import { fetchBasketsByLocation } from '@/src/services/baskets';

export default function BusinessDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const restaurantsQuery = useQuery({
    queryKey: ['restaurants'],
    queryFn: fetchRestaurants,
    staleTime: 60_000,
  });

  const restaurant = useMemo(() => {
    if (!restaurantsQuery.data) return null;
    return restaurantsQuery.data.find((r: any) => String(r.id) === id);
  }, [restaurantsQuery.data, id]);

  const normalized = useMemo(() => {
    if (!restaurant) return null;
    return normalizeRestaurantToBasket(restaurant);
  }, [restaurant]);

  const basketTypesQuery = useQuery({
    queryKey: ['baskets-by-location', id],
    queryFn: () => fetchBasketsByLocation(String(id)),
    enabled: !!id,
    staleTime: 60_000,
  });

  const displayBaskets = useMemo(() => {
    if (basketTypesQuery.data && basketTypesQuery.data.length > 0) {
      return basketTypesQuery.data.map((b: any) => ({
        id: String(b.id),
        name: b.name === restaurant?.name ? 'Panier Surprise' : (b.name ?? 'Panier Surprise'),
        originalPrice: Number(b.originalPrice ?? b.original_price ?? 0),
        discountedPrice: Number(b.discountedPrice ?? b.selling_price ?? 0),
        quantityLeft: b.quantityLeft ?? b.available_quantity ?? 0,
        pickupStart: (b.pickupWindow?.start ?? b.pickup_start_time?.substring(0, 5)) || null,
        pickupEnd: (b.pickupWindow?.end ?? b.pickup_end_time?.substring(0, 5)) || null,
        imageUrl: b.imageUrl ?? b.image_url ?? null,
      }));
    }
    if (normalized) {
      return [{
        id: normalized.id,
        name: normalized.name === restaurant?.name ? 'Panier Surprise' : normalized.name,
        originalPrice: normalized.originalPrice,
        discountedPrice: normalized.discountedPrice,
        quantityLeft: normalized.quantityLeft,
        pickupStart: normalized.pickupWindow.start,
        pickupEnd: normalized.pickupWindow.end,
        imageUrl: normalized.imageUrl,
      }];
    }
    return [];
  }, [basketTypesQuery.data, normalized, restaurant]);

  if (!restaurant || !normalized) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>Loading...</Text>
      </SafeAreaView>
    );
  }

  const coverImage = (restaurant as any).cover_image_url ?? restaurant.image_url;
  const averageRating = (restaurant as any).average_rating;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Cover photo */}
        <View style={{ height: 180, position: 'relative' }}>
          {coverImage ? (
            <Image source={{ uri: coverImage }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View style={{ width: '100%', height: '100%', backgroundColor: theme.colors.primary + '20' }} />
          )}
          {/* Back button */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              position: 'absolute',
              top: 50,
              left: 16,
              backgroundColor: 'rgba(255,255,255,0.9)',
              borderRadius: 20,
              width: 40,
              height: 40,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <ArrowLeft size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* White card overlay */}
        <View style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.r16,
          marginTop: -30,
          marginHorizontal: 16,
          padding: 20,
          ...theme.shadows.shadowMd,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Logo */}
            <View style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              borderWidth: 3,
              borderColor: theme.colors.bg,
              overflow: 'hidden',
              backgroundColor: theme.colors.surface,
              marginTop: -40,
            }}>
              {restaurant.image_url ? (
                <Image source={{ uri: restaurant.image_url }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <View style={{ width: '100%', height: '100%', backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
                  <ShoppingBag size={24} color={theme.colors.primary} />
                </View>
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }}>
                {restaurant.name}
              </Text>
              {restaurant.category && (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                  {restaurant.category}
                </Text>
              )}
            </View>
          </View>

          {/* Info chips */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            {restaurant.address && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }}>
                <MapPin size={12} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }} numberOfLines={1}>
                  {restaurant.address}
                </Text>
              </View>
            )}
            {restaurant.pickup_start_time && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Clock size={12} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }}>
                  {restaurant.pickup_start_time.substring(0, 5)} - {restaurant.pickup_end_time?.substring(0, 5)}
                </Text>
              </View>
            )}
            {averageRating != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Star size={12} color={theme.colors.starYellow} fill={theme.colors.starYellow} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }}>
                  {averageRating}
                </Text>
              </View>
            )}
            {(restaurant.available_left != null && restaurant.available_left > 0) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                  {restaurant.available_left} bags left
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Basket types section */}
        <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 100 }}>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 12 }}>
            Available Bags
          </Text>

          {basketTypesQuery.isLoading ? (
            <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginTop: 20 }} />
          ) : (
            displayBaskets.map((basket) => (
              <TouchableOpacity
                key={basket.id}
                onPress={() => router.push(`/basket/${restaurant.id}` as never)}
                style={{
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r16,
                  ...theme.shadows.shadowSm,
                  marginBottom: 10,
                  opacity: basket.quantityLeft > 0 ? 1 : 0.5,
                  flexDirection: 'row',
                  overflow: 'hidden',
                }}
              >
                <View style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }} numberOfLines={1}>
                    {basket.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                    <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' }}>
                      {basket.discountedPrice} TND
                    </Text>
                    <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through', marginLeft: 6 }}>
                      {basket.originalPrice} TND
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    {basket.pickupStart ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Clock size={11} color={theme.colors.muted} />
                        <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginLeft: 3 }}>
                          {basket.pickupStart}-{basket.pickupEnd}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={{ color: basket.quantityLeft > 0 ? theme.colors.primary : theme.colors.error, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                      {basket.quantityLeft > 0 ? `${basket.quantityLeft} left` : 'Sold out'}
                    </Text>
                  </View>
                </View>
                {basket.imageUrl ? (
                  <Image source={{ uri: basket.imageUrl }} style={{ width: 90, height: 90 }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 90, height: 90, backgroundColor: theme.colors.primary + '08', justifyContent: 'center', alignItems: 'center' }}>
                    <ShoppingBag size={28} color={theme.colors.muted} />
                  </View>
                )}
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
