import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Plus, Clock, Edit3, Trash2, ShoppingBag } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';

export default function MyBasketsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { baskets, toggleBasketActive, deleteBasket } = useBusinessStore();

  const handleToggle = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleBasketActive(id);
  }, [toggleBasketActive]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert(
      t('business.baskets.deleteConfirm'),
      t('business.baskets.deleteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('business.baskets.delete'),
          style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            deleteBasket(id);
          },
        },
      ]
    );
  }, [deleteBasket, t]);

  const handleEdit = useCallback((id: string) => {
    router.push(`/business/create-basket?editId=${id}` as never);
  }, [router]);

  const handleCreate = useCallback(() => {
    router.push('/business/create-basket' as never);
  }, [router]);

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
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: theme.spacing.xl, textAlign: 'center' }]}>
              {t('business.baskets.noBaskets')}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.sm, textAlign: 'center' }]}>
              {t('business.baskets.createFirst')}
            </Text>
          </View>
        ) : (
          baskets.map((basket) => {
            const isSoldOut = basket.quantityLeft === 0;
            return (
              <View
                key={basket.id}
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
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]} numberOfLines={1}>
                      {basket.name}
                    </Text>
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
                      {basket.category}
                    </Text>
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

                <View style={[styles.cardActions, { borderTopWidth: 1, borderTopColor: theme.colors.divider, marginTop: theme.spacing.md, paddingTop: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md }]}>
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
                  <View style={styles.actionButtons}>
                    <TouchableOpacity
                      onPress={() => handleEdit(basket.id)}
                      style={[styles.actionBtn, { backgroundColor: theme.colors.primary + '12', borderRadius: theme.radii.r8, paddingHorizontal: 14, paddingVertical: 8 }]}
                    >
                      <Edit3 size={14} color={theme.colors.primary} />
                      <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
                        {t('business.baskets.editBasket')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDelete(basket.id)}
                      style={[styles.actionBtn, { backgroundColor: theme.colors.error + '12', borderRadius: theme.radii.r8, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 8 }]}
                    >
                      <Trash2 size={14} color={theme.colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
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
    overflow: 'hidden',
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
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
