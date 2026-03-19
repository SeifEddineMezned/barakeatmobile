import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations, cancelReservation, hideReservation } from '@/src/services/reservations';
import { getErrorMessage } from '@/src/lib/api';
import { ReservationCard } from '@/src/components/ReservationCard';

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');

  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated,
    staleTime: 30_000,
    retry: 2,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelReservation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
    onError: (err) => {
      Alert.alert(t('common.error'), getErrorMessage(err));
    },
  });

  const hideMutation = useMutation({
    mutationFn: (id: string) => hideReservation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  const upcomingOrders = useMemo(
    () => (reservationsQuery.data ?? []).filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'reserved' || status === 'ready' || status === 'pending' || status === 'confirmed';
    }),
    [reservationsQuery.data]
  );

  const pastOrders = useMemo(
    () => (reservationsQuery.data ?? []).filter((r) => {
      const status = (r.status ?? '').toLowerCase();
      return status === 'collected' || status === 'cancelled' || status === 'completed' || status === 'expired';
    }),
    [reservationsQuery.data]
  );

  const displayedOrders = activeTab === 'upcoming' ? upcomingOrders : pastOrders;

  const handleCancel = useCallback((id: string) => {
    Alert.alert(
      t('orders.cancelTitle'),
      t('orders.cancelConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => cancelMutation.mutate(id) },
      ]
    );
  }, [cancelMutation, t]);

  const handleHide = useCallback((id: string) => {
    hideMutation.mutate(id);
  }, [hideMutation]);

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>{t('orders.title')}</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
            {t('orders.loginRequired')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

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
        {reservationsQuery.isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 16 }]}>
              {t('common.loading')}
            </Text>
          </View>
        ) : reservationsQuery.isError ? (
          <View style={styles.centerState}>
            <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center' as const, marginBottom: 16 }]}>
              {t('common.errorOccurred')}
            </Text>
            <TouchableOpacity
              onPress={() => reservationsQuery.refetch()}
              style={[styles.retryButton, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12 }]}
            >
              <RefreshCw size={16} color="#fff" />
              <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
                {t('common.retry')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : displayedOrders.length === 0 ? (
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
          displayedOrders.map((reservation) => (
            <ReservationCard
              key={reservation.id}
              reservation={reservation}
              onCancel={handleCancel}
              onHide={handleHide}
            />
          ))
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
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
});
