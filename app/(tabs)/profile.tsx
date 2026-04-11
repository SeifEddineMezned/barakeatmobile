import React, { useState, useMemo, useRef, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight, User, Mail, Phone,
  CreditCard, Leaf, Banknote, ShoppingBag, UtensilsCrossed, Edit3, X, Check,
  Flame, Lock, Trophy, Award, Star, Zap, Sun, Coffee, MapPin, Shuffle, Store, BookOpen, Heart, Moon, Medal, XCircle, CheckCircle2,
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
import { calcMoneySaved, calcCO2Saved, calcLevelProgress } from '@/src/lib/impactCalculations';
import { FeatureFlags } from '@/src/lib/featureFlags';

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
  const insets = useSafeAreaInsets();
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
  const [editGender, setEditGender] = useState<string | null>((user as any)?.gender ?? null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
    staleTime: 10_000,
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
    const mealsSaved = basketsBought;

    const moneySaved = gStatsInner?.money_saved != null
      ? Math.max(0, parseFloat(gStatsInner.money_saved) || 0)
      : calcMoneySaved(completedReservations as any[]);

    const co2Saved = calcCO2Saved(mealsSaved);

    // XP & level: read directly from backend DB values (set by refreshUserXpLevel on order/cancel/pickup).
    // Use nullish coalescing (??) not || to avoid 0 being treated as falsy.
    const xp = gStats?.xp ?? (typeof gLevel === 'object' ? (gLevel?.xp ?? 0) : 0);
    const level = gStats?.level ?? (typeof gLevel === 'object' ? (gLevel?.level ?? 1) : 1);
    const { xpInLevel, xpBandSize, xpProgress } = calcLevelProgress(Number(xp));

    const rawStreak = gStatsInner?.current_streak ?? 0;
    const longestStreak = gStatsInner?.longest_streak ?? 0;
    const lastPickupDate: string | null = gStatsInner?.last_pickup_date ?? null;
    const daysSinceLastPickup: number | null = gStatsInner?.days_since_last_pickup ?? null;
    // Streak expires after 7 days of inactivity — show 0 client-side if expired
    const daysUntilStreakExpiry = daysSinceLastPickup != null ? Math.max(0, 7 - daysSinceLastPickup) : null;
    const currentStreak = (daysSinceLastPickup != null && daysSinceLastPickup >= 7) ? 0 : rawStreak;

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

    return { basketsBought, moneySaved, co2Saved, level, xp, xpInLevel, xpBandSize, xpProgress, currentStreak, longestStreak, lastPickupDate, daysUntilStreakExpiry, badges, businessesTried };
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

  const FOOD_PREFS = ['Vegetarian', 'Vegan', 'Halal', 'Gluten Free', 'Nut Allergy', 'Lactose Free', 'Shellfish Allergy', 'No Pork'];
  const FOOD_PREF_KEY_MAP: Record<string, string> = {
    'Vegetarian': 'profile.pref.vegetarian',
    'Vegan': 'profile.pref.vegan',
    'Halal': 'profile.pref.halal',
    'Gluten Free': 'profile.pref.gluten_free',
    'Nut Allergy': 'profile.pref.nut_allergy',
    'Lactose Free': 'profile.pref.lactose_free',
    'Shellfish Allergy': 'profile.pref.shellfish_allergy',
    'No Pork': 'profile.pref.no_pork',
  };

  const handleSavePreferences = async () => {
    try {
      await updateFoodPreferences(selectedPrefs);
      setToastMsg({ type: 'success', text: t('profile.preferencesUpdated') });
      setShowPrefsModal(false);
    } catch {
      setToastMsg({ type: 'error', text: t('common.errorOccurred') });
    }
  };

  const handleSaveProfile = async () => {
    setSaveLoading(true);
    try {
      await updateUserProfile({ name: editName.trim(), phone: editPhone.trim(), gender: editGender ?? undefined });
      setUser({ ...user!, name: editName.trim(), phone: editPhone.trim(), gender: editGender });
      setToastMsg({ type: 'success', text: t('profile.profileUpdated') });
      setIsEditing(false);
    } catch (err: any) {
      setToastMsg({ type: 'error', text: err?.message ?? t('common.errorOccurred') });
    } finally {
      setSaveLoading(false);
    }
  };

  const scrollY = useRef(new Animated.Value(0)).current;
  const headerBg = scrollY.interpolate({ inputRange: [0, 30], outputRange: ['transparent', '#ffffff'], extrapolate: 'clamp' });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <StatusBar style="dark" />


      <ScrollView
        style={styles.content}
        contentContainerStyle={[{ padding: theme.spacing.xl, paddingTop: 50, paddingBottom: 180 }]}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
      >
        {/* Profile title — scrolls with content */}
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1, marginBottom: theme.spacing.sm }]}>{t('profile.title')}</Text>
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
              accessibilityLabel={t('impact.level', { level: String(stats.level) })}
              accessibilityRole="button"
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
            <TouchableOpacity onPress={() => setStreakModal(true)} accessibilityLabel={`${t('impact.streak', { defaultValue: 'Streak' })}: ${stats.currentStreak}`} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
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
              {t('impact.xpProgress', { current: stats.xpInLevel, next: stats.xpBandSize })}
            </Text>
          </View>
        </View>

        {/* Credits link */}
        <TouchableOpacity
          onPress={() => router.push('/wallet' as never)}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.r14, padding: 16, marginBottom: theme.spacing.lg, ...theme.shadows.shadowSm }}
          activeOpacity={0.7}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#114b3c15', justifyContent: 'center', alignItems: 'center' }}>
            <CreditCard size={18} color="#114b3c" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' }}>{t('wallet.credits', { defaultValue: 'Crédits' })}</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{t('wallet.earnCreditsShort', { defaultValue: 'Gagnez et utilisez des crédits' })}</Text>
          </View>
          <ChevronRight size={18} color={theme.colors.muted} />
        </TouchableOpacity>

        {/* Stats Row */}
        <View style={{ marginBottom: theme.spacing.xxl, overflow: 'visible' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ overflow: 'visible' }} contentContainerStyle={{ gap: 10, paddingRight: theme.spacing.xl, paddingHorizontal: 4, paddingVertical: 6 }}>
          <TouchableOpacity onPress={() => setStatModal('money')} accessibilityLabel={`${stats.moneySaved.toFixed(0)} TND ${t('profile.moneySaved')}`} accessibilityRole="button" style={{ width: 110, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.md, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Banknote size={18} color={theme.colors.primary} />
            </View>
            <Text numberOfLines={2} style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.moneySaved.toFixed(0)} TND
            </Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={2} style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.moneySaved')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('co2')} accessibilityLabel={`${stats.co2Saved.toFixed(1)} kg ${t('profile.co2Saved')}`} accessibilityRole="button" style={{ width: 110, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.md, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.accentFresh + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Leaf size={18} color={theme.colors.accentFresh} />
            </View>
            <Text numberOfLines={2} style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.co2Saved.toFixed(1)} kg
            </Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={2} style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.co2Saved')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('baskets')} accessibilityLabel={`${stats.basketsBought} ${t('profile.basketsBought')}`} accessibilityRole="button" style={{ width: 110, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.md, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.secondary + '30', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <ShoppingBag size={18} color={theme.colors.primaryDark} />
            </View>
            <Text numberOfLines={2} style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.basketsBought}
            </Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={2} style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.basketsBought')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('spots')} accessibilityLabel={`${stats.businessesTried} ${t('profile.businessesTried', { defaultValue: 'Places Tried' })}`} accessibilityRole="button" style={{ width: 110, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.md, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Store size={18} color={theme.colors.primary} />
            </View>
            <Text numberOfLines={2} style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.businessesTried}
            </Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.75} numberOfLines={2} style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.businessesTried', { defaultValue: 'Places Tried' })}
            </Text>
          </TouchableOpacity>
        </ScrollView>
        </View>

        {/* Badges Section */}
        <View style={{ marginBottom: theme.spacing.xl, overflow: 'visible' }}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('impact.badges')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ overflow: 'visible' }}
            contentContainerStyle={{ gap: theme.spacing.md, paddingHorizontal: 4, paddingVertical: 6 }}
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
                  accessibilityLabel={badge.unlocked ? badgeName : t('impact.locked')}
                  accessibilityRole="button"
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
            accessibilityLabel={t('impact.leaderboard')}
            accessibilityRole="button"
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
                          color: entry.rank === 1 ? '#FFD700' : entry.rank === 2 ? '#C0C0C0' : entry.rank === 3 ? '#CD7F32' : '#1a1a1a',
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
                  accessibilityLabel={showAllLeaderboard ? t('impact.showLess', { defaultValue: 'Show Less' }) : t('impact.showMore')}
                  accessibilityRole="button"
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
                  setEditGender((user as any)?.gender ?? null);
                  setIsEditing(true);
                }}
                accessibilityLabel={t('profile.editProfile')}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Edit3 size={16} color={theme.colors.primary} />
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
                accessibilityLabel={t('profile.name')}
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
                accessibilityLabel={t('profile.phone')}
              />
            ) : (
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
                {user?.phone ?? '-'}
              </Text>
            )}
          </View>
          {/* Gender row — optional */}
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
                {t('profile.gender', { defaultValue: 'Gender' })}
              </Text>
            </View>
            {isEditing ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[
                  { key: null, label: '-' },
                  { key: 'male', label: t('profile.genderMale', { defaultValue: 'Male' }) },
                  { key: 'female', label: t('profile.genderFemale', { defaultValue: 'Female' }) },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.key ?? 'none'}
                    onPress={() => setEditGender(opt.key)}
                    accessibilityLabel={opt.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: editGender === opt.key }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: theme.radii.pill,
                      backgroundColor: editGender === opt.key ? theme.colors.primary + '18' : theme.colors.bg,
                      borderWidth: editGender === opt.key ? 1.5 : 1,
                      borderColor: editGender === opt.key ? theme.colors.primary : theme.colors.divider,
                    }}
                  >
                    <Text style={{
                      color: editGender === opt.key ? theme.colors.primary : theme.colors.textPrimary,
                      ...theme.typography.caption,
                      fontWeight: editGender === opt.key ? '600' : '400',
                    }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
                {(user as any)?.gender === 'male' ? t('profile.genderMale', { defaultValue: 'Male' })
                  : (user as any)?.gender === 'female' ? t('profile.genderFemale', { defaultValue: 'Female' })
                  : t('profile.genderNotSet', { defaultValue: 'Not set' })}
              </Text>
            )}
          </View>
          {/* Save / Cancel buttons when editing */}
          {isEditing && (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
              <TouchableOpacity
                onPress={() => setIsEditing(false)}
                accessibilityLabel={t('common.cancel')}
                accessibilityRole="button"
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
                accessibilityLabel={saveLoading ? t('common.loading') : t('common.save')}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radii.r12, backgroundColor: theme.colors.primary, opacity: saveLoading ? 0.5 : 1 }}
              >
                <Check size={16} color="#fff" />
                <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                  {saveLoading ? t('common.loading') : t('common.save')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Food Preferences — hidden unless feature flag is enabled */}
        {FeatureFlags.ENABLE_DIETARY_PREFERENCES && (
        <TouchableOpacity
          onPress={() => setShowPrefsModal(true)}
          accessibilityLabel={t('profile.foodPreferences', { defaultValue: 'Food Preferences' })}
          accessibilityRole="button"
          style={[{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            padding: theme.spacing.lg,
            marginBottom: theme.spacing.lg,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            ...theme.shadows.shadowSm,
          }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <UtensilsCrossed size={20} color={theme.colors.textSecondary} />
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body }]}>
              {t('profile.foodPreferences', { defaultValue: 'Food Preferences' })}
            </Text>
          </View>
          <ChevronRight size={20} color={theme.colors.muted} />
        </TouchableOpacity>
        )}

        {/* Settings removed from buyer profile */}
      </ScrollView>

      {/* Stat Modal */}
      <Modal visible={statModal !== null} transparent animationType="fade" onRequestClose={() => setStatModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setStatModal(null)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]} onStartShouldSetResponder={() => true}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center', marginBottom: theme.spacing.md }]}>
              {statModal === 'money' ? t('profile.moneySaved')
                : statModal === 'co2' ? t('profile.co2Saved')
                : statModal === 'baskets' ? t('profile.basketsBought')
                : t('profile.businessesTried', { defaultValue: 'Places Tried' })}
            </Text>
            <Text style={[{ color: theme.colors.primary, ...theme.typography.h1, textAlign: 'center', marginBottom: theme.spacing.lg }]}>
              {statModal === 'money' ? `${stats.moneySaved.toFixed(0)} TND`
                : statModal === 'co2' ? `${stats.co2Saved.toFixed(1)} kg`
                : statModal === 'baskets' ? String(stats.basketsBought)
                : String(stats.businessesTried)}
            </Text>
            <TouchableOpacity onPress={() => setStatModal(null)} accessibilityLabel={t('common.close', { defaultValue: 'Close' })} accessibilityRole="button">
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }]}>
                {t('common.close', { defaultValue: 'Close' })}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Badge Modal */}
      <Modal visible={badgeModal !== null} transparent animationType="fade" onRequestClose={() => setBadgeModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setBadgeModal(null)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignItems: 'center', ...theme.shadows.shadowLg }]} onStartShouldSetResponder={() => true}>
            {badgeModal && (() => {
              const bid = badgeModal.badge_id ?? badgeModal.id;
              const BadgeIcon = badgeModal.unlocked ? getBadgeIcon(bid) : Lock;
              const badgeName = badgeModal.nameKey
                ? t(`badges.${badgeModal.nameKey}`, { defaultValue: badgeModal.name ?? bid })
                : badgeModal.name ?? bid;
              return (
                <>
                  <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: badgeModal.unlocked ? theme.colors.primary + '15' : theme.colors.divider, justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.lg }}>
                    <BadgeIcon size={32} color={badgeModal.unlocked ? theme.colors.primary : theme.colors.muted} />
                  </View>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: theme.spacing.sm }]}>
                    {badgeModal.unlocked ? badgeName : t('impact.locked')}
                  </Text>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center' }]}>
                    {badgeModal.unlocked
                      ? (badgeModal.descKey ? t(`badges.${badgeModal.descKey}`, { defaultValue: t('badges.newBadge') }) : t('badges.newBadge'))
                      : t('badges.lockedDesc')}
                  </Text>
                </>
              );
            })()}
            <TouchableOpacity onPress={() => setBadgeModal(null)} style={{ marginTop: theme.spacing.lg }} accessibilityLabel={t('common.close', { defaultValue: 'Close' })} accessibilityRole="button">
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }]}>
                {t('common.close', { defaultValue: 'Close' })}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Level Modal */}
      <Modal visible={levelModal} transparent animationType="fade" onRequestClose={() => setLevelModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setLevelModal(false)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignItems: 'center', ...theme.shadows.shadowLg }]} onStartShouldSetResponder={() => true}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.secondary, justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.lg }}>
              <Zap size={32} color={theme.colors.primaryDark} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center', marginBottom: theme.spacing.sm }]}>
              {t('impact.level', { level: String(stats.level) })}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center' }]}>
              {t('impact.xpProgress', { current: stats.xpInLevel, next: stats.xpBandSize })}
            </Text>
            <TouchableOpacity onPress={() => setLevelModal(false)} style={{ marginTop: theme.spacing.lg }} accessibilityLabel={t('common.close', { defaultValue: 'Close' })} accessibilityRole="button">
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }]}>
                {t('common.close', { defaultValue: 'Close' })}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Streak Modal */}
      <Modal visible={streakModal} transparent animationType="fade" onRequestClose={() => setStreakModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setStreakModal(false)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignItems: 'center', ...theme.shadows.shadowLg }]} onStartShouldSetResponder={() => true}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#FF6B35' + '18', justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.lg }}>
              <Flame size={32} color="#FF6B35" />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center', marginBottom: theme.spacing.xs }]}>
              {stats.currentStreak} {t('streak.days')}
            </Text>
            {/* Streak info rows */}
            <View style={{ width: '100%', marginTop: theme.spacing.md, gap: 8 }}>
              {stats.longestStreak > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('streak.longest')}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>{stats.longestStreak} {t('streak.daysUnit')}</Text>
                </View>
              )}
              {stats.lastPickupDate && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('streak.lastOrder')}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                    {new Date(stats.lastPickupDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </Text>
                </View>
              )}
              {stats.lastPickupDate && (
                (() => {
                  const expiryDate = new Date(new Date(stats.lastPickupDate).getTime() + 7 * 24 * 3600 * 1000);
                  const isExpiringSoon = stats.daysUntilStreakExpiry != null && stats.daysUntilStreakExpiry <= 2;
                  return (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('streak.expiresLabel')}</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: isExpiringSoon ? theme.colors.error : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                          {expiryDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </Text>
                        {stats.daysUntilStreakExpiry != null && stats.daysUntilStreakExpiry <= 3 && (
                          <Text style={{ color: theme.colors.error, fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 2 }}>
                            {stats.daysUntilStreakExpiry === 0 ? t('streak.expiresSoon') : t('streak.expiresIn', { days: stats.daysUntilStreakExpiry })}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })()
              )}
            </View>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center', marginTop: theme.spacing.md }]}>
              {t('streak.description')}
            </Text>
            <TouchableOpacity onPress={() => setStreakModal(false)} style={{ marginTop: theme.spacing.lg }} accessibilityLabel={t('common.close', { defaultValue: 'Close' })} accessibilityRole="button">
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }]}>
                {t('common.close', { defaultValue: 'Close' })}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Food Preferences Modal */}
      <Modal visible={showPrefsModal} transparent animationType="slide" onRequestClose={() => setShowPrefsModal(false)}>
        <View style={styles.bottomModalOverlay}>
          <View style={[styles.bottomModalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.r24, borderTopRightRadius: theme.radii.r24, ...theme.shadows.shadowLg }]}>
            <View style={[styles.bottomModalHeader, { padding: theme.spacing.xl }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('profile.foodPreferences', { defaultValue: 'Food Preferences' })}
              </Text>
              <TouchableOpacity onPress={() => setShowPrefsModal(false)} accessibilityLabel={t('common.close', { defaultValue: 'Close' })} accessibilityRole="button">
                <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' as const }]}>
                  {t('common.close', { defaultValue: 'Close' })}
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {FOOD_PREFS.map((pref) => {
                  const isSelected = selectedPrefs.includes(pref);
                  const labelKey = FOOD_PREF_KEY_MAP[pref];
                  return (
                    <TouchableOpacity
                      key={pref}
                      onPress={() => {
                        setSelectedPrefs((prev) =>
                          isSelected ? prev.filter((p) => p !== pref) : [...prev, pref]
                        );
                      }}
                      accessibilityLabel={labelKey ? t(labelKey, { defaultValue: pref }) : pref}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        borderRadius: theme.radii.pill,
                        backgroundColor: isSelected ? theme.colors.primary + '15' : theme.colors.bg,
                        borderWidth: isSelected ? 1.5 : 1,
                        borderColor: isSelected ? theme.colors.primary : theme.colors.divider,
                      }}
                    >
                      <Text style={{
                        color: isSelected ? theme.colors.primary : theme.colors.textPrimary,
                        ...theme.typography.bodySm,
                        fontWeight: isSelected ? '600' : '400',
                      }}>
                        {labelKey ? t(labelKey, { defaultValue: pref }) : pref}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                onPress={handleSavePreferences}
                accessibilityLabel={t('common.save')}
                accessibilityRole="button"
                style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16, paddingVertical: 16, marginTop: theme.spacing.xl, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', ...theme.typography.button }}>
                  {t('common.save')}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Level Up Banner */}
      {showLevelUp && (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            transform: [{ scale: levelUpScale }],
          }}
        >
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xxl, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.secondary, justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.lg }}>
              <Trophy size={36} color={theme.colors.primaryDark} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1, textAlign: 'center', marginBottom: theme.spacing.sm }]}>
              {t('impact.levelUp', { defaultValue: 'Level Up!' })}
            </Text>
            <Text style={[{ color: theme.colors.primary, ...theme.typography.h2, textAlign: 'center' }]}>
              {t('impact.level', { level: String(stats.level) })}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Success / Error toast modal */}
      <Modal visible={!!toastMsg} transparent animationType="fade" onRequestClose={() => setToastMsg(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: toastMsg?.type === 'success' ? '#114b3c18' : '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              {toastMsg?.type === 'success'
                ? <CheckCircle2 size={28} color="#114b3c" />
                : <XCircle size={28} color="#ef4444" />}
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {toastMsg?.type === 'success' ? t('common.success') : t('auth.error')}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {toastMsg?.text}
            </Text>
            <TouchableOpacity
              onPress={() => setToastMsg(null)}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>OK</Text>
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
  bottomModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomModalContent: {
    maxHeight: '85%',
    flex: 1,
  },
  bottomModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
