import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { MapFallback } from '@/src/components/MapFallback';
import { fetchRestaurants } from '@/src/services/restaurants';
import { normalizeRestaurantToBasket } from '@/src/utils/normalizeRestaurant';

let MapView: any = null;
let Marker: any = null;

if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
}

export default function NearbyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  const restaurantsQuery = useQuery({
    queryKey: ['restaurants'],
    queryFn: fetchRestaurants,
    staleTime: 60_000,
  });

  const baskets = useMemo(() => {
    if (!restaurantsQuery.data) return [];
    return restaurantsQuery.data.map(normalizeRestaurantToBasket);
  }, [restaurantsQuery.data]);

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
