import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, Compass, MapPin, X, Navigation } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { mockBaskets, CATEGORIES } from '@/src/mocks/baskets';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { useAuthStore } from '@/src/stores/authStore';
import { MapFallback } from '@/src/components/MapFallback';

let MapView: any = null;
let MapMarker: any = null;
let MapCircle: any = null;

if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  MapMarker = maps.Marker;
  MapCircle = maps.Circle;
}

const RADIUS_OPTIONS = [1, 2, 3, 5, 10, 15, 20];

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tous');
  const { toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();
  const { user } = useAuthStore();
  const [showRadiusModal, setShowRadiusModal] = useState(false);
  const [radius, setRadius] = useState(5);

  const filteredBaskets = useMemo(() => {
    let result = mockBaskets;
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
    result = result.filter((b) => b.distance <= radius);
    return result;
  }, [activeCategory, searchQuery, radius]);

  const handleCategoryPress = useCallback((cat: string) => {
    setActiveCategory(cat);
  }, []);

  const firstName = user?.firstName ?? user?.name?.split(' ')[0] ?? '';

  const mapMarkers = mockBaskets
    .filter((b) => b.distance <= radius)
    .map((b) => ({ id: b.id, name: b.merchantName, lat: b.latitude, lng: b.longitude }));

  const sliderProgress = useMemo(() => {
    const idx = RADIUS_OPTIONS.indexOf(radius);
    return idx >= 0 ? (idx / (RADIUS_OPTIONS.length - 1)) * 100 : 50;
  }, [radius]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
        <View style={styles.greetingRow}>
          <View style={styles.titleRow}>
            <Compass size={22} color={theme.colors.primary} />
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, marginLeft: 8 }]}>
              {t('home.discover')}
            </Text>
            {firstName ? (
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginLeft: 6 }]}>
                {firstName}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => setShowRadiusModal(true)}
            style={[styles.radiusChip, { backgroundColor: theme.colors.primary + '12', paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radii.pill }]}
          >
            <MapPin size={14} color={theme.colors.primary} />
            <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
              {radius} km
            </Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r12,
              marginTop: theme.spacing.lg,
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

      <View style={[styles.categoriesSection, { paddingLeft: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: theme.spacing.xl }}>
          {CATEGORIES.map((cat) => {
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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        {filteredBaskets.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const, marginTop: 40, paddingHorizontal: 20 }]}>
              {t('home.emptyState.noBaskets')}
            </Text>
          </View>
        ) : (
          filteredBaskets.map((basket) => (
            <BasketCard
              key={basket.id}
              basket={basket}
              isFavorite={isBasketFavorite(basket.id)}
              onFavoritePress={() => toggleBasketFavorite(basket.id)}
            />
          ))
        )}
      </ScrollView>

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
                  {mockBaskets.filter(b => b.distance <= radius).map((basket) => (
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
                  <View style={[styles.sliderTrackFill, { backgroundColor: 'red', width: `${sliderProgress}%` }]} />
                </View>
                <View style={styles.dotsRow}>
                  {RADIUS_OPTIONS.map((val) => {
                    const isSelected = val === radius;
                    const isInRange = val <= radius;
                    return (
                      <TouchableOpacity
                        key={val}
                        onPress={() => setRadius(val)}
                        style={[
                          styles.sliderDotOuter,
                          {
                            backgroundColor: isSelected ? 'red' : isInRange ? 'rgba(255,0,0,0.5)' : theme.colors.divider,
                            width: isSelected ? 32 : 24,
                            height: isSelected ? 32 : 24,
                            borderRadius: isSelected ? 16 : 12,
                            borderWidth: isSelected ? 3 : 0,
                            borderColor: '#ff4444',
                          },
                        ]}
                      >
                        <Text style={[{
                          color: isInRange ? '#fff' : theme.colors.muted,
                          fontSize: isSelected ? 11 : 9,
                          fontWeight: '700' as const,
                          fontFamily: 'Poppins_600SemiBold',
                        }]}>
                          {val}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {},
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radiusChip: {
    flexDirection: 'row',
    alignItems: 'center',
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
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderDotOuter: {
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
