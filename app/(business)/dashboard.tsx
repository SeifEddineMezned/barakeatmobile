import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Dimensions, Image, Animated as RNAnimated, PanResponder, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ShoppingBag, Banknote, Clock, Leaf, Star, X, Package, Store, Settings, Bell, ChevronDown, Check, Building2, MapPin, MessageCircle, Flag, ChevronRight } from 'lucide-react-native';
import { reportReview, ReviewReportReason } from '@/src/services/reviews';
import { NoLocationCTA } from '@/src/components/NoLocationCTA';
import { ModalCard } from '@/src/components/ui/ModalCard';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { Plus } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useStatusBarStyleOnFocus } from '@/src/hooks/useStatusBarStyleOnFocus';
import { useAuthStore } from '@/src/stores/authStore';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { fetchStats, fetchTodayOrders, fetchAnalytics, fetchMyProfile, fetchMyBaskets, type BusinessBasketFromAPI } from '@/src/services/business';
import { fetchConversations } from '@/src/services/messages';
import { fetchMyContext, fetchOrganizationDetails } from '@/src/services/teams';
import { apiClient } from '@/src/lib/api';
import { resolveTodayWeeklyHours } from '@/src/utils/timezone';
import { isPendingReservationActive } from '@/src/utils/orderExpiry';
import { usePollWhenForegrounded } from '@/src/hooks/usePollWhenFocused';
import { orderIdToCode } from '@/src/utils/orderCode';
import { formatLocationName } from '@/src/utils/formatLocation';
import { LineChart } from '@/src/components/LineChart';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { LinearGradient } from 'expo-linear-gradient';

const SCREEN_WIDTH = Dimensions.get('window').width;
// React Navigation's bottom-tabs header applies `marginHorizontal: 5` to its
// content row on iOS when the frame width is ≥ 414 (the IPAD_MINI_MEDIUM_WIDTH
// constant in @react-navigation/elements Header.tsx — also triggers on iPhone
// Pro Max 430pt widths). To keep the dashboard's custom floating header
// pixel-aligned with the nav-header version used by every other business tab,
// we shift the floating header inward by the same 5px on those screens.
const NAV_LARGE_MARGIN = Platform.OS === 'ios' && SCREEN_WIDTH >= 414 ? 5 : 0;

function AnimatedNumber({ value, suffix, duration = 800 }: { value: number; suffix?: string; duration?: number }) {
  const animVal = React.useRef(new RNAnimated.Value(0)).current;
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    animVal.setValue(0);
    RNAnimated.timing(animVal, {
      toValue: value,
      duration,
      useNativeDriver: false,
    }).start();

    const listener = animVal.addListener(({ value: v }) => {
      setDisplay(Math.round(v));
    });
    return () => animVal.removeListener(listener);
  }, [value]);

  return <>{display}{suffix ?? ''}</>;
}

function SimpleBarChart({ data, labels, color, stackData, stackColor }: { data: number[]; labels: string[]; color: string; stackData?: number[]; stackColor?: string }) {
  const theme = useTheme();
  const allMax = Math.max(...data.map((v, i) => v + (stackData?.[i] ?? 0)), 1);
  const barWidth = Math.min(26, (SCREEN_WIDTH - 140) / data.length - 10);

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {data.map((val, i) => {
          const stackVal = stackData?.[i] ?? 0;
          const total = val + stackVal;
          const height = Math.max(4, (total / allMax) * 100);
          const mainH = total > 0 ? (val / total) * height : 0;
          const stackH = total > 0 ? (stackVal / total) * height : 0;
          const isLast = i === data.length - 1;
          return (
            <View key={i} style={chartStyles.barCol}>
              {/* Value label above bar */}
              <Text style={{ color: total > 0 ? theme.colors.textSecondary : 'transparent', fontSize: 9, fontFamily: 'Poppins_600SemiBold', marginBottom: 3 }}>
                {total > 0 ? total : ''}
              </Text>
              <View style={[chartStyles.barBg, { height: 104, width: barWidth, borderRadius: 4, backgroundColor: theme.colors.primary + '08' }]}>
                <View style={{ flex: 1 }} />
                {stackData && (
                  <View style={{ height: stackH, backgroundColor: stackColor ?? theme.colors.secondary, borderTopLeftRadius: 4, borderTopRightRadius: 4, width: barWidth }} />
                )}
                <View style={{
                  height: mainH,
                  backgroundColor: color,
                  borderRadius: 4,
                  width: barWidth,
                  opacity: 0.85 + 0.15 * (val / allMax),
                }} />
              </View>
              <Text style={[{ color: theme.colors.muted, fontSize: 9, marginTop: 6, fontFamily: 'Poppins_400Regular', letterSpacing: 0.1 }]}>
                {labels[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    paddingTop: 4,
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  barCol: {
    alignItems: 'center',
  },
  barBg: {
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
});

function ReviewStarRow({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  // Read-only star display — mirrors customer-side StarRatingRow (app/review.tsx).
  // Rounded to nearest whole star; we also surface the numeric average at the right.
  const rounded = Math.round(value);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <View key={star} style={{ paddingHorizontal: 2 }}>
            <Star
              size={22}
              color={theme.colors.accentWarm}
              fill={star <= rounded ? theme.colors.accentWarm : 'transparent'}
            />
          </View>
        ))}
        {/* Numeric note to the right of the stars (parity with the customer popup). */}
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '700', marginLeft: 6, minWidth: 26, textAlign: 'right' }}>
          {value > 0 ? value.toFixed(1) : 'N/A'}
        </Text>
      </View>
    </View>
  );
}

function StatMiniCard({ icon: Icon, value, label, suffix, color, theme }: any) {
  return (
    <View style={[miniStyles.card, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16 }]}>
      {/* Subtle top-edge rule for visual framing */}
      <View style={{ height: 3, width: 24, backgroundColor: color, borderRadius: 2, marginBottom: 14 }} />
      <View style={[miniStyles.iconWrap, { backgroundColor: color + '12' }]}>
        <Icon size={15} color={color} strokeWidth={2.2} />
      </View>
      <Text style={[
        { color: theme.colors.textPrimary, fontSize: 22, fontFamily: 'Poppins_700Bold', marginTop: 12, letterSpacing: -0.5 },
      ]} numberOfLines={1} adjustsFontSizeToFit>
        {value}{suffix ? ` ${suffix}` : ''}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 3, fontFamily: 'Poppins_400Regular', letterSpacing: 0.1 }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const miniStyles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.045)',
    // soft consistent shadow
    shadowColor: '#114b3c',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default function BusinessDashboard() {
  const { t, i18n } = useTranslation();
  // BCP 47 locale tag derived from the user's app-language pick — fed to
  // every `toLocaleDateString` / `toLocaleTimeString` call below so day-of-
  // week and month formatting follows the current language instead of the
  // hardcoded 'fr-FR' the screen used to ship with.
  const dateLocale = i18n.language === 'ar' ? 'ar-TN' : i18n.language === 'en' ? 'en-GB' : 'fr-FR';
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const insets = useSafeAreaInsets();

  // Conversation unread badge for the chat icon in the dashboard pill.
  // Shares the ['conversations'] cache with the (business)/_layout header
  // and /business/conversations, so this query is essentially free — it
  // resolves to the same data structure either side renders. The badge
  // counts the NUMBER OF CONVERSATIONS with unread messages (1 conv =
  // 1 dot on the badge), matching what the conversations list shows.
  //
  // `usePollWhenForegrounded` pauses the poll when the app is in the
  // background. Without this gate the layout-level mount kept hitting
  // /conversations every 30 s with the phone in the user's pocket,
  // which on Railway's small instance contributed to the timeout-
  // shaped errors users were seeing on unrelated mutations.
  const dashboardConversationsRefetch = usePollWhenForegrounded(30_000);
  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    staleTime: 25_000,
    refetchInterval: dashboardConversationsRefetch,
    refetchOnWindowFocus: true,
  });
  const msgUnreadsTotal = React.useMemo(() => {
    const RECENT_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const convs = conversationsQuery.data ?? [];
    let count = 0;
    for (const c of convs) {
      const lastMs = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      if (lastMs > 0 && (now - lastMs) > RECENT_CUTOFF_MS) continue;
      if ((c.unread_count ?? 0) > 0) count++;
    }
    return count;
  }, [conversationsQuery.data]);

  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const setSelectedLocationId = useBusinessStore((s) => s.setSelectedLocationId);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [isSwitchingLocation, setIsSwitchingLocation] = useState(false);
  const switchSpinAnim = React.useRef(new RNAnimated.Value(0)).current;

  const handleLocationSwitch = React.useCallback((id: number | null) => {
    setShowLocationModal(false);
    setIsSwitchingLocation(true);
    switchSpinAnim.setValue(0);
    RNAnimated.loop(
      RNAnimated.timing(switchSpinAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
        easing: (t) => t,
      })
    ).start();
    setTimeout(() => {
      setSelectedLocationId(id);
      setIsSwitchingLocation(false);
      switchSpinAnim.stopAnimation();
    }, 700);
  }, [switchSpinAnim]);

  const statsQuery = useQuery({
    queryKey: ['business-stats', selectedLocationId],
    queryFn: () => fetchStats(selectedLocationId),
    staleTime: 60_000,
    retry: 1,
  });

  const analyticsQuery = useQuery({
    queryKey: ['business-analytics', selectedLocationId],
    queryFn: () => fetchAnalytics(selectedLocationId),
    staleTime: 60_000,
    retry: 1,
  });

  // Force a fresh stats fetch every time the dashboard regains focus.
  // The pickup-confirm flow in incoming-orders does invalidate
  // ['business-stats'] / ['business-analytics'] right after the
  // confirmPickup call, but on some backends the stats aggregation
  // lags the reservation status update by a beat — so the immediate
  // refetch can land back with the OLD revenue and stick. Refetching
  // on focus closes that gap reliably: by the time the user has
  // tapped to come back to the dashboard, the backend has caught up.
  // Same treatment for cancel / order-side flows that affect revenue.
  useFocusEffect(
    useCallback(() => {
      void statsQuery.refetch();
      void analyticsQuery.refetch();
      // Pull the latest reviews on focus too, so a rating the buyer
      // submitted while the merchant was on another tab lands in the
      // "Detail des notes" + "Commentaires récents" sections as soon as
      // they tap back to the dashboard. Without this the 60s staleTime
      // would leave both surfaces showing the pre-review averages and
      // comment list until the merchant left the tab idle past the
      // stale window, which the user reported as "the rating never
      // shows up".
      void reviewsQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedLocationId])
  );

  const todayQuery = useQuery({
    queryKey: ['today-orders', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Per-location pending-order count map — shares the cache key
  // ['today-orders-count'] with the always-mounted (business)/_layout
  // badge query, so React Query dedupes: one network fetch backs both
  // the nav-bar badge AND the per-location chips on the dashboard
  // dropdown. Same `isPendingReservationActive` predicate used by the
  // dashboard "En attente" tile, so the chip and tile numbers can
  // never disagree.
  const allLocationsTodayQuery = useQuery({
    queryKey: ['today-orders-count'],
    queryFn: () => fetchTodayOrders(null),
    staleTime: 30_000,
    refetchInterval: 45_000,
  });
  const pendingCountByLocation = React.useMemo(() => {
    const map = new Map<number, number>();
    for (const o of allLocationsTodayQuery.data ?? []) {
      if (!isPendingReservationActive(o)) continue;
      const lid = Number((o as any).location_id);
      if (!Number.isFinite(lid)) continue;
      map.set(lid, (map.get(lid) ?? 0) + 1);
    }
    return map;
  }, [allLocationsTodayQuery.data]);

  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 60_000,
    retry: 1,
  });

  const reviewsQuery = useQuery({
    queryKey: ['my-reviews', selectedLocationId, profileQuery.data?.id],
    queryFn: async () => {
      const profileData = profileQuery.data;
      const restaurantId = profileData?.id;
      if (!restaurantId) return null;
      const res = await apiClient.get(`/api/reviews/restaurant/${restaurantId}`);
      const data = res.data;
      const reviews = Array.isArray(data) ? data : (data as any)?.reviews ?? [];
      if (reviews.length === 0) return null;
      const avgService = reviews.reduce((s: number, r: any) => s + (r.rating_service ?? 0), 0) / reviews.length;
      const avgQuantity = reviews.reduce((s: number, r: any) => s + (r.rating_quantity ?? 0), 0) / reviews.length;
      const avgQuality = reviews.reduce((s: number, r: any) => s + (r.rating_quality ?? 0), 0) / reviews.length;
      const avgVariety = reviews.reduce((s: number, r: any) => s + (r.rating_variety ?? 0), 0) / reviews.length;
      return { service: avgService, quantite: avgQuantity, qualite: avgQuality, variete: avgVariety, count: reviews.length, reviews };
    },
    enabled: !!profileQuery.data?.id,
    staleTime: 60_000,
    retry: 1,
  });

  const analytics = analyticsQuery.data;
  const statsData = statsQuery.data;
  const todayOrders = todayQuery.data ?? [];

  // Show loader until ALL primary queries have either resolved or errored.
  // Using || (not &&) so one fast query resolving doesn't prematurely dismiss
  // the loader and fire animations with still-empty analytics/chart data.
  const hasAnyData = !!(statsQuery.data || analyticsQuery.data || profileQuery.data);
  const isLoading =
    !hasAnyData &&
    (statsQuery.isLoading || analyticsQuery.isLoading || todayQuery.isLoading || profileQuery.isLoading);

  // Compute average rating from all sources — fall back to reviewsQuery averages
  // so even a single user review shows the real score instead of '--'
  const reviewAvg = reviewsQuery.data
    ? ((reviewsQuery.data.service + reviewsQuery.data.quantite + reviewsQuery.data.qualite + reviewsQuery.data.variete) / 4)
    : null;

  // Defensive raw access — handles both camelCase and snake_case API responses.
  // The service layer already normalizes where possible; these local aliases
  // act as a second safety net in case of unexpected response shapes.
  const analyticsRaw = analytics as any;
  const statusBreakdown = analyticsRaw?.statusBreakdown ?? analyticsRaw?.status_breakdown ?? {};
  const weeklySeries: any[] = analyticsRaw?.weekly ?? [];
  const monthlySeries: any[] = analyticsRaw?.monthly ?? [];
  const summaryData = analyticsRaw?.summary ?? {};

  const stats = {
    // ─ Today ─────────────────────────────────────────────
    totalRevenue: summaryData?.revenue_today ?? statsData?.today_revenue ?? 0,
    totalBasketsSold: summaryData?.baskets_sold_today ?? statsData?.today_baskets ?? 0,
    // Filtered by the shared `isPendingReservationActive` predicate
    // (see src/utils/orderExpiry.ts). A naive status-only filter would
    // count stale rows whose pickup day already passed — /location/today
    // returns up to 14 days of active orders to support next-day
    // pickups, so the date check is mandatory.
    pendingOrders: todayOrders.filter((o: any) => isPendingReservationActive(o)).length,
    mealsRescued: summaryData?.pickups_today ?? 0,
    // ─ Overview ──────────────────────────────────────────
    activeBaskets: Number(statsData?.active_baskets || 0) || Number(profileQuery.data?.available_quantity || 0),
    averageRating: (statsData?.average_rating && statsData.average_rating > 0)
      ? statsData.average_rating
      : ((profileQuery.data?.average_rating && profileQuery.data.average_rating > 0)
        ? profileQuery.data.average_rating
        : (reviewAvg ?? 0)),
    // ─ Monthly totals ─────────────────────────────────────
    monthlyRevenue: statsData?.monthly_revenue ?? statsData?.total_revenue ?? 0,
    monthlyBaskets: statsData?.monthly_baskets ?? statsData?.total_completed ?? 0,
    totalOrders: statsData?.total_reservations ?? 0,
    totalCompleted: statsData?.total_completed ?? 0,
    totalCancelled: statsData?.total_cancelled ?? 0,
    // ─ Weekly chart (baskets + revenue per weekday) ───────
    dailySales: weeklySeries.map((d: any) => d.baskets_sold ?? 0),
    dailyRevenue: weeklySeries.map((d: any) => d.revenue ?? 0),
    // dayName may come as 'dayName' (camelCase) or 'day_name' (snake_case);
    // service normalizes but we guard here too.
    dailyLabels: weeklySeries.map((d: any) => {
      const raw = (d.dayName ?? d.day_name ?? d.day ?? '').toString();
      const short = raw.substring(0, 3);
      // Translate: "Mon"→"Lun", "Monday"→"Lun", etc.
      return t(`business.dashboard.days.${raw}`, { defaultValue: t(`business.dashboard.days.${short}`, { defaultValue: short }) });
    }),
    // ─ Monthly chart (baskets per month) ─────────────────
    monthlySales: monthlySeries.map((m: any) => m.baskets_sold ?? 0),
    monthlyLabels: monthlySeries.map((m: any) => {
      const raw = (m.monthName ?? m.month_name ?? m.month ?? '').toString();
      const short = raw.substring(0, 3);
      return t(`business.dashboard.months.${raw}`, { defaultValue: t(`business.dashboard.months.${short}`, { defaultValue: short }) });
    }),
    monthlyRevenueArr: monthlySeries.map((m: any) => m.revenue ?? 0),
    // ─ Status breakdown ───────────────────────────────────
    // API may send 'statusBreakdown' (camelCase) or 'status_breakdown' (snake_case).
    statusConfirmed: statusBreakdown?.confirmed ?? 0,
    statusPickedUp: statusBreakdown?.picked_up ?? 0,
    statusCancelled: statusBreakdown?.cancelled ?? 0,
  };

  const weeklyRevenueTotal = stats.dailyRevenue.reduce((a: number, b: number) => a + b, 0);

  const [showRatingModal, setShowRatingModal] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);

  // Report a customer review left on THIS business's location (UGC moderation).
  const [reviewReportTarget, setReviewReportTarget] = useState<{ id: number } | null>(null);
  const [reviewReportSubmitting, setReviewReportSubmitting] = useState(false);
  // null = show the reason picker; otherwise show the branded result screen.
  const [reviewReportResult, setReviewReportResult] = useState<'success' | 'already' | 'error' | null>(null);
  // When the merchant taps an ALREADY-flagged review, we open an info popup
  // (not the reason picker) showing what they reported it with + the status.
  const [reviewReportInfo, setReviewReportInfo] = useState<{ reason: string; at?: string | null } | null>(null);
  // Optimistic, session-only record of reviews reported during THIS session
  // (review id → reason + when). It layers on top of the authoritative
  // `my_report_reason` the reviews endpoint returns for the signed-in caller,
  // so the flag colours instantly before the post-report refetch lands and the
  // info popup has the reason even before the server round-trip.
  const [localReports, setLocalReports] = useState<Map<number, { reason: ReviewReportReason; at: string }>>(new Map());
  const markReviewFlagged = (id: number, reason: ReviewReportReason) => {
    setLocalReports((prev) => {
      const next = new Map(prev);
      next.set(id, { reason, at: new Date().toISOString() });
      return next;
    });
  };
  // Resolve a review's report info from the optimistic map first, then the
  // server field. Returns null when the caller hasn't reported it.
  const getReviewReport = (r: any): { reason: string; at?: string | null } | null => {
    const local = localReports.get(Number(r.id));
    if (local) return { reason: local.reason, at: local.at };
    if (r?.my_report_reason) return { reason: String(r.my_report_reason), at: r.my_report_at ?? null };
    return null;
  };
  const closeReviewReport = () => { setReviewReportTarget(null); setReviewReportResult(null); setReviewReportInfo(null); };

  const submitReviewReport = async (reason: ReviewReportReason) => {
    const target = reviewReportTarget;
    if (!target || reviewReportSubmitting) return;
    setReviewReportSubmitting(true);
    try {
      const { alreadyReported } = await reportReview(target.id, reason);
      markReviewFlagged(target.id, reason); // colour the flag immediately
      // Show a branded in-popup confirmation instead of the native Alert.
      setReviewReportResult(alreadyReported ? 'already' : 'success');
      // Pull the authoritative my_report_reason so the flag stays coloured
      // across refetches / re-opens / other devices.
      void reviewsQuery.refetch();
    } catch {
      setReviewReportResult('error');
    } finally {
      setReviewReportSubmitting(false);
    }
  };
  const REVIEW_REPORT_OPTIONS: { reason: ReviewReportReason; label: string }[] = [
    { reason: 'offensive', label: t('review.report.reasons.offensive', { defaultValue: 'Contenu offensant ou haineux' }) },
    { reason: 'spam', label: t('review.report.reasons.spam', { defaultValue: 'Spam ou publicité' }) },
    { reason: 'false_info', label: t('review.report.reasons.false_info', { defaultValue: 'Fausses informations' }) },
    { reason: 'personal_info', label: t('review.report.reasons.personal_info', { defaultValue: 'Données personnelles / vie privée' }) },
    { reason: 'other', label: t('review.report.reasons.other', { defaultValue: 'Autre' }) },
  ];
  const reviewReasonLabel = (reason: string) =>
    REVIEW_REPORT_OPTIONS.find((o) => o.reason === reason)?.label
    ?? t('review.report.reasons.other', { defaultValue: 'Autre' });
  const ratingSlideY = useRef(new RNAnimated.Value(400)).current;
  // Manually-driven backdrop opacity. With animationType="none" the Modal
  // unmounts instantly, so without this the dark dim would pop in/out hard.
  const ratingBackdropOpacity = useRef(new RNAnimated.Value(0)).current;
  // Velocity-projected, follow-finger dismiss. Same model as the shared
  // useSwipeToDismiss hook (just inlined here because this sheet has a
  // custom slide-in/out animation tied to ratingSlideY that we want to
  // share with the PanResponder).
  const ratingPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dy >= 0) ratingSlideY.setValue(g.dy);
        else ratingSlideY.setValue(g.dy / 3);
      },
      onPanResponderRelease: (_, g) => {
        const projection = g.dy + g.vy * 60;
        if (projection > 80 || g.vy > 0.6) {
          const duration = Math.max(120, Math.min(280, 220 - g.vy * 50));
          // Fade the backdrop in parallel with the velocity-projected slide
          // so the swipe-dismiss matches the X-button close visually.
          RNAnimated.parallel([
            RNAnimated.timing(ratingSlideY, { toValue: 800, duration, useNativeDriver: true }),
            RNAnimated.timing(ratingBackdropOpacity, { toValue: 0, duration, useNativeDriver: true }),
          ]).start(({ finished }) => { if (finished) setShowRatingModal(false); });
        } else {
          RNAnimated.spring(ratingSlideY, { toValue: 0, friction: 10, tension: 80, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => ratingSlideY.setValue(0),
    })
  ).current;
  useEffect(() => {
    if (showRatingModal) {
      // Open: slide content up + fade backdrop in, in parallel.
      RNAnimated.parallel([
        RNAnimated.spring(ratingSlideY, { toValue: 0, friction: 8, useNativeDriver: true }),
        RNAnimated.timing(ratingBackdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      // Reset to closed state — `closeRatingModal` already animated to these
      // values; this just guarantees the next open starts from a clean slate
      // even if the modal was force-closed via state without our helper.
      ratingSlideY.setValue(400);
      ratingBackdropOpacity.setValue(0);
    }
  }, [showRatingModal]);

  // Single animated-close path for the rating-details sheet. Slide-down +
  // backdrop-fade run in parallel; the modal unmounts when the slide finishes.
  // Routes every close source (X button, backdrop tap, Android back) through
  // the same animation so dismissals look identical.
  const closeRatingModal = () => {
    RNAnimated.parallel([
      RNAnimated.timing(ratingSlideY, { toValue: 400, duration: 220, useNativeDriver: true }),
      RNAnimated.timing(ratingBackdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) setShowRatingModal(false); });
  };

  const teamContextQuery = useQuery({
    queryKey: ['my-context'],
    queryFn: fetchMyContext,
    staleTime: 10_000,
    retry: 1,
    //refetchInterval: 15_000,
  });

  const orgId = teamContextQuery.data?.organization_id;

  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 300_000,
    retry: 1,
  });

  const orgLocations = orgDetailsQuery.data?.locations ?? [];

  // Baskets for the horizontal scroll — visible to all members
  const basketsQuery = useQuery({
    queryKey: ['my-baskets', selectedLocationId],
    queryFn: () => fetchMyBaskets(selectedLocationId),
    staleTime: 30_000,
  });
  const dashBaskets = (basketsQuery.data ?? []).filter((b: BusinessBasketFromAPI) => b.status !== 'deleted');

  const myDashRole = teamContextQuery.data?.role ?? '';
  const myDashLocationId = teamContextQuery.data?.location_id;
  // Every location this user belongs to. Prefer my-context (polled ~60s) so
  // remote membership changes propagate at the same cadence as permissions;
  // fall back to org-details and the primary membership for safety.
  const myDashLocationIds = React.useMemo<number[]>(() => {
    const ids = (teamContextQuery.data as any)?.location_ids;
    if (Array.isArray(ids) && ids.length > 0) return ids.map(Number);
    const uid = String(user?.id ?? '');
    const rows = (orgDetailsQuery.data?.members ?? []) as any[];
    const fromOrgDetails = new Set<number>();
    for (const m of rows) {
      if (String(m.user_id) === uid && m.location_id != null) fromOrgDetails.add(Number(m.location_id));
    }
    if (fromOrgDetails.size > 0) return Array.from(fromOrgDetails);
    return myDashLocationId != null ? [Number(myDashLocationId)] : [];
  }, [user?.id, orgDetailsQuery.data?.members, (teamContextQuery.data as any)?.location_ids, myDashLocationId]);
  const isAdmin = (myDashRole === 'admin' || myDashRole === 'owner') && myDashLocationIds.length === 0;
  // True for an org owner/admin who hasn't created a location yet — every
  // partner-screen short-circuits to a single "add your first location" CTA in
  // this state. Wait for orgDetails to finish loading so we don't briefly flash
  // the empty state on hydration.
  // "Ajoutez votre premier point de vente" popup. Lifted off the dashboard
  // surface (which used to render NoLocationCTA inline above the title) into
  // a centered modal that fires every time the dashboard regains focus while
  // the org has zero locations AND the walkthrough is not running — so the
  // demo can play out over a populated UI without the empty-state nudge
  // stepping on top of the walkthrough tooltips.
  //
  // Also gated on `splashDone` so the popup cannot paint over the bag-tip
  // splash animation: the Modal renders in its own native window and would
  // otherwise cover the splash regardless of zIndex. Same gate is applied
  // to both the state setter (we don't queue it during splash) AND the
  // Modal `visible` prop (belt-and-braces in case the state was already
  // true when splash started).
  const walkthroughStep = useWalkthroughStore((s) => s.step);
  const onboardingSequenceActive = useWalkthroughStore((s) => s.onboardingSequenceActive);
  const showDemoWelcome = useWalkthroughStore((s) => s.showDemoWelcome);
  // Reset dashboard scroll to top THE MOMENT any demo arms (under the
  // welcome cover, before any halo paints). Tab screens preserve scroll
  // across navigation, so a user who scrolled the dashboard down and then
  // triggered the demo would otherwise see every dashboard halo offset by
  // their pre-demo scroll position. Reported on the business side most often
  // because the dashboard's revenue/rating cards live well below the fold.
  const dashboardScrollRef = useRef<ScrollView>(null);
  const demoSequencePending = useWalkthroughStore((s) => s.demoSequencePending);
  useEffect(() => {
    if (!demoSequencePending) return;
    dashboardScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [demoSequencePending]);
  const splashDone = useSplashStore((s) => s.splashDone);
  // Race-proof gate. The popup is suppressed while ANY of these is true:
  //  • splash animation still playing (covered before),
  //  • the onboarding sequence is active (probe + carousel + demo cover +
  //    walkthrough — set by the probe in [_layout.tsx], cleared in
  //    endDemoSequence()),
  //  • the "Démarrer la démo" cover is up,
  //  • the interactive walkthrough is running (step !== null).
  // Without these, the dashboard popup races the probe on a brand-new
  // business signup and presents OVER the carousel because RN modals
  // always paint above plain React views — see the user report
  // "create location popup firing before onboarding".
  const popupBlocked = !splashDone
    || onboardingSequenceActive
    || showDemoWelcome
    || walkthroughStep !== null;
  const hasNoLocation = walkthroughStep === null
    && isAdmin
    && !!orgId
    && !orgDetailsQuery.isLoading
    && orgLocations.length === 0;
  const [showAddLocationPopup, setShowAddLocationPopup] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (hasNoLocation && !popupBlocked) {
        setShowAddLocationPopup(true);
      }
    }, [hasNoLocation, popupBlocked])
  );
  // Close the popup via STATE (never by yanking the native Modal's `visible`
  // prop) the instant it becomes blocked. The Modal's `visible` is now driven
  // ONLY by `showAddLocationPopup`; if we instead flipped `visible` off the
  // thrashing `popupBlocked` gate, a rapid present→dismiss could leave Android
  // with a GHOST modal layer that silently captured every touch — the "popup
  // flashed, then the dashboard froze and stayed frozen across restarts"
  // report (it recurred each launch because the org still had no location, so
  // the popup re-opened and re-closed abruptly every time). Closing through
  // state lets the Modal run its normal exit and tear down cleanly.
  useEffect(() => {
    if (popupBlocked && showAddLocationPopup) setShowAddLocationPopup(false);
  }, [popupBlocked, showAddLocationPopup]);
  // The switcher is tappable when there's an actual choice to make:
  // an org-admin in an org with 2+ locations (can jump to any one +
  // "Tous les emplacements"), or a member with 2+ assigned locations.
  // Single-location orgs / single-location members get the name as
  // static text with no chevron — opening a 1-row dropdown is noise.
  const canSwitchDashLocation =
    (isAdmin && orgLocations.length > 1) || myDashLocationIds.length > 1;
  const dashPerms = teamContextQuery.data?.permissions ?? {};
  const hasDashPerm = (key: string) => { const v = (dashPerms as any)[key]; return v === true || v === 'true' || v === 'write'; };
  const canViewHistory = isAdmin || hasDashPerm('view_history');
  // Org name is the source of truth for the hero greeting + switcher fallback.
  const orgName = teamContextQuery.data?.organization_name ?? orgDetailsQuery.data?.organization?.name ?? '';
  // Match the shared layout's switcher pill ([_layout.tsx:266-275]) — bare
  // location name only, no "Org -" prefix. The "All locations" admin branch
  // still falls back to org name, which the layout does too.
  const selectedLocationName = hasNoLocation
    ? t('business.locationSwitcher.noLocationYet')
    : selectedLocationId
      ? (orgLocations.find((l) => l.id === Number(selectedLocationId))?.name
          ?? `${t('business.location')} ${selectedLocationId}`)
      : (isAdmin
          ? (orgLocations.length > 0
              ? (orgName || t('business.allLocations'))
              : t('business.locationSwitcher.noLocationYet'))
          : (teamContextQuery.data?.location_name ?? t('business.team.locationLabel')));

  const reviews = reviewsQuery.data ?? { service: 0, quantite: 0, qualite: 0, variete: 0 };

  const handleRatingPress = useCallback(() => {
    setShowRatingModal(true);
  }, []);

  const chartWidth = SCREEN_WIDTH > 768 ? Math.min((SCREEN_WIDTH - 120) / 2, 400) : Math.min(SCREEN_WIDTH - 80, 320);

  // Status bar adapts to what's actually behind the icons. The cover photo is
  // dark/coloured for the first ~(200 + insets.top) px of scroll content; below
  // that the page is white. Flip the icons the moment the cover scrolls past
  // the status bar's bottom edge so the time/battery stay legible on both.
  //
  // These hooks MUST be declared above the `isLoading` early-return below.
  // React enforces a stable hook order across renders, and the loader return
  // (taken while the dashboard query is in flight) would otherwise skip them
  // — the next render with data would then execute three more hooks than the
  // previous one and crash with "Rendered more hooks than during the
  // previous render."
  const [coverInStatusBar, setCoverInStatusBar] = React.useState(true);
  const coverInStatusBarRef = React.useRef(true);
  const COVER_PIXEL_HEIGHT = 200; // matches the cover View's `height: 200 + insets.top` below
  const handleDashboardScroll = (e: any) => {
    const y = e.nativeEvent?.contentOffset?.y ?? 0;
    const covering = y < COVER_PIXEL_HEIGHT - 8;
    if (covering !== coverInStatusBarRef.current) {
      coverInStatusBarRef.current = covering;
      setCoverInStatusBar(covering);
    }
  };
  useStatusBarStyleOnFocus(coverInStatusBar ? 'light' : 'dark');

  // No fade animation — render at full opacity immediately to avoid "faded" state

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <ScrollView
        ref={dashboardScrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        onScroll={handleDashboardScroll}
        scrollEventThrottle={16}
      >
        {/* Floating header - overlays the cover image. Height + top mirror the
            other tabs' React Navigation header content area (insets.top, 52px
            tall, vertically centered) so the location pill sits at the exact
            same screen position when switching between dashboard and the other
            business tabs. */}
        <View style={{
          position: 'absolute',
          top: insets.top,
          height: 52,
          // The +NAV_LARGE_MARGIN keeps the floating header's contents in lock
          // step with the nav-header version on the other business tabs when
          // running on iPad / iPhone Pro Max widths (see the constant above).
          // Without this, the location pill jumps 5px sideways when switching
          // from another tab onto the dashboard on those screens.
          left: 16 + NAV_LARGE_MARGIN,
          right: 16 + NAV_LARGE_MARGIN,
          zIndex: 10,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          {/* Team / location switcher — org admins can switch to any
              location; regular members get the dropdown once they're
              assigned to 2+ locations. */}
          {/* Same pill treatment everywhere — Building2 + textPrimary + name,
              no orange empty-state recolouring. The "Aucun emplacement"
              copy is carried in selectedLocationName itself, so the
              affordance is still informative without the palette swap. */}
          {canSwitchDashLocation ? (
            <TouchableOpacity
              onPress={() => setShowLocationModal(true)}
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 8,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                ...theme.shadows.shadowMd,
                maxWidth: 240,
              }}
            >
              <Building2 size={14} color={theme.colors.primary} />
              <Text
                style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flexShrink: 1 }}
                numberOfLines={1}
              >
                {selectedLocationName}
              </Text>
              <ChevronDown size={13} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6, ...theme.shadows.shadowMd, maxWidth: 240 }}>
              <Building2 size={14} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flexShrink: 1 }} numberOfLines={1}>
                {selectedLocationName}
              </Text>
            </View>
          )}

          {/* Settings + Notifications pills */}
          {/*
            paddingHorizontal: 16 (not 10) is deliberate: on every other business
            tab the nav header places Bell at `screen_right - 32` (phone) /
            `- 37` (iPad) — from `headerRightContainerStyle.paddingRight: 16`
            plus Bell's `marginRight: 16`. Matching that here requires
            16 of inset between the pill's right edge and the Bell icon, so the
            two surfaces land on the exact same screen x-coordinate. The
            symmetric horizontal padding (also 16 on the left) keeps the icons
            visually centered inside the pill.
          */}
          <View style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 20,
            paddingHorizontal: 16,
            paddingVertical: 8,
            flexDirection: 'row',
            alignItems: 'center',
            // Pill now carries three buttons: Settings → Chat → Bell, matching
            // the (business)/_layout nav header on every other business tab.
            // The 24 px gap mirrors the nav-header rhythm (padding:6 + marginRight:12).
            gap: 24,
            ...theme.shadows.shadowMd,
          }}>
            <TouchableOpacity onPress={() => router.push('/settings' as never)}>
              <Settings size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/business/conversations' as never)}>
              <MessageCircle size={20} color={theme.colors.textPrimary} />
              {msgUnreadsTotal > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  backgroundColor: theme.colors.error,
                  borderRadius: 8,
                  minWidth: 16,
                  height: 16,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 4,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                    {msgUnreadsTotal > 99 ? '99+' : msgUnreadsTotal}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/notifications' as never)}>
              <Bell size={20} color={theme.colors.textPrimary} />
              {unreadCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  backgroundColor: theme.colors.error,
                  borderRadius: 8,
                  minWidth: 16,
                  height: 16,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 4,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Cover photo - extends to absolute top of screen */}
        <View style={{ position: 'relative', height: 200 + insets.top, backgroundColor: theme.colors.primary + '20', overflow: 'visible', marginTop: 0 }}>
          {profileQuery.data?.cover_image_url ? (
            // expo-image (not RN <Image>): RN's remote-image decode races the
            // first layout on some Android devices, leaving the cover blank
            // until a re-mount (navigating away + back). expo-image paints
            // reliably and caches to disk. `key` on the URL forces a fresh load
            // when the selected location changes.
            <ExpoImage
              key={profileQuery.data.cover_image_url}
              source={{ uri: profileQuery.data.cover_image_url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={150}
            />
          ) : (
            <LinearGradient
              colors={['#1a6b54', '#0d3d30']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </View>

        {/* Profile card overlay */}
        <View style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.r16,
          padding: theme.spacing.xl,
          marginTop: -30,
          marginHorizontal: theme.spacing.lg,
          ...theme.shadows.shadowMd,
          flexDirection: 'row',
          alignItems: 'center',
        }}>
          <View style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            borderWidth: 3,
            borderColor: theme.colors.bg,
            overflow: 'hidden',
            backgroundColor: theme.colors.surface,
          }}>
            {(orgDetailsQuery.data?.organization?.image_url ?? profileQuery.data?.image_url) ? (
              <Image
                source={{ uri: (orgDetailsQuery.data?.organization?.image_url ?? profileQuery.data?.image_url) as string }}
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <View style={{ width: '100%', height: '100%', backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
                <Store size={22} color={theme.colors.primary} />
              </View>
            )}
          </View>
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]} numberOfLines={1}>
              {orgName || profileQuery.data?.name || ''}
            </Text>
            {hasNoLocation ? (
              <Text style={{ color: '#e67e22', fontSize: 12, fontFamily: 'Poppins_500Medium', marginTop: 4 }}>
                {t('business.locationSwitcher.noLocationYet')}
              </Text>
            ) : profileQuery.data?.category ? (
              <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#114b3c15', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Text style={{ color: '#114b3c', fontSize: 11, fontWeight: '600' }}>
                  {t(`categories.${profileQuery.data.category.toLowerCase()}`, { defaultValue: profileQuery.data.category })}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* No-location empty-state moved off the dashboard surface — now
            surfaced as a centered popup (rendered at the bottom of this
            file) that fires on every focus while there are zero locations
            and no walkthrough running. */}

        <Text style={{ color: theme.colors.textPrimary, fontSize: 26, fontFamily: 'Poppins_700Bold', letterSpacing: -0.4, paddingHorizontal: theme.spacing.xl, marginTop: 14 }}>
          {t('business.dashboard.title')}
        </Text>

        <View>
          <LinearGradient
            colors={['#16604a', '#0c3829']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              marginHorizontal: theme.spacing.xl,
              marginTop: theme.spacing.xl,
              borderRadius: theme.radii.r20,
              padding: theme.spacing.xl,
              overflow: 'hidden',
            }}
          >
            {/* Label */}
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', letterSpacing: 0.8, textTransform: 'none', marginBottom: 14 }}>
              {t('business.dashboard.daySummary')} ({(() => {
                // Derive the day from the server's weekly data (last entry = server "today")
                const lastDay = weeklySeries.length > 0 ? weeklySeries[weeklySeries.length - 1] : null;
                if (lastDay?.day) {
                  const d = new Date(lastDay.day + 'T12:00:00');
                  return d.toLocaleDateString(dateLocale, { weekday: 'long' }).replace(/^\w/, (c: string) => c.toUpperCase());
                }
                const fullDayName = lastDay?.dayName ?? lastDay?.day_name ?? '';
                if (fullDayName) {
                  return t(`business.dashboard.days.${fullDayName}`, { defaultValue: fullDayName });
                }
                return new Date().toLocaleDateString(dateLocale, { weekday: 'long' }).replace(/^\w/, (c: string) => c.toUpperCase());
              })()})
            </Text>
            {/* 4 metrics on same line */}
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Banknote size={13} color={theme.colors.secondary} />
                <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Poppins_700Bold', marginTop: 4, letterSpacing: -0.4 }}>
                  <AnimatedNumber value={stats.totalRevenue} />
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>TND</Text>
              </View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <ShoppingBag size={13} color={theme.colors.secondary} />
                <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Poppins_700Bold', marginTop: 4, letterSpacing: -0.4 }}>
                  <AnimatedNumber value={stats.totalBasketsSold} />
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>{t('business.dashboard.sold', { count: stats.totalBasketsSold })}</Text>
              </View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Clock size={13} color={theme.colors.secondary} />
                <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Poppins_700Bold', marginTop: 4, letterSpacing: -0.4 }}>
                  <AnimatedNumber value={stats.pendingOrders} />
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>{t('business.dashboard.pending', { count: stats.pendingOrders })}</Text>
              </View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Package size={13} color={theme.colors.secondary} />
                <Text style={{ color: '#fff', fontSize: 18, fontFamily: 'Poppins_700Bold', marginTop: 4, letterSpacing: -0.4 }}>
                  <AnimatedNumber value={stats.activeBaskets} />
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 1 }}>{t('business.dashboard.rescued', { count: stats.activeBaskets })}</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        <View>
          <TouchableOpacity
            onPress={handleRatingPress}
            activeOpacity={0.85}
            style={{
              backgroundColor: theme.colors.surface,
              marginHorizontal: theme.spacing.xl,
              marginTop: theme.spacing.lg,
              borderRadius: theme.radii.r16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(0,0,0,0.045)',
              shadowColor: '#114b3c',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.07,
              shadowRadius: 8,
              elevation: 2,
            }}
          >
            {/* Accent stripe along the top*/}
            <View style={{ height: 3, backgroundColor: theme.colors.starYellow, borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
              {/* Left: star icon + score */}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: theme.colors.starYellow + '15',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                  <Star size={20} color={theme.colors.starYellow} fill={theme.colors.starYellow} strokeWidth={1.5} />
                </View>
                <View style={{ marginLeft: 14 }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 26, fontFamily: 'Poppins_700Bold', letterSpacing: -0.5 }}>
                    {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '--'}
                  </Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular', letterSpacing: 0.2, marginTop: -2 }}>
                    {t('business.dashboard.avgRating').toUpperCase()}
                  </Text>
                </View>
              </View>
              {/* Right: details pill */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.primary,
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 7,
                gap: 4,
              }}>
                <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.2 }}>{t('business.dashboard.details')}</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Analytics sections — gated by view_history permission */}
        {canViewHistory && (<>
        <View style={{ paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }}>
          {/* Section header */}
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 3, height: 16, backgroundColor: theme.colors.primary, borderRadius: 2, marginRight: 8 }} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, textTransform: 'none' as const }}>
                {t('business.dashboard.performance')}
              </Text>
            </View>
            <View style={styles.statsRow}>
              <StatMiniCard icon={Banknote} value={`${stats.monthlyRevenue}`} suffix="TND" label={t('business.dashboard.revenueThisMonth', { defaultValue: 'Revenus ce mois' })} color={theme.colors.secondaryDark} theme={theme} />
              <View style={{ width: 10 }} />
              <StatMiniCard
                icon={ShoppingBag}
                value={stats.monthlyBaskets}
                label={t(
                  stats.monthlyBaskets > 1 ? 'business.dashboard.basketsThisMonth' : 'business.dashboard.basketThisMonth',
                  { defaultValue: stats.monthlyBaskets > 1 ? 'Paniers vendus ce mois' : 'Panier vendu ce mois' },
                )}
                color={theme.colors.accentFresh}
                theme={theme}
              />
            </View>
          </View>
        </View>

        {/* Order Status Breakdown moved to incoming-orders screen */}

        {/* ── Sales This Week + Monthly Performance — side-by-side on tablets ── */}
        <View style={SCREEN_WIDTH > 768 ? { flexDirection: 'row', gap: 16 } : undefined}>
        {/* ── Sales This Week (Line Chart) ── */}
        <View style={{ paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl, ...(SCREEN_WIDTH > 768 ? { flex: 1 } : {}) }}>
          {/* Section header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 3, height: 16, backgroundColor: theme.colors.primary, borderRadius: 2, marginRight: 8 }} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, textTransform: 'none' as const }}>
                {t('business.dashboard.salesThisWeek', { defaultValue: 'Ventes cette semaine' })}
              </Text>
            </View>
            {weeklyRevenueTotal > 0 && (
              <View style={{ backgroundColor: theme.colors.secondaryDark + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: theme.colors.secondaryDark, fontSize: 11, fontFamily: 'Poppins_700Bold' }}>
                  {`${weeklyRevenueTotal.toFixed(0)} TND`}
                </Text>
              </View>
            )}
          </View>
          {/* Chart panel */}
          <View style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r20,
            borderWidth: 1,
            borderColor: 'rgba(0,0,0,0.04)',
            shadowColor: '#114b3c',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.07,
            shadowRadius: 10,
            elevation: 3,
            overflow: 'hidden',
          }}>
            {/* Panel header strip — LinearGradient accent */}
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
              <LinearGradient
                colors={[theme.colors.primary, theme.colors.accentFresh]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: 3, height: 14, borderRadius: 2, marginRight: 8 }}
              />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontFamily: 'Poppins_400Regular', letterSpacing: 0.3 }}>{t('business.dashboard.basketsPerDay', { defaultValue: 'Paniers vendus / jour' })}</Text>
            </View>
            <View style={{ paddingHorizontal: 12, paddingBottom: 16, alignItems: 'center' }}>
              {stats.dailySales.length > 0 && stats.dailySales.some((v: number) => v > 0) ? (
                <LineChart
                  data={stats.dailySales}
                  labels={stats.dailyLabels}
                  color={theme.colors.primary}
                  gradientColor={theme.colors.accentFresh}
                  width={chartWidth}
                  height={150}
                />
              ) : (
                <View style={{ height: 150, justifyContent: 'center', alignItems: 'center' }}>
                  <ShoppingBag size={26} color={theme.colors.divider} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 10 }}>
                    {t('business.dashboard.noSalesThisWeek', { defaultValue: 'Pas encore de ventes cette semaine' })}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Monthly Performance (Bar Chart) ── */}
        <View style={{ paddingHorizontal: theme.spacing.xl, marginTop: SCREEN_WIDTH > 768 ? theme.spacing.xxl : theme.spacing.xl, ...(SCREEN_WIDTH > 768 ? { flex: 1 } : {}) }}>
          {/* Section header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 3, height: 16, backgroundColor: theme.colors.secondaryDark, borderRadius: 2, marginRight: 8 }} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, textTransform: 'none' as const }}>
                {t('business.dashboard.monthlyPerformance', { defaultValue: 'Performance mensuelle' })}
              </Text>
            </View>
            {stats.monthlyBaskets > 0 && (
              <View style={{ backgroundColor: theme.colors.accentFresh + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ color: theme.colors.accentFresh, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                  {`${stats.monthlyBaskets} ${t(stats.monthlyBaskets > 1 ? 'basket.baskets' : 'basket.basket', { defaultValue: stats.monthlyBaskets > 1 ? 'paniers' : 'panier' })}`}
                </Text>
              </View>
            )}
          </View>
          {/* Chart panel */}
          <View style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r20,
            borderWidth: 1,
            borderColor: 'rgba(0,0,0,0.04)',
            shadowColor: '#114b3c',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.07,
            shadowRadius: 10,
            elevation: 3,
            overflow: 'hidden',
          }}>
            {/* Panel header strip — LinearGradient accent */}
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
              <LinearGradient
                colors={[theme.colors.secondaryDark, theme.colors.secondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ width: 3, height: 14, borderRadius: 2, marginRight: 8 }}
              />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontFamily: 'Poppins_400Regular', letterSpacing: 0.3 }}>{t('business.dashboard.basketsPerMonth', { defaultValue: 'Paniers / mois' })}</Text>
            </View>
            <View style={{ paddingHorizontal: 12, paddingBottom: 16 }}>
              {stats.monthlySales.length > 0 ? (
                <SimpleBarChart
                  data={stats.monthlySales}
                  labels={stats.monthlyLabels}
                  color={theme.colors.primary}
                />
              ) : (
                <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
                  <TrendingUp size={26} color={theme.colors.divider} />
                  <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 10 }}>
                    {t('business.dashboard.noMonthlyData', { defaultValue: 'Pas encore de données mensuelles' })}
                  </Text>
                </View>
              )}
              {stats.monthlySales.length > 0 && stats.monthlyRevenue > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: 10 }}>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontFamily: 'Poppins_400Regular' }}>
                    {t('business.dashboard.revenueThisMonthInline', { defaultValue: 'Revenus ce mois\u00A0:\u00A0' })}
                  </Text>
                  <Text style={{ color: theme.colors.secondaryDark, fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                    {`${stats.monthlyRevenue.toFixed(0)} TND`}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        </View>
        </>)}

        {/* ── Basket overview — visible to ALL members, at bottom ── */}
        {dashBaskets.length > 0 && (
          <View style={{ marginTop: theme.spacing.xl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.xl, marginBottom: 12 }}>
              <View style={{ width: 3, height: 16, backgroundColor: theme.colors.primary, borderRadius: 2, marginRight: 8 }} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, textTransform: 'none' as const }}>
                {t('business.dashboard.baskets', { defaultValue: 'Paniers' })}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular', marginLeft: 8 }}>
                {dashBaskets.length}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingVertical: 8, gap: 12 }}>
              {dashBaskets.map((basket: BusinessBasketFromAPI) => {
                const loc = orgLocations.find((l: any) => Number(l.id) === Number(basket.location_id));
                const bareLocName = loc?.name;
                const locName = formatLocationName(orgName, bareLocName);
                // Fall back to the location's pickup window when the basket
                // inherits "horaires du commerce" (server-side these basket
                // columns are NULL). Resolve the location's window for TODAY
                // from its per-day weekly_schedule so inheriting baskets show
                // the current day's hours, not the widest weekly span.
                const locToday = resolveTodayWeeklyHours((loc as any)?.weekly_schedule);
                // If the location is closed for today, force the card to its
                // expired/closed appearance — even when the basket itself has
                // stock or its own pickup times, the customer can't actually
                // pick it up on a closed day. Mirror what the customer search
                // page now shows so the merchant sees the same state.
                const locClosedToday = locToday?.closed === true;
                const locStart = locToday && !locToday.closed ? locToday.start : (loc as any)?.pickup_start_time;
                const locEnd   = locToday && !locToday.closed ? locToday.end   : (loc as any)?.pickup_end_time;
                const pickupStart = ((basket.pickup_start_time ?? locStart) ?? '').substring(0, 5);
                const pickupEnd   = ((basket.pickup_end_time   ?? locEnd)   ?? '').substring(0, 5);
                return (
                  <TouchableOpacity
                    key={basket.id}
                    activeOpacity={0.85}
                    onPress={() => {
                      useBusinessStore.getState().setTargetBasket(String(basket.id));
                      router.push('/(business)/my-baskets' as never);
                    }}
                    style={{ width: 160, backgroundColor: theme.colors.surface, borderRadius: 14, overflow: 'hidden', ...theme.shadows.shadowSm, opacity: locClosedToday ? 0.55 : 1 }}
                  >
                    <View style={{ width: 160, height: 100, backgroundColor: theme.colors.bg }}>
                      {basket.image_url ? (
                        <Image source={{ uri: basket.image_url }} style={{ width: 160, height: 100, opacity: locClosedToday ? 0.5 : 1 }} resizeMode="cover" />
                      ) : (
                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                          <Package size={28} color={theme.colors.muted} />
                        </View>
                      )}
                      <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: locClosedToday ? '#888' : Number(basket.quantity) > 0 ? theme.colors.primary : theme.colors.error, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, minWidth: 22, alignItems: 'center' }}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                          {locClosedToday
                            ? t('orders.status.expired', { defaultValue: 'Expiré' })
                            : Number(basket.quantity) > 0 ? basket.quantity : t('basket.soldOut', { defaultValue: 'Épuisé' })}
                        </Text>
                      </View>
                    </View>
                    <View style={{ padding: 10 }}>
                      <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontFamily: 'Poppins_600SemiBold' }} numberOfLines={1}>
                        {basket.name}
                      </Text>
                      {locName && (
                        <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 2 }} numberOfLines={1}>
                          {locName}
                        </Text>
                      )}
                      {locClosedToday ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                          <Clock size={10} color={theme.colors.error} />
                          <Text style={{ color: theme.colors.error, fontSize: 10, fontFamily: 'Poppins_400Regular', fontWeight: '600' }}>
                            {t('basket.closedToday', { defaultValue: 'Fermé aujourd\'hui' })}
                          </Text>
                        </View>
                      ) : (pickupStart || pickupEnd) && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                          <Clock size={10} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontFamily: 'Poppins_400Regular' }}>
                            {pickupStart} - {pickupEnd}
                          </Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* animationType="none": RN's native fade was layering a 300 ms opacity
          tween OVER the manual slide-down, and on Android the native driver
          can momentarily reset translateY to 0 during that fade — which read
          as the popup "briefly reappearing" before vanishing. With "none" the
          modal unmounts instantly after the slide finishes; the backdrop
          opacity is faded manually in parallel so it doesn't pop. */}
      <Modal visible={showRatingModal} transparent animationType="none" onRequestClose={closeRatingModal}>
        <RNAnimated.View style={[styles.modalOverlay, { opacity: ratingBackdropOpacity }]}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={closeRatingModal} />
          <RNAnimated.View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.xl, ...theme.shadows.shadowLg, transform: [{ translateY: ratingSlideY }] }]}
          >
            {/* Swipe zone — the top strip hosts the handle pill AND
                the gesture, so the inner reviews ScrollView keeps
                scrolling normally and the swipe-to-close only fires
                from this top area. */}
            <View
              {...ratingPanResponder.panHandlers}
              style={{ paddingTop: 10, paddingBottom: 14, alignItems: 'center' }}
            >
              <View style={[styles.modalHandle, { backgroundColor: theme.colors.divider }]} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={styles.modalHeader}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                  {t('business.dashboard.ratingDetails')}
                </Text>
                <TouchableOpacity onPress={closeRatingModal} style={[styles.modalCloseBtn, { backgroundColor: theme.colors.bg }]}>
                  <X size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={[styles.overallRatingBlock, { backgroundColor: 'transparent', paddingVertical: theme.spacing.lg, marginTop: theme.spacing.sm }]}>
                <Star size={22} color={theme.colors.accentWarm} fill={theme.colors.accentWarm} />
                <Text style={[{ color: theme.colors.textPrimary, fontSize: 28, fontFamily: 'Poppins_700Bold', marginLeft: 8 }]}>
                  {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '--'}
                </Text>
                <Text style={[{ color: theme.colors.muted, fontSize: 16, marginLeft: 4, fontFamily: 'Poppins_400Regular' }]}>/5</Text>
                {reviewsQuery.data?.count ? (
                  <Text style={[{ color: theme.colors.muted, ...theme.typography.bodySm, marginLeft: 8 }]}>
                    ({t('review.reviewCount', { count: reviewsQuery.data.count, defaultValue: '{{count}} avis' })})
                  </Text>
                ) : null}
              </View>

              <View style={[{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: theme.spacing.md }]}>
                <ReviewStarRow label={t('basket.reviewService')} value={reviews.service} />
                <ReviewStarRow label={t('basket.reviewQuantite')} value={reviews.quantite} />
                <ReviewStarRow label={t('basket.reviewQualite')} value={reviews.qualite} />
                <ReviewStarRow label={t('basket.reviewVariete')} value={reviews.variete} />
              </View>

              {/* Comments section */}
              {(reviews as any).reviews && (reviews as any).reviews.length > 0 && (
                <View style={{ marginTop: theme.spacing.xl }}>
                  <View style={{ height: 1, backgroundColor: theme.colors.divider, marginBottom: theme.spacing.lg }} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }}>
                    {t('business.dashboard.recentComments', { defaultValue: 'Commentaires récents' })}
                  </Text>
                  {(reviews as any).reviews.filter((r: any) => r.comment).length === 0 ? (
                    // Reviews exist but none of them carry a written comment —
                    // the section header would otherwise sit above an empty
                    // space. Render an explicit placeholder so the surface
                    // reads as "no comments yet" rather than "broken modal".
                    <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, fontStyle: 'italic', textAlign: 'center', paddingVertical: theme.spacing.lg }}>
                      {t('business.dashboard.noComments', { defaultValue: 'Aucun commentaire' })}
                    </Text>
                  ) : (
                    <>
                      {(showAllComments ? (reviews as any).reviews : (reviews as any).reviews.slice(0, 3)).filter((r: any) => r.comment).map((r: any, i: number) => {
                        // The entire review row is tappable when it has a
                        // reservation_id — that's the user's expectation, not just
                        // the small order-code chip. Tap → set target → deep-link
                        // expands the matching order in incoming-orders.
                        const goToOrder = r.reservation_id ? () => {
                          setShowRatingModal(false);
                          setShowAllComments(false);
                          useBusinessStore.getState().setTargetOrder(String(r.reservation_id), selectedLocationId);
                          router.push('/(business)/incoming-orders' as never);
                        } : undefined;
                        return (
                          <TouchableOpacity
                            key={r.id ?? i}
                            onPress={goToOrder}
                            activeOpacity={goToOrder ? 0.7 : 1}
                            disabled={!goToOrder}
                            style={{ backgroundColor: theme.colors.bg, borderRadius: 14, padding: 14, marginBottom: 10 }}
                          >
                            {/* Header row — stars + customer name + date.
                                Customer name is `flex: 1` + numberOfLines=1
                                so a long name truncates with an ellipsis
                                instead of pushing the date off-screen.
                                The order chip moved out of this row — it
                                now lives bottom-right under the comment
                                so the row never overflows even with a
                                very long name + a 5-digit BK code. */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                {[1,2,3,4,5].map(s => (
                                  <Star key={s} size={12} color="#f59e0b" fill={s <= Math.round(Number(r.rating ?? r.rating_service ?? 0)) ? '#f59e0b' : 'transparent'} />
                                ))}
                              </View>
                              <Text
                                style={{ flex: 1, color: theme.colors.muted, ...theme.typography.caption }}
                                numberOfLines={1}
                                ellipsizeMode="tail"
                              >
                                {r.buyer_name ?? r.customer_name ?? t('business.orders.customer')}
                              </Text>
                              {r.created_at && (
                                <Text style={{ color: theme.colors.muted, ...theme.typography.caption }}>
                                  {new Date(r.created_at).toLocaleDateString(dateLocale)}
                                </Text>
                              )}
                              {/* Report this review (business can flag an
                                  objectionable review left on its location). */}
                              {r.id != null && (() => {
                                const report = getReviewReport(r);
                                const isFlagged = !!report;
                                return (
                                  <TouchableOpacity
                                    onPress={() => {
                                      if (isFlagged) {
                                        // Already reported → open the status / info popup.
                                        setReviewReportInfo({ reason: report!.reason, at: report!.at });
                                      } else {
                                        setReviewReportResult(null);
                                        setReviewReportTarget({ id: Number(r.id) });
                                      }
                                    }}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: isFlagged }}
                                    accessibilityLabel={t(isFlagged ? 'review.report.flagged' : 'review.report.action', { defaultValue: isFlagged ? 'Avis déjà signalé' : 'Signaler cet avis' })}
                                  >
                                    {/* Filled red flag = already signalé by this business. */}
                                    <Flag size={14} color={isFlagged ? '#ef4444' : theme.colors.muted} fill={isFlagged ? '#ef4444' : 'transparent'} />
                                  </TouchableOpacity>
                                );
                              })()}
                            </View>
                            {/* Comment text — wraps naturally over multiple
                                lines. The trailing marginBottom leaves a
                                small gap before the order-code chip below
                                so the chip never touches the last text
                                line. No numberOfLines cap — long reviews
                                are expected to wrap. */}
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontStyle: 'italic', lineHeight: 19 }}>
                              « {r.comment} »
                            </Text>
                            {/* Order code — pinned bottom-right. Sits in
                                its own row so it never collides with the
                                customer name in the header (which used
                                to push it off-screen on long names) and
                                never overlaps the wrapped comment text
                                above (always renders BELOW it). */}
                            {(r.basket_name || r.reservation_id) && (
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
                                {/* Basket name, left of the order code chip. */}
                                <Text style={{ color: theme.colors.muted, ...theme.typography.caption, flex: 1 }} numberOfLines={1}>
                                  {r.basket_name ?? ''}
                                </Text>
                                {r.reservation_id && (
                                  <View style={{ backgroundColor: theme.colors.primary + '12', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                    <Text style={{ color: theme.colors.primary, fontSize: 10, fontWeight: '700' }}>
                                      {orderIdToCode(r.reservation_id)}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                      {(reviews as any).reviews.filter((r: any) => r.comment).length > 3 && (
                        <TouchableOpacity onPress={() => setShowAllComments(v => !v)} style={{ alignItems: 'center', marginTop: 8 }}>
                          <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>
                            {showAllComments ? t('common.seeLess', { defaultValue: 'Voir moins' }) : t('common.seeMore', { defaultValue: 'Voir plus' })}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              )}

            </ScrollView>
          </RNAnimated.View>

          {/* ── Report-a-review picker ──────────────────────────────────────
              Rendered as an absolute overlay INSIDE the rating Modal (over the
              sheet) — NOT a separate RN <Modal>. A second Modal stacked on top
              of this one was the cause of the flag "doing nothing", popping up
              only after a long delay, or freezing the app (nested RN Modals are
              unreliable on both platforms). */}
          {(reviewReportTarget !== null || reviewReportInfo !== null) && (
            <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => { if (!reviewReportSubmitting) closeReviewReport(); }}
              />
              <View style={{ width: '100%', maxWidth: 360, backgroundColor: theme.colors.surface, borderRadius: 20, padding: 22, ...theme.shadows.shadowLg }}>
                {reviewReportInfo ? (
                  // ── Report status / info (already-flagged review) ──
                  (() => {
                    const flaggedDate = reviewReportInfo.at
                      ? new Date(reviewReportInfo.at).toLocaleDateString(dateLocale)
                      : null;
                    return (
                      <View style={{ alignItems: 'center' }}>
                        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#ef444418', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                          <Flag size={30} color="#ef4444" fill="#ef4444" />
                        </View>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 6 }}>
                          {t('review.report.infoTitle', { defaultValue: 'Avis signalé' })}
                        </Text>
                        <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16 }}>
                          {t('review.report.infoSubtitle', { defaultValue: "Voici le statut de votre signalement." })}
                        </Text>
                        <View style={{ alignSelf: 'stretch', backgroundColor: theme.colors.surfaceMuted, borderRadius: 14, padding: 16, marginBottom: 18, gap: 12 }}>
                          <View>
                            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginBottom: 2 }}>
                              {t('review.report.infoReason', { defaultValue: 'Motif signalé' })}
                            </Text>
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body }}>
                              {reviewReasonLabel(reviewReportInfo.reason)}
                            </Text>
                          </View>
                          {flaggedDate && (
                            <View>
                              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginBottom: 2 }}>
                                {t('review.report.infoDate', { defaultValue: 'Signalé le' })}
                              </Text>
                              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body }}>{flaggedDate}</Text>
                            </View>
                          )}
                          <View>
                            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginBottom: 2 }}>
                              {t('review.report.infoStatus', { defaultValue: 'Statut' })}
                            </Text>
                            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' }}>
                              {t('review.report.statusUnderReview', { defaultValue: "En cours d'examen par notre équipe de modération" })}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={closeReviewReport}
                          style={{ alignSelf: 'stretch', alignItems: 'center', backgroundColor: theme.colors.primary, borderRadius: theme.radii.pill, paddingVertical: 13 }}
                        >
                          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'Poppins_600SemiBold' }}>
                            {t('common.ok', { defaultValue: 'OK' })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })()
                ) : reviewReportResult ? (
                  // ── Branded confirmation / error ──
                  (() => {
                    const isError = reviewReportResult === 'error';
                    const accent = isError ? '#ef4444' : theme.colors.primary;
                    const title = isError
                      ? t('common.errorOccurred', { defaultValue: 'Une erreur est survenue' })
                      : t('review.report.thanksTitle', { defaultValue: 'Merci' });
                    const msg = isError
                      ? t('review.report.error', { defaultValue: 'Le signalement a échoué. Réessayez.' })
                      : reviewReportResult === 'already'
                        ? t('review.report.alreadyReported', { defaultValue: 'Vous avez déjà signalé cet avis.' })
                        : t('review.report.thanksBody', { defaultValue: "L'avis a été signalé à notre équipe de modération." });
                    return (
                      <View style={{ alignItems: 'center' }}>
                        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: accent + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                          {isError ? <X size={32} color={accent} /> : <Check size={32} color={accent} />}
                        </View>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 6 }}>{title}</Text>
                        <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 18 }}>{msg}</Text>
                        <TouchableOpacity
                          onPress={isError ? () => setReviewReportResult(null) : closeReviewReport}
                          style={{ alignSelf: 'stretch', alignItems: 'center', backgroundColor: accent, borderRadius: theme.radii.pill, paddingVertical: 13 }}
                        >
                          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', fontFamily: 'Poppins_600SemiBold' }}>
                            {isError ? t('common.retry', { defaultValue: 'Réessayer' }) : t('common.ok', { defaultValue: 'OK' })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })()
                ) : (
                  // ── Reason picker ──
                  <>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 6 }}>
                      {t('review.report.title', { defaultValue: 'Signaler cet avis' })}
                    </Text>
                    <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, marginBottom: 12 }}>
                      {t('review.report.subtitle', { defaultValue: 'Pourquoi signalez-vous cet avis ?' })}
                    </Text>
                    {REVIEW_REPORT_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.reason}
                        onPress={() => submitReviewReport(opt.reason)}
                        disabled={reviewReportSubmitting}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingVertical: 14,
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.divider,
                          opacity: reviewReportSubmitting ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1 }}>{opt.label}</Text>
                        <ChevronRight size={18} color={theme.colors.muted} />
                      </TouchableOpacity>
                    ))}
                    {reviewReportSubmitting && (
                      <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 14 }} />
                    )}
                  </>
                )}
              </View>
            </View>
          )}
        </RNAnimated.View>
      </Modal>

      {/* Location / team switcher — inline dropdown anchored just below the
          trigger, matching the other business tabs' location selector. */}
      <Modal visible={showLocationModal} transparent animationType="fade" onRequestClose={() => setShowLocationModal(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' }}
          activeOpacity={1}
          onPress={() => setShowLocationModal(false)}
        >
          <View
            style={{
              position: 'absolute',
              top: insets.top + 52,
              left: 12,
              right: 12,
              maxHeight: '70%',
              backgroundColor: theme.colors.surface,
              borderRadius: 16,
              paddingVertical: 8,
              paddingHorizontal: 8,
              ...theme.shadows.shadowLg,
              borderWidth: 1,
              borderColor: theme.colors.divider,
            }}
            onStartShouldSetResponder={() => true}
          >
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {/* "All locations" option — shown whenever the user actually
                  sees 2+ locations (admin or multi-location member). Hidden
                  when only one location is visible since "Tous" is then a
                  no-op. Mirrors the layout switcher's item exactly: same
                  truncation + ellipsis behaviour so the dashboard dropdown
                  looks identical to the one shown on my-baskets /
                  incoming-orders / business-profile. */}
              {orgLocations.filter((loc) => isAdmin || myDashLocationIds.includes(Number(loc.id))).length > 1 && (
                <TouchableOpacity
                  onPress={() => handleLocationSwitch(null)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: selectedLocationId === null ? theme.colors.primary + '12' : 'transparent',
                  }}
                  activeOpacity={0.7}
                >
                  <Store size={18} color={selectedLocationId === null ? theme.colors.primary : theme.colors.textSecondary} />
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={{
                      flex: 1,
                      marginLeft: 10,
                      color: selectedLocationId === null ? theme.colors.primary : theme.colors.textPrimary,
                      fontSize: 14,
                      fontWeight: selectedLocationId === null ? '700' : '500',
                      fontFamily: selectedLocationId === null ? 'Poppins_700Bold' : 'Poppins_500Medium',
                    }}
                  >
                    {t('business.allLocations', { defaultValue: 'Tous les emplacements' })}
                  </Text>
                  {/* Sum of pending orders across every location. Same
                      cache the nav-bar badge reads from, so this
                      number is guaranteed to match whatever the badge
                      shows when the user is on the dashboard's
                      "Tous" view. Replaces the old "this row is
                      selected" check (the row's tinted background
                      already conveys selection). */}
                  {(() => {
                    let total = 0;
                    for (const n of pendingCountByLocation.values()) total += n;
                    return total > 0 ? (
                      <View style={{
                        minWidth: 24, height: 24,
                        borderRadius: 12,
                        backgroundColor: theme.colors.primary,
                        paddingHorizontal: 7,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                          {total}
                        </Text>
                      </View>
                    ) : null;
                  })()}
                </TouchableOpacity>
              )}

              {/* Individual locations — org admins see every location;
                  everyone else only sees the ones they actually belong to. */}
              {orgLocations.filter((loc) => isAdmin || myDashLocationIds.includes(Number(loc.id))).map((loc) => {
                const isSelected = Number(selectedLocationId) === Number(loc.id);
                return (
                  <TouchableOpacity
                    key={loc.id}
                    onPress={() => handleLocationSwitch(loc.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      backgroundColor: isSelected ? theme.colors.primary + '12' : 'transparent',
                    }}
                    activeOpacity={0.7}
                  >
                    <Building2 size={18} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{
                          color: isSelected ? theme.colors.primary : theme.colors.textPrimary,
                          fontSize: 14,
                          fontWeight: isSelected ? '700' : '500',
                          fontFamily: isSelected ? 'Poppins_700Bold' : 'Poppins_500Medium',
                        }}
                      >
                        {loc.name ?? t('business.unnamedLocation', { defaultValue: 'Unnamed location' })}
                      </Text>
                      {loc.address ? (
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 2 }} numberOfLines={1} ellipsizeMode="tail">
                          {loc.address}
                        </Text>
                      ) : null}
                    </View>
                    {/* Per-location pending chip (mirrors the
                        ['today-orders-count'] cache shared with the
                        nav-bar badge). Hidden when zero so quiet
                        venues stay visually uncluttered. */}
                    {(() => {
                      const count = pendingCountByLocation.get(Number(loc.id)) ?? 0;
                      return count > 0 ? (
                        <View style={{
                          minWidth: 24, height: 24,
                          borderRadius: 12,
                          backgroundColor: theme.colors.primary,
                          paddingHorizontal: 7,
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}>
                          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                            {count}
                          </Text>
                        </View>
                      ) : null;
                    })()}
                  </TouchableOpacity>
                );
              })}

              {orgLocations.length === 0 && !orgDetailsQuery.isLoading && (
                <View style={{ paddingVertical: 8 }}>
                  <NoLocationCTA
                    compact
                    onPressOverride={() => {
                      setShowLocationModal(false);
                      router.push('/business/add-location' as never);
                    }}
                  />
                </View>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* "Ajoutez votre premier point de vente" popup. Renders only when
          the org has zero locations and the walkthrough isn't running — see
          the useFocusEffect above. Tapping the primary CTA dismisses the
          popup and routes to the add-location flow; the X / backdrop just
          dismiss (the popup will re-show next time the dashboard regains
          focus while still in the empty state). */}
      <ModalCard
        visible={showAddLocationPopup}
        onClose={() => setShowAddLocationPopup(false)}
        maxWidth={360}
      >
        <View style={{ alignItems: 'center', paddingTop: 4 }}>
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: theme.colors.primary + '15',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 20,
            }}
          >
            <MapPin size={40} color={theme.colors.primary} />
          </View>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center' }}>
            {t('business.noLocation.title')}
          </Text>
          <Text
            style={{
              color: theme.colors.textSecondary,
              ...theme.typography.body,
              marginTop: 10,
              textAlign: 'center',
              lineHeight: 22,
            }}
          >
            {t('business.noLocation.description')}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setShowAddLocationPopup(false);
              router.push('/business/add-location' as never);
            }}
            activeOpacity={0.85}
            style={{
              marginTop: 24,
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r12,
              paddingVertical: 12,
              paddingHorizontal: 22,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Plus size={16} color="#fff" />
            <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '700' }}>
              {t('business.noLocation.cta')}
            </Text>
          </TouchableOpacity>
        </View>
      </ModalCard>

      {/* Location switching animation overlay */}
      {isSwitchingLocation && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(17,75,60,0.88)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }]}>
          <View style={{ width: 80, height: 80, justifyContent: 'center', alignItems: 'center' }}>
            <RNAnimated.View style={{
              position: 'absolute',
              width: 80,
              height: 80,
              borderRadius: 40,
              borderWidth: 3,
              borderColor: '#e3ff5c',
              borderTopColor: 'transparent',
              transform: [{ rotate: switchSpinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
            }} />
            <Text style={{ color: '#e3ff5c', fontSize: 32, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>B</Text>
          </View>
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
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {},
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryBanner: {},
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryVal: {
    fontSize: 20,
    fontWeight: '700' as const,
    marginTop: 4,
    fontFamily: 'Poppins_700Bold',
  },
  summarySuffix: {
    fontSize: 10,
    marginTop: 2,
    fontFamily: 'Poppins_400Regular',
  },
  summaryDivider: {
    width: 1,
    height: 36,
  },
  ratingCard: {},
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ratingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingStarBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingArrow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statsGrid: {},
  statsRow: {
    flexDirection: 'row',
  },
  chartSection: {},
  chartCard: {},
  chartLegend: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '85%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overallRatingBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
