import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { TrendingUp, ShoppingBag, DollarSign, Clock, Leaf, Star, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useAuthStore } from '@/src/stores/authStore';

export default function BusinessDashboard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const { stats, orders } = useBusinessStore();

  const pendingOrders = orders.filter((o) => o.status === 'reserved' || o.status === 'ready');

  const statCards = [
    { label: t('business.dashboard.basketsSold'), value: stats.totalBasketsSold.toString(), icon: ShoppingBag, color: theme.colors.primary },
    { label: t('business.dashboard.revenue'), value: `${stats.totalRevenue} TND`, icon: DollarSign, color: theme.colors.secondary },
    { label: t('business.dashboard.pendingOrders'), value: stats.pendingOrders.toString(), icon: Clock, color: theme.colors.accentWarm },
    { label: t('business.dashboard.mealsRescued'), value: stats.mealsRescued.toString(), icon: Leaf, color: theme.colors.accentFresh },
    { label: t('business.dashboard.activeBaskets'), value: stats.activeBaskets.toString(), icon: TrendingUp, color: theme.colors.primaryLight },
    { label: t('business.dashboard.avgRating'), value: stats.averageRating.toFixed(1), icon: Star, color: theme.colors.starYellow },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl }]}>
          <View>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
              {t('business.dashboard.greeting')} 👋
            </Text>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1, marginTop: 2 }]}>
              {user?.name ?? 'Mon Commerce'}
            </Text>
          </View>
          <View style={[styles.liveBadge, { backgroundColor: theme.colors.primary + '15', borderRadius: theme.radii.pill, paddingHorizontal: 12, paddingVertical: 6 }]}>
            <View style={[styles.liveDot, { backgroundColor: theme.colors.success }]} />
            <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 6 }]}>
              En ligne
            </Text>
          </View>
        </View>

        <View style={[styles.statsSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
            {t('business.dashboard.todayOverview')}
          </Text>
          <View style={styles.statsGrid}>
            {statCards.map((stat, index) => {
              const IconComponent = stat.icon;
              return (
                <View
                  key={index}
                  style={[
                    styles.statCard,
                    {
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.radii.r16,
                      padding: theme.spacing.lg,
                      ...theme.shadows.shadowSm,
                    },
                  ]}
                >
                  <View style={[styles.statIconWrap, { backgroundColor: stat.color + '18', borderRadius: theme.radii.r12, width: 40, height: 40 }]}>
                    <IconComponent size={20} color={stat.color} />
                  </View>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, marginTop: theme.spacing.sm }]}>
                    {stat.value}
                  </Text>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]} numberOfLines={1}>
                    {stat.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={[styles.recentSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl }]}>
          <View style={styles.sectionHeader}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {t('business.dashboard.recentOrders')}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(business)/incoming-orders' as never)}>
              <Text style={[{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                {t('business.dashboard.viewAll')}
              </Text>
            </TouchableOpacity>
          </View>

          {pendingOrders.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xxl, marginTop: theme.spacing.md, ...theme.shadows.shadowSm }]}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }]}>
                {t('business.dashboard.noOrders')}
              </Text>
            </View>
          ) : (
            pendingOrders.slice(0, 3).map((order) => (
              <TouchableOpacity
                key={order.id}
                style={[
                  styles.orderCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    padding: theme.spacing.lg,
                    marginTop: theme.spacing.md,
                    ...theme.shadows.shadowSm,
                  },
                ]}
                onPress={() => router.push('/(business)/incoming-orders' as never)}
                activeOpacity={0.7}
              >
                <View style={styles.orderCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]} numberOfLines={1}>
                      {order.customerName ?? 'Client'}
                    </Text>
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
                      {order.basket.name} × {order.quantity}
                    </Text>
                  </View>
                  <View style={styles.orderRight}>
                    <View style={[
                      styles.statusChip,
                      {
                        backgroundColor: order.status === 'reserved' ? theme.colors.accentWarm + '20' : theme.colors.success + '20',
                        borderRadius: theme.radii.pill,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      },
                    ]}>
                      <Text style={[{
                        color: order.status === 'reserved' ? theme.colors.accentWarm : theme.colors.success,
                        ...theme.typography.caption,
                        fontWeight: '600' as const,
                      }]}>
                        {order.status === 'reserved' ? 'Réservé' : 'Prêt'}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={theme.colors.muted} style={{ marginLeft: 8 }} />
                  </View>
                </View>
                <View style={[styles.orderCodeRow, { marginTop: theme.spacing.sm, paddingTop: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                    Code: <Text style={{ fontWeight: '700' as const, color: theme.colors.primary }}>{order.pickupCode}</Text>
                  </Text>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                    {order.pickupWindow.start} - {order.pickupWindow.end}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statsSection: {},
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '47%',
    flexGrow: 1,
  },
  statIconWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  recentSection: {
    paddingBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emptyCard: {},
  orderCard: {},
  orderCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusChip: {},
  orderCodeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
