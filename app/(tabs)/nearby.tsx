import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { MapFallback } from '@/src/components/MapFallback';
import { fetchBaskets } from '@/src/services/baskets';
import type { Basket } from '@/src/types';

let MapView: any = null;
let Marker: any = null;

if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
}

function normalizeBasket(raw: any): Basket {
  return {
    id: String(raw.id ?? raw._id ?? ''),
    merchantId: raw.merchantId ?? raw.merchant_id ?? '',
    merchantName: raw.merchantName ?? raw.merchant_name ?? raw.businessName ?? 'Unknown',
    merchantLogo: raw.merchantLogo ?? raw.merchant_logo ?? undefined,
    merchantRating: raw.merchantRating ?? raw.merchant_rating ?? undefined,
    reviewCount: raw.reviewCount ?? undefined,
    reviews: raw.reviews ?? undefined,
    description: raw.description ?? undefined,
    name: raw.name ?? raw.title ?? 'Basket',
    category: raw.category ?? '',
    originalPrice: Number(raw.originalPrice ?? raw.original_price ?? 0),
    discountedPrice: Number(raw.discountedPrice ?? raw.discounted_price ?? 0),
    discountPercentage: Number(raw.discountPercentage ?? 50),
    pickupWindow: raw.pickupWindow ?? raw.pickup_window ?? { start: '18:00', end: '19:00' },
    quantityLeft: Number(raw.quantityLeft ?? raw.quantity_left ?? 0),
    quantityTotal: Number(raw.quantityTotal ?? raw.quantity_total ?? 0),
    distance: Number(raw.distance ?? 0),
    address: raw.address ?? '',
    latitude: Number(raw.latitude ?? 36.8065),
    longitude: Number(raw.longitude ?? 10.1815),
    exampleItems: raw.exampleItems ?? raw.example_items ?? [],
    imageUrl: raw.imageUrl ?? raw.image_url ?? undefined,
    isActive: raw.isActive ?? true,
    isSupermarket: raw.isSupermarket ?? false,
  };
}

export default function NearbyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  const basketsQuery = useQuery({
    queryKey: ['baskets'],
    queryFn: fetchBaskets,
    staleTime: 60_000,
  });

  const baskets = useMemo(() => {
    if (!basketsQuery.data) return [];
    return basketsQuery.data.map(normalizeBasket);
  }, [basketsQuery.data]);

  const markers = baskets.map((b) => ({
    id: b.id,
    name: b.merchantName,
    lat: b.latitude,
    lng: b.longitude,
  }));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('map.title')}</Text>
      </View>
      {Platform.OS !== 'web' && MapView ? (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: 36.8065,
            longitude: 10.1815,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          {baskets.map((basket) => (
            Marker ? (
              <Marker
                key={basket.id}
                coordinate={{
                  latitude: basket.latitude,
                  longitude: basket.longitude,
                }}
                title={basket.merchantName}
                description={`${basket.discountedPrice} TND`}
              />
            ) : null
          ))}
        </MapView>
      ) : (
        <MapFallback markers={markers} style={styles.map} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {},
  map: {
    flex: 1,
  },
});
