import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, Trash2, ShieldOff, User as UserIcon } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchAdminTable, updateAdminTableRow, deleteAdminTableRow, type TableRow } from '@/src/services/admin';

export default function AdminUsersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [expandedId, setExpandedId] = useState<number | string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['admin-users', debounced],
    queryFn: () => fetchAdminTable('users', { limit: 100, search: debounced || undefined }),
    staleTime: 30_000,
  });

  const suspendMutation = useMutation({
    mutationFn: async ({ id, currentStatus }: { id: number | string; currentStatus: string }) => {
      const nextStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
      return updateAdminTableRow('users', id, { status: nextStatus });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (err: any) => Alert.alert(t('common.error'), err?.message ?? 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => deleteAdminTableRow('users', id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (err: any) => Alert.alert(t('common.error'), err?.message ?? 'Failed'),
  });

  const confirmDelete = (row: TableRow) => {
    Alert.alert(
      t('admin.users.confirmDeleteTitle', { defaultValue: 'Supprimer le compte ?' }),
      t('admin.users.confirmDeleteDesc', { defaultValue: `Action irréversible. L'utilisateur ${row.email ?? ''} sera supprimé.` }),
      [
        { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
        { text: t('common.delete', { defaultValue: 'Supprimer' }), style: 'destructive', onPress: () => deleteMutation.mutate(row.id) },
      ]
    );
  };

  const renderRow = ({ item }: { item: TableRow }) => {
    const expanded = expandedId === item.id;
    const status = item.status ?? 'active';
    return (
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: 14, padding: 14, marginBottom: 8 }}>
        <TouchableOpacity onPress={() => setExpandedId(expanded ? null : item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
            <UserIcon size={20} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' }}>{item.name ?? item.email}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {item.email}  ·  {item.type ?? 'user'}  ·  {status}
            </Text>
          </View>
        </TouchableOpacity>
        {expanded && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity
              onPress={() => suspendMutation.mutate({ id: item.id, currentStatus: status })}
              disabled={suspendMutation.isPending}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.divider }}
            >
              <ShieldOff size={14} color={theme.colors.textPrimary} />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' }}>
                {status === 'suspended'
                  ? t('admin.users.reactivate', { defaultValue: 'Réactiver' })
                  : t('admin.users.suspend', { defaultValue: 'Suspendre' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => confirmDelete(item)}
              disabled={deleteMutation.isPending}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: theme.colors.error + '12' }}
            >
              <Trash2 size={14} color={theme.colors.error} />
              <Text style={{ color: theme.colors.error, fontSize: 12, fontWeight: '600' }}>
                {t('common.delete', { defaultValue: 'Supprimer' })}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 12, paddingHorizontal: 12, height: 44 }}>
          <Search size={16} color={theme.colors.muted} />
          <TextInput
            style={{ flex: 1, marginLeft: 8, color: theme.colors.textPrimary, fontSize: 14 }}
            placeholder={t('admin.users.searchPlaceholder', { defaultValue: 'Rechercher par email ou nom...' })}
            placeholderTextColor={theme.colors.muted}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>
      {query.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={query.data?.rows ?? []}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => query.refetch()} tintColor={theme.colors.primary} />}
          ListEmptyComponent={
            <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 40 }}>
              {t('admin.users.empty', { defaultValue: 'Aucun utilisateur trouvé' })}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
