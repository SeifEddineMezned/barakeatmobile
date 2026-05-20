import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, X, Building2 } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchBusinessRegistrations, updateBusinessRegistration, fetchManageOrganizations, type TableRow } from '@/src/services/admin';

type Tab = 'pending' | 'all';

// Pending-approval business registrations + the full list of organizations.
// The pending tab surfaces the approval queue; the "all" tab lets admins look
// up any org they've onboarded.
export default function AdminOrganizationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('pending');

  const pendingQuery = useQuery({
    queryKey: ['admin-business-registrations'],
    queryFn: fetchBusinessRegistrations,
    staleTime: 15_000,
  });

  const orgsQuery = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: fetchManageOrganizations,
    staleTime: 30_000,
    enabled: tab === 'all',
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, status }: { id: number | string; status: 'approved' | 'rejected' }) =>
      updateBusinessRegistration(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-business-registrations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-orgs'] });
    },
    onError: (err: any) => Alert.alert(t('common.error'), err?.message ?? 'Failed'),
  });

  const rows: TableRow[] = tab === 'pending'
    ? (pendingQuery.data ?? []).filter((r) => (r.status ?? 'pending') === 'pending')
    : (orgsQuery.data ?? []);

  const loading = tab === 'pending' ? pendingQuery.isLoading : orgsQuery.isLoading;
  const fetching = tab === 'pending' ? pendingQuery.isFetching : orgsQuery.isFetching;
  const refetch = () => (tab === 'pending' ? pendingQuery.refetch() : orgsQuery.refetch());

  const renderRow = ({ item }: { item: TableRow }) => {
    const isPending = tab === 'pending';
    return (
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
            <Building2 size={20} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' }}>
              {item.business_name ?? item.name ?? `#${item.id}`}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {item.contact_email ?? item.owner_email ?? item.email ?? ''}
              {item.category ? `  ·  ${item.category}` : ''}
              {item.status ? `  ·  ${item.status}` : ''}
            </Text>
          </View>
        </View>
        {isPending && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity
              onPress={() => approveMutation.mutate({ id: item.id, status: 'approved' })}
              disabled={approveMutation.isPending}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: '#16a34a' }}
            >
              <Check size={14} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                {t('admin.orgs.approve', { defaultValue: 'Approuver' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => approveMutation.mutate({ id: item.id, status: 'rejected' })}
              disabled={approveMutation.isPending}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: theme.colors.error + '12' }}
            >
              <X size={14} color={theme.colors.error} />
              <Text style={{ color: theme.colors.error, fontSize: 12, fontWeight: '700' }}>
                {t('admin.orgs.reject', { defaultValue: 'Rejeter' })}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

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
                    ? t('admin.orgs.tabPending', { defaultValue: 'En attente' })
                    : t('admin.orgs.tabAll', { defaultValue: 'Toutes' })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={fetching && !loading} onRefresh={refetch} tintColor={theme.colors.primary} />}
          ListEmptyComponent={
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
              {t('admin.orgs.empty', { defaultValue: 'Aucune organisation' })}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
