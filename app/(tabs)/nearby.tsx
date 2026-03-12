import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { mockBaskets } from '@/src/mocks/baskets';
import { MapFallback } from '@/src/components/MapFallback';

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

  const markers = mockBaskets.map((b) => ({
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
          {mockBaskets.map((basket) => (
            <Marker
              key={basket.id}
              coordinate={{
                latitude: basket.latitude,
                longitude: basket.longitude,
              }}
              title={basket.merchantName}
              description={`${basket.discountedPrice} TND`}
            />
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
