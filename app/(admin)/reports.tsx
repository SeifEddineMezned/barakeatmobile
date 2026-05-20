import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Trash2 } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchAdminTable, updateAdminTableRow, deleteAdminTableRow, type TableRow } from '@/src/services/admin';

type Tab = 'open' | 'all';

// User-submitted reports (e.g. the "signaler" flow on a restaurant page).
// v1 action set: mark resolved / delete. "Open" tab filters to unresolved rows.
export default function AdminReportsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('open');

  const query = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => fetchAdminTable('reports', { limit: 200 }),
    staleTime: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number | string) => updateAdminTableRow('reports', id, { status: 'resolved' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
    onError: (err: any) => Alert.alert(t('common.error'), err?.message ?? 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => deleteAdminTableRow('reports', id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
    onError: (err: any) => Alert.alert(t('common.error'), err?.message ?? 'Failed'),
  });

  const rows = useMemo(() => {
    const all = query.data?.rows ?? [];
    if (tab === 'all') return all;
    return all.filter((r: TableRow) => {
      const s = String(r.status ?? 'open').toLowerCase();
      return s !== 'resolved' && s !== 'dismissed' && s !== 'closed';
    });
  }, [query.data, tab]);

  const renderRow = ({ item }: { item: TableRow }) => (
    <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.error + '15', justifyContent: 'center', alignItems: 'center' }}>
          <AlertTriangle size={20} color={theme.colors.error} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
            {item.reason ?? `Report #${item.id}`}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
            {item.details ?? item.description ?? ''}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
            {item.location_id ? `Location #${item.location_id}` : ''}
            {item.user_id ? `  ·  User #${item.user_id}` : ''}
            {item.status ? `  ·  ${item.status}` : ''}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <TouchableOpacity
          onPress={() => resolveMutation.mutate(item.id)}
          disabled={resolveMutation.isPending}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: '#16a34a' }}
        >
          <Check size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
            {t('admin.reports.resolve', { defaultValue: 'Résoudre' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => deleteMutation.mutate(item.id)}
          disabled={deleteMutation.isPending}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: theme.colors.error + '12' }}
        >
          <Trash2 size={14} color={theme.colors.error} />
          <Text style={{ color: theme.colors.error, fontSize: 12, fontWeight: '700' }}>
            {t('common.delete', { defaultValue: 'Supprimer' })}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['bottom']}>
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: 12, padding: 4 }}>
          {(['open', 'all'] as Tab[]).map((k) => {
            const active = tab === k;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setTab(k)}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: active ? theme.colors.primary : 'transparent', alignItems: 'center' }}
              >
                <Text style={{ color: active ? '#fff' : theme.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
                  {k === 'open'
                    ? t('admin.reports.tabOpen', { defaultValue: 'Ouverts' })
                    : t('admin.reports.tabAll', { defaultValue: 'Tous' })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {query.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => query.refetch()} tintColor={theme.colors.primary} />}
          ListEmptyComponent={
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
              {t('admin.reports.empty', { defaultValue: 'Aucun signalement' })}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
