import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, Switch, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Plus, Clock, Edit3, Trash2, ShoppingBag, MoreVertical, Minus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';

export default function MyBasketsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { baskets, toggleBasketActive, deleteBasket, updateBasket, profile } = useBusinessStore();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [quantityModalBasket, setQuantityModalBasket] = useState<string | null>(null);
  const [tempQuantity, setTempQuantity] = useState(0);

  const isSupermarket = profile?.isSupermarket ?? false;

  const handleToggle = useCallback((id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const target = baskets.find((b) => b.id === id);
    if (!target) return;

    const willBeActive = !target.isActive;
    if (willBeActive && !isSupermarket) {
      const otherActive = baskets.find((b) => b.id !== id && b.isActive);
      if (otherActive) {
        Alert.alert(
          t('business.baskets.onlyOneActive'),
          `"${otherActive.name}" sera désactivé.`,
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.confirm'),
              onPress: () => toggleBasketActive(id),
            },
          ]
        );
        return;
      }
    }
    toggleBasketActive(id);
  }, [toggleBasketActive, baskets, isSupermarket, t]);

  const handleDelete = useCallback((id: string) => {
    setMenuOpenId(null);
    Alert.alert(
      t('business.baskets.deleteConfirm'),
      t('business.baskets.deleteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('business.baskets.delete'),
          style: 'destructive',
          onPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            deleteBasket(id);
          },
        },
      ]
    );
  }, [deleteBasket, t]);

  const handleEdit = useCallback((id: string) => {
    setMenuOpenId(null);
    router.push(`/business/create-basket?editId=${id}` as never);
  }, [router]);

  const handleCreate = useCallback(() => {
    router.push('/business/create-basket' as never);
  }, [router]);

  const handleSupermarketQuantity = useCallback((id: string) => {
    const basket = baskets.find((b) => b.id === id);
    if (basket) {
      setTempQuantity(basket.quantityLeft);
      setQuantityModalBasket(id);
    }
  }, [baskets]);

  const handleSaveQuantity = useCallback(() => {
    if (quantityModalBasket) {
      updateBasket(quantityModalBasket, { quantityLeft: tempQuantity });
      setQuantityModalBasket(null);
    }
  }, [quantityModalBasket, tempQuantity, updateBasket]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl, paddingBottom: theme.spacing.md }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.baskets.title')}
        </Text>
        <TouchableOpacity
          onPress={handleCreate}
          style={[styles.addButton, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: 16, paddingVertical: 10 }]}
          activeOpacity={0.8}
        >
          <Plus size={18} color="#fff" />
          <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 6 }]}>
            {t('business.baskets.addBasket')}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {baskets.length === 0 ? (
          <View style={[styles.emptyState, { marginTop: 80 }]}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.primary + '15', borderRadius: 40, width: 80, height: 80 }]}>
              <ShoppingBag size={36} color={theme.colors.primary} />
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: theme.spacing.xl, textAlign: 'center' as const }]}>
              {t('business.baskets.noBaskets')}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.sm, textAlign: 'center' as const }]}>
              {t('business.baskets.createFirst')}
            </Text>
          </View>
        ) : (
          baskets.map((basket) => {
            const isSoldOut = basket.quantityLeft === 0;
            return (
              <TouchableOpacity
                key={basket.id}
                activeOpacity={isSupermarket ? 0.7 : 1}
                onPress={isSupermarket ? () => handleSupermarketQuantity(basket.id) : undefined}
                style={[
                  styles.basketCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r16,
                    marginTop: theme.spacing.md,
                    ...theme.shadows.shadowSm,
                    opacity: basket.isActive ? 1 : 0.7,
                  },
                ]}
              >
                <View style={styles.cardRow}>
                  {basket.imageUrl ? (
                    <Image source={{ uri: basket.imageUrl }} style={[styles.basketImage, { borderRadius: theme.radii.r12 }]} />
                  ) : (
                    <View style={[styles.basketImage, { borderRadius: theme.radii.r12, backgroundColor: theme.colors.bg }]} />
                  )}
                  <View style={styles.basketInfo}>
                    <View style={styles.basketNameRow}>
                      <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const, flex: 1 }]} numberOfLines={1}>
                        {basket.name}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setMenuOpenId(menuOpenId === basket.id ? null : basket.id)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        style={styles.moreButton}
                      >
                        <MoreVertical size={18} color={theme.colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    <View style={[styles.priceRow, { marginTop: 6 }]}>
                      <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' as const }]}>
                        {basket.discountedPrice} TND
                      </Text>
                      <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through', marginLeft: 8 }]}>
                        {basket.originalPrice} TND
                      </Text>
                    </View>
                    <View style={[styles.metaRow, { marginTop: 6 }]}>
                      <View style={[styles.metaChip, { backgroundColor: isSoldOut ? theme.colors.error + '15' : theme.colors.primary + '12', borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 }]}>
                        <Text style={[{
                          color: isSoldOut ? theme.colors.error : theme.colors.primary,
                          ...theme.typography.caption,
                          fontWeight: '600' as const,
                        }]}>
                          {isSoldOut ? t('business.baskets.soldOut') : `${basket.quantityLeft} ${t('business.baskets.of')} ${basket.quantityTotal}`}
                        </Text>
                      </View>
                      <View style={[styles.metaChip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 6 }]}>
                        <Clock size={10} color={theme.colors.textSecondary} />
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }]}>
                          {basket.pickupWindow.start}-{basket.pickupWindow.end}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {menuOpenId === basket.id && (
                  <View style={[styles.dropdownMenu, {
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radii.r12,
                    ...theme.shadows.shadowMd,
                    borderWidth: 1,
                    borderColor: theme.colors.divider,
                  }]}>
                    <TouchableOpacity
                      onPress={() => handleEdit(basket.id)}
                      style={[styles.dropdownItem, { padding: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
                    >
                      <Edit3 size={16} color={theme.colors.primary} />
                      <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                        {t('business.baskets.editBasket')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(basket.id)}
                      style={[styles.dropdownItem, { padding: theme.spacing.md }]}
                    >
                      <Trash2 size={16} color={theme.colors.error} />
                      <Text style={[{ color: theme.colors.error, ...theme.typography.bodySm, marginLeft: 10 }]}>
                        {t('business.baskets.delete')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={[styles.cardActions, { borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }]}>
                  <View style={styles.switchRow}>
                    <Text style={[{ color: basket.isActive ? theme.colors.success : theme.colors.muted, ...theme.typography.caption, fontWeight: '600' as const }]}>
                      {basket.isActive ? t('business.baskets.active') : t('business.baskets.inactive')}
                    </Text>
                    <Switch
                      value={basket.isActive}
                      onValueChange={() => handleToggle(basket.id)}
                      trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }}
                      thumbColor={basket.isActive ? theme.colors.primary : theme.colors.muted}
                    />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <Modal visible={quantityModalBasket !== null} transparent animationType="fade" onRequestClose={() => setQuantityModalBasket(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setQuantityModalBasket(null)}>
          <View
            style={[styles.quantityModal, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center' as const, marginBottom: theme.spacing.lg }]}>
              {t('business.baskets.quantityAvailable')}
            </Text>
            <View style={styles.quantitySelector}>
              <TouchableOpacity
                onPress={() => setTempQuantity(Math.max(0, tempQuantity - 1))}
                style={[styles.qtyBtn, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48 }]}
              >
                <Minus size={20} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.display, marginHorizontal: theme.spacing.xxl }]}>
                {tempQuantity}
              </Text>
              <TouchableOpacity
                onPress={() => setTempQuantity(tempQuantity + 1)}
                style={[styles.qtyBtn, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48 }]}
              >
                <Plus size={20} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={handleSaveQuantity}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('business.baskets.saveChanges')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  basketCard: {
    overflow: 'visible',
  },
  cardRow: {
    flexDirection: 'row',
    padding: 14,
  },
  basketImage: {
    width: 80,
    height: 80,
  },
  basketInfo: {
    flex: 1,
    marginLeft: 12,
  },
  basketNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moreButton: {
    padding: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownMenu: {
    position: 'absolute',
    top: 44,
    right: 14,
    zIndex: 100,
    minWidth: 180,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  quantityModal: {
    width: '100%',
    maxWidth: 340,
  },
  quantitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
