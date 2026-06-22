import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
} from 'react-native';
import { MapPin } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Trophy, Users } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchLeaderboard, fetchGamificationStats, updateLeaderboardVisibility, type LeaderboardEntry } from '@/src/services/gamification';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useAddressStore } from '@/src/stores/addressStore';
import { RadiusSlider } from '@/src/components/RadiusSlider';

type FilterTab = 'all' | 'region';

// Two-letter initials from a name — mirrors the avatar style on the Settings
// "user identity card" so the leaderboard reads as part of the same product.
// Backend already trims names to "First L." (privacy), so for "Youssef C." the
// first/last initials become "YC"; for a single-word name we just use the
// first letter (no fake "SS" doubling).
function deriveInitials(name?: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const { addresses, selectedId } = useAddressStore();
  const selectedAddr = addresses.find((a) => a.id === selectedId);

  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [regionRadius, setRegionRadius] = useState(10); // km

  // Reciprocity gate: a user who opted out of the leaderboard can neither
  // appear on it nor view it. Read the opt-in state from the shared
  // gamification-stats query (same cache key as the Profile tab).
  const queryClient = useQueryClient();
  const statsQuery = useQuery({ queryKey: ['gamification-stats'], queryFn: fetchGamificationStats });
  const leaderboardVisible = (statsQuery.data as any)?.show_in_leaderboard !== false;
  const [enabling, setEnabling] = useState(false);
  const enableLeaderboard = async () => {
    setEnabling(true);
    try {
      await updateLeaderboardVisibility(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gamification-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
      ]);
    } finally {
      setEnabling(false);
    }
  };

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard', activeFilter, activeFilter === 'region' ? regionRadius : 'all'],
    queryFn: () => {
      // "My Region" filters by the user's selected address (lat/lng/radius);
      // every other case is the global leaderboard.
      if (activeFilter === 'region' && selectedAddr) {
        return fetchLeaderboard(undefined, selectedAddr.lat, selectedAddr.lng, regionRadius);
      }
      return fetchLeaderboard();
    },
    // Don't fetch the global list behind the "choose an address" prompt.
    enabled: !(activeFilter === 'region' && !selectedAddr),
    staleTime: 60_000,
  });

  const entries = leaderboardQuery.data ?? [];

  const renderEntry = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isCurrentUser = user?.id != null && item.user_id === Number(user.id);

    return (
      <View
        style={[
          styles.entryRow,
          {
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderTopWidth: index === 0 ? 0 : 1,
            borderTopColor: theme.colors.divider,
            backgroundColor: isCurrentUser ? theme.colors.primary + '15' : 'transparent',
          },
        ]}
      >
        {/* Rank */}
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor:
              item.rank === 1
                ? '#FFD700'
                : item.rank === 2
                ? '#C0C0C0'
                : item.rank === 3
                ? '#CD7F32'
                : theme.colors.divider,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: item.rank <= 3 ? '#fff' : '#1a1a1a',
              ...theme.typography.bodySm,
              fontWeight: '700' as const,
            }}
          >
            {item.rank}
          </Text>
        </View>

        {/* Avatar — initials in the brand palette (matches Settings identity
            card). Dark-green backdrop + lime letters, regardless of whether
            the row is the current user; the row background tint already
            differentiates the "you" entry. */}
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: '#114b3c',
              borderRadius: 20,
              width: 40,
              height: 40,
              marginHorizontal: theme.spacing.md,
            },
          ]}
        >
          <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 0.4 }}>
            {deriveInitials(item.name)}
          </Text>
        </View>

        {/* Name */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: isCurrentUser ? theme.colors.primary : theme.colors.textPrimary,
              ...theme.typography.body,
              fontWeight: isCurrentUser ? ('700' as const) : ('400' as const),
            }}
            numberOfLines={1}
          >
            {item.name}
            {isCurrentUser ? ` (${t('impact.you', { defaultValue: 'You' })})` : ''}
          </Text>
        </View>

        {/* Meals saved */}
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            style={{
              color: isCurrentUser ? theme.colors.primary : theme.colors.textPrimary,
              ...theme.typography.h3,
              fontWeight: '700' as const,
            }}
          >
            {item.meals_saved}
          </Text>
          <Text
            style={{
              color: theme.colors.textSecondary,
              ...theme.typography.caption,
            }}
          >
            {item.meals_saved === 1 ? t('impact.basket', { defaultValue: 'panier' }) : t('impact.baskets', { defaultValue: 'paniers' })}
          </Text>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
      <Trophy size={48} color={theme.colors.muted} />
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.body,
          marginTop: theme.spacing.md,
          textAlign: 'center' as const,
        }}
      >
        {t('impact.leaderboard')}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.md,
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            color: theme.colors.textPrimary,
            ...theme.typography.h2,
            flex: 1,
            textAlign: 'center' as const,
          }}
        >
          {t('impact.leaderboard')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {!leaderboardVisible && !statsQuery.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xxl }}>
          <Trophy size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.md, textAlign: 'center' as const }}>
            {t('impact.leaderboardHidden', { defaultValue: 'Activez le classement pour participer et voir où vous vous situez.' })}
          </Text>
          <TouchableOpacity
            onPress={enableLeaderboard}
            disabled={enabling}
            style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, marginTop: theme.spacing.lg, opacity: enabling ? 0.6 : 1 }}
          >
            <Text style={{ color: '#fff', ...theme.typography.button }}>
              {t('impact.leaderboardEnable', { defaultValue: 'Activer le classement' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
      <>
      {/* Filter tabs — Barakeat underline format (same as Favoris / Mes
          commandes), 50/50 split, primary-coloured underline on the active
          tab. Inset by spacing.xl so the underlines line up with the
          leaderboard list's side margins below. */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.divider, marginBottom: theme.spacing.md, marginHorizontal: theme.spacing.xl }}>
        <TouchableOpacity
          onPress={() => setActiveFilter('all')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeFilter === 'all' }}
          style={{
            flex: 1, paddingVertical: 12, alignItems: 'center',
            borderBottomWidth: 2,
            borderBottomColor: activeFilter === 'all' ? theme.colors.primary : 'transparent',
            marginBottom: -1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Users size={15} color={activeFilter === 'all' ? theme.colors.primary : theme.colors.textSecondary} />
            <Text style={{ color: activeFilter === 'all' ? theme.colors.primary : theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: activeFilter === 'all' ? '600' : '400' }}>
              {t('impact.filterAll', { defaultValue: 'Tous' })}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveFilter('region')}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeFilter === 'region' }}
          style={{
            flex: 1, paddingVertical: 12, alignItems: 'center',
            borderBottomWidth: 2,
            borderBottomColor: activeFilter === 'region' ? theme.colors.primary : 'transparent',
            marginBottom: -1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MapPin size={15} color={activeFilter === 'region' ? theme.colors.primary : theme.colors.textSecondary} />
            <Text style={{ color: activeFilter === 'region' ? theme.colors.primary : theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: activeFilter === 'region' ? '600' : '400' }}>
              {t('impact.filterRegion', { defaultValue: 'Ma région' })}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Content area under the tabs. Wrapping the conditional in an explicit
          flex: 1 box guarantees both branches (no-address prompt OR slider +
          list) compute their flex against the full remaining height — without
          this wrapper the no-address View's flex was measured against a
          Fragment-sibling reference, so the prompt sat near the top of the
          page instead of in the true center of the area below the tabs. */}
      <View style={{ flex: 1 }}>
      {activeFilter === 'region' && !selectedAddr ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xl }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: theme.colors.primary + '14', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <MapPin size={40} color={theme.colors.primary} />
          </View>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
            {t('impact.regionNoAddressTitle', { defaultValue: 'Choisissez une adresse' })}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 20 }}>
            {t('impact.regionNoAddressDesc', { defaultValue: 'Pour voir le classement de votre région, ajoutez d\'abord une adresse.' })}
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/address-picker' as never)}
            style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.pill, paddingHorizontal: 24, paddingVertical: 13 }}
          >
            <Text style={{ color: '#fff', ...theme.typography.button }}>
              {t('impact.regionChooseAddress', { defaultValue: 'Choisir une adresse' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
      <>
      {/* Region radius — uses the same draggable slider as the discover map
          (src/components/RadiusSlider) so radius-picking feels identical
          across the app. Replaces the +/- 5-km stepper. */}
      {activeFilter === 'region' && (
        <View style={{ paddingHorizontal: theme.spacing.xl, marginBottom: theme.spacing.md }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, ...theme.shadows.shadowSm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MapPin size={14} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>{t('home.radiusFilter', { defaultValue: 'Rayon de recherche' })}</Text>
              </View>
              <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' }}>{regionRadius} km</Text>
            </View>
            <RadiusSlider
              value={regionRadius}
              onChange={(km) => setRegionRadius(km)}
              primaryColor={theme.colors.primary}
              trackColor={theme.colors.divider}
            />
          </View>
        </View>
      )}

      {/* Leaderboard list */}
      {leaderboardQuery.isLoading ? (
        <DelayedLoader />
      ) : leaderboardQuery.isError ? (
        <View style={styles.loadingContainer}>
          <Text
            style={{
              color: theme.colors.error,
              ...theme.typography.body,
              textAlign: 'center' as const,
            }}
          >
            {t('common.errorOccurred')}
          </Text>
          <TouchableOpacity
            onPress={() => void leaderboardQuery.refetch()}
            style={{
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r12,
              paddingHorizontal: theme.spacing.xl,
              paddingVertical: theme.spacing.md,
              marginTop: theme.spacing.lg,
            }}
          >
            <Text style={{ color: '#fff', ...theme.typography.button }}>
              {t('common.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View
          style={{
            flex: 1,
            marginHorizontal: theme.spacing.xl,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            overflow: 'hidden' as const,
            ...theme.shadows.shadowSm,
          }}
        >
          <FlatList
            data={entries}
            keyExtractor={(item, index) => `lb-${item.user_id}-${index}`}
            renderItem={renderEntry}
            ListEmptyComponent={renderEmpty}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        </View>
      )}
      </>
      )}
      </View>
      </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
