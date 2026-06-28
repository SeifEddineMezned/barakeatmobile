import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useStatusBarStyleOnFocus } from '@/src/hooks/useStatusBarStyleOnFocus';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, Animated, Switch, Alert, Platform, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, User, Mail,
  CreditCard, Leaf, Banknote, ShoppingBag, UtensilsCrossed, Edit3, X, Check,
  Flame, Lock, Trophy, Award, Star, Zap, Sun, Coffee, MapPin, Shuffle, Store, BookOpen, Heart, Moon, Medal, CheckCircle2,
} from 'lucide-react-native';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';
import { useTheme } from '@/src/theme/ThemeProvider';
import { EditIcon8 } from '@/src/components/ui/Icon8';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations } from '@/src/services/reservations';
import { updateFoodPreferences, updateUserProfile } from '@/src/services/profile';
import { getErrorMessage } from '@/src/lib/api';
import {
  fetchGamificationStats,
  fetchLeaderboard,
  updateLeaderboardVisibility,
  type Badge,
} from '@/src/services/gamification';
import { calcMoneySaved, calcCO2Saved, calcLevelProgress } from '@/src/lib/impactCalculations';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';

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

// Per-badge accent color so the wall of badges reads as a colorful set rather
// than a row of identical green circles. Each family gets a hue that matches
// its theme (flames = orange, medals = blue/gold, nature = green, etc.). Only
// applied to UNLOCKED badges; locked ones stay muted/grey so the "earned vs
// not" distinction is still obvious at a glance.
function getBadgeColor(badgeId: string): string {
  switch (badgeId) {
    case 'first_save': return '#f59e0b';
    case 'streak_3': return '#fb923c';
    case 'streak_7': return '#f97316';
    case 'streak_30': return '#ea580c';
    case 'saved_10': case 'food_saver': return '#22c55e';
    case 'saved_25': case 'food_saver_25': return '#14b8a6';
    case 'saved_50': case 'food_saver_50': return '#3b82f6';
    case 'saved_100': return '#eab308';
    case 'bakery_lover': return '#b45309';
    case 'local_hero': return '#ef4444';
    case 'variety_seeker': return '#8b5cf6';
    case 'early_bird': return '#facc15';
    case 'onboarding_complete': return '#6366f1';
    case 'generous': return '#ec4899';
    case 'big_spender': return '#10b981';
    case 'ramadan_saver': return '#7c3aed';
    default: return '#114b3c';
  }
}

// Impact-stat labels are short two-word phrases ("Paniers sauvés", "Argent
// économisé"). Break them at the FIRST space so each word stacks on its own
// line — a calmer, balanced look in the narrow 110px stat cards than one
// shrunk-to-fit line. Single-word labels are returned unchanged.
function twoLineLabel(label: string): string {
  const i = label.indexOf(' ');
  return i === -1 ? label : `${label.slice(0, i)}\n${label.slice(i + 1)}`;
}

export default function ProfileScreen() {
  useStatusBarStyleOnFocus('dark');
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated } = useAuthStore();
  const setUser = useAuthStore((s) => s.setUser);

  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const [selectedPrefs, setSelectedPrefs] = useState<string[]>([]);
  const [statModal, setStatModal] = useState<'money' | 'co2' | 'baskets' | 'spots' | null>(null);
  // Self-managed fade for the stat-detail popup. The stock Modal
  // animationType="fade" empties the card content (it's derived from
  // `statModal`) the instant you tap close, while the card View keeps fading
  // out — leaving an empty surface + its drop shadow visible for a frame (the
  // "shadow stays behind when I close it" artifact). Instead we drive the fade
  // ourselves: keep `statModal` SET so the content stays rendered, animate the
  // whole overlay's opacity to 0, THEN unmount — so the card and its shadow
  // fade away together and vanish cleanly.
  const statModalAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (statModal !== null) {
      statModalAnim.setValue(0);
      Animated.timing(statModalAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
  }, [statModal, statModalAnim]);
  const closeStatModal = useCallback(() => {
    Animated.timing(statModalAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      setStatModal(null);
    });
  }, [statModalAnim]);
  const [badgeModal, setBadgeModal] = useState<Badge | null>(null);
  // Keep the last-shown badge through the modal's fade-OUT so the card never
  // renders EMPTY (a white box + its shadow) for a frame as it animates closed.
  // That empty frame is the "a shadow / white div flashes right after I close
  // it" artifact — the card content was gated on `badgeModal`, which goes null
  // the instant you close, while the card View kept fading out behind it.
  const lastBadgeRef = useRef<Badge | null>(null);
  if (badgeModal) lastBadgeRef.current = badgeModal;
  const [levelModal, setLevelModal] = useState(false);
  const [streakModal, setStreakModal] = useState(false);
  // Long emails (esp. Apple private-relay …@privaterelay.appleid.com) are
  // truncated by default in the personal-info row; tap to expand/collapse.
  const [emailExpanded, setEmailExpanded] = useState(false);
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
    staleTime: 5 * 60_000,
  });

  // Refetch gamification stats when the profile tab regains focus — catches
  // admin-edited badge definitions & freshly-awarded XP/levels without needing
  // a new app build. Cheap: single network call, already memoized for 10s.
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) gamificationQuery.refetch();
    }, [isAuthenticated, gamificationQuery])
  );

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

  // Badge titles render at the SAME caption size as the impact-stat labels
  // above — no per-badge shrinking (that made long titles visibly smaller
  // than their neighbours, breaking the page's font consistency). Instead, if
  // a badge's longest word wouldn't fit on one line at that size, only THAT
  // badge's card widens just enough so the word never breaks mid-word. Short
  // badges keep the default width; multi-word titles still wrap to a second
  // line at a word boundary.
  const BADGE_FONT_SIZE = theme.typography.caption.fontSize; // = impact cards
  const BADGE_BASE_WIDTH = 100;
  const BADGE_MAX_WIDTH = 260;
  const badgeCardWidth = (title: string): number => {
    // Poppins advance per pt. Bumped from 0.62 → 0.78 because the previous
    // multiplier was an UNDER-estimate: "Premier Sauvetage" (longest word
    // 9 chars) computed to ~94 px and fell back to the 100 px base width,
    // but actually rendered at ~110 px which then broke "Sauvetage" mid-
    // character. 0.78 is the measured average for Poppins_400Regular at
    // caption size; the +12 px tail is belt-and-suspenders for Android
    // text rendering, which sometimes adds a few sub-pixel grid pixels
    // to the advance. Together they keep the heuristic safely above the
    // actual render width.
    const charPerPx = 0.78;
    const safetyPx = 12;
    const pad = theme.spacing.lg;
    let longestWordLen = 0;
    for (const w of String(title).split(/\s+/)) {
      if (w.length > longestWordLen) longestWordLen = w.length;
    }
    const needed = Math.ceil(longestWordLen * BADGE_FONT_SIZE * charPerPx) + pad * 2 + safetyPx;
    return Math.min(BADGE_MAX_WIDTH, Math.max(BADGE_BASE_WIDTH, needed));
  };

  // Per-badge width override populated by the post-layout safety net:
  // onTextLayout returns the lines the renderer actually drew. If a word
  // got split mid-character (because the card was narrower than the word's
  // natural width), we compute the natural width from the rendered char
  // density and bump THAT badge's card width. Runs at most once per badge
  // because the next render fits the word and the override stays put.
  const [badgeWidthOverrides, setBadgeWidthOverrides] = useState<Record<string, number>>({});
  const handleBadgeTextLayout = (badgeId: string, label: string) => (e: any) => {
    const lines = e?.nativeEvent?.lines;
    if (!Array.isArray(lines) || lines.length < 2) return;
    // Concatenate rendered text. If the user-facing label can't be
    // reconstructed by joining the rendered lines (modulo whitespace), the
    // renderer broke a word mid-character.
    const rendered = lines.map((l: any) => String(l.text ?? '')).join('');
    const normalize = (s: string) => s.replace(/[\s\n]+/g, ' ').trim();
    if (normalize(rendered) === normalize(label)) return;
    const longestLine = lines.reduce((a: any, b: any) => (a.width >= b.width ? a : b));
    const chars = Math.max(1, String(longestLine.text ?? '').length);
    const charsPerPx = longestLine.width / chars;
    const longestWord = String(label).split(/\s+/).reduce((a, b) => (a.length >= b.length ? a : b), '');
    const naturalLongestWordPx = longestWord.length * charsPerPx;
    const needed = Math.ceil(naturalLongestWordPx) + theme.spacing.lg * 2 + 14;
    setBadgeWidthOverrides((prev) => {
      const current = prev[badgeId] ?? 0;
      if (current >= needed) return prev;
      return { ...prev, [badgeId]: Math.min(280, needed) };
    });
  };

  // Safety net — cross-check the backend's `meals_saved` against the local
  // count of reservations that actually reached a "picked_up" state. The
  // backend has historically counted reservations regardless of status,
  // which inflates badge progress (e.g. "Héros du Sauvetage / 50 repas
  // sauvés" unlocked at 23 confirmed pickups). When the two diverge by
  // more than 10% (and > 2 absolute), log a console warning so we can
  // catch backend regressions without touching the UI. Once the backend
  // fixes its count this stops firing.
  useEffect(() => {
    const gStats = gamificationQuery.data as any;
    const gStatsInner = gStats?.stats ?? gStats;
    const backendMealsSaved = gStatsInner?.meals_saved;
    if (backendMealsSaved == null) return;
    const reservations = reservationsQuery.data ?? [];
    const localPickupCount = reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'picked_up' || status === 'completed' || status === 'collected';
    }).length;
    const tolerance = Math.max(2, localPickupCount * 0.1);
    if (Math.abs(backendMealsSaved - localPickupCount) > tolerance) {
      console.warn(
        '[Badges] meals_saved mismatch — backend:', backendMealsSaved,
        'local pickup count:', localPickupCount,
        '— backend may be counting non-pickup reservations',
      );
    }
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

  // Level-up popup is owned by the (tabs)/_layout post-reservation
  // celebration ("Bien joué" banner). We used to ALSO fire a level-up
  // popup here whenever stats.level increased — but because the profile
  // tab stays mounted in the tab navigator, that effect ran in parallel
  // with the layout's celebration and showed the same popup a second
  // time (especially noticeable on Android). The layout effect is the
  // single source of truth now.

  // Step-driven re-measurement of the "Crédits Barakeat" row. The row's own
  // onLayout fires only on layout changes, so a measurement taken at mount
  // can go stale by the time the walkthrough reaches this step (avatar /
  // stats data loads in, level-up modal animates, etc). When the
  // walkthrough advances to `walletBalance`, refresh the rect from the ref
  // so the halo lands precisely on the credits card. Mirrors the
  // map-button / notif-bell pattern in (tabs)/_layout.tsx.
  const creditsRowRef = useRef<View>(null);
  // Reset Profile's scroll position before the credits halo measures, so the
  // step always lands the halo at the same coordinates regardless of where
  // the user happened to be scrolled when they started the demo. (tab
  // screens preserve scroll position across navigation, so without this the
  // halo can land at the pre-scroll y of the credits row.)
  const mainScrollRef = useRef<ScrollView>(null);
  // Belt-and-braces: also reset at the MOMENT the demo arms (under the
  // welcome cover), not only when the credits step is reached. Covers the
  // case where the user scrolled profile down, triggered the demo, and the
  // demo touches profile via an earlier step than walletBalance — that
  // earlier step would otherwise inherit the pre-demo scroll offset.
  const demoSequencePending = useWalkthroughStore((s) => s.demoSequencePending);
  useEffect(() => {
    if (!demoSequencePending) return;
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [demoSequencePending]);
  const walkthroughKey = useWalkthroughStore((s) => s.currentStep?.measureKey);
  useEffect(() => {
    if (walkthroughKey !== 'walletBalance') return;
    // Clear the prior rect first so the layout overlay paints dim-only
    // during the scroll-and-settle window — the user reported seeing the
    // halo briefly land at the pre-scroll y before the re-measure snapped
    // it into place. The credits row is always mounted on profile, so the
    // 200 ms re-measure is guaranteed to fire and republish a fresh rect.
    useWalkthroughStore.getState().setMeasuredRect('walletBalance', null);
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    const t = setTimeout(() => {
      creditsRowRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('walletBalance', { x, y, w, h });
      });
    }, 200);
    return () => clearTimeout(t);
  }, [walkthroughKey]);

  const leaderboardScrollRef = useRef<ScrollView>(null);

  const myLeaderboardIndex = useMemo(() => {
    const entries = leaderboardQuery.data ?? [];
    return entries.findIndex((e) => String(e.user_id) === String(user?.id));
  }, [leaderboardQuery.data, user?.id]);

  // Profile-page leaderboard preview = at most 5 rows centered on the user,
  // or top 5 if they're near the top. The "Voir plus" button below the
  // preview routes to the full /leaderboard screen instead of expanding
  // inline — so there's no expand/collapse state on this surface anymore.
  const leaderboardData = useMemo(() => {
    const entries = leaderboardQuery.data ?? [];
    if (myLeaderboardIndex >= 0) {
      const start = Math.max(0, myLeaderboardIndex - 2);
      const end = Math.min(entries.length, start + 5);
      return entries.slice(start, end);
    }
    return entries.slice(0, 5);
  }, [leaderboardQuery.data, myLeaderboardIndex]);

  // Leaderboard privacy: a single opt-in switch controls BOTH appearing on the
  // leaderboard and being allowed to view it (reciprocity). Defaults to true
  // (visible) to preserve existing behaviour; users can opt out here or in
  // Settings. Source of truth is the backend (`show_in_leaderboard`), surfaced
  // through the gamification-stats query.
  const queryClient = useQueryClient();
  // Local optimistic override — when set, takes priority over the server
  // snapshot so the Switch reflects the user's intent immediately on tap
  // and stays put while the PUT is in flight. Reset to null when the
  // server confirms (or when we accept the previous server state on
  // error). Without this, every transient Network Error would snap the
  // toggle back to the previous position before the user could read the
  // alert, which the user reported as "the toggle keeps failing".
  const [optimisticVisible, setOptimisticVisible] = useState<boolean | null>(null);
  const serverVisible = (gamificationQuery.data as any)?.show_in_leaderboard !== false;
  const leaderboardVisible = optimisticVisible ?? serverVisible;
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const handleToggleLeaderboard = useCallback(async (next: boolean) => {
    setOptimisticVisible(next);
    setVisibilitySaving(true);
    try {
      await updateLeaderboardVisibility(next);
      // Server accepted — invalidate so the next render reads the fresh
      // server snapshot, then drop the local override.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['gamification-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
      ]);
      setOptimisticVisible(null);
    } catch (err: any) {
      // Tear down the optimistic state so the Switch snaps back to the
      // server's actual position. Prefer the specific backend message via
      // getErrorMessage; suffix with HTTP status when api.ts attached one
      // so persistent infra issues stay diagnosable.
      setOptimisticVisible(null);
      const status = err?.status ?? err?.response?.status;
      const base = getErrorMessage(err);
      const detail = status ? `${base} (${status})` : base;
      Alert.alert(t('common.error'), detail);
    } finally {
      setVisibilitySaving(false);
    }
  }, [queryClient, t]);

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
    } catch (err) {
      setToastMsg({ type: 'error', text: getErrorMessage(err) });
    }
  };

  const scrollY = useRef(new Animated.Value(0)).current;
  const headerBg = scrollY.interpolate({ inputRange: [0, 30], outputRange: ['transparent', '#ffffff'], extrapolate: 'clamp' });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <ScrollView
        ref={mainScrollRef}
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
            {/* Initials avatar — replaces the generic User glyph.
                Card is already brand-green (#114b3c via primary), so
                we INVERT the requested palette to keep contrast: the
                circle uses the lime accent (#e3ff5c) and the initials
                are drawn in the same dark green. Same letters
                everywhere (settings, business interface) — read as
                "this is you" instantly. */}
            <View style={[styles.userAvatar, { backgroundColor: '#e3ff5c', borderRadius: 30, width: 60, height: 60, borderWidth: 0, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#114b3c', fontSize: 22, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 0.5 }}>
                {(() => {
                  const raw = String(user?.name ?? '').trim();
                  if (raw) {
                    const parts = raw.split(/\s+/).filter(Boolean);
                    const first = parts[0]?.charAt(0) ?? '';
                    const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
                    const initials = (first + last).toUpperCase();
                    if (initials) return initials;
                  }
                  return (user?.email ?? '?').charAt(0).toUpperCase();
                })()}
              </Text>
            </View>
            <View style={[styles.userInfo, { marginLeft: 14 }]}>
              <Text style={[{ color: '#fff', ...theme.typography.h2, fontFamily: 'Poppins_700Bold' }]} numberOfLines={1}>
                {user?.name ?? 'Utilisateur'}
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
          ref={creditsRowRef as any}
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('walletBalance', { x, y, w, h });
            });
          }}
          onPress={() => router.push('/wallet' as never)}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.r14, padding: 16, marginBottom: theme.spacing.lg, ...theme.shadows.shadowSm }}
          activeOpacity={0.7}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#114b3c15', justifyContent: 'center', alignItems: 'center' }}>
            <CreditCard size={18} color="#114b3c" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{t('wallet.credits', { defaultValue: 'Mes crédits' })}</Text>
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>{t('wallet.earnCreditsShort', { defaultValue: 'Gagnez et utilisez des crédits' })}</Text>
          </View>
          <ChevronRight size={18} color={theme.colors.muted} />
        </TouchableOpacity>

        {/* Stats Row */}
        <View style={{ marginBottom: theme.spacing.xxl, overflow: 'visible' }}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
          {t('impact.myImpact', { defaultValue: 'Mon impact' })}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ overflow: 'visible' }} contentContainerStyle={{ gap: 10, paddingRight: theme.spacing.xl, paddingHorizontal: 4, paddingVertical: 6 }}>
          <TouchableOpacity onPress={() => setStatModal('money')} accessibilityLabel={`${stats.moneySaved.toFixed(0)} ${t('common.currency', { defaultValue: 'TND' })} ${t('profile.moneySaved')}`} accessibilityRole="button" style={{ width: 110, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.md, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Banknote size={18} color={theme.colors.primary} />
            </View>
            <Text numberOfLines={2} style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.moneySaved.toFixed(0)} {t('common.currency', { defaultValue: 'TND' })}
            </Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={2} textBreakStrategy="simple" style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {twoLineLabel(t('profile.moneySaved'))}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('co2')} accessibilityLabel={`${stats.co2Saved.toFixed(1)} kg ${t('profile.co2Saved')}`} accessibilityRole="button" style={{ width: 110, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.md, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.accentFresh + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Leaf size={18} color={theme.colors.accentFresh} />
            </View>
            <Text numberOfLines={2} style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.co2Saved.toFixed(1)} kg
            </Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={2} textBreakStrategy="simple" style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {twoLineLabel(t('profile.co2Saved'))}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('baskets')} accessibilityLabel={`${stats.basketsBought} ${t('profile.basketsBought')}`} accessibilityRole="button" style={{ width: 110, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.md, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.secondary + '30', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <ShoppingBag size={18} color={theme.colors.primaryDark} />
            </View>
            <Text numberOfLines={2} style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.basketsBought}
            </Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={2} textBreakStrategy="simple" style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {twoLineLabel(t('profile.basketsBought'))}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStatModal('spots')} accessibilityLabel={`${stats.businessesTried} ${t('profile.businessesTried', { defaultValue: 'Places Tried' })}`} accessibilityRole="button" style={{ width: 110, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.md, alignItems: 'center', ...theme.shadows.shadowSm }}>
            <View style={[styles.statIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
              <Store size={18} color={theme.colors.primary} />
            </View>
            <Text numberOfLines={2} style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8, textAlign: 'center' }]}>
              {stats.businessesTried}
            </Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.6} numberOfLines={2} textBreakStrategy="simple" style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' }]}>
              {twoLineLabel(t('profile.businessesTried', { defaultValue: 'Places Tried' }))}
            </Text>
          </TouchableOpacity>
        </ScrollView>
        </View>

        {/* Badges Section */}
        <View style={{ marginBottom: theme.spacing.xl, overflow: 'visible' }}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('impact.myBadges', { defaultValue: 'Mes badges' })}
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
              const badgeColor = badge.unlocked ? getBadgeColor(bid) : theme.colors.muted;
              const badgeName = badge.nameKey
                ? t(`badges.${badge.nameKey}`, { defaultValue: badge.name ?? bid })
                : badge.name ?? bid;
              const badgeLabel = badge.unlocked ? badgeName : t('impact.locked');
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
                      // Pick the LARGER of the heuristic estimate and the
                      // post-layout measured width — so the card always
                      // fits the actual rendered text regardless of font
                      // metrics on the current device.
                      width: Math.max(badgeCardWidth(badgeLabel), badgeWidthOverrides[badge.id] ?? 0),
                      ...theme.shadows.shadowSm,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.badgeCircle,
                      {
                        backgroundColor: badge.unlocked
                          ? badgeColor + '22'
                          : theme.colors.divider,
                        borderRadius: 28,
                        width: 56,
                        height: 56,
                      },
                    ]}
                  >
                    <BadgeIcon
                      size={24}
                      color={badgeColor}
                    />
                  </View>
                  <Text
                    numberOfLines={2}
                    textBreakStrategy="balanced"
                    onTextLayout={handleBadgeTextLayout(badge.id, badgeLabel)}
                    style={[
                      {
                        color: badge.unlocked
                          ? theme.colors.textPrimary
                          : theme.colors.muted,
                        ...theme.typography.caption,
                        // Fixed caption size for every badge (matches the
                        // impact-stat labels) — the card widens instead of the
                        // text shrinking. See `badgeCardWidth` above.
                        fontSize: BADGE_FONT_SIZE,
                        lineHeight: BADGE_FONT_SIZE + 4,
                        marginTop: theme.spacing.sm,
                        textAlign: 'center' as const,
                      },
                    ]}
                  >
                    {badgeLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Leaderboard Section */}
        <View style={{ marginBottom: theme.spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {t('impact.leaderboard')}
            </Text>
            {leaderboardVisible && (
              <TouchableOpacity
                onPress={() => router.push('/leaderboard' as any)}
                accessibilityLabel={t('impact.leaderboard')}
                accessibilityRole="button"
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              >
                <ChevronRight size={20} color={theme.colors.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Opt-in/out switch — a single control gating BOTH appearing on the
              leaderboard and viewing it. Kept subtle here (a plain muted row,
              no card); the full disclosure lives in Settings > Privacy.
              Margins are tighter than the standard spacing.md so the toggle
              sits closer to the "Classement" subtitle above AND the leaderboard
              table below — the previous breathing room made the section feel
              fragmented. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: -theme.spacing.xs, marginBottom: theme.spacing.xs, paddingHorizontal: 2 }}>
            <Text style={{ flex: 1, color: theme.colors.muted, ...theme.typography.caption, paddingRight: 10 }}>
              {t('impact.leaderboardVisibility', { defaultValue: 'Apparaître dans le classement' })}
            </Text>
            <Switch
              value={leaderboardVisible}
              disabled={visibilitySaving}
              onValueChange={handleToggleLeaderboard}
              style={{ transform: [{ scale: 0.75 }] }}
              trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
              thumbColor={leaderboardVisible ? '#fff' : (Platform.OS === 'android' ? theme.colors.surface : undefined)}
              ios_backgroundColor={theme.colors.divider}
              accessibilityLabel={t('impact.leaderboardVisibility', { defaultValue: 'Apparaître dans le classement' })}
              accessibilityRole="switch"
            />
          </View>

          {!leaderboardVisible ? (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, alignItems: 'center' as const, ...theme.shadows.shadowSm }}>
              <Trophy size={32} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: theme.spacing.sm, textAlign: 'center' as const }}>
                {t('impact.leaderboardHidden', { defaultValue: 'Activez le classement ci-dessus pour participer et voir où vous vous situez.' })}
              </Text>
            </View>
          ) : leaderboardQuery.isLoading ? (
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
              <ScrollView ref={leaderboardScrollRef} nestedScrollEnabled showsVerticalScrollIndicator={false}>
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
                        {entry.meals_saved} {entry.meals_saved === 1 ? t('impact.basket', { defaultValue: 'panier' }) : t('impact.baskets', { defaultValue: 'paniers' })}
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
                  onPress={() => router.push('/leaderboard' as any)}
                  accessibilityLabel={t('impact.showMore')}
                  accessibilityRole="button"
                >
                  <Text style={{ color: theme.colors.primary, ...theme.typography.button }}>
                    {t('impact.showMore')}
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
            {/* Read-only: name + gender are edited from Settings → identity card. */}
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
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
              {user?.name ?? '-'}
            </Text>
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
            {/* Truncated by default with a comfortable gap from the "Email"
                label; tap to expand the full address (e.g. a long private-relay
                email) and tap again to collapse. */}
            <TouchableOpacity
              onPress={() => setEmailExpanded((v) => !v)}
              activeOpacity={0.7}
              style={{ flexShrink: 1, marginLeft: 24 }}
            >
              <Text
                style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const, textAlign: 'right' as const }]}
                numberOfLines={emailExpanded ? undefined : 1}
                ellipsizeMode="middle"
              >
                {user?.email ?? '-'}
              </Text>
            </TouchableOpacity>
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
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
              {(user as any)?.gender === 'male' ? t('profile.genderMale', { defaultValue: 'Male' })
                : (user as any)?.gender === 'female' ? t('profile.genderFemale', { defaultValue: 'Female' })
                : t('profile.genderNotSet', { defaultValue: 'Not set' })}
            </Text>
          </View>
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

      {/* Stat Modal — orders-page design language: green hero panel with
          uppercase 11px label + big white number, then a preview list using
          the rich icon-circle pattern (#114b3c bg + #e3ff5c icon), then a
          yellow "Voir plus" CTA. */}
      <Modal visible={statModal !== null} transparent animationType="none" statusBarTranslucent onRequestClose={closeStatModal}>
        <Animated.View style={{ flex: 1, opacity: statModalAnim }}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeStatModal}>
          <Animated.View
            style={[styles.modalContent, {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r24,
              padding: theme.spacing.lg,
              ...theme.shadows.shadowLg,
              maxHeight: '75%',
              width: '100%',
              transform: [{ scale: statModalAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
            }]}
            onStartShouldSetResponder={() => true}
          >
            <TouchableOpacity
              onPress={closeStatModal}
              style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center', zIndex: 1 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
              accessibilityRole="button"
            >
              <X size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>

            {/* Green hero panel — matches the orders page Impact slide */}
            {(() => {
              const heroIcon = statModal === 'money' ? Banknote
                : statModal === 'co2' ? Leaf
                : statModal === 'baskets' ? ShoppingBag
                : Store;
              const HeroIcon = heroIcon;
              const titleText = statModal === 'money' ? t('profile.moneySaved')
                : statModal === 'co2' ? t('profile.co2Saved')
                : statModal === 'baskets' ? t('profile.basketsBought')
                : t('profile.businessesTried', { defaultValue: 'Places Tried' });
              const valueText = statModal === 'money' ? `${stats.moneySaved.toFixed(0)} ${t('common.currency', { defaultValue: 'TND' })}`
                : statModal === 'co2' ? `${stats.co2Saved.toFixed(1)} kg`
                : statModal === 'baskets' ? String(stats.basketsBought)
                : String(stats.businessesTried);
              return (
                <View style={{
                  backgroundColor: '#114b3c',
                  borderRadius: theme.radii.r16,
                  padding: 20,
                  marginTop: theme.spacing.sm,
                  marginBottom: theme.spacing.lg,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#e3ff5c20', justifyContent: 'center', alignItems: 'center' }}>
                    <HeroIcon size={22} color="#e3ff5c" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      color: 'rgba(255,255,255,0.7)',
                      fontSize: 11,
                      fontFamily: 'Poppins_600SemiBold',
                      fontWeight: '600',
                      letterSpacing: 0.6,
                      textTransform: 'none',
                      marginBottom: 4,
                    }}>
                      {titleText}
                    </Text>
                    <Text style={{ color: '#fff', ...theme.typography.h1 }}>
                      {valueText}
                    </Text>
                  </View>
                </View>
              );
            })()}

            {/* Data preview — top 3 relevant items, rich icon-circle pattern */}
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: '100%' }}>
            {(() => {
              const completed = (reservationsQuery.data ?? []).filter((r) => {
                const s = (r.status ?? '').toLowerCase();
                return s === 'collected' || s === 'completed' || s === 'picked_up';
              });

              if (statModal === 'spots') {
                const spotMap = new Map<string, { name: string; logo?: string; count: number }>();
                completed.forEach((r: any) => {
                  const name = r.restaurant_name ?? r.restaurant?.name ?? r.basket?.merchantName ?? '';
                  // `/my/reservations` returns the org logo as the top-level
                  // `restaurant_image` (= o.image_url JOIN). The older
                  // chained reads (r.restaurant?.image_url etc.) never match
                  // that shape, so the popup was always falling through to
                  // the generic green Store icon. Including restaurant_image
                  // in the fallback chain lets the real brand logo render.
                  const logo = r.restaurant_image
                    ?? r.restaurant?.image_url
                    ?? r.org_image_url
                    ?? r.basket?.merchantLogo
                    ?? null;
                  if (!name) return;
                  const existing = spotMap.get(name);
                  if (existing) {
                    existing.count += 1;
                    // First non-empty logo wins so a later reservation
                    // missing the field can't blank out an org we already
                    // matched.
                    if (!existing.logo && logo) existing.logo = logo;
                  } else {
                    spotMap.set(name, { name, logo, count: 1 });
                  }
                });
                const spots = Array.from(spotMap.values()).sort((a, b) => b.count - a.count).slice(0, 3);
                return spots.length > 0 ? (
                  <View style={{ width: '100%', marginBottom: theme.spacing.md }}>
                    {spots.map((s, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.colors.divider }}>
                        {s.logo ? (
                          <Image
                            source={{ uri: s.logo }}
                            style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.bg }}
                          />
                        ) : (
                          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                            <Store size={13} color="#e3ff5c" />
                          </View>
                        )}
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1, marginLeft: 12 }} numberOfLines={1}>{s.name}</Text>
                        <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' }}>
                          {t('profile.orderCount', { count: s.count, defaultValue: '{{count}} commande(s)' })}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null;
              }

              if (statModal === 'baskets' || statModal === 'money' || statModal === 'co2') {
                // Light-touch encouragement copy instead of a recent-orders
                // list — Yassine asked us to lighten this section. Per-order
                // CO2 / money facts now live on the order cards themselves
                // (see OrderCard), and the box just celebrates the total.
                const value = statModal === 'money' ? stats.moneySaved
                  : statModal === 'co2' ? stats.co2Saved
                  : stats.basketsBought;
                const tier = statModal === 'money'
                  ? (value < 10 ? 'low' : value < 50 ? 'mid' : 'high')
                  : statModal === 'co2'
                  ? (value < 5 ? 'low' : value < 25 ? 'mid' : 'high')
                  : (value < 5 ? 'low' : value < 25 ? 'mid' : 'high');
                const valueStr = statModal === 'money' ? value.toFixed(0)
                  : statModal === 'co2' ? value.toFixed(1)
                  : String(value);
                return (
                  <View style={{ width: '100%', paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.sm }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, textAlign: 'center', lineHeight: 22 }}>
                      {/* `count` drives i18next singular/plural — only the baskets
                          "low" tier has _one/_other variants (1 panier vs paniers);
                          the other copies fall back to their base key. */}
                      {t(`impact.copy.${statModal}.${tier}`, { value: valueStr, count: value })}
                    </Text>
                  </View>
                );
              }

              return null;
            })()}
            </ScrollView>

            {/* See more — only for "spots" (commerces essayés) where the full
                list is genuinely useful. CO2/money/baskets are summarised by
                the encouragement copy above, no list to expand to. The
                threshold counts UNIQUE merchants (matching the list shown
                above, which dedupes by name) — not total reservations —
                so a customer with 4 orders from the same shop doesn't see
                a misleading "Voir plus" leading to a single-item screen. */}
            {statModal === 'spots' && (() => {
              const uniqueNames = new Set<string>();
              (reservationsQuery.data ?? []).forEach((r: any) => {
                const s = (r.status ?? '').toLowerCase();
                if (s !== 'collected' && s !== 'completed' && s !== 'picked_up') return;
                const name = r.restaurant_name ?? r.restaurant?.name ?? r.basket?.merchantName ?? '';
                if (name) uniqueNames.add(name);
              });
              return uniqueNames.size > 3;
            })() && (
              <TouchableOpacity
                onPress={() => { const type = statModal; setStatModal(null); router.push({ pathname: '/stat-detail', params: { type: type ?? '' } } as never); }}
                style={{
                  backgroundColor: '#e3ff5c',
                  borderRadius: theme.radii.r12,
                  paddingVertical: 12,
                  paddingHorizontal: 18,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: theme.spacing.xs,
                  gap: 6,
                }}
              >
                <Text style={{ color: '#114b3c', ...theme.typography.bodySm, fontWeight: '700' }}>
                  {t('common.seeMore', { defaultValue: 'Voir plus' })}
                </Text>
                <ChevronRight size={16} color="#114b3c" />
              </TouchableOpacity>
            )}
          </Animated.View>
        </TouchableOpacity>
        </Animated.View>
      </Modal>

      {/* Badge Modal */}
      <Modal visible={badgeModal !== null} transparent animationType="fade" onRequestClose={() => setBadgeModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setBadgeModal(null)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignItems: 'center', ...theme.shadows.shadowLg }]} onStartShouldSetResponder={() => true}>
            <TouchableOpacity
              onPress={() => setBadgeModal(null)}
              style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center', zIndex: 1 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
              accessibilityRole="button"
            >
              <X size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
            {(() => {
              // Render from the sticky value so the card stays populated while
              // the modal fades closed (see lastBadgeRef above).
              const bm = badgeModal ?? lastBadgeRef.current;
              if (!bm) return null;
              const bid = bm.badge_id ?? bm.id;
              const BadgeIcon = bm.unlocked ? getBadgeIcon(bid) : Lock;
              // Same per-badge accent as the badge cards on the profile grid, so
              // tapping a badge opens a popup whose icon color matches the card.
              const badgeColor = bm.unlocked ? getBadgeColor(bid) : theme.colors.muted;
              const badgeName = bm.nameKey
                ? t(`badges.${bm.nameKey}`, { defaultValue: bm.name ?? bid })
                : bm.name ?? bid;
              return (
                <>
                  <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: bm.unlocked ? badgeColor + '22' : theme.colors.divider, justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.lg }}>
                    <BadgeIcon size={32} color={badgeColor} />
                  </View>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: theme.spacing.sm }]}>
                    {bm.unlocked ? badgeName : t('impact.locked')}
                  </Text>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center' }]}>
                    {bm.unlocked
                      ? (bm.descKey ? t(`badges.${bm.descKey}`, { defaultValue: t('badges.newBadge') }) : t('badges.newBadge'))
                      : t('badges.lockedDesc')}
                  </Text>
                </>
              );
            })()}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Level Modal */}
      <Modal visible={levelModal} transparent animationType="fade" onRequestClose={() => setLevelModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setLevelModal(false)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignItems: 'center', ...theme.shadows.shadowLg }]} onStartShouldSetResponder={() => true}>
            <TouchableOpacity
              onPress={() => setLevelModal(false)}
              style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center', zIndex: 1 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
              accessibilityRole="button"
            >
              <X size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.secondary, justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.lg }}>
              <Zap size={32} color={theme.colors.primaryDark} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center', marginBottom: theme.spacing.sm }]}>
              {t('impact.level', { level: String(stats.level) })}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center' }]}>
              {t('impact.xpProgress', { current: stats.xpInLevel, next: stats.xpBandSize })}
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Streak Modal */}
      <Modal visible={streakModal} transparent animationType="fade" onRequestClose={() => setStreakModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setStreakModal(false)}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, alignItems: 'center', ...theme.shadows.shadowLg }]} onStartShouldSetResponder={() => true}>
            <TouchableOpacity
              onPress={() => setStreakModal(false)}
              style={{ position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center', zIndex: 1 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('common.close', { defaultValue: 'Close' })}
              accessibilityRole="button"
            >
              <X size={18} color={theme.colors.textSecondary} />
            </TouchableOpacity>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#FF6B35' + '18', justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.lg }}>
              <Flame size={32} color="#FF6B35" />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center', marginBottom: theme.spacing.xs }]}>
              {stats.currentStreak} {t('streak.days', { count: stats.currentStreak })}
            </Text>
            {/* Streak info rows */}
            <View style={{ width: '100%', marginTop: theme.spacing.md, gap: 8 }}>
              {stats.longestStreak > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('streak.longest')}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>{stats.longestStreak} {t('streak.daysUnit', { count: stats.longestStreak })}</Text>
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
                  const daysLeft = stats.daysUntilStreakExpiry;
                  const dateStr = expiryDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  return (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>
                        {t('streak.expires', { defaultValue: 'Expire' })}
                      </Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: isExpiringSoon ? theme.colors.error : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                          {t('streak.expiresOn', { date: dateStr, defaultValue: `Expire le ${dateStr}` })}
                        </Text>
                        {daysLeft != null && (
                          <Text style={{ color: daysLeft <= 3 ? theme.colors.error : theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 2 }}>
                            {daysLeft === 0
                              ? t('streak.expiresSoon')
                              : t('streak.expiresInDays', { count: daysLeft, defaultValue: `dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}` })}
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

      {/* Success / Error toast modal */}
      <Modal visible={!!toastMsg} transparent animationType="fade" onRequestClose={() => setToastMsg(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: toastMsg?.type === 'success' ? '#114b3c18' : '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              {toastMsg?.type === 'success'
                ? <CheckCircle2 size={28} color="#114b3c" />
                : <BarakeatErrorIcon size={28} color="#ef4444" />}
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
