import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useOrdersStore } from '@/src/stores/ordersStore';
import { OrderCard } from '@/src/components/OrderCard';

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const orders = useOrdersStore((state) => state.orders);

  const upcomingOrders = useMemo(
    () => orders.filter((order) => order.status === 'reserved' || order.status === 'ready'),
    [orders]
  );

  const pastOrders = useMemo(
    () => orders.filter((order) => order.status === 'collected' || order.status === 'cancelled'),
    [orders]
  );

  const displayedOrders = activeTab === 'upcoming' ? upcomingOrders : pastOrders;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('orders.title')}</Text>
      </View>

      <View style={[styles.tabs, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            {
              flex: 1,
              paddingVertical: theme.spacing.md,
              borderBottomWidth: 2,
              borderBottomColor: activeTab === 'upcoming' ? theme.colors.primary : 'transparent',
            },
          ]}
          onPress={() => setActiveTab('upcoming')}
        >
          <Text
            style={[
              {
                color: activeTab === 'upcoming' ? theme.colors.primary : theme.colors.textSecondary,
                ...theme.typography.body,
                fontWeight: activeTab === 'upcoming' ? ('600' as const) : ('400' as const),
                textAlign: 'center',
              },
            ]}
          >
            {t('orders.upcoming')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            {
              flex: 1,
              paddingVertical: theme.spacing.md,
              borderBottomWidth: 2,
              borderBottomColor: activeTab === 'past' ? theme.colors.primary : 'transparent',
            },
          ]}
          onPress={() => setActiveTab('past')}
        >
          <Text
            style={[
              {
                color: activeTab === 'past' ? theme.colors.primary : theme.colors.textSecondary,
                ...theme.typography.body,
                fontWeight: activeTab === 'past' ? ('600' as const) : ('400' as const),
                textAlign: 'center',
              },
            ]}
          >
            {t('orders.past')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={[{ padding: theme.spacing.xl }]}>
        {displayedOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <Text
              style={[
                {
                  color: theme.colors.textSecondary,
                  ...theme.typography.body,
                  textAlign: 'center',
                },
              ]}
            >
              {t('orders.emptyState')}
            </Text>
          </View>
        ) : (
          displayedOrders.map((order) => <OrderCard key={order.id} order={order} />)
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
});
