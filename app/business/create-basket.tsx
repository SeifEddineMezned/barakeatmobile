import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle, Clock, Minus, Plus, Sparkles, SquareCheck, Square } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBasketJSON, updateBasket as updateBasketAPI,
  fetchMyBaskets, fetchMyProfile, fetchMyMenuItems,
  type MenuItemFromAPI,
} from '@/src/services/business';
import { getErrorMessage, apiClient } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';

export default function CreateBasketScreen() {
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { baskets: storeBaskets } = useBusinessStore();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const queryClient = useQueryClient();

  // ── Fetch profile for default pickup times
  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 60_000,
  });

  // ── Fetch live baskets to populate edit fields
  const basketsQuery = useQuery({
    queryKey: ['my-baskets', selectedLocationId],
    queryFn: () => fetchMyBaskets(selectedLocationId),
    staleTime: 60_000,
  });

  // Find the basket to edit — prefer live API data, fall back to store
  const apiBasket = editId
    ? basketsQuery.data?.find((b) => String(b.id) === editId)
    : null;
  const storeBasket = editId
    ? storeBaskets.find((b) => b.id === editId)
    : null;

  const isEditing = !!editId;

  // ── Field state — populate from API basket if editing
  const [name, setName] = useState(
    apiBasket?.name ?? storeBasket?.name ?? ''
  );
  const [description, setDescription] = useState(
    apiBasket?.description ?? storeBasket?.description ?? ''
  );
  const [originalPrice, setOriginalPrice] = useState(
    apiBasket?.original_price != null
      ? String(apiBasket.original_price)
      : storeBasket?.originalPrice?.toString() ?? ''
  );
  const [sellingPrice, setSellingPrice] = useState(
    apiBasket?.selling_price != null
      ? String(apiBasket.selling_price)
      : storeBasket?.discountedPrice?.toString() ?? ''
  );
  const [quantity, setQuantity] = useState(
    apiBasket?.quantity ?? storeBasket?.quantityTotal ?? 5
  );
  const [maxPerCustomer, setMaxPerCustomer] = useState<number>(
    (apiBasket as any)?.max_per_customer ?? (storeBasket as any)?.maxPerCustomer ?? 5
  );

  // ── Daily reinit schedule (edit mode only)
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const DAY_LABELS: Record<string, string> = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
  const [sameAllDays, setSameAllDays] = useState(true);
  const [daySchedule, setDaySchedule] = useState<Record<string, number>>({ mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 });

  // ── Menu items for selection
  const menuItemsQuery = useQuery({
    queryKey: ['my-menu-items'],
    queryFn: fetchMyMenuItems,
    staleTime: 30_000,
  });

  // Parse existing menu_item_ids from the basket being edited
  const existingMenuItemIds: number[] = (() => {
    const raw = (apiBasket as any)?.menu_item_ids;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(Number);
    if (typeof raw === 'string') {
      try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map(Number) : []; } catch { return []; }
    }
    return [];
  })();

  const [selectedMenuItemIds, setSelectedMenuItemIds] = useState<number[]>(existingMenuItemIds);

  // Sync selected menu items when editing basket loads
  React.useEffect(() => {
    if (isEditing && apiBasket) {
      const raw = (apiBasket as any)?.menu_item_ids;
      if (raw) {
        const ids = Array.isArray(raw) ? raw.map(Number) : (() => { try { return JSON.parse(raw).map(Number); } catch { return []; } })();
        setSelectedMenuItemIds(ids);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBasket?.id]);

  const toggleMenuItem = (itemId: number) => {
    setSelectedMenuItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  // Pickup times: use basket-specific times if editing, else profile-level defaults
  const defaultStart =
    apiBasket?.pickup_start_time?.substring(0, 5) ??
    profileQuery.data?.pickup_start_time?.substring(0, 5) ??
    '18:00';
  const defaultEnd =
    apiBasket?.pickup_end_time?.substring(0, 5) ??
    profileQuery.data?.pickup_end_time?.substring(0, 5) ??
    '19:00';

  const [pickupStart, setPickupStart] = useState(defaultStart);
  const [pickupEnd, setPickupEnd] = useState(defaultEnd);

  const [priceError, setPriceError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const handleAISuggest = async () => {
    setAiLoading(true);
    try {
      const response = await apiClient.post('/api/baskets/ai-suggest', {
        category: profileQuery.data?.category,
        name,
      });
      const data = response.data as { name?: string; description?: string; price?: number };
      if (data.name) setName(data.name);
      if (data.description) setDescription(data.description);
      if (data.price != null) setSellingPrice(String(data.price));
      Alert.alert('AI Suggestion', 'AI suggested content filled in! Adjust as needed.');
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setAiLoading(false);
    }
  };

  // Update pickup times when profile/baskets load (only if not yet modified by user)
  React.useEffect(() => {
    if (!isEditing && profileQuery.data) {
      const s = profileQuery.data.pickup_start_time?.substring(0, 5);
      const e = profileQuery.data.pickup_end_time?.substring(0, 5);
      if (s) setPickupStart(s);
      if (e) setPickupEnd(e);
    }
  }, [profileQuery.data, isEditing]);

  React.useEffect(() => {
    if (isEditing && apiBasket) {
      setName(apiBasket.name);
      if (apiBasket.description) setDescription(apiBasket.description);
      if (apiBasket.original_price != null) setOriginalPrice(String(apiBasket.original_price));
      if (apiBasket.selling_price != null) setSellingPrice(String(apiBasket.selling_price));
      if (apiBasket.quantity != null) setQuantity(apiBasket.quantity);
      if (apiBasket.pickup_start_time) setPickupStart(apiBasket.pickup_start_time.substring(0, 5));
      if (apiBasket.pickup_end_time) setPickupEnd(apiBasket.pickup_end_time.substring(0, 5));
      const mpc = (apiBasket as any).max_per_customer;
      if (mpc != null) setMaxPerCustomer(mpc);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBasket?.id]);

  // Populate daily reinit schedule from API basket when editing
  React.useEffect(() => {
    if (isEditing && apiBasket) {
      const schedule = (apiBasket as any)?.daily_reinit_schedule;
      if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
        setSameAllDays(false);
        setDaySchedule({ mon: schedule.mon ?? 0, tue: schedule.tue ?? 0, wed: schedule.wed ?? 0, thu: schedule.thu ?? 0, fri: schedule.fri ?? 0, sat: schedule.sat ?? 0, sun: schedule.sun ?? 0 });
      } else {
        setSameAllDays(true);
        const qty = apiBasket.quantity ?? 5;
        setDaySchedule({ mon: qty, tue: qty, wed: qty, thu: qty, fri: qty, sat: qty, sun: qty });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBasket?.id]);

  const validatePrice = (orig: string, disc: string) => {
    const o = parseFloat(orig);
    const d = parseFloat(disc);
    if (o > 0 && d > 0 && d > o * 0.5) {
      setPriceError(t('business.createBasket.priceError'));
      return false;
    }
    setPriceError('');
    return true;
  };

  // ── Ensure time is formatted as HH:MM:SS for the backend
  const toTimeField = (hhmm: string) =>
    hhmm.includes(':') && hhmm.split(':').length === 2 ? `${hhmm}:00` : hhmm;

  // ── Mutations
  const createMutation = useMutation({
    mutationFn: () =>
      createBasketJSON({
        name: name.trim(),
        description: description.trim() || undefined,
        original_price: originalPrice ? parseFloat(originalPrice) : undefined,
        selling_price: parseFloat(sellingPrice),
        quantity,
        pickup_start_time: toTimeField(pickupStart),
        pickup_end_time: toTimeField(pickupEnd),
        menu_item_ids: selectedMenuItemIds.length > 0 ? selectedMenuItemIds : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      router.back();
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), getErrorMessage(err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateBasketAPI(editId!, {
        name: name.trim(),
        description: description.trim() || null,
        original_price: originalPrice ? parseFloat(originalPrice) : undefined,
        selling_price: parseFloat(sellingPrice),
        quantity,
        max_per_customer: maxPerCustomer,
        daily_reinitialization_quantity: quantity,
        ...(sameAllDays ? {} : { daily_reinit_schedule: JSON.stringify(daySchedule) }),
        pickup_start_time: toTimeField(pickupStart),
        pickup_end_time: toTimeField(pickupEnd),
        menu_item_ids: selectedMenuItemIds,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      router.back();
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), getErrorMessage(err));
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert(t('common.error'), t('business.createBasket.nameRequired'));
      return;
    }
    const sp = parseFloat(sellingPrice);
    if (!sp || sp <= 0) {
      Alert.alert(t('common.error'), t('business.createBasket.sellingPriceRequired'));
      return;
    }
    if (!validatePrice(originalPrice, sellingPrice)) return;
    if (quantity <= 0) {
      Alert.alert(t('common.error'), t('business.createBasket.quantityRequired'));
      return;
    }
    if (isEditing) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  // ── Time picker helpers
  const adjustHour = (time: string, delta: number) => {
    const [h, m] = time.split(':').map(Number);
    const newH = ((h + delta + 24) % 24);
    return `${String(newH).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg }]}>
          <TouchableOpacity onPress={() => router.back()}>
            <X size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
            {isEditing ? t('business.createBasket.editTitle') : t('business.createBasket.title')}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.form}
          contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Name */}
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                {t('business.createBasket.name')}
              </Text>
              {FeatureFlags.ENABLE_AI_BASKET_SUGGESTIONS && (
                <TouchableOpacity
                  onPress={handleAISuggest}
                  disabled={aiLoading}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: theme.colors.primary + '18',
                    borderWidth: 1,
                    borderColor: theme.colors.primary,
                    borderRadius: theme.radii.r12,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: 6,
                  }}
                >
                  {aiLoading ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Sparkles size={14} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }}>
                        {t('business.createBasket.suggest')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={name}
              onChangeText={setName}
              placeholder={t('business.createBasket.namePlaceholder')}
              placeholderTextColor={theme.colors.muted}
            />
          </View>

          {/* Description */}
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('business.createBasket.description')}
            </Text>
            <TextInput
              style={[styles.textArea, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('business.createBasket.descriptionPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Prices */}
          <View style={[styles.row, { marginBottom: theme.spacing.xl }]}>
            <View style={[styles.halfField, { marginRight: theme.spacing.md }]}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
                {t('business.createBasket.originalPrice')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                value={originalPrice}
                onChangeText={(v) => {
                  setOriginalPrice(v);
                  if (v && sellingPrice) validatePrice(v, sellingPrice);
                  else setPriceError('');
                }}
                placeholder="20"
                placeholderTextColor={theme.colors.muted}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
                {t('business.createBasket.discountedPrice')} *
              </Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: theme.colors.surface,
                  borderColor: priceError ? theme.colors.error : theme.colors.divider,
                  borderRadius: theme.radii.r12,
                  color: theme.colors.textPrimary,
                  ...theme.typography.body,
                  ...theme.shadows.shadowSm,
                }]}
                value={sellingPrice}
                onChangeText={(v) => {
                  setSellingPrice(v);
                  if (originalPrice && v) validatePrice(originalPrice, v);
                  else setPriceError('');
                }}
                placeholder="10"
                placeholderTextColor={theme.colors.muted}
                keyboardType="numeric"
              />
            </View>
          </View>

          {priceError !== '' && (
            <View style={[styles.errorRow, { marginBottom: theme.spacing.lg, marginTop: -theme.spacing.md }]}>
              <AlertCircle size={14} color={theme.colors.error} />
              <Text style={[{ color: theme.colors.error, ...theme.typography.caption, marginLeft: 6, flex: 1 }]}>
                {priceError}
              </Text>
            </View>
          )}

          {/* Daily Reinitialization Quantity — always shown (label differs by mode) */}
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {isEditing
                ? t('business.baskets.defaultQty', { defaultValue: 'Daily reinitialization quantity' })
                : t('business.availability.quantity')}{!isEditing ? ' *' : ''}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => setQuantity(Math.max(1, quantity - 1))}
                style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Minus size={16} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <TextInput
                style={[{
                  flex: 1, textAlign: 'center', backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r12, color: theme.colors.textPrimary,
                  ...theme.typography.h3, height: 42, marginHorizontal: 12,
                  borderWidth: 1, borderColor: theme.colors.divider,
                }]}
                value={String(quantity)}
                onChangeText={(v) => { const n = parseInt(v); if (!isNaN(n) && n >= 1) setQuantity(n); }}
                keyboardType="number-pad"
              />
              <TouchableOpacity
                onPress={() => setQuantity(quantity + 1)}
                style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Plus size={16} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Max Per Customer — only shown when editing */}
          {isEditing && FeatureFlags.ENABLE_MAX_PER_CUSTOMER && (
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('business.baskets.maxPerCustomer', { defaultValue: 'Max bags per customer' })}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => setMaxPerCustomer(Math.max(1, maxPerCustomer - 1))}
                style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Minus size={16} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <TextInput
                style={[{
                  flex: 1, textAlign: 'center', backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r12, color: theme.colors.textPrimary,
                  ...theme.typography.h3, height: 42, marginHorizontal: 12,
                  borderWidth: 1, borderColor: theme.colors.divider,
                }]}
                value={String(maxPerCustomer)}
                onChangeText={(v) => { const n = parseInt(v); if (!isNaN(n) && n >= 1) setMaxPerCustomer(n); }}
                keyboardType="number-pad"
              />
              <TouchableOpacity
                onPress={() => setMaxPerCustomer(maxPerCustomer + 1)}
                style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Plus size={16} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
          )}

          {/* Daily Reinit Schedule — only shown when editing */}
          {isEditing && (
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.sm }}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                {t('business.baskets.defaultQty', { defaultValue: 'Daily reinitialization quantity' })}
              </Text>
              {sameAllDays && (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => setQuantity(Math.max(0, quantity - 1))}
                    style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
                  >
                    <Minus size={16} color={theme.colors.textPrimary} />
                  </TouchableOpacity>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginHorizontal: 16, minWidth: 24, textAlign: 'center' }}>
                    {quantity}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setQuantity(quantity + 1)}
                    style={{ backgroundColor: theme.colors.surface, borderRadius: 10, width: 42, height: 42, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
                  >
                    <Plus size={16} color={theme.colors.textPrimary} />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Same for all days checkbox */}
            <TouchableOpacity
              onPress={() => {
                const next = !sameAllDays;
                setSameAllDays(next);
                if (next) {
                  const reset: Record<string, number> = {};
                  DAYS.forEach(d => { reset[d] = quantity; });
                  setDaySchedule(reset);
                }
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}
            >
              <View style={{
                width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                borderColor: sameAllDays ? theme.colors.primary : theme.colors.muted,
                backgroundColor: sameAllDays ? theme.colors.primary : 'transparent',
                justifyContent: 'center', alignItems: 'center',
              }}>
                {sameAllDays && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✓</Text>}
              </View>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                {t('business.baskets.sameAllDays', { defaultValue: 'Same for all days' })}
              </Text>
            </TouchableOpacity>

            {/* Per-day schedule */}
            {!sameAllDays && (
              <View style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: 12, gap: 8 }}>
                {DAYS.map((day) => (
                  <View key={day} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{
                      width: 36, height: 36, borderRadius: 18,
                      backgroundColor: daySchedule[day] > 0 ? theme.colors.primary + '18' : theme.colors.divider,
                      justifyContent: 'center', alignItems: 'center',
                    }}>
                      <Text style={{
                        color: daySchedule[day] > 0 ? theme.colors.primary : theme.colors.muted,
                        ...theme.typography.bodySm, fontWeight: '700',
                      }}>
                        {DAY_LABELS[day]}
                      </Text>
                    </View>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, flex: 1, marginLeft: 10 }}>
                      {t(`business.baskets.days.${day}`, { defaultValue: day.charAt(0).toUpperCase() + day.slice(1) })}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TouchableOpacity
                        onPress={() => setDaySchedule(prev => ({ ...prev, [day]: Math.max(0, prev[day] - 1) }))}
                        style={{ backgroundColor: theme.colors.surface, borderRadius: 6, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' }}
                      >
                        <Minus size={12} color={theme.colors.textPrimary} />
                      </TouchableOpacity>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginHorizontal: 10, minWidth: 18, textAlign: 'center' }}>
                        {daySchedule[day]}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setDaySchedule(prev => ({ ...prev, [day]: prev[day] + 1 }))}
                        style={{ backgroundColor: theme.colors.surface, borderRadius: 6, width: 28, height: 28, justifyContent: 'center', alignItems: 'center' }}
                      >
                        <Plus size={12} color={theme.colors.textPrimary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
          )}

          {/* Pickup Window — only shown when creating, not editing */}
          {!isEditing && (
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.sm }}>
              <Clock size={14} color={theme.colors.primary} />
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 6 }]}>
                {t('basket.pickupWindow')} *
              </Text>
            </View>
            <View style={styles.row}>
              {/* Start */}
              <View style={[styles.halfField, { marginRight: theme.spacing.md }]}>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 4 }}>
                  {t('business.availability.pickupStart')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, borderWidth: 1, borderColor: theme.colors.divider, paddingVertical: 8 }}>
                  <TouchableOpacity onPress={() => setPickupStart(adjustHour(pickupStart, -1))} style={{ paddingHorizontal: 10 }}>
                    <Minus size={14} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, minWidth: 48, textAlign: 'center' }}>
                    {pickupStart}
                  </Text>
                  <TouchableOpacity onPress={() => setPickupStart(adjustHour(pickupStart, 1))} style={{ paddingHorizontal: 10 }}>
                    <Plus size={14} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>
              {/* End */}
              <View style={styles.halfField}>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 4 }}>
                  {t('business.availability.pickupEnd')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, borderWidth: 1, borderColor: theme.colors.divider, paddingVertical: 8 }}>
                  <TouchableOpacity onPress={() => setPickupEnd(adjustHour(pickupEnd, -1))} style={{ paddingHorizontal: 10 }}>
                    <Minus size={14} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, minWidth: 48, textAlign: 'center' }}>
                    {pickupEnd}
                  </Text>
                  <TouchableOpacity onPress={() => setPickupEnd(adjustHour(pickupEnd, 1))} style={{ paddingHorizontal: 10 }}>
                    <Plus size={14} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
          )}

          {/* Menu Items Selection */}
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('business.createBasket.menuItems', { defaultValue: 'Menu Items' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: theme.spacing.md }}>
              {t('business.createBasket.menuItemsDesc', { defaultValue: 'Select which menu items are in this basket (optional)' })}
            </Text>
            {menuItemsQuery.isLoading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (menuItemsQuery.data ?? []).length === 0 ? (
              <View style={{ alignItems: 'center' as const, paddingVertical: theme.spacing.lg }}>
                <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm, textAlign: 'center' as const, marginBottom: theme.spacing.md }}>
                  {t('business.createBasket.noMenuItems', { defaultValue: 'No menu items yet \u2014 add some in Menu Items' })}
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/business/menu-items' as never)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: theme.colors.primary + '12',
                    borderRadius: theme.radii.r12,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderWidth: 1,
                    borderColor: theme.colors.primary + '30',
                  }}
                >
                  <Plus size={16} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 6 }}>
                    {t('business.createBasket.goToMenuItems', { defaultValue: 'Go to Menu Items' })}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                {(menuItemsQuery.data ?? []).map((item: MenuItemFromAPI) => {
                  const isSelected = selectedMenuItemIds.includes(item.id);
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => toggleMenuItem(item.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: isSelected ? theme.colors.primary + '10' : theme.colors.surface,
                        borderRadius: theme.radii.r12,
                        padding: theme.spacing.md,
                        marginBottom: theme.spacing.sm,
                        borderWidth: isSelected ? 1.5 : 1,
                        borderColor: isSelected ? theme.colors.primary : theme.colors.divider,
                        ...theme.shadows.shadowSm,
                      }}
                    >
                      {isSelected ? (
                        <SquareCheck size={20} color={theme.colors.primary} />
                      ) : (
                        <Square size={20} color={theme.colors.muted} />
                      )}
                      <Text
                        style={{
                          color: theme.colors.textPrimary,
                          ...theme.typography.body,
                          flex: 1,
                          marginLeft: theme.spacing.md,
                        }}
                        numberOfLines={2}
                      >
                        {item.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {selectedMenuItemIds.length > 0 && (
                  <Text style={{ color: theme.colors.primary, ...theme.typography.caption, marginTop: theme.spacing.xs }}>
                    {t('business.createBasket.menuItemsSelected', {
                      count: selectedMenuItemIds.length,
                      defaultValue: `${selectedMenuItemIds.length} item(s) selected`,
                    })}
                  </Text>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider, ...theme.shadows.shadowLg }]}>
          <PrimaryCTAButton
            onPress={handleSave}
            title={isEditing ? t('business.createBasket.save') : t('business.createBasket.create')}
            loading={isPending}
            disabled={!!priceError || isPending}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  form: { flex: 1 },
  field: {},
  label: {},
  input: { height: 52, borderWidth: 1, paddingHorizontal: 16 },
  textArea: { minHeight: 100, borderWidth: 1, paddingHorizontal: 16, paddingTop: 14 },
  row: { flexDirection: 'row' },
  halfField: { flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center' },
  footer: {},
});
