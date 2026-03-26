import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, User, Trophy } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchLeaderboard, type LeaderboardEntry } from '@/src/services/gamification';

type FilterTab = 'all' | 'region';

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();

  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard'],
    queryFn: fetchLeaderboard,
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
              color: item.rank <= 3 ? '#fff' : theme.colors.textSecondary,
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

      {/* Leaderboard list */}
      {leaderboardQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
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
