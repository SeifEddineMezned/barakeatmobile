import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Search, Navigation, X, Clock, MapPin, ShoppingBag, ChevronUp } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useTheme } from '@/src/theme/ThemeProvider';
import { MapFallback } from '@/src/components/MapFallback';
import { fetchRestaurants } from '@/src/services/restaurants';
import { normalizeRestaurantToBasket } from '@/src/utils/normalizeRestaurant';
import type { Basket } from '@/src/types';
import { FeatureFlags } from '@/src/lib/featureFlags';

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

/* ─── Inline radius slider (zero new dependencies) ───────────────────────── */
const SLIDER_MIN = 1;
const SLIDER_MAX = 20;
const THUMB_SIZE = 24;
const THUMB_HALF = THUMB_SIZE / 2;
// Module-level stable offset constant for the thumb centering
const _THUMB_HALF_ANIM = new Animated.Value(THUMB_HALF);

function RadiusSlider({
  value,
  onChange,
  primaryColor,
  trackColor,
}: {
  value: number;
  onChange: (km: number) => void;
  primaryColor: string;
  trackColor: string;
}) {
  // Stable refs — never recreated
  const trackWidth = useRef(0);
  const trackPageX = useRef(0);       // absolute X of track on screen (stable anchor)
  const isDragging = useRef(false);   // skip external sync while dragging
  const lastKm = useRef(value);       // only fire onChange when km integer changes
  const thumbX = useRef(new Animated.Value(0)).current;

  // Store callbacks in refs so PanResponder (created once) always has fresh versions
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Convert km → pixel position (0 to trackWidth)
  const kmToXFn = (km: number, width: number) =>
    ((km - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * width;

  // Convert absolute screen X → clamped integer km
  const absToKmFn = (absX: number, width: number) => {
    const localX = absX - trackPageX.current;
    const clamped = Math.max(0, Math.min(width, localX));
    const raw = (clamped / width) * (SLIDER_MAX - SLIDER_MIN) + SLIDER_MIN;
    return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(raw)));
  };

  // Stable function refs for pan handler closures
  const kmToXRef = useRef(kmToXFn);
  const absToKmRef = useRef(absToKmFn);

  // Internal helper — set thumb to km value
  const setThumbToKm = (km: number, width: number) => {
    thumbX.setValue(kmToXRef.current(km, width));
  };

  // Sync thumb from prop only when not dragging
  const syncFromProp = (km: number) => {
    if (!isDragging.current && trackWidth.current > 0) {
      setThumbToKm(km, trackWidth.current);
      lastKm.current = km;
    }
  };

  // Keep in sync when 'value' prop changes (e.g. external reset)
  const valueRef = useRef(value);
  if (valueRef.current !== value) {
    valueRef.current = value;
    syncFromProp(value);
  }

  const sliderPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Capture start — use absolute coords to avoid locationX origin jumps
      onPanResponderGrant: (_, gs) => {
        isDragging.current = true;
        const w = trackWidth.current;
        if (w <= 0) return;
        const km = absToKmRef.current(gs.x0, w);
        thumbX.setValue(kmToXRef.current(km, w));
        if (km !== lastKm.current) {
          lastKm.current = km;
          onChangeRef.current(km);
        }
      },
      // Move — use gestureState.moveX (stable absolute X, no origin hop)
      onPanResponderMove: (_, gs) => {
        const w = trackWidth.current;
        if (w <= 0) return;
        const km = absToKmRef.current(gs.moveX, w);
        const px = Math.max(0, Math.min(w, gs.moveX - trackPageX.current));
        thumbX.setValue(px);
        if (km !== lastKm.current) {
          lastKm.current = km;
          onChangeRef.current(km);
          void Haptics.selectionAsync();
        }
      },
      // Release — snap thumb to final integer km
      onPanResponderRelease: (_, gs) => {
        const w = trackWidth.current;
        if (w <= 0) { isDragging.current = false; return; }
        const km = absToKmRef.current(gs.moveX, w);
        thumbX.setValue(kmToXRef.current(km, w)); // snap to exact integer position
        if (km !== lastKm.current) {
          lastKm.current = km;
          onChangeRef.current(km);
        }
        isDragging.current = false;
      },
    }),
  ).current;

  return (
    <View
      style={{ paddingVertical: 8, paddingHorizontal: 2 }}
      onLayout={(e) => {
        const { width, x } = e.nativeEvent.layout;
        trackWidth.current = width;
        // Measure absolute position on screen for stable anchor
        // We'll capture it via a ref measure below; use layout x as initial fallback
        if (!isDragging.current) {
          setThumbToKm(lastKm.current, width);
        }
      }}
      ref={(ref: any) => {
        // Capture absolute pageX so gesture math is screen-relative
        if (ref && ref.measure) {
          ref.measure((_x: number, _y: number, _w: number, _h: number, px: number) => {
            if (px !== undefined && px !== null) {
              trackPageX.current = px;
            }
          });
        }
      }}
      {...sliderPan.panHandlers}
    >
      {/* Track */}
      <View
        style={{
          height: 5,
          borderRadius: 3,
          backgroundColor: trackColor,
          overflow: 'visible',
        }}
      >
        {/* Filled portion */}
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: thumbX,
            backgroundColor: primaryColor,
            borderRadius: 3,
          }}
        />
        {/* Thumb */}
        <Animated.View
          style={{
            position: 'absolute',
            top: -(THUMB_HALF - 2),
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            borderRadius: THUMB_HALF,
            backgroundColor: primaryColor,
            borderWidth: 3,
            borderColor: '#fff',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 5,
            transform: [{ translateX: Animated.subtract(thumbX, _THUMB_HALF_ANIM) }],
          }}
        />
      </View>
      {/* Min / max labels */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
        <Text style={{ fontSize: 10, color: trackColor, fontFamily: 'Poppins_500Medium' }}>1 km</Text>
        <Text style={{ fontSize: 10, color: trackColor, fontFamily: 'Poppins_500Medium' }}>20 km</Text>
      </View>
    </View>
  );
}
/* ─────────────────────────────────────────────────────────────────────────── */

export default function DiscoverScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [selectedBasket, setSelectedBasket] = useState<BasketWithDist | null>(null);
  const [radius, setRadius] = useState(5);
  const [searchQuery, setSearchQuery] = useState('');

  // Real device location
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'loading' | 'granted' | 'denied'>('loading');
  const mapRef = useRef<any>(null);

  // Easter egg: Map constellation
  const [showConstellationBanner, setShowConstellationBanner] = useState(false);
  const constellationShown = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          console.log('[Nearby] Location permission denied');
          setLocationStatus('denied');
          return;
        }
        setLocationStatus('granted');
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        console.log('[Nearby] User location:', coords);
        setUserLocation(coords);
      } catch (e) {
        console.log('[Nearby] Location error:', e);
        if (!cancelled) setLocationStatus('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Re-center the map on the user's real position
  const handleRecenter = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mapRef.current && userLocation) {
      mapRef.current.animateToRegion({
        ...userLocation,
        latitudeDelta: Math.max(0.02, radius * 0.015),
        longitudeDelta: Math.max(0.02, radius * 0.015),
      }, 600);
    }
  }, [userLocation, radius]);

  // Effective center for radius filtering: real user location or Tunis fallback
  const center = userLocation ?? DEFAULT_CENTER;

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
    return filteredBaskets
      .filter((b) => b.hasCoords)
      .map((b) => ({
        ...b,
        dist: getDistance(center.latitude, center.longitude, b.latitude as number, b.longitude as number),
      }))
      .filter((b) => b.dist <= radius)
      .sort((a, b) => a.dist - b.dist);
  }, [filteredBaskets, center, radius]);

  // Restaurants with no real coordinates — still shown in list, never on map
  const noCoordBaskets = useMemo(
    () => filteredBaskets.filter((b) => !b.hasCoords),
    [filteredBaskets],
  );

  // Only place in-radius restaurants on the map (they already have real coords)
  const markers = nearbyBaskets.map((b) => ({
    id: b.id,
    name: b.merchantName,
    lat: b.latitude as number,
    lng: b.longitude as number,
  }));

  // Handlers
  const handleMarkerPress = useCallback(
    (basket: BasketWithDist) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSelectedBasket(basket);
      Animated.spring(sheetHeight, { toValue: COLLAPSED_HEIGHT, useNativeDriver: false, friction: 10 }).start();
      isExpandedRef.current = false;
      setIsExpanded(false);
    },
    [sheetHeight],
  );

  const handleMapPress = useCallback(
    () => { setSelectedBasket(null); },
    [],
  );

  const toggleSheet = useCallback(() => {
    const expanding = !isExpandedRef.current;
    const target = expanding ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    Animated.spring(sheetHeight, { toValue: target, useNativeDriver: false, friction: 10 }).start();
    isExpandedRef.current = expanding;
    setIsExpanded(expanding);
  }, [sheetHeight]);

  return (
    <View style={styles.container}>
      {/* ── Full-screen Map ── */}
      {Platform.OS !== 'web' && MapView ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
          customMapStyle={Platform.OS === 'android' ? MAP_STYLE : undefined}
          initialRegion={{
            latitude: center.latitude,
            longitude: center.longitude,
            latitudeDelta: Math.max(0.02, radius * 0.015),
            longitudeDelta: Math.max(0.02, radius * 0.015),
          }}
          onPress={handleMapPress}
          showsUserLocation
          showsMyLocationButton={false}
          onRegionChange={(region: any) => {
            if (
              FeatureFlags.ENABLE_EASTER_EGGS &&
              FeatureFlags.ENABLE_MAP_EASTER_EGG &&
              region.latitudeDelta > 0.3 &&
              nearbyBaskets.length >= 2 &&
              !constellationShown.current
            ) {
              constellationShown.current = true;
              setShowConstellationBanner(true);
              setTimeout(() => setShowConstellationBanner(false), 4000);
            }
          }}
        >
          {/* 🧺 Restaurant / business basket markers */}
          {nearbyBaskets.map((basket) =>
            Marker && basket.hasCoords ? (
              <Marker
                key={basket.id}
                coordinate={{
                  latitude: basket.latitude as number,
                  longitude: basket.longitude as number,
                }}
                anchor={{ x: 0.5, y: 1 }}
                onPress={() => handleMarkerPress(basket)}
              >
                <View style={{ alignItems: 'center' }}>
                  <View
                    style={{
                      backgroundColor: basket.isActive && basket.quantityLeft > 0
                        ? '#114b3c'
                        : '#888',
                      borderRadius: 14,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 3,
                      shadowColor: '#000',
                      shadowOpacity: 0.25,
                      shadowRadius: 4,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: 5,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>🧺</Text>
                    <Text
                      style={{
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: '700',
                        fontFamily: 'Poppins_700Bold',
                      }}
                    >
                      {basket.discountedPrice} TND
                    </Text>
                  </View>
                  {/* callout arrow */}
                  <View
                    style={{
                      width: 0,
                      height: 0,
                      borderLeftWidth: 5,
                      borderRightWidth: 5,
                      borderTopWidth: 6,
                      borderLeftColor: 'transparent',
                      borderRightColor: 'transparent',
                      borderTopColor: basket.isActive && basket.quantityLeft > 0
                        ? '#114b3c'
                        : '#888',
                    }}
                  />
                </View>
              </Marker>
            ) : null,
          )}

          {/* 📍 User's current location — custom "me" pin */}
          {Marker && userLocation && (
            <Marker
              coordinate={userLocation}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={99}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: '#114b3c',
                  borderWidth: 3,
                  borderColor: '#fff',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOpacity: 0.3,
                  shadowRadius: 6,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 9,
                }}
              >
                <Text style={{ fontSize: 16 }}>🧑</Text>
              </View>
            </Marker>
          )}

          {/* Radius circle — clean teal, subtle but visible */}
          {Circle && (
            <Circle
              center={center}
              radius={radius * 1000}
              fillColor="rgba(17, 75, 60, 0.08)"
              strokeColor="rgba(17, 75, 60, 0.55)"
              strokeWidth={2.5}
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
          <View style={{ marginTop: 8 }}>
            <RadiusSlider
              value={radius}
              onChange={(km) => {
                setRadius(km);
              }}
              primaryColor={theme.colors.primary}
              trackColor={theme.colors.muted ?? '#ccc'}
            />
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
        onPress={handleRecenter}
      >
        {locationStatus === 'loading' ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Navigation size={20} color={userLocation ? theme.colors.primary : theme.colors.muted} />
        )}
      </TouchableOpacity>

      {/* ── Location permission denied banner ── */}
      {locationStatus === 'denied' && (
        <View
          style={{
            position: 'absolute',
            top: 140 + insets.top,
            left: 16,
            right: 16,
            backgroundColor: 'rgba(220,80,60,0.92)',
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 8,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <MapPin size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, marginLeft: 6, flex: 1, fontFamily: 'Poppins_500Medium' }}>
            Location access denied — results based on Tunis center
          </Text>
        </View>
      )}

      {/* Easter egg: Map constellation banner */}
      {showConstellationBanner && (
        <View style={{
          position: 'absolute',
          bottom: COLLAPSED_HEIGHT + 20,
          left: 16,
          right: 16,
          zIndex: 30,
          backgroundColor: '#114b3c',
          borderRadius: 16,
          paddingVertical: 14,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 8,
          elevation: 8,
        }}>
          <Text style={{ fontSize: 18, marginRight: 10 }}>🌟</Text>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flex: 1 }}>
            You found the Barakeat Constellation! +50 XP
          </Text>
        </View>
      )}

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
          {/* Restaurants with no backend coordinates — shown below, not on map */}
          {noCoordBaskets.length > 0 && !selectedBasket && (
            <>
              {nearbyBaskets.length > 0 && (
                <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 12, marginBottom: 6 }}>
                  {t('home.otherSpots', { defaultValue: 'Other spots' })}
                </Text>
              )}
              {noCoordBaskets.map((basket) => (
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
                    opacity: basket.isActive && basket.quantityLeft > 0 ? 1 : 0.5,
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
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <MapPin size={10} color={theme.colors.muted} />
                        <Text style={{ color: theme.colors.muted, fontSize: 11, marginLeft: 2 }}>
                          {basket.address || t('home.locationUnknown', { defaultValue: 'No location' })}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
                      <Text style={{ color: theme.colors.muted, fontSize: 11, textDecorationLine: 'line-through' }}>
                        {basket.originalPrice} TND
                      </Text>
                      <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700', marginLeft: 6 }}>
                        {basket.discountedPrice} TND
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </>
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
