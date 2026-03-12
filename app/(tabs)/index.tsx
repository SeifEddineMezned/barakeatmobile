import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, Compass, MapPin } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { mockBaskets, CATEGORIES } from '@/src/mocks/baskets';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { useAuthStore } from '@/src/stores/authStore';
import MapView, { Marker, Circle } from 'react-native-maps';

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
            style={[styles.radiusChip, { backgroundColor: theme.colors.bagsLeftBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radii.pill }]}
          >
            <MapPin size={13} color={theme.colors.primary} />
            <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 3 }]}>
              {radius} {t('home.km')}
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
          <View style={[styles.radiusModalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.r24, borderTopRightRadius: theme.radii.r24, ...theme.shadows.shadowLg }]}>
            <View style={[styles.radiusModalHeader, { padding: theme.spacing.xl }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('home.selectRadius')}
              </Text>
              <TouchableOpacity onPress={() => setShowRadiusModal(false)}>
                <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' as const }]}>
                  {t('common.done')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.mapContainer, { marginHorizontal: theme.spacing.xl }]}>
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
                <Circle
                  center={{ latitude: 36.8065, longitude: 10.1815 }}
                  radius={radius * 1000}
                  fillColor="rgba(17, 75, 60, 0.12)"
                  strokeColor={theme.colors.primary}
                  strokeWidth={2}
                />
                {mockBaskets.filter(b => b.distance <= radius).map((basket) => (
                  <Marker
                    key={basket.id}
                    coordinate={{ latitude: basket.latitude, longitude: basket.longitude }}
                    title={basket.merchantName}
                  />
                ))}
              </MapView>
            </View>

            <View style={[styles.sliderSection, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg }]}>
              <View style={styles.sliderHeader}>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                  {t('home.radiusFilter')}
                </Text>
                <Text style={[{ color: theme.colors.primary, ...theme.typography.h3 }]}>
                  {radius} {t('home.km')}
                </Text>
              </View>

              <View style={styles.sliderTrack}>
                {[1, 2, 3, 5, 10, 15, 20].map((val) => (
                  <TouchableOpacity
                    key={val}
                    onPress={() => setRadius(val)}
                    style={[
                      styles.sliderDot,
                      {
                        backgroundColor: val <= radius ? theme.colors.primary : theme.colors.divider,
                        width: val === radius ? 28 : 20,
                        height: val === radius ? 28 : 20,
                        borderRadius: val === radius ? 14 : 10,
                        borderWidth: val === radius ? 3 : 0,
                        borderColor: theme.colors.secondary,
                      },
                    ]}
                  >
                    <Text style={[{
                      color: val <= radius ? '#fff' : theme.colors.muted,
                      ...theme.typography.caption,
                      fontWeight: '700' as const,
                      fontSize: 9,
                    }]}>
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              onPress={() => setShowRadiusModal(false)}
              style={[{
                backgroundColor: theme.colors.primary,
                borderRadius: theme.radii.r12,
                padding: theme.spacing.lg,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  radiusModalContent: {},
  radiusModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mapContainer: {
    height: 240,
    borderRadius: 16,
    overflow: 'hidden',
  },
  mapView: {
    flex: 1,
  },
  sliderSection: {},
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sliderTrack: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  sliderDot: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
