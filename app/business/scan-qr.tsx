import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ScrollView,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { QrCode, X, CheckCircle, Keyboard, Camera, SwitchCamera, Hand, ArrowLeft, Banknote, Wallet, ShoppingBag, MapPin, Navigation, Clock, CreditCard, User as UserIcon } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import {
  fetchTodayOrders,
  confirmPickup,
  verifyQR,
  type TodayReservationFromAPI,
  type VerifyQRResult,
} from '@/src/services/business';
import { fetchBasketById } from '@/src/services/baskets';
import { getErrorMessage, isActionAlreadyDoneError } from '@/src/lib/api';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';

// Inner review screen — extracted as its own component so the basket-
// detail query (useQuery) sits at top level and never violates the
// rules of hooks. Renders the pre-confirm "Confirmer le retrait" view:
// one compact basket card (image + name + 3 detail rows), one price
// breakdown card, then the Confirmer CTA flush to the bottom safe
// area. Designed to fit a single screen with no scroll on common
// device sizes.
function ReviewScreen({
  t,
  theme,
  insets,
  cancelReview,
  confirmReview,
  confirming,
  basketIdForFetch,
  rawBasketImageFromOrder,
  basketName,
  orgLogo,
  orgLocationLabel,
  buyerName,
  qty,
  pickupStart,
  pickupEnd,
  PMIcon,
  pmLabel,
  total,
  credits,
  hasCredits,
  toCollect,
  fmtDT,
  row,
  isExpired,
}: {
  t: any; theme: any; insets: any;
  cancelReview: () => void;
  // Takes the override boolean — the parent's confirmReview pipes it into
  // confirmPickup's expiredOverride argument when the order is expired
  // and the merchant ticked the override. For non-expired orders the arg
  // is ignored.
  confirmReview: (expiredOverride: boolean) => void;
  confirming: boolean;
  basketIdForFetch: string | number | null;
  rawBasketImageFromOrder: string | null;
  basketName: string;
  orgLogo: string | null;
  orgLocationLabel: string | null;
  buyerName: string;
  qty: number;
  pickupStart: string | null;
  pickupEnd: string | null;
  PMIcon: any;
  pmLabel: string;
  total: number;
  credits: number;
  hasCredits: boolean;
  toCollect: number;
  fmtDT: (n: number) => string;
  row: any;
  isExpired: boolean;
}) {
  // Track whether the merchant has explicitly opted to confirm a tardy
  // pickup on an order the cron already flipped to expired. The CTA
  // stays disabled until they tick this; the warning banner makes it
  // clear what they're agreeing to.
  const [acceptExpired, setAcceptExpired] = React.useState(false);
  // Fetch the basket directly when we have an id. TodayReservationFromAPI
  // doesn't include image URLs, so the previous extraction (basket?.image_url
  // etc) was always falling through to the placeholder. This one-shot
  // query picks up the real basket image. Cached for 60 s.
  //
  // The backend response is not consistently normalised to camelCase —
  // depending on the route, `imageUrl` vs `image_url` vs the older
  // `cover_image_url` can all show up. BasketFromAPI's `[key: string]:
  // unknown` index signature lets us read whichever one the server
  // actually sent, so the image renders regardless of casing.
  const basketDetailQuery = useQuery({
    queryKey: ['basket-detail', basketIdForFetch],
    queryFn: () => fetchBasketById(String(basketIdForFetch)),
    enabled: basketIdForFetch != null,
    staleTime: 60_000,
  });
  const detail = basketDetailQuery.data as any | undefined;
  const basketImage: string | null =
    detail?.imageUrl
    ?? detail?.image_url
    ?? detail?.cover_image_url
    ?? detail?.coverImageUrl
    ?? detail?.photo_url
    ?? detail?.photoUrl
    ?? rawBasketImageFromOrder
    ?? null;

  // Compact row used inside the basket card — small icon left, label
  // text right. No dividers between rows to keep the card dense; rows
  // stand apart through paddingVertical alone.
  const TightRow = ({ icon: Icon, value }: { icon: any; value: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
        <Icon size={12} color="#e3ff5c" />
      </View>
      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );

  return (
    // edges=['top','left','right'] so SafeAreaView no longer adds the
    // bottom inset automatically. The Confirmer wrapper below now
    // applies its own `Math.max(insets.bottom, 16) + 8` padding — that
    // guarantees breathing room on EVERY device shape:
    //   • iOS with home indicator    (insets.bottom ≈ 34) → 42 px
    //   • Android immersive mode     (insets.bottom ≈ 0)  → 24 px
    //   • Android visible nav bar    (insets.bottom ≈ 48) → 56 px
    // Without the min, the previous `paddingBottom: 0` left the CTA
    // glued to the screen edge on small Androids where immersive
    // suppressed the safe-area inset to 0.
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top', 'left', 'right']}>
      {/* Header — back (top-left) cancels and returns to scanning. */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm }]}>
        <TouchableOpacity onPress={cancelReview} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.textPrimary, ...theme.typography.h3, flex: 1, textAlign: 'center' }]}>
          {t('business.scan.reviewTitle', { defaultValue: 'Confirmer le retrait' })}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Body — flex:1 so the customer row + two cards + spacer pack the
          available height without scrolling. Padding kept tight
          (spacing.lg) so everything fits on typical phone heights. */}
      <View style={{ flex: 1, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm }}>
        {/* Customer card — sits ABOVE the order-info card on its own
            surface. Promoted from a small caption-style row to a proper
            shadowed card so the customer's identity is the first thing
            the merchant sees on the confirmation screen (the prior
            "Commande de Sami M." caption was easy to miss). Avatar
            badge with initials on the left, label + name on the right. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            padding: 14,
            marginBottom: theme.spacing.md,
            ...theme.shadows.shadowSm,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: theme.colors.primary + '15',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <UserIcon size={20} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                color: theme.colors.textSecondary,
                ...theme.typography.caption,
                marginBottom: 2,
              }}
            >
              {t('business.scan.customerLabel', { defaultValue: 'Client' })}
            </Text>
            <Text
              style={{
                color: theme.colors.textPrimary,
                ...theme.typography.body,
                fontWeight: '700',
              }}
              numberOfLines={1}
            >
              {buyerName}
            </Text>
          </View>
        </View>
        {/* Card 1 — basket: image (square thumbnail) on the left, basket
            name on the right. Divider, then the 3 quick detail rows
            (Retrait, paniers, paiement). One card, customer-free. */}
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: 14, ...theme.shadows.shadowSm, marginBottom: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {basketImage ? (
              <Image
                source={{ uri: basketImage }}
                style={{ width: 64, height: 64, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider }}
                resizeMode="cover"
              />
            ) : (
              <View style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: theme.colors.primary + '12', alignItems: 'center', justifyContent: 'center' }}>
                <ShoppingBag size={26} color={theme.colors.primary} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' }} numberOfLines={2}>
                {basketName}
              </Text>
              {/* Org logo + "Org - Location" caption row directly under the
                  basket name. Reads slightly muted (textSecondary) so the
                  basket name stays primary. Skipped entirely when neither
                  the logo nor the label is available. */}
              {(orgLogo || orgLocationLabel) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  {orgLogo ? (
                    <Image
                      source={{ uri: orgLogo }}
                      style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.divider }}
                      resizeMode="cover"
                    />
                  ) : null}
                  {orgLocationLabel ? (
                    <Text
                      style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}
                      numberOfLines={1}
                    >
                      {orgLocationLabel}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
          {/* Divider then the 3 detail rows. */}
          <View style={{ height: 1, backgroundColor: theme.colors.divider, marginTop: 12, marginBottom: 6 }} />
          {(pickupStart && pickupEnd) ? (
            <TightRow icon={Clock} value={`${t('notifications.pickupAt', { defaultValue: 'Retrait' })} : ${pickupStart} - ${pickupEnd}`} />
          ) : null}
          <TightRow
            icon={ShoppingBag}
            value={`${qty} ${qty > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}`}
          />
          <TightRow icon={PMIcon} value={pmLabel} />
        </View>

        {/* Card 2 — price breakdown. À encaisser is the headline number
            so the merchant always sees what to actually take. */}
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }}>
          <View style={row}>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('reserve.total')}</Text>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }}>{fmtDT(total)} TND</Text>
          </View>
          {hasCredits && (
            <View style={[row, { marginTop: 6 }]}>
              <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm }}>{t('business.scan.creditsUsed', { defaultValue: 'Crédits Barakeat' })}</Text>
              <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>−{fmtDT(credits)} TND</Text>
            </View>
          )}
          <View style={[row, { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Banknote size={18} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>{t('business.scan.toCollect', { defaultValue: 'À encaisser' })}</Text>
            </View>
            <Text style={{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' }}>{fmtDT(toCollect)} TND</Text>
          </View>
          {hasCredits && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, padding: 10, borderRadius: theme.radii.r12, backgroundColor: theme.colors.primary + '0E' }}>
              <Wallet size={14} color={theme.colors.primary} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, color: theme.colors.textSecondary, ...theme.typography.caption, lineHeight: 16 }}>
                {t('business.scan.creditsReimburseNote', { credits: fmtDT(credits), defaultValue: 'Le client a payé {{credits}} TND avec des crédits Barakeat — ne lui réclamez pas ce montant.' })}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Confirm button — adaptive bottom padding. The outer
          SafeAreaView now skips its bottom edge, so this wrapper
          OWNS the spacing. `Math.max(insets.bottom, 16) + 8` keeps
          the CTA at least 24 px off the screen bottom on every
          device shape (see SafeAreaView comment above) — the
          earlier `paddingBottom: 0` glued it to the edge on small
          Androids where the immersive nav-bar hook drove
          insets.bottom to 0. */}
      {/* Expired-order warning + override gate. The cron flipped this
          order to cancelled because the customer didn't show up in time,
          but the merchant is now choosing to honour the late pickup
          (e.g. the customer just walked in). The CTA stays disabled
          until they tap the checkbox so the action isn't accidental;
          tapping fires confirmPickup with expiredOverride=true. */}
      {isExpired ? (
        <View
          style={{
            marginHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.sm,
            backgroundColor: '#fff4e6',
            borderRadius: theme.radii.r12,
            padding: theme.spacing.md,
            borderLeftWidth: 3,
            borderLeftColor: '#ee7b3c',
          }}
        >
          <Text style={{ color: '#7a3b0c', ...theme.typography.bodySm, fontWeight: '700', marginBottom: 4 }}>
            {t('business.scan.expiredTitle', { defaultValue: 'Commande expirée' })}
          </Text>
          <Text style={{ color: '#7a3b0c', ...theme.typography.caption, marginBottom: theme.spacing.sm }}>
            {t('business.scan.expiredBody', { defaultValue: "Cette commande a expiré car le client n'est pas passé à temps. Vous pouvez tout de même confirmer le retrait si vous acceptez de lui remettre son panier." })}
          </Text>
          <TouchableOpacity
            onPress={() => setAcceptExpired((v) => !v)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <View
              style={{
                width: 20, height: 20, borderRadius: 5,
                borderWidth: 2,
                borderColor: acceptExpired ? '#ee7b3c' : '#a06b3d',
                backgroundColor: acceptExpired ? '#ee7b3c' : 'transparent',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              {acceptExpired ? <CheckCircle size={14} color="#fff" /> : null}
            </View>
            <Text style={{ color: '#7a3b0c', ...theme.typography.caption, fontWeight: '600', flex: 1 }}>
              {t('business.scan.expiredOverrideAck', { defaultValue: 'Je confirme vouloir remettre le panier malgré le retard' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 16) + 8,
        }}
      >
        <PrimaryCTAButton
          onPress={() => confirmReview(acceptExpired)}
          title={t('business.scan.confirmPickup', { defaultValue: 'Confirmer le retrait' })}
          loading={confirming}
          disabled={isExpired && !acceptExpired}
        />
      </View>
    </SafeAreaView>
  );
}

export default function ScanQRScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // ── Walkthrough demo mode ──────────────────────────────────────────────
  // Two demo paths can hit this screen:
  //   • Legacy `demoScanCode` flow — boots manual mode + a pre-filled DEMO1
  //     code. Kept for back-compat with the previous walkthrough version.
  //   • New `demoBack` param — opened from the qrFab step of the orders
  //     tour. The screen just shows the camera as the user would see it,
  //     plus a floating instruction popup prompting them to tap back. On
  //     unmount the walkthrough advances past the scanQrBack step.
  const params = useLocalSearchParams<{ demoBack?: string; prefillCode?: string }>();
  const isDemoBack = params.demoBack === '1';
  // When the user lands here from the order-card "Verify pickup" path
  // (incoming-orders.tsx), the pickup code is pre-filled and we boot
  // straight into the review state — same flow the QR scan produces. This
  // unifies the two confirmation paths so both end with the rich review +
  // full-page success animation.
  const prefillCode = typeof params.prefillCode === 'string' ? params.prefillCode : '';
  const demoScanCode = useWalkthroughStore((s) => s.demoScanCode);
  const setDemoScanCode = useWalkthroughStore((s) => s.setDemoScanCode);
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  const walkthroughCurrentStep = useWalkthroughStore((s) => s.currentStep);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  const inDemoMode = demoScanCode !== null;
  // Idempotency guard: prevents the unmount cleanup from racing with the
  // (business) layout's safety-net effect at line ~2057 in _layout.tsx,
  // which ALSO calls nextStep() when pathname leaves /business/scan-qr.
  // If both fire in the same React batch (the user reported "demo cleared
  // unexpectedly after pressing Next on scan-qr"), step advances twice,
  // and on a borderline step count (e.g. a member role that builds fewer
  // total steps than expected), the second advance can land at the
  // end-of-walkthrough threshold and wipe the demo state via
  // clearDemoState. Flipping the ref the FIRST time either path fires
  // makes the second a no-op.
  const scanQrAdvanceFiredRef = useRef(false);
  useEffect(() => {
    if (!isDemoBack) return;
    return () => {
      // On unmount (user taps close / nav pops the screen), advance the
      // walkthrough past the scanQrBack step if we're still on it.
      if (scanQrAdvanceFiredRef.current) return;
      if (useWalkthroughStore.getState().currentStep?.measureKey === 'scanQrBack') {
        scanQrAdvanceFiredRef.current = true;
        useWalkthroughStore.getState().nextStep(999);
      }
    };
  }, [isDemoBack]);
  // We don't measureInWindow the close-X for the demo overlay — measurement
  // races with the push-screen animation and frequently returned 0/null on
  // first paint, dropping the halo to the (12, 12) fallback in the top-left
  // corner. Instead we derive the rect from a known layout: the header has
  // paddingHorizontal: spacing.xl (20) + paddingTop: spacing.md (12), the X
  // icon is 24px square, sitting at (insets.left + 20, insets.top + 12).
  // This is rock-solid and avoids the timing flakiness.

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<TodayReservationFromAPI | null>(null);
  // In demo mode, boot in manual mode so the keyboard view + manual-toggle
  // highlight are immediately visible. The prefillCode path also boots in
  // manual mode — we're not asking the camera to do anything when the
  // code already arrived via deep-link from the order-card flow.
  const [mode, setMode] = useState<'camera' | 'manual'>((inDemoMode || prefillCode) ? 'manual' : 'camera');
  const [scanned, setScanned] = useState(false);
  // The order awaiting the business's review + confirmation. When set, we show a
  // summary page (customer, basket, price, credits) with a Confirm button —
  // instead of finalizing the pickup the instant the code is verified.
  const [reviewOrder, setReviewOrder] = useState<VerifyQRResult | null>(null);
  // The raw today-order row matched alongside the verifyQR summary. Carries
  // the richer order context (basket image, address, pickup window) that
  // VerifyQRResult doesn't expose. Used to enrich the review + success
  // screens; both paths (QR scan and manual entry) populate it.
  const [reviewExtra, setReviewExtra] = useState<TodayReservationFromAPI | null>(null);
  const [confirming, setConfirming] = useState(false);
  const processingRef = useRef(false); // ref-based guard — prevents double-scan race condition
  const [permission, requestPermission] = useCameraPermissions();

  // Amount formatter — integers stay clean ("5 TND"), fractions show millimes.
  const fmtDT = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

  // Mock the success state when the user taps Verify in demo mode — skip
  // the API call and surface a fake confirmed order.
  const handleVerifyDemo = () => {
    setMatchedOrder({
      id: 'demo-order-1',
      buyer_id: 0,
      buyer_name: t('walkthrough.biz.demoOrderCustomer', { defaultValue: 'Sami (démo)' }),
      quantity: 2,
      pickup_code: 'DEMO',
      status: 'picked_up',
      basket_name: t('walkthrough.biz.demoOrderBasket', { defaultValue: 'Panier Surprise' }),
    } as unknown as TodayReservationFromAPI);
    setVerified(true);
  };

  // Clear the demo flag when leaving this screen so a re-run of the
  // walkthrough fires fresh state. (Don't clear on success — the user is
  // still on this screen looking at the success card.)
  useEffect(() => {
    return () => {
      // Only clear if we're not currently mid-demo-success, since the
      // walkthrough overlay relies on demoScanCode to drive the next steps.
      // The demo scan code is cleared by the walkthrough's clearDemoState on
      // step transition / completion anyway, so this is just a safety net.
    };
  }, []);

  const handleVerifyCode = async (pickupCode: string) => {
    // Demo mode: skip the backend, surface a mocked success card with the
    // demo customer name + quantity.
    if (inDemoMode) {
      handleVerifyDemo();
      return;
    }
    if (pickupCode.trim().length < 4) {
      alert.showAlert(t('common.error'), t('business.scan.codeTooShort'));
      return;
    }
    if (processingRef.current || verified || reviewOrder) return; // Prevent double processing
    processingRef.current = true;
    setLoading(true);
    try {
      // Resolve the code → reservation, then verify it to get the rich pickup
      // summary (correct basket name, total, credits) and show it for review
      // before confirming — no auto-confirm.
      const orders = await fetchTodayOrders();
      // Backend codes can be 8 chars on older records; the merchant's
      // manual input is capped at 6. Compare on a 6-char prefix so the
      // typed "ABCDEF" still matches a stored "ABCDEF12". The full backend
      // value is still sent to verifyQR below — server-side pickup
      // confirmation continues to receive whatever the database has.
      const enteredPrefix = pickupCode.trim().toUpperCase().substring(0, 6);
      const match = orders.find(
        (o) => (o.pickup_code ?? '').toUpperCase().substring(0, 6) === enteredPrefix
      );
      if (!match) {
        alert.showAlert(t('common.error'), t('business.scan.codeNotFound'));
        setLoading(false);
        setScanned(false);
        processingRef.current = false;
        return;
      }
      // Send the FULL stored pickup_code to the backend (not the 4-char
      // truncation the merchant typed). The server may still validate
      // against the complete legacy 8-char value on older reservations;
      // we already confirmed a prefix match client-side, so handing it
      // the canonical code from `match` keeps server-side verification
      // backwards-compatible without dropping the 4-char UX.
      const summary = await verifyQR(JSON.stringify({ reservation_id: match.id, pickup_code: (match.pickup_code ?? pickupCode.trim()).toUpperCase() }));
      if (!summary.valid) {
        alert.showAlert(t('common.error'), t('business.scan.codeNotFound'));
        setScanned(false);
        processingRef.current = false;
        return;
      }
      // Stash the raw today-order alongside the verifyQR summary so the
      // review screen can show basket image / address / pickup window —
      // none of which are in VerifyQRResult.
      setReviewExtra(match);
      setReviewOrder(summary);
    } catch (err) {
      alert.showAlert(t('common.error'), getErrorMessage(err));
      setScanned(false);
      processingRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  // Finalize the pickup the business reviewed. Confirms server-side, then shows
  // the success screen. `expiredOverride` is passed through from the review
  // screen's checkbox so the backend's expired-status guard knows the
  // merchant is intentionally honouring a tardy pickup.
  const confirmReview = async (expiredOverride: boolean = false) => {
    if (!reviewOrder || confirming) return;
    setConfirming(true);
    // Hoisted out of the try block so both the success branch and the
    // ghost-success branch below can use the same success-screen payload
    // without duplicating the object literal.
    const successPayload = {
      id: reviewOrder.reservation_id ?? '',
      buyer_id: reviewOrder.buyer_id,
      buyer_name: reviewOrder.buyer_name,
      quantity: reviewOrder.quantity,
      pickup_code: reviewOrder.pickup_code,
      status: 'picked_up',
      basket_name: reviewOrder.basket_name ?? undefined,
    } as unknown as TodayReservationFromAPI;
    const enterSuccessScreen = () => {
      setMatchedOrder(successPayload);
      setReviewOrder(null);
      setVerified(true);
      void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['location-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['business-analytics'] });
    };
    try {
      await confirmPickup(String(reviewOrder.reservation_id), reviewOrder.pickup_code ?? '', reviewOrder.buyer_id, expiredOverride);
      enterSuccessScreen();
    } catch (err) {
      // Ghost-success path 1 — RETRY case: backend says "cette commande a
      // déjà été récupérée". That means our previous tap committed and only
      // the response was lost — the order IS picked up server-side. Surface
      // the success screen. (cancelled / refunded responses are NOT
      // swallowed by this helper.)
      if (isActionAlreadyDoneError(err, 'confirm-pickup')) {
        console.log('[scan-qr] Already-picked-up short-circuit:', reviewOrder.reservation_id);
        enterSuccessScreen();
        return;
      }
      // Ghost-success path 2 — FIRST-TAP case: the backend may have committed
      // the picked_up status before the response died in flight (timeout /
      // 5xx / network drop). Before showing the merchant a misleading "error",
      // refetch today's orders and check: if this reservation is now
      // picked_up server-side, the pickup actually succeeded and the success
      // screen is the correct outcome. 4xx errors (other than 408) skip this
      // recovery because they mean the backend rejected the request before
      // commit (bad code, wrong location, etc.) — those are real errors.
      const status = Number((err as any)?.status);
      const raw = String((err as any)?.message ?? '').toLowerCase();
      const isUnknownStatus = !Number.isFinite(status) || status === 0;
      const isServerUncertain = status >= 500 || status === 408;
      const isNetworkMessage =
        raw.includes('network')
        || raw.includes('timeout')
        || raw.includes('failed to fetch')
        || raw.includes('connexion');
      const looksLikeMaybeSucceeded = isUnknownStatus || isServerUncertain || isNetworkMessage;
      if (looksLikeMaybeSucceeded) {
        try {
          const orders = await fetchTodayOrders();
          const found = orders.find((o) => String(o.id) === String(reviewOrder.reservation_id));
          const liveStatus = String((found as any)?.status ?? '').toLowerCase();
          if (liveStatus === 'picked_up' || liveStatus === 'collected') {
            console.log('[scan-qr] Ghost-success recovered: order is now', liveStatus);
            enterSuccessScreen();
            return;
          }
        } catch (verifyErr) {
          console.log('[scan-qr] Recovery verify failed:', verifyErr);
        }
      }
      alert.showAlert(t('common.error'), getErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  };

  // Back from the summary → resume scanning / manual entry without finalizing.
  const cancelReview = () => {
    setReviewOrder(null);
    setReviewExtra(null);
    setScanned(false);
    processingRef.current = false;
  };

  // Prefill: when the user arrives via /business/scan-qr?prefillCode=ABCD,
  // auto-run handleVerifyCode on mount so the rich review screen comes up
  // without an extra "type the code again" step. Fired exactly once.
  const prefillFiredRef = useRef(false);
  useEffect(() => {
    if (!prefillCode || prefillFiredRef.current) return;
    if (inDemoMode || isDemoBack) return; // demo paths own this state
    prefillFiredRef.current = true;
    setCode(prefillCode.toUpperCase());
    void handleVerifyCode(prefillCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCode, inDemoMode, isDemoBack]);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned || loading || processingRef.current) return;
    processingRef.current = true;
    setScanned(true);

    // Verify the QR (read-only) and show the pickup SUMMARY for the business to
    // review — confirmation happens on the Confirm button, not automatically.
    setLoading(true);
    verifyQR(data)
      .then(async (verifyResult) => {
        if (!verifyResult.valid) {
          alert.showAlert(t('common.error'), t('business.scan.codeNotFound'));
          setScanned(false);
          processingRef.current = false;
          return;
        }
        // Try to also resolve the raw today-order row so the review screen
        // can show basket image + address + pickup window. Best-effort:
        // if the fetch fails (the QR was valid but the order somehow
        // isn't in today's list) we still render the minimal review with
        // just the verifyQR summary.
        try {
          const orders = await fetchTodayOrders();
          const match = orders.find((o) => String(o.id) === String(verifyResult.reservation_id));
          if (match) setReviewExtra(match);
        } catch {}
        setReviewOrder(verifyResult);
      })
      .catch((err) => {
        // verifyQR failed — fall back to manual code entry only if not already processing
        if (!verified) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.pickup_code) {
              void handleVerifyCode(parsed.pickup_code);
              return;
            }
          } catch {
            // not JSON
          }
          if (data.trim().length >= 4) {
            void handleVerifyCode(data.trim());
          } else {
            alert.showAlert(t('common.error'), getErrorMessage(err));
            setScanned(false);
            processingRef.current = false;
          }
        }
      })
      .finally(() => setLoading(false));
  };

  const handleClose = () => {
    // Demo-back mode: when the user taps Suivant / X / "Quitter la démo" on
    // the walkthrough popup, advance the demo SYNCHRONOUSLY first instead of
    // popping the screen. The (business) layout's [step] effect notices the
    // step change, calls router.replace('/(business)/business-profile') to
    // pop this sub-screen + land on the profile tab, and the next demo
    // overlay paints there.
    //
    // The previous flow (just `router.back()`) had a race: the back animation
    // pops the pathname to /(business)/incoming-orders BEFORE scan-qr
    // actually unmounts, so the layout's safety-net effect would fire its
    // 80 ms deferred `nextStep` first while the screen is still mid-unmount.
    // Then the unmount cleanup races behind it — and because the store's
    // `currentStep` reflector is one effect-tick behind the `step` state,
    // the cleanup's `currentStep?.measureKey === 'scanQrBack'` guard saw a
    // stale value, passed, and double-advanced into a step whose host hadn't
    // mounted yet. The user landed on profile with no overlay because the
    // layout was waiting on a rect from a screen the user hadn't actually
    // reached.
    //
    // Advancing here (and skipping router.back) flips the
    // `scanQrAdvanceFiredRef` BEFORE either of those code paths can fire,
    // so the unmount cleanup is a guaranteed no-op and the safety net's
    // re-check sees the freshly-advanced step. The layout owns the
    // navigation end-to-end.
    if (isDemoBack && useWalkthroughStore.getState().currentStep?.measureKey === 'scanQrBack') {
      scanQrAdvanceFiredRef.current = true;
      useWalkthroughStore.getState().nextStep(999);
      return;
    }
    router.back();
  };

  // Success state
  if (verified) {
    // Same basket-image resolution as the review screen so the success
    // screen has matching visual context (the merchant just confirmed THIS
    // basket — show it). Optional: hero is skipped when no image exists.
    const ex = (reviewExtra ?? matchedOrder ?? {}) as any;
    const successBasketImage: string | null =
      ex.basket_image_url
      ?? ex.basket_image
      ?? ex.basket?.image_url
      ?? ex.basket?.cover_image_url
      ?? ex.cover_image_url
      ?? ex.image_url
      ?? null;
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <View style={styles.successContainer}>
          {successBasketImage ? (
            <Image
              source={{ uri: successBasketImage }}
              style={{ width: 120, height: 120, borderRadius: 60, marginBottom: theme.spacing.lg, borderWidth: 2, borderColor: theme.colors.success }}
              resizeMode="cover"
            />
          ) : null}
          <View
            style={[
              styles.successIconCircle,
              {
                backgroundColor: theme.colors.success + '18',
                width: 100,
                height: 100,
                borderRadius: 50,
              },
            ]}
          >
            <CheckCircle size={56} color={theme.colors.success} />
          </View>

          <Text
            style={[
              styles.successTitle,
              {
                color: theme.colors.success,
                ...theme.typography.h1,
                marginTop: theme.spacing.xxl,
              },
            ]}
          >
            {t('business.scan.confirmed')}
          </Text>

          {matchedOrder?.buyer_name ? (
            <View style={[styles.customerRow, { marginTop: theme.spacing.lg }]}>
              <Text
                style={[
                  { color: theme.colors.textSecondary, ...theme.typography.body },
                ]}
              >
                {t('business.scan.customerLabel')}:{' '}
              </Text>
              <Text
                style={[
                  {
                    color: theme.colors.textPrimary,
                    ...theme.typography.body,
                    fontWeight: '600' as const,
                  },
                ]}
              >
                {matchedOrder.buyer_name}
              </Text>
            </View>
          ) : null}

          {/* Quantity × basket-name — gives the success screen context
              instead of a bare customer name. Same priority chain as the
              customer-side ReservationCard / business-side normalizeOrder:
              nested basket.name wins over the often-wrong top-level
              basket_name (which can be the location's default). */}
          {(() => {
            const mo: any = matchedOrder;
            if (!mo) return null;
            const displayName: string =
              mo?.basket?.name
              ?? mo?.basket?.basket_type_name
              ?? mo?.basket?.type_name
              ?? mo?.basket?.basket_name
              ?? mo?.basket_type_name
              ?? mo?.basket_name
              ?? t('orders.surpriseBag', { defaultValue: 'Panier Surprise' });
            const qty = mo?.quantity ?? 1;
            return (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: theme.spacing.xs }}>
                {qty} × {displayName}
              </Text>
            );
          })()}

          <View style={[styles.doneButtonWrapper, { marginTop: theme.spacing.xxxl }]}>
            <PrimaryCTAButton onPress={handleClose} title={t('business.scan.done')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Review state — show the order summary so the business can verify the
  // customer + see how much cash to collect (credits reduce it) BEFORE
  // finalizing the pickup. Enriched with basket image / address / pickup
  // window / payment method so the merchant has the same context they get
  // on the expanded incoming-order card.
  if (reviewOrder) {
    const total = Number(reviewOrder.total ?? 0);
    const credits = Number(reviewOrder.credit_amount ?? 0);
    const toCollect = Number(reviewOrder.amount_to_collect ?? Math.max(0, total - credits));
    const hasCredits = credits > 0;
    const qty = reviewOrder.quantity ?? 1;
    const basketDisplay = reviewOrder.basket_name || t('orders.surpriseBag', { defaultValue: 'Panier Surprise' });
    const row = { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const };

    // Extract richer context from the matched today-order row when present.
    const x = (reviewExtra ?? {}) as any;
    const basketIdForFetch = x.basket_id ?? x.basket?.id ?? null;
    // Org logo + "Org - Location" line that renders under the basket name
    // on the review card. Both pieces come from whatever the today-order row
    // happened to carry; either may be missing on older payloads, in which
    // case the row is skipped silently downstream.
    const orgLogo: string | null = (
      x.org_logo_url
      ?? x.organization?.logo_url
      ?? x.restaurant?.image_url
      ?? x.basket?.merchant_logo
      ?? null
    );
    const orgName: string | null = (x.organization_name ?? x.restaurant_name ?? x.org_name ?? null);
    const locationLabelOnly: string | null = (x.location_name ?? null);
    const orgLocationLabel: string | null = orgName && locationLabelOnly
      ? `${orgName} - ${locationLabelOnly}`
      : (orgName ?? locationLabelOnly);
    const pickupStart: string | null = x.pickup_start_time ? String(x.pickup_start_time).substring(0, 5) : null;
    const pickupEnd: string | null = x.pickup_end_time ? String(x.pickup_end_time).substring(0, 5) : null;
    const paymentMethod: 'cash' | 'card' | 'credits' = (reviewOrder.payment_method ?? x.payment_method ?? 'cash') as any;
    const isCard = paymentMethod === 'card';
    const PMIcon = isCard ? CreditCard : Banknote;
    const pmLabel = isCard
      ? (hasCredits
          ? t('orders.paymentByCardWithCredits', { defaultValue: 'Paiement par carte (+ crédits)' })
          : t('orders.paymentByCard', { defaultValue: 'Paiement par carte' }))
      : (hasCredits
          ? t('orders.paymentInCashWithCredits', { defaultValue: 'Paiement en espèces (+ crédits)' })
          : t('orders.paymentInCash', { defaultValue: 'Paiement en espèces' }));

    return (
      <ReviewScreen
        t={t}
        theme={theme}
        insets={insets}
        cancelReview={cancelReview}
        confirmReview={confirmReview}
        confirming={confirming}
        basketIdForFetch={basketIdForFetch}
        rawBasketImageFromOrder={x.basket_image_url ?? x.basket_image ?? x.basket?.image_url ?? x.basket?.cover_image_url ?? x.cover_image_url ?? x.image_url ?? null}
        basketName={basketDisplay}
        orgLogo={orgLogo}
        orgLocationLabel={orgLocationLabel}
        buyerName={reviewOrder.buyer_name || '—'}
        qty={qty}
        pickupStart={pickupStart}
        pickupEnd={pickupEnd}
        PMIcon={PMIcon}
        pmLabel={pmLabel}
        total={total}
        credits={credits}
        hasCredits={hasCredits}
        toCollect={toCollect}
        fmtDT={fmtDT}
        row={row}
        isExpired={!!reviewOrder.is_expired}
      />
    );
  }

  // Camera mode
  const showCamera = mode === 'camera' && permission?.granted;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              paddingHorizontal: theme.spacing.xl,
              paddingTop: theme.spacing.md,
              paddingBottom: theme.spacing.md,
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text
            style={[
              styles.headerTitle,
              { color: theme.colors.textPrimary, ...theme.typography.h3, flex: 1, textAlign: 'center' },
            ]}
          >
            {t('business.scan.title')}
          </Text>
          {/* Toggle camera/manual */}
          <TouchableOpacity
            ref={(r: any) => {
              if (inDemoMode && r) {
                requestAnimationFrame(() => {
                  r.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                    if (w > 0 && h > 0) setMeasuredRect('scanManualToggle', { x, y, w, h });
                  });
                });
              }
            }}
            onPress={() => {
              // During the demoBack flow, the only legal tap on this screen
              // is the highlighted close X. The four absorber frames around
              // the X cutout should already block the toggle, but the prior
              // report ("I tapped this and the profile section never showed")
              // suggests the responder negotiation was letting taps slip
              // through on at least one device. Belt-and-suspenders gate.
              if (isDemoBack) {
                useWalkthroughStore.getState().notifyTapHint();
                return;
              }
              setMode(mode === 'camera' ? 'manual' : 'camera');
              setScanned(false);
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            {mode === 'camera' ? (
              <Keyboard size={22} color={theme.colors.textPrimary} />
            ) : (
              <Camera size={22} color={theme.colors.textPrimary} />
            )}
          </TouchableOpacity>
        </View>

        {/* Content */}
        {showCamera ? (
          <View style={styles.cameraContainer}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
            {/* Scan overlay */}
            <View style={styles.scanOverlay}>
              <View style={[styles.scanFrame, { borderColor: theme.colors.primary }]} />
            </View>
            <View style={[styles.scanInstructions, { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: theme.radii.r16 }]}>
              <Text style={{ color: '#fff', ...theme.typography.body, textAlign: 'center' }}>
                {scanned
                  ? t('business.scan.processing', { defaultValue: 'Processing...' })
                  : t('business.scan.pointCamera', { defaultValue: 'Point camera at QR code' })}
              </Text>
            </View>
            {scanned && (
              <TouchableOpacity
                onPress={() => setScanned(false)}
                style={[styles.rescanBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12 }]}
              >
                <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }}>
                  {t('business.scan.scanAgain', { defaultValue: 'Scan Again' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : mode === 'camera' && !permission?.granted ? (
          // Camera permission not granted
          <View style={styles.content}>
            <View
              style={[
                styles.illustrationCircle,
                {
                  backgroundColor: theme.colors.primary + '12',
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                },
              ]}
            >
              <Camera size={44} color={theme.colors.primary} />
            </View>
            <Text
              style={{
                color: theme.colors.textPrimary,
                ...theme.typography.h3,
                marginTop: theme.spacing.xl,
                textAlign: 'center',
              }}
            >
              {t('business.scan.cameraPermTitle', { defaultValue: 'Camera Access Required' })}
            </Text>
            <Text
              style={{
                color: theme.colors.textSecondary,
                ...theme.typography.bodySm,
                marginTop: theme.spacing.sm,
                textAlign: 'center',
                lineHeight: 20,
              }}
            >
              {t('business.scan.cameraPermDesc', { defaultValue: 'Allow camera access to scan customer QR codes for pickup verification.' })}
            </Text>
            <View style={{ marginTop: theme.spacing.xl, width: '100%' }}>
              <PrimaryCTAButton
                onPress={() => {
                  if (isDemoBack) {
                    useWalkthroughStore.getState().notifyTapHint();
                    return;
                  }
                  requestPermission();
                }}
                title={t('business.scan.allowCamera', { defaultValue: 'Allow Camera Access' })}
              />
            </View>
            <TouchableOpacity
              onPress={() => {
                if (isDemoBack) {
                  useWalkthroughStore.getState().notifyTapHint();
                  return;
                }
                setMode('manual');
              }}
              style={{ marginTop: theme.spacing.lg }}
            >
              <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>
                {t('business.scan.useManualEntry', { defaultValue: 'Enter code manually instead' })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          // Manual entry mode
          <View style={styles.content}>
            <View
              style={[
                styles.illustrationCircle,
                {
                  backgroundColor: theme.colors.primary + '12',
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                },
              ]}
            >
              <Keyboard size={44} color={theme.colors.primary} />
            </View>

            <Text
              style={{
                color: theme.colors.textPrimary,
                ...theme.typography.h3,
                marginTop: theme.spacing.xl,
                textAlign: 'center',
              }}
            >
              {t('business.scan.manualEntryTitle', { defaultValue: 'Enter Pickup Code' })}
            </Text>

            <Text
              style={[
                styles.label,
                {
                  color: theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                  marginTop: theme.spacing.sm,
                  lineHeight: 20,
                },
              ]}
            >
              {t('business.scan.manualEntryDesc', { defaultValue: 'Ask the customer for their pickup code shown in their order confirmation.' })}
            </Text>

            <TextInput
              style={[
                styles.codeInput,
                {
                  color: theme.colors.primary,
                  ...theme.typography.h2,
                  letterSpacing: 6,
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r16,
                  borderWidth: 2,
                  borderColor: code.trim().length >= 4 ? theme.colors.primary + '40' : theme.colors.divider,
                  marginTop: theme.spacing.lg,
                  paddingHorizontal: theme.spacing.xl,
                  paddingVertical: theme.spacing.lg,
                  ...theme.shadows.shadowSm,
                },
              ]}
              value={code}
              // Strip anything that isn't a digit before storing. The
              // OS keypad enforces this on most devices but Android
              // hardware keyboards / some keyboard skins can still
              // inject letters — the regex is the belt-and-suspenders.
              onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('business.scan.codePlaceholder')}
              placeholderTextColor={theme.colors.muted}
              // `number-pad` opens the dedicated 0-9 keypad on iOS and
              // Android (no decimal, no minus, no comma). Faster to
              // tap than the full keyboard's number row, and pickup
              // codes are now numeric-only (backend generates 6 digits
              // — see generatePickupCode in reservations.js).
              keyboardType="number-pad"
              autoCorrect={false}
              maxLength={6}
              textAlign="center"
              autoFocus
            />

            <View style={[styles.verifyButtonWrapper, { marginTop: theme.spacing.xl }]}>
              <PrimaryCTAButton
                onPress={() => {
                  if (isDemoBack) {
                    useWalkthroughStore.getState().notifyTapHint();
                    return;
                  }
                  handleVerifyCode(code);
                }}
                title={t('business.scan.verify')}
                loading={loading}
                disabled={code.trim().length < 4}
              />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Walkthrough overlay — renders the manual-toggle highlight on this
          pushed Stack screen. */}
      <SubScreenWalkthroughOverlay keys={['scanManualToggle']} />
    </SafeAreaView>

      {/* Demo walkthrough overlay for the scanQrBack step.
          Rendered OUTSIDE the SafeAreaView so its absolute positioning maps
          straight to window coords (a sibling absolute child of the outer
          flex:1 View whose frame IS the full window). Earlier this lived
          inside SafeAreaView, where padding from the safe-area inset pushed
          the cutout / popup down by ~insets.top px — the halo landed below
          the actual button and the popup ended up covering both the close X
          and the camera/keyboard toggle.

          Dims the entire screen with a rounded cutout on the close (X)
          button and surrounds it with absorber frames so the user can't
          accidentally tap manual mode / camera flip / verify / etc. — any
          one of those was leaving the demo stranded. */}
      {/* Demo instruction popup — bottom-anchored, fully interactive page
          behind it. No dim mask, no cutout, no absorber frames; the camera
          permission button + QR/code mode toggle + camera itself are all
          tappable. The popup uses `pointerEvents="box-none"` on its wrapper
          so taps fall through onto the underlying scan UI; only the popup
          card itself catches its own taps. Suivant + close X (top-left)
          both advance the walkthrough via the existing unmount cleanup. */}
      {isDemoBack && walkthroughCurrentStep?.measureKey === 'scanQrBack' && (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 24 }}>
          <View style={{
            backgroundColor: '#fff',
            borderRadius: 20,
            padding: 18,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 20,
            elevation: 12,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#114b3c12', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                <Hand size={18} color="#114b3c" />
              </View>
              <Text style={{ color: '#114b3c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1 }}>
                {t('walkthrough.biz.scanQrBack.title', { defaultValue: 'Scanner le QR du client' })}
              </Text>
            </View>
            <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, marginBottom: 10 }}>
              {t('walkthrough.biz.scanQrBack.desc', { defaultValue: "Voici l'écran de scan. Vous pouvez explorer librement (autoriser la caméra, basculer en saisie de code). Appuyez sur Suivant ou sur le X en haut à gauche pour revenir." })}
            </Text>
            {/* Suivant — close the screen (advances the walkthrough via
                the unmount cleanup at the top of this file). */}
            <TouchableOpacity
              onPress={() => { handleClose(); }}
              style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4, marginBottom: 8 }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Poppins_700Bold', fontWeight: '700' }}>
                {t('walkthrough.next', { defaultValue: 'Suivant' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { skipWalkthrough(); handleClose(); }} style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.colors.muted, fontSize: 13, fontFamily: 'Poppins_500Medium' }}>
                {t('walkthrough.exitDemo', { defaultValue: 'Quitter la démo' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {},
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 3,
    borderRadius: 24,
  },
  scanInstructions: {
    position: 'absolute',
    bottom: 120,
    left: 40,
    right: 40,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  rescanBtn: {
    position: 'absolute',
    bottom: 60,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  illustrationCircle: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    textAlign: 'center',
  },
  codeInput: {
    width: '100%',
    fontWeight: '700',
  },
  verifyButtonWrapper: {
    width: '100%',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successIconCircle: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  successTitle: {
    textAlign: 'center',
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  doneButtonWrapper: {
    width: '100%',
  },
});
