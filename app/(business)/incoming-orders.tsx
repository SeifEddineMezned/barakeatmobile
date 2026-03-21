import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Phone, CheckCircle, XCircle, Clock, Package, QrCode, ClipboardList } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchTodayOrders, confirmPickup, type TodayReservationFromAPI } from '@/src/services/business';
import { getErrorMessage } from '@/src/lib/api';

export default function IncomingOrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'incoming' | 'completed'>('incoming');
  const queryClient = useQueryClient();
  const store = useBusinessStore();

  const todayQuery = useQuery({
    queryKey: ['today-orders'],
    queryFn: fetchTodayOrders,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Normalize API orders to match the existing Order type shape
  const orders = (todayQuery.data ?? []).length > 0
    ? (todayQuery.data ?? []).map((o: TodayReservationFromAPI) => {
        const pickupStart = (o.pickup_start_time as string)?.substring(0, 5) ?? '';
        const pickupEnd = (o.pickup_end_time as string)?.substring(0, 5) ?? '';
        return {
          id: String(o.id),
          basketId: String(o.restaurant_id ?? ''),
          basket: {
            id: String(o.restaurant_id ?? ''),
            merchantId: String(o.restaurant_id ?? ''),
            merchantName: (o as any).restaurant_name ?? '',
            name: (o as any).restaurant_name ?? '',
            category: '',
            originalPrice: Number(o.original_price ?? 0),
            discountedPrice: Number(o.price_tier ?? 0),
            discountPercentage: 50,
            pickupWindow: { start: pickupStart, end: pickupEnd },
            quantityLeft: 0,
            quantityTotal: 0,
            distance: 0,
            address: '',
            latitude: 0,
            longitude: 0,
            exampleItems: [],
            isActive: true,
          },
          quantity: o.quantity ?? 1,
          total: Number(o.price_tier ?? 0) * (o.quantity ?? 1),
          pickupWindow: { start: pickupStart, end: pickupEnd },
          pickupCode: o.pickup_code ?? '',
          status: (o.status ?? 'confirmed') as any,
          createdAt: o.created_at ?? new Date().toISOString(),
          customerName: o.buyer_name ?? 'Client',
          customerPhone: o.buyer_phone ?? undefined,
        };
      })
    : store.orders;

  const updateOrderStatus = store.updateOrderStatus;

  const incomingOrders = useMemo(
    () => orders.filter((o) => o.status === 'reserved' || o.status === 'ready' || o.status === 'confirmed' || o.status === 'pending'),
    [orders]
  );

  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === 'collected' || o.status === 'cancelled' || o.status === 'picked_up' || o.status === 'completed'),
    [orders]
  );

  const displayedOrders = activeTab === 'incoming' ? incomingOrders : completedOrders;

  const handleMarkReady = useCallback((orderId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateOrderStatus(orderId, 'ready');
  }, [updateOrderStatus]);

  const collectMutation = useMutation({
    mutationFn: async ({ orderId, code }: { orderId: string; code: string }) => {
      await confirmPickup(orderId, code);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
    },
    onError: (err) => {
      Alert.alert('Error', getErrorMessage(err));
    },
  });

  const handleMarkCollected = useCallback((orderId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const order = orders.find((o) => o.id === orderId);
    if (order?.pickupCode) {
      collectMutation.mutate({ orderId, code: order.pickupCode });
    }
    // Update local store to 'picked_up' to match what the DB will return
    updateOrderStatus(orderId, 'picked_up');
  }, [updateOrderStatus, orders, collectMutation]);

  const handleCancel = useCallback((orderId: string) => {
    Alert.alert(
      t('business.orders.cancelOrder'),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            updateOrderStatus(orderId, 'cancelled');
          },
        },
      ]
    );
  }, [updateOrderStatus, t]);

  const handleCall = useCallback((phone?: string) => {
    if (phone) {
      void Linking.openURL(`tel:${phone}`);
    }
  }, []);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'confirmed':
      case 'reserved':
      case 'pending':
        return { color: theme.colors.accentWarm, bg: theme.colors.accentWarm + '18', icon: Clock, label: t('business.orders.statusReserved') };
      case 'ready':
        return { color: theme.colors.success, bg: theme.colors.success + '18', icon: Package, label: t('business.orders.statusReady') };
      case 'picked_up':
      case 'collected':
      case 'completed':
        return { color: theme.colors.primary, bg: theme.colors.primary + '18', icon: CheckCircle, label: t('business.orders.statusCollected') };
      case 'cancelled':
        return { color: theme.colors.error, bg: theme.colors.error + '18', icon: XCircle, label: t('business.orders.statusCancelled') };
      default:
        return { color: theme.colors.muted, bg: theme.colors.bg, icon: Clock, label: status };
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.orders.title')}
        </Text>
      </View>

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

      <ScrollView style={styles.content} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {displayedOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={{
              alignItems: 'center',
              paddingTop: 60,
              paddingHorizontal: 24,
            }}>
              {/* Decorative card background */}
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
                <Text style={{
                  color: theme.colors.textPrimary,
                  ...theme.typography.h2,
                  textAlign: 'center',
                }}>
                  {activeTab === 'incoming'
                    ? t('business.orders.noOrdersToday', { defaultValue: 'No orders yet today' })
                    : t('business.orders.noCompletedOrders', { defaultValue: 'No completed orders' })}
                </Text>
                <Text style={{
                  color: theme.colors.textSecondary,
                  ...theme.typography.body,
                  marginTop: 10,
                  textAlign: 'center',
                  lineHeight: 22,
                }}>
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
                      {order.customerName ?? 'Client'}
                    </Text>
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                      {order.basket.name} × {order.quantity}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg, borderRadius: theme.radii.pill, paddingHorizontal: 12, paddingVertical: 6 }]}>
                    <StatusIcon size={14} color={statusConfig.color} />
                    <Text style={[{ color: statusConfig.color, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
                      {statusConfig.label}
                    </Text>
                  </View>
                </View>

                <View style={[styles.codeSection, { marginTop: theme.spacing.md, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: theme.spacing.md }]}>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                    {t('business.orders.pickupCode')}
                  </Text>
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.h2, letterSpacing: 3, fontWeight: '700' as const }]}>
                    {order.pickupCode}
                  </Text>
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

                {(order.status === 'reserved' || order.status === 'ready' || order.status === 'confirmed' || order.status === 'pending') && (
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
                    <View style={styles.statusActions}>
                      {(order.status === 'reserved' || order.status === 'confirmed' || order.status === 'pending') && (
                        <TouchableOpacity
                          onPress={() => handleMarkReady(order.id)}
                          style={[styles.actionBtn, { backgroundColor: theme.colors.success, borderRadius: theme.radii.r12, paddingHorizontal: 14, paddingVertical: 10 }]}
                        >
                          <Package size={16} color="#fff" />
                          <Text style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 6 }]}>
                            {t('business.orders.markReady')}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {order.status === 'ready' && (
                        <TouchableOpacity
                          onPress={() => handleMarkCollected(order.id)}
                          style={[styles.actionBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: 14, paddingVertical: 10 }]}
                        >
                          <CheckCircle size={16} color="#fff" />
                          <Text style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 6 }]}>
                            {t('business.orders.markCollected')}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => handleCancel(order.id)}
                        style={[styles.actionBtn, { backgroundColor: theme.colors.error + '12', borderRadius: theme.radii.r12, paddingHorizontal: 14, paddingVertical: 10, marginLeft: 8 }]}
                      >
                        <XCircle size={16} color={theme.colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

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
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderCard: {},
  orderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  codeSection: {
    alignItems: 'center',
  },
  orderDetails: {},
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabButton: {},
});
