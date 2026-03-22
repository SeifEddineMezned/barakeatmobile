import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Alert, ActivityIndicator, Image, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Trash2, Plus, Camera, SquareCheck, Square } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyMenuItems, addMenuItem, deleteMenuItem, type MenuItemFromAPI } from '@/src/services/business';
import { getErrorMessage, apiClient } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';

export default function MenuItemsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [newItemName, setNewItemName] = useState('');
  const [showScanModal, setShowScanModal] = useState(false);
  const [scannedItems, setScannedItems] = useState<{ name: string; price?: number; selected: boolean }[]>([]);
  const [scanLoading, setScanLoading] = useState(false);

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
            deleteMutation.mutate(item.id);
          },
        },
      ]
    );
  };

  const handleScanMenu = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('common.error'), t('business.menuItems.photoPermRequired'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;

    setScanLoading(true);
    try {
      const asset = result.assets[0];
      const uri = asset.uri;
      const filename = uri.split('/').pop() ?? 'menu.jpg';
      const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

      const formData = new FormData();
      formData.append('image', { uri, name: filename, type: mimeType } as any);

      const response = await apiClient.post('/api/restaurants/my/menu-items/scan', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });

      const items: { name: string; price?: number }[] = response.data?.items ?? [];
      if (items.length === 0) {
        Alert.alert(t('business.menuItems.noItemsFound'), t('business.menuItems.noItemsDetected'));
        return;
      }
      setScannedItems(items.map((item) => ({ ...item, selected: true })));
      setShowScanModal(true);
    } catch (err) {
      Alert.alert(t('common.error'), getErrorMessage(err));
    } finally {
      setScanLoading(false);
    }
  };

  const handleAddScannedItems = async () => {
    const selected = scannedItems.filter((i) => i.selected);
    if (selected.length === 0) {
      Alert.alert(t('business.menuItems.noItemsSelected'), t('business.menuItems.selectAtLeastOne'));
      return;
    }
    setShowScanModal(false);
    for (const item of selected) {
      const formData = new FormData();
      formData.append('name', item.name);
      try {
        await addMenuItem(formData);
      } catch (_) {
        // continue adding remaining items even if one fails
      }
    }
    void queryClient.invalidateQueries({ queryKey: ['my-menu-items'] });
    Alert.alert(t('common.success'), t('business.menuItems.addSelectedItems'));
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
        {FeatureFlags.ENABLE_AI_MENU_SCANNER ? (
          <TouchableOpacity
            onPress={handleScanMenu}
            disabled={scanLoading}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderWidth: 1.5,
              borderColor: theme.colors.primary,
              borderRadius: theme.radii.r12,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 5,
            }}
          >
            {scanLoading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <>
                <Camera size={16} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }}>
                  {t('business.menuItems.scan')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
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

      {/* AI Scan Review Modal */}
      {FeatureFlags.ENABLE_AI_MENU_SCANNER && (
        <Modal
          visible={showScanModal}
          animationType="slide"
          transparent
          onRequestClose={() => setShowScanModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContainer, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12 }]}>
              <View style={[styles.modalHeader, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, flex: 1 }]}>
                  {t('business.menuItems.scannedItems')}
                </Text>
                <TouchableOpacity onPress={() => setShowScanModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <X size={22} color={theme.colors.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: theme.spacing.xl }}>
                {scannedItems.map((item, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => {
                      setScannedItems((prev) =>
                        prev.map((it, i) => i === index ? { ...it, selected: !it.selected } : it)
                      );
                    }}
                    style={[{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.radii.r12,
                      padding: theme.spacing.md,
                      marginBottom: theme.spacing.sm,
                      ...theme.shadows.shadowSm,
                    }]}
                  >
                    {item.selected ? (
                      <SquareCheck size={20} color={theme.colors.primary} />
                    ) : (
                      <Square size={20} color={theme.colors.muted} />
                    )}
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1, marginLeft: theme.spacing.md }]}>
                      {item.name}
                    </Text>
                    {item.price != null && (
                      <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                        {item.price} TND
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={[{ padding: theme.spacing.xl, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
                <TouchableOpacity
                  onPress={handleAddScannedItems}
                  style={[{
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.radii.r12,
                    paddingVertical: theme.spacing.md,
                    alignItems: 'center',
                  }]}
                >
                  <Text style={[{ color: '#fff', ...theme.typography.button }]}>
                    {t('business.menuItems.addSelectedItems')} ({scannedItems.filter((i) => i.selected).length})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    maxHeight: '80%',
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
