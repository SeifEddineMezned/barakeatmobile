import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, ActivityIndicator, Image, Modal, Share, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X, Minus, Plus, Banknote, CreditCard, Check, AlertTriangle, Copy, Download, Zap, ShoppingBag, Wallet } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchBasketById } from '@/src/services/baskets';
import { createReservation, fetchReservationQRCode, fetchMyReservations } from '@/src/services/reservations';
import { fetchWallet } from '@/src/services/wallet';
import { updateStreak, fetchGamificationStats, type StreakUpdateResult } from '@/src/services/gamification';
// import { scheduleLocalNotification } from '@/src/services/pushNotifications';
import { getErrorMessage } from '@/src/lib/api';
import { calcLevelProgress } from '@/src/lib/impactCalculations';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { isPickupWindowOpenInTz } from '@/src/utils/timezone';
import { useCelebrationStore } from '@/src/stores/celebrationStore';
import { useHeroStore } from '@/src/stores/heroStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';
import {
  DEMO_LOCATION_ID,
  DEMO_BASKET_ID,
  buildDemoRawBasketById,
} from '@/src/lib/demoData';
import { BottomSheet } from '@/src/components/BottomSheet';
import { useBottomSafePadding } from '@/src/hooks/useBottomSafePadding';

export default function ReserveScreen() {
  const { basketId } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credits'>('cash');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bottom-safe padding for the sticky confirm bar — lifts the CTA above
  // Samsung virtual nav buttons while extending the bar's bg to the edge.
  const bottomSafePadding = useBottomSafePadding(16);

  // Confirmation animation state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmPhase, setConfirmPhase] = useState<'bouncing' | 'success'>('bouncing');
  const [confirmData, setConfirmData] = useState<{ pickupCode: string; pickupStart: string; pickupEnd: string; address: string; qrCodeUrl?: string; basketImageUrl?: string; locationName?: string } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [streakData, setStreakData] = useState<StreakUpdateResult | null>(null);
  const setCelebration = useCelebrationStore((s) => s.setPending);
  const dismissConfirmAndNavigate = () => {
    setShowConfirmation(false);
  };

  // Gamification stats query
  const gamificationQuery = useQuery({
    queryKey: ['gamification-stats'],
    queryFn: fetchGamificationStats,
    staleTime: 60_000,
  });

  // Wallet query — drives the "Pay with credits" tile balance + sufficient-funds check
  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    staleTime: 30_000,
  });
  const walletBalance = Number(walletQuery.data?.balance ?? 0);

  const handleCopyCode = async () => {
    if (!confirmData?.pickupCode) return;
    try {
      await Share.share({ message: confirmData.pickupCode });
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleShareQR = async () => {
    if (!confirmData) return;
    try {
      await Share.share({
        message: `Barakeat Pickup Code: ${confirmData.pickupCode}\nPickup: ${confirmData.pickupStart} - ${confirmData.pickupEnd}\n${confirmData.address}`,
      });
    } catch {
      // ignore
    }
  };

  // Letter bounce animations
  const BARAKEAT = 'Barakeat'.split('');
  const letterAnims = React.useRef(BARAKEAT.map(() => new Animated.Value(0))).current;

  const startBouncingAnimation = () => {
    letterAnims.forEach(a => a.setValue(0));
    const runWave = () => {
      letterAnims.forEach(a => a.setValue(0));
      Animated.stagger(80,
        letterAnims.map((anim) =>
          Animated.sequence([
            Animated.timing(anim, { toValue: -15, duration: 160, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }),
          ])
        )
      ).start(({ finished }) => {
        if (finished) setTimeout(runWave, 600);
      });
    };
    runWave();
  };

  // Demo short-circuit — when basketId points at the demo fixture, we never
  // hit the backend. URL-based (no flag check) for robustness against
  // walkthrough flag races; reserve.tsx is only reachable through the
  // demo flow so a real user can't accidentally land here.
  useWalkthroughStore((s) => s.demoCustomerActive); // subscribe for re-render
  const isDemoReserve = String(basketId) === DEMO_BASKET_ID;

  // Redundant step-advance + currentStep publish — same pattern as on the
  // restaurant and basket demo pages. Without the explicit setCurrentStep,
  // the SubScreenWalkthroughOverlay's keys filter doesn't see the new
  // measureKey until the (tabs)/_layout's backgrounded [step] effect fires.
  React.useEffect(() => {
    if (!isDemoReserve) return;
    const state = useWalkthroughStore.getState();
    // Clear stale rects from any previous demo run BEFORE the page lays
    // out (see restaurant/[id].tsx for the same fix and rationale). All
    // three reserve-step keys re-publish from this page's own useEffects
    // and onLayout handlers below, so clearing here can't strand them on
    // a dim mask.
    state.setMeasuredRect('reserveQtySection', null);
    state.setMeasuredRect('reservePaymentSection', null);
    state.setMeasuredRect('reserveConfirmBtn', null);
    if (state.currentStep?.measureKey !== 'basketReserveBtn') return;
    state.nextStep(Number.MAX_SAFE_INTEGER);
    state.setCurrentStep({
      measureKey: 'reserveQtySection',
      titleKey: 'walkthrough.customer.reserveQty.title',
      descKey: 'walkthrough.customer.reserveQty.desc',
      tooltipPosition: 'bottom',
      isLast: false,
      stepIndex: 4,
      totalSteps: 20,
      requireTap: false,
    });
  }, [isDemoReserve]);

  // Auto-scroll: when the walkthrough's `reservePaymentSection` step fires,
  // scroll the ScrollView down so the payment row enters the viewport
  // before the halo lands. Without this, the halo lands on the off-screen
  // payment row and the user has to manually scroll to see it.
  // The payment section sits roughly 380-440px into the scroll content
  // (after basket header + qty selector + price summary), so we scroll to
  // ~360 to center the buttons. After the scroll animation settles the
  // payment row's onLayout re-fires with its NEW window position, and the
  // halo updates accordingly.
  const scrollRef = useRef<ScrollView>(null);
  const paymentSectionRef = useRef<View>(null);
  const qtySectionRef = useRef<View>(null);
  const currentStepMeasureKey = useWalkthroughStore((s) => s.currentStep?.measureKey);

  // Step-driven re-measure of the quantity section. Mirrors the credits /
  // recharge / payment pattern: when the step fires, schedule a 150 ms
  // settle then republish the rect from the ref. No scroll, no clear —
  // qty sits at the top of the page and the user wants its halo unaffected
  // by any scroll mechanics. The settle window covers the case where
  // images / fonts above the section finish loading after the initial
  // onLayout already published an early rect.
  React.useEffect(() => {
    if (!isDemoReserve) return;
    if (currentStepMeasureKey !== 'reserveQtySection') return;
    const t = setTimeout(() => {
      qtySectionRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('reserveQtySection', { x, y, w, h });
      });
    }, 150);
    return () => clearTimeout(t);
  }, [isDemoReserve, currentStepMeasureKey]);
  React.useEffect(() => {
    if (!isDemoReserve) return;
    if (currentStepMeasureKey !== 'reservePaymentSection') return;
    // CRITICAL: clear the stale rect BEFORE scrolling. The payment section's
    // onLayout already published a rect at its pre-scroll window y; if we
    // leave it in the store, SubScreenWalkthroughOverlay takes its fast path
    // (haveRect → setHaloReady(true) immediately) and paints the halo at the
    // wrong y for ~380 ms before the post-scroll re-measure lands. Clearing
    // forces the overlay into its "dim mask only while we wait" branch — the
    // user sees the dim transition, then the halo appears directly at the
    // correct position, no jitter.
    useWalkthroughStore.getState().setMeasuredRect('reservePaymentSection', null);
    scrollRef.current?.scrollTo({ y: 360, animated: true });
    // onLayout doesn't refire on scroll (scrolling isn't a layout change),
    // so the section's `measureInWindow` rect would still report its
    // pre-scroll window y — the halo would land above where the section
    // actually is on screen. We re-measure manually once the scroll
    // animation has settled (~300 ms) and republish the rect.
    const t = setTimeout(() => {
      paymentSectionRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('reservePaymentSection', { x, y, w, h });
      });
    }, 380);
    return () => clearTimeout(t);
  }, [isDemoReserve, currentStepMeasureKey]);

  // ── Step 1: Fetch the selected basket so we can derive its parent location id ──
  const basketQuery = useQuery({
    queryKey: ['basket', basketId],
    queryFn: () => fetchBasketById(String(basketId)),
    enabled: !!basketId && !isDemoReserve,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // ── Step 2: Derive the real location/restaurant id from the basket payload ──
  // The basket API returns both location_id and restaurant_id; prefer location_id.
  // For the demo path we delegate to `buildDemoRawBasketById` so the basket
  // image, the new "Chez Joe (démo)" / "Panier Surprise" naming, and the
  // dynamic-tunis-tz pickup window all match what the restaurant + basket
  // pages serve. Previously this inlined an outdated fixture with
  // `image_url: null` and stale static pickup times.
  const demoLocationName = t('walkthrough.customer.demoLocationName', { defaultValue: 'Chez Joe (démo)' });
  const rawBasketData = isDemoReserve
    ? buildDemoRawBasketById(DEMO_BASKET_ID, { restaurantName: demoLocationName })
    : (basketQuery.data as any);
  const resolvedLocationId: string | null = isDemoReserve
    ? DEMO_LOCATION_ID
    : (rawBasketData?.location_id != null ? String(rawBasketData.location_id)
      : rawBasketData?.restaurant_id != null ? String(rawBasketData.restaurant_id)
      : null);

  console.log('[Reserve] basketId:', basketId, '→ resolvedLocationId:', resolvedLocationId);

  // ── Step 3: Fetch location — only when we have the real location id ──
  const locationQuery = useQuery({
    queryKey: ['location', resolvedLocationId],
    queryFn: () => fetchLocationById(String(resolvedLocationId)),
    enabled: !!resolvedLocationId && !isDemoReserve,
  });

  const location = isDemoReserve
    ? {
        id: DEMO_LOCATION_ID,
        name: demoLocationName,
        display_name: demoLocationName,
        address: rawBasketData?.restaurant_address ?? '',
        // Use the same dynamic pickup window as the basket (computed in Tunis
        // TZ by buildDemoRawBasketById) so the location and basket agree.
        pickup_start_time: rawBasketData?.pickup_start_time ?? '',
        pickup_end_time: rawBasketData?.pickup_end_time ?? '',
      }
    : locationQuery.data;
  const locationName = location?.display_name ?? location?.name ?? rawBasketData?.restaurant_name ?? '';
  const address = location?.address ?? rawBasketData?.restaurant_address ?? rawBasketData?.location_address ?? '';

  // Prefer basket-level pickup window, fall back to location
  const pickupStart =
    rawBasketData?.pickup_start_time?.substring(0, 5) ??
    location?.pickup_start_time?.substring(0, 5) ?? '';
  const pickupEnd =
    rawBasketData?.pickup_end_time?.substring(0, 5) ??
    location?.pickup_end_time?.substring(0, 5) ?? '';

  // Use the SELECTED basket's quantity and price — not aggregated from all sibling baskets
  const basketName = rawBasketData?.name ?? rawBasketData?.basket_name ?? t('orders.surpriseBag');
  const basketImage = rawBasketData?.image_url ?? rawBasketData?.cover_image_url ?? null;
  const totalAvailable = Number(rawBasketData?.quantity ?? 0);
  const price = Number(rawBasketData?.selling_price ?? 0);
  const originalPrice = Number(rawBasketData?.original_price ?? 0);

  const reserveMutation = useMutation({
    // Use the real resolved id, not the basket id
    mutationFn: () => createReservation({ location_id: Number(resolvedLocationId), basket_id: basketId ? Number(basketId) : undefined, quantity, payment_method: paymentMethod }),
    onSuccess: async (data) => {
      console.log('[Reserve] Reservation created:', data.id);
      const pickupCode = data.pickup_code ?? data.pickupCode ?? '';

      setConfirmData({ pickupCode, pickupStart, pickupEnd, address, basketImageUrl: basketImage ?? undefined, locationName });
      setShowConfirmation(true);
      setConfirmPhase('bouncing');
      startBouncingAnimation();

      // Force refetch customer-side queries so orders tab shows the new reservation immediately
      await queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.refetchQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      void queryClient.invalidateQueries({ queryKey: ['location', resolvedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', resolvedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['basket', basketId] });
      // Favorites tab uses a flat ['baskets'] list — invalidate so its basket-count chips update too.
      void queryClient.invalidateQueries({ queryKey: ['baskets'] });
      // If paid with credits, refresh the wallet so the new balance appears immediately
      if (paymentMethod === 'credits') {
        void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      }

      // Force refetch gamification from DB FIRST so the celebration reads the
      // authoritative post-order XP rather than whatever stale value the cache held.
      const xpGained = (quantity ?? 1) * 10;
      await queryClient.invalidateQueries({ queryKey: ['gamification-stats'] });
      await queryClient.refetchQueries({ queryKey: ['gamification-stats'] });

      // Read the FRESH XP (post-order, after backend persisted).
      const freshGam = queryClient.getQueryData<any>(['gamification-stats']);
      const freshLevel = freshGam?.level;
      const freshXp: number =
        freshGam?.xp ?? (typeof freshLevel === 'object' ? (freshLevel?.xp ?? 0) : 0);
      // Derive pre-order XP by subtracting the gained amount. This is tolerant of
      // minor backend-vs-client formula drift — if the backend gave more/less XP
      // than quantity*10, the celebration still reflects the real level change.
      const preReservationXp: number = Math.max(0, freshXp - xpGained);

      // Update streak only — do NOT invalidate gamification-stats here
      try {
        const streakResult = await updateStreak();
        if (streakResult.streak_changed) {
          setStreakData(streakResult);
        }
      } catch (e) {
        console.log('[Reserve] Streak update failed (non-critical):', e);
      }

      // Schedule local pickup reminders (disabled for Expo Go compatibility)
      // TODO: Re-enable when using development build
      // try {
      //   const now = new Date();
      //   const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      //   if (pickupStart) {
      //     const startDate = new Date(`${today}T${pickupStart}`);
      //     const secsUntilStart = Math.floor((startDate.getTime() - now.getTime()) / 1000);
      //     if (secsUntilStart > 60) {
      //       void scheduleLocalNotification(
      //         t('notifications.pickupStartsTitle', { defaultValue: 'Pickup time!' }),
      //         t('notifications.pickupStartsBody', { defaultValue: 'Your order is ready for pickup.' }),
      //         secsUntilStart,
      //       );
      //     }
      //   }
      //   if (pickupEnd) {
      //     const endDate = new Date(`${today}T${pickupEnd}`);
      //     const secsUntilEnd = Math.floor((endDate.getTime() - now.getTime()) / 1000);
      //     const secsUntilWarning = secsUntilEnd - 1800; // 30 min before end
      //     if (secsUntilWarning > 60) {
      //       void scheduleLocalNotification(
      //         t('notifications.pickupEndingSoonTitle', { defaultValue: 'Pickup ending soon!' }),
      //         t('notifications.pickupEndingSoonBody', { defaultValue: 'Your pickup window closes in 30 minutes.' }),
      //         secsUntilWarning,
      //       );
      //     }
      //   }
      // } catch (e) {
      //   console.log('[Reserve] Notification scheduling failed (non-critical):', e);
      // }

      // Fetch QR code in background while bouncing/success phases play
      let qrUrl: string | undefined;
      fetchReservationQRCode(String(data.id)).then(url => { qrUrl = url; }).catch(() => {});

      // Pre-compute celebration data using the FRESH (backend-authoritative) XP.
      // levelAfter / xpInLevel / xpBandSize come from the real post-order XP;
      // levelBefore is derived by subtracting the gained amount.
      const { level: levelBefore, xpProgress: pBefore } = calcLevelProgress(preReservationXp);
      const { level: levelAfter, xpProgress: pAfter, xpInLevel, xpBandSize } = calcLevelProgress(freshXp);

      // Phase 1 (bouncing) → Phase 2 (success) after 3s → then fire celebration
      setTimeout(() => {
        setConfirmPhase('success');
        // Phase 2 (success) → fire XP celebration + navigate after 3s.
        // Do NOT dismiss the confirmation modal here — its dark-green
        // overlay needs to stay on top through the navigation transition,
        // otherwise the user sees a brief black/white gap between the
        // reserve screen sliding out and the celebration modal mounting
        // on /(tabs)/orders. The modal is dismissed below after a delay
        // long enough for the celebration to be fully visible.
        setTimeout(() => {
          setCelebration({
            xpGained,
            levelBefore,
            levelAfter,
            xpProgressBefore: pBefore,
            xpProgress: pAfter,
            xpInLevel,
            xpBandSize,
            streakChanged: !!(streakData?.streak_changed && (streakData?.current_streak ?? 0) > 0),
            newStreak: streakData?.current_streak ?? 0,
            confirmData: { pickupCode, pickupStart, pickupEnd, address, locationName, basketName, basketImage: basketImage ?? undefined, quantity, price, qrCodeUrl: qrUrl },
          });
          // Returning to the search feed after this should land on the hero,
          // not a stale collapsed (white) hero — flag a scroll reset for it.
          useHeroStore.getState().requestScrollReset();
          router.replace('/(tabs)/orders' as never);
          // Stack transition ~300 ms + celebration modal fade-in ~250 ms +
          // a small buffer → 800 ms keeps the confirmation modal
          // overlaying the screen until the celebration is fully visible.
          setTimeout(() => {
            setShowConfirmation(false);
          }, 800);
        }, 3000);
      }, 3000);
    },
    onError: async (err: any) => {
      const msg = getErrorMessage(err);
      console.log('[Reserve] Error:', msg);
      // Recovery path: the backend's POST /api/reservations does its business-
      // member notification fanout and badge work inline. Slow networks +
      // multi-member orgs can stretch the response past the client timeout
      // while the server has already committed the row. Before showing a
      // misleading "no internet" error, peek at the user's reservations list:
      // if a matching one was created in the last 2 minutes, the order
      // actually went through and we should land them on the success path.
      const rawErrMsg = String(err?.message ?? msg ?? '').toLowerCase();
      const looksLikeTimeoutOrNetwork =
        rawErrMsg.includes('network')
        || rawErrMsg.includes('timeout')
        || rawErrMsg.includes('failed to fetch')
        || rawErrMsg.includes('connexion');
      if (looksLikeTimeoutOrNetwork) {
        try {
          const reservations = await fetchMyReservations();
          const targetLocId = String(resolvedLocationId);
          const targetBasketId = basketId ? String(basketId) : null;
          const recent = reservations.find((r: any) => {
            const matchLoc = String(r.location_id ?? r.restaurant_id ?? r.basket?.location_id ?? '') === targetLocId;
            const matchBasket = !targetBasketId || String(r.basket_id ?? r.basket?.id ?? '') === targetBasketId;
            const createdRaw = r.created_at ?? r.createdAt;
            if (!createdRaw) return false;
            const ageMs = Date.now() - new Date(createdRaw).getTime();
            return matchLoc && matchBasket && ageMs >= 0 && ageMs < 2 * 60 * 1000;
          });
          if (recent) {
            console.log('[Reserve] Recovered ghost-reservation:', (recent as any).id);
            await queryClient.invalidateQueries({ queryKey: ['reservations'] });
            void queryClient.refetchQueries({ queryKey: ['reservations'] });
            // Skip the full XP celebration (we don't hold a reliable pre-XP
            // delta on the recovery path) — surface a clean success modal
            // and route to /orders where the new entry is visible.
            setConfirmData({
              pickupCode: String((recent as any).pickup_code ?? (recent as any).pickupCode ?? ''),
              pickupStart,
              pickupEnd,
              address,
              basketImageUrl: basketImage ?? undefined,
              locationName,
            });
            setShowConfirmation(true);
            setConfirmPhase('success');
            setTimeout(() => {
              setShowConfirmation(false);
              useHeroStore.getState().requestScrollReset();
              try { router.replace('/(tabs)/orders' as never); } catch {
                try { router.back(); } catch {}
              }
            }, 2200);
            return;
          }
        } catch (refetchErr) {
          console.log('[Reserve] Recovery refetch failed:', refetchErr);
        }
      }
      setErrorMessage(msg);
    },
  });

  const maxQuantity = Math.max(totalAvailable, 1);

  const handleIncrement = () => {
    if (quantity < maxQuantity) setQuantity((prev) => prev + 1);
  };

  const handleDecrement = () => {
    if (quantity > 1) setQuantity((prev) => prev - 1);
  };

  // Check if current time is within the basket's pickup window (business timezone)
  const isPickupWindowOpen = () => isPickupWindowOpenInTz(pickupStart, pickupEnd);

  const handleConfirm = () => {
    if (reserveMutation.isPending) return; // Prevent double-tap
    // Demo mode bypass — never hit the backend, never gate on pickup window
    // or credit balance (those checks reflect REAL data the demo doesn't have).
    // Flip `demoOrderActive` so the (tabs)/orders page injects the demo order
    // card, then navigate there. The walkthrough's `reserveConfirmBtn` step
    // listens for `/(tabs)/orders` and auto-advances onto the new orders-tab
    // demo steps.
    if (isDemoReserve) {
      useWalkthroughStore.getState().setDemoOrderActive(true);
      try { router.replace('/(tabs)/orders' as never); } catch {
        try { router.back(); } catch {}
      }
      return;
    }
    // Frontend validation: check basket pickup window
    if (!isPickupWindowOpen()) {
      setErrorMessage(t('errors.pickupExpired', { defaultValue: 'The pickup window has expired.' }));
      return;
    }
    // Guard: credits selection may be stale if quantity was bumped up after selecting.
    if (paymentMethod === 'credits' && walletBalance < price * quantity) {
      setErrorMessage(t('errors.insufficientCredits', { defaultValue: 'Solde insuffisant' }));
      return;
    }
    // Show the no-show warning only for cash (prepaid credit orders are already
    // paid, so the "don't ghost the merchant" copy doesn't apply).
    if (paymentMethod === 'cash') {
      setShowConfirmModal(true);
    } else {
      reserveMutation.mutate();
    }
  };

  const confirmAndReserve = () => {
    if (reserveMutation.isPending) return; // Prevent double-tap
    setShowConfirmModal(false);
    reserveMutation.mutate();
  };

  // Show loading while the basket or location are loading
  if (!isDemoReserve && (basketQuery.isLoading || (!!resolvedLocationId && locationQuery.isLoading))) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  // If basket fetch failed or returned no location id we cannot proceed
  if (!isDemoReserve && (basketQuery.isError || !resolvedLocationId || !location)) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={[{ color: theme.colors.error, ...theme.typography.body }]}>{t('common.errorOccurred')}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }} accessibilityLabel={t('common.goBack')} accessibilityRole="button">
          <Text style={[{ color: theme.colors.primary, ...theme.typography.body }]}>{t('common.goBack')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <View style={[styles.header, { padding: theme.spacing.xl }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('common.close', { defaultValue: 'Close' })} accessibilityRole="button">
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('reserve.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView ref={scrollRef} style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl }]}>
        {/* Basket info: image + name + location */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.lg }}>
          {basketImage ? (
            <Image source={{ uri: basketImage }} style={{ width: 64, height: 64, borderRadius: theme.radii.r12, marginRight: theme.spacing.md }} resizeMode="cover" accessibilityLabel={basketName} />
          ) : (
            <View style={{ width: 64, height: 64, borderRadius: theme.radii.r12, marginRight: theme.spacing.md, backgroundColor: theme.colors.primary + '10', justifyContent: 'center', alignItems: 'center' }}>
              <ShoppingBag size={24} color={theme.colors.primary} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, fontWeight: '700' }]} numberOfLines={2}>
              {basketName}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]} numberOfLines={1}>
              {locationName}
            </Text>
          </View>
        </View>

        {/* Quantity selector — halo wraps the entire white section card so
            it covers the "Quantité" label, the +/- selector, and the
            quantity number. */}
        <View
          ref={qtySectionRef}
          style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginBottom: theme.spacing.lg, ...theme.shadows.shadowSm }]}
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('reserveQtySection', { x, y, w, h });
            });
          }}
        >
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginBottom: theme.spacing.lg }]}>
            {t('reserve.quantity')}
          </Text>
          <View style={styles.quantitySelector}>
            <TouchableOpacity
              style={[styles.quantityButton, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }]}
              onPress={handleDecrement}
              disabled={quantity <= 1}
              accessibilityLabel={t('reserve.decreaseQuantity', { defaultValue: 'Decrease quantity' })}
              accessibilityRole="button"
            >
              <Minus size={20} color={quantity <= 1 ? theme.colors.muted : theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.quantityText, { color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
              {quantity}
            </Text>
            <TouchableOpacity
              style={[styles.quantityButton, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48, justifyContent: 'center', alignItems: 'center' }]}
              onPress={handleIncrement}
              disabled={quantity >= maxQuantity}
              accessibilityLabel={t('reserve.increaseQuantity', { defaultValue: 'Increase quantity' })}
              accessibilityRole="button"
            >
              <Plus size={20} color={quantity >= maxQuantity ? theme.colors.muted : theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: theme.spacing.md }]}>
            {t('reserve.basketsLeft', { count: totalAvailable })}
          </Text>
        </View>

        {/* Summary */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginBottom: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
            {t('reserve.summary')}
          </Text>
          {/* Vertical stack: basket name → quantity (× N paniers) → unit-cost
              line with price on its own row right-aligned. Splitting quantity
              and price onto their own rows makes the reservation totals
              readable in a glance instead of a single dense `Name (xN) Price`
              line. */}
          <View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]} numberOfLines={2}>
              {basketName}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 4 }]}>
              {t('reserve.basketsCount', { count: quantity, defaultValue: '× {{count}} panier(s)' })}
            </Text>
            <View style={[styles.summaryRow, { marginTop: 8, alignItems: 'flex-end' }]}>
              <Text style={[{ flex: 1, color: theme.colors.muted, ...theme.typography.caption }]}>
                {t('reserve.subtotal', { defaultValue: 'Sous-total' })}
              </Text>
              <Text style={[{ flexShrink: 0, marginLeft: 8, color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}>
                {price * quantity} TND
              </Text>
            </View>
          </View>
          {originalPrice > 0 && originalPrice > price && (
            <View style={[styles.summaryRow, { marginTop: 4 }]}>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
                {t('reserve.originalPrice', { defaultValue: 'Original' })}
              </Text>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through' }]}>
                {originalPrice * quantity} TND
              </Text>
            </View>
          )}
          <View style={[styles.totalRow, { marginTop: theme.spacing.lg, paddingTop: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>{t('reserve.total')}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const }]}>
                {price * quantity} TND
              </Text>
            </View>
          </View>
        </View>

        {/* Payment Method — halo wraps the entire section card. The
            section's window y changes after the auto-scroll fires, so we
            attach a ref that the scroll effect uses to re-publish the rect
            once the scroll settles. */}
        <View
          ref={paymentSectionRef}
          style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginBottom: theme.spacing.lg, ...theme.shadows.shadowSm }]}
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('reservePaymentSection', { x, y, w, h });
            });
          }}
        >
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 12 }}>
            {t('reserve.paymentMethod')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={() => setPaymentMethod('cash')}
              style={{
                flex: 1,
                backgroundColor: paymentMethod === 'cash' ? theme.colors.primary + '12' : theme.colors.bg,
                borderRadius: theme.radii.r16,
                padding: 16,
                borderWidth: paymentMethod === 'cash' ? 2 : 1,
                borderColor: paymentMethod === 'cash' ? theme.colors.primary : theme.colors.divider,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              accessibilityLabel={t('reserve.payCash', { defaultValue: 'Pay in Cash' })}
              accessibilityRole="radio"
              accessibilityState={{ selected: paymentMethod === 'cash' }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: paymentMethod === 'cash' ? theme.colors.primary + '18' : theme.colors.divider + '60', justifyContent: 'center', alignItems: 'center' }}>
                <Banknote size={24} color={paymentMethod === 'cash' ? theme.colors.primary : theme.colors.textSecondary} />
              </View>
              <Text style={{ color: paymentMethod === 'cash' ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
                {t('reserve.payCash', { defaultValue: 'Pay in Cash' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                {t('reserve.payCashDesc', { defaultValue: 'Pay the merchant at pickup' })}
              </Text>
            </TouchableOpacity>
            {FeatureFlags.ENABLE_CARD_PAYMENT && (
              <TouchableOpacity
                onPress={() => setPaymentMethod('card')}
                style={{
                  flex: 1,
                  backgroundColor: paymentMethod === 'card' ? theme.colors.primary + '12' : theme.colors.bg,
                  borderRadius: theme.radii.r16,
                  padding: 16,
                  borderWidth: paymentMethod === 'card' ? 2 : 1,
                  borderColor: paymentMethod === 'card' ? theme.colors.primary : theme.colors.divider,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityLabel={t('reserve.payCard', { defaultValue: 'Pay by Card' })}
                accessibilityRole="radio"
                accessibilityState={{ selected: paymentMethod === 'card' }}
              >
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: paymentMethod === 'card' ? theme.colors.primary + '18' : theme.colors.divider + '60', justifyContent: 'center', alignItems: 'center' }}>
                  <CreditCard size={24} color={paymentMethod === 'card' ? theme.colors.primary : theme.colors.textSecondary} />
                </View>
                <Text style={{ color: paymentMethod === 'card' ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
                  {t('reserve.payCard', { defaultValue: 'Pay by Card' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                  {t('reserve.payCardDesc', { defaultValue: 'Secure card payment' })}
                </Text>
              </TouchableOpacity>
            )}
            {(() => {
              const orderTotal = price * quantity;
              const hasEnough = walletBalance >= orderTotal;
              const missing = Math.max(0, orderTotal - walletBalance);
              const selected = paymentMethod === 'credits';
              const selectable = hasEnough && orderTotal > 0;
              return (
                <TouchableOpacity
                  onPress={() => { if (selectable) setPaymentMethod('credits'); }}
                  disabled={!selectable}
                  style={{
                    flex: 1,
                    backgroundColor: selected ? theme.colors.primary + '12' : theme.colors.bg,
                    borderRadius: theme.radii.r16,
                    padding: 16,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? theme.colors.primary : theme.colors.divider,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: selectable ? 1 : 0.55,
                  }}
                  accessibilityLabel={t('reserve.payCredits', { defaultValue: 'Pay with my credits' })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: !selectable }}
                >
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: selected ? theme.colors.primary + '18' : theme.colors.divider + '60', justifyContent: 'center', alignItems: 'center' }}>
                    <Wallet size={24} color={selected ? theme.colors.primary : theme.colors.textSecondary} />
                  </View>
                  <Text style={{ color: selected ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
                    {t('reserve.payCredits', { defaultValue: 'Pay with credits' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                    {hasEnough
                      ? t('reserve.payCreditsBalance', { defaultValue: 'Solde : {{balance}} TND', balance: walletBalance.toFixed(2) })
                      : t('reserve.payCreditsShort', { defaultValue: '{{missing}} TND manquants', missing: missing.toFixed(2) })}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: bottomSafePadding, borderTopWidth: 1, borderTopColor: theme.colors.divider, ...theme.shadows.shadowLg }]}
        onLayout={(e) => {
          (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
            if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('reserveConfirmBtn', { x, y, w, h });
          });
        }}
      >
        <PrimaryCTAButton
          compact
          onPress={handleConfirm}
          title={
            isDemoReserve
              ? t('reserve.confirmReservation')
              : totalAvailable <= 0
              ? t('basket.soldOut')
              : !isPickupWindowOpen()
              ? t('orders.status.expired', { defaultValue: 'Expired' })
              : t('reserve.confirmReservation')
          }
          // Demo mode keeps the CTA tappable regardless of pickup-window /
          // stock state so the walkthrough's confirm step never dead-ends.
          disabled={!isDemoReserve && (totalAvailable <= 0 || !isPickupWindowOpen() || reserveMutation.isPending)}
          loading={reserveMutation.isPending}
        />
      </View>

      {/* Cash-warning confirmation — bottom sheet. Quieter and more modern
          than the old centered icon-in-a-circle alert: inline amber warning
          icon, body copy in neutral tone, actions as a tight button row. */}
      <BottomSheet visible={showConfirmModal} onClose={() => setShowConfirmModal(false)}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <AlertTriangle size={22} color={theme.colors.warning} />
            <Text style={{ flex: 1, color: theme.colors.textPrimary, fontSize: 17, fontFamily: 'Poppins_700Bold', fontWeight: '700', letterSpacing: -0.2 }}>
              {t('reserve.confirmTitle', { defaultValue: 'Confirm Reservation' })}
            </Text>
          </View>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 21, marginBottom: 8 }}>
            {t('reserve.cashWarningIntro', { defaultValue: 'Ready to pick up this basket?\n\nIf your plans change, please cancel early, it frees up the spot for someone else.' })}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 19, marginBottom: 20 }}>
            {t('reserve.cashWarningBan', { defaultValue: 'Repeated no shows without cancelling may lead to a temporary pause on your reservations.' })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              onPress={() => setShowConfirmModal(false)}
              style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', backgroundColor: theme.colors.surfaceMuted }}
              accessibilityLabel={t('reserve.notYet', { defaultValue: 'Not Yet' })}
              accessibilityRole="button"
            >
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>
                {t('reserve.notYet', { defaultValue: 'Not Yet' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirmAndReserve}
              style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center' }}
              accessibilityLabel={t('reserve.yesReserve', { defaultValue: 'Reserve!' })}
              accessibilityRole="button"
            >
              <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                {t('reserve.yesReserve', { defaultValue: 'Reserve!' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheet>

      {/* Custom error modal (replaces Alert.alert for errors) */}
      <Modal visible={!!errorMessage} transparent animationType="fade" onRequestClose={() => setErrorMessage(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center', ...theme.shadows.shadowLg }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.error + '14', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <X size={28} color={theme.colors.error} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('reserve.error')}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 24 }}>
              {errorMessage}
            </Text>
            <TouchableOpacity
              onPress={() => setErrorMessage(null)}
              style={{ paddingVertical: 14, paddingHorizontal: 40, borderRadius: 14, backgroundColor: theme.colors.primary }}
              accessibilityLabel="OK"
              accessibilityRole="button"
            >
              <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Full-screen confirmation Modal with Barakeat bouncing animation */}
      <Modal
        visible={showConfirmation}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => { dismissConfirmAndNavigate(); }}
      >
        <View style={{ flex: 1, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
          {/* Phase 1: Processing animation */}
          {confirmPhase === 'bouncing' ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <View style={{ flexDirection: 'row' }}>
                {BARAKEAT.map((letter, i) => (
                  <Animated.Text
                    key={i}
                    style={{
                      color: '#e3ff5c',
                      fontSize: 36,
                      fontWeight: '700',
                      fontFamily: 'Poppins_700Bold',
                      transform: [{ translateY: letterAnims[i] }],
                    }}
                  >
                    {letter}
                  </Animated.Text>
                ))}
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.body, marginTop: 16 }}>
                {t('reserve.processing', { defaultValue: 'Traitement de votre réservation...' })}
              </Text>
            </View>

          ) : confirmPhase === 'success' ? (
            /* Phase 2: Confirmed with paper bag — auto-advances to XP celebration */
            <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <Image
                source={require('@/assets/images/barakeat_paper_bag.png')}
                style={{ width: 140, height: 140, marginBottom: 24 }}
                resizeMode="cover"
              />
              <View style={{ backgroundColor: '#e3ff5c', width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
                <Check size={28} color="#114b3c" />
              </View>
              <Text style={{ color: '#e3ff5c', fontSize: 22, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {t('reserve.confirmed', { defaultValue: 'Réservation confirmée !' })}
              </Text>
              {confirmData?.locationName ? (
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 8 }}>
                  {confirmData.locationName}
                </Text>
              ) : null}
            </View>

          ) : null}
        </View>
      </Modal>
      {/* Customer demo walkthrough overlay — paints spotlights on the
          quantity / payment / confirm sections so the walkthrough's
          reserve sub-tour is visible above this pushed Stack screen. */}
      <SubScreenWalkthroughOverlay keys={['reserveQtySection', 'reservePaymentSection', 'reserveConfirmBtn']} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  content: { flex: 1 },
  section: {},
  quantitySelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quantityButton: {},
  quantityText: {},
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footer: {},
});
