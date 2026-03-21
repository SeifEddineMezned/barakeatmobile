import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Animated,
  TextInput,
  Image,
  Dimensions,
  PanResponder,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Search, Navigation, X, Clock, MapPin, ShoppingBag, ChevronUp } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { MapFallback } from '@/src/components/MapFallback';
import { fetchRestaurants } from '@/src/services/restaurants';
import { normalizeRestaurantToBasket } from '@/src/utils/normalizeRestaurant';
import type { Basket } from '@/src/types';

let MapView: any = null;
let Marker: any = null;
let Circle: any = null;

if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
  Circle = maps.Circle;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const MAP_STYLE = [
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#d4e4dc' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry.fill', stylers: [{ color: '#f0efe9' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.fill', stylers: [{ color: '#eae8e2' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e0ddd5' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#d6d2c4' }] },
];

const DEFAULT_CENTER = { latitude: 36.8065, longitude: 10.1815 };
const COLLAPSED_HEIGHT = 140;
const EXPANDED_HEIGHT = SCREEN_HEIGHT * 0.55;

/** Haversine distance in km */
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type BasketWithDist = Basket & { dist: number };

export default function DiscoverScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [selectedBasket, setSelectedBasket] = useState<BasketWithDist | null>(null);
  const [radius, setRadius] = useState(5);
  const [searchQuery, setSearchQuery] = useState('');
  const [tappedLocation, setTappedLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Bottom sheet animation
  const sheetHeight = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const isExpandedRef = useRef(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 5,
      onPanResponderMove: (_, gs) => {
        const currentHeight = isExpandedRef.current ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
        const newHeight = currentHeight - gs.dy;
        const clamped = Math.max(COLLAPSED_HEIGHT, Math.min(EXPANDED_HEIGHT, newHeight));
        sheetHeight.setValue(clamped);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy < -50) {
          Animated.spring(sheetHeight, { toValue: EXPANDED_HEIGHT, useNativeDriver: false, friction: 10 }).start();
          isExpandedRef.current = true;
          setIsExpanded(true);
        } else if (gs.dy > 50) {
          Animated.spring(sheetHeight, { toValue: COLLAPSED_HEIGHT, useNativeDriver: false, friction: 10 }).start();
          isExpandedRef.current = false;
          setIsExpanded(false);
        } else {
          const target = isExpandedRef.current ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
          Animated.spring(sheetHeight, { toValue: target, useNativeDriver: false, friction: 10 }).start();
        }
      },
    }),
  ).current;

  // Data
  const restaurantsQuery = useQuery({
    queryKey: ['restaurants'],
    queryFn: fetchRestaurants,
    staleTime: 60_000,
  });

  const baskets = useMemo(() => {
    if (!restaurantsQuery.data) return [];
    return restaurantsQuery.data.map(normalizeRestaurantToBasket);
  }, [restaurantsQuery.data]);

  const filteredBaskets = useMemo(() => {
    if (!searchQuery.trim()) return baskets;
    const q = searchQuery.toLowerCase();
    return baskets.filter(
      (b) => b.name.toLowerCase().includes(q) || b.merchantName.toLowerCase().includes(q),
    );
  }, [baskets, searchQuery]);

  const nearbyBaskets: BasketWithDist[] = useMemo(() => {
    const center = tappedLocation ?? DEFAULT_CENTER;
    return filteredBaskets
      .map((b) => ({ ...b, dist: getDistance(center.latitude, center.longitude, b.latitude, b.longitude) }))
      .filter((b) => b.dist <= radius)
      .sort((a, b) => a.dist - b.dist);
  }, [filteredBaskets, tappedLocation, radius]);

  const markers = filteredBaskets.map((b) => ({
    id: b.id,
    name: b.merchantName,
    lat: b.latitude,
    lng: b.longitude,
  }));

  // Handlers
  const handleMarkerPress = useCallback(
    (basket: BasketWithDist) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSelectedBasket(basket);
      // Collapse sheet to show the single card
      Animated.spring(sheetHeight, { toValue: COLLAPSED_HEIGHT, useNativeDriver: false, friction: 10 }).start();
      isExpandedRef.current = false;
      setIsExpanded(false);
    },
    [sheetHeight],
  );

  const handleMapPress = useCallback(
    (e: any) => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      setTappedLocation({ latitude, longitude });
      setSelectedBasket(null);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [],
  );

  const toggleSheet = useCallback(() => {
    const expanding = !isExpandedRef.current;
    const target = expanding ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    Animated.spring(sheetHeight, { toValue: target, useNativeDriver: false, friction: 10 }).start();
    isExpandedRef.current = expanding;
    setIsExpanded(expanding);
  }, [sheetHeight]);

  const center = tappedLocation ?? DEFAULT_CENTER;

  return (
    <View style={styles.container}>
      {/* ── Full-screen Map ── */}
      {Platform.OS !== 'web' && MapView ? (
        <MapView
          style={StyleSheet.absoluteFillObject}
          mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
          customMapStyle={Platform.OS === 'android' ? MAP_STYLE : undefined}
          initialRegion={{
            latitude: DEFAULT_CENTER.latitude,
            longitude: DEFAULT_CENTER.longitude,
            latitudeDelta: Math.max(0.02, radius * 0.015),
            longitudeDelta: Math.max(0.02, radius * 0.015),
          }}
          onPress={handleMapPress}
          showsUserLocation
          showsMyLocationButton={false}
        >
          {/* Tapped location pin */}
          {tappedLocation && Marker && (
            <Marker coordinate={tappedLocation}>
              <View
                style={{
                  backgroundColor: theme.colors.error,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  borderWidth: 3,
                  borderColor: '#fff',
                }}
              />
            </Marker>
          )}

          {/* Food spot markers */}
          {nearbyBaskets.map((basket) =>
            Marker ? (
              <Marker
                key={basket.id}
                coordinate={{ latitude: basket.latitude, longitude: basket.longitude }}
                onPress={() => handleMarkerPress(basket)}
              >
                <View
                  style={[
                    styles.markerContainer,
                    {
                      backgroundColor:
                        basket.isActive && basket.quantityLeft > 0
                          ? theme.colors.primary
                          : theme.colors.muted,
                      borderRadius: 20,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      ...theme.shadows.shadowMd,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: '700',
                      fontFamily: 'Poppins_700Bold',
                    }}
                  >
                    {basket.discountedPrice} TND
                  </Text>
                </View>
                <View
                  style={[
                    styles.markerArrow,
                    {
                      borderTopColor:
                        basket.isActive && basket.quantityLeft > 0
                          ? theme.colors.primary
                          : theme.colors.muted,
                    },
                  ]}
                />
              </Marker>
            ) : null,
          )}

          {/* Radius circle */}
          {Circle && (
            <Circle
              center={center}
              radius={radius * 1000}
              fillColor="rgba(17, 75, 60, 0.08)"
              strokeColor="rgba(17, 75, 60, 0.3)"
              strokeWidth={1.5}
            />
          )}
        </MapView>
      ) : (
        <MapFallback markers={markers} radius={radius} style={StyleSheet.absoluteFillObject} />
      )}

      {/* ── Floating search bar ── */}
      <View style={[styles.floatingSearch, { top: insets.top + 8, marginHorizontal: 16 }]}>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              ...theme.shadows.shadowMd,
            },
          ]}
        >
          <Search size={18} color={theme.colors.muted} />
          <TextInput
            style={[styles.searchInput, { color: theme.colors.textPrimary, ...theme.typography.body }]}
            placeholder={t('home.searchPlaceholder')}
            placeholderTextColor={theme.colors.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <X size={18} color={theme.colors.muted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Floating radius slider ── */}
      <View style={[styles.floatingRadius, { top: insets.top + 64, marginHorizontal: 16 }]}>
        <View
          style={[
            styles.radiusCard,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              ...theme.shadows.shadowMd,
              padding: 12,
            },
          ]}
        >
          <View style={styles.radiusRow}>
            <MapPin size={14} color={theme.colors.primary} />
            <Text
              style={[{
                color: theme.colors.textSecondary,
                ...theme.typography.caption,
                marginLeft: 4,
                flex: 1,
              }]}
            >
              {t('home.radiusFilter')}
            </Text>
            <Text
              style={[{
                color: theme.colors.primary,
                ...theme.typography.bodySm,
                fontWeight: '700' as const,
              }]}
            >
              {radius} {t('home.km')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            {[1, 3, 5, 10, 15, 20].map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => { setRadius(r); void Haptics.selectionAsync(); }}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 14,
                  backgroundColor: radius === r ? theme.colors.primary : theme.colors.bg,
                }}
              >
                <Text style={{
                  color: radius === r ? '#fff' : theme.colors.textSecondary,
                  fontSize: 12,
                  fontWeight: radius === r ? '700' : '400',
                  fontFamily: 'Poppins_500Medium',
                }}>
                  {r}km
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* ── Location button ── */}
      <TouchableOpacity
        style={[
          styles.locationButton,
          {
            bottom: COLLAPSED_HEIGHT + 16,
            right: 16,
            backgroundColor: theme.colors.surface,
            borderRadius: 28,
            width: 48,
            height: 48,
            ...theme.shadows.shadowLg,
          },
        ]}
        onPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
      >
        <Navigation size={20} color={theme.colors.primary} />
      </TouchableOpacity>

      {/* ── Bottom sheet ── */}
      <Animated.View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: sheetHeight,
          backgroundColor: theme.colors.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          ...theme.shadows.shadowLg,
          zIndex: 20,
        }}
      >
        {/* Drag handle area */}
        <View {...panResponder.panHandlers}>
          <View style={{ alignItems: 'center', paddingVertical: 10 }}>
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.colors.divider,
              }}
            />
          </View>
          <View
            style={{
              paddingHorizontal: 20,
              paddingBottom: 10,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
              {nearbyBaskets.length} {t('home.nearbySpots', { defaultValue: 'spots nearby' })}
            </Text>
            <TouchableOpacity onPress={toggleSheet}>
              <ChevronUp
                size={20}
                color={theme.colors.muted}
                style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Food spots list */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          scrollEnabled={isExpanded}
        >
          {selectedBasket ? (
            /* Single selected basket card */
            <TouchableOpacity
              onPress={() => router.push(`/basket/${selectedBasket.id}` as never)}
              activeOpacity={0.9}
              style={{
                flexDirection: 'row',
                padding: 12,
                backgroundColor: theme.colors.bg,
                borderRadius: 12,
                marginBottom: 8,
              }}
            >
              {selectedBasket.imageUrl ? (
                <Image
                  source={{ uri: selectedBasket.imageUrl }}
                  style={{ width: 60, height: 60, borderRadius: 10 }}
                />
              ) : (
                <View
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 10,
                    backgroundColor: theme.colors.primary + '10',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <ShoppingBag size={24} color={theme.colors.primary} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
                <Text
                  style={{
                    color: theme.colors.textPrimary,
                    ...theme.typography.bodySm,
                    fontWeight: '600',
                  }}
                  numberOfLines={1}
                >
                  {selectedBasket.merchantName}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Clock size={12} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginLeft: 3 }}>
                      {selectedBasket.pickupWindow.start}-{selectedBasket.pickupWindow.end}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                    {selectedBasket.dist.toFixed(1)} km
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 11,
                      textDecorationLine: 'line-through',
                    }}
                  >
                    {selectedBasket.originalPrice} TND
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.primary,
                      ...theme.typography.bodySm,
                      fontWeight: '700',
                      marginLeft: 6,
                    }}
                  >
                    {selectedBasket.discountedPrice} TND
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            nearbyBaskets.map((basket) => (
              <TouchableOpacity
                key={basket.id}
                onPress={() => router.push(`/basket/${basket.id}` as never)}
                activeOpacity={0.9}
                style={{
                  flexDirection: 'row',
                  padding: 12,
                  backgroundColor: theme.colors.bg,
                  borderRadius: 12,
                  marginBottom: 8,
                }}
              >
                {basket.imageUrl ? (
                  <Image
                    source={{ uri: basket.imageUrl }}
                    style={{ width: 60, height: 60, borderRadius: 10 }}
                  />
                ) : (
                  <View
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: 10,
                      backgroundColor: theme.colors.primary + '10',
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <ShoppingBag size={24} color={theme.colors.primary} />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
                  <Text
                    style={{
                      color: theme.colors.textPrimary,
                      ...theme.typography.bodySm,
                      fontWeight: '600',
                    }}
                    numberOfLines={1}
                  >
                    {basket.merchantName}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Clock size={12} color={theme.colors.muted} />
                      <Text style={{ color: theme.colors.muted, fontSize: 11, marginLeft: 3 }}>
                        {basket.pickupWindow.start}-{basket.pickupWindow.end}
                      </Text>
                    </View>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                      {basket.dist.toFixed(1)} km
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                    <Text
                      style={{
                        color: theme.colors.muted,
                        fontSize: 11,
                        textDecorationLine: 'line-through',
                      }}
                    >
                      {basket.originalPrice} TND
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.primary,
                        ...theme.typography.bodySm,
                        fontWeight: '700',
                        marginLeft: 6,
                      }}
                    >
                      {basket.discountedPrice} TND
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  floatingSearch: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 44,
  },
  searchInput: {
    marginLeft: 10,
    flex: 1,
  },
  floatingRadius: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
  radiusCard: {},
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationButton: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  markerContainer: {},
  markerArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    alignSelf: 'center',
    marginTop: -1,
  },
});
