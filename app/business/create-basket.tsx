import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle, Clock, Minus, Plus, Sparkles } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBasketJSON, updateBasket as updateBasketAPI,
  fetchMyBaskets, fetchMyProfile,
} from '@/src/services/business';
import { getErrorMessage, apiClient } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';

export default function CreateBasketScreen() {
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { baskets: storeBaskets } = useBusinessStore();
  const queryClient = useQueryClient();

  // ── Fetch profile for default pickup times
  const profileQuery = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    staleTime: 60_000,
  });

  // ── Fetch live baskets to populate edit fields
  const basketsQuery = useQuery({
    queryKey: ['my-baskets'],
    queryFn: fetchMyBaskets,
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
        pickup_start_time: toTimeField(pickupStart),
        pickup_end_time: toTimeField(pickupEnd),
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
