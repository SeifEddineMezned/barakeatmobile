import React, { useState, useMemo, useRef, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, TextInput,
  ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight, User, Mail, Phone,
  CreditCard, Leaf, Banknote, ShoppingBag, UtensilsCrossed, Edit3, X, Check,
  Flame, Lock, Trophy, Award, Star, Zap, Sun, Coffee, MapPin, Shuffle, Store, BookOpen, Heart, Moon, Medal,
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations } from '@/src/services/reservations';
import { updateFoodPreferences, updateUserProfile } from '@/src/services/profile';
import {
  fetchGamificationStats,
  fetchLeaderboard,
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

export default function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const setUser = useAuthStore((s) => s.setUser);

  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);
  const [statModal, setStatModal] = useState<'money' | 'co2' | 'baskets' | 'spots' | null>(null);
  const [badgeModal, setBadgeModal] = useState<Badge | null>(null);
  const [levelModal, setLevelModal] = useState(false);
  const [streakModal, setStreakModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user?.name ?? '');
  const [editPhone, setEditPhone] = useState(user?.phone ?? '');
  const [saveLoading, setSaveLoading] = useState(false);


  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

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

  const stats = useMemo(() => {
    const gStats = gamificationQuery.data as any;
    const gStatsInner = gStats?.stats ?? gStats;
    const gLevel = gStats?.level;
    const reservations = reservationsQuery.data ?? [];
    const completedReservations = reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'completed' || status === 'picked_up';
    });
    // Prefer authoritative backend stats, fall back to local calculation
    const basketsBought = gStatsInner?.meals_saved ?? completedReservations.length;
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
    // Sort: unlocked badges first
    const badges = [...rawBadges].sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? -1 : 1));

    // Use backend unique_restaurants, fall back to local dedup using restaurant_name (flat field from API)
    const businessesTried = gStatsInner?.unique_restaurants ??
      new Set(completedReservations.map((r) => {
        const rAny = r as any;
        return rAny.restaurant_name ?? r.basket?.merchantName ?? (r.basket as any)?.merchant_name ?? rAny.location_id ?? rAny.restaurant_id;
      }).filter(Boolean)).size;

    return { basketsBought, moneySaved, co2Saved, level, xp, xpInLevel, xpProgress, currentStreak, badges, businessesTried };
  }, [gamificationQuery.data, reservationsQuery.data]);

  // Animated XP bar
  const xpAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(xpAnim, {
      toValue: stats.xpProgress,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [stats.xpProgress]);

  // Level-up detection
  const prevLevelRef = useRef(stats.level);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const levelUpScale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (stats.level > prevLevelRef.current && prevLevelRef.current > 0) {
      setShowLevelUp(true);
      levelUpScale.setValue(0);
      Animated.spring(levelUpScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
      setTimeout(() => setShowLevelUp(false), 4000);
    }
    prevLevelRef.current = stats.level;
  }, [stats.level]);

  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);
  const leaderboardScrollRef = useRef<ScrollView>(null);

  const myLeaderboardIndex = useMemo(() => {
    const entries = leaderboardQuery.data ?? [];
    return entries.findIndex((e) => String(e.user_id) === String(user?.id));
  }, [leaderboardQuery.data, user?.id]);

  const leaderboardData = useMemo(() => {
    const entries = leaderboardQuery.data ?? [];
    if (showAllLeaderboard) return entries;
    // Collapsed: show user ±2 (5 entries centered on user, or top 5 if user is near top)
    if (myLeaderboardIndex >= 0) {
      const start = Math.max(0, myLeaderboardIndex - 2);
      const end = Math.min(entries.length, start + 5);
      return entries.slice(start, end);
    }
    return entries.slice(0, 5);
  }, [leaderboardQuery.data, showAllLeaderboard, myLeaderboardIndex]);

  const FOOD_PREFS = ['Vegetarian', 'Vegan', 'Halal', 'Gluten-Free', 'Nut Allergy', 'Lactose-Free', 'Shellfish Allergy', 'No Pork'];
  const FOOD_PREF_KEY_MAP: Record<string, string> = {
    'Vegetarian': 'profile.pref.vegetarian',
    'Vegan': 'profile.pref.vegan',
    'Halal': 'profile.pref.halal',
    'Gluten-Free': 'profile.pref.gluten_free',
    'Nut Allergy': 'profile.pref.nut_allergy',
    'Lactose-Free': 'profile.pref.lactose_free',
    'Shellfish Allergy': 'profile.pref.shellfish_allergy',
    'No Pork': 'profile.pref.no_pork',
  };

  const handleSavePreferences = async () => {
    try {
      await updateFoodPreferences(selectedPrefs);
      Alert.alert(t('common.success'), t('profile.preferencesUpdated'));
      setShowPrefsModal(false);
    } catch {
      Alert.alert(t('common.error'), t('common.errorOccurred'));
    }
  };

  const handleSaveProfile = async () => {
    setSaveLoading(true);
    try {
      await updateUserProfile({ name: editName.trim(), phone: editPhone.trim() });
      setUser({ ...user!, name: editName.trim(), phone: editPhone.trim() });
      Alert.alert(t('common.success'), t('profile.profileUpdated'));
      setIsEditing(false);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />

      {/* Profile title — below the tab header bar */}
      <View style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm }}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('profile.title')}</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl, paddingBottom: 120 }]} showsVerticalScrollIndicator={false}>
        {/* User Card with XP bar, level badge, streak */}
        {/* Fix 8: User card — consistent spacing, shadow, avatar alignment */}
        <View
          style={[
            styles.userCard,
            {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[styles.userAvatar, { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 30, width: 60, height: 60, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' }]}>
              <User size={28} color="#fff" />
            </View>
            <View style={[styles.userInfo, { marginLeft: 14 }]}>
              <Text style={[{ color: '#fff', ...theme.typography.h2, fontFamily: 'Poppins_700Bold' }]} numberOfLines={1}>
                {user?.name ?? 'Utilisateur'}
              </Text>
              <Text style={[{ color: 'rgba(255,255,255,0.72)', ...theme.typography.bodySm, marginTop: 2 }]} numberOfLines={1}>
                {user?.email ?? ''}
              </Text>
            </View>
          </View>

          {/* Level badge + Streak row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.md, gap: 10 }}>
            <TouchableOpacity
              onPress={() => setLevelModal(true)}
              style={{
                backgroundColor: theme.colors.secondary,
                borderRadius: theme.radii.pill,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.xs,
              }}
            >
              <Text
                style={{
                  color: theme.colors.primaryDark,
                  ...theme.typography.caption,
                  fontWeight: '700' as const,
                }}
              >
                {t('impact.level', { level: String(stats.level) })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStreakModal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Flame size={16} color="#FF6B35" />
              <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const }}>
                {stats.currentStreak}
              </Text>
            </TouchableOpacity>
          </View>

          {/* XP Progress Bar */}
          <View style={{ marginTop: theme.spacing.sm }}>
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderRadius: theme.radii.pill,
                height: 6,
                overflow: 'hidden' as const,
              }}
            >
              <Animated.View
                style={{
                  backgroundColor: theme.colors.secondary,
                  borderRadius: theme.radii.pill,
                  height: 6,
                  width: xpAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['2%', '100%'],
                  }),
                }}
              />
            </View>
            <Text
              style={{
                color: 'rgba(255,255,255,0.6)',
                ...theme.typography.caption,
                marginTop: 2,
                textAlign: 'right' as const,
                fontSize: 10,
              }}
            >
              {t('impact.xpProgress', { current: stats.xpInLevel, next: 100 })}
            </Text>
          </View>
        </View>

        {/* Stats Row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: theme.spacing.lg }} contentContainerStyle={{ gap: 10, paddingRight: theme.spacing.xl }}>
          <TouchableOpacity onPress={() => setStatModal('money')} style={{ width: 100, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Banknote size={18} color={theme.colors.primary} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.moneySaved.toFixed(0)} TND
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.moneySaved')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('co2')} style={{ width: 100, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.accentFresh + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Leaf size={18} color={theme.colors.accentFresh} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.co2Saved.toFixed(1)} kg
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.co2Saved')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('baskets')} style={{ width: 100, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.secondary + '30', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <ShoppingBag size={18} color={theme.colors.primaryDark} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.basketsBought}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.basketsBought')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('spots')} style={{ width: 100, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Store size={18} color={theme.colors.primary} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.businessesTried}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.businessesTried', { defaultValue: 'Places Tried' })}
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Badges Section */}
        <View style={{ marginBottom: theme.spacing.lg }}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
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
          <TouchableOpacity
            onPress={() => router.push('/leaderboard' as any)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md }}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {t('impact.leaderboard')}
            </Text>
            <ChevronRight size={20} color={theme.colors.muted} />
          </TouchableOpacity>

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
              <ScrollView ref={leaderboardScrollRef} nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ maxHeight: showAllLeaderboard ? 400 : undefined }}>
                {leaderboardData.map((entry, index) => {
                  const isMe = String(entry.user_id) === String(user?.id);
                  return (
                    <View
                      key={`lb-${entry.user_id}-${index}`}
                      onLayout={(e) => {
                        if (isMe && showAllLeaderboard && leaderboardScrollRef.current) {
                          leaderboardScrollRef.current.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 80), animated: true });
                        }
                      }}
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
              </ScrollView>

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

        {/* Personal Info Card */}
        <View
          style={[
            styles.infoSection,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {t('profile.personalInfo')}
            </Text>
            {!isEditing && (
              <TouchableOpacity
                onPress={() => {
                  setEditName(user?.name ?? '');
                  setEditPhone(user?.phone ?? '');
                  setIsEditing(true);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Edit3 size={16} color={theme.colors.primary} />
                <Text style={[{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                  {t('profile.editProfile')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {/* Name row */}
          <View
            style={[styles.infoRow, {
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              borderTopWidth: 1,
              borderTopColor: theme.colors.divider,
            }]}
          >
            <View style={styles.infoRowLeft}>
              <User size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('profile.name')}
              </Text>
            </View>
            {isEditing ? (
              <TextInput
                style={{ flex: 1, textAlign: 'right', color: theme.colors.textPrimary, ...theme.typography.bodySm, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 8 }}
                value={editName}
                onChangeText={setEditName}
                placeholder={t('profile.name')}
                placeholderTextColor={theme.colors.muted}
              />
            ) : (
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
                {user?.name ?? '-'}
              </Text>
            )}
          </View>
          {/* Email row */}
          <View
            style={[styles.infoRow, {
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              borderTopWidth: 1,
              borderTopColor: theme.colors.divider,
            }]}
          >
            <View style={styles.infoRowLeft}>
              <Mail size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('profile.email')}
              </Text>
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
              {user?.email ?? '-'}
            </Text>
          </View>
          {/* Phone row */}
          <View
            style={[styles.infoRow, {
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              borderTopWidth: 1,
              borderTopColor: theme.colors.divider,
            }]}
          >
            <View style={styles.infoRowLeft}>
              <Phone size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('profile.phone')}
              </Text>
            </View>
            {isEditing ? (
              <TextInput
                style={{ flex: 1, textAlign: 'right', color: theme.colors.textPrimary, ...theme.typography.bodySm, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 8 }}
                value={editPhone}
                onChangeText={setEditPhone}
                placeholder={t('profile.phone')}
                placeholderTextColor={theme.colors.muted}
                keyboardType="phone-pad"
              />
            ) : (
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
                {user?.phone ?? '-'}
              </Text>
            )}
          </View>
          {/* Save / Cancel buttons when editing */}
          {isEditing && (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
              <TouchableOpacity
                onPress={() => setIsEditing(false)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radii.r12, backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <X size={16} color={theme.colors.textSecondary} />
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveProfile}
                disabled={saveLoading}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radii.r12, backgroundColor: theme.colors.primary, opacity: saveLoading ? 0.5 : 1 }}
              >
                <Check size={16} color="#fff" />
                <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                  {saveLoading ? t('common.loading') : t('common.save')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Card info row */}
          <View style={[styles.infoRow, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <View style={styles.infoRowLeft}>
              <CreditCard size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('profile.cardInfo')}
              </Text>
            </View>
            <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
              {t('profile.cardInfoSoon')}
            </Text>
          </View>
        </View>

        {/* Food Preferences — below Personal Info */}
        <View
          style={[
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              marginBottom: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg }]}
            onPress={() => setShowPrefsModal(true)}
          >
            <View style={styles.menuItemLeft}>
              <UtensilsCrossed size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('profile.foodPreferences')}
              </Text>
            </View>
            <ChevronRight size={20} color={theme.colors.muted} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* Stat Detail Modal */}
      <Modal
        visible={statModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setStatModal(null)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
          activeOpacity={1}
          onPress={() => setStatModal(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: 24,
              padding: 24,
              maxHeight: '70%',
              width: '100%',
              maxWidth: 400,
            }}
          >

            {/* Money Saved */}
            {statModal === 'money' && (() => {
              const reservations = reservationsQuery.data ?? [];
              const completed = reservations.filter((r) => {
                const status = (r.status ?? '').toLowerCase();
                return status === 'collected' || status === 'completed' || status === 'picked_up';
              });
              const recent5 = completed.slice(-5).reverse();
              return (
                <>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: theme.spacing.sm }}>
                    {t('profile.statMoneySaved')}
                  </Text>
                  <Text style={{ color: theme.colors.primary, ...theme.typography.h1, marginBottom: theme.spacing.sm }}>
                    {stats.moneySaved.toFixed(2)} TND
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: theme.spacing.lg }}>
                    {t('profile.statMoneySavedDesc')}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false}>
                    {recent5.length === 0 ? (
                      <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center' as const }}>
                        {t('profile.noCompletedReservations')}
                      </Text>
                    ) : (
                      recent5.map((r, i) => {
                        const rAny = r as any;
                        const orig = Number(rAny.original_price ?? r.basket?.originalPrice ?? (r.basket as any)?.original_price ?? 0);
                        const disc = Number(rAny.price_tier ?? rAny.selling_price ?? r.basket?.discountedPrice ?? (r.basket as any)?.discounted_price ?? (r.basket as any)?.price_tier ?? 0);
                        const saving = Math.max(0, (orig - disc) * (r.quantity ?? 1));
                        const name = rAny.basket_name ?? rAny.restaurant_name ?? r.basket?.name ?? (r.basket as any)?.basket_name ?? 'Basket';
                        return (
                          <View
                            key={`ms-${i}`}
                            style={{
                              paddingVertical: theme.spacing.sm,
                              borderBottomWidth: 1,
                              borderBottomColor: theme.colors.divider,
                            }}
                          >
                            <Text
                              style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}
                              numberOfLines={1}
                            >
                              {name}
                            </Text>
                            <View style={{ flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginTop: 4 }}>
                              <Text style={{ color: theme.colors.muted, ...theme.typography.caption }}>
                                {t('profile.origPrice', { defaultValue: 'Original' })}: {orig.toFixed(2)} TND
                              </Text>
                              <Text style={{ color: theme.colors.muted, ...theme.typography.caption }}>
                                {t('profile.boughtAt', { defaultValue: 'Paid' })}: {disc.toFixed(2)} TND
                              </Text>
                              <Text style={{ color: theme.colors.accentFresh, ...theme.typography.caption, fontWeight: '700' as const }}>
                                {saving > 0 ? `+${saving.toFixed(2)}` : '0'} TND
                              </Text>
                            </View>
                          </View>
                        );
                      })
                    )}
                    <View style={{ height: theme.spacing.lg }} />
                  </ScrollView>
                </>
              );
            })()}

            {/* CO2 Saved */}
            {statModal === 'co2' && (
              <>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: theme.spacing.sm }}>
                  {t('profile.statCO2Saved')}
                </Text>
                <Text style={{ color: theme.colors.accentFresh, ...theme.typography.h1, marginBottom: theme.spacing.lg }}>
                  {stats.co2Saved.toFixed(1)} kg
                </Text>
                <ScrollView showsVerticalScrollIndicator={false}>
                  {[
                    { label: t('profile.carTrips'), value: (stats.co2Saved / 8).toFixed(1) },
                    { label: t('profile.plasticBottles'), value: (stats.co2Saved * 4).toFixed(0) },
                    { label: t('profile.kgRescued'), value: (stats.basketsBought * 1.3).toFixed(1) },
                  ].map((eq, i) => (
                    <View
                      key={`co2-${i}`}
                      style={{
                        flexDirection: 'row' as const,
                        alignItems: 'center' as const,
                        paddingVertical: theme.spacing.md,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.divider,
                        gap: 12,
                      }}
                    >
                      <View
                        style={{
                          backgroundColor: theme.colors.accentFresh + '20',
                          borderRadius: theme.radii.r12,
                          paddingHorizontal: theme.spacing.md,
                          paddingVertical: theme.spacing.sm,
                          minWidth: 60,
                          alignItems: 'center' as const,
                        }}
                      >
                        <Text style={{ color: theme.colors.accentFresh, ...theme.typography.h3, fontWeight: '700' as const }}>
                          {eq.value}
                        </Text>
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1 }}>
                        {eq.label}
                      </Text>
                    </View>
                  ))}
                  <View style={{ height: theme.spacing.lg }} />
                </ScrollView>
              </>
            )}

            {/* Baskets Bought */}
            {statModal === 'baskets' && (() => {
              const reservations = reservationsQuery.data ?? [];
              const completed = reservations.filter((r) => {
                const status = (r.status ?? '').toLowerCase();
                return status === 'collected' || status === 'completed' || status === 'picked_up';
              });
              const last8 = completed.slice(-8).reverse();
              return (
                <>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: theme.spacing.sm }}>
                    {t('profile.statBaskets')}
                  </Text>
                  <Text style={{ color: theme.colors.primaryDark, ...theme.typography.h1, marginBottom: theme.spacing.lg }}>
                    {stats.basketsBought}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false}>
                    {last8.length === 0 ? (
                      <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center' as const }}>
                        {t('profile.noCompletedReservations')}
                      </Text>
                    ) : (
                      last8.map((r, i) => {
                        const rAny = r as any;
                        const name = rAny.basket_name ?? rAny.restaurant_name ?? r.basket?.name ?? (r.basket as any)?.basket_name ?? t('profile.basket', { defaultValue: 'Basket' });
                        const qty = r.quantity ?? 1;
                        const rawDate = rAny.created_at ?? rAny.pickup_date ?? '';
                        const dateStr = rawDate ? new Date(rawDate).toLocaleDateString() : '—';
                        return (
                          <View
                            key={`bk-${i}`}
                            style={{
                              flexDirection: 'row' as const,
                              justifyContent: 'space-between' as const,
                              alignItems: 'center' as const,
                              paddingVertical: theme.spacing.sm,
                              borderBottomWidth: 1,
                              borderBottomColor: theme.colors.divider,
                            }}
                          >
                            <Text
                              style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}
                              numberOfLines={1}
                            >
                              {name}{qty > 1 ? ` x${qty}` : ''}
                            </Text>
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 8 }}>
                              {dateStr}
                            </Text>
                          </View>
                        );
                      })
                    )}
                    <View style={{ height: theme.spacing.lg }} />
                  </ScrollView>
                </>
              );
            })()}

            {/* Places Tried */}
            {statModal === 'spots' && (() => {
              const reservations = reservationsQuery.data ?? [];
              const completed = reservations.filter((r) => {
                const status = (r.status ?? '').toLowerCase();
                return status === 'collected' || status === 'completed' || status === 'picked_up';
              });
              const uniquePlaces = Array.from(
                new Set(
                  completed
                    .map((r) => (r as any).restaurant_name ?? r.basket?.merchantName ?? (r.basket as any)?.merchant_name ?? null)
                    .filter((n): n is string => Boolean(n))
                )
              );
              return (
                <>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: theme.spacing.sm }}>
                    {t('profile.statSpots')}
                  </Text>
                  <Text style={{ color: theme.colors.primary, ...theme.typography.h1, marginBottom: theme.spacing.lg }}>
                    {stats.businessesTried}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false}>
                    {uniquePlaces.length === 0 ? (
                      <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center' as const }}>
                        {t('profile.noPlacesVisited')}
                      </Text>
                    ) : (
                      uniquePlaces.map((place, i) => (
                        <View
                          key={`pl-${i}`}
                          style={{
                            flexDirection: 'row' as const,
                            alignItems: 'center' as const,
                            paddingVertical: theme.spacing.sm,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.colors.divider,
                            gap: 10,
                          }}
                        >
                          <Store size={16} color={theme.colors.primary} />
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1 }} numberOfLines={1}>
                            {place}
                          </Text>
                        </View>
                      ))
                    )}
                    <View style={{ height: theme.spacing.lg }} />
                  </ScrollView>
                </>
              );
            })()}

            {/* Close button */}
            <TouchableOpacity
              onPress={() => setStatModal(null)}
              style={{
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radii.r12,
                paddingVertical: theme.spacing.md,
                alignItems: 'center' as const,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                marginTop: theme.spacing.md,
              }}
            >
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.button }}>
                {t('common.close')}
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
            <TouchableOpacity onPress={() => setBadgeModal(null)} style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingVertical: theme.spacing.md, alignItems: 'center', width: '100%', borderWidth: 1, borderColor: theme.colors.divider, marginTop: 4 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.button }}>{t('common.close')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Level Detail Modal */}
      <Modal visible={levelModal} transparent animationType="fade" onRequestClose={() => setLevelModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={() => setLevelModal(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340 }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ backgroundColor: theme.colors.secondary, borderRadius: 32, width: 64, height: 64, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: theme.colors.primaryDark, fontSize: 24, fontWeight: '800', fontFamily: 'Poppins_700Bold' }}>{stats.level}</Text>
              </View>
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center', marginBottom: 4 }}>
              {t('impact.level', { level: String(stats.level) })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16 }}>
              {t('level.description', { defaultValue: 'Earn XP by saving food. The bar fills up and you level up when it reaches 100 XP.' })}
            </Text>
            {/* XP bar */}
            <View style={{ backgroundColor: theme.colors.divider, borderRadius: 8, height: 12, overflow: 'hidden', marginBottom: 8 }}>
              <View style={{ backgroundColor: theme.colors.primary, borderRadius: 8, height: 12, width: `${Math.max(stats.xpProgress * 100, 2)}%` as any }} />
            </View>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center', marginBottom: 16 }}>
              {stats.xpInLevel} / 100 XP — {100 - stats.xpInLevel} XP {t('level.toNext', { defaultValue: 'to next level' })}
            </Text>
            <View style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: 12, marginBottom: 16, gap: 6 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                {t('level.howItWorks', { defaultValue: 'How it works' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, lineHeight: 18 }}>
                {t('level.rule1', { defaultValue: '• Each basket saved = +10 XP' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, lineHeight: 18 }}>
                {t('level.rule2', { defaultValue: '• Every 100 XP = 1 level up' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, lineHeight: 18 }}>
                {t('level.rule3', { defaultValue: '• Total XP earned so far:' })} {stats.xp} XP
              </Text>
            </View>
            <TouchableOpacity onPress={() => setLevelModal(false)} style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingVertical: theme.spacing.md, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.button }}>{t('common.close')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Streak Detail Modal */}
      <Modal visible={streakModal} transparent animationType="fade" onRequestClose={() => setStreakModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={() => setStreakModal(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340 }}>
            {(() => {
              const gStats = gamificationQuery.data as any;
              const gStatsInner = gStats?.stats ?? gStats;
              const currentStreak = gStatsInner?.current_streak ?? 0;
              const longestStreak = gStatsInner?.longest_streak ?? 0;
              const lastPickup = gStatsInner?.last_pickup_date;
              const daysSince = gStatsInner?.days_since_last_pickup;
              const expiresSoon = gStatsInner?.streak_expires_soon;
              const daysLeft = daysSince != null ? Math.max(0, 7 - daysSince) : null;
              return (
                <>
                  <View style={{ alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ backgroundColor: '#FF6B3518', borderRadius: 32, width: 64, height: 64, justifyContent: 'center', alignItems: 'center' }}>
                      <Flame size={32} color="#FF6B35" />
                    </View>
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center', marginBottom: 4 }}>
                    {currentStreak} {t('streak.days', { defaultValue: 'day streak' })}
                  </Text>
                  {expiresSoon && (
                    <View style={{ backgroundColor: '#FF6B3515', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12, alignSelf: 'center', marginBottom: 12 }}>
                      <Text style={{ color: '#FF6B35', ...theme.typography.caption, fontWeight: '700' as const }}>
                        {daysLeft != null
                          ? t('streak.expiresIn', { days: daysLeft, defaultValue: `Expires in ${daysLeft} day(s)` })
                          : t('streak.expiresSoon', { defaultValue: 'Expires soon!' })}
                      </Text>
                    </View>
                  )}
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16 }}>
                    {t('streak.description', { defaultValue: 'Your streak counts consecutive weeks with at least one order. It resets after 7 days of inactivity.' })}
                  </Text>
                  <View style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: 12, marginBottom: 16, gap: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('streak.current', { defaultValue: 'Current streak' })}</Text>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const }}>{currentStreak}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('streak.longest', { defaultValue: 'Longest streak' })}</Text>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const }}>{longestStreak}</Text>
                    </View>
                    {lastPickup && (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('streak.lastOrder', { defaultValue: 'Last order' })}</Text>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const }}>{new Date(lastPickup).toLocaleDateString()}</Text>
                      </View>
                    )}
                    {daysLeft != null && (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('streak.expiresLabel', { defaultValue: 'Expires in' })}</Text>
                        <Text style={{ color: daysLeft <= 2 ? '#FF6B35' : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const }}>{daysLeft} {t('streak.daysUnit', { defaultValue: 'days' })}</Text>
                      </View>
                    )}
                  </View>
                </>
              );
            })()}
            <TouchableOpacity onPress={() => setStreakModal(false)} style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingVertical: theme.spacing.md, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.button }}>{t('common.close')}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Food Preferences Modal */}
      <Modal visible={showPrefsModal} transparent animationType="fade" onRequestClose={() => setShowPrefsModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowPrefsModal(false)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
              {t('profile.foodPreferences')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: theme.spacing.lg }}>
              {FOOD_PREFS.map((pref) => {
                const isSelected = selectedPrefs.includes(pref);
                return (
                  <TouchableOpacity
                    key={pref}
                    onPress={() => {
                      setSelectedPrefs((prev) =>
                        isSelected ? prev.filter((p) => p !== pref) : [...prev, pref]
                      );
                    }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: theme.radii.pill,
                      backgroundColor: isSelected ? theme.colors.primary + '18' : theme.colors.bg,
                      borderWidth: isSelected ? 1.5 : 1,
                      borderColor: isSelected ? theme.colors.primary : theme.colors.divider,
                    }}
                  >
                    <Text style={{
                      color: isSelected ? theme.colors.primary : theme.colors.textPrimary,
                      ...theme.typography.bodySm,
                      fontWeight: isSelected ? ('600' as const) : ('400' as const),
                    }}>
                      {t(FOOD_PREF_KEY_MAP[pref] ?? pref, { defaultValue: pref })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              onPress={handleSavePreferences}
              style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg }}
            >
              <Text style={{ color: '#fff', ...theme.typography.button, textAlign: 'center' }}>
                {t('common.save')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowPrefsModal(false)}
              style={{ padding: theme.spacing.md, marginTop: theme.spacing.sm }}
            >
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Level-up popup */}
      {showLevelUp && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowLevelUp(false)}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
            activeOpacity={1}
            onPress={() => setShowLevelUp(false)}
          >
            <Animated.View
              style={{
                backgroundColor: '#114b3c',
                borderRadius: 28,
                padding: 32,
                alignItems: 'center',
                width: 280,
                transform: [{ scale: levelUpScale }],
              }}
              onStartShouldSetResponder={() => true}
            >
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(227,255,92,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Trophy size={36} color="#e3ff5c" />
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: 'Poppins_500Medium', marginBottom: 4 }}>
                {t('impact.levelUp', { defaultValue: 'Level Up!' })}
              </Text>
              <Text style={{ color: '#e3ff5c', fontSize: 40, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginBottom: 8 }}>
                {stats.level}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
                {t('impact.levelUpDesc', { defaultValue: 'You reached level {{level}}!', level: stats.level })}
              </Text>
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {},
  content: {
    flex: 1,
  },
  userCard: {},
  userAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
    marginLeft: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statItem: {
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
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoSection: {},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
  },
});
