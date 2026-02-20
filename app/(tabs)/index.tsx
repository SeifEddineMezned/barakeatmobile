import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, MapPin, TrendingDown, Users, Leaf } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { Chip } from '@/src/components/Chip';
import { mockBaskets, mockPartners } from '@/src/mocks/baskets';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { Basket, Partner } from '@/src/types';

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const { toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();

  const filters = ['all', 'category', 'pickup', 'price', 'distance', 'discountOnly'];

  const toggleFilter = useCallback((filter: string) => {
    setActiveFilters((prev) =>
      prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
    );
  }, []);

  const renderBasketItem = useCallback(
    ({ item }: { item: Basket }) => (
      <BasketCard
        basket={item}
        isFavorite={isBasketFavorite(item.id)}
        onFavoritePress={() => toggleBasketFavorite(item.id)}
      />
    ),
    [isBasketFavorite, toggleBasketFavorite]
  );

  const renderPartnerItem = useCallback(
    ({ item }: { item: Partner }) => (
      <View
        style={[
          styles.partnerCard,
          {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r12,
            ...theme.shadows.shadowSm,
            marginRight: theme.spacing.md,
          },
        ]}
      >
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>{item.name}</Text>
      </View>
    ),
    [theme]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
        <View style={styles.greetingRow}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
            {t('home.greeting')}!
          </Text>
          <View style={styles.locationChip}>
            <MapPin size={14} color={theme.colors.primary} />
            <Text
              style={[
                styles.locationText,
                { color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' as const },
              ]}
            >
              Grand Tunis
            </Text>
          </View>
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
          <Search size={20} color={theme.colors.muted} />
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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.valuePropsRow, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }]}>
          <View
            style={[
              styles.valuePropCard,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r12,
                ...theme.shadows.shadowSm,
              },
            ]}
          >
            <TrendingDown size={24} color={theme.colors.discount} />
            <Text
              style={[
                styles.valuePropText,
                { color: theme.colors.textPrimary, ...theme.typography.caption, marginTop: theme.spacing.xs },
              ]}
            >
              {t('home.valueProps.discount')}
            </Text>
          </View>
          <View
            style={[
              styles.valuePropCard,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r12,
                ...theme.shadows.shadowSm,
              },
            ]}
          >
            <MapPin size={24} color={theme.colors.primary} />
            <Text
              style={[
                styles.valuePropText,
                { color: theme.colors.textPrimary, ...theme.typography.caption, marginTop: theme.spacing.xs },
              ]}
            >
              {t('home.valueProps.nearby')}
            </Text>
          </View>
          <View
            style={[
              styles.valuePropCard,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r12,
                ...theme.shadows.shadowSm,
              },
            ]}
          >
            <Leaf size={24} color={theme.colors.secondary} />
            <Text
              style={[
                styles.valuePropText,
                { color: theme.colors.textPrimary, ...theme.typography.caption, marginTop: theme.spacing.xs },
              ]}
            >
              {t('home.valueProps.impact')}
            </Text>
          </View>
        </View>

        <View style={[styles.partnersSection, { marginTop: theme.spacing.xxl }]}>
          <Text
            style={[
              styles.sectionTitle,
              {
                color: theme.colors.textPrimary,
                ...theme.typography.h3,
                paddingHorizontal: theme.spacing.xl,
                marginBottom: theme.spacing.lg,
              },
            ]}
          >
            {t('home.partnersTitle')}
          </Text>
          <FlatList
            data={mockPartners}
            renderItem={renderPartnerItem}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: theme.spacing.xl }}
            keyExtractor={(item) => item.id}
          />
        </View>

        <View style={[styles.filtersSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filtersRow}>
              {filters.map((filter) => (
                <TouchableOpacity key={filter} onPress={() => toggleFilter(filter)}>
                  <View style={styles.filterChip}>
                    <Chip
                      label={t(`home.filters.${filter}`)}
                      variant={activeFilters.includes(filter) ? 'filled' : 'outlined'}
                      size="md"
                    />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={[styles.basketsSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }]}>
          {mockBaskets.map((basket) => (
            <BasketCard
              key={basket.id}
              basket={basket}
              isFavorite={isBasketFavorite(basket.id)}
              onFavoritePress={() => toggleBasketFavorite(basket.id)}
            />
          ))}
        </View>
      </ScrollView>
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
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {},
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
  },
  searchInput: {
    marginLeft: 12,
  },
  scrollView: {
    flex: 1,
  },
  valuePropsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  valuePropCard: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  valuePropText: {
    textAlign: 'center',
  },
  partnersSection: {},
  sectionTitle: {},
  partnerCard: {
    padding: 16,
    paddingHorizontal: 24,
  },
  filtersSection: {},
  filtersRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {},
  basketsSection: {},
});
