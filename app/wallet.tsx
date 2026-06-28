import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Animated, KeyboardAvoidingView, Keyboard, Platform, Modal } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Wallet, Gift, Users, ArrowDownLeft, ArrowUpRight, CreditCard, Star, ChevronDown, QrCode, X as XIcon, Camera } from 'lucide-react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchWallet, redeemCode, type WalletTransaction } from '@/src/services/wallet';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';
import { StatusBar } from 'expo-status-bar';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { getErrorMessage, makeAttemptKey } from '@/src/lib/api';

const TYPE_CONFIG: Record<string, { icon: any; color: string; labelKey: string }> = {
  reward: { icon: Star, color: '#f59e0b', labelKey: 'wallet.reward' },
  referral: { icon: Users, color: '#8b5cf6', labelKey: 'wallet.referral' },
  refund: { icon: ArrowDownLeft, color: '#22c55e', labelKey: 'wallet.refund' },
  payment: { icon: ArrowUpRight, color: '#ef4444', labelKey: 'wallet.payment' },
  admin_credit: { icon: Gift, color: '#114b3c', labelKey: 'wallet.adminCredit' },
};

// Maps the canonical French strings the backend writes to wallet_transactions.description
// (in /backend/routes/reservations.js + /backend/routes/wallet.js) onto i18n keys so the
// transaction list reads in the customer's chosen language. Anything we don't recognise
// falls through as-is — admin-entered credit-code blurbs ("Code: SUMMER", custom promo
// copy) are surfaced verbatim because they vary per campaign and aren't translatable
// from a static map.
const DESCRIPTION_KEY_MAP: Record<string, string> = {
  'paiement par crédits': 'wallet.descPaymentByCredits',
  'paiement par credits': 'wallet.descPaymentByCredits',
  'paiement effectué': 'wallet.descPaymentDone',
  'paiement effectue': 'wallet.descPaymentDone',
  'remboursement annulation': 'wallet.descRefundCancellation',
  'account deletion': 'wallet.descAccountDeletion',
};

function translateDescription(t: (k: string, opts?: any) => string, raw?: string): string | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase();
  const key = DESCRIPTION_KEY_MAP[norm];
  if (key) return t(key, { defaultValue: raw });
  // Gift-code descriptions look like "Code: SUMMER22" — keep the code part, translate the prefix.
  const codeMatch = raw.match(/^code\s*:\s*(.+)$/i);
  if (codeMatch) return t('wallet.descGiftCode', { code: codeMatch[1], defaultValue: raw });
  return raw;
}

export default function WalletScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const [codeExpanded, setCodeExpanded] = useState(false);
  const [giftCode, setGiftCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{ text: string; success: boolean } | null>(null);
  // QR scanner state — opens a modal camera view that reads a QR-encoded
  // gift code and funnels it into the same redeem flow as manual entry.
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const scanProcessingRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Keyboard-aware padding so the scrollable content can extend past the keyboard.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // Track the vertical position of the code form so we can scroll it into view
  // when the input is focused, even on short screens where the keyboard would
  // otherwise cover it.
  const listRef = useRef<FlatList<WalletTransaction> | null>(null);
  const codeFormYRef = useRef(0);

  // Step-driven re-measurement of the "Code Cadeau" recharge button. The
  // button's own onLayout fires once on initial layout, so any later layout
  // shift (wallet balance/transactions loading in above it, scroll offset
  // changes) leaves the published rect stale and the halo lands off-target
  // when the walkthrough reaches the `walletRecharge` step. We re-measure
  // from this screen because the (tabs) layout overlay can't reach a ref
  // inside a pushed Stack screen. Same pattern as the map-button / notif-
  // bell re-measure in (tabs)/_layout.tsx.
  const rechargeBtnRef = useRef<View>(null);
  const walkthroughKey = useWalkthroughStore((s) => s.currentStep?.measureKey);
  useEffect(() => {
    if (walkthroughKey !== 'walletRecharge') return;
    // When the expanded panel is open, leave the rect alone — the panel's
    // own onLayout (in the JSX below) publishes its rect under the same
    // key so the halo follows the textbox the user is supposed to look
    // at. We only re-measure the button here when the panel is collapsed.
    if (codeExpanded) return;
    // Clear the prior rect first — /wallet is pushed onto the navigation
    // stack, and the push animation can let an early onLayout publish a
    // mid-animation rect. The SubScreen overlay's haveRect fast-path then
    // paints the halo at that stale y for a frame before the re-measure
    // below snaps it into place (the "wrong halo then corrects" symptom).
    // Clearing puts the overlay into its dim-only branch until the
    // 280 ms post-push re-measure publishes the settled rect.
    useWalkthroughStore.getState().setMeasuredRect('walletRecharge', null);
    const t = setTimeout(() => {
      rechargeBtnRef.current?.measureInWindow((x, y, w, h) => {
        if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('walletRecharge', { x, y, w, h });
      });
    }, 280);
    return () => clearTimeout(t);
  }, [walkthroughKey, codeExpanded]);

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    staleTime: 30_000,
  });

  const balance = walletQuery.data?.balance ?? 0;
  const transactions = walletQuery.data?.transactions ?? [];

  // Per-attempt idempotency key for the redeem POST. Keyed by the redeemed
  // CODE STRING, so retrying the same code reuses the same key (replay-safe),
  // while typing a different code starts fresh. Cleared on success.
  const redeemAttemptKeysRef = useRef<Record<string, string>>({});

  // Shared code-redemption handler used by both manual entry ("Appliquer"
  // button) and the QR scanner. Keeps messaging + wallet invalidation in one
  // place so the two entry points stay in sync.
  const redeemGiftCode = async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    setCodeLoading(true);
    setCodeMsg(null);
    // Mint or reuse the per-code attempt key. The same code typed again (e.g.
    // user saw "couldn't verify" and tapped Appliquer again) gets the same
    // key so the backend replays the original outcome. A different code mints
    // its own. Same-code success → key cleared in the success branch below.
    const codeKeyMap = redeemAttemptKeysRef.current;
    if (!codeKeyMap[code]) codeKeyMap[code] = makeAttemptKey();
    const attemptKey = codeKeyMap[code];
    try {
      const res = await redeemCode(code, attemptKey);
      // Successful redemption — drop this code's key so a future redeem of
      // a different code starts fresh AND so the map doesn't grow unbounded.
      delete codeKeyMap[code];
      const amountTnd = res.amount.toFixed(2);
      setCodeMsg({ text: t('wallet.codeRedeemed', { amount: amountTnd, defaultValue: `+${amountTnd} TND ajoutés !` }), success: true });
      setGiftCode('');
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    } catch (err: any) {
      // Map the backend's distinct redeem failures to specific user-facing copy.
      //
      // Backend → app mapping:
      //   400 "Vous avez déjà utilisé ce code"               → already used
      //   400 "Ce code a expiré"                             → expired/missing
      //   400 "Ce code est désactivé"                        → expired/missing
      //   400 "Ce code a déjà été utilisé le nombre maximum" → expired/missing
      //   404 "Code invalide"                                → expired/missing
      //   No response at all (cold backend / route crash)    → server unreachable
      //                                                        — NOT "code doesn't exist"
      //                                                        because we genuinely
      //                                                        don't know if the code
      //                                                        is valid.
      const status = err?.status;
      const raw = String(err?.message ?? '').toLowerCase();
      // A failure with no clean response — status undefined (transport failed,
      // axios reports "Network Error") OR status 5xx (backend errored) — means
      // we genuinely don't know whether the code exists. The old copy here
      // said "Le serveur ne répond pas" which was misleading: in the cases the
      // user observed, OTHER codes were succeeding in the same session, so
      // it's not a global outage — just this one request that didn't come
      // back cleanly. Neutral "couldn't verify this code" copy is true
      // regardless of underlying cause, and reassures them the wallet wasn't
      // charged so they can safely retry the same code.
      const isUnverifiable =
        status == null ||
        (typeof status === 'number' && status >= 500) ||
        raw.includes('network error') ||
        raw.includes('timeout') ||
        raw.includes('erreur serveur');
      const isAlreadyUsed =
        status === 409 ||
        raw.includes('déjà utilisé ce code') ||
        raw.includes('already used') ||
        raw.includes('already redeemed');
      const isNotFoundOrExpired =
        !isAlreadyUsed && !isUnverifiable && (
          status === 404 ||
          raw.includes('code invalide') ||
          raw.includes('expiré') ||
          raw.includes('expired') ||
          raw.includes('désactivé') ||
          raw.includes('disabled') ||
          raw.includes('nombre maximum') ||
          raw.includes('max uses') ||
          raw.includes('not found')
        );
      const text = isAlreadyUsed
        ? t('wallet.codeAlreadyUsed', { defaultValue: 'Vous avez déjà utilisé ce code.' })
        : isNotFoundOrExpired
          ? t('wallet.codeNotFoundOrExpired', { defaultValue: 'Ce code n’existe pas ou a expiré.' })
          : isUnverifiable
            ? t('wallet.codeUnverifiable', { defaultValue: 'Impossible de vérifier ce code pour le moment. Vérifiez l’orthographe et réessayez — le code n’a pas été utilisé.' })
            : getErrorMessage(err);
      setCodeMsg({ text, success: false });
    } finally {
      setCodeLoading(false);
    }
  };

  const handleRedeemCode = () => redeemGiftCode(giftCode);

  // Extract a gift code from a scanned QR payload. Supports raw-string codes
  // (just the code itself) and JSON wrappers like {"code": "ABC123"} so
  // voucher generators can encode whichever shape they prefer.
  const extractCodeFromQR = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const candidate = parsed.code ?? parsed.gift_code ?? parsed.voucher ?? null;
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      }
    } catch {
      // not JSON — fall through and treat the raw string as the code
    }
    return trimmed;
  };

  const openScanner = async () => {
    setCodeMsg(null);
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) return;
    }
    setScanned(false);
    scanProcessingRef.current = false;
    setScannerVisible(true);
  };

  const handleQRScanned = ({ data }: { data: string }) => {
    if (scanProcessingRef.current || scanned) return;
    scanProcessingRef.current = true;
    setScanned(true);
    const code = extractCodeFromQR(data);
    if (!code) {
      setCodeMsg({ text: t('wallet.invalidCode', { defaultValue: 'Code invalide' }), success: false });
      setScannerVisible(false);
      scanProcessingRef.current = false;
      return;
    }
    setGiftCode(code.toUpperCase());
    setScannerVisible(false);
    setCodeExpanded(true);
    // Auto-submit — one-time codes are intended to flow straight through.
    // The server is responsible for rejecting already-redeemed codes; the
    // error surface is the same as manual entry (setCodeMsg).
    void redeemGiftCode(code);
  };

  const renderTransaction = ({ item }: { item: WalletTransaction }) => {
    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.admin_credit;
    const Icon = cfg.icon;
    const isPositive = item.amount > 0;
    const translatedDesc = translateDescription(t, item.description);

    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: cfg.color + '15', justifyContent: 'center', alignItems: 'center' }}>
          <Icon size={18} color={cfg.color} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '500' }}>
            {t(cfg.labelKey)}
          </Text>
          {translatedDesc && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {translatedDesc}
            </Text>
          )}
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            {new Date(item.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </Text>
        </View>
        <Text style={{ color: isPositive ? '#22c55e' : theme.colors.error, fontSize: 15, fontWeight: '700' }}>
          {isPositive ? '+' : ''}{item.amount.toFixed(2)} {t('common.currency', { defaultValue: 'TND' })}
        </Text>
      </View>
    );
  };

  const listHeader = (
    <>
      {/* Balance card */}
      <View style={{ marginHorizontal: 20, marginTop: 20, backgroundColor: '#114b3c', borderRadius: 20, padding: 28, alignItems: 'center' }}>
        <Wallet size={32} color="#e3ff5c" />
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 12 }}>
          {t('wallet.balance')}
        </Text>
        <Text style={{ color: '#fff', fontSize: 36, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginTop: 4 }}>
          {balance.toFixed(2)}
        </Text>
        <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '600', marginTop: 2 }}>{t('common.currency', { defaultValue: 'TND' })}</Text>
      </View>

      {/* How to earn */}
      <View style={{ marginHorizontal: 20, marginTop: 16, backgroundColor: theme.colors.primary + '08', borderRadius: 14, padding: 16 }}>
        <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>
          {t('wallet.earnCredits')}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
          {t('wallet.earnDesc')}
        </Text>
      </View>

      {/* Code Cadeau — collapsible. onLayout captures the top of this block
          so we can scroll it to the top of the visible area when the input
          is focused. */}
      <View
        onLayout={(e) => { codeFormYRef.current = e.nativeEvent.layout.y; }}
      >
        <TouchableOpacity
          ref={rechargeBtnRef as any}
          onLayout={(e) => {
            // Skip the onLayout-driven publish while the walkthrough is at
            // this step. The /wallet push animation fires onLayout with a
            // mid-animation y, racing our step-driven re-measure — user
            // briefly sees the halo at the wrong y before it corrects.
            // The 280 ms re-measure effect above is the authoritative
            // publisher during the walkthrough.
            if (useWalkthroughStore.getState().currentStep?.measureKey === 'walletRecharge') return;
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('walletRecharge', { x, y, w, h });
            });
          }}
          onPress={() => { setCodeExpanded((v) => !v); setCodeMsg(null); }}
          style={{ marginHorizontal: 20, marginTop: 16, backgroundColor: theme.colors.surface, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
        >
          <Gift size={18} color="#114b3c" />
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600', flex: 1, marginLeft: 10 }}>
            {t('wallet.giftCode', { defaultValue: 'Code Cadeau' })}
          </Text>
          <ChevronDown size={18} color={theme.colors.muted} style={{ transform: [{ rotate: codeExpanded ? '180deg' : '0deg' }] }} />
        </TouchableOpacity>
        {codeExpanded && (
          <View
            // Publish the EXPANDED panel's rect under the same walkthrough
            // key the button uses — when the user taps the "Code Cadeau"
            // button during the demo's wallet step, the section expands
            // and we want the halo to jump to the expanded textbox + Apply
            // row. The button's onLayout has its own guard that skips
            // publishing while currentStep.measureKey === 'walletRecharge'
            // (lines 259-265), so our new rect won't be overwritten by the
            // button's race-prone re-layout. When the user collapses the
            // section, this View unmounts; the step-driven re-measure
            // effect ~280 ms above re-publishes the button rect, so the
            // halo snaps back.
            onLayout={(e) => {
              if (useWalkthroughStore.getState().currentStep?.measureKey !== 'walletRecharge') return;
              (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
                if (w > 0 && h > 0) useWalkthroughStore.getState().setMeasuredRect('walletRecharge', { x, y, w, h });
              });
            }}
            style={{ marginHorizontal: 20, marginTop: 8, backgroundColor: theme.colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.colors.divider }}
          >
            {/* Input row: the code field fills, and a square QR-scan button
                sits to its right so voucher QR codes can be scanned without
                typing. During the demo's walletRecharge step the entire row
                is wrapped in a pointerEvents="none" View — tapping the field
                would otherwise focus it, open the soft keyboard, shift the
                expanded panel upward, and force the demo halo to chase the
                new position frame after frame. The walkthrough instructs
                the user to tap "Suivant" instead of interacting. Same for
                the QR scan button: opening the camera scanner mid-demo
                would tear down the walkthrough overlay entirely. */}
            <View
              pointerEvents={walkthroughKey === 'walletRecharge' ? 'none' : 'auto'}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <TextInput
                value={giftCode}
                onChangeText={(v) => { setGiftCode(v.toUpperCase()); setCodeMsg(null); }}
                placeholder={t('wallet.enterGiftCode', { defaultValue: 'ENTREZ VOTRE CODE' })}
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="characters"
                onFocus={() => {
                  // Wait for the keyboard to open, then scroll so the code form
                  // sits near the top of the visible area. Re-running after the
                  // keyboard finishes animating keeps it visible on slow phones.
                  setTimeout(() => {
                    listRef.current?.scrollToOffset({ offset: Math.max(0, codeFormYRef.current - 12), animated: true });
                  }, 250);
                }}
                editable={walkthroughKey !== 'walletRecharge'}
                showSoftInputOnFocus={walkthroughKey !== 'walletRecharge'}
                style={{ flex: 1, height: 44, borderWidth: 1, borderColor: '#114b3c', borderRadius: 10, paddingHorizontal: 14, color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600', letterSpacing: 2, textAlign: 'center' }}
              />
              <TouchableOpacity
                onPress={openScanner}
                accessibilityLabel={t('wallet.scanGiftCode', { defaultValue: 'Scanner un code QR' })}
                style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}
              >
                <QrCode size={22} color="#e3ff5c" />
              </TouchableOpacity>
            </View>
            {codeMsg && (
              <Text style={{ color: codeMsg.success ? '#22c55e' : theme.colors.error, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
                {codeMsg.text}
              </Text>
            )}
            <TouchableOpacity
              onPress={handleRedeemCode}
              disabled={codeLoading || !giftCode.trim()}
              style={{ backgroundColor: '#114b3c', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12, opacity: codeLoading || !giftCode.trim() ? 0.5 : 1 }}
            >
              {codeLoading ? (
                <ActivityIndicator color="#e3ff5c" size="small" />
              ) : (
                <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700' }}>
                  {t('wallet.applyCode', { defaultValue: 'Appliquer' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Transactions */}
      <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 24, marginHorizontal: 20, marginBottom: 8 }}>
        {t('wallet.history')}
      </Text>
    </>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider, minHeight: 52 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ position: 'absolute', left: 16, top: 14 }}
        >
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }}>
          {t('wallet.title')}
        </Text>
      </View>

      {walletQuery.isLoading ? (
        <DelayedLoader />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <FlatList
            ref={listRef}
            data={transactions}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderTransaction}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 40 }}>
                <CreditCard size={36} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, fontSize: 14, marginTop: 12 }}>
                  {t('wallet.noTransactions')}
                </Text>
              </View>
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 + kbHeight }}
            keyboardShouldPersistTaps="handled"
          />
        </KeyboardAvoidingView>
      )}

      {/* Gift-code QR scanner — opens full-screen. The server enforces
          one-time-use (codes flip to "redeemed" server-side), so a repeat
          scan surfaces the backend's error via the same codeMsg line as
          manual entry. */}
      <Modal
        visible={scannerVisible}
        animationType="slide"
        // Let the modal extend behind the status bar so we can place the
        // close button at a known offset from the true top of the screen.
        // Without this, Android's SafeAreaView-inside-Modal trick is
        // unreliable and the X ends up hidden under the status bar.
        statusBarTranslucent
        onRequestClose={() => setScannerVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <StatusBar style="light" />
          {/* Explicit inset padding so the close button always clears the
              status bar and notch, regardless of SafeAreaView quirks inside
              a RN Modal. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 10, paddingBottom: 12 }}>
            <TouchableOpacity
              onPress={() => setScannerVisible(false)}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' }}
            >
              <XIcon size={20} color="#fff" />
            </TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Poppins_600SemiBold', fontWeight: '600', flex: 1, textAlign: 'center' }}>
              {t('wallet.scanGiftCodeTitle', { defaultValue: 'Scanner le code' })}
            </Text>
            <View style={{ width: 36 }} />
          </View>
          {cameraPermission?.granted ? (
            <View style={{ flex: 1, position: 'relative' }}>
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : handleQRScanned}
              />
              <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }} pointerEvents="none">
                <View style={{ width: 250, height: 250, borderRadius: 24, borderWidth: 3, borderColor: '#e3ff5c' }} />
              </View>
              <View style={{ position: 'absolute', bottom: insets.bottom + 60, left: 40, right: 40, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 20 }}>
                <Text style={{ color: '#fff', textAlign: 'center', fontSize: 14, fontFamily: 'Poppins_400Regular' }}>
                  {scanned
                    ? t('wallet.scanProcessing', { defaultValue: 'Traitement…' })
                    : t('wallet.scanHint', { defaultValue: 'Pointez la caméra vers le QR code du bon.' })}
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
              <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: theme.colors.primary + '22', justifyContent: 'center', alignItems: 'center' }}>
                <Camera size={44} color={theme.colors.primary} />
              </View>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', textAlign: 'center', marginTop: 20 }}>
                {t('wallet.cameraPermTitle', { defaultValue: 'Accès caméra requis' })}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                {t('wallet.cameraPermDesc', { defaultValue: 'Autorisez la caméra pour scanner les QR codes des bons.' })}
              </Text>
              <View style={{ width: '100%', marginTop: 24 }}>
                <PrimaryCTAButton
                  onPress={() => { void requestCameraPermission(); }}
                  title={t('wallet.allowCamera', { defaultValue: 'Autoriser la caméra' })}
                />
              </View>
            </View>
          )}
        </View>
      </Modal>

      <SubScreenWalkthroughOverlay keys={['walletRecharge']} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
