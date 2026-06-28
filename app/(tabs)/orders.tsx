import React, { useState, useMemo, useCallback, useEffect, useRef, useDeferredValue } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Dimensions, Modal, Image, Easing } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePollWhenFocused } from '@/src/hooks/usePollWhenFocused';
import { useSwipeToDismiss } from '@/src/hooks/useSwipeToDismiss';
import { ShoppingBag, AlertTriangle, Clock, Zap } from 'lucide-react-native';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';
import { useTheme } from '@/src/theme/ThemeProvider';
import { isPickupExpiredInTz, getNowInBusinessTz, getBusinessDayDateStr, toBizDayMinutes } from '@/src/utils/timezone';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations, hideReservation } from '@/src/services/reservations';
import { fetchConversationUnreads } from '@/src/services/messages';
import { fetchGamificationStats } from '@/src/services/gamification';
import { calcMoneySaved, calcCO2Saved, calcLevelProgress } from '@/src/lib/impactCalculations';
import { ReservationCard } from '@/src/components/ReservationCard';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useStatusBarStyleOnFocus } from '@/src/hooks/useStatusBarStyleOnFocus';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useOrdersStore } from '@/src/stores/ordersStore';
import { buildDemoOrder, DEMO_ORDER_ID } from '@/src/lib/demoData';

/**
 * Animated surprise-bag illustration for the empty orders state. Same
 * "animated illustration" pattern as PulsingHeart on the favorites tab —
 * a gentle float + sway loop that draws the eye without being distracting.
 * Uses the Barakeat paper-bag asset so the brand carries through.
 */
function PulsingBag({ size = 160 }: { size?: number }) {
  const floatAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, [floatAnim]);
  const translateY = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [4, -8] });
  const rotate = floatAnim.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });
  return (
    <Animated.View style={{ transform: [{ translateY }, { rotate }] }}>
      <Image
        source={require('@/assets/images/barakeat_paper_bag.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

function PickupCountdown({ startTime, endTime, theme, t }: { startTime: string; endTime: string; theme: any; t: any }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick(p => p + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // Use business timezone for countdown, in business-day minutes so overnight
  // windows (e.g. 18:00 → 02:59) are handled correctly.
  const bizNow = getNowInBusinessTz();
  const nowMinutes = toBizDayMinutes(bizNow.hours * 60 + bizNow.minutes);
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMinutes = toBizDayMinutes(sh * 60 + sm);
  const endMinutes = toBizDayMinutes(eh * 60 + em);

  const isBeforePickup = nowMinutes < startMinutes;
  const isDuringPickup = nowMinutes >= startMinutes && nowMinutes <= endMinutes;

  let label = '';
  let color = theme.colors.muted;
  let timeLeft = '';

  if (isBeforePickup) {
    const diff = startMinutes - nowMinutes;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    label = t('orders.startsIn', { defaultValue: 'Starts in' });
    timeLeft = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    color = theme.colors.primary;
  } else if (isDuringPickup) {
    const diff = endMinutes - nowMinutes;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    label = t('orders.endsIn', { defaultValue: 'Ends in' });
    timeLeft = h > 0 ? `${h}h ${m}m` : `${diff}m`;
    color = diff < 15 ? theme.colors.error : theme.colors.accentWarm;
  } else {
    label = t('orders.pickupEnded', { defaultValue: 'Pickup ended' });
    color = theme.colors.muted;
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color, ...theme.typography.bodySm, fontWeight: '600' }}>
        {label} {timeLeft}
      </Text>
    </View>
  );
}

function CarouselBanner({ moneySaved, co2Saved, totalOrders, upcomingOrders, getPickupTimes, theme, t }: any) {
  const scrollRef = useRef<ScrollView>(null);
  const screenWidth = Dimensions.get('window').width;
  const cardWidth = screenWidth - 2 * 20; // padding
  const [activeSlide, setActiveSlide] = useState(0);

  // Find the most-urgent upcoming order. "Urgent" = smallest time until the
  // next relevant edge:
  //   - if the pickup window hasn't started yet → count down to START (opens-in)
  //   - if the window is open → count down to END (closes-in)
  //   - if the window is over → skip (no longer "next")
  // The previous version ALWAYS counted down to END regardless of whether the
  // window had opened, so an order with pickup 18:00-20:00 viewed at 10:00 AM
  // displayed "10h 0m" with no hint that this was time-until-CLOSE, which
  // misled users into thinking they had to be there RIGHT NOW.
  const closestOrder = useMemo(() => {
    if (!upcomingOrders.length) return null;
    const bizNow = getNowInBusinessTz();
    const nowMinutes = toBizDayMinutes(bizNow.hours * 60 + bizNow.minutes);
    const todayBizDate = getBusinessDayDateStr(new Date());
    let closest: any = null;
    let closestDiff = Infinity;
    for (const r of upcomingOrders) {
      // ── Extension fast-path ─────────────────────────────────────────────
      // An order whose pickup_extended_until is in the future is back on
      // the customer's plate even though its original pickup window has
      // already closed — without this branch the carousel would skip such
      // an order entirely (the regular window check below `continue`s
      // when `nowMinutes >= endMinutes`). Reuse the same biz-day-minute
      // projection so the countdown reads in the same units as the
      // ordinary path. displayMinutes = minutes from now → extension
      // deadline; isActive=true so the banner uses the "closes in"
      // wording and red-when-urgent treatment that already exists below
      // for in-window orders.
      const extRaw = (r as any).pickup_extended_until ?? (r as any).pickupExtendedUntil ?? null;
      if (extRaw) {
        const extMs = new Date(extRaw).getTime();
        if (!isNaN(extMs) && extMs > Date.now()) {
          const minutesLeft = Math.max(0, Math.ceil((extMs - Date.now()) / 60000));
          if (minutesLeft < closestDiff) {
            closestDiff = minutesLeft;
            closest = {
              reservation: r,
              start: '',
              end: '',
              minutesLeft,
              isActive: true,
              // Flag consumed by the slide renderer so it can swap
              // "Closes in" → "Extension expires in" without us having to
              // string-match in the JSX.
              isExtension: true,
            };
          }
          continue; // extension takes precedence over the raw window
        }
      }
      const { start, end } = getPickupTimes(r);
      if (!start || !end) continue;

      // Defensive biz-day match. Without this, a reservation whose pickup
      // was meant for an EARLIER biz-day (e.g. reserved at 3:25 AM for the
      // 3:00–3:29 AM window — that window belongs to YESTERDAY'S biz-day
      // because the day flips at 03:30) would compare against TODAY'S
      // biz-day minutes and produce "Opens in 23h" garbage. The cron sweep
      // should already have marked these `expired`, but the carousel needs
      // to handle the brief gap between window-end and the next cron tick.
      //
      // CRITICAL: read reservation_date as a literal YYYY-MM-DD string
      // (substring), NOT via `new Date()`. The backend writes a Postgres
      // DATE — already in biz-day terms — that serializes as a bare
      // '2025-12-01'-style string. `new Date('2025-12-01')` parses it as
      // UTC midnight, then getBusinessDayDateStr shifts back 3:30h →
      // yesterday's date in Tunisia, which never matched todayBizDate.
      // Result before this fix: the banner skipped EVERY reservation for
      // today, even one placed seconds ago. Mirrors isPickupExpiredCheck's
      // logic above so the two stay in sync.
      let resBizDate: string | null = null;
      const rawResDate = (r as any).pickup_date ?? (r as any).reservation_date;
      if (typeof rawResDate === 'string' && rawResDate.length >= 10) {
        resBizDate = rawResDate.substring(0, 10);
      }
      const createdAtRaw = (r as any).created_at ?? (r as any).createdAt;
      if (createdAtRaw) {
        const createdBizDate = getBusinessDayDateStr(new Date(createdAtRaw));
        // After-reset edge case: a reservation created at 03:25 with
        // reservation_date = today's calendar date actually belongs to
        // YESTERDAY's biz-day. Picking the earlier of the two keeps the
        // banner consistent with the order list's biz-day classification.
        if (!resBizDate || createdBizDate < resBizDate) {
          resBizDate = createdBizDate;
        }
      }
      if (resBizDate && resBizDate !== todayBizDate) continue;

      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const startMinutes = toBizDayMinutes(sh * 60 + sm);
      const endMinutes = toBizDayMinutes(eh * 60 + em);
      let displayMinutes: number;
      let isActive: boolean;
      if (nowMinutes < startMinutes) {
        displayMinutes = startMinutes - nowMinutes;
        isActive = false;
      } else if (nowMinutes < endMinutes) {
        displayMinutes = endMinutes - nowMinutes;
        isActive = true;
      } else {
        continue; // window past — not "next pickup" anymore
      }
      if (displayMinutes < closestDiff) {
        closestDiff = displayMinutes;
        closest = { reservation: r, start, end, minutesLeft: displayMinutes, isActive };
      }
    }
    return closest;
  }, [upcomingOrders, getPickupTimes]);

  const slideCount = closestOrder ? 2 : 1;

  return (
    <View style={{ marginBottom: 16 }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
          setActiveSlide(idx);
        }}
        scrollEventThrottle={16}
        style={{ marginHorizontal: -20 }}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        snapToInterval={cardWidth + 10}
        decelerationRate="fast"
      >
        {/* Slide 1: Pickup Countdown (only if upcoming order exists — shown FIRST) */}
        {(() => {
          if (!closestOrder) return null;
          // "Urgent" red styling ONLY when the window has opened AND <30 min
          // remain. For a not-yet-open order the < 30 min number is a
          // heads-up ("opens in 25 min"), not an emergency.
          const isUrgent = closestOrder.isActive && closestOrder.minutesLeft < 30;
          return (
          <View style={{
            backgroundColor: isUrgent ? theme.colors.error : '#e3ff5c',
            borderRadius: theme.radii.r16,
            padding: 20,
            width: cardWidth,
            marginRight: 10,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {isUrgent ? (
                <AlertTriangle size={18} color="#fff" />
              ) : (
                <Clock size={18} color="#114b3c" />
              )}
              <Text style={{
                color: isUrgent ? '#fff' : '#114b3c',
                ...theme.typography.bodySm,
                fontWeight: '600',
              }}>
                {isUrgent
                  ? t('orders.pickupExpiring', { defaultValue: 'Pickup ending soon!' })
                  : t('orders.nextPickup', { defaultValue: 'Next Pickup' })}
              </Text>
            </View>
            <Text style={{
              color: isUrgent ? '#fff' : '#114b3c',
              ...theme.typography.h2,
              marginTop: 12,
            }} numberOfLines={1}>
              {(closestOrder.reservation as any).restaurant_name
                ?? closestOrder.reservation.basket?.merchantName
                ?? closestOrder.reservation.basket?.merchant_name
                ?? ''}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 }}>
              <View style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: isUrgent ? '#fff' : '#114b3c',
              }} />
              <Text style={{
                color: isUrgent ? 'rgba(255,255,255,0.85)' : '#114b3c',
                ...theme.typography.bodySm,
                fontWeight: '600',
              }}>
                {/* Extensions don't have a meaningful start-end window
                    (the original window closed; we're counting down to
                    pickup_extended_until). Show a "Délai prolongé" tag
                    instead so the customer doesn't see a confusing
                    "00:00 - 00:00" or stale window from before the
                    extension. */}
                {closestOrder.isExtension
                  ? t('orders.extendedTag', { defaultValue: 'Étendu' })
                  : `${closestOrder.start} - ${closestOrder.end}`}
              </Text>
              <Text style={{
                color: isUrgent ? '#fff' : '#114b3c',
                ...theme.typography.bodySm,
                fontWeight: '700',
                marginLeft: 'auto',
              }}>
                {`${closestOrder.isExtension
                  ? t('orders.extensionGranted', { defaultValue: 'Délai prolongé · expire dans' })
                  : closestOrder.isActive
                    ? t('orders.closesIn', { defaultValue: 'Ferme dans' })
                    : t('orders.opensIn', { defaultValue: 'Ouvre dans' })} ${closestOrder.minutesLeft > 60
                      ? `${Math.floor(closestOrder.minutesLeft / 60)}h ${closestOrder.minutesLeft % 60}m`
                      : `${closestOrder.minutesLeft}m`}`}
              </Text>
            </View>
          </View>
          );
        })()}

        {/* Impact slide — always shown, after pickup if pickup exists */}
        <View style={{
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radii.r16,
          padding: 20,
          width: cardWidth,
        }}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.bodySm }}>
            {t('orders.yourImpact', { defaultValue: 'Your Impact' })}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 16 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', ...theme.typography.h2 }}>{moneySaved.toFixed(0)}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption }}>{t('orders.tndSaved')}</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', ...theme.typography.h2 }}>{co2Saved.toFixed(1)}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption }}>{t('orders.kgCO2')}</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', ...theme.typography.h2 }}>{totalOrders}</Text>
              {/* Was `orders.title` ("Commandes") — the number here is
                  meals_saved from gamification (fallback: count of
                  picked_up orders), so "Paniers sauvés" reads true to
                  what the figure actually measures. */}
              {/* Pluralized via i18next's count rule: 1 → "Panier sauvé",
                  0 or 2+ → "Paniers sauvés". (i18next's default plural rule
                  matches the user's preference of plural-for-zero out of
                  the box — _other covers 0 along with 2+.) */}
              <Text style={{ color: 'rgba(255,255,255,0.7)', ...theme.typography.caption }}>
                {t('orders.basketsSaved', { count: totalOrders, defaultValue: 'Paniers sauvés' })}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Dots indicator */}
      {slideCount > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8, gap: 6 }}>
          {Array.from({ length: slideCount }).map((_, i) => (
            <View
              key={i}
              style={{
                width: activeSlide === i ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: activeSlide === i ? theme.colors.primary : theme.colors.divider,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export default function OrdersScreen() {
  useStatusBarStyleOnFocus('dark');
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentUser = useAuthStore((s) => s.user);
  // Backend endpoint `/api/reservations/my/reservations` is buyer-only — if a
  // business user ends up rendering this tab (e.g. during a role-mismatch
  // redirect frame) we must NOT fire the query; otherwise every 15 s poll
  // logs a 403. Treat `role` and `type` as customer-equivalent.
  const isBuyer = (() => {
    const role = String(currentUser?.role ?? '').toLowerCase();
    const typ = String((currentUser as any)?.type ?? '').toLowerCase();
    const isBiz = role === 'business' || role === 'restaurant' || typ === 'restaurant' || typ === 'business';
    return !isBiz;
  })();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed' | 'issues'>('upcoming');
  // The tab pills read `activeTab` directly so the highlight flips INSTANTLY on
  // press. The heavy order-card list reads this deferred value, so rendering the
  // new tab's cards (expensive) happens in a low-priority commit and no longer
  // blocks the press feedback — fixes the ~1s "lag before the tab activates".
  const deferredTab = useDeferredValue(activeTab);
  // (The earlier `visibleCardCount` progressive-mount hack — render first 4
  // cards, then expand — was a workaround for the ScrollView mounting all
  // cards in one pass. The Animated.FlatList we render below virtualizes
  // properly: `initialNumToRender={5}` paints the first batch immediately
  // and `windowSize={3}` keeps off-screen cards out of memory. No more
  // hand-rolled progressive mounting needed.)

  // Deep-link from notifications: e.g. tapping "Voir la commande" on a
  // cancelled-order popup pushes /(tabs)/orders?tab=issues. The orders tab
  // is a tab screen that keeps state across navigations, so we read the
  // param every time it changes (not just once on mount) and apply it.
  // A small `appliedTabTokenRef` guards against re-applying the same value
  // when the user manually navigates away from the tab again.
  const { tab: tabParam, target: targetParam } = useLocalSearchParams<{ tab?: string; target?: string }>();
  const appliedTabTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tabParam || typeof tabParam !== 'string') return;
    if (appliedTabTokenRef.current === tabParam) return;
    if (tabParam === 'issues' || tabParam === 'completed' || tabParam === 'upcoming') {
      setActiveTab(tabParam);
      appliedTabTokenRef.current = tabParam;
    }
  }, [tabParam]);

  // Deep-link target order: when a cancelled-order notif pushes us here with
  // `target=<id>`, scroll to that card, flash a highlight ring, AND open the
  // card (initialExpanded) so the user lands on the full details of the
  // exact cancelled order — not the top of the issues list.
  //
  // The first implementation captured Y via onLayout and scrolled to that
  // cached value. That fired too early (the card's first layout pass returns
  // a Y that doesn't yet account for the carousel banner + tabs above it),
  // so the scroll landed at the wrong vertical position and the user saw a
  // ring on whichever card happened to be near the bad offset. The robust
  // approach is to keep per-card View refs and call measureLayout against
  // the ScrollView's inner content node AFTER React has settled — that gives
  // the true offset every time.
  //
  // We also force a reservations refetch the moment a target arrives so a
  // freshly-cancelled order (created seconds ago) is guaranteed to be in
  // the list, not waiting on the next 20s poll tick.
  // FlatList owns its scrolling now — drop the per-card View refs +
  // measureInWindow math we used with the ScrollView. The deep-link
  // scroll is `scrollToIndex` against the matching card's index in
  // `displayedOrders`.
  const pendingTargetIdRef = useRef<string | null>(null);
  const appliedTargetTokenRef = useRef<string | null>(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  // Tracks whether the current deep-link target represents a problem
  // (cancellation / expiry → red border) or a positive confirmation
  // (fresh order from "Voir la commande" → expand only, no red ring).
  // The View Order flow lands via tab=upcoming; the cancellation flow
  // lands via tab=issues.
  const [highlightAsIssue, setHighlightAsIssue] = useState(false);

  // We need `displayedOrders` to resolve target id → index, but
  // `displayedOrders` is defined later in the component. Read it via a
  // ref to keep dependency simple. The ref is updated on every render
  // (see the assignment immediately after `displayedOrders` is declared
  // below).
  const displayedOrdersRef = useRef<any[]>([]);
  const scrollToTargetCard = useCallback((id: string, attempt = 0) => {
    const list = ordersScrollRef.current;
    const data = displayedOrdersRef.current;
    if (!list || !data) {
      if (attempt < 15) setTimeout(() => scrollToTargetCard(id, attempt + 1), 100);
      return;
    }
    const index = data.findIndex((r: any) => String(r?.id) === id);
    if (index < 0) {
      // Card not in the current list yet (refetch still in flight, or
      // wrong tab). Retry for ~1.5 s while the freshly-cancelled card
      // lands via the refetch.
      if (attempt < 15) setTimeout(() => scrollToTargetCard(id, attempt + 1), 100);
      return;
    }
    try {
      // viewPosition: 0 + viewOffset: 80 lands the top of the card 80px
      // below the FlatList's visible-area top. That 80px slice surfaces
      // the bottom of the ListHeaderComponent — specifically the tabs
      // row — so the user keeps context for which tab they're on AND
      // sees the top of the freshly-expanded card. The prior viewPosition
      // 0 (no offset) scrolled the entire header off-screen which the
      // user reported as "scrolls down too much, hides the top of the
      // card" — without context the scroll feels like over-shoot, and
      // any post-expansion height drift in FlatList's virtualization
      // could push the card top above the viewport. The viewOffset
      // buffers both.
      list.scrollToIndex({ index, animated: true, viewPosition: 0, viewOffset: 80 });
    } catch {
      // scrollToIndex can throw if the row hasn't been measured yet
      // (no getItemLayout). One retry handles the race.
      if (attempt < 3) setTimeout(() => scrollToTargetCard(id, attempt + 1), 150);
    }
  }, []);

  useEffect(() => {
    if (!targetParam || typeof targetParam !== 'string' || !targetParam.trim()) return;
    // Token is (tab, target) — two consecutive taps on the SAME cancelled
    // notif now re-trigger the expand+scroll because targetParam carries a
    // fresh token each navigation. The old "dedupe on bare targetParam"
    // also blocked the second tap on cards whose 4.5 s highlight had
    // already cleared, leaving the buyer staring at a collapsed card.
    const token = `${tabParam ?? ''}:${targetParam}`;
    if (appliedTargetTokenRef.current === token) return;
    appliedTargetTokenRef.current = token;
    const id = String(targetParam);
    pendingTargetIdRef.current = id;
    setHighlightedOrderId(id);
    // Differentiate the "View Order" positive flow (tab=upcoming, fresh
    // confirmation) from the cancellation deep-link flow (tab=issues). The
    // red border belongs only on the issue flow — it's a visual cue that
    // something is wrong with the highlighted order. Applying it on a
    // freshly-confirmed reservation is misleading.
    setHighlightAsIssue(tabParam === 'issues');
    // Refetch reservations so a just-cancelled order (created seconds ago)
    // is in the list, not waiting on the 20 s polling tick.
    void reservationsQuery.refetch();
    // Two scroll attempts: the first at 250 ms catches the typical case
    // (tab already mounted, cards laid out), the second at 700 ms catches
    // the slower path where the tab is switching from 'upcoming' →
    // 'issues' and useDeferredValue holds the OLD displayedOrders for a
    // few frames before the new filter committs. Without the second pass
    // a fresh tap landed on the upcoming-tab data, retried 15× while the
    // issues data arrived, but the FIRST scroll succeeded against the
    // wrong data — landing on whatever card had a near-matching index.
    // Two passes makes the final position deterministic.
    setTimeout(() => scrollToTargetCard(id), 250);
    setTimeout(() => scrollToTargetCard(id), 700);
    // Hold the highlight long enough for the scroll-then-expand sequence to
    // finish AND for the user to read where it landed.
    const clearT = setTimeout(() => {
      setHighlightedOrderId(null);
      setHighlightAsIssue(false);
    }, 4500);
    return () => clearTimeout(clearT);
  }, [targetParam, tabParam, scrollToTargetCard, reservationsQuery]);
  // Customer orders page shows all history; filter UI was removed (kept on business side only).
  const dateFilter: 'all' | 'today' | 'month' | 'year' = 'all';
  const issueTypeFilter: 'all' | 'expired' | 'cancelled' = 'all';
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ordersScrollY = useRef(new Animated.Value(0)).current;
  const ordersHeaderBg = ordersScrollY.interpolate({ inputRange: [0, 30], outputRange: ['transparent', '#ffffff'], extrapolate: 'clamp' });
  // Plain ref mirror of the current scroll Y. We need a numeric value (not
  // an Animated.Value) for the deep-link scroll math below, and reading the
  // private `_value` off an Animated.Value is fragile across RN versions.
  // The Animated.event listener option fills both at once.
  const scrollYRef = useRef(0);

  // Cancel-warning modal state. The warning stays as a lightweight popup here;
  // only after the user confirms they want to cancel do we navigate to the
  // full-page /cancel-reservation screen to pick a reason.
  const [cancelWarning, setCancelWarning] = useState<{
    id: string; quantity: number; locationId?: string; merchantName?: string;
    xpLoss: number; levelBefore: number; levelAfter: number;
    // Remainder method ('cash' | 'card') determines what happens to the
    // non-credit slice. The credit slice is forfeited on a customer-side
    // cancellation regardless of this field.
    paymentMethod?: 'cash' | 'card' | 'credits';
    // TND amount of credits the buyer applied at checkout. > 0 means the
    // warning needs to surface "your credits will NOT be refunded" so the
    // buyer can't be surprised after the fact. 0 means no credit slice.
    creditAmount?: number;
  } | null>(null);

  // ── Cancel sheet animation ────────────────────────────────────────────────
  // The sheet uses a CUSTOM (animationType="none") entrance so the dark
  // backdrop fades in FIRST and stays put, then the sheet slides up — instead
  // of the native "slide" which drags the backdrop up together with the sheet.
  // It's also drag-to-dismiss from the handle (useSwipeToDismiss).
  const CANCEL_SHEET_OFFSCREEN = 800;
  const cancelBackdropOpacity = useRef(new Animated.Value(0)).current;
  const cancelSheetY = useRef(new Animated.Value(CANCEL_SHEET_OFFSCREEN)).current;
  // Drag-dismiss: the hook slides its own translateY out, then calls this — we
  // just fade the backdrop out and unmount.
  const handleCancelDragDismiss = useCallback(() => {
    Animated.timing(cancelBackdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true })
      .start(({ finished }) => { if (finished) setCancelWarning(null); });
  }, [cancelBackdropOpacity]);
  const cancelSwipe = useSwipeToDismiss(handleCancelDragDismiss);
  // Animated-out close for the buttons / backdrop / back press: slide the sheet
  // down and fade the backdrop, THEN clear the state.
  const closeCancelSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(cancelBackdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(cancelSheetY, { toValue: CANCEL_SHEET_OFFSCREEN, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) setCancelWarning(null); });
  }, [cancelBackdropOpacity, cancelSheetY]);
  // Entrance: backdrop fade + sheet slide fire IN PARALLEL so the user sees
  // one continuous motion. Was an Animated.sequence (backdrop first, then
  // spring) which read as "two snaps": the backdrop popped in, then the
  // sheet did its own separate slide. Parallel = single fluid entrance.
  useEffect(() => {
    if (!cancelWarning) return;
    cancelBackdropOpacity.setValue(0);
    cancelSheetY.setValue(CANCEL_SHEET_OFFSCREEN);
    cancelSwipe.translateY.setValue(0);
    const anim = Animated.parallel([
      Animated.timing(cancelBackdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(cancelSheetY, { toValue: 0, friction: 12, tension: 70, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [cancelWarning, cancelBackdropOpacity, cancelSheetY, cancelSwipe.translateY]);

  // Reservations polling pauses when the user is on another tab — drop
  // `refetchOnMount: 'always'` (it was double-firing alongside the
  // interval and forcing a refetch on every tab swap, the worst-case
  // case for the rate limiter). The 30s staleTime floor on the global
  // QueryClient already covers freshness on quick tab returns.
  const reservationsRefetch = usePollWhenFocused(20_000);
  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated && isBuyer,
    staleTime: 15_000,
    refetchInterval: reservationsRefetch,
    refetchOnReconnect: true,
    retry: 2,
  });

  // Conversation unreads: 10s → 30s + focus-gated. /api/messages shares
  // the writeLimiter's 20 req/min budget; 6 req/min from this single
  // poll alone was filling a third of it.
  const msgUnreadsRefetch = usePollWhenFocused(30_000);
  const msgUnreadsQuery = useQuery({
    queryKey: ['conversation-unreads'],
    queryFn: fetchConversationUnreads,
    enabled: isAuthenticated,
    staleTime: 20_000,
    refetchInterval: msgUnreadsRefetch,
  });
  const msgUnreads = msgUnreadsQuery.data ?? {};

  const gamificationQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    enabled: isAuthenticated,
    // Consistent with (tabs)/_layout (5 min) — was 60s here, 10s in
    // profile/impact: when two staleTime windows on the same key
    // expire at different ticks, you get a double-fetch on the
    // boundary. Single floor across consumers fixes that.
    staleTime: 5 * 60_000,
  });

  const hideMutation = useMutation({
    mutationFn: (id: string) => hideReservation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  // Demo-order injection: when the customer walkthrough completes the fake
  // reservation, `reserve.tsx` flips `demoOrderActive=true` and routes here.
  // We prepend a synthetic confirmed reservation so the orders tab shows a
  // realistic card the walkthrough can highlight. Mirrors the business-side
  // injection in `app/(business)/incoming-orders.tsx:270-304`.
  const demoOrderActive = useWalkthroughStore((s) => s.demoOrderActive);
  // Require an ACTIVE walkthrough (step !== null) to inject the demo card, not
  // just the demoOrderActive flag. The flag is cleared on walkthrough
  // finish/skip, but if a demo is ever abandoned mid-flow without hitting those
  // paths the flag could linger in-session — without this guard a synthetic
  // "Panier Surprise (démo)" order would then haunt the user's REAL orders list.
  const walkthroughStep = useWalkthroughStore((s) => s.step);
  const showDemoOrder = demoOrderActive && walkthroughStep !== null;
  const demoLocationName = t('walkthrough.customer.demoLocationName', { defaultValue: 'Chez Joe (démo)' });
  const demoBasketName = t('walkthrough.customer.demoBasketName', { defaultValue: 'Panier Surprise' });
  const demoOrder = useMemo(
    () => buildDemoOrder({ basketName: demoBasketName, locationName: demoLocationName }),
    [demoBasketName, demoLocationName],
  );

  const realReservations = reservationsQuery.data ?? [];
  const reservations = useMemo(
    () => showDemoOrder
      ? [demoOrder, ...realReservations.filter((r) => String(r.id) !== DEMO_ORDER_ID)]
      : realReservations,
    [showDemoOrder, demoOrder, realReservations],
  );

  // Auto-scroll on the orders tab when the walkthrough reaches the
  // `customerPickupCode` step. After the user taps the demo order card to
  // expand it, the pickup-code block sits below the fold — without
  // scrolling, the spotlight lands on an off-screen target and the user
  // sees nothing. We scroll the page down by ~280 px to bring the dark
  // pickup-code box into the visible viewport. The card's onLayout
  // republishes its rect after the scroll settles, so the halo follows.
  // Typed loose because Animated.FlatList's generic threading is fiddly to
  // get right and we only call `scrollToOffset` / `scrollToIndex` on this
  // ref — both available on the FlatList instance. The Animated wrapper
  // also has a `getNode()` escape hatch for older RN versions.
  const ordersScrollRef = useRef<any>(null);

  // After a cancellation, the cancel screen sets a one-shot flag (see
  // ordersStore). This tab keeps its scroll position across navigation, so on
  // return the list would show the old offset while the cancelled card is now
  // gone — leaving a stale position that visibly snapped to the top on the
  // first touch. Consuming the flag on focus and scrolling to top up-front
  // makes the return clean.
  useFocusEffect(
    useCallback(() => {
      if (useOrdersStore.getState().consumeScrollReset()) {
        // requestAnimationFrame so the scroll lands after the focus re-render.
        requestAnimationFrame(() => ordersScrollRef.current?.scrollToOffset({ offset: 0, animated: false }));
      }
    }, [])
  );

  const walkthroughMeasureKey = useWalkthroughStore((s) => s.currentStep?.measureKey);
  // Reset scroll to top THE MOMENT any demo arms — `demoSequencePending`
  // flips true under the welcome cover, before any halo paints. Tab
  // screens are mounted in memory and preserve scroll across navigation,
  // so without this a user who scrolled the orders list down and THEN
  // triggered the demo would see every subsequent orders-tab halo offset
  // by their pre-demo scroll position. Running the reset under the cover
  // means the demo's first orders-tab frame lands on an already-settled
  // top-aligned list.
  const demoSequencePending = useWalkthroughStore((s) => s.demoSequencePending);
  useEffect(() => {
    if (!demoSequencePending) return;
    ordersScrollRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [demoSequencePending]);
  // When the demo enters the orders tab (customerOrderCard step), reset
  // scroll to the top so the injected demo card lands at a predictable
  // position. Tab screens preserve scroll across navigation — without this
  // the halo would land wherever the user left the list scrolled. We do
  // NOT null-clear the rect here: the demo card's onLayout in
  // ReservationCard republishes the rect whenever the card lays out
  // (incl. expand toggle), and a null clear with no immediate re-publish
  // would strand the overlay in its dim-only branch.
  useEffect(() => {
    if (walkthroughMeasureKey !== 'customerOrderCard') return;
    ordersScrollRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [walkthroughMeasureKey]);
  useEffect(() => {
    if (walkthroughMeasureKey !== 'customerPickupCode') return;
    // No null-clear here: the pickup-code onLayout in ReservationCard now
    // SKIPS publication while the walkthrough is at customerOrderCard /
    // customerPickupCode (see ReservationCard.tsx), and the 500 ms
    // step-driven re-measure in ReservationCard is the authoritative
    // post-scroll publisher. Clearing here was redundant and risked the
    // dim-mask-only stall the user reported.
    //
    // Wait a frame so the demo card's expand animation has settled before
    // we scroll; otherwise the layout's still mid-transition.
    const t = setTimeout(() => {
      ordersScrollRef.current?.scrollToOffset({ offset: 280, animated: true });
    }, 120);
    return () => clearTimeout(t);
  }, [walkthroughMeasureKey]);

  // Helper: check if reservation's pickup time has ended (business timezone aware).
  // Uses BUSINESS-DAY date comparison (not calendar date) so overnight pickup
  // windows (e.g. 18:00 → 02:59) stay valid past midnight until the 03:30 reset.
  const isPickupExpiredCheck = useCallback((r: any) => {
    const rr = r as any;
    // Pickup extension granted by a business member (POST
    // /reservations/:id/extend-pickup) — while the deadline is still in the
    // future, the order is intentionally re-active even though the original
    // pickup window has passed. Customer's "En cours" tab must therefore
    // treat it as NOT expired so it moves back out of "Problèmes" the
    // moment the extension is granted.
    const extUntil = rr.pickup_extended_until ?? rr.pickupExtendedUntil;
    if (extUntil) {
      const extMs = new Date(extUntil).getTime();
      if (!isNaN(extMs) && extMs > Date.now()) return false;
    }
    // Never expire a reservation created less than 5 minutes ago — short
    // grace for the racey case where the customer reserves at e.g. 18:01
    // for a 18:00-19:00 window and the very first card render computes
    // expired-by-1-minute before the user even sees confirmation.
    const createdAt = rr.created_at ?? rr.createdAt;
    if (createdAt) {
      const ageMs = Date.now() - new Date(createdAt).getTime();
      if (ageMs < 5 * 60 * 1000) return false;
    }
    // Resolve the reservation's business-day date. Prefer the explicit
    // reservation_date (a pure "YYYY-MM-DD" string) because it's the most
    // accurate signal of the biz-day the customer intended. But the
    // backend can occasionally write today's CALENDAR date for an order
    // created during the early-morning window (00:00-03:29) — those
    // should belong to YESTERDAY's biz-day. So when reservation_date is
    // missing OR equals today's calendar date AND created_at suggests
    // pre-reset, prefer the derived biz-day-of-created_at.
    let resBizDate: string | null = null;
    const rawResDate = rr.pickup_date ?? rr.reservation_date;
    if (typeof rawResDate === 'string' && rawResDate.length >= 10) {
      resBizDate = rawResDate.substring(0, 10);
    }
    if (createdAt) {
      const createdBizDate = getBusinessDayDateStr(new Date(createdAt));
      // If reservation_date is missing OR is calendar-today but creation
      // happened pre-03:30 (a different biz-day), trust created_at's biz-day.
      if (!resBizDate || (createdBizDate < resBizDate)) {
        resBizDate = createdBizDate;
      }
    }

    const todayBizDate = getBusinessDayDateStr(new Date());

    // Past business day = expired
    if (resBizDate && resBizDate < todayBizDate) return true;
    // Same business day: check if pickup end time has passed (overnight-aware).
    // When pickup_end_time is missing from every fallback source we default
    // to expired (safer than leaving the order dangling in the active tab
    // with no way to ever flip it out).
    if (resBizDate === todayBizDate) {
      const end = rr.pickup_end_time
        ?? rr.basket?.pickup_end_time
        ?? rr.restaurant?.pickup_end_time
        ?? rr.basket?.pickupWindow?.end
        ?? rr.pickupWindow?.end
        ?? null;
      if (end) {
        return isPickupExpiredInTz(String(end).substring(0, 5));
      }
      // No end time AND we're past the 5-min grace → assume expired so the
      // order doesn't squat in the active tab forever. Previously this
      // returned false, which was the gap the user reported (orders that
      // expired 12+ minutes ago still in the En cours tab with a live
      // Cancel button).
      return true;
    }
    return false;
  }, []);

  // Smart pickup-expiry tick. The previous per-minute `setInterval` was
  // removed because it re-built the three filter arrays every 60 s,
  // which thrashed FlatList identity and forced ReservationCard
  // remounts during tab switches. The new approach: scan the upcoming
  // reservations for the NEAREST pickup-window close, set ONE
  // `setTimeout` for that exact instant (+500 ms buffer), and only
  // re-evaluate the filters then. So a list with no near-future
  // expiries does zero work in the background; a list with one
  // imminent expiry fires exactly one tick. Combined with
  // ReservationCard being React.memo'd on its `reservation` prop, the
  // recompute only re-renders the ONE card that actually moves between
  // tabs — every other card stays put with stable props.
  const [expiryTick, setExpiryTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    let nearestExpiryMs: number | null = null;
    for (const r of reservations) {
      const status = String((r as any)?.status ?? '').toLowerCase();
      if (!['reserved', 'ready', 'pending', 'confirmed'].includes(status)) continue;
      const rAny = r as any;
      const dateBasis = rAny.reservation_date ?? rAny.pickup_date ?? rAny.created_at ?? null;
      const endTime =
        rAny.pickup_end_time
        ?? rAny.basket?.pickup_end_time
        ?? rAny.basket?.pickupWindow?.end
        ?? null;
      if (!dateBasis || !endTime) continue;
      const datePart = String(dateBasis).substring(0, 10);
      const timePart = String(endTime).substring(0, 5);
      const expiryMs = new Date(`${datePart}T${timePart}:00`).getTime();
      if (Number.isNaN(expiryMs)) continue;
      if (expiryMs <= now) continue; // already expired — filters will catch it on the current render
      if (nearestExpiryMs == null || expiryMs < nearestExpiryMs) nearestExpiryMs = expiryMs;
    }
    if (nearestExpiryMs == null) return;
    // Cap at 10 minutes: a far-future order would set a multi-hour
    // timer that drifts on device sleep / app backgrounding. Re-checking
    // at worst every 10 min keeps the bound predictable while still
    // costing far less than a 60 s tick.
    const delay = Math.max(500, Math.min(nearestExpiryMs - now + 500, 10 * 60 * 1000));
    const tid = setTimeout(() => setExpiryTick((x) => x + 1), delay);
    return () => clearTimeout(tid);
  }, [reservations, expiryTick]);

  const upcomingOrders = useMemo(
    () => reservations.filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      if (status !== 'reserved' && status !== 'ready' && status !== 'pending' && status !== 'confirmed') return false;
      return !isPickupExpiredCheck(r);
    }),
    // `expiryTick` participates so the filter re-runs the moment an
    // upcoming row tips into expired — moving it out of the En cours
    // tab and into the Problèmes tab without an app refresh.
    [reservations, isPickupExpiredCheck, expiryTick]
  );

  // Picks the event-time millisecond stamp for sorting a non-upcoming
  // reservation. Mirrors the time-since-event label rule on the
  // collapsed ReservationCard so the row order and the "il y a X" label
  // tell the same story:
  //   · cancelled / picked_up / collected / completed → updated_at
  //     (the backend's confirmPickup + cancelReservation queries both
  //     bump updated_at = NOW())
  //   · expired (client-side overrideExpired path — backend leaves the
  //     row as 'confirmed') → synthesise reservation_date +
  //     pickup_end_time, the wall-clock instant the pickup window
  //     closed. created_at is the last-resort fallback so rows missing
  //     either field still rank somewhere coherent rather than at the
  //     epoch.
  const eventTimeMs = useCallback((r: any): number => {
    const status = (r?.status ?? '').toLowerCase();
    const isExpired =
      (status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed')
      && isPickupExpiredCheck(r);
    if (isExpired) {
      const dateBasis =
        r.reservation_date
        ?? r.pickup_date
        ?? r.created_at
        ?? null;
      const endTime =
        r.pickup_end_time
        ?? r.basket?.pickup_end_time
        ?? r.basket?.pickupWindow?.end
        ?? null;
      // Cross-midnight pickup windows (e.g. 21:30 → 02:00 for an overnight
      // bakery): the reservation_date holds the day pickup OPENS, while the
      // end time belongs to the NEXT calendar day. Without this detection
      // the synth concat lands at "today 02:00 AM" (many hours in the past
      // of the actual expiry), so freshly-expired overnight orders sort
      // below older ones and the user sees "il y a 2h" — even though the
      // window only just closed. Same fix already applied in ReservationCard
      // and the conversations partition isPickupOver().
      const startTime =
        r.pickup_start_time
        ?? r.basket?.pickup_start_time
        ?? r.basket?.pickupWindow?.start
        ?? null;
      if (dateBasis && endTime) {
        const datePart = String(dateBasis).substring(0, 10);
        const timePart = String(endTime).substring(0, 5);
        let synth = new Date(`${datePart}T${timePart}:00`);
        if (startTime) {
          const startTimePart = String(startTime).substring(0, 5);
          const startSynth = new Date(`${datePart}T${startTimePart}:00`);
          if (!isNaN(startSynth.getTime()) && !isNaN(synth.getTime()) && synth.getTime() < startSynth.getTime()) {
            synth = new Date(synth.getTime() + 24 * 60 * 60 * 1000);
          }
        }
        if (!isNaN(synth.getTime())) {
          // Synth landed in the FUTURE → backend data is inconsistent
          // (pickup_end missing or a date mismatch produced a tomorrow
          // timestamp). Fall through to updated_at / created_at rather
          // than letting the future-dated synth float the row to the
          // very top of the Problems tab when it actually expired hours
          // ago and the user just opened the screen.
          if (synth.getTime() <= Date.now()) return synth.getTime();
        }
      }
    }
    if (status === 'collected' || status === 'completed' || status === 'picked_up' || status === 'cancelled' || status === 'expired') {
      const ts = r.updated_at ? new Date(r.updated_at).getTime() : NaN;
      if (!isNaN(ts)) return ts;
    }
    // For wall-clock-expired 'confirmed' rows whose synth fell through (no
    // pickup_end_time / synth in the future), prefer updated_at if it's
    // meaningfully later than created_at — bumped writes are the only
    // post-creation signal we have. Otherwise fall back to created_at.
    if (isExpired) {
      const updMs = r.updated_at ? new Date(r.updated_at).getTime() : NaN;
      const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
      if (!isNaN(updMs) && updMs > createdMs + 1000) return updMs;
    }
    const fallback = r.created_at ? new Date(r.created_at).getTime() : 0;
    return isNaN(fallback) ? 0 : fallback;
  }, [isPickupExpiredCheck]);

  const completedOrders = useMemo(
    () =>
      reservations
        .filter((r) => {
          const status = (r.status ?? '').toLowerCase();
          return status === 'collected' || status === 'completed' || status === 'picked_up';
        })
        // Most recent pickup at the top — the user's "I just picked
        // this up" expectation. The backend returns rows by
        // created_at DESC, which surfaced an order placed an hour ago
        // above one picked up five minutes ago.
        .sort((a, b) => eventTimeMs(b) - eventTimeMs(a)),
    [reservations, eventTimeMs]
  );

  const issueOrders = useMemo(
    () =>
      reservations
        .filter((r) => {
          const status = (r.status ?? '').toLowerCase();
          if (status === 'cancelled' || status === 'expired') return true;
          if ((status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed') && isPickupExpiredCheck(r)) return true;
          return false;
        })
        // Sort by the moment the order actually ended (cancellation
        // timestamp / synthesised expiry instant), most recent first.
        .sort((a, b) => eventTimeMs(b) - eventTimeMs(a)),
    // `expiryTick` so the freshly-expired row appears here at the
    // same instant it leaves upcomingOrders above.
    [reservations, isPickupExpiredCheck, eventTimeMs, expiryTick]
  );

  // Alias for impact calculations (only picked_up counts)
  const completedReservations = completedOrders;


  // Apply date filter to completed and issues tabs
  const filterByDate = useCallback((orders: typeof completedOrders) => {
    if (dateFilter === 'all') return orders;
    const now = new Date();
    return orders.filter((r: any) => {
      const d = new Date(r.created_at ?? r.reservation_date);
      if (dateFilter === 'today') return d.toDateString() === now.toDateString();
      if (dateFilter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      return d.getFullYear() === now.getFullYear(); // year
    });
  }, [dateFilter]);

  const filteredCompleted = useMemo(() => filterByDate(completedOrders), [completedOrders, filterByDate]);
  const filteredIssues = useMemo(() => {
    let filtered = filterByDate(issueOrders);
    // System-expired rows are stored as status='cancelled' with
    // cancelled_by='system' + cancellation_reason='expired_no_pickup'.
    // The "Expiré" chip must include them; the "Annulée" chip must
    // exclude them. Mirrors the derivation in ReservationCard + the
    // business incoming-orders normalizeStatus().
    const isSystemExpired = (r: any) =>
      (r.status ?? '').toLowerCase() === 'cancelled'
      && String(r.cancelled_by ?? '').toLowerCase() === 'system'
      && String(r.cancellation_reason ?? '').toLowerCase() === 'expired_no_pickup';
    if (issueTypeFilter === 'expired') {
      filtered = filtered.filter((r: any) =>
        (r.status ?? '').toLowerCase() !== 'cancelled' || isSystemExpired(r)
      );
    } else if (issueTypeFilter === 'cancelled') {
      filtered = filtered.filter((r: any) =>
        (r.status ?? '').toLowerCase() === 'cancelled' && !isSystemExpired(r)
      );
    }
    return filtered;
  }, [issueOrders, filterByDate, issueTypeFilter]);

  const displayedOrders = deferredTab === 'upcoming' ? upcomingOrders : deferredTab === 'completed' ? filteredCompleted : filteredIssues;
  // Mirror to the ref so `scrollToTargetCard` (declared earlier in the
  // component) can resolve a target id → its index without taking
  // `displayedOrders` as a useCallback dep (which would invalidate the
  // callback on every keystroke that affects filters).
  displayedOrdersRef.current = displayedOrders;

  // Hero stats — respond to date filter
  const statsSource = dateFilter === 'all' ? completedReservations : filteredCompleted;
  const moneySaved = useMemo(() => {
    if (dateFilter === 'all') {
      const gStats = gamificationQuery.data as any;
      const gStatsInner = gStats?.stats ?? gStats;
      if (gStatsInner?.money_saved != null) return Math.max(0, parseFloat(gStatsInner.money_saved) || 0);
    }
    return calcMoneySaved(statsSource as any[]);
  }, [statsSource, gamificationQuery.data, dateFilter]);

  const co2Saved = useMemo(() => {
    if (dateFilter === 'all') {
      const gStats = gamificationQuery.data as any;
      const gStatsInner = gStats?.stats ?? gStats;
      if (gStatsInner?.meals_saved != null) return calcCO2Saved(gStatsInner.meals_saved);
    }
    return calcCO2Saved(statsSource.length);
  }, [statsSource, gamificationQuery.data, dateFilter]);

  const totalOrders = useMemo(() => {
    if (dateFilter === 'all') {
      const gStats = gamificationQuery.data as any;
      const gStatsInner = gStats?.stats ?? gStats;
      if (gStatsInner?.meals_saved != null) return gStatsInner.meals_saved;
    }
    return statsSource.length;
  }, [statsSource, gamificationQuery.data, dateFilter]);

  // Expired orders are handled by the isPickupExpiredCheck filter above —
  // they move to the "past" tab automatically. We do NOT auto-cancel from the client
  // because timezone differences between the user's phone and the server (Tunisia)
  // could cause valid reservations to be incorrectly cancelled.

  const handleCancelRequest = useCallback((id: string, quantity: number, locationId?: string, merchantName?: string, paymentMethod?: 'cash' | 'card' | 'credits', creditAmount?: number) => {
    const gStats = queryClient.getQueryData<any>(['gamification-stats']);
    const xp = gStats?.xp ?? (typeof gStats?.level === 'object' ? (gStats.level.xp ?? 0) : 0);
    const xpLoss = quantity * 10;
    const { level: levelBefore } = calcLevelProgress(xp);
    const { level: levelAfter } = calcLevelProgress(Math.max(0, xp - xpLoss));
    setCancelWarning({ id, quantity, locationId, merchantName, xpLoss, levelBefore, levelAfter, paymentMethod, creditAmount });
  }, [queryClient]);

  const handleConfirmCancelFromWarning = useCallback(() => {
    if (!cancelWarning) return;
    const target = cancelWarning;
    setCancelWarning(null);
    router.push({
      pathname: '/cancel-reservation',
      params: {
        reservationId: String(target.id),
        quantity: String(target.quantity),
        locationId: target.locationId ?? '',
        merchantName: target.merchantName ?? '',
        xpLoss: String(target.xpLoss),
        levelBefore: String(target.levelBefore),
        levelAfter: String(target.levelAfter),
      },
    } as never);
  }, [cancelWarning, router]);

  const handleHide = useCallback((id: string) => {
    hideMutation.mutate(id);
  }, [hideMutation]);

  const getPickupTimes = (reservation: any) => {
    const start = reservation.pickup_start_time
      ?? reservation.basket?.pickupWindow?.start
      ?? reservation.basket?.pickup_start_time
      ?? reservation.restaurant?.pickup_start_time
      ?? reservation.pickupWindow?.start;
    const end = reservation.pickup_end_time
      ?? reservation.basket?.pickupWindow?.end
      ?? reservation.basket?.pickup_end_time
      ?? reservation.restaurant?.pickup_end_time
      ?? reservation.pickupWindow?.end;
    return {
      start: start ? String(start).substring(0, 5) : undefined,
      end: end ? String(end).substring(0, 5) : undefined,
    };
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: 50 }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
            {t('orders.loginRequired')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // No orders at all — empty state
  const hasNoOrders = !reservationsQuery.isLoading && !reservationsQuery.isError && reservations.length === 0;

  if (hasNoOrders) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
        {/* Header + tabs share a single wrapper that mirrors the favorites
            tab's chrome: same padding (xl horizontal, 50 top, sm bottom) so
            the tab row sits at the SAME vertical position on both screens
            instead of one notch higher. The populated branch keeps its own
            inline tabs because it sits below the hero/carousel banner. */}
        <View style={{ paddingHorizontal: theme.spacing.xl, paddingTop: 50, paddingBottom: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
          </View>

          {/* Same three tabs as the populated view so the user can still see
              what's available on first visit. Tappable for the visual
              underline move but every tab renders the same global empty
              state below — there are no orders in any tab right now. */}
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
            <TouchableOpacity
              onPress={() => setActiveTab('upcoming')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'upcoming' }}
              style={{
                flex: 1, paddingVertical: 10, alignItems: 'center',
                borderBottomWidth: 2,
                borderBottomColor: activeTab === 'upcoming' ? theme.colors.primary : 'transparent',
                marginBottom: -1,
              }}
            >
              <Text style={{
                color: activeTab === 'upcoming' ? theme.colors.primary : theme.colors.textSecondary,
                ...theme.typography.bodySm,
                fontWeight: activeTab === 'upcoming' ? '600' : '400',
              }}>
                {t('orders.upcoming')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('completed')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'completed' }}
              style={{
                flex: 1, paddingVertical: 10, alignItems: 'center',
                borderBottomWidth: 2,
                borderBottomColor: activeTab === 'completed' ? theme.colors.primary : 'transparent',
                marginBottom: -1,
              }}
            >
              <Text style={{
                color: activeTab === 'completed' ? theme.colors.primary : theme.colors.textSecondary,
                ...theme.typography.bodySm,
                fontWeight: activeTab === 'completed' ? '600' : '400',
              }}>
                {t('orders.completed', { defaultValue: 'Terminées' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab('issues')}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === 'issues' }}
              style={{
                flex: 1, paddingVertical: 10, alignItems: 'center',
                borderBottomWidth: 2,
                borderBottomColor: activeTab === 'issues' ? theme.colors.error : 'transparent',
                marginBottom: -1,
              }}
            >
              <Text style={{
                color: activeTab === 'issues' ? theme.colors.error : theme.colors.textSecondary,
                ...theme.typography.bodySm,
                fontWeight: activeTab === 'issues' ? '600' : '400',
              }}>
                {t('orders.issues', { defaultValue: 'Problèmes' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Empty content mirrors the favorites-tab pattern (h1 title, body
            description, illustration, CTA) with the SAME container chrome —
            justifyContent: 'flex-start' + paddingTop: 80 + paddingHorizontal:
            40 — so the "Aucune commande pour l'instant" title lands on the
            exact same horizontal line as favorites' "Aucun favori ajouté".
            Vertical gaps are tighter than the favorites version since the
            user asked for a more compact stack. */}
        {/* Same container chrome as favorites' emptyContainer style
            (flex-start + paddingTop 80 + paddingHorizontal 32) so the title
            sits on the exact same line AND the description gets the same
            comfortable line-length as on the favorites tab. The button
            mirrors favorites exactly (lg/xxxl padding) so the two pages'
            "Trouver un panier surprise" CTAs are pixel-identical. */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 32, paddingTop: 80 }}>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h1, textAlign: 'center' }}>
            {t('orders.emptyTitle')}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.sm, textAlign: 'center', lineHeight: 22 }}>
            {t('orders.emptyDesc')}
          </Text>
          <View style={{ marginTop: theme.spacing.md, alignItems: 'center' }}>
            <PulsingBag size={180} />
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)' as never)}
            style={{
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r16,
              paddingVertical: theme.spacing.lg,
              paddingHorizontal: theme.spacing.xxxl,
              marginTop: theme.spacing.md,
            }}
            accessibilityLabel={t('orders.findBasket')}
            accessibilityRole="button"
          >
            <Text style={{ color: '#fff', ...theme.typography.button }}>
              {t('orders.findBasket')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>

      {/* Loading / error states render BEFORE the FlatList — the list
          shouldn't even mount during a cold fetch. Title stays visible
          in both branches so the screen never looks "blank" while a
          spinner / retry button is up.

          ONE branch handles both isLoading and isError: DelayedLoader
          plays the wave while the request is in flight, and the
          `forceTimedOut` prop short-circuits it into its existing
          "Chargement plus long que prévu" + Réessayer view the
          instant React Query's `isError` flips. Previously the page
          swapped to a separate "Une erreur est survenue" view on
          error — that meant the user saw three states (wave → load-
          slow message → error message) instead of two (wave → load-
          slow message with retry). Routing the error through the
          loader keeps the messaging consistent and adds a single
          retry path. */}
      {(reservationsQuery.isLoading || reservationsQuery.isError) && !reservationsQuery.data ? (
        <View style={[styles.content, { padding: theme.spacing.xl, paddingTop: 50 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
          </View>
          <DelayedLoader
            onRetry={() => { void reservationsQuery.refetch(); }}
            forceTimedOut={reservationsQuery.isError}
          />
        </View>
      ) : (
        <Animated.FlatList
          ref={ordersScrollRef}
          style={styles.content}
          contentContainerStyle={{ padding: theme.spacing.xl, paddingTop: 50, paddingBottom: 100 }}
          data={displayedOrders}
          extraData={`${highlightedOrderId}:${highlightAsIssue ? '1' : '0'}`}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item: reservation }: { item: any }) => {
            const rStatus = (reservation.status ?? '').toLowerCase();
            const isStillUpcomingStatus = rStatus === 'reserved' || rStatus === 'ready' || rStatus === 'pending' || rStatus === 'confirmed';
            const expired = isStillUpcomingStatus && isPickupExpiredCheck(reservation);
            const cardId = String(reservation.id);
            const isHighlighted = highlightedOrderId === cardId;
            // Red border only when the deep-link source was a problem
            // notification (cancellation / expiry). Fresh "Voir la
            // commande" landings still auto-expand the card, but without
            // the alarm border that suggested something was wrong.
            const showIssueBorder = isHighlighted && highlightAsIssue;
            return (
              <View
                style={showIssueBorder ? {
                  borderRadius: theme.radii.r16,
                  borderWidth: 2,
                  borderColor: theme.colors.error,
                  marginBottom: 8,
                } : undefined}
              >
                <ReservationCard
                  reservation={reservation}
                  onCancel={handleCancelRequest}
                  onHide={handleHide}
                  overrideExpired={expired}
                  messageUnreadCount={msgUnreads[Number(reservation.id)] ?? 0}
                  initialExpanded={isHighlighted}
                />
              </View>
            );
          }}
          // Virtualization knobs — the whole point of the conversion.
          // initialNumToRender=5 keeps the first paint cheap; windowSize
          // and maxToRenderPerBatch keep scrolling smooth without
          // mounting every off-screen card up-front.
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          windowSize={3}
          removeClippedSubviews={true}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: ordersScrollY } } }],
            {
              useNativeDriver: false,
              listener: (e: any) => { scrollYRef.current = e?.nativeEvent?.contentOffset?.y ?? 0; },
            },
          )}
          scrollEventThrottle={16}
          // scrollToIndex can throw if the row hasn't laid out yet. The
          // callback retries via scrollToOffset (rough position) then
          // re-runs scrollToIndex on the next layout pass.
          onScrollToIndexFailed={(info) => {
            const offset = info.averageItemLength * info.index;
            ordersScrollRef.current?.scrollToOffset({ offset, animated: false });
            setTimeout(() => {
              try {
                // Match the primary call's settings — top of card with
                // 80px breathing room above so the tabs stay visible and
                // any virtualization drift doesn't hide the card top.
                ordersScrollRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0, viewOffset: 80 });
              } catch {}
            }, 80);
          }}
          ListHeaderComponent={(
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('orders.title')}</Text>
              </View>
              <CarouselBanner
                moneySaved={moneySaved}
                co2Saved={co2Saved}
                totalOrders={totalOrders}
                upcomingOrders={upcomingOrders}
                getPickupTimes={getPickupTimes}
                theme={theme}
                t={t}
              />
              <View style={[styles.tabs, { marginBottom: theme.spacing.sm }]}>
                <TouchableOpacity
                  style={[styles.tab, { flex: 1, paddingVertical: theme.spacing.md, borderBottomWidth: 2, borderBottomColor: activeTab === 'upcoming' ? theme.colors.primary : 'transparent' }]}
                  onPress={() => setActiveTab('upcoming')}
                  accessibilityRole="button"
                  accessibilityLabel={t('orders.upcoming')}
                  accessibilityState={{ selected: activeTab === 'upcoming' }}
                >
                  <Text style={[{ color: activeTab === 'upcoming' ? theme.colors.primary : theme.colors.textSecondary, ...theme.typography.body, fontWeight: activeTab === 'upcoming' ? ('600' as const) : ('400' as const), fontFamily: activeTab === 'upcoming' ? 'Poppins_600SemiBold' : 'Poppins_400Regular', textAlign: 'center' }]}>
                    {t('orders.upcoming')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tab, { flex: 1, paddingVertical: theme.spacing.md, borderBottomWidth: 2, borderBottomColor: activeTab === 'completed' ? theme.colors.primary : 'transparent' }]}
                  onPress={() => setActiveTab('completed')}
                  accessibilityRole="button"
                  accessibilityLabel={t('orders.completed', { defaultValue: 'Terminées' })}
                  accessibilityState={{ selected: activeTab === 'completed' }}
                >
                  <Text style={[{ color: activeTab === 'completed' ? theme.colors.primary : theme.colors.textSecondary, ...theme.typography.body, fontWeight: activeTab === 'completed' ? ('600' as const) : ('400' as const), fontFamily: activeTab === 'completed' ? 'Poppins_600SemiBold' : 'Poppins_400Regular', textAlign: 'center' }]}>
                    {t('orders.completed', { defaultValue: 'Terminées' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tab, { flex: 1, paddingVertical: theme.spacing.md, borderBottomWidth: 2, borderBottomColor: activeTab === 'issues' ? theme.colors.error : 'transparent' }]}
                  onPress={() => setActiveTab('issues')}
                  accessibilityRole="button"
                  accessibilityLabel={t('orders.issues', { defaultValue: 'Problèmes' })}
                  accessibilityState={{ selected: activeTab === 'issues' }}
                >
                  <Text style={[{ color: activeTab === 'issues' ? theme.colors.error : theme.colors.textSecondary, ...theme.typography.body, fontWeight: activeTab === 'issues' ? ('600' as const) : ('400' as const), fontFamily: activeTab === 'issues' ? 'Poppins_600SemiBold' : 'Poppins_400Regular', textAlign: 'center' }]}>
                    {t('orders.issues', { defaultValue: 'Problèmes' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          ListEmptyComponent={(
            <View style={{ alignItems: 'center', paddingTop: 50, paddingHorizontal: 20 }}>
              <View style={{ marginBottom: 24, alignItems: 'center' }}>
                <View style={{ width: 160, height: 120, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowMd, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.primary + '14', alignItems: 'center', justifyContent: 'center' }}>
                    <ShoppingBag size={28} color={theme.colors.primary} />
                  </View>
                  <View style={{ marginTop: 10, flexDirection: 'row', gap: 6 }}>
                    <View style={{ width: 40, height: 6, borderRadius: 3, backgroundColor: theme.colors.divider }} />
                    <View style={{ width: 24, height: 6, borderRadius: 3, backgroundColor: theme.colors.divider }} />
                  </View>
                </View>
              </View>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center' }}>
                {activeTab === 'upcoming' ? t('orders.noUpcoming') : t('orders.noPast')}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                {activeTab === 'upcoming' ? t('orders.emptyDesc') : t('orders.emptyPastDesc')}
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)' as never)}
                style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16, paddingVertical: 14, paddingHorizontal: 32, marginTop: 24 }}
                accessibilityLabel={t('orders.findBasket')}
                accessibilityRole="button"
              >
                <Text style={{ color: '#fff', ...theme.typography.button }}>
                  {t('orders.findBasket')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Cancel warning popup — shown when user taps "Annuler" on a reservation.
          Confirming here navigates to /cancel-reservation to pick a reason. */}
      <Modal
        visible={!!cancelWarning}
        transparent
        animationType="none"
        onRequestClose={closeCancelSheet}
      >
        {/* Backdrop fades IN PLACE (opacity only) — decoupled from the sheet so
            it doesn't slide up with it. Tapping it dismisses. */}
        <Animated.View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)', opacity: cancelBackdropOpacity }}>
          <TouchableOpacity activeOpacity={1} onPress={closeCancelSheet} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          {/* Sheet slides up (entrance) and tracks the finger (drag-dismiss).
              The two translateY transforms stack additively. */}
          <Animated.View style={{ transform: [{ translateY: cancelSheetY }, { translateY: cancelSwipe.translateY }] }}>
          <PaperSurface radius={24} shadow="lg" style={{ width: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingTop: 10, paddingBottom: insets.bottom + 20 }}>
            {/* Drag handle — swipe down here to dismiss. Extra padding gives a
                comfortable grab zone around the pill. */}
            <View {...cancelSwipe.panHandlers} style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 14 }}>
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.divider }} />
            </View>
            <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
              <View style={{ backgroundColor: theme.colors.surfaceMuted, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <AlertTriangle size={28} color={theme.colors.warning} />
              </View>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' as const, textAlign: 'center', marginBottom: 4 }}>
                {t('orders.cancelConfirmTitle', { defaultValue: 'Annuler cette commande ?' })}
              </Text>
              {cancelWarning?.merchantName ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16 }}>
                  {cancelWarning.merchantName}
                </Text>
              ) : null}
            </View>

            <View style={{ paddingHorizontal: 20, paddingBottom: 24 }}>
              <View style={{ backgroundColor: theme.colors.surfaceMuted, borderRadius: 14, padding: 16, gap: 10, marginBottom: 20, borderWidth: 1, borderColor: theme.colors.border }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const }}>
                  {t('orders.cancelConsequences', { defaultValue: 'Si vous annulez :' })}
                </Text>
                {/* Each consequence row uses `alignItems: 'flex-start'` and
                    its Text carries `flex: 1` so long translations wrap to a
                    new line inside the gray box instead of running off the
                    right edge. The bold inline `−X XP` / level-delta spans
                    are nested inside the outer Text so they wrap together. */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <Zap size={14} color={theme.colors.error} style={{ marginTop: 3 }} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                    {t('orders.cancelXpLoss', { defaultValue: 'Vous perdez' })}{' '}
                    <Text style={{ fontWeight: '700' as const }}>−{cancelWarning?.xpLoss ?? 0} XP</Text>
                  </Text>
                </View>
                {cancelWarning && cancelWarning.levelAfter < cancelWarning.levelBefore && (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.error, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' as const, lineHeight: 14 }}>▼</Text>
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                      {t('orders.cancelLevelDrop', { defaultValue: 'Niveau' })}{' '}
                      <Text style={{ fontWeight: '700' as const }}>{cancelWarning.levelBefore} → {cancelWarning.levelAfter}</Text>
                    </Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <ShoppingBag size={14} color={theme.colors.error} style={{ marginTop: 3 }} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                    {t('orders.cancelBasketReturned', { defaultValue: 'Le panier est rendu au commerce' })}
                  </Text>
                </View>
                {/* Refund disclosure — slice by slice. A buyer cancelling
                    their own order FORFEITS any credits they applied (the
                    consequence the user explicitly asked for); the card
                    slice (if any) still comes back as wallet credits; the
                    cash slice never moves. The rows render independently
                    so a partial credit + card order surfaces BOTH lines. */}
                {(cancelWarning?.creditAmount ?? 0) > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <AlertTriangle size={14} color="#d97706" style={{ marginTop: 3 }} />
                    <Text style={{ color: '#d97706', ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                      {t('orders.cancelCreditsForfeit', { defaultValue: 'Vos crédits utilisés ne seront pas remboursés', amount: (cancelWarning?.creditAmount ?? 0).toFixed(2) })}
                    </Text>
                  </View>
                ) : null}
                {cancelWarning?.paymentMethod === 'card' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <ShoppingBag size={14} color="#16a34a" style={{ marginTop: 3 }} />
                    <Text style={{ color: '#16a34a', ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                      {t('orders.cancelRefundCardCredits', { defaultValue: 'Le paiement par carte sera remboursé en crédits' })}
                    </Text>
                  </View>
                ) : cancelWarning?.paymentMethod === 'cash' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <AlertTriangle size={14} color="#d97706" style={{ marginTop: 3 }} />
                    <Text style={{ color: '#d97706', ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                      {t('orders.cancelNoRefundCash', { defaultValue: 'Aucun remboursement — paiement sur place' })}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 16, lineHeight: 20 }}>
                {t('orders.cancelIrreversible', { defaultValue: 'Cette action est irréversible et ne peut pas être annulée.' })}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={closeCancelSheet}
                  style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
                    {t('orders.keepOrder', { defaultValue: 'Garder' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleConfirmCancelFromWarning}
                  style={{ flex: 1, backgroundColor: theme.colors.error, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
                    {t('orders.cancelContinue', { defaultValue: 'Annuler' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </PaperSurface>
          </Animated.View>
        </Animated.View>
      </Modal>

      {/* Error modal */}
      <Modal visible={!!errorMsg} transparent animationType="fade" onRequestClose={() => setErrorMsg(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <BarakeatErrorIcon size={28} color="#ef4444" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('auth.error')}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {errorMsg}
            </Text>
            <TouchableOpacity onPress={() => setErrorMsg(null)} style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}>
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
  header: {},
  tabs: {
    flexDirection: 'row',
  },
  tab: {},
  content: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
});
