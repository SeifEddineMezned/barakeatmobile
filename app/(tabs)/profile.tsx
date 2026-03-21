import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight, User, Mail, Phone,
  CreditCard, Leaf, Banknote, ShoppingBag, UtensilsCrossed, Edit3, X, Check,
  Flame, Lock, Trophy, Award, Star, Zap, Sun, Coffee, MapPin, Shuffle, Store,
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
    case 'saved_10': return Award;
    case 'saved_25': return Award;
    case 'saved_50': return Trophy;
    case 'saved_100': return Trophy;
    case 'bakery_lover': return Coffee;
    case 'local_hero': return MapPin;
    case 'variety_seeker': return Shuffle;
    case 'early_bird': return Sun;
    default: return Zap;
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
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user?.name ?? '');
  const [editPhone, setEditPhone] = useState(user?.phone ?? '');
  const [saveLoading, setSaveLoading] = useState(false);
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);

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
    const gStats = gamificationQuery.data;
    const reservations = reservationsQuery.data ?? [];
    const completedReservations = reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'completed';
    });
    const basketsBought = completedReservations.reduce((sum, r) => sum + (r.quantity ?? 1), 0);
    const mealsSaved = gStats?.meals_saved ?? basketsBought;
    const moneySaved = completedReservations.reduce((sum, r) => {
      const orig = r.basket?.originalPrice ?? (r.basket as any)?.original_price ?? 0;
      const disc = r.basket?.discountedPrice ?? (r.basket as any)?.discounted_price ?? 0;
      return sum + (Number(orig) - Number(disc)) * (r.quantity ?? 1);
    }, 0);
    const co2Saved = mealsSaved * 2.5;

    const xp = gStats?.xp ?? mealsSaved * 10;
    const level = (typeof gStats?.level === 'number' ? gStats.level : null) ?? Math.floor(xp / 100) + 1;
    const xpInLevel = xp % 100;
    const xpProgress = xpInLevel / 100;
    const currentStreak = gStats?.current_streak ?? 0;

    const badges: Badge[] =
      gStats?.badges && gStats.badges.length > 0
        ? gStats.badges
        : PLACEHOLDER_BADGES;

    const businessesTried = new Set(completedReservations.map((r) => r.basket?.merchantName ?? (r.basket as any)?.merchant_name ?? r.basket?.merchantId ?? (r.basket as any)?.merchant_id ?? (r.basket as any)?.restaurant_id).filter(Boolean)).size;

    return { basketsBought, moneySaved, co2Saved, level, xp, xpInLevel, xpProgress, currentStreak, badges, businessesTried };
  }, [gamificationQuery.data, reservationsQuery.data]);

  const leaderboardData = useMemo(() => {
    const entries = leaderboardQuery.data ?? [];
    return showAllLeaderboard ? entries : entries.slice(0, 10);
  }, [leaderboardQuery.data, showAllLeaderboard]);

  const FOOD_PREFS = ['Vegetarian', 'Vegan', 'Halal', 'Gluten-Free', 'Nut Allergy', 'Lactose-Free', 'Shellfish Allergy', 'No Pork'];

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
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.sm }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('profile.title')}</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl }]} showsVerticalScrollIndicator={false}>
        {/* User Card with XP bar, level badge, streak */}
        <View
          style={[
            styles.userCard,
            {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              marginBottom: theme.spacing.lg,
            },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[styles.userAvatar, { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 28, width: 56, height: 56 }]}>
              <User size={28} color="#fff" />
            </View>
            <View style={styles.userInfo}>
              <Text style={[{ color: '#fff', ...theme.typography.h2 }]}>
                {user?.name ?? 'Utilisateur'}
              </Text>
              <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.bodySm, marginTop: 2 }]}>
                {user?.email ?? ''}
              </Text>
            </View>
          </View>

          {/* Level badge + Streak row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.md, gap: 10 }}>
            <View
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
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Flame size={16} color="#FF6B35" />
              <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const }}>
                {stats.currentStreak}
              </Text>
            </View>
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
              <View
                style={{
                  backgroundColor: theme.colors.secondary,
                  borderRadius: theme.radii.pill,
                  height: 6,
                  width: `${Math.max(stats.xpProgress * 100, 2)}%` as any,
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
          <View style={{ width: 100, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Banknote size={18} color={theme.colors.primary} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.moneySaved.toFixed(0)} TND
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.moneySaved')}
            </Text>
          </View>
          <View style={{ width: 100, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.accentFresh + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Leaf size={18} color={theme.colors.accentFresh} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.co2Saved.toFixed(1)} kg
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.co2Saved')}
            </Text>
          </View>
          <View style={{ width: 100, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.secondary + '30', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <ShoppingBag size={18} color={theme.colors.primaryDark} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.basketsBought}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.basketsBought')}
            </Text>
          </View>
          <View style={{ width: 100, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Store size={18} color={theme.colors.primary} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.businessesTried}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {t('profile.businessesTried', { defaultValue: 'Places Tried' })}
            </Text>
          </View>
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
              const BadgeIcon = badge.unlocked ? getBadgeIcon(badge.badge_id) : Lock;
              return (
                <View
                  key={badge.id}
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
                    {badge.unlocked
                      ? badge.name ?? badge.badge_id
                      : t('impact.locked')}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Leaderboard Section */}
        <View style={{ marginBottom: theme.spacing.lg }}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
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
              {leaderboardData.map((entry, index) => (
                <View
                  key={`lb-${entry.user_id}-${index}`}
                  style={[
                    styles.leaderboardRow,
                    {
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.md,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: theme.colors.divider,
                    },
                  ]}
                >
                  <Text
                    style={[
                      {
                        color:
                          entry.rank <= 3
                            ? theme.colors.accentWarm
                            : theme.colors.textSecondary,
                        ...theme.typography.h3,
                        width: 32,
                      },
                    ]}
                  >
                    {t('impact.rank', { rank: entry.rank })}
                  </Text>
                  <View
                    style={[
                      styles.leaderboardAvatar,
                      {
                        backgroundColor: theme.colors.primary + '15',
                        borderRadius: 18,
                        width: 36,
                        height: 36,
                        marginHorizontal: theme.spacing.md,
                      },
                    ]}
                  >
                    <User size={18} color={theme.colors.primary} />
                  </View>
                  <Text
                    style={[
                      {
                        color: theme.colors.textPrimary,
                        ...theme.typography.body,
                        flex: 1,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {entry.name}
                  </Text>
                  <Text
                    style={[
                      {
                        color: theme.colors.textSecondary,
                        ...theme.typography.bodySm,
                      },
                    ]}
                  >
                    {entry.meals_saved} {t('impact.meals')}
                  </Text>
                </View>
              ))}

              {(leaderboardQuery.data?.length ?? 0) > 10 && !showAllLeaderboard && (
                <TouchableOpacity
                  style={[
                    {
                      paddingVertical: theme.spacing.md,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.divider,
                      alignItems: 'center' as const,
                    },
                  ]}
                  onPress={() => setShowAllLeaderboard(true)}
                >
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.button }]}>
                    {t('impact.showMore')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Food Preferences */}
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

        <View style={{ height: 30 }} />
      </ScrollView>

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
                      {pref}
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
    </SafeAreaView>
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
