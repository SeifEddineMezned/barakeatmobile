import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Platform, Dimensions, Animated, PanResponder, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, X, RefreshCw, Settings, Bell, MapPin, ChevronDown, Hand } from 'lucide-react-native';

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
import { StatusBar } from 'expo-status-bar';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CAROUSEL_PAGES = 2;

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
  const [activeCategory, setActiveCategory] = useState('Tous');
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
  const contentPanResponder = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_, g) => {
        // Only intercept clearly vertical gestures
        if (Math.abs(g.dy) <= Math.abs(g.dx) || Math.abs(g.dy) < 12) return false;
        // Swipe up while hero is visible → capture to hide hero
        if (heroRawRef.current > 0.1 && g.dy < -12) return true;
        // Swipe down while hero is hidden AND scroll is at top → capture to show hero
        if (heroRawRef.current < 0.1 && g.dy > 12 && scrollOffsetRef.current <= 2) return true;
        // Swipe down while hero is FULLY visible AND scroll at top → capture for pull-to-refresh
        if (heroRawRef.current > 0.9 && g.dy > 12 && scrollOffsetRef.current <= 2) return true;
        return false;
      },
      onPanResponderGrant: () => {
        dragStartRef.current = heroRawRef.current;
        refreshTriggeredRef.current = false;
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
        const currentVal = heroRawRef.current;
        if (g.vy < -0.5 || currentVal < 0.4) {
          snapHero(false);
        } else if (g.vy > 0.5 || currentVal > 0.6) {
          snapHero(true);
        } else {
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
      if (b.category && b.category !== 'Tous') cats.add(b.category);
    });
    return ['Tous', ...Array.from(cats)];
  }, [baskets]);

  // Simple Euclidean distance approximation (sufficient for sorting nearby locations)
  const dist = (lat1: number, lon1: number, lat2: number, lon2: number) =>
    Math.sqrt((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2);

  const filteredBaskets = useMemo(() => {
    let result = baskets;
    if (activeCategory !== 'Tous') {
      result = result.filter((b) => b.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.merchantName.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q)
      );
    }

    // User location for proximity sorting
    const userLat = selectedAddress?.lat;
    const userLng = selectedAddress?.lng;
    const hasUserLoc = userLat != null && userLng != null && isFinite(userLat) && isFinite(userLng);

    // Sort: open & available first, then closed-for-today, then sold-out/unavailable
    const now = new Date();
    const isPickupClosed = (b: typeof result[0]) => {
      const endStr = b.pickupWindow?.end;
      if (!endStr) return false;
      const [eh, em] = endStr.split(':').map(Number);
      if (isNaN(eh) || isNaN(em)) return false;
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em);
      return now > endDate;
    };
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
        const aDist = a.hasCoords ? dist(userLat!, userLng!, a.latitude!, a.longitude!) : Infinity;
        const bDist = b.hasCoords ? dist(userLat!, userLng!, b.latitude!, b.longitude!) : Infinity;
        return aDist - bDist;
      }
      return 0;
    });
    return result;
  }, [baskets, activeCategory, searchQuery, selectedAddress]);

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

  const newestPartner = useMemo(() => {
    if (!baskets.length) return '';
    return baskets[baskets.length - 1]?.merchantName ?? '';
  }, [baskets]);

  const carouselWidth = SCREEN_WIDTH - 40;

  // Auto-scroll carousel every 10s
  useEffect(() => {
    const timer = setInterval(() => {
      setCarouselPage((prev) => {
        const next = (prev + 1) % CAROUSEL_PAGES;
        carouselRef.current?.scrollTo({ x: next * carouselWidth, animated: true });
        return next;
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [carouselWidth]);

  // Only place markers for restaurants that have real backend coordinates
  const mapMarkers = baskets
    .filter((b) => b.hasCoords)
    .map((b) => ({ id: b.id, name: b.merchantName, lat: b.latitude as number, lng: b.longitude as number }));

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
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            backgroundColor: heroVisible ? 'rgba(255,255,255,0.15)' : theme.colors.surface,
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          <MapPin size={13} color={heroVisible ? '#e3ff5c' : theme.colors.primary} />
          <Text
            style={{ color: heroVisible ? '#fff' : theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', maxWidth: 130 }}
            numberOfLines={1}
          >
            {selectedAddress?.label ?? 'Choose location'}
          </Text>
          <ChevronDown size={13} color={heroVisible ? 'rgba(255,255,255,0.7)' : theme.colors.textSecondary} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {/* Map pin button — opens the SAME existing navbar map (nearby tab) */}
          <TouchableOpacity
            onPress={() => router.push('/map-view' as never)}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: heroVisible ? 'rgba(255,255,255,0.18)' : theme.colors.surface,
              justifyContent: 'center',
              alignItems: 'center',
            }}
            accessibilityLabel="Open map"
          >
            <MapPin size={17} color={heroVisible ? '#e3ff5c' : theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/settings' as never)}>
            <Settings size={20} color={heroVisible ? '#e3ff5c' : theme.colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/notifications' as never)}>
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
          {/* Page 1: Welcome */}
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
            {/* Hero image */}
            <Image
              source={require('@/assets/images/man_holding_basket-removebg-preview.png')}
              style={{ width: HERO_HEIGHT * 0.68, height: HERO_HEIGHT * 0.92, marginLeft: 4 }}
              resizeMode="contain"
            />
          </View>
          {/* Page 2: New Partner */}
          <View style={{ width: carouselWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{
                color: 'rgba(255,255,255,0.7)',
                fontSize: 12,
                fontFamily: 'Poppins_400Regular',
              }}>
                {t('home.newPartner', { defaultValue: 'New Partner' })}
              </Text>
              <Text style={{
                color: '#fff',
                fontSize: 18,
                fontWeight: '700',
                fontFamily: 'Poppins_700Bold',
                marginTop: 4,
              }}>
                {newestPartner || '...'}
              </Text>
            </View>
            <Image
              source={require('@/assets/images/man_holding_basket-removebg-preview.png')}
              style={{ width: HERO_HEIGHT * 0.5, height: HERO_HEIGHT * 0.68, marginLeft: 8 }}
              resizeMode="contain"
            />
          </View>
        </ScrollView>

        {/* Dot indicators */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6, marginBottom: 24 }}>
          {[0, 1].map((i) => (
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

        {/* Static search bar */}
        <View style={{ paddingHorizontal: theme.spacing.xl }}>
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r12,
                ...theme.shadows.shadowSm,
                height: 44,
              },
            ]}
          >
            <Search size={18} color={theme.colors.muted} />
            <TextInput
              style={[
                styles.searchInput,
                { color: theme.colors.textPrimary, fontFamily: 'Poppins_400Regular', fontSize: 14, flex: 1 },
              ]}
              placeholder={t('home.searchPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }}>
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
                      {cat}
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
              >
                <RefreshCw size={16} color="#fff" />
                <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
                  {t('common.retry')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : filteredBaskets.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const, marginTop: 40, paddingHorizontal: 20 }]}>
                {t('home.emptyState.noBaskets')}
              </Text>
            </View>
          ) : (
            filteredBaskets.map((basket) => {
              const isAvailable = basket.quantityLeft > 0;
              // Check if pickup window has ended for today
              const now = new Date();
              const endStr = basket.pickupWindow?.end;
              let isClosed = false;
              if (endStr) {
                const [eh, em] = endStr.split(':').map(Number);
                if (!isNaN(eh) && !isNaN(em)) {
                  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em);
                  isClosed = now > endDate;
                }
              }
              const shouldFade = !isAvailable || isClosed;
              return (
                <View
                  key={basket.id}
                  style={{ position: 'relative' }}
                >
                  <BasketCard
                    basket={basket}
                    isFavorite={isBasketFavorite(basket.id)}
                    onFavoritePress={() => toggleBasketFavorite(basket.id)}
                  />
                  {shouldFade && (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 120,
                        backgroundColor: 'rgba(255,255,255,0.55)',
                        borderTopLeftRadius: 16,
                        borderTopRightRadius: 16,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      {isClosed && (
                        <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                            {t('home.closedToday', { defaultValue: 'Closed for today' })}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })
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
              >
                <X size={18} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.mapContainer, { marginHorizontal: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
              {Platform.OS !== 'web' && MapView ? (
                <MapView
                  style={styles.mapView}
                  initialRegion={{
                    latitude: 36.8065,
                    longitude: 10.1815,
                    latitudeDelta: radius * 0.02,
                    longitudeDelta: radius * 0.02,
                  }}
                  region={{
                    latitude: 36.8065,
                    longitude: 10.1815,
                    latitudeDelta: Math.max(0.02, radius * 0.015),
                    longitudeDelta: Math.max(0.02, radius * 0.015),
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
  },
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
