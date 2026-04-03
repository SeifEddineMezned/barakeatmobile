import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Phone, CheckCircle, XCircle, Clock, QrCode, ClipboardList, Check, X as XIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTodayOrders, confirmPickup, type TodayReservationFromAPI } from '@/src/services/business';
import { getErrorMessage, apiClient } from '@/src/lib/api';

// ─── Canonical UI status model ────────────────────────────────────────────────
// Backend emits:  confirmed | picked_up | cancelled
// (Legacy values like reserved/pending/collected/completed are tolerated as
//  defensive fallbacks and immediately normalized into the canonical model.)
//
// UI meaning:
//   confirmed  → "Ready for pickup"  (incoming tab)
//   picked_up  → "Picked up"         (completed tab)
//   cancelled  → "Cancelled"         (completed tab)
// ─────────────────────────────────────────────────────────────────────────────

type CanonicalStatus = 'confirmed' | 'picked_up' | 'cancelled';

interface NormalizedOrder {
  id: string;
  buyerId: string | number | undefined;
  basketName: string;
  quantity: number;
  total: number;
  pickupWindow: { start: string; end: string };
  pickupCode: string;
  status: CanonicalStatus;
  createdAt: string;
  customerName: string;
  customerPhone?: string;
}

/** Map any legacy backend status string into the canonical UI status. */
function normalizeStatus(raw: string | undefined): CanonicalStatus {
  switch (raw) {
    case 'confirmed':
    case 'reserved':   // legacy fallback
    case 'pending':    // legacy fallback
      return 'confirmed';
    case 'picked_up':
    case 'collected':  // legacy fallback
    case 'completed':  // legacy fallback
      return 'picked_up';
    case 'cancelled':
      return 'cancelled';
    default:
      // Unknown status — treat as incoming/confirmed so it is visible
      return 'confirmed';
  }
}

export default function IncomingOrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'incoming' | 'completed'>('incoming');
  const queryClient = useQueryClient();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);

  const todayQuery = useQuery({
    queryKey: ['today-orders', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Normalize API orders — preserve buyerId so confirmPickup can send it to backend.
  const orders: NormalizedOrder[] = (todayQuery.data ?? []).map((o: TodayReservationFromAPI) => {
    const pickupStart = (o.pickup_start_time as string)?.substring(0, 5) ?? '';
    const pickupEnd = (o.pickup_end_time as string)?.substring(0, 5) ?? '';
    return {
      id: String(o.id),
      buyerId: o.buyer_id,                          // ← preserved from API response
      basketName: (o as any).restaurant_name ?? '',
      quantity: o.quantity ?? 1,
      total: Number(o.price_tier ?? 0) * (o.quantity ?? 1),
      pickupWindow: { start: pickupStart, end: pickupEnd },
      pickupCode: o.pickup_code ?? '',
      status: normalizeStatus(o.status),
      createdAt: o.created_at ?? new Date().toISOString(),
      customerName: o.buyer_name ?? 'Client',
      customerPhone: o.buyer_phone ?? undefined,
    };
  });

  // Tab filters — derived purely from canonical backend states
  const incomingOrders = useMemo(
    () => orders.filter((o) => o.status === 'confirmed'),
    [orders]
  );

  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === 'picked_up' || o.status === 'cancelled'),
    [orders]
  );

  const displayedOrders = activeTab === 'incoming' ? incomingOrders : completedOrders;

  // ─── Verify-pickup modal state ──────────────────────────────────────────────
  const [verifyModalOrderId, setVerifyModalOrderId] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const openVerifyModal = useCallback((orderId: string) => {
    setTypedCode('');
    setVerifyError('');
    setVerifySuccess(false);
    setVerifyModalOrderId(orderId);
  }, []);

  const closeVerifyModal = useCallback(() => {
    setVerifyModalOrderId(null);
    setTypedCode('');
    setVerifyError('');
    setVerifySuccess(false);
  }, []);

  /** Single real flow: verify code → confirmPickup → invalidate queries */
  const handleVerifyCode = useCallback(async () => {
    if (!verifyModalOrderId) return;
    const order = orders.find((o) => o.id === verifyModalOrderId);
    if (!order) return;

    const expected = (order.pickupCode ?? '').trim().toUpperCase();
    const entered = typedCode.trim().toUpperCase();

    if (!entered) {
      setVerifyError(t('business.orders.enterPickupCode', { defaultValue: 'Please enter the pickup code.' }));
      return;
    }
    if (entered !== expected) {
      setVerifyError(t('business.orders.incorrectCode', { defaultValue: 'Incorrect code. Please try again.' }));
      return;
    }

    setVerifyLoading(true);
    try {
      // Pass buyerId so backend can send pickup notification to the buyer
      await confirmPickup(order.id, order.pickupCode, order.buyerId);

      setVerifySuccess(true);

      // Invalidate + refetch after a brief pause to let the DB settle
      setTimeout(async () => {
        await queryClient.invalidateQueries({ queryKey: ['today-orders'] });
        await queryClient.invalidateQueries({ queryKey: ['today-orders-count'] });
        await queryClient.refetchQueries({ queryKey: ['today-orders', selectedLocationId] });
      }, 500);

      // Close after showing the success state
      setTimeout(() => {
        closeVerifyModal();
      }, 2000);
    } catch (err) {
      setVerifySuccess(false);
      setVerifyError(getErrorMessage(err));
    } finally {
      setVerifyLoading(false);
    }
  }, [verifyModalOrderId, typedCode, orders, closeVerifyModal, selectedLocationId, queryClient, t]);

  const handleCancel = useCallback((orderId: string) => {
    Alert.alert(
      t('business.orders.cancelOrder'),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Call backend to cancel the reservation
              await apiClient.delete(`/api/reservations/${orderId}`);
              // Refetch to update the list
              void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
              void queryClient.invalidateQueries({ queryKey: ['today-orders-count'] });
            } catch (err) {
              Alert.alert(t('common.error'), getErrorMessage(err));
            }
          },
        },
      ]
    );
  }, [queryClient, t]);

  const handleCall = useCallback((phone?: string) => {
    if (phone) {
      void Linking.openURL(`tel:${phone}`);
    }
  }, []);

  const getStatusConfig = (status: CanonicalStatus) => {
    switch (status) {
      case 'confirmed':
        return {
          color: theme.colors.accentWarm,
          bg: theme.colors.accentWarm + '18',
          icon: Clock,
          label: t('business.orders.statusReadyForPickup', { defaultValue: 'Ready for pickup' }),
        };
      case 'picked_up':
        return {
          color: theme.colors.primary,
          bg: theme.colors.primary + '18',
          icon: CheckCircle,
          label: t('business.orders.statusPickedUp', { defaultValue: 'Picked up' }),
        };
      case 'cancelled':
        return {
          color: theme.colors.error,
          bg: theme.colors.error + '18',
          icon: XCircle,
          label: t('business.orders.statusCancelled', { defaultValue: 'Cancelled' }),
        };
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.orders.title')}
        </Text>
      </View>

      {/* Order Status Breakdown */}
      {orders.length > 0 && (
        <View style={{ paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, backgroundColor: '#16a34a12', borderRadius: theme.radii.r12, padding: 12, alignItems: 'center' }}>
              <Check size={14} color="#16a34a" />
              <Text style={{ color: '#16a34a', fontSize: 20, fontFamily: 'Poppins_700Bold', marginTop: 4 }}>
                {orders.filter(o => o.status === 'picked_up').length}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontFamily: 'Poppins_400Regular' }}>
                {t('business.orders.statusPickedUp', { defaultValue: 'Picked up' })}
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: theme.colors.primary + '12', borderRadius: theme.radii.r12, padding: 12, alignItems: 'center' }}>
              <Clock size={14} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, fontSize: 20, fontFamily: 'Poppins_700Bold', marginTop: 4 }}>
                {incomingOrders.length}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontFamily: 'Poppins_400Regular' }}>
                {t('orders.status.confirmed', { defaultValue: 'Confirmed' })}
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: theme.colors.error + '12', borderRadius: theme.radii.r12, padding: 12, alignItems: 'center' }}>
              <XIcon size={14} color={theme.colors.error} />
              <Text style={{ color: theme.colors.error, fontSize: 20, fontFamily: 'Poppins_700Bold', marginTop: 4 }}>
                {orders.filter(o => o.status === 'cancelled').length}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, fontFamily: 'Poppins_400Regular' }}>
                {t('orders.status.cancelled', { defaultValue: 'Cancelled' })}
              </Text>
            </View>
          </View>
        </View>
      )}

      <View style={[styles.tabs, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.sm }]}>
        {(['incoming', 'completed'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              {
                flex: 1,
                paddingVertical: theme.spacing.md,
                borderBottomWidth: 2,
                borderBottomColor: activeTab === tab ? theme.colors.primary : 'transparent',
              },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                {
                  color: activeTab === tab ? theme.colors.primary : theme.colors.textSecondary,
                  ...theme.typography.body,
                  fontWeight: activeTab === tab ? ('600' as const) : ('400' as const),
                  textAlign: 'center' as const,
                },
              ]}
            >
              {tab === 'incoming' ? t('business.orders.incoming') : t('business.orders.completed')}
              {tab === 'incoming' && incomingOrders.length > 0 ? ` (${incomingOrders.length})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {displayedOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 24 }}>
              <View style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r20,
                padding: 32,
                alignItems: 'center',
                width: '100%',
                ...theme.shadows.shadowSm,
              }}>
                <View style={{
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  backgroundColor: theme.colors.primary + '10',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 20,
                }}>
                  <ClipboardList size={40} color={theme.colors.primary} />
                </View>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center' }}>
                  {activeTab === 'incoming'
                    ? t('business.orders.noOrdersToday', { defaultValue: 'No orders yet today' })
                    : t('business.orders.noCompletedOrders', { defaultValue: 'No completed orders' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 10, textAlign: 'center', lineHeight: 22 }}>
                  {activeTab === 'incoming'
                    ? t('business.orders.noOrdersDesc', { defaultValue: 'Orders will appear here when customers reserve your surprise bags.' })
                    : t('business.orders.noCompletedDesc', { defaultValue: 'Completed and cancelled orders will show up here.' })}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          displayedOrders.map((order) => {
            const statusConfig = getStatusConfig(order.status);
            const StatusIcon = statusConfig.icon;
            const isIncoming = order.status === 'confirmed';

            return (
              <View
                key={order.id}
                style={[
                  styles.orderCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    padding: theme.spacing.lg,
                    marginBottom: theme.spacing.md,
                    ...theme.shadows.shadowSm,
                  },
                ]}
              >
                <View style={styles.orderTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                      {order.customerName}
                    </Text>
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                      {order.basketName} × {order.quantity}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg, borderRadius: theme.radii.pill, paddingHorizontal: 12, paddingVertical: 6 }]}>
                    <StatusIcon size={14} color={statusConfig.color} />
                    <Text style={[{ color: statusConfig.color, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
                      {statusConfig.label}
                    </Text>
                  </View>
                </View>

                <View style={[styles.orderDetails, { marginTop: theme.spacing.md }]}>
                  <View style={styles.detailRow}>
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                      {t('reserve.total')}
                    </Text>
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}>
                      {order.total} TND
                    </Text>
                  </View>
                  <View style={[styles.detailRow, { marginTop: 4 }]}>
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                      {t('basket.pickupWindow')}
                    </Text>
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                      {order.pickupWindow.start} - {order.pickupWindow.end}
                    </Text>
                  </View>
                </View>

                {/* Action row — only shown for incoming (confirmed) orders */}
                {isIncoming && (
                  <View style={[styles.actionRow, { marginTop: theme.spacing.lg, paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
                    {order.customerPhone && (
                      <TouchableOpacity
                        onPress={() => handleCall(order.customerPhone)}
                        style={[styles.actionBtn, { backgroundColor: theme.colors.primary + '12', borderRadius: theme.radii.r12, paddingHorizontal: 14, paddingVertical: 10 }]}
                      >
                        <Phone size={16} color={theme.colors.primary} />
                        <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 6 }]}>
                          {t('business.orders.callCustomer')}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Single real action: verify pickup code → confirmPickup */}
                    <TouchableOpacity
                      onPress={() => openVerifyModal(order.id)}
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: theme.colors.primary,
                          borderRadius: theme.radii.r12,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          marginLeft: order.customerPhone ? 8 : 0,
                        },
                      ]}
                    >
                      <CheckCircle size={16} color="#fff" />
                      <Text style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 6 }]}>
                        {t('business.orders.confirmPickup', { defaultValue: 'Confirm Pickup' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* QR scanner FAB */}
      <TouchableOpacity
        onPress={() => router.push('/business/scan-qr' as never)}
        style={[styles.fabButton, {
          position: 'absolute',
          bottom: 100,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: theme.colors.primary,
          justifyContent: 'center',
          alignItems: 'center',
          ...theme.shadows.shadowLg,
        }]}
      >
        <QrCode size={24} color="#fff" />
      </TouchableOpacity>

      {/* Verify Pickup modal — single purpose: enter code → confirmPickup */}
      <Modal
        visible={verifyModalOrderId !== null}
        transparent
        animationType="fade"
        onRequestClose={closeVerifyModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
            activeOpacity={1}
            onPress={closeVerifyModal}
          >
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                padding: 24,
                paddingBottom: 40,
                ...theme.shadows.shadowLg,
              }}
              onStartShouldSetResponder={() => true}
            >
              {/* Success state */}
              {verifySuccess ? (
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.primary + '18', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ fontSize: 32 }}>✓</Text>
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: 4 }}>
                    {t('business.orders.pickupConfirmed', { defaultValue: 'Pickup confirmed!' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>
                    {t('business.orders.orderMovedToPickedUp', { defaultValue: 'Order moved to picked up.' })}
                  </Text>
                </View>
              ) : (
                <>
                  {/* Handle */}
                  <View style={{ alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.divider }} />
                  </View>

                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginBottom: 8 }}>
                    {t('business.orders.verifyPickup', { defaultValue: 'Verify Pickup' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 20, lineHeight: 20 }}>
                    {t('business.orders.verifyDesc', { defaultValue: 'Ask the customer for their pickup code and enter it below, or use the QR scanner.' })}
                  </Text>

                  <TextInput
                    style={{
                      height: 56,
                      backgroundColor: theme.colors.bg,
                      borderRadius: theme.radii.r12,
                      paddingHorizontal: 18,
                      color: theme.colors.textPrimary,
                      ...theme.typography.h3,
                      letterSpacing: 3,
                      textAlign: 'center',
                      borderWidth: verifyError ? 1 : 0,
                      borderColor: verifyError ? theme.colors.error : 'transparent',
                      marginBottom: 8,
                    }}
                    value={typedCode}
                    onChangeText={(v) => { setTypedCode(v); setVerifyError(''); }}
                    placeholder="ABC123"
                    placeholderTextColor={theme.colors.muted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  {verifyError ? (
                    <Text style={{ color: theme.colors.error, ...theme.typography.caption, textAlign: 'center', marginBottom: 12 }}>
                      {verifyError}
                    </Text>
                  ) : <View style={{ height: 12 }} />}

                  <TouchableOpacity
                    onPress={handleVerifyCode}
                    disabled={verifyLoading}
                    style={{
                      backgroundColor: verifyLoading ? theme.colors.muted : theme.colors.primary,
                      borderRadius: theme.radii.r12,
                      paddingVertical: 16,
                      alignItems: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <Text style={{ color: '#fff', ...theme.typography.button }}>
                      {verifyLoading
                        ? t('common.loading', { defaultValue: 'Loading...' })
                        : t('business.orders.confirmCode', { defaultValue: 'Confirm Code' })}
                    </Text>
                  </TouchableOpacity>

                  {/* OR divider */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                    <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginHorizontal: 12, fontWeight: '600' as const }}>
                      {t('common.or', { defaultValue: 'OR' })}
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.divider }} />
                  </View>

                  <TouchableOpacity
                    onPress={() => { closeVerifyModal(); router.push('/business/scan-qr' as never); }}
                    style={{
                      borderRadius: theme.radii.r12,
                      paddingVertical: 14,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: theme.colors.primary,
                      flexDirection: 'row',
                      justifyContent: 'center',
                    }}
                  >
                    <QrCode size={18} color={theme.colors.primary} style={{ marginRight: 8 }} />
                    <Text style={{ color: theme.colors.primary, ...theme.typography.button }}>
                      {t('business.orders.scanQR', { defaultValue: 'Scan QR Code' })}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {},
  tabs: { flexDirection: 'row' },
  tab: {},
  content: { flex: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center' },
  orderCard: {},
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  statusBadge: { flexDirection: 'row', alignItems: 'center' },
  orderDetails: {},
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actionBtn: { flexDirection: 'row', alignItems: 'center' },
  fabButton: {},
});
