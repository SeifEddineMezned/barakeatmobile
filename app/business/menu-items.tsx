import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Alert, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Trash2, Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyMenuItems, addMenuItem, deleteMenuItem, type MenuItemFromAPI } from '@/src/services/business';
import { getErrorMessage } from '@/src/lib/api';

export default function MenuItemsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [newItemName, setNewItemName] = useState('');

  const menuQuery = useQuery({
    queryKey: ['my-menu-items'],
    queryFn: fetchMyMenuItems,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: (name: string) => {
      const formData = new FormData();
      formData.append('name', name);
      return addMenuItem(formData);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-menu-items'] });
      setNewItemName('');
      Alert.alert(t('common.success'), t('business.menuItems.added'));
    },
    onError: (err) => {
      Alert.alert(t('common.error'), getErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => deleteMenuItem(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-menu-items'] });
      Alert.alert(t('common.success'), t('business.menuItems.deleted'));
    },
    onError: (err) => {
      Alert.alert(t('common.error'), getErrorMessage(err));
    },
  });

  const handleAdd = () => {
    const trimmed = newItemName.trim();
    if (!trimmed) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addMutation.mutate(trimmed);
  };

  const handleDelete = (item: MenuItemFromAPI) => {
    Alert.alert(
      t('business.menuItems.deleteConfirm'),
      item.name,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            deleteMutation.mutate(item.id);
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: MenuItemFromAPI }) => (
    <View style={[styles.itemRow, {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.r12,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.sm,
      ...theme.shadows.shadowSm,
    }]}>
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={[styles.itemImage, { borderRadius: theme.radii.r8 }]} />
      ) : null}
      <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1, marginLeft: item.image_url ? theme.spacing.md : 0 }]} numberOfLines={2}>
        {item.name}
      </Text>
      <TouchableOpacity
        onPress={() => handleDelete(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{ marginLeft: theme.spacing.sm }}
      >
        <Trash2 size={18} color={theme.colors.error} />
      </TouchableOpacity>
    </View>
  );

  const renderEmpty = () => (
    <View style={[styles.emptyState, { marginTop: 60 }]}>
      <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
        {t('business.menuItems.empty')}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.md }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' as const }]}>
          {t('business.menuItems.title')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {menuQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : menuQuery.isError ? (
        <View style={styles.loadingContainer}>
          <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center' as const }]}>
            {t('common.errorOccurred')}
          </Text>
          <TouchableOpacity
            onPress={() => void menuQuery.refetch()}
            style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, marginTop: theme.spacing.lg }]}
          >
            <Text style={[{ color: '#fff', ...theme.typography.button }]}>
              {t('common.retry')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={menuQuery.data ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add Item Section */}
      <View style={[styles.addSection, {
        backgroundColor: theme.colors.surface,
        paddingHorizontal: theme.spacing.xl,
        paddingVertical: theme.spacing.md,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        ...theme.shadows.shadowMd,
      }]}>
        <TextInput
          style={[styles.addInput, {
            backgroundColor: theme.colors.bg,
            borderRadius: theme.radii.r12,
            color: theme.colors.textPrimary,
            ...theme.typography.body,
            flex: 1,
            marginRight: theme.spacing.sm,
          }]}
          value={newItemName}
          onChangeText={setNewItemName}
          placeholder={t('business.menuItems.namePlaceholder')}
          placeholderTextColor={theme.colors.muted}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
        <TouchableOpacity
          onPress={handleAdd}
          disabled={!newItemName.trim() || addMutation.isPending}
          style={[styles.addBtn, {
            backgroundColor: !newItemName.trim() ? theme.colors.muted : theme.colors.primary,
            borderRadius: theme.radii.r12,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
          }]}
        >
          {addMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Plus size={16} color="#fff" />
              <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 4 }]}>
                {t('business.menuItems.addItem')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemImage: {
    width: 40,
    height: 40,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addInput: {
    height: 48,
    paddingHorizontal: 16,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
  },
});
