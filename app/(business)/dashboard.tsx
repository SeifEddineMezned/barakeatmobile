import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ShoppingBag, DollarSign, Clock, Leaf, Star, X } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useAuthStore } from '@/src/stores/authStore';

const SCREEN_WIDTH = Dimensions.get('window').width;

function SimpleBarChart({ data, labels, color, maxVal }: { data: number[]; labels: string[]; color: string; maxVal?: number }) {
  const theme = useTheme();
  const max = maxVal ?? Math.max(...data, 1);
  const barWidth = Math.min(32, (SCREEN_WIDTH - 120) / data.length - 8);

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {data.map((val, i) => {
          const height = Math.max(4, (val / max) * 100);
          return (
            <View key={i} style={chartStyles.barCol}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '600' as const, marginBottom: 4 }]}>
                {val}
              </Text>
              <View style={[chartStyles.barBg, { backgroundColor: theme.colors.divider, borderRadius: 4, width: barWidth }]}>
                <View
                  style={[
                    chartStyles.barFill,
                    { height: `${height}%`, backgroundColor: color, borderRadius: 4, width: barWidth },
                  ]}
                />
              </View>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 4 }]}>
                {labels[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  barsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
  },
  barCol: {
    alignItems: 'center',
  },
  barBg: {
    height: 100,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
  },
});

function ReviewBar({ label, value, color }: { label: string; value: number; color: string }) {
  const theme = useTheme();
  const pct = (value / 5) * 100;
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>{label}</Text>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>{value.toFixed(1)}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: theme.colors.divider, borderRadius: 3 }}>
        <View style={{ height: 6, width: `${pct}%`, backgroundColor: color, borderRadius: 3 }} />
      </View>
    </View>
  );
}

export default function BusinessDashboard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuthStore();
  const { stats, baskets } = useBusinessStore();
  const [showRatingModal, setShowRatingModal] = useState(false);

  const activeBasket = baskets.find((b) => b.isActive && b.reviews);
  const reviews = activeBasket?.reviews ?? { service: 4.7, quantite: 4.5, qualite: 4.8, variete: 4.4 };

  const dayLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const weekLabels = ['S1', 'S2', 'S3', 'S4'];

  const topStats = [
    { label: t('business.dashboard.revenue'), value: `${stats.totalRevenue}`, suffix: 'TND', icon: DollarSign, color: theme.colors.secondary },
    { label: t('business.dashboard.basketsSold'), value: stats.totalBasketsSold.toString(), suffix: '', icon: ShoppingBag, color: theme.colors.primary },
    { label: t('business.dashboard.pendingOrders'), value: stats.pendingOrders.toString(), suffix: '', icon: Clock, color: theme.colors.accentWarm },
    { label: t('business.dashboard.mealsRescued'), value: stats.mealsRescued.toString(), suffix: '', icon: Leaf, color: theme.colors.accentFresh },
  ];

  const handleRatingPress = useCallback(() => {
    setShowRatingModal(true);
  }, []);

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

        <TouchableOpacity
          onPress={handleRatingPress}
          activeOpacity={0.8}
          style={[styles.ratingCard, {
            backgroundColor: theme.colors.primary,
            marginHorizontal: theme.spacing.xl,
            marginTop: theme.spacing.xl,
            borderRadius: theme.radii.r16,
            padding: theme.spacing.lg,
            ...theme.shadows.shadowMd,
          }]}
        >
          <View style={styles.ratingRow}>
            <View style={styles.ratingLeft}>
              <Star size={24} color={theme.colors.secondary} fill={theme.colors.secondary} />
              <Text style={[{ color: '#fff', ...theme.typography.display, marginLeft: 12 }]}>
                {stats.averageRating.toFixed(1)}
              </Text>
            </View>
            <View style={styles.ratingRight}>
              <Text style={[{ color: 'rgba(255,255,255,0.8)', ...theme.typography.bodySm }]}>
                {t('business.dashboard.avgRating')}
              </Text>
              <Text style={[{ color: 'rgba(255,255,255,0.6)', ...theme.typography.caption, marginTop: 2 }]}>
                Appuyez pour voir les détails →
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={[styles.statsSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.todayOverview')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {topStats.map((stat, index) => {
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
                      minWidth: 140,
                      ...theme.shadows.shadowSm,
                    },
                  ]}
                >
                  <View style={[styles.statIconWrap, { backgroundColor: stat.color + '18', borderRadius: theme.radii.r12, width: 36, height: 36 }]}>
                    <IconComponent size={18} color={stat.color} />
                  </View>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, marginTop: theme.spacing.sm }]}>
                    {stat.value}{stat.suffix ? ` ${stat.suffix}` : ''}
                  </Text>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]} numberOfLines={1}>
                    {stat.label}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        <View style={[styles.chartSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.salesChart')}
          </Text>
          <View style={[styles.chartCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 4 }]}>
              {t('business.dashboard.dailySales')}
            </Text>
            <SimpleBarChart
              data={stats.dailySales}
              labels={dayLabels}
              color={theme.colors.primary}
            />
          </View>
        </View>

        <View style={[styles.chartSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.avgSalesChart')}
          </Text>
          <View style={[styles.chartCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 4 }]}>
              {t('business.dashboard.weeklySales')}
            </Text>
            <SimpleBarChart
              data={stats.weeklySales}
              labels={weekLabels}
              color={theme.colors.accentFresh}
            />
          </View>
        </View>

        <View style={[styles.perfSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.performance')}
          </Text>
          <View style={[styles.perfGrid]}>
            <View style={[styles.perfCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
              <TrendingUp size={20} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, marginTop: 8 }]}>
                {stats.activeBaskets}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                {t('business.dashboard.activeBaskets')}
              </Text>
            </View>
            <View style={[styles.perfCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
              <Leaf size={20} color={theme.colors.accentFresh} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, marginTop: 8 }]}>
                {(stats.mealsRescued * 2.5).toFixed(0)} kg
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                CO₂ économisé
              </Text>
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={showRatingModal} transparent animationType="slide" onRequestClose={() => setShowRatingModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.r24, borderTopRightRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}>
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('business.dashboard.ratingDetails')}
              </Text>
              <TouchableOpacity onPress={() => setShowRatingModal(false)}>
                <X size={22} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.overallRatingBlock, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
              <Star size={28} color={theme.colors.secondary} fill={theme.colors.secondary} />
              <Text style={[{ color: '#fff', ...theme.typography.display, marginLeft: 12 }]}>
                {stats.averageRating.toFixed(1)}
              </Text>
              <Text style={[{ color: 'rgba(255,255,255,0.7)', ...theme.typography.bodySm, marginLeft: 12 }]}>/5</Text>
            </View>

            <View style={{ marginTop: theme.spacing.xl }}>
              <ReviewBar label="Service" value={reviews.service} color={theme.colors.primary} />
              <ReviewBar label="Quantité" value={reviews.quantite} color={theme.colors.accentFresh} />
              <ReviewBar label="Qualité" value={reviews.qualite} color={theme.colors.primary} />
              <ReviewBar label="Variété" value={reviews.variete} color={theme.colors.accentFresh} />
            </View>

            <TouchableOpacity
              onPress={() => setShowRatingModal(false)}
              style={[{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl }]}
            >
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, textAlign: 'center' as const, fontWeight: '600' as const }]}>
                {t('common.close')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  ratingCard: {},
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ratingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingRight: {
    alignItems: 'flex-end',
  },
  statsSection: {},
  statCard: {},
  statIconWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartSection: {},
  chartCard: {},
  perfSection: {},
  perfGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  perfCard: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overallRatingBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
