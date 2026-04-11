import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock, QrCode, ClipboardList, Check, X as XIcon, ChevronDown, ChevronUp, AlertTriangle, MessageCircle } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTodayOrders, confirmPickup, type TodayReservationFromAPI } from '@/src/services/business';
import { getErrorMessage, apiClient } from '@/src/lib/api';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { fetchConversationUnreads } from '@/src/services/messages';

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

type CanonicalStatus = 'confirmed' | 'picked_up' | 'cancelled' | 'expired';

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
  updatedAt: string;
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
    case 'expired':
    case 'no_show':
      return 'expired';
    default:
      // Unknown status — treat as incoming/confirmed so it is visible
      return 'confirmed';
  }
}

export default function IncomingOrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const [activeTab, setActiveTab] = useState<'incoming' | 'completed' | 'issues'>('incoming');
  const statsScrollRef = useRef<ScrollView>(null);
  const queryClient = useQueryClient();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);

  const todayQuery = useQuery({
    queryKey: ['today-orders', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const msgUnreadsQuery = useQuery({
    queryKey: ['conversation-unreads'],
    queryFn: fetchConversationUnreads,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const msgUnreads = msgUnreadsQuery.data ?? {};

  // Normalize API orders — preserve buyerId so confirmPickup can send it to backend.
  const orders: NormalizedOrder[] = (todayQuery.data ?? []).map((o: TodayReservationFromAPI) => {
    const pickupStart = (o.pickup_start_time as string)?.substring(0, 5) ?? '';
    const pickupEnd = (o.pickup_end_time as string)?.substring(0, 5) ?? '';
    return {
      id: String(o.id),
      buyerId: o.buyer_id,                          // ← preserved from API response
      basketName: (o as any).basket_name ?? (o as any).restaurant_name ?? t('orders.surpriseBag', { defaultValue: 'Panier Surprise' }),
      quantity: o.quantity ?? 1,
      total: Number(o.price_tier ?? 0) * (o.quantity ?? 1),
      pickupWindow: { start: pickupStart, end: pickupEnd },
      pickupCode: o.pickup_code ?? '',
      status: normalizeStatus(o.status),
      createdAt: o.created_at ?? new Date().toISOString(),
      updatedAt: (o as any).updated_at ?? o.created_at ?? new Date().toISOString(),
      customerName: o.buyer_name ?? t('business.orders.customer'),
      customerPhone: o.buyer_phone ?? undefined,
    };
  });

  // Tab filters — derived purely from canonical backend states
  const incomingOrders = useMemo(
    () => orders.filter((o) => o.status === 'confirmed'),
    [orders]
  );

  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === 'picked_up'),
    [orders]
  );

  const issueOrders = useMemo(
    () => orders.filter((o) => o.status === 'cancelled' || o.status === 'expired'),
    [orders]
  );

  const displayedOrders = activeTab === 'incoming' ? incomingOrders : activeTab === 'completed' ? completedOrders : issueOrders;

  // Auto-scroll stat carousel to active tab
  const statsTabIndex = activeTab === 'incoming' ? 0 : activeTab === 'completed' ? 1 : 2;
  useEffect(() => {
    const screenW = Dimensions.get('window').width;
    const cardW = screenW * 0.38;
    const gap = 8;
    statsScrollRef.current?.scrollTo({ x: statsTabIndex * (cardW + gap) - (screenW - cardW) / 2 + cardW / 2, animated: true });
  }, [statsTabIndex]);

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

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const toggleExpand = useCallback((id: string) => {
    setExpandedOrderId((prev) => (prev === id ? null : id));
  }, []);

  const handleCancel = useCallback((orderId: string) => {
    alert.showAlert(
      t('business.orders.cancelOrder'),
      '',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              // Call backend to cancel the reservation
              await apiClient.delete(`/api/reservations/${orderId}`);
              // Refetch to update the list
              void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
              void queryClient.invalidateQueries({ queryKey: ['today-orders-count'] });
            } catch (err) {
              alert.showAlert(t('common.error'), getErrorMessage(err));
            }
          },
        },
      ]
    );
  }, [queryClient, t, alert]);

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
          label: t('business.orders.statusCancelled', { defaultValue: 'Annulé' }),
        };
      case 'expired':
        return {
          color: theme.colors.accentWarm,
          bg: theme.colors.accentWarm + '18',
          icon: AlertTriangle,
          label: t('business.orders.statusExpired', { defaultValue: 'Expiré' }),
        };
    }
  };

  if (todayQuery.isLoading && !todayQuery.data) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
        <StatusBar style="dark" />
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.orders.title')}
        </Text>
      </View>

      {/* Stat carousel — syncs with active tab */}
      {(() => {
        const screenW = Dimensions.get('window').width;
        const cardW = screenW * 0.38;
        const gap = 8;

        const slides = [
          { key: 'incoming' as const, icon: Clock, iconColor: '#e3ff5c', bg: theme.colors.primary, textColor: '#fff', subColor: 'rgba(255,255,255,0.7)', count: incomingOrders.length, label: t('business.orders.pendingPickup', { defaultValue: 'en attente de retrait' }) },
          { key: 'completed' as const, icon: Check, iconColor: '#114b3c', bg: '#e3ff5c', textColor: '#114b3c', subColor: theme.colors.textSecondary, count: completedOrders.length, label: t('business.orders.statusPickedUp', { defaultValue: 'récupérées' }) },
          { key: 'issues' as const, icon: XIcon, iconColor: theme.colors.error, bg: theme.colors.error + '14', textColor: theme.colors.error, subColor: theme.colors.textSecondary, count: issueOrders.length, label: t('business.orders.issues', { defaultValue: 'annulées' }) },
        ];

        return (
        <ScrollView
          ref={statsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: theme.spacing.sm, flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 20, gap }}
        >
          {slides.map((s) => {
            const isActive = activeTab === s.key;
            const SlideIcon = s.icon;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => setActiveTab(s.key)}
                activeOpacity={0.85}
                style={{
                  width: cardW,
                  backgroundColor: s.bg,
                  borderRadius: theme.radii.r12,
                  height: 60,
                  paddingHorizontal: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  opacity: isActive ? 1 : 0.5,
                  borderWidth: isActive ? 2 : 0,
                  borderColor: isActive ? s.textColor + '40' : 'transparent',
                }}
              >
                <SlideIcon size={14} color={s.iconColor} />
                <Text style={{ color: s.textColor, fontSize: 18, fontFamily: 'Poppins_700Bold' }}>
                  {s.count}
                </Text>
                <Text style={{ color: s.subColor, fontSize: 10, fontFamily: 'Poppins_400Regular', flex: 1 }} numberOfLines={1}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        );
      })()}

      {/* Tab bar — En cours / Terminées / Problèmes */}
      <View style={[styles.tabs, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.sm }]}>
        {(['incoming', 'completed', 'issues'] as const).map((tab) => {
          const label = tab === 'incoming' ? t('business.orders.incoming')
            : tab === 'completed' ? t('business.orders.completed')
            : t('business.orders.issues', { defaultValue: 'Problèmes' });
          const count = tab === 'incoming' ? incomingOrders.length : tab === 'completed' ? completedOrders.length : issueOrders.length;
          return (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              {
                flex: 1,
                paddingVertical: theme.spacing.md,
                borderBottomWidth: 2,
                borderBottomColor: activeTab === tab ? (tab === 'issues' ? theme.colors.error : theme.colors.primary) : 'transparent',
              },
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                {
                  color: activeTab === tab ? (tab === 'issues' ? theme.colors.error : theme.colors.primary) : theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                  fontWeight: activeTab === tab ? ('600' as const) : ('400' as const),
                  textAlign: 'center' as const,
                },
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
          );
        })}
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
            const isExpanded = expandedOrderId === order.id;

            return (
              <TouchableOpacity
                key={order.id}
                activeOpacity={0.85}
                onPress={() => toggleExpand(order.id)}
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
                {/* Compact header — always visible */}
                <View style={styles.orderTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                      {order.customerName}
                    </Text>
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                      {order.basketName} × {order.quantity}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {isIncoming && (
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/message/[id]', params: { id: `res-${order.id}`, reservationId: String(order.id), buyerId: String(order.buyerId ?? ''), locationId: String(selectedLocationId ?? '') } } as never); }}
                        style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <MessageCircle size={15} color={theme.colors.primary} />
                        {(msgUnreads[Number(order.id)] ?? 0) > 0 && (
                          <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, borderWidth: 2, borderColor: theme.colors.surface }}>
                            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{msgUnreads[Number(order.id)] > 9 ? '9+' : msgUnreads[Number(order.id)]}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    )}
                    {!isIncoming && (
                      <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg, borderRadius: theme.radii.pill, paddingHorizontal: 10, paddingVertical: 5 }]}>
                        <StatusIcon size={12} color={statusConfig.color} />
                        <Text style={[{ color: statusConfig.color, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
                          {statusConfig.label}
                        </Text>
                      </View>
                    )}
                    {isExpanded
                      ? <ChevronUp size={16} color={theme.colors.textSecondary} />
                      : <ChevronDown size={16} color={theme.colors.textSecondary} />}
                  </View>
                </View>

                {/* Expanded details */}
                {isExpanded && (
                  <>
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
                      {/* Reservation date for incoming orders */}
                      {isIncoming && (
                        <View style={[styles.detailRow, { marginTop: 4 }]}>
                          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                            {t('business.orders.reservedAt', { defaultValue: 'Réservé le' })}
                          </Text>
                          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                            {new Date(order.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(order.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      )}
                      {/* Date of collection, cancellation, or expiry */}
                      {!isIncoming && (
                        <View style={[styles.detailRow, { marginTop: 4 }]}>
                          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                            {order.status === 'picked_up'
                              ? t('business.orders.collectedAt', { defaultValue: 'Récupéré le' })
                              : order.status === 'expired'
                              ? t('business.orders.expiredAt', { defaultValue: 'Expiré le' })
                              : t('business.orders.cancelledAt', { defaultValue: 'Annulé le' })}
                          </Text>
                          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                            {new Date(order.updatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} {new Date(order.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Action row — only for incoming confirmed orders */}
                    {isIncoming && (
                      <View style={[styles.actionRow, { marginTop: theme.spacing.lg, paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation?.(); openVerifyModal(order.id); }}
                          style={[
                            styles.actionBtn,
                            {
                              flex: 1,
                              backgroundColor: theme.colors.primary,
                              borderRadius: theme.radii.r12,
                              paddingHorizontal: 14,
                              paddingVertical: 10,
                              justifyContent: 'center',
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
                  </>
                )}
              </TouchableOpacity>
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
