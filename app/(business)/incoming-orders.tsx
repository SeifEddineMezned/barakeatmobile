import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Phone, CheckCircle, XCircle, Clock, Package } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';

export default function IncomingOrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<'incoming' | 'completed'>('incoming');
  const { orders, updateOrderStatus } = useBusinessStore();

  const incomingOrders = useMemo(
    () => orders.filter((o) => o.status === 'reserved' || o.status === 'ready'),
    [orders]
  );

  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === 'collected' || o.status === 'cancelled'),
    [orders]
  );

  const displayedOrders = activeTab === 'incoming' ? incomingOrders : completedOrders;

  const handleMarkReady = useCallback((orderId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateOrderStatus(orderId, 'ready');
  }, [updateOrderStatus]);

  const handleMarkCollected = useCallback((orderId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateOrderStatus(orderId, 'collected');
  }, [updateOrderStatus]);

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
      case 'reserved':
        return { color: theme.colors.accentWarm, bg: theme.colors.accentWarm + '18', icon: Clock, label: t('business.orders.statusReserved') };
      case 'ready':
        return { color: theme.colors.success, bg: theme.colors.success + '18', icon: Package, label: t('business.orders.statusReady') };
      case 'collected':
        return { color: theme.colors.primary, bg: theme.colors.primary + '18', icon: CheckCircle, label: t('business.orders.statusCollected') };
      case 'cancelled':
        return { color: theme.colors.error, bg: theme.colors.error + '18', icon: XCircle, label: t('business.orders.statusCancelled') };
      default:
        return { color: theme.colors.muted, bg: theme.colors.bg, icon: Clock, label: status };
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.orders.title')}
        </Text>
      </View>

      <View style={[styles.tabs, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }]}>
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
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', marginTop: 60 }]}>
              {t('business.orders.noOrders')}
            </Text>
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

                {(order.status === 'reserved' || order.status === 'ready') && (
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
                      {order.status === 'reserved' && (
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
});
