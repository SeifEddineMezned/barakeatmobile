import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Platform, ActivityIndicator, Dimensions, Animated, PanResponder, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, X, RefreshCw, Settings, Bell, Navigation } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { useAuthStore } from '@/src/stores/authStore';
import { MapFallback } from '@/src/components/MapFallback';
import { fetchRestaurants } from '@/src/services/restaurants';
import { normalizeRestaurantToBasket } from '@/src/utils/normalizeRestaurant';
import { useHeroStore } from '@/src/stores/heroStore';

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
  const [showRadiusModal, setShowRadiusModal] = useState(false);
  const [radius, setRadius] = useState(5);
  const [carouselPage, setCarouselPage] = useState(0);
  const carouselRef = useRef<ScrollView>(null);

  // Hero slide-up/slide-down animation
  const heroHeight = useRef(new Animated.Value(1)).current; // 1 = visible, 0 = hidden
  const [heroVisible, setHeroVisible] = useState(true);
  const setHeroVisibleGlobal = useHeroStore((s) => s.setHeroVisible);

  const HERO_HEIGHT = 220;

  // Track the raw animated value for drag
  const heroRawRef = useRef(1);
  const dragStartRef = useRef(1);

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

  const dragPanResponder = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderGrant: () => {
        // Capture starting value when drag begins
        dragStartRef.current = heroRawRef.current;
      },
      onPanResponderMove: (_, g) => {
        // dy negative = dragging up = shrink hero
        const newVal = dragStartRef.current + (g.dy / HERO_HEIGHT);
        heroHeight.setValue(Math.max(0, Math.min(1, newVal)));
      },
      onPanResponderRelease: (_, g) => {
        const currentVal = heroRawRef.current;
        // Use velocity for quick flicks, position for slow drags
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

  const restaurantsQuery = useQuery({
    queryKey: ['restaurants'],
    queryFn: fetchRestaurants,
    staleTime: 60_000,
    retry: 2,
  });

  const baskets = useMemo(() => {
    if (!restaurantsQuery.data) return [];
    return restaurantsQuery.data.map(normalizeRestaurantToBasket);
  }, [restaurantsQuery.data]);

  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    baskets.forEach((b) => {
      if (b.category && b.category !== 'Tous') cats.add(b.category);
    });
    return ['Tous', ...Array.from(cats)];
  }, [baskets]);

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
    // Sort: available baskets first, then unavailable
    result = [...result].sort((a, b) => {
      const aAvail = a.isActive && a.quantityLeft > 0 ? 1 : 0;
      const bAvail = b.isActive && b.quantityLeft > 0 ? 1 : 0;
      return bAvail - aAvail;
    });
    return result;
  }, [baskets, activeCategory, searchQuery]);

  const handleCategoryPress = useCallback((cat: string) => {
    setActiveCategory(cat);
  }, []);

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

  const mapMarkers = baskets
    .map((b) => ({ id: b.id, name: b.merchantName, lat: b.latitude, lng: b.longitude }));

  return (
    <View style={[styles.container, { backgroundColor: heroVisible ? '#114b3c' : theme.colors.bg }]}>
      {/* Floating header — Barakeat logo + settings + bell, always on top */}
      <View style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        paddingTop: insets.top + 4,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: heroVisible ? 'transparent' : theme.colors.bg,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={{ color: heroVisible ? '#e3ff5c' : theme.colors.primary, fontSize: 20, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
            Barakeat
          </Text>
          <Text style={{ color: heroVisible ? '#e3ff5c' : '#e3ff5c', fontSize: 20, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
            .
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={snapHero ? () => snapHero(!heroVisible) : undefined} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <View style={{
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: heroVisible ? 'rgba(255,255,255,0.15)' : theme.colors.divider,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Text style={{ color: heroVisible ? '#e3ff5c' : theme.colors.textPrimary, fontSize: 12, fontWeight: '700' }}>
                {heroVisible ? '\u25B2' : '\u25BC'}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/settings' as never)}>
            <Settings size={20} color={heroVisible ? '#e3ff5c' : theme.colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/notifications' as never)}>
            <Bell size={20} color={heroVisible ? '#e3ff5c' : theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Carousel hero — fills top area */}
      <Animated.View style={{ height: animatedHeroHeight, opacity: animatedHeroOpacity, overflow: 'hidden', paddingTop: insets.top + 48, paddingBottom: 30, paddingHorizontal: 20 }}>
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
              <Text style={{
                color: '#fff',
                fontSize: 26,
                fontWeight: '700',
                fontFamily: 'Poppins_700Bold',
                marginTop: 4,
              }}>
                {firstName || t('home.search')} 👋
              </Text>
            </View>
            {/* Hero image */}
            <Image
              source={require('@/assets/images/man_holding_basket-removebg-preview.png')}
              style={{ width: HERO_HEIGHT * 0.65, height: HERO_HEIGHT * 0.85, marginLeft: 4 }}
              resizeMode="contain"
            />
          </View>
          {/* Page 2: New Partner */}
          <View style={{ width: carouselWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{
                color: 'rgba(255,255,255,0.7)',
                fontSize: 14,
                fontFamily: 'Poppins_400Regular',
              }}>
                {t('home.newPartner', { defaultValue: 'New Partner' })}
              </Text>
              <Text style={{
                color: '#fff',
                fontSize: 22,
                fontWeight: '700',
                fontFamily: 'Poppins_700Bold',
                marginTop: 4,
              }}>
                {newestPartner || '...'}
              </Text>
            </View>
            <Image
              source={require('@/assets/images/man_holding_basket-removebg-preview.png')}
              style={{ width: HERO_HEIGHT * 0.55, height: HERO_HEIGHT * 0.75, marginLeft: 8 }}
              resizeMode="contain"
            />
          </View>
        </ScrollView>

        {/* Dot indicators */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 12 }}>
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

      {/* Content section with curved top */}
      <View style={{
        flex: 1,
        backgroundColor: theme.colors.bg,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 0,
        marginTop: -10,
      }}>
        {/* Drag handle — drag up to hide hero, drag down to show */}
        <View
          {...dragPanResponder.panHandlers}
          style={{
            alignItems: 'center',
            paddingTop: 16,
            paddingBottom: 16,
          }}
        >
          <View style={{
            width: 44,
            height: 5,
            borderRadius: 3,
            backgroundColor: theme.colors.muted + '40',
          }} />
        </View>

        {/* Search bar */}
        <View style={{ paddingHorizontal: theme.spacing.xl }}>
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r12,
                ...theme.shadows.shadowSm,
              },
            ]}
          >
            <Search size={18} color={theme.colors.muted} />
            <TextInput
              style={[
                styles.searchInput,
                { color: theme.colors.textPrimary, ...theme.typography.body, flex: 1 },
              ]}
              placeholder={t('home.searchPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {/* Scrollable content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.categoriesSection, { marginBottom: theme.spacing.lg }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: theme.spacing.xl }}>
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
                        paddingVertical: theme.spacing.sm,
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
          {restaurantsQuery.isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 16 }]}>
                {t('common.loading')}
              </Text>
            </View>
          ) : restaurantsQuery.isError ? (
            <View style={styles.centerState}>
              <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center' as const, marginBottom: 16 }]}>
                {t('common.errorOccurred')}
              </Text>
              <TouchableOpacity
                onPress={() => restaurantsQuery.refetch()}
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
            filteredBaskets.map((basket) => (
              <View key={basket.id} style={{ opacity: basket.isActive && basket.quantityLeft > 0 ? 1 : 0.45 }}>
                <BasketCard
                  basket={basket}
                  isFavorite={isBasketFavorite(basket.id)}
                  onFavoritePress={() => toggleBasketFavorite(basket.id)}
                />
              </View>
            ))
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
                    MapMarker ? (
                      <MapMarker
                        key={basket.id}
                        coordinate={{ latitude: basket.latitude, longitude: basket.longitude }}
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
              <Navigation size={16} color={theme.colors.primary} />
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
    </View>
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
