import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Animated, ActivityIndicator, Image, Modal, Share, Dimensions, Keyboard, Platform } from 'react-native';
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
import { fetchGamificationStats } from '@/src/services/gamification';
// import { scheduleLocalNotification } from '@/src/services/pushNotifications';
import { getErrorMessage, makeAttemptKey } from '@/src/lib/api';
import { calcLevelProgress } from '@/src/lib/impactCalculations';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { isPickupWindowOpenInTz, effectiveLocationHours } from '@/src/utils/timezone';
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
import CelebrationView from '@/src/components/animations/CelebrationView';

export default function ReserveScreen() {
  const { basketId } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  // The remainder method funds whatever isn't covered by wallet credits.
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  // Wallet credits to apply, as the raw text in the credits input (TND). Kept as
  // a string so the user can type decimals freely; the numeric amount actually
  // applied is derived + clamped to [0, min(balance, total)] below.
  const [creditsInput, setCreditsInput] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bottom-safe padding for the sticky confirm bar — lifts the CTA above
  // Samsung virtual nav buttons while extending the bar's bg to the edge.
  const bottomSafePadding = useBottomSafePadding(16);

  // Confirmation animation state
  const [showConfirmation, setShowConfirmation] = useState(false);
  // Three phases now run INSIDE this single Modal — bouncing → success →
  // celebration. The previous design handed off from this modal to a global
  // <PostReservationCelebration/> modal at "success", which on Android
  // produced a brief black frame during the window swap. Keeping everything
  // in one Modal removes that race entirely.
  const [confirmPhase, setConfirmPhase] = useState<'bouncing' | 'success' | 'celebration'>('bouncing');
  const [confirmData, setConfirmData] = useState<{ pickupCode: string; pickupStart: string; pickupEnd: string; address: string; qrCodeUrl?: string; basketImageUrl?: string; locationName?: string } | null>(null);
  const [celebrationData, setCelebrationData] = useState<import('@/src/stores/celebrationStore').CelebrationData | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const setPendingOrderConfirm = useCelebrationStore((s) => s.setPendingOrderConfirm);
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

  // Keyboard-aware bottom padding so the credits TextInput at the bottom of
  // the form can be scrolled above the on-screen keyboard. Without this the
  // keyboard appeared over the input and the user couldn't scroll down to
  // see what they were typing. The padding is added to the ScrollView's
  // contentContainer so the underlying layout doesn't shift — only the
  // scroll range grows.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [creditsFocused, setCreditsFocused] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  // When the user taps the credits input, scroll the bottom of the content
  // into view above the keyboard. The credits row is the last thing in the
  // ScrollView; passing y=99999 to scrollTo lets RN clamp to the actual
  // content end, AND — unlike scrollToEnd — issues a fresh scroll command
  // every time, so it doesn't silently no-op on subsequent taps when the
  // visual scroll position hasn't changed (which was the "second tap does
  // nothing" bug on some phones).
  const scrollCreditsIntoView = React.useCallback(() => {
    scrollRef.current?.scrollTo?.({ y: 99999, animated: true });
  }, []);
  // Re-scroll whenever the keyboard re-shows while the credits input is
  // focused. On the first tap the onFocus → setTimeout(250) catches the
  // keyboard's appearance, but on subsequent taps the keyboardWillShow
  // event can race ahead of (or behind) the setTimeout, leaving the
  // scroll target stale. This effect fires exactly when keyboardHeight
  // transitions to a non-zero value with the input focused, guaranteeing
  // the row lands above the keyboard on every tap.
  useEffect(() => {
    if (!creditsFocused || keyboardHeight === 0) return;
    scrollCreditsIntoView();
  }, [creditsFocused, keyboardHeight, scrollCreditsIntoView]);

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

  // Prefer basket-level pickup window, fall back to the location's effective
  // hours for TODAY (per-day weekly_schedule wins over the flat widest span).
  const locEff = effectiveLocationHours(location as any);
  const pickupStart =
    rawBasketData?.pickup_start_time?.substring(0, 5) ?? (locEff.start || '');
  const pickupEnd =
    rawBasketData?.pickup_end_time?.substring(0, 5) ?? (locEff.end || '');

  // Use the SELECTED basket's quantity and price — not aggregated from all sibling baskets
  const basketName = rawBasketData?.name ?? rawBasketData?.basket_name ?? t('orders.surpriseBag');
  const basketImage = rawBasketData?.image_url ?? rawBasketData?.cover_image_url ?? null;
  const totalAvailable = Number(rawBasketData?.quantity ?? 0);
  const price = Number(rawBasketData?.selling_price ?? 0);
  const originalPrice = Number(rawBasketData?.original_price ?? 0);

  // Wallet-credit partial discount. When enabled, apply as much of the wallet
  // balance as possible (capped at the order total); the remainder is funded by
  // the selected cash/card method. Rounded to millime to match the backend.
  const orderTotalDT = price * quantity;
  // You can't apply more credits than you have, nor more than the order total.
  const maxCreditDT = Math.round(Math.max(0, Math.min(walletBalance, orderTotalDT)) * 1000) / 1000;
  const parsedCredits = parseFloat((creditsInput || '').replace(',', '.'));
  const creditApplied = Math.round(Math.max(0, Math.min(isFinite(parsedCredits) ? parsedCredits : 0, maxCreditDT)) * 1000) / 1000;
  const remainingDueDT = Math.max(0, Math.round((orderTotalDT - creditApplied) * 1000) / 1000);

  // Keep the typed credits within the current max — e.g. after the quantity (and
  // thus the total) drops, or once the wallet balance loads. Functional update so
  // this only re-runs when the cap changes, not on every keystroke.
  useEffect(() => {
    setCreditsInput((prev) => {
      const n = parseFloat((prev || '').replace(',', '.'));
      if (isFinite(n) && n > maxCreditDT) return maxCreditDT > 0 ? String(maxCreditDT) : '';
      return prev;
    });
  }, [maxCreditDT]);

  // Stepper: nudge the applied credits by ±1 TND, clamped to [0, max].
  const stepCredits = (delta: number) => {
    const next = Math.round(Math.max(0, Math.min(creditApplied + delta, maxCreditDT)) * 1000) / 1000;
    setCreditsInput(next > 0 ? String(next) : '');
  };
  // Display helper: integers stay clean ("5 TND"), fractions show 2 decimals.
  const fmtDT = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  // Per-attempt idempotency key. Generated the first time the user hits
  // Confirmer for a given cart state and re-used on every retry of THAT
  // attempt — so a network error → user-retry → eventual success creates
  // ONE reservation server-side, not two. Reset whenever the cart changes
  // (qty, credit, payment method, basket, location) so an intentional
  // second order with a different shape gets its own fresh key.
  const attemptKeyRef = useRef<string | null>(null);
  useEffect(() => {
    attemptKeyRef.current = null;
  }, [quantity, paymentMethod, creditApplied, basketId, resolvedLocationId]);

  const reserveMutation = useMutation({
    // Use the real resolved id, not the basket id
    mutationFn: () => {
      // Lazily mint the key — runs the first time the user actually submits
      // for this cart state. See makeAttemptKey() in src/lib/api.ts.
      if (!attemptKeyRef.current) attemptKeyRef.current = makeAttemptKey();
      return createReservation({
        location_id: Number(resolvedLocationId),
        basket_id: basketId ? Number(basketId) : undefined,
        quantity,
        payment_method: paymentMethod,
        credit_amount: creditApplied,
        // Defer the server's notification fan-out (buyer's "Commande confirmée"
        // bell row + push, every business member's "Nouvelle commande" bell
        // row + push) until after the in-app confirmation animation finishes.
        // Total animation: 3 s bouncing + 3 s "Réservation confirmée" + the
        // celebration hand-off — 6 s covers the visible window cleanly, so a
        // partner's lock-screen ping no longer arrives while the buyer is
        // still watching the bag tip.
        notification_delay_ms: 6000,
        idempotency_key: attemptKeyRef.current,
      });
    },
    onSuccess: async (data) => {
      // Clear the attempt key now that this reservation is durably committed.
      // A subsequent cart-state change resets it too (see useEffect above),
      // but clearing here guarantees a fresh key for any next attempt even
      // if the cart inputs aren't touched.
      attemptKeyRef.current = null;
      console.log('[Reserve] Reservation created:', data.id);
      // Clip to 6 chars to match the new shorter-code policy across the
      // app. The backend may still return a legacy 8-char value for
      // older reservations; what the customer sees on the success page
      // and what the merchant types into the verify modal both need to
      // be the same 6-char string for the pickup match to succeed.
      const pickupCode = String(data.pickup_code ?? data.pickupCode ?? '').substring(0, 6).toUpperCase();

      setConfirmData({ pickupCode, pickupStart, pickupEnd, address, basketImageUrl: basketImage ?? undefined, locationName });
      setShowConfirmation(true);
      setConfirmPhase('bouncing');
      startBouncingAnimation();

      // Fire-and-forget invalidations. Awaiting them (especially the reservations
      // refetch, which fans out to whatever else subscribes to that key) used to
      // delay the phase-transition setTimeout chain below — on a slow network
      // the bouncing modal would play, finish, then sit idle for several seconds
      // before jump-cutting to success. The user sees that as "the animation
      // skipped entirely even though the order went through". Decoupling lets
      // the wall-clock 3 s + 3 s schedule run unblocked.
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.refetchQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      void queryClient.invalidateQueries({ queryKey: ['location', resolvedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', resolvedLocationId] });
      void queryClient.invalidateQueries({ queryKey: ['basket', basketId] });
      // Favorites tab uses a flat ['baskets'] list — invalidate so its basket-count chips update too.
      void queryClient.invalidateQueries({ queryKey: ['baskets'] });
      // If any credits were applied, refresh the wallet so the new balance appears immediately
      if (creditApplied > 0) {
        void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      }

      const xpGained = (quantity ?? 1) * 10;
      // Kick off the gamification refetch in parallel — by the time phase 3
      // fires (~6 s from now) the cache value is overwhelmingly likely to be
      // fresh. The celebration reads `getQueryData` AT THAT MOMENT inside the
      // setTimeout below, so it always gets the latest cache state without
      // blocking the animation timeline.
      void queryClient.invalidateQueries({ queryKey: ['gamification-stats'] }).then(
        () => queryClient.refetchQueries({ queryKey: ['gamification-stats'] })
      ).catch(() => {});

      // NOTE: the streak (and last_pickup_date / "dernière commande") is NOT
      // touched here. Reserving a basket must not advance the streak — it only
      // advances when the basket is actually PICKED UP, which the backend
      // handles server-side in POST /reservations/:id/confirm-pickup. Keeping
      // it server-side also means the streak is correct even if the buyer
      // never reopens the app at pickup time.

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

      // Hold notification popups + foreground push banners for the duration of
      // the new-order animation (this reserve success screen → the XP
      // celebration), so the "order confirmed" push to the buyer's own device
      // never pops OVER the animation. `pending` (set ~6s in, below) covers the
      // celebration tail; the safety timeout clears this if anything aborts.
      useCelebrationStore.getState().setOrderFlowActive(true);
      setTimeout(() => useCelebrationStore.getState().setOrderFlowActive(false), 9000);

      // Phase 1 (bouncing) → Phase 2 (success) after 3s → Phase 3 (celebration)
      // after another 3s. All three phases render inside the SAME Modal, so
      // the user sees one continuous green panel that swaps content — no
      // Modal→Modal handoff means no black frame on Android.
      // Wall-clock timing: the chain runs on a fixed 3 s + 3 s schedule from
      // the moment the API returned success, independent of how long the
      // background gamification refetch takes. Phase 3 reads the cache value
      // INSIDE its setTimeout, so it picks up whatever fresh data has arrived
      // by then (the refetch had ~6 s to land — overwhelmingly enough). If
      // somehow still stale, the predicted xpGained keeps the celebration
      // sensible — no broken animation either way.
      setTimeout(() => {
        setConfirmPhase('success');
        setTimeout(() => {
          // Read FRESH gamification at celebration time, not at API-success time
          // — the refetch we kicked off above has had ~6 s to resolve.
          const freshGam = queryClient.getQueryData<any>(['gamification-stats']);
          const freshLevel = freshGam?.level;
          const freshXp: number =
            freshGam?.xp ?? (typeof freshLevel === 'object' ? (freshLevel?.xp ?? 0) : 0);
          // Derive pre-order XP by subtracting the gained amount. Tolerant of
          // minor backend-vs-client formula drift.
          const preReservationXp: number = Math.max(0, freshXp - xpGained);
          const { level: levelBefore, xpProgress: pBefore } = calcLevelProgress(preReservationXp);
          const { level: levelAfter, xpProgress: pAfter, xpInLevel, xpBandSize } = calcLevelProgress(freshXp);

          setCelebrationData({
            xpGained,
            levelBefore,
            levelAfter,
            xpProgressBefore: pBefore,
            xpProgress: pAfter,
            xpInLevel,
            xpBandSize,
            // Streak never changes on reservation (only on pickup), so the
            // reservation celebration never shows a streak bump.
            streakChanged: false,
            newStreak: 0,
            confirmData: { reservationId: String(data.id), pickupCode, pickupStart, pickupEnd, address, locationName, basketName, basketImage: basketImage ?? undefined, quantity, price, qrCodeUrl: qrUrl, paymentMethod, creditAmount: creditApplied },
          });
          setConfirmPhase('celebration');
        }, 3000);
      }, 3000);
    },
    onError: async (err: any) => {
      // Pass the reservation-specific copy as the fallback so the popup's
      // body reads "Veuillez essayer ultérieurement" for generic / unknown
      // server errors, instead of the global "Une erreur est survenue.
      // Veuillez réessayer." Specific mapped errors (pickup expired, basket
      // sold out, etc.) still surface their own translated message via the
      // i18n-key lookup inside getErrorMessage — the fallback only kicks in
      // when the raw error has no known mapping.
      const msg = getErrorMessage(err, t('reserve.errorBody', { defaultValue: 'Veuillez essayer ultérieurement.' }));
      console.log('[Reserve] Error:', msg);
      // Recovery path: the backend's POST /api/reservations does its business-
      // member notification fanout and badge work inline. Slow networks +
      // multi-member orgs can stretch the response past the client timeout
      // while the server has already committed the row. Before showing a
      // misleading "no internet" error, peek at the user's reservations list:
      // if a matching one was created in the last 2 minutes, the order
      // actually went through and we should land them on the success path.
      const rawErrMsg = String(err?.message ?? msg ?? '').toLowerCase();
      const status = Number(err?.status);
      // Cases where we genuinely don't know whether the backend committed the
      // row before the request died. Trigger recovery so we can check the
      // user's reservation list before showing a misleading failure popup.
      //   • No response at all (axios `!error.response`) → status is NaN/0
      //   • 5xx — backend or proxy errored AFTER potentially committing
      //   • 502 / 503 / 504 — same uncertainty from intermediaries
      //   • 408 (Request Timeout) — gateway gave up reading our response
      //   • Message includes "network" / "timeout" / "failed to fetch" /
      //     "connexion" — older axios shapes that don't set .status
      // 4xx (other than 408) means the backend rejected the request before
      // committing, so recovery would only find an UNRELATED prior order →
      // skipped intentionally.
      const isUnknownStatus = !Number.isFinite(status) || status === 0;
      const isServerUncertain = status >= 500 || status === 408;
      const isNetworkMessage =
        rawErrMsg.includes('network')
        || rawErrMsg.includes('timeout')
        || rawErrMsg.includes('failed to fetch')
        || rawErrMsg.includes('connexion');
      const looksLikeMaybeSucceeded = isUnknownStatus || isServerUncertain || isNetworkMessage;
      if (looksLikeMaybeSucceeded) {
        try {
          const reservations = await fetchMyReservations();
          const targetLocId = String(resolvedLocationId);
          const targetBasketId = basketId ? String(basketId) : null;
          const targetIdemKey = attemptKeyRef.current;
          // Prefer an exact idempotency-key match — backend writes the key
          // onto the row, so this is the precise "is the order I just tried
          // to create now in the list?" check. Falls back to the legacy
          // location + basket + 2-minute heuristic so older successful POSTs
          // (where the user-tap predated this feature, or the key got
          // stripped by a proxy) still recover correctly.
          let recent = targetIdemKey
            ? reservations.find((r: any) => String(r.idempotency_key ?? '') === targetIdemKey)
            : undefined;
          if (!recent) {
            recent = reservations.find((r: any) => {
              const matchLoc = String(r.location_id ?? r.restaurant_id ?? r.basket?.location_id ?? '') === targetLocId;
              const matchBasket = !targetBasketId || String(r.basket_id ?? r.basket?.id ?? '') === targetBasketId;
              const createdRaw = r.created_at ?? r.createdAt;
              if (!createdRaw) return false;
              const ageMs = Date.now() - new Date(createdRaw).getTime();
              return matchLoc && matchBasket && ageMs >= 0 && ageMs < 2 * 60 * 1000;
            });
          }
          if (recent) {
            console.log('[Reserve] Recovered ghost-reservation:', (recent as any).id);
            // Order is durably committed; clear the attempt key so a future
            // intentional retry mints a fresh one.
            attemptKeyRef.current = null;
            await queryClient.invalidateQueries({ queryKey: ['reservations'] });
            void queryClient.refetchQueries({ queryKey: ['reservations'] });
            // Skip the full XP celebration (we don't hold a reliable pre-XP
            // delta on the recovery path) — surface a clean success modal
            // and route to /orders where the new entry is visible.
            setConfirmData({
              pickupCode: String((recent as any).pickup_code ?? (recent as any).pickupCode ?? '').substring(0, 6).toUpperCase(),
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
    // creditApplied is already clamped to [0, min(balance, total)] in render, so
    // there's nothing extra to validate here.
    // Show the no-show warning only when there's a CASH remainder still to be
    // collected at pickup. A fully credit-funded order (remainder = 0) is
    // already paid, so the "don't ghost the merchant" copy doesn't apply.
    if (paymentMethod === 'cash' && remainingDueDT > 0) {
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
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} accessibilityLabel={t('common.close', { defaultValue: 'Close' })} accessibilityRole="button">
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('reserve.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={[{ padding: theme.spacing.xl, paddingBottom: theme.spacing.md + keyboardHeight }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
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
          {/* Quantity row — label left, count on the right like the price rows. */}
          <View style={[styles.summaryRow, { alignItems: 'flex-end' }]}>
            <Text style={[{ flex: 1, color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
              {t('reserve.basketsQuantity', { defaultValue: 'Quantité de paniers' })}
            </Text>
            <Text style={[{ flexShrink: 0, marginLeft: 8, color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
              {quantity}
            </Text>
          </View>
          {/* Original price — struck through (only when there's a discount).
              Original / Barakeat / credits rows all share the same bodySm size. */}
          {originalPrice > 0 && originalPrice > price && (
            <View style={[styles.summaryRow, { marginTop: 4, alignItems: 'flex-end' }]}>
              <Text style={[{ flex: 1, color: theme.colors.muted, ...theme.typography.bodySm }]}>
                {t('reserve.originalPrice', { defaultValue: 'Prix Original' })}
              </Text>
              <Text style={[{ flexShrink: 0, marginLeft: 8, color: theme.colors.muted, ...theme.typography.bodySm, textDecorationLine: 'line-through' as const }]}>
                {originalPrice * quantity} {t('common.currency', { defaultValue: 'TND' })}
              </Text>
            </View>
          )}
          {/* Barakeat (discounted) price. */}
          <View style={[styles.summaryRow, { marginTop: 4, alignItems: 'flex-end' }]}>
            <Text style={[{ flex: 1, color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
              {t('reserve.barakeatPrice', { defaultValue: 'Prix sur Barakeat' })}
            </Text>
            <Text style={[{ flexShrink: 0, marginLeft: 8, color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
              {price * quantity} {t('common.currency', { defaultValue: 'TND' })}
            </Text>
          </View>
          {/* Credits applied — shown as 0 or −X so the math to the total is clear. */}
          {walletBalance > 0 && orderTotalDT > 0 && (
            <View style={[styles.summaryRow, { marginTop: 4, alignItems: 'flex-end' }]}>
              <Text style={[{ flex: 1, color: theme.colors.primary, ...theme.typography.bodySm }]}>
                {t('reserve.creditsApplied', { defaultValue: 'Crédits appliqués' })}
              </Text>
              <Text style={[{ flexShrink: 0, marginLeft: 8, color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                {creditApplied > 0 ? `−${creditApplied.toFixed(2)}` : '0'} {t('common.currency', { defaultValue: 'TND' })}
              </Text>
            </View>
          )}
          {/* 4. Total = Barakeat price − credits applied. */}
          <View style={[styles.totalRow, { marginTop: theme.spacing.lg, paddingTop: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>{t('reserve.total')}</Text>
            <Text style={[{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const }]}>
              {fmtDT(remainingDueDT)} {t('common.currency', { defaultValue: 'TND' })}
            </Text>
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
          {FeatureFlags.ENABLE_CARD_PAYMENT ? (
            // Online payment enabled → two side-by-side choices (cash / card).
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setPaymentMethod('cash')}
                style={{ flex: 1, backgroundColor: paymentMethod === 'cash' ? theme.colors.primary + '12' : theme.colors.bg, borderRadius: theme.radii.r16, padding: 16, borderWidth: paymentMethod === 'cash' ? 2 : 1, borderColor: paymentMethod === 'cash' ? theme.colors.primary : theme.colors.divider, alignItems: 'center', justifyContent: 'flex-start' }}
                accessibilityLabel={t('reserve.payCash', { defaultValue: 'Pay on-site' })}
                accessibilityRole="radio"
                accessibilityState={{ selected: paymentMethod === 'cash' }}
              >
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: paymentMethod === 'cash' ? theme.colors.primary + '18' : theme.colors.divider + '60', justifyContent: 'center', alignItems: 'center' }}>
                  <Banknote size={24} color={paymentMethod === 'cash' ? theme.colors.primary : theme.colors.textSecondary} />
                </View>
                <Text style={{ color: paymentMethod === 'cash' ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
                  {t('reserve.payCash', { defaultValue: 'Pay on-site' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4, textAlign: 'center' }}>
                  {t('reserve.payCashDesc', { defaultValue: 'Pay the merchant at pickup' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setPaymentMethod('card')}
                style={{ flex: 1, backgroundColor: paymentMethod === 'card' ? theme.colors.primary + '12' : theme.colors.bg, borderRadius: theme.radii.r16, padding: 16, borderWidth: paymentMethod === 'card' ? 2 : 1, borderColor: paymentMethod === 'card' ? theme.colors.primary : theme.colors.divider, alignItems: 'center', justifyContent: 'flex-start' }}
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
            </View>
          ) : (
            // Online payment disabled → one whole "cash" button (auto-restores the
            // two-column layout the moment ENABLE_CARD_PAYMENT is turned on).
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: theme.colors.primary + '12', borderRadius: theme.radii.r16, padding: 16, borderWidth: 2, borderColor: theme.colors.primary }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.primary + '18', justifyContent: 'center', alignItems: 'center' }}>
                <Banknote size={24} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' }}>
                  {t('reserve.payCash', { defaultValue: 'Payer sur place' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                  {t('reserve.payCashDesc', { defaultValue: 'Payez le commerçant au retrait' })}
                </Text>
              </View>
            </View>
          )}

          {/* Barakeat credits — apply any amount of your wallet balance toward
              this order (0..solde, also capped at the total). The remainder is
              funded by the payment method above. */}
          {walletBalance > 0 && orderTotalDT > 0 && (
            <View style={{ marginTop: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Wallet size={18} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }}>
                    {t('reserve.useCreditsLabel', { defaultValue: 'Utiliser mes crédits' })}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                  {t('reserve.balanceLabel', { defaultValue: 'Solde : {{balance}} TND', balance: walletBalance.toFixed(2) })}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => stepCredits(-1)}
                  disabled={creditApplied <= 0}
                  style={{ width: 44, height: 44, borderRadius: theme.radii.r12, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center', opacity: creditApplied <= 0 ? 0.4 : 1 }}
                  accessibilityLabel={t('reserve.creditsDecrease', { defaultValue: 'Diminuer les crédits' })}
                >
                  <Minus size={18} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, borderWidth: 1, borderColor: theme.colors.divider, paddingHorizontal: 14, height: 44 }}>
                  <TextInput
                    value={creditsInput}
                    onChangeText={(txt) => {
                      // Allow decimals while typing; keep a single dot; clamp the
                      // numeric value to the max (0..min(solde, total)).
                      let c = txt.replace(',', '.').replace(/[^0-9.]/g, '');
                      const firstDot = c.indexOf('.');
                      if (firstDot !== -1) c = c.slice(0, firstDot + 1) + c.slice(firstDot + 1).replace(/\./g, '');
                      const n = parseFloat(c);
                      if (isFinite(n) && n > maxCreditDT) c = String(maxCreditDT);
                      setCreditsInput(c);
                    }}
                    onFocus={() => {
                      // Pair the keyboard-height padding (added to the
                      // ScrollView contentContainer above) with an active
                      // scroll-to so the input lands ABOVE the keyboard the
                      // moment it appears. Set focused = true; the effect
                      // up top re-fires the scroll every time the keyboard
                      // appears while focused, which is the reliable path
                      // (the setTimeout below is a belt-and-suspenders for
                      // the very first tap on slow JS-thread Androids
                      // where keyboardHeight hasn't updated within one tick).
                      setCreditsFocused(true);
                      setTimeout(scrollCreditsIntoView, 250);
                    }}
                    onBlur={() => setCreditsFocused(false)}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={theme.colors.muted}
                    style={{ flex: 1, color: theme.colors.textPrimary, ...theme.typography.body, padding: 0 }}
                    accessibilityLabel={t('reserve.useCreditsLabel', { defaultValue: 'Utiliser mes crédits' })}
                  />
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 6 }}>{t('common.currency', { defaultValue: 'TND' })}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => stepCredits(1)}
                  disabled={creditApplied >= maxCreditDT}
                  style={{ width: 44, height: 44, borderRadius: theme.radii.r12, borderWidth: 1, borderColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center', opacity: creditApplied >= maxCreditDT ? 0.4 : 1 }}
                  accessibilityLabel={t('reserve.creditsIncrease', { defaultValue: 'Augmenter les crédits' })}
                >
                  <Plus size={18} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCreditsInput(maxCreditDT > 0 ? String(maxCreditDT) : '')}
                  style={{ height: 44, paddingHorizontal: 12, borderRadius: theme.radii.r12, backgroundColor: theme.colors.primary + '14', alignItems: 'center', justifyContent: 'center' }}
                  accessibilityLabel={t('reserve.useMaxCredits', { defaultValue: 'Tout utiliser' })}
                >
                  <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' }}>
                    {t('reserve.useMaxCredits', { defaultValue: 'Max' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
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
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 21, paddingBottom: 12 }}>
            {t('reserve.cashWarningIntro', { defaultValue: 'Ready to pick up this basket?\n\nIf your plans change, please cancel early, it frees up the spot for someone else.' })}
          </Text>
          <Text
            style={{
              color: theme.colors.textSecondary,
              ...theme.typography.bodySm,
              lineHeight: 19,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.divider,
              paddingTop: 12,
              marginBottom: 20,
            }}
          >
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
        {/* Dark green background → light status bar so time/battery stay legible. */}
        {showConfirmation ? <StatusBar style="light" /> : null}
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
            /* Phase 2: Confirmed with paper bag — auto-advances to celebration */
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

          ) : confirmPhase === 'celebration' && celebrationData ? (
            /* Phase 3: XP celebration ("Bien joué !") — rendered INSIDE this
               same Modal. On Continue: dismiss this modal, navigate to the
               orders tab, and hand the order details to the tabs layout via
               celebrationStore.pendingOrderConfirm so the "Commande confirmée"
               detail popup appears on /(tabs)/orders. */
            <CelebrationView
              data={celebrationData}
              onContinue={() => {
                const payload = celebrationData?.confirmData;
                useHeroStore.getState().requestScrollReset();
                setShowConfirmation(false);
                router.replace('/(tabs)/orders' as never);
                if (payload) {
                  setTimeout(() => setPendingOrderConfirm(payload), 250);
                }
              }}
            />
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
