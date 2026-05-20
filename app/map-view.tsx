/**
 * map-view.tsx — Root-level stack screen presenting the map ABOVE the tab navigator.
 * Opened via router.push('/map-view') from Découvrir.
 * Contains the full existing map logic from nearby.tsx (same component, same state).
 * No tab-bar contamination possible — it is a pure stack screen in the root Stack.
 */
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
import { Search, Navigation, X, Clock, MapPin, ShoppingBag, ChevronUp, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react-native';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '@/src/theme/ThemeProvider';
import { MapFallback } from '@/src/components/MapFallback';
import { SmartMarker } from '@/src/components/SmartMarker';
import { fetchLocations } from '@/src/services/restaurants';
import { normalizeLocationToBasket } from '@/src/utils/normalizeRestaurant';
import type { Basket } from '@/src/types';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { useAddressStore } from '@/src/stores/addressStore';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { BasketCard } from '@/src/components/BasketCard';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';

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
// FULL_HEIGHT computed inside component using insets

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

const SLIDER_MIN = 1;
const SLIDER_MAX = 60;
const THUMB_SIZE = 24;
const THUMB_HALF = THUMB_SIZE / 2;
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
  const trackWidth = useRef(0);
  const trackPageX = useRef(0);
  const isDragging = useRef(false);
  const lastKm = useRef(value);
  const thumbX = useRef(new Animated.Value(0)).current;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const kmToXFn = (km: number, width: number) =>
    ((km - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * width;

  const absToKmFn = (absX: number, width: number) => {
    const localX = absX - trackPageX.current;
    const clamped = Math.max(0, Math.min(width, localX));
    const raw = (clamped / width) * (SLIDER_MAX - SLIDER_MIN) + SLIDER_MIN;
    return Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, Math.round(raw)));
  };

  const kmToXRef = useRef(kmToXFn);
  const absToKmRef = useRef(absToKmFn);

  const setThumbToKm = (km: number, width: number) => {
    thumbX.setValue(kmToXRef.current(km, width));
  };

  const syncFromProp = (km: number) => {
    if (!isDragging.current && trackWidth.current > 0) {
      setThumbToKm(km, trackWidth.current);
      lastKm.current = km;
    }
  };

  const valueRef = useRef(value);
  if (valueRef.current !== value) {
    valueRef.current = value;
    syncFromProp(value);
  }

  const sliderPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_, gs) => {
        isDragging.current = true;
        const w = trackWidth.current;
        if (w <= 0) return;
        const km = absToKmRef.current(gs.x0, w);
        thumbX.setValue(kmToXRef.current(km, w));
        if (km !== lastKm.current) { lastKm.current = km; onChangeRef.current(km); }
      },
      onPanResponderMove: (_, gs) => {
        const w = trackWidth.current;
        if (w <= 0) return;
        const km = absToKmRef.current(gs.moveX, w);
        const px = Math.max(0, Math.min(w, gs.moveX - trackPageX.current));
        thumbX.setValue(px);
        if (km !== lastKm.current) { lastKm.current = km; onChangeRef.current(km); }
      },
      onPanResponderRelease: (_, gs) => {
        const w = trackWidth.current;
        if (w <= 0) { isDragging.current = false; return; }
        const km = absToKmRef.current(gs.moveX, w);
        thumbX.setValue(kmToXRef.current(km, w));
        if (km !== lastKm.current) { lastKm.current = km; onChangeRef.current(km); }
        isDragging.current = false;
      },
    }),
  ).current;

  return (
    <View
      style={{ paddingVertical: 8, paddingHorizontal: 2 }}
      onLayout={(e) => {
        const { width } = e.nativeEvent.layout;
        trackWidth.current = width;
        if (!isDragging.current) setThumbToKm(lastKm.current, width);
      }}
      ref={(ref: any) => {
        if (ref && ref.measure) {
          ref.measure((_x: number, _y: number, _w: number, _h: number, px: number) => {
            if (px !== undefined && px !== null) trackPageX.current = px;
          });
        }
      }}
      {...sliderPan.panHandlers}
    >
      <View style={{ height: 5, borderRadius: 3, backgroundColor: trackColor, overflow: 'visible' }}>
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: thumbX, backgroundColor: primaryColor, borderRadius: 3 }} />
        <Animated.View
          style={{
            position: 'absolute', top: -(THUMB_HALF - 2),
            width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_HALF,
            backgroundColor: primaryColor, borderWidth: 3, borderColor: '#fff',
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 }, elevation: 5,
            transform: [{ translateX: Animated.subtract(thumbX, _THUMB_HALF_ANIM) }],
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
        <Text style={{ fontSize: 10, color: trackColor, fontFamily: 'Poppins_500Medium' }}>1 km</Text>
        <Text style={{ fontSize: 10, color: trackColor, fontFamily: 'Poppins_500Medium' }}>{SLIDER_MAX} km</Text>
      </View>
    </View>
  );
}

export default function MapViewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const FULL_HEIGHT = SCREEN_HEIGHT - insets.top - 56; // stops below search bar + back btn

  const favoriteBasketIds = useFavoritesStore((s) => s.favoriteBasketIds);
  const toggleBasketFavorite = useFavoritesStore((s) => s.toggleBasketFavorite);

  const [selectedBasket, setSelectedBasket] = useState<BasketWithDist | null>(null);
  const [radius, setRadius] = useState(5);
  // The floating radius card opens compact (just "5 km" pill) and expands
  // into the full slider on tap. Less visual weight by default, still
  // discoverable.
  const [radiusExpanded, setRadiusExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCategory, setSearchCategory] = useState<string | null>(null);
  // Inline category filter shown under the search bar on the map itself
  // (independent of the full-page search overlay's searchCategory). When
  // set, map markers AND the bottom list are narrowed to that category.
  const [mapCategory, setMapCategory] = useState<string | null>(null);
  const [searchFullScreen, setSearchFullScreen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);

  const openSearch = useCallback(() => {
    setSearchFullScreen(true);
    setTimeout(() => searchInputRef.current?.focus(), 150);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchQuery('');
    setSearchCategory(null);
    searchInputRef.current?.blur();
    setSearchFullScreen(false);
  }, []);

  const getRestingFill = (r: number) => 0.05 + (1 - Math.min(r, 20) / 20) * 0.13;
  const getRestingStroke = (r: number) => 0.35 + (1 - Math.min(r, 20) / 20) * 0.35;

  // Circle opacity — use state that only updates ONCE per radius change (at rest),
  // not on every animation frame. The pulse animation was causing rapid re-renders
  // that made the address pin marker disappear on Android.
  const [circleFill, setCircleFill] = useState(getRestingFill(5));
  const [circleStroke, setCircleStroke] = useState(getRestingStroke(5));

  useEffect(() => {
    setCircleFill(getRestingFill(radius));
    setCircleStroke(getRestingStroke(radius));
  }, [radius]);

  // Memoize color strings so Circle doesn't get new props on every render
  const circleFillColor = useMemo(() => `rgba(59, 130, 246, ${circleFill.toFixed(3)})`, [circleFill]);
  const circleStrokeColor = useMemo(() => `rgba(59, 130, 246, ${circleStroke.toFixed(3)})`, [circleStroke]);

  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'loading' | 'granted' | 'denied'>('loading');
  const mapRef = useRef<any>(null);
  const [showConstellationBanner, setShowConstellationBanner] = useState(false);
  const constellationShown = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') { setLocationStatus('denied'); return; }
        setLocationStatus('granted');
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        console.log('[Nearby] User location:', coords);
        setUserLocation(coords);
      } catch (e) {
        if (!cancelled) setLocationStatus('denied');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Use saved address (Tunisia) for center, not device GPS (could be US/abroad)
  // Must be defined BEFORE handleRecenter so the callback captures the current value
  const { addresses, selectedId } = useAddressStore();
  const selectedAddr = addresses.find((a) => a.id === selectedId);
  const center = useMemo(() =>
    selectedAddr
      ? { latitude: selectedAddr.lat, longitude: selectedAddr.lng }
      // No saved address: prefer the phone's current GPS (if the user granted
      // permission). Falling back to the static DEFAULT_CENTER (Tunis) only when
      // the device location is still resolving or was denied.
      : userLocation ?? DEFAULT_CENTER,
    // Include lat/lng so editing an existing address in place (same id, moved pin) also
    // re-renders the marker and circle — not just switching to a different saved address.
    // Also re-runs when userLocation arrives so the marker + circle snap to GPS on first fix.
    [selectedAddr?.id, selectedAddr?.lat, selectedAddr?.lng, userLocation?.latitude, userLocation?.longitude]
  );


  const handleRecenter = useCallback(() => {
    if (mapRef.current) {
      const target = selectedAddr
        ? { latitude: selectedAddr.lat, longitude: selectedAddr.lng }
        : userLocation ?? DEFAULT_CENTER;
      mapRef.current.animateToRegion({ ...target, latitudeDelta: Math.max(0.02, radius * 0.015), longitudeDelta: Math.max(0.02, radius * 0.015) }, 600);
    }
  }, [selectedAddr, userLocation, radius]);

  // Auto-center on first location fix — mirrors the arrow-button behavior exactly.
  const hasAutocentered = useRef(false);
  useEffect(() => {
    if (userLocation && mapRef.current && !hasAutocentered.current) {
      hasAutocentered.current = true;
      const timer = setTimeout(() => {
        if (mapRef.current && userLocation) {
          mapRef.current.animateToRegion(
            { ...userLocation, latitudeDelta: Math.max(0.02, radius * 0.015), longitudeDelta: Math.max(0.02, radius * 0.015) },
            600,
          );
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [userLocation, radius]);

  // Auto-zoom map when radius changes so the circle stays visible
  useEffect(() => {
    if (mapRef.current) {
      const delta = Math.max(0.02, radius * 0.018);
      mapRef.current.animateToRegion({ ...center, latitudeDelta: delta, longitudeDelta: delta }, 400);
    }
  }, [radius]);

  // Auto-center map when user changes their selected address OR edits the
  // current address's pin in place (same id, new lat/lng).
  useEffect(() => {
    if (mapRef.current && selectedAddr) {
      const delta = Math.max(0.02, radius * 0.015);
      mapRef.current.animateToRegion(
        { latitude: selectedAddr.lat, longitude: selectedAddr.lng, latitudeDelta: delta, longitudeDelta: delta },
        600,
      );
    }
  }, [selectedAddr?.id, selectedAddr?.lat, selectedAddr?.lng]);

  const sheetHeight = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  // 3-state: 0 = collapsed, 1 = expanded (half), 2 = full
  const sheetLevelRef = useRef(0);
  const [sheetLevel, setSheetLevel] = useState(0);
  const isExpanded = sheetLevel >= 1;
  const isExpandedRef = { current: sheetLevel >= 1 }; // compat

  const getHeightForLevel = (lvl: number) => lvl === 0 ? COLLAPSED_HEIGHT : lvl === 1 ? EXPANDED_HEIGHT : FULL_HEIGHT;

  const animateToLevel = (lvl: number) => {
    sheetLevelRef.current = lvl;
    setSheetLevel(lvl);
    Animated.spring(sheetHeight, { toValue: getHeightForLevel(lvl), useNativeDriver: false, friction: 10 }).start();
  };

  // Bottom sheet drag gesture — uses react-native-gesture-handler for reliable
  // Samsung touch handling (PanResponder steals taps from cards on Samsung)
  const sheetPanGesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetY([-15, 15])
      .failOffsetX([-20, 20])
      .onUpdate((e) => {
        const currentHeight = getHeightForLevel(sheetLevelRef.current);
        const clamped = Math.max(COLLAPSED_HEIGHT, Math.min(FULL_HEIGHT, currentHeight - e.translationY));
        sheetHeight.setValue(clamped);
      })
      .onEnd((e) => {
        const cur = sheetLevelRef.current;
        if (e.translationY < -50) {
          animateToLevel(Math.min(2, cur + 1));
        } else if (e.translationY > 50) {
          animateToLevel(Math.max(0, cur - 1));
        } else {
          Animated.spring(sheetHeight, { toValue: getHeightForLevel(cur), useNativeDriver: false, friction: 10 }).start();
        }
      }),
  [sheetHeight]);

  const locationsQuery = useQuery({ queryKey: ['locations'], queryFn: fetchLocations, staleTime: 30_000, refetchInterval: 60_000, refetchOnMount: 'always' });

  const baskets = useMemo(() => {
    if (!locationsQuery.data) return [];
    return locationsQuery.data.map(normalizeLocationToBasket);
  }, [locationsQuery.data]);

  // Map shows all baskets by default. When the inline category dropdown
  // has a selection, narrow to that category — both the pins on the map
  // and the bottom-sheet list react, so locations that don't fit the chosen
  // category are pulled from view entirely.
  const filteredBaskets = useMemo(() => {
    if (!mapCategory) return baskets;
    return baskets.filter((b) => b.category === mapCategory);
  }, [baskets, mapCategory]);

  // All baskets with coords + distance
  const allCoordsBaskets: BasketWithDist[] = useMemo(() => {
    return filteredBaskets
      .filter((b) => b.hasCoords)
      .map((b) => ({ ...b, dist: getDistance(center.latitude, center.longitude, b.latitude as number, b.longitude as number) }))
      .sort((a, b) => a.dist - b.dist);
  }, [filteredBaskets, center]);

  // Nearby baskets for the bottom sheet list (filtered by radius)
  const nearbyBaskets = useMemo(() => allCoordsBaskets.filter((b) => b.dist <= radius), [allCoordsBaskets, radius]);

  // Single stable pin list — deduplicate ALL baskets by merchantId + coordinates.
  // This list NEVER changes length during zoom/drag (only `dist` values change),
  // so React never unmounts/remounts markers, which prevents the address pin
  // from disappearing as collateral damage during child-list reconciliation.
  const allPins = useMemo(() => {
    const map = new Map<string, BasketWithDist & { totalQty: number }>();
    const coordsSeen = new Set<string>();
    for (const b of allCoordsBaskets) {
      const coordKey = `${(b.latitude as number).toFixed(4)},${(b.longitude as number).toFixed(4)}`;
      const key = b.merchantId;
      const existing = map.get(key);
      if (existing) {
        existing.totalQty += b.quantityLeft;
      } else if (coordsSeen.has(coordKey)) {
        const existingByCoord = Array.from(map.values()).find(
          p => (p.latitude as number).toFixed(4) === (b.latitude as number).toFixed(4)
            && (p.longitude as number).toFixed(4) === (b.longitude as number).toFixed(4)
        );
        if (existingByCoord) existingByCoord.totalQty += b.quantityLeft;
      } else {
        map.set(key, { ...b, totalQty: b.quantityLeft });
        coordsSeen.add(coordKey);
      }
    }
    return Array.from(map.values());
  }, [allCoordsBaskets]);

  const noCoordBaskets = useMemo(() => filteredBaskets.filter((b) => !b.hasCoords), [filteredBaskets]);

  const markers = allCoordsBaskets.map((b) => ({ id: b.id, name: b.merchantName, lat: b.latitude as number, lng: b.longitude as number }));

  // Search suggestions — search ALL locations (not radius-limited)
  // Search suggestions — filter by text query AND/OR category
  const searchSuggestions = useMemo(() => {
    if (!searchQuery.trim() && !searchCategory) return [];
    const withCoords = baskets.filter((b) => b.hasCoords);
    const withDist = withCoords.map((b) => ({ ...b, dist: getDistance(center.latitude, center.longitude, b.latitude as number, b.longitude as number) }));
    let filtered = withDist;
    if (searchCategory) {
      filtered = filtered.filter((b) => b.category === searchCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((b) => b.name.toLowerCase().includes(q) || b.merchantName.toLowerCase().includes(q) || (b.category ?? '').toLowerCase().includes(q));
    }
    return filtered.sort((a, b) => a.dist - b.dist).slice(0, 15);
  }, [baskets, searchQuery, searchCategory, center]);

  const handleMarkerPress = useCallback((basket: BasketWithDist) => {
    setSelectedBasket(basket);
    animateToLevel(0);
  }, []);

  const handleMapPress = useCallback(() => { setSelectedBasket(null); }, []);

  const toggleSheet = useCallback(() => {
    animateToLevel(sheetLevelRef.current === 0 ? 1 : 0);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* White header bg when sheet is full */}
      {sheetLevel === 2 && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 52, backgroundColor: '#fff', zIndex: 25, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)' }} />
      )}

      {/* ── Back button — returns to Découvrir cleanly ── */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={[styles.backBtn, { top: insets.top + 8, backgroundColor: 'rgba(255,255,255,0.92)', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 5 }]}
        accessibilityLabel="Back to Découvrir"
      >
        <ChevronLeft size={22} color="#114b3c" />
      </TouchableOpacity>

      {/* ── Title — hidden when search is open ── */}
      {!searchFullScreen && (
        <View style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, zIndex: 10, alignItems: 'center', pointerEvents: 'none' }}>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 5 }}>
            <Text style={{ color: '#114b3c', fontSize: 17, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              {t('home.discover', { defaultValue: 'Discover' })}
            </Text>
          </View>
        </View>
      )}

      {/* ── Full-screen Map ── */}
      {Platform.OS !== 'web' && MapView ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
          customMapStyle={Platform.OS === 'android' ? MAP_STYLE : undefined}
          initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: Math.max(0.02, radius * 0.015), longitudeDelta: Math.max(0.02, radius * 0.015) }}
          onPress={handleMapPress}
          showsUserLocation={false}
          showsMyLocationButton={false}
          clusteringEnabled={false}
          onRegionChangeComplete={(region: any) => {
            if (FeatureFlags.ENABLE_EASTER_EGGS && FeatureFlags.ENABLE_MAP_EASTER_EGG && region.latitudeDelta > 0.3 && nearbyBaskets.length >= 2 && !constellationShown.current) {
              constellationShown.current = true;
              setShowConstellationBanner(true);
              setTimeout(() => setShowConstellationBanner(false), 4000);
            }
          }}
        >
          {/* ── Address pin + radius circle — rendered FIRST with stable keys.
              These never unmount. The pin uses a native image marker (no custom
              View child) so react-native-maps treats it as a lightweight native
              object that survives child-list reconciliation on both iOS and Android. */}
          {Marker && (
            <Marker
              key="address-pin"
              identifier="address-pin"
              coordinate={center}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={true}
              zIndex={9999}
              flat={false}
              stopPropagation={true}
            >
              <View style={{ alignItems: 'center', width: 24, height: 30 }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#3b82f6', borderWidth: 3, borderColor: '#fff' }} />
                <View style={{ width: 0, height: 0, marginTop: -1, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#3b82f6' }} />
              </View>
            </Marker>
          )}
          {Circle && (
            <Circle key="radius-circle" center={center} radius={radius * 1000} fillColor={circleFillColor} strokeColor={circleStrokeColor} strokeWidth={2.5} />
          )}
          {/* ── Business pins — ONE stable list, never changes length during zoom/drag.
              Each pin is styled rich (nearby) or simple (far) based on distance. */}
          {allPins.map((pin) => {
            if (!Marker || !pin.hasCoords) return null;
            const isNearby = pin.dist <= radius;
            // bustKey re-captures the marker bitmap on Android whenever the
            // pin's visual state changes (nearby/far toggle, stock count), so
            // dragging the radius slider live-updates the markers. Without it,
            // Android freezes the first bitmap and the icons look clipped.
            const bustKey = `${isNearby ? 'near' : 'far'}-${pin.totalQty}`;
            if (isNearby) {
              // Nearby: show name + basket count badge (with number)
              const hasStock = pin.totalQty > 0;
              const pinBg = hasStock ? '#e3ff5c' : '#333';
              const pinText = hasStock ? '#114b3c' : '#fff';
              return (
                <SmartMarker MarkerComponent={Marker} key={`pin-${pin.merchantId}`} bustKey={bustKey} coordinate={{ latitude: pin.latitude as number, longitude: pin.longitude as number }} anchor={{ x: 0.5, y: 1 }} onPress={() => router.push(`/restaurant/${pin.merchantId}` as never)}>
                  <View style={{ alignItems: 'center', width: 140, paddingVertical: 2 }} renderToHardwareTextureAndroid>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }} numberOfLines={1}>{pin.merchantName}</Text>
                    <View style={{ backgroundColor: pinBg, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4, elevation: 5 }}>
                      <ShoppingBag size={12} color={pinText} />
                      <Text style={{ color: pinText, fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{pin.totalQty}</Text>
                    </View>
                    <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: pinBg }} />
                  </View>
                </SmartMarker>
              );
            }
            // Far: show name + icon only (no number). Outer container has an
            // explicit width so Android doesn't clip the icon box.
            return (
              <SmartMarker MarkerComponent={Marker} key={`pin-${pin.merchantId}`} bustKey={bustKey} coordinate={{ latitude: pin.latitude as number, longitude: pin.longitude as number }} anchor={{ x: 0.5, y: 1 }} onPress={() => router.push(`/restaurant/${pin.merchantId}` as never)}>
                <View style={{ alignItems: 'center', width: 140, paddingVertical: 2 }} renderToHardwareTextureAndroid>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '600', textAlign: 'center', marginBottom: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }} numberOfLines={1}>{pin.merchantName}</Text>
                  <View style={{ backgroundColor: '#114b3c', borderRadius: 12, width: 28, height: 28, justifyContent: 'center', alignItems: 'center', elevation: 3 }}>
                    <ShoppingBag size={14} color="#fff" />
                  </View>
                  <View style={{ width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#114b3c' }} />
                </View>
              </SmartMarker>
            );
          })}
        </MapView>
      ) : (
        <MapFallback markers={markers} radius={radius} style={StyleSheet.absoluteFillObject} />
      )}

      {/* ── Search button (top-right) ── */}
      {!searchFullScreen && (
        <TouchableOpacity
          onPress={openSearch}
          style={{
            position: 'absolute', top: insets.top + 8, right: 16, zIndex: 30,
            width: 44, height: 44, backgroundColor: theme.colors.surface, borderRadius: 22,
            ...theme.shadows.shadowMd, justifyContent: 'center', alignItems: 'center',
          }}
        >
          <Search size={18} color={theme.colors.primary} />
        </TouchableOpacity>
      )}

      {/* ── Full-page search overlay ── */}
      {searchFullScreen && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.bg, zIndex: 100 }}>
          {/* Search header */}
          <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity onPress={closeSearch} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <ChevronLeft size={22} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <View style={{ flex: 1, height: 44, backgroundColor: theme.colors.bg, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 }}>
                <Search size={16} color={theme.colors.muted} />
                <TextInput
                  ref={searchInputRef}
                  style={{ flex: 1, marginLeft: 8, color: theme.colors.textPrimary, ...theme.typography.body, fontFamily: 'Poppins_400Regular' }}
                  placeholder={t('home.searchPlaceholder')}
                  placeholderTextColor={theme.colors.muted}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                  autoFocus
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={16} color={theme.colors.muted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {/* Search results */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {/* Category chips — always visible at top */}
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '600', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('home.categories.all', { defaultValue: 'Categories' })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
              {['bakery', 'restaurant', 'supermarket', 'cafe', 'fastfood', 'fresh'].map((cat) => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setSearchCategory(searchCategory === cat ? null : cat)}
                  style={{ backgroundColor: searchCategory === cat ? theme.colors.primary : theme.colors.primary + '10', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 }}
                >
                  <Text style={{ color: searchCategory === cat ? '#fff' : theme.colors.primary, fontSize: 13, fontWeight: '600' }}>
                        {t(`home.categories.${cat}`, { defaultValue: cat })}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

            {/* Results */}
            {searchSuggestions.length > 0 ? (
              <>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '600', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {t('home.searchResults', { defaultValue: 'Résultats' })} ({searchSuggestions.length})
                </Text>
                {searchSuggestions.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => {
                      if (mapRef.current) {
                        mapRef.current.animateToRegion({ latitude: s.latitude as number, longitude: s.longitude as number, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 600);
                      }
                      handleMarkerPress(s);
                      closeSearch();
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
                  >
                    {s.merchantLogo ? (
                      <Image source={{ uri: s.merchantLogo }} style={{ width: 40, height: 40, borderRadius: 10, marginRight: 12 }} />
                    ) : (
                      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: theme.colors.primary + '12', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <MapPin size={18} color={theme.colors.primary} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }} numberOfLines={1}>{s.merchantName}</Text>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }} numberOfLines={1}>
                        {s.address ? s.address : ''}{s.dist != null ? ` · ${s.dist.toFixed(1)} km` : ''}
                      </Text>
                    </View>
                    <Navigation size={14} color={theme.colors.primary} />
                  </TouchableOpacity>
                ))}
              </>
            ) : (searchQuery.trim() || searchCategory) ? (
              <View style={{ alignItems: 'center', paddingTop: 40 }}>
                <Search size={32} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, ...theme.typography.body, marginTop: 12 }}>
                  {t('home.noSearchResults', { defaultValue: 'Aucun résultat trouvé' })}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      )}

      {/* ── Floating radius card + inline category chips. Collapsed by
          default so the map has breathing room; the radius pill expands on
          tap into the full slider + address row. The category chips sit
          under it as a horizontal scroller — tap one to filter map pins
          and the bottom list by category. */}
      {!searchFullScreen && (
      <View style={[styles.floatingRadius, { top: insets.top + 64, marginHorizontal: 16 }]}>
        {/* Category chips row — sits ABOVE the radius card. Always visible on
            the main map view; tap a chip to filter map pins + bottom list. */}
        <ScrollView
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('mapCategoryRow', { x, y, w, h });
            });
          }}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingRight: 8 }}
          style={{ marginBottom: 8 }}
        >
          {['bakery', 'restaurant', 'supermarket', 'cafe', 'fastfood', 'fresh'].map((cat) => {
            const on = mapCategory === cat;
            return (
              <TouchableOpacity
                key={cat}
                onPress={() => setMapCategory(on ? null : cat)}
                activeOpacity={0.8}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 10,
                  backgroundColor: on ? theme.colors.primary : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: on ? theme.colors.primary : theme.colors.divider,
                  ...theme.shadows.shadowSm,
                }}
              >
                <Text style={{ color: on ? '#fff' : theme.colors.textSecondary, fontSize: 12, fontFamily: 'Poppins_600SemiBold', fontWeight: '600', letterSpacing: 0.1 }}>
                  {t(`home.categories.${cat}`, { defaultValue: cat })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {radiusExpanded ? (
          <View style={[styles.radiusCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowMd, padding: 12 }]}>
            <TouchableOpacity onPress={() => setRadiusExpanded(false)} style={styles.radiusRow} activeOpacity={0.7}>
              <MapPin size={14} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4, flex: 1 }]}>{t('home.radiusFilter')}</Text>
              <Text style={[{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' as const, marginRight: 6 }]}>{radius} {t('home.km')}</Text>
              <ChevronUp size={14} color={theme.colors.muted} />
            </TouchableOpacity>
            <View style={{ marginTop: 6 }}>
              <RadiusSlider value={radius} onChange={(km) => setRadius(km)} primaryColor={theme.colors.primary} trackColor={theme.colors.muted ?? '#ccc'} />
            </View>
            <TouchableOpacity
              onPress={() => router.push('/address-picker' as never)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}
            >
              <MapPin size={13} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                {selectedAddr ? selectedAddr.label : t('map.chooseLocation', { defaultValue: 'Choisir un emplacement' })}
              </Text>
              <ChevronRight size={14} color={theme.colors.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onLayout={(e) => {
              (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('mapRadiusPill', { x, y, w, h });
              });
            }}
            onPress={() => setRadiusExpanded(true)}
            activeOpacity={0.8}
            style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.surface, borderRadius: theme.radii.pill, paddingHorizontal: 12, paddingVertical: 8, ...theme.shadows.shadowMd }}
          >
            <MapPin size={14} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' }}>
              {radius} {t('home.km')}
            </Text>
            <ChevronRight size={13} color={theme.colors.muted} style={{ transform: [{ rotate: '90deg' }] }} />
          </TouchableOpacity>
        )}
      </View>
      )}

      {/* ── Re-center button ── */}
      <TouchableOpacity
        style={[styles.locationButton, { bottom: COLLAPSED_HEIGHT + 16, right: 16, backgroundColor: theme.colors.surface, borderRadius: 28, width: 48, height: 48, ...theme.shadows.shadowLg }]}
        onPress={handleRecenter}
        accessibilityLabel="Re-center map"
      >
        {locationStatus === 'loading' ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Navigation size={20} color={userLocation ? theme.colors.primary : theme.colors.muted} />
        )}
      </TouchableOpacity>


      {/* ── Location denied banner ── */}
      {locationStatus === 'denied' && (
        <View style={{ position: 'absolute', top: 140 + insets.top, left: 16, right: 16, backgroundColor: 'rgba(220,80,60,0.92)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
          <MapPin size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, marginLeft: 6, flex: 1, fontFamily: 'Poppins_500Medium' }}>{t('map.locationDeniedBanner', { defaultValue: 'Localisation refusée — résultats basés sur le centre de Tunis' })}</Text>
        </View>
      )}

      {/* ── Easter egg ── */}
      {showConstellationBanner && (
        <View style={{ position: 'absolute', bottom: COLLAPSED_HEIGHT + 20, left: 16, right: 16, zIndex: 30, backgroundColor: '#114b3c', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, elevation: 8 }}>
          <Sparkles size={18} color="#e3ff5c" style={{ marginRight: 10 }} />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flex: 1 }}>You found the Barakeat Constellation! +50 XP</Text>
        </View>
      )}

      {/* ── Bottom sheet ── */}
      <Animated.View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: sheetHeight, backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', ...theme.shadows.shadowLg, zIndex: 20 }}>
        <GestureDetector gesture={sheetPanGesture}>
          <View>
            <View style={{ alignItems: 'center', paddingVertical: 10 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.divider }} />
            </View>
            <View style={{ paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                  {nearbyBaskets.length > 0
                    ? `${nearbyBaskets.length} ${t('home.nearbySpots', { defaultValue: 'spots nearby' })}`
                    : t('map.noSpotsRadius', { radius, defaultValue: `No spots within ${radius} km` })}
                </Text>
                {nearbyBaskets.length === 0 && (
                  <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>
                    {locationStatus === 'denied'
                      ? t('home.locationDeniedHint', { defaultValue: 'Enable location to find spots near you' })
                      : t('home.expandRadiusHint', { defaultValue: 'Try increasing the radius slider above' })}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={toggleSheet}>
                <ChevronUp size={20} color={theme.colors.muted} style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }} />
              </TouchableOpacity>
            </View>
          </View>
        </GestureDetector>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} scrollEnabled={isExpanded} nestedScrollEnabled={true}>
          {selectedBasket ? (
            <BasketCard
              basket={selectedBasket}
              isFavorite={favoriteBasketIds.includes(selectedBasket.id)}
              onFavoritePress={() => toggleBasketFavorite(selectedBasket.id)}
            />
          ) : nearbyBaskets.length === 0 ? (
            <>
              {/* No spots within radius message */}
              <View style={{ alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16 }}>
                <MapPin size={28} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, fontWeight: '600', marginTop: 10, textAlign: 'center' }}>
                  {locationsQuery.isLoading
                    ? t('common.loading')
                    : t('map.noSpotsRadius', { radius, defaultValue: `No spots within ${radius} km` })}
                </Text>
                <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                  {locationStatus === 'denied'
                    ? t('home.locationDeniedHint', { defaultValue: 'Enable location to find spots near you' })
                    : t('home.expandRadiusHint', { defaultValue: 'Try increasing the radius slider above' })}
                </Text>
              </View>
              {/* Divider + all available locations section */}
              {filteredBaskets.filter(b => b.hasCoords && b.isActive && b.quantityLeft > 0).length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 12 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '600', marginHorizontal: 12 }}>
                      {t('map.availableLocations', { defaultValue: 'Available locations' })}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                  </View>
                  {filteredBaskets
                    .filter(b => b.hasCoords && b.isActive && b.quantityLeft > 0)
                    .map(b => ({ ...b, dist: getDistance(center.latitude, center.longitude, b.latitude as number, b.longitude as number) }))
                    .sort((a, b) => a.dist - b.dist)
                    .map((basket) => (
                      <BasketCard
                        key={basket.id}
                        basket={basket}
                        isFavorite={favoriteBasketIds.includes(basket.id)}
                        onFavoritePress={() => toggleBasketFavorite(basket.id)}
                      />
                    ))}
                </>
              )}
            </>
          ) : (
            nearbyBaskets.map((basket) => (
              <BasketCard
                key={basket.id}
                basket={basket}
                isFavorite={favoriteBasketIds.includes(basket.id)}
                onFavoritePress={() => toggleBasketFavorite(basket.id)}
              />
            ))
          )}
          {noCoordBaskets.length > 0 && !selectedBasket && (
            <>
              {nearbyBaskets.length > 0 && <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 12, marginBottom: 6 }}>{t('home.otherSpots', { defaultValue: 'Other spots' })}</Text>}
              {noCoordBaskets.map((basket) => (
                <BasketCard
                  key={basket.id}
                  basket={basket}
                  isFavorite={favoriteBasketIds.includes(basket.id)}
                  onFavoritePress={() => toggleBasketFavorite(basket.id)}
                />
              ))}
            </>
          )}
        </ScrollView>
      </Animated.View>

      {/* Walkthrough overlay — only renders when the active demo step targets
          an element on this screen (radius pill / category row). The (tabs)
          layout's overlay sits underneath /map-view in the Stack so it would
          otherwise be invisible here. */}
      <SubScreenWalkthroughOverlay keys={['mapRadiusPill', 'mapCategoryRow']} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: {
    position: 'absolute',
    left: 16,
    zIndex: 30,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingSearch: { position: 'absolute', left: 0, right: 0, zIndex: 10 },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 44 },
  searchInput: { marginLeft: 10, flex: 1 },
  floatingRadius: { position: 'absolute', left: 0, right: 0, zIndex: 10 },
  radiusCard: {},
  radiusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  locationButton: { position: 'absolute', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
});
