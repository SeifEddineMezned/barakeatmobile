import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { QrCode, X, CheckCircle, Keyboard, Camera, SwitchCamera, Hand } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import {
  fetchTodayOrders,
  confirmPickup,
  verifyQR,
  type TodayReservationFromAPI,
} from '@/src/services/business';
import { fetchBasketById } from '@/src/services/baskets';
import { getErrorMessage } from '@/src/lib/api';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';

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
  const params = useLocalSearchParams<{ demoBack?: string }>();
  const isDemoBack = params.demoBack === '1';
  const demoScanCode = useWalkthroughStore((s) => s.demoScanCode);
  const setDemoScanCode = useWalkthroughStore((s) => s.setDemoScanCode);
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  const walkthroughCurrentStep = useWalkthroughStore((s) => s.currentStep);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  const inDemoMode = demoScanCode !== null;
  useEffect(() => {
    if (!isDemoBack) return;
    return () => {
      // On unmount (user taps close / nav pops the screen), advance the
      // walkthrough past the scanQrBack step if we're still on it.
      if (useWalkthroughStore.getState().currentStep?.measureKey === 'scanQrBack') {
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
  // highlight are immediately visible.
  const [mode, setMode] = useState<'camera' | 'manual'>(inDemoMode ? 'manual' : 'camera');
  const [scanned, setScanned] = useState(false);
  const processingRef = useRef(false); // ref-based guard — prevents double-scan race condition
  const [permission, requestPermission] = useCameraPermissions();

  // Mock the success state when the user taps Verify in demo mode — skip
  // the API call and surface a fake confirmed order.
  const handleVerifyDemo = () => {
    setMatchedOrder({
      id: 'demo-order-1',
      buyer_id: 0,
      buyer_name: t('walkthrough.biz.demoOrderCustomer', { defaultValue: 'Sami (démo)' }),
      quantity: 2,
      pickup_code: 'DEMO1',
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
    if (processingRef.current || verified) return; // Prevent double processing
    processingRef.current = true;
    setLoading(true);
    try {
      const orders = await fetchTodayOrders();
      const match = orders.find(
        (o) => (o.pickup_code ?? '').toUpperCase() === pickupCode.trim().toUpperCase()
      );
      if (!match) {
        alert.showAlert(t('common.error'), t('business.scan.codeNotFound'));
        setLoading(false);
        setScanned(false);
        return;
      }
      // Pass buyer_id so backend can send pickup notification to the buyer
      await confirmPickup(String(match.id), pickupCode.trim().toUpperCase(), match.buyer_id);
      setVerified(true);
      setMatchedOrder(match);
      void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['location-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['business-analytics'] });
    } catch (err) {
      alert.showAlert(t('common.error'), getErrorMessage(err));
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned || loading || processingRef.current) return;
    processingRef.current = true;
    setScanned(true);

    // Try using verifyQR for full backend verification, then confirm pickup once
    setLoading(true);
    verifyQR(data)
      .then(async (verifyResult) => {
        if (!verifyResult.valid) {
          alert.showAlert(t('common.error'), t('business.scan.codeNotFound'));
          setScanned(false);
          processingRef.current = false;
          return;
        }
        // Confirm pickup — single call only
        await confirmPickup(
          String(verifyResult.reservation_id),
          verifyResult.pickup_code ?? '',
          verifyResult.buyer_id
        );
        // verifyQR's payload is lean (no basket info). To show the correct
        // basket name on the success screen, locate the FULL reservation row
        // (which has basket_name straight from the JOIN) and use it as the
        // matchedOrder. Mirrors what the manual code-entry path does — and
        // crucially we match across ALL ['today-orders', locationId] cache
        // entries, since incoming-orders.tsx scopes the key by location.
        let fullMatch: TodayReservationFromAPI | undefined;
        const cachedQueries = queryClient.getQueriesData<TodayReservationFromAPI[]>({ queryKey: ['today-orders'] });
        for (const [, data] of cachedQueries) {
          if (Array.isArray(data)) {
            const m = data.find((o) => String(o.id) === String(verifyResult.reservation_id));
            if (m) { fullMatch = m; break; }
          }
        }
        if (!fullMatch) {
          try {
            const orders = await fetchTodayOrders();
            fullMatch = orders.find((o) => String(o.id) === String(verifyResult.reservation_id));
          } catch {}
        }
        if (fullMatch) {
          // The row's top-level basket_name is unreliable (backend returns
          // the location's default basket regardless of which one was
          // reserved). The row's basket_id IS correct (FK from when the
          // reservation was created), so resolve the canonical name via
          // /api/baskets/:id. Patch it onto matchedOrder so the display
          // priority chain picks it up.
          const basketId = (fullMatch as any).basket_id;
          if (basketId != null) {
            try {
              const canonical = await fetchBasketById(String(basketId));
              if (canonical?.name) {
                (fullMatch as any).basket_name = canonical.name;
                (fullMatch as any).basket = {
                  ...((fullMatch as any).basket ?? {}),
                  name: canonical.name,
                };
              }
            } catch {}
          }
          setMatchedOrder(fullMatch);
        } else {
          // Last-resort fallback: synthesize from verifyQR (no basket name).
          setMatchedOrder({
            id: verifyResult.reservation_id ?? '',
            buyer_id: verifyResult.buyer_id,
            buyer_name: verifyResult.buyer_name,
            quantity: verifyResult.quantity,
            pickup_code: verifyResult.pickup_code,
            status: verifyResult.status,
          } as TodayReservationFromAPI);
        }
        setVerified(true);
        void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
        void queryClient.invalidateQueries({ queryKey: ['location-orders'] });
        void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
        void queryClient.invalidateQueries({ queryKey: ['business-analytics'] });
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
    router.back();
  };

  // Success state
  if (verified) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <View style={styles.successContainer}>
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
              onChangeText={(text) => setCode(text.toUpperCase().slice(0, 6))}
              placeholder={t('business.scan.codePlaceholder')}
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="characters"
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
