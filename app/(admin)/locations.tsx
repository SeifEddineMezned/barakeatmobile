import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, X, MapPin } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchManageLocations, updateManageLocation, type TableRow } from '@/src/services/admin';

type Tab = 'pending' | 'all';

// Location approvals. team.tsx notes "L'ajout de ce nouvel emplacement sera
// soumis à validation" — those pending rows land here.
export default function AdminLocationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('pending');

  const query = useQuery({
    queryKey: ['admin-locations'],
    queryFn: fetchManageLocations,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number | string; status: 'approved' | 'rejected' }) =>
      updateManageLocation(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-locations'] }),
    onError: (err: any) => Alert.alert(t('common.error'), err?.message ?? 'Failed'),
  });

  const rows = useMemo(() => {
    const all = query.data ?? [];
    if (tab === 'all') return all;
    return all.filter((r: TableRow) => {
      const s = String(r.status ?? 'pending').toLowerCase();
      return s === 'pending' || s === 'awaiting' || s === 'awaiting_approval';
    });
  }, [query.data, tab]);

  const renderRow = ({ item }: { item: TableRow }) => (
    <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
          <MapPin size={20} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
            {item.name ?? item.address ?? `#${item.id}`}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {item.address ?? '—'}
            {item.organization_name ? `  ·  ${item.organization_name}` : ''}
            {item.status ? `  ·  ${item.status}` : ''}
          </Text>
        </View>
      </View>
      {tab === 'pending' && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => mutation.mutate({ id: item.id, status: 'approved' })}
            disabled={mutation.isPending}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: '#16a34a' }}
          >
            <Check size={14} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
              {t('admin.locations.approve', { defaultValue: 'Approuver' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => mutation.mutate({ id: item.id, status: 'rejected' })}
            disabled={mutation.isPending}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: theme.colors.error + '12' }}
          >
            <X size={14} color={theme.colors.error} />
            <Text style={{ color: theme.colors.error, fontSize: 12, fontWeight: '700' }}>
              {t('admin.locations.reject', { defaultValue: 'Rejeter' })}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['bottom']}>
      <View style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: 12, padding: 4 }}>
          {(['pending', 'all'] as Tab[]).map((k) => {
            const active = tab === k;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setTab(k)}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: active ? theme.colors.primary : 'transparent', alignItems: 'center' }}
              >
                <Text style={{ color: active ? '#fff' : theme.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
                  {k === 'pending'
                    ? t('admin.locations.tabPending', { defaultValue: 'En attente' })
                    : t('admin.locations.tabAll', { defaultValue: 'Toutes' })}
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
              {t('admin.locations.empty', { defaultValue: 'Aucun emplacement' })}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
