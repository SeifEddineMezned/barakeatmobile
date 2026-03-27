import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Plus, Clock, Edit3, Trash2, ShoppingBag, MoreVertical, Minus, Camera, X } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyBaskets, deleteBasket as deleteBasketAPI, fetchMyProfile, updateQuantity, updateBasket as updateBasketAPI, updateBasketWithImage, type BusinessBasketFromAPI } from '@/src/services/business';
import * as ImagePicker from 'expo-image-picker';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';

export default function MyBasketsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const store = useBusinessStore();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const queryClient = useQueryClient();

  const basketsQuery = useQuery({
    queryKey: ['my-baskets', selectedLocationId],
    queryFn: () => fetchMyBaskets(selectedLocationId),
    staleTime: 60_000,
    retry: 1,
  });

  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 30_000,
  });

  const currentQty = profileQuery.data?.available_quantity ?? 0;
  const pickupStart = profileQuery.data?.pickup_start_time?.substring(0, 5) ?? '--:--';
  const pickupEnd = profileQuery.data?.pickup_end_time?.substring(0, 5) ?? '--:--';

  const qtyMutation = useMutation({
    mutationFn: (qty: number) => updateQuantity(qty),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
    },
  });

  const basketUpdateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      console.log('[MyBaskets] Saving basket', id, 'with:', JSON.stringify(data));
      const result = await updateBasketAPI(id, data);
      console.log('[MyBaskets] Server returned:', JSON.stringify({ id: result?.id, quantity: result?.quantity, daily_reinitialization_quantity: result?.daily_reinitialization_quantity, status: result?.status }));
      return result;
    },
    onSuccess: (updatedBasket: BusinessBasketFromAPI) => {
      console.log('[MyBaskets] Basket saved OK, quantity:', updatedBasket?.quantity);
      // Immediately patch the React Query cache so the UI updates without waiting for refetch
      queryClient.setQueryData<BusinessBasketFromAPI[]>(['my-baskets'], (old) => {
        if (!old) return old;
        return old.map((b) =>
          String(b.id) === String(updatedBasket.id)
            ? { ...b, ...updatedBasket }
            : b
        );
      });
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
    onError: (err: any) => {
      console.error('[MyBaskets] Save FAILED:', err?.status, err?.message, JSON.stringify(err?.data));
      Alert.alert('Error', err?.data?.error ?? err?.message ?? 'Failed to save');
    },
  });

  // Normalize API baskets to match existing Basket type — no fallback to demo data
  const baskets = (basketsQuery.data ?? []).map((b: BusinessBasketFromAPI) => ({
      id: String(b.id),
      merchantId: String(b.location_id ?? ''),
      merchantName: '',
      name: b.name,
      category: b.category ?? '',
      originalPrice: Number(b.original_price ?? 0),
      discountedPrice: Number(b.selling_price ?? 0),
      discountPercentage: Number(b.original_price ?? 0) > 0
        ? Math.round(((Number(b.original_price ?? 0) - Number(b.selling_price ?? 0)) / Number(b.original_price ?? 0)) * 100)
        : 0,
      pickupWindow: {
        start: b.pickup_start_time?.substring(0, 5) ?? '18:00',
        end: b.pickup_end_time?.substring(0, 5) ?? '19:00',
      },
      quantityLeft: Number(b.quantity) || 0,
      quantityTotal: Number(b.daily_reinitialization_quantity) || 0,
      distance: 0,
      address: '',
      latitude: 0,
      longitude: 0,
      exampleItems: [],
      imageUrl: b.image_url ?? undefined,
      isActive: b.status !== 'deleted' && Number(b.quantity) > 0,
      description: b.description ?? undefined,
      maxPerCustomer: (b as any).max_per_customer ?? 5,
    }));

  const { toggleBasketActive, updateBasket, profile } = store;

  const deleteBasketMutation = useMutation({
    mutationFn: (id: string) => deleteBasketAPI(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
    },
    onError: (err) => {
      Alert.alert('Error', getErrorMessage(err));
    },
  });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [quantityModalBasket, setQuantityModalBasket] = useState<string | null>(null);
  const [tempQuantity, setTempQuantity] = useState(0);
  const [detailBasket, setDetailBasket] = useState<typeof baskets[0] | null>(null);
  const [detailTodayQty, setDetailTodayQty] = useState(0);
  const [detailDailyQty, setDetailDailyQty] = useState(0);
  const [sameAllDays, setSameAllDays] = useState(true);
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const DAY_LABELS: Record<string, string> = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
  const [daySchedule, setDaySchedule] = useState<Record<string, number>>({ mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 });
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [showPickupEditor, setShowPickupEditor] = useState(false);
  const [pickupStartTime, setPickupStartTime] = useState('');
  const [pickupEndTime, setPickupEndTime] = useState('');
  const [useBusinessHours, setUseBusinessHours] = useState(false);
  const [detailMaxPerCustomer, setDetailMaxPerCustomer] = useState(1);

  const isSupermarket = profile?.isSupermarket ?? false;

  const handleToggle = useCallback((id: string) => {
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
            deleteBasketMutation.mutate(id);
            store.deleteBasket(id);
          },
        },
      ]
    );
  }, [deleteBasketMutation, store, t]);

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

  // ─── Change Photo ────────────────────────────────────────────────────────────
  const handleChangePhoto = useCallback(async (basketId: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to change the basket photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const formData = new FormData();
    formData.append('image', {
      uri: asset.uri,
      name: asset.fileName ?? 'basket.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    } as any);
    try {
      await updateBasketWithImage(basketId, formData);
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      setDetailBasket(prev => prev ? { ...prev, imageUrl: asset.uri } : prev);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to upload photo');
    }
  }, [queryClient]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs, paddingBottom: theme.spacing.md }]}>
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

      <ScrollView style={styles.content} contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
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
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    setMenuOpenId(null);
                    setDetailBasket(basket);
                    setDetailTodayQty(basket.quantityLeft);
                    setDetailDailyQty(basket.quantityTotal);
                    setShowFullDesc(false);
                    setPickupStartTime(basket.pickupWindow.start);
                    setPickupEndTime(basket.pickupWindow.end);
                    setShowPickupEditor(false);
                    setUseBusinessHours(false);
                    setDetailMaxPerCustomer((basket as any).maxPerCustomer ?? 5);
                    // Init schedule from basket data or default to same for all days
                    const rawBasket = basketsQuery.data?.find((b: any) => String(b.id) === basket.id);
                    const schedule = (rawBasket as any)?.daily_reinit_schedule;
                    if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
                      setSameAllDays(false);
                      setDaySchedule({ mon: schedule.mon ?? 0, tue: schedule.tue ?? 0, wed: schedule.wed ?? 0, thu: schedule.thu ?? 0, fri: schedule.fri ?? 0, sat: schedule.sat ?? 0, sun: schedule.sun ?? 0 });
                    } else {
                      setSameAllDays(true);
                      const qty = basket.quantityTotal;
                      setDaySchedule({ mon: qty, tue: qty, wed: qty, thu: qty, fri: qty, sat: qty, sun: qty });
                    }
                  }}
                >
                  <View style={styles.cardRow}>
                    {basket.imageUrl ? (
                      <Image source={{ uri: basket.imageUrl }} style={[styles.basketImage, { borderRadius: theme.radii.r12 }]} />
                    ) : (
                      <View style={[styles.basketImage, { borderRadius: theme.radii.r12, backgroundColor: theme.colors.primary + '10', justifyContent: 'center', alignItems: 'center' }]}>
                        <ShoppingBag size={28} color={theme.colors.primary} />
                      </View>
                    )}
                    <View style={styles.basketInfo}>
                      <View style={styles.basketNameRow}>
                        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const, flex: 1 }]} numberOfLines={1}>
                          {basket.name}
                        </Text>
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === basket.id ? null : basket.id); }}
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
                          <ShoppingBag size={10} color={isSoldOut ? theme.colors.error : theme.colors.primary} />
                          <Text style={[{
                            color: isSoldOut ? theme.colors.error : theme.colors.primary,
                            ...theme.typography.caption,
                            fontWeight: '600' as const,
                            marginLeft: 4,
                          }]}>
                            {isSoldOut ? t('business.baskets.soldOut') : basket.quantityLeft}
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
                </TouchableOpacity>

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


              </View>
            );
          })
        )}
      </ScrollView>

      {/* Detail Modal */}
      <Modal visible={detailBasket !== null} transparent animationType="fade" onRequestClose={() => setDetailBasket(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <View style={{
            backgroundColor: theme.colors.bg,
            borderRadius: 24,
            maxHeight: '90%',
            width: '100%',
            maxWidth: 420,
            ...theme.shadows.shadowLg,
          }}>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Pause pill + close button header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
                <TouchableOpacity
                  onPress={() => handleToggle(detailBasket!.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: detailBasket?.isActive ? theme.colors.success + '15' : theme.colors.error + '15',
                    borderRadius: theme.radii.pill,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    gap: 6,
                  }}
                >
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: detailBasket?.isActive ? theme.colors.success : theme.colors.error,
                  }} />
                  <Text style={{
                    color: detailBasket?.isActive ? theme.colors.success : theme.colors.error,
                    ...theme.typography.caption,
                    fontWeight: '600',
                  }}>
                    {detailBasket?.isActive ? t('business.baskets.active') : t('business.baskets.inactive')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDetailBasket(null)}>
                  <X size={22} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Photo section */}
              <View style={{ height: 200, backgroundColor: theme.colors.divider, position: 'relative' }}>
                {detailBasket?.imageUrl ? (
                  <Image source={{ uri: detailBasket.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.primary + '08' }}>
                    <ShoppingBag size={48} color={theme.colors.muted} />
                    <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, marginTop: 8 }}>
                      {t('business.baskets.addPhoto', { defaultValue: 'Add Photo' })}
                    </Text>
                  </View>
                )}
                {/* Camera button */}
                <TouchableOpacity
                  onPress={() => detailBasket && void handleChangePhoto(detailBasket.id)}
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    right: 12,
                    backgroundColor: theme.colors.primary,
                    borderRadius: 20,
                    width: 40,
                    height: 40,
                    justifyContent: 'center',
                    alignItems: 'center',
                    ...theme.shadows.shadowMd,
                  }}
                >
                  <Camera size={18} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* Info card overlapping photo */}
              <View style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                marginTop: -20,
                marginHorizontal: 16,
                padding: 20,
                ...theme.shadows.shadowSm,
              }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }}>
                  {detailBasket?.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 8 }}>
                  <Text style={{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' }}>
                    {detailBasket?.discountedPrice} TND
                  </Text>
                  <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textDecorationLine: 'line-through', marginLeft: 10 }}>
                    {detailBasket?.originalPrice} TND
                  </Text>
                </View>
                {detailBasket?.description ? (
                  <TouchableOpacity onPress={() => setShowFullDesc(!showFullDesc)} style={{ marginTop: 8 }}>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20 }} numberOfLines={showFullDesc ? undefined : 2}>
                      {detailBasket.description}
                    </Text>
                    {!showFullDesc && (
                      <Text style={{ color: theme.colors.primary, ...theme.typography.caption, marginTop: 2 }}>
                        {t('common.seeMore', { defaultValue: '...see more' })}
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Availability Controls */}
              <View style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                marginHorizontal: 16,
                marginTop: 16,
                padding: 20,
                ...theme.shadows.shadowSm,
              }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 16 }}>
                  {t('business.availability.title', { defaultValue: 'Availability' })}
                </Text>

                {/* Today's Quantity */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body }}>
                    {t('business.baskets.todayQty')}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity
                      onPress={() => setDetailTodayQty(Math.max(0, detailTodayQty - 1))}
                      style={{ backgroundColor: theme.colors.bg, borderRadius: 8, width: 36, height: 36, justifyContent: 'center', alignItems: 'center' }}
                    >
                      <Minus size={16} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginHorizontal: 16, minWidth: 24, textAlign: 'center' }}>
                      {detailTodayQty}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setDetailTodayQty(detailTodayQty + 1)}
                      style={{ backgroundColor: theme.colors.bg, borderRadius: 8, width: 36, height: 36, justifyContent: 'center', alignItems: 'center' }}
                    >
                      <Plus size={16} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Pickup Time */}
                <TouchableOpacity
                  onPress={() => setShowPickupEditor(!showPickupEditor)}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: theme.colors.bg,
                    borderRadius: theme.radii.r12,
                    padding: 14,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Clock size={18} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body }}>
                      {t('basket.pickupWindow', { defaultValue: 'Pickup Time' })}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' }}>
                    {pickupStartTime} - {pickupEndTime}
                  </Text>
                </TouchableOpacity>

                {/* Inline Pickup Time Editor */}
                {showPickupEditor && (
                  <View style={{
                    backgroundColor: theme.colors.bg,
                    borderRadius: theme.radii.r12,
                    padding: 16,
                    marginTop: 8,
                  }}>
                    {/* Start Time */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                        {t('business.availability.startTime', { defaultValue: 'Start Time' })}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <TouchableOpacity
                          onPress={() => {
                            const [h, m] = pickupStartTime.split(':').map(Number);
                            const newH = h > 0 ? h - 1 : 23;
                            setPickupStartTime(`${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                          }}
                          style={{ backgroundColor: theme.colors.surface, borderRadius: 8, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
                        >
                          <Minus size={14} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontFamily: 'Poppins_600SemiBold' }}>
                            {pickupStartTime}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            const [h, m] = pickupStartTime.split(':').map(Number);
                            const newH = h < 23 ? h + 1 : 0;
                            setPickupStartTime(`${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                          }}
                          style={{ backgroundColor: theme.colors.surface, borderRadius: 8, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
                        >
                          <Plus size={14} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* End Time */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                        {t('business.availability.endTime', { defaultValue: 'End Time' })}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <TouchableOpacity
                          onPress={() => {
                            const [h, m] = pickupEndTime.split(':').map(Number);
                            const newH = h > 0 ? h - 1 : 23;
                            setPickupEndTime(`${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                          }}
                          style={{ backgroundColor: theme.colors.surface, borderRadius: 8, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
                        >
                          <Minus size={14} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontFamily: 'Poppins_600SemiBold' }}>
                            {pickupEndTime}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            const [h, m] = pickupEndTime.split(':').map(Number);
                            const newH = h < 23 ? h + 1 : 0;
                            setPickupEndTime(`${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
                          }}
                          style={{ backgroundColor: theme.colors.surface, borderRadius: 8, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' }}
                        >
                          <Plus size={14} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Use business hours checkbox */}
                    <TouchableOpacity
                      onPress={() => {
                        const newVal = !useBusinessHours;
                        setUseBusinessHours(newVal);
                        if (newVal) {
                          setPickupStartTime(pickupStart);
                          setPickupEndTime(pickupEnd);
                        }
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}
                    >
                      <View style={{
                        width: 22, height: 22, borderRadius: 6,
                        borderWidth: 2,
                        borderColor: useBusinessHours ? theme.colors.primary : theme.colors.muted,
                        backgroundColor: useBusinessHours ? theme.colors.primary : 'transparent',
                        justifyContent: 'center', alignItems: 'center',
                      }}>
                        {useBusinessHours && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>✓</Text>}
                      </View>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                        {t('business.availability.useBusinessHours', { defaultValue: 'Use business hours for pickup' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Save Changes */}
              <TouchableOpacity
                onPress={() => {
                  if (detailBasket) {
                    // Update the basket's available_quantity (backend also syncs to location)
                    basketUpdateMutation.mutate(
                      {
                        id: detailBasket.id,
                        data: {
                          name: detailBasket.name,
                          original_price: detailBasket.originalPrice,
                          selling_price: detailBasket.discountedPrice,
                          quantity: detailTodayQty,
                          pickup_start_time: `${pickupStartTime}:00`,
                          pickup_end_time: `${pickupEndTime}:00`,
                        },
                      },
                      {
                        onSuccess: () => {
                          setDetailBasket(null);
                        },
                      }
                    );
                  }
                }}
                style={{
                  backgroundColor: theme.colors.primary,
                  borderRadius: theme.radii.r16,
                  padding: 16,
                  marginHorizontal: 16,
                  marginTop: 20,
                  marginBottom: 40,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', ...theme.typography.button }}>
                  {t('business.baskets.saveChanges')}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

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
