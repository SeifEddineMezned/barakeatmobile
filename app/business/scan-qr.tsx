import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { QrCode, X, CheckCircle, Keyboard, Camera, SwitchCamera } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
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
import { getErrorMessage } from '@/src/lib/api';

export default function ScanQRScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<TodayReservationFromAPI | null>(null);
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [scanned, setScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const handleVerifyCode = async (pickupCode: string) => {
    if (pickupCode.trim().length < 4) {
      Alert.alert(t('common.error'), t('business.scan.codeTooShort'));
      return;
    }
    setLoading(true);
    try {
      const orders = await fetchTodayOrders();
      const match = orders.find(
        (o) => (o.pickup_code ?? '').toUpperCase() === pickupCode.trim().toUpperCase()
      );
      if (!match) {
        Alert.alert(t('common.error'), t('business.scan.codeNotFound'));
        setLoading(false);
        setScanned(false);
        return;
      }
      // Pass buyer_id so backend can send pickup notification to the buyer
      await confirmPickup(String(match.id), pickupCode.trim().toUpperCase(), match.buyer_id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setVerified(true);
      setMatchedOrder(match);
      void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
    } catch (err) {
      Alert.alert(t('common.error'), getErrorMessage(err));
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Try using verifyQR for full backend verification (parses JSON QR data internally)
    setLoading(true);
    verifyQR(data)
      .then(async (verifyResult) => {
        if (!verifyResult.valid) {
          Alert.alert(t('common.error'), t('business.scan.codeNotFound'));
          setScanned(false);
          return;
        }
        // Confirm pickup with buyer_id so notification reaches buyer
        await confirmPickup(
          String(verifyResult.reservation_id),
          verifyResult.pickup_code ?? '',
          verifyResult.buyer_id
        );
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Build a minimal matched order object from verifyResult for display
        setMatchedOrder({
          id: verifyResult.reservation_id ?? '',
          buyer_id: verifyResult.buyer_id,
          buyer_name: verifyResult.buyer_name,
          quantity: verifyResult.quantity,
          pickup_code: verifyResult.pickup_code,
          status: verifyResult.status,
        } as TodayReservationFromAPI);
        setVerified(true);
        void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
      })
      .catch((err) => {
        // verifyQR failed — fall back to manual pickup code flow if QR is not JSON
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
          Alert.alert(t('common.error'), getErrorMessage(err));
          setScanned(false);
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
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
            onPress={() => {
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
                onPress={() => requestPermission()}
                title={t('business.scan.allowCamera', { defaultValue: 'Allow Camera Access' })}
              />
            </View>
            <TouchableOpacity
              onPress={() => setMode('manual')}
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
                onPress={() => handleVerifyCode(code)}
                title={t('business.scan.verify')}
                loading={loading}
                disabled={code.trim().length < 4}
              />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
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
