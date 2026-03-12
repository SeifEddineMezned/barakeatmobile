import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { TrendingUp, ShoppingBag, DollarSign, Clock, Leaf, Star, X, Package, AlertCircle } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useAuthStore } from '@/src/stores/authStore';
import { LineChart } from '@/src/components/LineChart';

const SCREEN_WIDTH = Dimensions.get('window').width;

function SimpleBarChart({ data, labels, color, stackData, stackColor }: { data: number[]; labels: string[]; color: string; stackData?: number[]; stackColor?: string }) {
  const theme = useTheme();
  const allMax = Math.max(...data.map((v, i) => v + (stackData?.[i] ?? 0)), 1);
  const barWidth = Math.min(28, (SCREEN_WIDTH - 140) / data.length - 10);

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.barsRow}>
        {data.map((val, i) => {
          const stackVal = stackData?.[i] ?? 0;
          const total = val + stackVal;
          const height = Math.max(6, (total / allMax) * 110);
          const mainH = total > 0 ? (val / total) * height : 0;
          const stackH = total > 0 ? (stackVal / total) * height : 0;
          return (
            <View key={i} style={chartStyles.barCol}>
              <View style={[chartStyles.barBg, { height: 120, width: barWidth, borderRadius: 6, backgroundColor: 'transparent' }]}>
                <View style={{ flex: 1 }} />
                {stackData && (
                  <View style={{ height: stackH, backgroundColor: stackColor ?? theme.colors.secondary, borderTopLeftRadius: 6, borderTopRightRadius: 6, width: barWidth }} />
                )}
                <View style={{ height: mainH, backgroundColor: color, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, borderTopLeftRadius: stackData ? 0 : 6, borderTopRightRadius: stackData ? 0 : 6, width: barWidth }} />
              </View>
              <Text style={[{ color: theme.colors.muted, fontSize: 10, marginTop: 6, fontFamily: 'Poppins_400Regular' }]}>
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
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
});

function ReviewBar({ label, value, color }: { label: string; value: number; color: string }) {
  const theme = useTheme();
  const pct = (value / 5) * 100;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>{label}</Text>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>{value.toFixed(1)}</Text>
      </View>
      <View style={{ height: 8, backgroundColor: theme.colors.divider, borderRadius: 4 }}>
        <View style={{ height: 8, width: `${pct}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
    </View>
  );
}

function StatMiniCard({ icon: Icon, value, label, suffix, color, theme }: any) {
  return (
    <View style={[miniStyles.card, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, ...theme.shadows.shadowSm }]}>
      <View style={[miniStyles.iconWrap, { backgroundColor: color + '14', borderRadius: 10 }]}>
        <Icon size={16} color={color} />
      </View>
      <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 8 }]}>
        {value}{suffix ? ` ${suffix}` : ''}
      </Text>
      <Text style={[{ color: theme.colors.muted, fontSize: 10, marginTop: 2, fontFamily: 'Poppins_400Regular' }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const miniStyles = StyleSheet.create({
  card: {
    flex: 1,
    padding: 14,
  },
  iconWrap: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default function BusinessDashboard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuthStore();
  const { stats, baskets } = useBusinessStore();
  const [showRatingModal, setShowRatingModal] = useState(false);

  const activeBasket = baskets.find((b) => b.isActive && b.reviews);
  const reviews = activeBasket?.reviews ?? { service: 4.7, quantite: 4.5, qualite: 4.8, variete: 4.4 };

  const dayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const weekLabels = ['S1', 'S2', 'S3', 'S4'];

  const handleRatingPress = useCallback(() => {
    setShowRatingModal(true);
  }, []);

  const chartWidth = Math.min(SCREEN_WIDTH - 80, 320);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl }]}>
          <View style={styles.headerLeft}>
            <Text style={[{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_400Regular' }]}>
              {t('business.dashboard.greeting')}
            </Text>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1, marginTop: 2 }]}>
              {user?.name ?? 'Mon Commerce'}
            </Text>
          </View>
          <View style={[styles.liveBadge, { backgroundColor: theme.colors.success + '18', borderRadius: theme.radii.pill, paddingHorizontal: 12, paddingVertical: 6 }]}>
            <View style={[styles.liveDot, { backgroundColor: theme.colors.success }]} />
            <Text style={[{ color: theme.colors.success, fontSize: 11, fontWeight: '600' as const, marginLeft: 6, fontFamily: 'Poppins_600SemiBold' }]}>
              {t('business.dashboard.online')}
            </Text>
          </View>
        </View>

        <View style={[styles.summaryBanner, {
          backgroundColor: theme.colors.primary,
          marginHorizontal: theme.spacing.xl,
          marginTop: theme.spacing.xl,
          borderRadius: theme.radii.r20,
          padding: theme.spacing.lg,
        }]}>
          <Text style={[{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'Poppins_400Regular' }]}>
            {t('business.dashboard.daySummary')}
          </Text>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <DollarSign size={14} color={theme.colors.secondary} />
              <Text style={[styles.summaryVal, { color: '#fff' }]}>{stats.totalRevenue}</Text>
              <Text style={[styles.summarySuffix, { color: 'rgba(255,255,255,0.7)' }]}>{'TND'}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
            <View style={styles.summaryItem}>
              <ShoppingBag size={14} color={theme.colors.secondary} />
              <Text style={[styles.summaryVal, { color: '#fff' }]}>{stats.totalBasketsSold}</Text>
              <Text style={[styles.summarySuffix, { color: 'rgba(255,255,255,0.7)' }]}>{t('business.dashboard.sold')}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
            <View style={styles.summaryItem}>
              <Clock size={14} color={theme.colors.secondary} />
              <Text style={[styles.summaryVal, { color: '#fff' }]}>{stats.pendingOrders}</Text>
              <Text style={[styles.summarySuffix, { color: 'rgba(255,255,255,0.7)' }]}>{t('business.dashboard.pending')}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
            <View style={styles.summaryItem}>
              <Package size={14} color={theme.colors.secondary} />
              <Text style={[styles.summaryVal, { color: '#fff' }]}>{stats.mealsRescued}</Text>
              <Text style={[styles.summarySuffix, { color: 'rgba(255,255,255,0.7)' }]}>{t('business.dashboard.rescued')}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleRatingPress}
          activeOpacity={0.8}
          style={[styles.ratingCard, {
            backgroundColor: theme.colors.surface,
            marginHorizontal: theme.spacing.xl,
            marginTop: theme.spacing.lg,
            borderRadius: theme.radii.r16,
            padding: theme.spacing.lg,
            ...theme.shadows.shadowSm,
          }]}
        >
          <View style={styles.ratingRow}>
            <View style={styles.ratingLeft}>
              <View style={[styles.ratingStarBg, { backgroundColor: theme.colors.starYellow + '18' }]}>
                <Star size={20} color={theme.colors.starYellow} fill={theme.colors.starYellow} />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                  {stats.averageRating.toFixed(1)}
                </Text>
                <Text style={[{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular' }]}>
                  {t('business.dashboard.avgRating')}
                </Text>
              </View>
            </View>
            <View style={[styles.ratingArrow, { backgroundColor: theme.colors.bg }]}>
              <Text style={[{ color: theme.colors.primary, fontSize: 12, fontFamily: 'Poppins_600SemiBold' }]}>{t('business.dashboard.details')} →</Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={[styles.statsGrid, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xl }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.performance')}
          </Text>
          <View style={styles.statsRow}>
            <StatMiniCard icon={TrendingUp} value={stats.activeBaskets} label={t('business.dashboard.activeBaskets')} color={theme.colors.primary} theme={theme} />
            <View style={{ width: 10 }} />
            <StatMiniCard icon={Leaf} value={`${(stats.mealsRescued * 2.5).toFixed(0)}kg`} label={t('business.dashboard.co2Saved')} color={theme.colors.accentFresh} theme={theme} />
          </View>
          <View style={[styles.statsRow, { marginTop: 10 }]}>
            <StatMiniCard icon={DollarSign} value={stats.totalRevenue} suffix="TND" label={t('business.dashboard.revenue')} color={theme.colors.accentWarm} theme={theme} />
            <View style={{ width: 10 }} />
            <StatMiniCard icon={AlertCircle} value={stats.pendingOrders} label={t('business.dashboard.pendingOrders')} color={theme.colors.error} theme={theme} />
          </View>
        </View>

        <View style={[styles.chartSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.xxl }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.salesChart')}
          </Text>
          <View style={[styles.chartCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} />
                <Text style={[{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular' }]}>{t('business.dashboard.salesLegend')}</Text>
              </View>
            </View>
            <View style={{ alignItems: 'center' }}>
              <LineChart
                data={stats.dailySales}
                labels={dayLabels}
                color={theme.colors.primary}
                gradientColor={theme.colors.accentFresh}
                width={chartWidth}
                height={150}
              />
            </View>
          </View>
        </View>

        <View style={[styles.chartSection, { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
            {t('business.dashboard.avgSalesChart')}
          </Text>
          <View style={[styles.chartCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
            <View style={styles.chartLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.primary }]} />
                <Text style={[{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular' }]}>{t('business.dashboard.basketsLegend')}</Text>
              </View>
              <View style={[styles.legendItem, { marginLeft: 12 }]}>
                <View style={[styles.legendDot, { backgroundColor: theme.colors.secondary }]} />
                <Text style={[{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular' }]}>{t('business.dashboard.revenueLegend')}</Text>
              </View>
            </View>
            <SimpleBarChart
              data={stats.weeklySales}
              labels={weekLabels}
              color={theme.colors.primary}
              stackData={[18, 22, 20, 25]}
              stackColor={theme.colors.secondary}
            />
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={showRatingModal} transparent animationType="slide" onRequestClose={() => setShowRatingModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}>
            <View style={[styles.modalHandle, { backgroundColor: theme.colors.divider, alignSelf: 'center', marginBottom: theme.spacing.lg }]} />
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('business.dashboard.ratingDetails')}
              </Text>
              <TouchableOpacity onPress={() => setShowRatingModal(false)} style={[styles.modalCloseBtn, { backgroundColor: theme.colors.bg }]}>
                <X size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.overallRatingBlock, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: theme.spacing.lg }]}>
              <Star size={28} color={theme.colors.secondary} fill={theme.colors.secondary} />
              <Text style={[{ color: '#fff', ...theme.typography.display, marginLeft: 12 }]}>
                {stats.averageRating.toFixed(1)}
              </Text>
              <Text style={[{ color: 'rgba(255,255,255,0.6)', fontSize: 18, marginLeft: 4, fontFamily: 'Poppins_400Regular' }]}>/5</Text>
            </View>

            <View style={{ marginTop: theme.spacing.xl }}>
              <ReviewBar label={t('basket.reviewService')} value={reviews.service} color={theme.colors.primary} />
              <ReviewBar label={t('basket.reviewQuantite')} value={reviews.quantite} color={theme.colors.accentFresh} />
              <ReviewBar label={t('basket.reviewQualite')} value={reviews.qualite} color={theme.colors.accentWarm} />
              <ReviewBar label={t('basket.reviewVariete')} value={reviews.variete} color={theme.colors.secondary} />
            </View>

            <TouchableOpacity
              onPress={() => setShowRatingModal(false)}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
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
  headerLeft: {},
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryBanner: {},
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryVal: {
    fontSize: 20,
    fontWeight: '700' as const,
    marginTop: 4,
    fontFamily: 'Poppins_700Bold',
  },
  summarySuffix: {
    fontSize: 10,
    marginTop: 2,
    fontFamily: 'Poppins_400Regular',
  },
  summaryDivider: {
    width: 1,
    height: 36,
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
  ratingStarBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingArrow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statsGrid: {},
  statsRow: {
    flexDirection: 'row',
  },
  chartSection: {},
  chartCard: {},
  chartLegend: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '85%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overallRatingBlock: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
