import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  User,
  Package,
  Banknote,
  Leaf,
  Flame,
  Lock,
  Trophy,
  Award,
  Star,
  Zap,
  Heart,
  Sun,
  Target,
  Coffee,
  MapPin,
  Shuffle,
  BookOpen,
  Moon,
  Medal,
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations } from '@/src/services/reservations';
import {
  fetchGamificationStats,
  fetchLeaderboard,
  type GamificationStats,
  type LeaderboardEntry,
  type Badge,
} from '@/src/services/gamification';

const PLACEHOLDER_BADGES: Badge[] = [
  { id: '1', badge_id: 'first_save', name: 'First Save', unlocked: false },
  { id: '2', badge_id: 'streak_3', name: '3-Day Streak', unlocked: false },
  { id: '3', badge_id: 'streak_7', name: '7-Day Streak', unlocked: false },
  { id: '4', badge_id: 'streak_30', name: '30-Day Streak', unlocked: false },
  { id: '5', badge_id: 'saved_10', name: '10 Saved', unlocked: false },
  { id: '6', badge_id: 'saved_25', name: '25 Saved', unlocked: false },
  { id: '7', badge_id: 'saved_50', name: '50 Saved', unlocked: false },
  { id: '8', badge_id: 'saved_100', name: '100 Saved', unlocked: false },
  { id: '9', badge_id: 'bakery_lover', name: 'Bakery Lover', unlocked: false },
  { id: '10', badge_id: 'local_hero', name: 'Local Hero', unlocked: false },
  { id: '11', badge_id: 'variety_seeker', name: 'Variety Seeker', unlocked: false },
  { id: '12', badge_id: 'early_bird', name: 'Early Bird', unlocked: false },
];

function getBadgeIcon(badgeId: string) {
  switch (badgeId) {
    case 'first_save': return Star;
    case 'streak_3': return Flame;
    case 'streak_7': return Flame;
    case 'streak_30': return Flame;
    case 'saved_10': case 'food_saver': return Award;
    case 'saved_25': case 'food_saver_25': return Award;
    case 'saved_50': case 'food_saver_50': return Medal;
    case 'saved_100': return Trophy;
    case 'bakery_lover': return Coffee;
    case 'local_hero': return MapPin;
    case 'variety_seeker': return Shuffle;
    case 'early_bird': return Sun;
    case 'onboarding_complete': return BookOpen;
    case 'generous': return Heart;
    case 'big_spender': return Banknote;
    case 'ramadan_saver': return Moon;
    default: return Star;
  }
}

export default function ImpactScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);
  const [badgeModal, setBadgeModal] = useState<Badge | null>(null);

  const gamificationQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ['leaderboard'],
    queryFn: fetchLeaderboard,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    const gStats = gamificationQuery.data as any;
    const gStatsInner = gStats?.stats ?? gStats;
    const gLevel = gStats?.level;
    const reservations = reservationsQuery.data ?? [];
    const completedReservations = reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'completed' || status === 'picked_up';
    });

    const mealsSaved = gStatsInner?.meals_saved ?? completedReservations.length;

    const moneySaved = gStatsInner?.money_saved != null
      ? Math.max(0, parseFloat(gStatsInner.money_saved) || 0)
      : completedReservations.reduce((sum, r) => {
          const rAny = r as any;
          const orig = Number(rAny.original_price ?? r.basket?.originalPrice ?? (r.basket as any)?.original_price ?? 0);
          const disc = Number(rAny.price_tier ?? rAny.selling_price ?? r.basket?.discountedPrice ?? (r.basket as any)?.discounted_price ?? (r.basket as any)?.price_tier ?? 0);
          return sum + Math.max(0, (orig - disc) * (r.quantity ?? 1));
        }, 0);

    const co2Saved = mealsSaved * 2.5;

    const xp = (typeof gLevel === 'object' ? gLevel?.xp : null) ?? gStatsInner?.xp ?? mealsSaved * 10;
    const level = (typeof gLevel === 'object' ? gLevel?.level : typeof gLevel === 'number' ? gLevel : null) ?? Math.floor(xp / 100) + 1;
    const xpInLevel = xp % 100;
    const xpProgress = xpInLevel / 100;

    const currentStreak = gStatsInner?.current_streak ?? 0;

    const rawBadges: Badge[] =
      gStats?.badges && gStats.badges.length > 0
        ? gStats.badges
        : PLACEHOLDER_BADGES;
    const badges = [...rawBadges].sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? -1 : 1));

    return {
      mealsSaved,
      moneySaved,
      co2Saved,
      level,
      xp,
      xpInLevel,
      xpProgress,
      currentStreak,
      badges,
    };
  }, [gamificationQuery.data, reservationsQuery.data]);

  const myLeaderboardIndex = useMemo(() => {
    const entries = leaderboardQuery.data ?? [];
    return entries.findIndex((e) => String(e.user_id) === String(user?.id));
  }, [leaderboardQuery.data, user?.id]);

  const leaderboardData = useMemo(() => {
    const entries = leaderboardQuery.data ?? [];
    if (showAllLeaderboard) return entries;
    if (myLeaderboardIndex >= 0) {
      const start = Math.max(0, myLeaderboardIndex - 2);
      const end = Math.min(entries.length, start + 5);
      return entries.slice(start, end);
    }
    return entries.slice(0, 5);
  }, [leaderboardQuery.data, showAllLeaderboard, myLeaderboardIndex]);

  const isLoading = gamificationQuery.isLoading || reservationsQuery.isLoading;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <StatusBar style="dark" />
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingHorizontal: theme.spacing.xl,
            paddingVertical: theme.spacing.lg,
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' }]}>
          {t('impact.title')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <DelayedLoader />
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={{ padding: theme.spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero Section */}
          <View
            style={[
              styles.heroCard,
              {
                backgroundColor: theme.colors.primary,
                borderRadius: theme.radii.r16,
                padding: theme.spacing.xl,
                marginBottom: theme.spacing.lg,
              },
            ]}
          >
            <View style={styles.heroTop}>
              <View
                style={[
                  styles.heroAvatar,
                  {
                    backgroundColor: theme.colors.primary + '15',
                    borderRadius: 32,
                    width: 64,
                    height: 64,
                    borderWidth: 2,
                    borderColor: 'rgba(255,255,255,0.3)',
                  },
                ]}
              >
                <User size={30} color="#fff" />
              </View>
              <View style={styles.heroInfo}>
                <Text style={[{ color: '#fff', ...theme.typography.h2 }]}>
                  {user?.name ?? t('impact.you')}
                </Text>
                <View
                  style={[
                    styles.levelBadge,
                    {
                      backgroundColor: theme.colors.secondary,
                      borderRadius: theme.radii.pill,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.xs,
                      marginTop: theme.spacing.xs,
                      alignSelf: 'flex-start',
                    },
                  ]}
                >
                  <Text
                    style={[
                      {
                        color: theme.colors.primaryDark,
                        ...theme.typography.caption,
                        fontWeight: '700' as const,
                      },
                    ]}
                  >
                    {t('impact.level', { level: String(stats.level) })}
                  </Text>
                </View>
              </View>
            </View>

            {/* XP Progress Bar */}
            <View style={{ marginTop: theme.spacing.lg }}>
              <View
                style={[
                  styles.xpBarBg,
                  {
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    borderRadius: theme.radii.pill,
                    height: 8,
                  },
                ]}
              >
                <View
                  style={[
                    styles.xpBarFill,
                    {
                      backgroundColor: theme.colors.secondary,
                      borderRadius: theme.radii.pill,
                      height: 8,
                      width: `${Math.max(stats.xpProgress * 100, 2)}%` as any,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  {
                    color: 'rgba(255,255,255,0.7)',
                    ...theme.typography.caption,
                    marginTop: theme.spacing.xs,
                    textAlign: 'right' as const,
                  },
                ]}
              >
                {t('impact.xpProgress', {
                  current: stats.xpInLevel,
                  next: 100,
                })}
              </Text>
            </View>
          </View>

          {/* Stats Grid (2x2) */}
          <View style={[styles.statsGrid, { marginBottom: theme.spacing.lg, gap: theme.spacing.md }]}>
            <View style={[styles.statsRow, { gap: theme.spacing.md }]}>
              {/* Meals Saved */}
              <View
                style={[
                  styles.statCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    padding: theme.spacing.lg,
                    ...theme.shadows.shadowSm,
                  },
                ]}
              >
                <View
                  style={[
                    styles.statIcon,
                    {
                      backgroundColor: theme.colors.primary + '15',
                      borderRadius: theme.radii.r12,
                      width: 40,
                      height: 40,
                    },
                  ]}
                >
                  <Package size={20} color={theme.colors.primary} />
                </View>
                <Text
                  style={[
                    {
                      color: theme.colors.textPrimary,
                      ...theme.typography.h2,
                      marginTop: theme.spacing.sm,
                    },
                  ]}
                >
                  {stats.mealsSaved}
                </Text>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                  {t('impact.mealsSaved')}
                </Text>
              </View>

              {/* Money Saved */}
              <View
                style={[
                  styles.statCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    padding: theme.spacing.lg,
                    ...theme.shadows.shadowSm,
                  },
                ]}
              >
                <View
                  style={[
                    styles.statIcon,
                    {
                      backgroundColor: theme.colors.accentWarm + '15',
                      borderRadius: theme.radii.r12,
                      width: 40,
                      height: 40,
                    },
                  ]}
                >
                  <Banknote size={20} color={theme.colors.accentWarm} />
                </View>
                <Text
                  style={[
                    {
                      color: theme.colors.textPrimary,
                      ...theme.typography.h2,
                      marginTop: theme.spacing.sm,
                    },
                  ]}
                >
                  {stats.moneySaved.toFixed(0)} TND
                </Text>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                  {t('impact.moneySaved')}
                </Text>
              </View>
            </View>

            <View style={[styles.statsRow, { gap: theme.spacing.md }]}>
              {/* CO2 Saved */}
              <View
                style={[
                  styles.statCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    padding: theme.spacing.lg,
                    ...theme.shadows.shadowSm,
                  },
                ]}
              >
                <View
                  style={[
                    styles.statIcon,
                    {
                      backgroundColor: theme.colors.accentFresh + '15',
                      borderRadius: theme.radii.r12,
                      width: 40,
                      height: 40,
                    },
                  ]}
                >
                  <Leaf size={20} color={theme.colors.accentFresh} />
                </View>
                <Text
                  style={[
                    {
                      color: theme.colors.textPrimary,
                      ...theme.typography.h2,
                      marginTop: theme.spacing.sm,
                    },
                  ]}
                >
                  {stats.co2Saved.toFixed(1)} kg
                </Text>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                  {t('impact.co2Saved')}
                </Text>
              </View>

              {/* Current Streak */}
              <View
                style={[
                  styles.statCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    padding: theme.spacing.lg,
                    ...theme.shadows.shadowSm,
                  },
                ]}
              >
                <View
                  style={[
                    styles.statIcon,
                    {
                      backgroundColor: theme.colors.error + '15',
                      borderRadius: theme.radii.r12,
                      width: 40,
                      height: 40,
                    },
                  ]}
                >
                  <Flame size={20} color={theme.colors.error} />
                </View>
                <Text
                  style={[
                    {
                      color: theme.colors.textPrimary,
                      ...theme.typography.h2,
                      marginTop: theme.spacing.sm,
                    },
                  ]}
                >
                  {stats.currentStreak}
                </Text>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                  {t('impact.currentStreak')}
                </Text>
              </View>
            </View>
          </View>

          {/* Badges Section */}
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Text
              style={[
                {
                  color: theme.colors.textPrimary,
                  ...theme.typography.h3,
                  marginBottom: theme.spacing.md,
                },
              ]}
            >
              {t('impact.badges')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: theme.spacing.md }}
            >
              {stats.badges.map((badge) => {
                const bid = badge.badge_id ?? badge.id;
                const BadgeIcon = badge.unlocked ? getBadgeIcon(bid) : Lock;
                const badgeName = badge.nameKey
                  ? t(`badges.${badge.nameKey}`, { defaultValue: badge.name ?? bid })
                  : badge.name ?? bid;
                return (
                  <TouchableOpacity
                    key={badge.id}
                    onPress={() => setBadgeModal(badge)}
                    activeOpacity={0.7}
                    style={[
                      styles.badgeCard,
                      {
                        backgroundColor: theme.colors.surface,
                        borderRadius: theme.radii.r16,
                        padding: theme.spacing.lg,
                        width: 100,
                        ...theme.shadows.shadowSm,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.badgeCircle,
                        {
                          backgroundColor: badge.unlocked
                            ? theme.colors.primary + '15'
                            : theme.colors.divider,
                          borderRadius: 28,
                          width: 56,
                          height: 56,
                        },
                      ]}
                    >
                      <BadgeIcon
                        size={24}
                        color={badge.unlocked ? theme.colors.primary : theme.colors.muted}
                      />
                    </View>
                    <Text
                      style={[
                        {
                          color: badge.unlocked
                            ? theme.colors.textPrimary
                            : theme.colors.muted,
                          ...theme.typography.caption,
                          marginTop: theme.spacing.sm,
                          textAlign: 'center' as const,
                        },
                      ]}
                      numberOfLines={2}
                    >
                      {badge.unlocked ? badgeName : t('impact.locked')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Leaderboard Section */}
          <View style={{ marginBottom: theme.spacing.lg }}>
            <Text
              style={[
                {
                  color: theme.colors.textPrimary,
                  ...theme.typography.h3,
                  marginBottom: theme.spacing.md,
                },
              ]}
            >
              {t('impact.leaderboard')}
            </Text>

            {leaderboardQuery.isLoading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : leaderboardData.length === 0 ? (
              <View
                style={[
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    padding: theme.spacing.xl,
                    alignItems: 'center' as const,
                    ...theme.shadows.shadowSm,
                  },
                ]}
              >
                <Trophy size={32} color={theme.colors.muted} />
                <Text
                  style={[
                    {
                      color: theme.colors.textSecondary,
                      ...theme.typography.bodySm,
                      marginTop: theme.spacing.sm,
                    },
                  ]}
                >
                  {t('impact.leaderboard')}
                </Text>
              </View>
            ) : (
              <View
                style={[
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    ...theme.shadows.shadowSm,
                    overflow: 'hidden' as const,
                  },
                ]}
              >
                {leaderboardData.map((entry, index) => {
                  const isMe = String(entry.user_id) === String(user?.id);
                  return (
                    <View
                      key={`lb-${entry.user_id}-${index}`}
                      style={[
                        styles.leaderboardRow,
                        {
                          paddingHorizontal: theme.spacing.lg,
                          paddingVertical: theme.spacing.md,
                          borderTopWidth: index === 0 ? 0 : 1,
                          borderTopColor: theme.colors.divider,
                          backgroundColor: isMe ? theme.colors.primary + '12' : 'transparent',
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: entry.rank <= 3 ? theme.colors.accentWarm : theme.colors.textSecondary,
                          ...theme.typography.h3,
                          width: 32,
                          fontWeight: '700' as const,
                        }}
                      >
                        #{entry.rank}
                      </Text>
                      <View
                        style={[
                          styles.leaderboardAvatar,
                          {
                            backgroundColor: isMe ? theme.colors.primary + '25' : theme.colors.primary + '15',
                            borderRadius: 18,
                            width: 36,
                            height: 36,
                            marginHorizontal: theme.spacing.md,
                            borderWidth: isMe ? 2 : 0,
                            borderColor: theme.colors.primary,
                          },
                        ]}
                      >
                        <User size={18} color={theme.colors.primary} />
                      </View>
                      <Text
                        style={{
                          color: isMe ? theme.colors.primary : theme.colors.textPrimary,
                          ...theme.typography.body,
                          flex: 1,
                          fontWeight: isMe ? '700' as const : '400' as const,
                        }}
                        numberOfLines={1}
                      >
                        {entry.name}{isMe ? ` (${t('impact.you', { defaultValue: 'You' })})` : ''}
                      </Text>
                      <Text
                        style={{
                          color: theme.colors.textSecondary,
                          ...theme.typography.bodySm,
                        }}
                      >
                        {entry.meals_saved} {t('impact.meals')}
                      </Text>
                    </View>
                  );
                })}

                {(leaderboardQuery.data?.length ?? 0) > 5 && (
                  <TouchableOpacity
                    style={{
                      paddingVertical: theme.spacing.md,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.divider,
                      alignItems: 'center' as const,
                    }}
                    onPress={() => setShowAllLeaderboard(!showAllLeaderboard)}
                  >
                    <Text style={{ color: theme.colors.primary, ...theme.typography.button }}>
                      {showAllLeaderboard ? t('impact.showLess', { defaultValue: 'Show Less' }) : t('impact.showMore')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      )}

      {/* Badge Detail Modal */}
      <Modal visible={badgeModal !== null} transparent animationType="fade" onRequestClose={() => setBadgeModal(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={() => setBadgeModal(null)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            {badgeModal && (() => {
              const bid = badgeModal.badge_id ?? badgeModal.id;
              const BadgeIcon = badgeModal.unlocked ? getBadgeIcon(bid) : Lock;
              const badgeName = badgeModal.nameKey
                ? t(`badges.${badgeModal.nameKey}`, { defaultValue: badgeModal.name ?? bid })
                : badgeModal.name ?? bid;
              const badgeDesc = badgeModal.descKey
                ? t(`badges.${badgeModal.descKey}`, { defaultValue: badgeModal.description ?? '' })
                : badgeModal.description ?? '';
              return (
                <>
                  <View style={{ backgroundColor: badgeModal.unlocked ? theme.colors.primary + '15' : theme.colors.divider, borderRadius: 36, width: 72, height: 72, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                    <BadgeIcon size={32} color={badgeModal.unlocked ? theme.colors.primary : theme.colors.muted} />
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
                    {badgeModal.unlocked ? badgeName : t('impact.locked')}
                  </Text>
                  {badgeModal.unlocked && badgeDesc ? (
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 12 }}>
                      {badgeDesc}
                    </Text>
                  ) : !badgeModal.unlocked ? (
                    <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20, marginBottom: 12 }}>
                      {t('badges.lockedDesc', { defaultValue: 'Keep saving food to unlock this badge!' })}
                    </Text>
                  ) : null}
                  {badgeModal.unlocked && badgeModal.unlocked_at && (
                    <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginBottom: 12 }}>
                      {t('badges.unlockedOn', { defaultValue: 'Unlocked on' })} {new Date(badgeModal.unlocked_at).toLocaleDateString()}
                    </Text>
                  )}
                </>
              );
            })()}
            <TouchableOpacity onPress={() => setBadgeModal(null)} style={{ backgroundColor: theme.colors.bg, borderRadius: 12, paddingVertical: 12, alignItems: 'center', width: '100%', borderWidth: 1, borderColor: theme.colors.divider, marginTop: 4 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.button }}>{t('common.close')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
  backButton: {
    width: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  heroCard: {},
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroInfo: {
    flex: 1,
    marginLeft: 16,
  },
  levelBadge: {},
  xpBarBg: {
    overflow: 'hidden',
  },
  xpBarFill: {},
  statsGrid: {},
  statsRow: {
    flexDirection: 'row',
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
  },
  statIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeCard: {
    alignItems: 'center',
  },
  badgeCircle: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaderboardAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
