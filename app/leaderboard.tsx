import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
} from 'react-native';
import { MapPin } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, User, Trophy } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchLeaderboard, type LeaderboardEntry } from '@/src/services/gamification';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useAddressStore } from '@/src/stores/addressStore';
import { Minus, Plus } from 'lucide-react-native';

type FilterTab = 'all' | 'region';

// Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

  // Extract city from address (use first comma segment or full address)
  const userRegion = activeFilter === 'region' && user?.address
    ? (user.address as string).split(',')[0].trim()
    : undefined;

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard', activeFilter, activeFilter === 'region' ? regionRadius : 'all'],
    queryFn: () => {
      if (activeFilter === 'region' && selectedAddr) {
        return fetchLeaderboard(undefined, selectedAddr.lat, selectedAddr.lng, regionRadius);
      }
      return fetchLeaderboard(userRegion);
    },
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

        {/* Avatar */}
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: isCurrentUser
                ? theme.colors.primary + '30'
                : theme.colors.primary + '15',
              borderRadius: 20,
              width: 40,
              height: 40,
              marginHorizontal: theme.spacing.md,
            },
          ]}
        >
          <User size={20} color={isCurrentUser ? theme.colors.primary : theme.colors.muted} />
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
            {t('impact.meals')}
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
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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

      {/* Filter tabs */}
      <View
        style={[
          styles.filterRow,
          {
            paddingHorizontal: theme.spacing.xl,
            marginBottom: theme.spacing.md,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => setActiveFilter('all')}
          style={[
            styles.filterTab,
            {
              backgroundColor: activeFilter === 'all' ? theme.colors.primary : theme.colors.surface,
              borderRadius: theme.radii.pill,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm,
              marginRight: theme.spacing.sm,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <Text
            style={{
              color: activeFilter === 'all' ? '#fff' : theme.colors.textPrimary,
              ...theme.typography.bodySm,
              fontWeight: '600' as const,
            }}
          >
            {t('impact.filterAll', { defaultValue: 'All' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveFilter('region')}
          style={[
            styles.filterTab,
            {
              backgroundColor: activeFilter === 'region' ? theme.colors.primary : theme.colors.surface,
              borderRadius: theme.radii.pill,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <Text
            style={{
              color: activeFilter === 'region' ? '#fff' : theme.colors.textPrimary,
              ...theme.typography.bodySm,
              fontWeight: '600' as const,
            }}
          >
            {t('impact.filterRegion', { defaultValue: 'My Region' })}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Region radius slider — shown when "My Region" is active */}
      {activeFilter === 'region' && (
        <View style={{ paddingHorizontal: theme.spacing.xl, marginBottom: theme.spacing.md }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, padding: 12, ...theme.shadows.shadowSm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MapPin size={14} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>{t('home.radiusFilter', { defaultValue: 'Rayon de recherche' })}</Text>
              </View>
              <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' }}>{regionRadius} km</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={() => setRegionRadius(Math.max(1, regionRadius - 5))} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }}>
                <Minus size={14} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <View style={{ flex: 1, height: 4, backgroundColor: theme.colors.divider, borderRadius: 2 }}>
                <View style={{ width: `${Math.min(100, (regionRadius / 50) * 100)}%`, height: 4, backgroundColor: theme.colors.primary, borderRadius: 2 }} />
              </View>
              <TouchableOpacity onPress={() => setRegionRadius(Math.min(50, regionRadius + 5))} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }}>
                <Plus size={14} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
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
  filterTab: {},
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
