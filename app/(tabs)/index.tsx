import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Platform, Dimensions, Animated, PanResponder, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, X, RefreshCw, Settings, Bell, MapPin, ChevronDown, Hand, Store, ChevronRight } from 'lucide-react-native';

import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { SkeletonLoader } from '@/src/components/SkeletonLoader';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { useAuthStore } from '@/src/stores/authStore';
import { MapFallback } from '@/src/components/MapFallback';
import { fetchLocations } from '@/src/services/restaurants';
import { fetchReviewsByRestaurant } from '@/src/services/reviews';
import { normalizeLocationToBasket } from '@/src/utils/normalizeRestaurant';
import { useHeroStore } from '@/src/stores/heroStore';
import { useAddressStore } from '@/src/stores/addressStore';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { fetchHeroSlides, type HeroSlide } from '@/src/services/heroSlides';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { StatusBar } from 'expo-status-bar';

const SCREEN_WIDTH = Dimensions.get('window').width;

let MapView: any = null;
let MapMarker: any = null;
let MapCircle: any = null;

if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  MapMarker = maps.Marker;
  MapCircle = maps.Circle;
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [addressSuggestions, setAddressSuggestions] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();
  const { user } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showRadiusModal, setShowRadiusModal] = useState(false);
  const [radius, setRadius] = useState(5);
  const [carouselPage, setCarouselPage] = useState(0);
  const carouselRef = useRef<ScrollView>(null);
  // Address picker is now a full-page route
  const { addresses, selectedId, hydrate: hydrateAddresses } = useAddressStore();
  const selectedAddress = addresses.find((a) => a.id === selectedId) ?? null;
  const unreadCount = useNotificationStore((s) => s.unreadCount);


  useEffect(() => {
    void hydrateAddresses();
  }, [hydrateAddresses]);

  // Hero slide-up/slide-down animation
  const heroHeight = useRef(new Animated.Value(1)).current; // 1 = visible, 0 = hidden
  const [heroVisible, setHeroVisible] = useState(true);
  const setHeroVisibleGlobal = useHeroStore((s) => s.setHeroVisible);

  const HERO_HEIGHT = 160;

  // Track the raw animated value for drag
  const heroRawRef = useRef(1);
  const dragStartRef = useRef(1);
  const scrollOffsetRef = useRef(0);

  useEffect(() => {
    const listenerId = heroHeight.addListener(({ value }) => { heroRawRef.current = value; });
    return () => heroHeight.removeListener(listenerId);
  }, [heroHeight]);

  const snapHero = useCallback((visible: boolean) => {
    Animated.spring(heroHeight, {
      toValue: visible ? 1 : 0,
      useNativeDriver: false,
      friction: 12,
      tension: 50,
    }).start();
    setHeroVisible(visible);
    setHeroVisibleGlobal(visible);
  }, [heroHeight, setHeroVisibleGlobal]);

  // Pull-to-refresh animation state
  const refreshTriggeredRef = useRef(false);
  const handleRefreshRef = useRef<() => void>(() => {});
  const pullDistance = useRef(new Animated.Value(0)).current;
  const refreshSpin = useRef(new Animated.Value(0)).current;
  const [pulling, setPulling] = useState(false);

  // PanResponder on the entire content section (search + cards area)
  // Uses capture phase to intercept before ScrollView claims the gesture
  // Track whether we've claimed the gesture to prevent stuck states
  const gestureClaimedRef = useRef(false);

  const contentPanResponder = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        // Fallback: also claim on the non-capture phase for Android compatibility
        if (gestureClaimedRef.current) return true;
        if (Math.abs(g.dy) <= Math.abs(g.dx) || Math.abs(g.dy) < 8) return false;
        if (heroRawRef.current > 0.05 && g.dy < -8) return true;
        if (heroRawRef.current < 0.95 && g.dy > 8 && scrollOffsetRef.current <= 2) return true;
        if (heroRawRef.current > 0.9 && g.dy > 8 && scrollOffsetRef.current <= 2) return true;
        return false;
      },
      onMoveShouldSetPanResponderCapture: (_, g) => {
        // Only intercept clearly vertical gestures (lower thresholds for reliability)
        if (Math.abs(g.dy) <= Math.abs(g.dx) || Math.abs(g.dy) < 8) return false;
        // Swipe up while hero is at least partially visible → capture to hide hero
        if (heroRawRef.current > 0.05 && g.dy < -8) { gestureClaimedRef.current = true; return true; }
        // Swipe down while hero is not fully visible AND scroll is at top → capture to show hero
        if (heroRawRef.current < 0.95 && g.dy > 8 && scrollOffsetRef.current <= 2) { gestureClaimedRef.current = true; return true; }
        // Swipe down while hero is FULLY visible AND scroll at top → capture for pull-to-refresh
        if (heroRawRef.current > 0.9 && g.dy > 8 && scrollOffsetRef.current <= 2) { gestureClaimedRef.current = true; return true; }
        return false;
      },
      onPanResponderGrant: () => {
        dragStartRef.current = heroRawRef.current;
        refreshTriggeredRef.current = false;
        gestureClaimedRef.current = true;
      },
      onPanResponderMove: (_, g) => {
        // If hero is fully visible and pulling down → pull-to-refresh gesture
        if (dragStartRef.current > 0.9 && g.dy > 0) {
          setPulling(true);
          // Animate pull distance — follows finger with diminishing return
          pullDistance.setValue(Math.min(g.dy * 0.6, 150));
          return;
        }
        const newVal = dragStartRef.current + (g.dy / HERO_HEIGHT);
        heroHeight.setValue(Math.max(0, Math.min(1, newVal)));
      },
      onPanResponderRelease: (_, g) => {
        gestureClaimedRef.current = false;
        // Pull-to-refresh: if hero was fully visible and user pulled down enough
        if (dragStartRef.current > 0.9 && g.dy > 40) {
          // Keep icon at fixed position, spin it, wait 1s, then refresh
          setPulling(false);
          setRefreshing(true);
          // Loop spin while refreshing
          const spinLoop = Animated.loop(
            Animated.timing(refreshSpin, {
              toValue: 1,
              duration: 700,
              useNativeDriver: true,
            })
          );
          spinLoop.start();
          // 1 second delay, then actually refresh
          setTimeout(async () => {
            await Promise.allSettled([
              locationsQuery.refetch(),
              reviewsQuery.refetch(),
            ]);
            spinLoop.stop();
            refreshSpin.setValue(0);
            pullDistance.setValue(0);
            setRefreshing(false);
          }, 1000);
          return;
        }
        // Cancelled pull — snap back
        if (dragStartRef.current > 0.9 && g.dy > 0) {
          Animated.timing(pullDistance, { toValue: 0, duration: 200, useNativeDriver: false }).start(() => setPulling(false));
          return;
        }
        // Always snap to a definitive end state (0 or 1) — never leave in between
        const currentVal = heroRawRef.current;
        if (g.vy < -0.3 || currentVal < 0.4) {
          snapHero(false);
        } else if (g.vy > 0.3 || currentVal > 0.6) {
          snapHero(true);
        } else {
          snapHero(currentVal >= 0.5);
        }
      },
      onPanResponderTerminate: () => {
        // If gesture is terminated (e.g. by ScrollView on Android), snap to nearest end state
        gestureClaimedRef.current = false;
        const currentVal = heroRawRef.current;
        if (currentVal > 0 && currentVal < 1) {
          snapHero(currentVal >= 0.5);
        }
      },
    })
  , [snapHero, heroHeight]);

  const animatedHeroHeight = heroHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, HERO_HEIGHT],
  });

  const animatedHeroOpacity = heroHeight.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });

  // Container bg slides from green → light as hero collapses
  const containerBg = heroHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.bg, '#114b3c'],
  });

  // Fetch locations (the only source of truth for food spots)
  const locationsQuery = useQuery({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 60_000,
    retry: 2,
  });

  // Fetch reviews per location
  const locationIds = locationsQuery.data?.map((l) => l.id) ?? [];
  const reviewsQuery = useQuery({
    queryKey: ['review-map', locationIds],
    queryFn: async () => {
      if (!locationIds.length) return {} as Record<string, { avg: number; count: number }>;
      const results = await Promise.allSettled(
        locationIds.map((id) => fetchReviewsByRestaurant(id))
      );
      const map: Record<string, { avg: number; count: number }> = {};
      locationIds.forEach((id, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value.length > 0) {
          const catAvgs = r.value.map((rev) => {
            const cats = [
              Number(rev.rating_service) || 0,
              Number(rev.rating_quality) || 0,
              Number(rev.rating_quantity) || 0,
              Number(rev.rating_variety) || 0,
            ].filter((v) => v > 0);
            if (cats.length > 0) return cats.reduce((a, b) => a + b, 0) / cats.length;
            return Number(rev.rating) || 0;
          }).filter((v) => v > 0);
          if (catAvgs.length > 0) {
            map[String(id)] = {
              avg: catAvgs.reduce((a, b) => a + b, 0) / catAvgs.length,
              count: r.value.length,
            };
          }
        }
      });
      return map;
    },
    enabled: locationIds.length > 0,
    staleTime: 120_000,
    retry: 0,
  });

  // Build card data: one card per location
  const baskets = useMemo(() => {
    const locations = locationsQuery.data ?? [];
    const rmap = reviewsQuery.data ?? {};
    return locations.map((loc) => {
      const basket = normalizeLocationToBasket(loc);
      const summary = rmap[String(loc.id)];
      if (summary) {
        basket.merchantRating = summary.avg;
        basket.reviewCount = summary.count;
      }
      return basket;
    });
  }, [locationsQuery.data, reviewsQuery.data]);

  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    baskets.forEach((b) => {
      if (b.category && b.category !== 'all') cats.add(b.category);
    });
    return ['all', ...Array.from(cats)];
  }, [baskets]);

  // Haversine distance in km
  const distKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const filteredBaskets = useMemo(() => {
    let result = baskets;
    if (activeCategory !== 'all') {
      result = result.filter((b) => b.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.merchantName.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          (b.address && b.address.toLowerCase().includes(q))
      );
    }

    // User location for proximity sorting
    const userLat = selectedAddress?.lat;
    const userLng = selectedAddress?.lng;
    const hasUserLoc = userLat != null && userLng != null && isFinite(userLat) && isFinite(userLng);

    // Sort: open & available first, then closed-for-today, then sold-out/unavailable
    const isPickupClosed = (b: typeof result[0]) => isPickupExpiredInTz(b.pickupWindow?.end);
    result = [...result].sort((a, b) => {
      const aAvail = a.isActive && a.quantityLeft > 0;
      const bAvail = b.isActive && b.quantityLeft > 0;
      const aClosed = aAvail && isPickupClosed(a);
      const bClosed = bAvail && isPickupClosed(b);
      // Tier: 0 = open & available, 1 = closed for today, 2 = unavailable
      const aTier = !aAvail ? 2 : aClosed ? 1 : 0;
      const bTier = !bAvail ? 2 : bClosed ? 1 : 0;
      if (aTier !== bTier) return aTier - bTier;

      // Within the same tier, sort by distance if user location is known
      if (hasUserLoc) {
        const aDist = a.hasCoords ? distKm(userLat!, userLng!, a.latitude!, a.longitude!) : Infinity;
        const bDist = b.hasCoords ? distKm(userLat!, userLng!, b.latitude!, b.longitude!) : Infinity;
        return aDist - bDist;
      }
      return 0;
    });

    // Compute distance in km for each basket (for card display)
    if (hasUserLoc) {
      result = result.map(b => ({
        ...b,
        distance: b.hasCoords ? Math.round(distKm(userLat!, userLng!, b.latitude!, b.longitude!) * 10) / 10 : 0,
      }));
    }

    return result;
  }, [baskets, activeCategory, searchQuery, selectedAddress]);

  // Location suggestions: when searching, show locations that match by name/address
  // even if they don't have matching baskets — lets user navigate to the location page
  const locationSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const locations = locationsQuery.data ?? [];
    // IDs of locations already shown as basket cards
    const shownIds = new Set(filteredBaskets.map(b => b.merchantId));
    return locations
      .filter(loc => {
        if (shownIds.has(String(loc.id))) return false;
        const name = (loc.display_name ?? loc.name ?? '').toLowerCase();
        const addr = (loc.address ?? '').toLowerCase();
        return name.includes(q) || addr.includes(q);
      })
      .slice(0, 5);
  }, [searchQuery, locationsQuery.data, filteredBaskets]);

  // Nominatim address autocomplete — debounced
  const fetchAddressSuggestions = useCallback((query: string) => {
    if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
    if (query.length < 3) { setAddressSuggestions([]); return; }
    addressSearchTimer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          format: 'json', q: query, limit: '5',
          viewbox: '7.5,30.2,11.6,37.5', bounded: '0', 'accept-language': 'fr',
        });
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
        const data = await resp.json();
        setAddressSuggestions(data ?? []);
      } catch { setAddressSuggestions([]); }
    }, 500);
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    fetchAddressSuggestions(text);
  }, [fetchAddressSuggestions]);

  const handleAddressSuggestionPress = useCallback(async (suggestion: { display_name: string; lat: string; lon: string }) => {
    const shortLabel = suggestion.display_name.split(',')[0] ?? suggestion.display_name;
    await useAddressStore.getState().addAddress({ label: shortLabel, lat: parseFloat(suggestion.lat), lng: parseFloat(suggestion.lon) });
    setSearchQuery('');
    setAddressSuggestions([]);
  }, []);

  const handleCategoryPress = useCallback((cat: string) => {
    setActiveCategory(cat);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([
      locationsQuery.refetch(),
      reviewsQuery.refetch(),
    ]);
    setRefreshing(false);
  }, [locationsQuery, reviewsQuery]);

  // Keep ref in sync so PanResponder can call it
  useEffect(() => {
    handleRefreshRef.current = handleRefresh;
  }, [handleRefresh]);

  const firstName = user?.firstName ?? user?.name?.split(' ')[0] ?? '';
  const userGender = (user as any)?.gender ?? null; // 'male', 'female', or null

  // Fetch dynamic hero slides from API
  const heroSlidesQuery = useQuery({
    queryKey: ['hero-slides'],
    queryFn: fetchHeroSlides,
    staleTime: 15_000, // 15s — hero slides are admin-edited, keep fresh
  });
  const dynamicSlides = heroSlidesQuery.data ?? [];

  // Total pages = 1 (welcome) + dynamic slides
  const totalCarouselPages = 1 + dynamicSlides.length;
  const carouselWidth = SCREEN_WIDTH - 40;

  // Auto-scroll carousel every 10s
  useEffect(() => {
    if (totalCarouselPages <= 1) return;
    const timer = setInterval(() => {
      setCarouselPage((prev) => {
        const next = (prev + 1) % totalCarouselPages;
        carouselRef.current?.scrollTo({ x: next * carouselWidth, animated: true });
        return next;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [carouselWidth, totalCarouselPages]);

  // Only place markers for restaurants that have real backend coordinates
  const mapMarkers = baskets
    .filter((b) => b.hasCoords)
    .map((b) => ({ id: b.id, name: b.merchantName, lat: b.latitude as number, lng: b.longitude as number }));

  // Debug: log map marker status
  console.log(`[Map] Total baskets: ${baskets.length}, with coords: ${mapMarkers.length}`);
  baskets.forEach(b => {
    console.log(`[Map] "${b.merchantName}" hasCoords=${b.hasCoords} lat=${b.latitude} lng=${b.longitude}`);
  });

  return (
    <Animated.View style={[styles.container, { backgroundColor: containerBg }]}>
      {/* Status bar: white icons on dark green hero, black icons on light content */}
      <StatusBar style={heroVisible ? 'light' : 'dark'} />

      {/* Fixed top bar — always visible, colors shift as hero collapses */}
      <View style={{
        paddingTop: insets.top,
        paddingHorizontal: 16,
        paddingBottom: 4,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <TouchableOpacity
          onPress={() => router.push('/address-picker' as never)}
          accessibilityRole="button"
          accessibilityLabel={selectedAddress?.label ?? t('home.chooseLocation')}
          accessibilityHint={t('home.chooseLocation', { defaultValue: 'Choose location' })}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            height: 34,
            backgroundColor: heroVisible ? 'rgba(255,255,255,0.15)' : theme.colors.surface,
            borderRadius: 17,
            paddingHorizontal: 12,
          }}
        >
          <MapPin size={13} color={heroVisible ? '#e3ff5c' : theme.colors.primary} />
          <Text
            style={{ color: heroVisible ? '#fff' : theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', maxWidth: 130 }}
            numberOfLines={1}
          >
            {selectedAddress?.label ?? t('home.chooseLocation')}
          </Text>
          <ChevronDown size={13} color={heroVisible ? 'rgba(255,255,255,0.7)' : theme.colors.textSecondary} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 34 }}>
          {/* Spacer — the map button is rendered by the tab layout overlay so it can animate between tabs */}
          <View pointerEvents="none" style={{ width: 34, height: 34 }} />
          <TouchableOpacity onPress={() => router.push('/settings' as never)} accessibilityLabel={t('settings.title', { defaultValue: 'Settings' })} accessibilityRole="button">
            <Settings size={20} color={heroVisible ? '#e3ff5c' : theme.colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/notifications' as never)} accessibilityLabel={t('notifications.title', { defaultValue: 'Notifications' })} accessibilityRole="button">
            <Bell size={20} color={heroVisible ? '#e3ff5c' : theme.colors.textPrimary} />
            {unreadCount > 0 && (
              <View style={{
                position: 'absolute',
                top: -4,
                right: -6,
                backgroundColor: theme.colors.error,
                borderRadius: 8,
                minWidth: 16,
                height: 16,
                justifyContent: 'center',
                alignItems: 'center',
                paddingHorizontal: 4,
              }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Hero body — text, image, dots — slides away on scroll up */}
      <Animated.View style={{ height: animatedHeroHeight, opacity: animatedHeroOpacity, overflow: 'hidden', paddingHorizontal: 20 }}>
        <ScrollView
          ref={carouselRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const page = Math.round(e.nativeEvent.contentOffset.x / carouselWidth);
            setCarouselPage(page);
          }}
          style={{ width: carouselWidth }}
        >
          {/* Page 1: Welcome — always present */}
          <View style={{ width: carouselWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{
                color: 'rgba(255,255,255,0.7)',
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
              }}>
                {t('home.welcomeBack')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 6 }}>
                <Text style={{
                  color: '#fff',
                  fontSize: 24,
                  fontWeight: '700',
                  fontFamily: 'Poppins_700Bold',
                }}>
                  {firstName || t('home.search')}
                </Text>
                <Hand size={24} color="rgba(255,255,255,0.9)" />
              </View>
            </View>
            {/* Hero image — gender-based */}
            <Image
              source={userGender === 'female'
                ? require('@/assets/images/woman_holding_basket-removebg-preview.png')
                : require('@/assets/images/man_holding_basket-removebg-preview.png')}
              style={{ width: HERO_HEIGHT * 0.68, height: HERO_HEIGHT * 0.92, marginLeft: 4 }}
              resizeMode="contain"
              accessibilityLabel={t('home.heroImage', { defaultValue: 'Person holding a food basket' })}
            />
          </View>
          {/* Dynamic slides from API */}
          {dynamicSlides.map((slide: HeroSlide) => {
            const imgW = slide.image_size ?? HERO_HEIGHT * 0.5;
            const imgH = Math.round(imgW * 1.36);
            const alignMap: Record<string, 'flex-start' | 'center' | 'flex-end'> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };
            const textJustify = alignMap[slide.text_align_v ?? 'center'] ?? 'center';
            const titleSize = slide.title_font_size ?? 18;
            const subtitleOp = slide.subtitle_opacity ?? 0.7;
            const imgOp = slide.image_opacity ?? 1;
            const offsetY = slide.text_offset_y ?? 0;
            return (
            <View key={slide.id} style={{ width: carouselWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, justifyContent: textJustify, transform: [{ translateY: offsetY }] }}>
                {slide.subtitle ? (
                  <Text style={{
                    color: `rgba(255,255,255,${subtitleOp})`,
                    fontSize: 12,
                    fontFamily: 'Poppins_400Regular',
                  }}>
                    {slide.subtitle}
                  </Text>
                ) : null}
                <Text style={{
                  color: slide.text_color ?? '#fff',
                  fontSize: titleSize,
                  fontWeight: '700',
                  fontFamily: 'Poppins_700Bold',
                  marginTop: 4,
                }}>
                  {slide.title}
                </Text>
              </View>
              {slide.image_url ? (
                <Image
                  source={{ uri: slide.image_url }}
                  style={{ width: imgW, height: imgH, marginLeft: 8, opacity: imgOp }}
                  resizeMode="contain"
                />
              ) : (
                <Image
                  source={userGender === 'female'
                    ? require('@/assets/images/woman_holding_basket-removebg-preview.png')
                    : require('@/assets/images/man_holding_basket-removebg-preview.png')}
                  style={{ width: imgW, height: imgH, marginLeft: 8, opacity: imgOp }}
                  resizeMode="contain"
                />
              )}
            </View>
            );
          })}
        </ScrollView>

        {/* Dot indicators */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6, marginBottom: 24 }}>
          {Array.from({ length: totalCarouselPages }, (_, i) => (
            <View
              key={i}
              style={{
                width: carouselPage === i ? 20 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: carouselPage === i ? '#e3ff5c' : 'rgba(255,255,255,0.3)',
                marginHorizontal: 3,
              }}
            />
          ))}
        </View>
      </Animated.View>

      {/* Content section with curved top — panHandlers on entire section for hero show/hide */}
      <View
        {...contentPanResponder.panHandlers}
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          paddingTop: 0,
          marginTop: -10,
        }}
      >
        {/* Drag handle (visual indicator) */}
        <View style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 6 }}>
          <View style={{
            width: 44,
            height: 5,
            borderRadius: 3,
            backgroundColor: theme.colors.muted + '40',
          }} />
        </View>

        <View style={{ paddingHorizontal: theme.spacing.xl }}>
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r12,
                ...theme.shadows.shadowSm,
                height: 44,
                alignItems: 'center',
              },
            ]}
          >
            <Search size={18} color={theme.colors.muted} />
            <TextInput
              style={[
                styles.searchInput,
                { color: theme.colors.textPrimary, fontFamily: 'Poppins_400Regular', fontSize: 14, flex: 1, textAlign: 'left' },
              ]}
              placeholder={t('home.searchPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              value={searchQuery}
              onChangeText={handleSearchChange}
              returnKeyType="search"
              textAlignVertical="center"
              accessibilityLabel={t('home.searchPlaceholder')}
              accessibilityRole="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }} accessibilityLabel={t('common.clear', { defaultValue: 'Clear search' })} accessibilityRole="button">
                <X size={16} color={theme.colors.muted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Pull-to-refresh icon — appears below search bar, follows finger down, spins on release */}
        {(pulling || refreshing) && (
          <Animated.View style={{
            alignItems: 'center',
            height: pulling
              ? pullDistance.interpolate({ inputRange: [0, 150], outputRange: [0, 100], extrapolate: 'clamp' })
              : 40,
            justifyContent: 'flex-start',
            paddingTop: pulling
              ? pullDistance.interpolate({ inputRange: [0, 150], outputRange: [0, 60], extrapolate: 'clamp' })
              : 10,
          }}>
            <Animated.View style={{
              opacity: pulling
                ? pullDistance.interpolate({ inputRange: [0, 20], outputRange: [0, 1], extrapolate: 'clamp' })
                : 1,
              transform: [{
                rotate: refreshing
                  ? refreshSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
                  : pullDistance.interpolate({ inputRange: [0, 150], outputRange: ['0deg', '270deg'], extrapolate: 'clamp' }),
              }],
            }}>
              <RefreshCw size={20} color={theme.colors.primary} />
            </Animated.View>
          </Animated.View>
        )}

        {/* Scrollable content — Fix 2: paddingBottom accounts for floating tab bar + safe area */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
        >
          {/* Fix 2: categories section — explicit height + paddingVertical to prevent Android bottom cut */}
          <View style={[styles.categoriesSection, { marginBottom: theme.spacing.lg }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: theme.spacing.xl, paddingVertical: 4 }}
            >
              {availableCategories.map((cat) => {
                const isActive = activeCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => handleCategoryPress(cat)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t(`home.categories.${cat}`, { defaultValue: cat })}
                    accessibilityState={{ selected: isActive }}
                    style={[
                      styles.categoryPill,
                      {
                        backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                        borderRadius: theme.radii.pill,
                        marginRight: theme.spacing.sm,
                        paddingHorizontal: theme.spacing.lg,
                        paddingVertical: 8,
                        ...(isActive ? {} : theme.shadows.shadowSm),
                      },
                    ]}
                  >
                    <Text
                      style={[
                        {
                          color: isActive ? '#fff' : theme.colors.textPrimary,
                          ...theme.typography.bodySm,
                          fontWeight: isActive ? ('600' as const) : ('400' as const),
                        },
                      ]}
                    >
                      {t(`home.categories.${cat}`, { defaultValue: cat })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          {locationsQuery.isLoading ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ marginBottom: 16, backgroundColor: theme.colors.surface, borderRadius: 16, overflow: 'hidden', padding: 12 }}>
                  <SkeletonLoader height={120} borderRadius={12} style={{ marginBottom: 10 }} />
                  <SkeletonLoader height={14} width="60%" borderRadius={6} style={{ marginBottom: 6 }} />
                  <SkeletonLoader height={12} width="40%" borderRadius={6} />
                </View>
              ))}
            </>
          ) : locationsQuery.isError ? (
            <View style={styles.centerState}>
              <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center' as const, marginBottom: 16 }]}>
                {t('common.errorOccurred')}
              </Text>
              <TouchableOpacity
                onPress={() => { locationsQuery.refetch(); }}
                style={[styles.retryButton, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12 }]}
                accessibilityLabel={t('common.retry')}
                accessibilityRole="button"
              >
                <RefreshCw size={16} color="#fff" />
                <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
                  {t('common.retry')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : filteredBaskets.length === 0 && locationSuggestions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const, marginTop: 40, paddingHorizontal: 20 }]}>
                {t('home.emptyState.noBaskets')}
              </Text>
            </View>
          ) : (
            <>
              {filteredBaskets.map((basket) => (
                <BasketCard
                  key={basket.id}
                  basket={basket}
                  isFavorite={isBasketFavorite(basket.id)}
                  onFavoritePress={() => toggleBasketFavorite(basket.id)}
                />
              ))}

              {/* Address suggestions from Nominatim */}
              {searchQuery.trim() && addressSuggestions.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: filteredBaskets.length > 0 || locationSuggestions.length > 0 ? 20 : 0, marginBottom: 14 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginHorizontal: 12 }}>
                      {t('home.searchByAddress', { defaultValue: 'Rechercher par adresse' })}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                  </View>
                  {addressSuggestions.map((s, idx) => (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => handleAddressSuggestionPress(s)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        backgroundColor: theme.colors.surface, borderRadius: 14,
                        padding: 14, marginBottom: 10,
                      }}
                    >
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#3b82f612', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <MapPin size={18} color="#3b82f6" />
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }} numberOfLines={2}>
                        {s.display_name}
                      </Text>
                      <ChevronRight size={14} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {/* Location suggestions when searching */}
              {searchQuery.trim() && locationSuggestions.length > 0 && (
                <>
                  {/* Divider */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: filteredBaskets.length > 0 ? 20 : 0, marginBottom: 14 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginHorizontal: 12 }}>
                      {filteredBaskets.length === 0
                        ? t('home.noMatchingBaskets', { defaultValue: 'Aucun panier avec ce nom' })
                        : t('home.otherLocations', { defaultValue: 'Autres commerces' })}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                  </View>

                  {/* Location suggestion cards */}
                  {locationSuggestions.map((loc) => (
                    <TouchableOpacity
                      key={loc.id}
                      onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: String(loc.id) } } as never)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        backgroundColor: theme.colors.surface, borderRadius: 14,
                        padding: 14, marginBottom: 10,
                      }}
                    >
                      {loc.image_url ? (
                        <Image source={{ uri: loc.image_url }} style={{ width: 44, height: 44, borderRadius: 12, marginRight: 12 }} resizeMode="cover" />
                      ) : (
                        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.primary + '12', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                          <Store size={20} color={theme.colors.primary} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }} numberOfLines={1}>
                          {loc.display_name ?? loc.name}
                        </Text>
                        {loc.address ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                            <MapPin size={11} color={theme.colors.textSecondary} style={{ marginRight: 4 }} />
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }} numberOfLines={1}>
                              {loc.address}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <ChevronRight size={16} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>

      <Modal visible={showRadiusModal} transparent animationType="slide" onRequestClose={() => setShowRadiusModal(false)}>
        <View style={styles.radiusModalOverlay}>
          <View style={[styles.radiusModalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, ...theme.shadows.shadowLg }]}>
            <View style={[styles.modalHandle, { backgroundColor: theme.colors.divider }]} />

            <View style={[styles.radiusModalHeader, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1 }]}>
                {t('home.selectRadius')}
              </Text>
              <TouchableOpacity
                onPress={() => setShowRadiusModal(false)}
                style={[styles.closeBtn, { backgroundColor: theme.colors.bg }]}
                accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
                accessibilityRole="button"
              >
                <X size={18} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.mapContainer, { marginHorizontal: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
              {Platform.OS !== 'web' && MapView ? (
                <MapView
                  style={styles.mapView}
                  initialRegion={{
                    latitude: selectedAddress?.lat ?? 36.8065,
                    longitude: selectedAddress?.lng ?? 10.1815,
                    latitudeDelta: 0.15,
                    longitudeDelta: 0.15,
                  }}
                >
                  {MapCircle && (
                    <MapCircle
                      center={{ latitude: 36.8065, longitude: 10.1815 }}
                      radius={radius * 1000}
                      fillColor="rgba(255, 0, 0, 0.12)"
                      strokeColor="red"
                      strokeWidth={3}
                    />
                  )}
                  {baskets.map((basket) => (
                    MapMarker && basket.hasCoords ? (
                      <MapMarker
                        key={basket.id}
                        coordinate={{ latitude: basket.latitude as number, longitude: basket.longitude as number }}
                        title={basket.merchantName}
                      />
                    ) : null
                  ))}
                </MapView>
              ) : (
                <MapFallback markers={mapMarkers} radius={radius} style={styles.mapView} />
              )}
            </View>

            <View style={[styles.sliderSection, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl }]}>
              <View style={styles.sliderLabelRow}>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                  {t('home.radiusFilter') as string}
                </Text>
                <View style={[styles.distanceBadge, { backgroundColor: theme.colors.primary + '12' }]}>
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.h3 }]}>
                    {radius} km
                  </Text>
                </View>
              </View>

              <View style={styles.sliderContainer}>
                <View style={[styles.sliderTrackBg, { backgroundColor: theme.colors.divider }]}>
                  <View style={[styles.sliderTrackFill, { backgroundColor: theme.colors.primary, width: `${((radius - 1) / 19) * 100}%` }]} />
                </View>
                <View style={[styles.sliderThumbContainer, { left: `${((radius - 1) / 19) * 100}%` }]}>
                  <View style={[styles.sliderThumb, { backgroundColor: theme.colors.primary, ...theme.shadows.shadowMd }]}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{radius}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={StyleSheet.absoluteFillObject}
                  activeOpacity={1}
                  onPress={(e) => {
                    const trackWidth = Dimensions.get('window').width - 80;
                    const pct = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackWidth));
                    setRadius(Math.max(1, Math.min(20, Math.round(1 + pct * 19))));
                  }}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.useLocationBtn, { borderColor: theme.colors.primary }]}
              activeOpacity={0.7}
            >
              <MapPin size={16} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
                  {t('home.useMyLocation') as string}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowRadiusModal(false)}
              activeOpacity={0.8}
              style={[styles.confirmBtn, {
                backgroundColor: theme.colors.primary,
                marginHorizontal: theme.spacing.xl,
                marginBottom: theme.spacing.xxl,
              }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('home.chooseLocation')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 44,
  },
  searchInput: {
    marginLeft: 10,
    paddingVertical: 0,
    height: 44,
    includeFontPadding: false,
  } as any,
  categoriesSection: {},
  categoryPill: {},
  scrollView: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  radiusModalContent: {},
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
  },
  radiusModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapContainer: {
    height: 260,
    borderRadius: 16,
    overflow: 'hidden',
  },
  mapView: {
    flex: 1,
  },
  sliderSection: {},
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  distanceBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  sliderContainer: {
    position: 'relative',
    paddingVertical: 8,
  },
  sliderTrackBg: {
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: -2,
  },
  sliderTrackFill: {
    height: 4,
    borderRadius: 2,
  },
  sliderThumbContainer: {
    position: 'absolute',
    top: -8,
    marginLeft: -12,
  },
  sliderThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  useLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
  },
  confirmBtn: {
    borderRadius: 14,
    paddingVertical: 16,
  },
});
