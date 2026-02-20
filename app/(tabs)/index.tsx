import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Search, MapPin } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { mockBaskets, CATEGORIES } from '@/src/mocks/baskets';
import { useFavoritesStore } from '@/src/stores/favoritesStore';

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Tous');
  const { toggleBasketFavorite, isBasketFavorite } = useFavoritesStore();

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
    return result;
  }, [activeCategory, searchQuery]);

  const handleCategoryPress = useCallback((cat: string) => {
    setActiveCategory(cat);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
        <View style={styles.greetingRow}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
            {t('home.greeting')} 👋
          </Text>
          <View style={[styles.locationChip, { backgroundColor: theme.colors.bagsLeftBg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radii.pill }]}>
            <MapPin size={13} color={theme.colors.primary} />
            <Text
              style={[
                { color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 3 },
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
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', marginTop: 40 }]}>
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
});
