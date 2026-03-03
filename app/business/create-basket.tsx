import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { CATEGORIES } from '@/src/mocks/baskets';
import type { Basket } from '@/src/types';

const CATEGORY_OPTIONS = CATEGORIES.filter((c) => c !== 'Tous');

export default function CreateBasketScreen() {
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { baskets, addBasket, updateBasket, profile } = useBusinessStore();

  const existingBasket = editId ? baskets.find((b) => b.id === editId) : null;
  const isEditing = !!existingBasket;

  const [name, setName] = useState(existingBasket?.name ?? '');
  const [description, setDescription] = useState(existingBasket?.description ?? '');
  const [category, setCategory] = useState(existingBasket?.category ?? CATEGORY_OPTIONS[0]);
  const [originalPrice, setOriginalPrice] = useState(existingBasket?.originalPrice?.toString() ?? '');
  const [discountedPrice, setDiscountedPrice] = useState(existingBasket?.discountedPrice?.toString() ?? '');
  const [quantity, setQuantity] = useState(existingBasket?.quantityTotal?.toString() ?? '');
  const [pickupStart, setPickupStart] = useState(existingBasket?.pickupWindow?.start ?? '18:00');
  const [pickupEnd, setPickupEnd] = useState(existingBasket?.pickupWindow?.end ?? '19:00');
  const [exampleItems, setExampleItems] = useState(existingBasket?.exampleItems?.join(', ') ?? '');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSave = () => {
    if (!name.trim() || !originalPrice || !discountedPrice || !quantity) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const orig = parseFloat(originalPrice);
    const disc = parseFloat(discountedPrice);
    const qty = parseInt(quantity, 10);
    const discount = orig > 0 ? Math.round(((orig - disc) / orig) * 100) : 0;

    setTimeout(() => {
      if (isEditing && editId) {
        updateBasket(editId, {
          name: name.trim(),
          description: description.trim(),
          category,
          originalPrice: orig,
          discountedPrice: disc,
          discountPercentage: discount,
          quantityTotal: qty,
          quantityLeft: Math.min(existingBasket?.quantityLeft ?? qty, qty),
          pickupWindow: { start: pickupStart, end: pickupEnd },
          exampleItems: exampleItems.split(',').map((s) => s.trim()).filter(Boolean),
        });
      } else {
        const newBasket: Basket = {
          id: `biz_${Date.now()}`,
          merchantId: profile?.id ?? 'biz1',
          merchantName: profile?.name ?? 'Mon Commerce',
          merchantLogo: profile?.logo,
          merchantRating: 0,
          reviewCount: 0,
          reviews: { service: 0, quantite: 0, qualite: 0, variete: 0 },
          description: description.trim(),
          name: name.trim(),
          category,
          originalPrice: orig,
          discountedPrice: disc,
          discountPercentage: discount,
          pickupWindow: { start: pickupStart, end: pickupEnd },
          quantityLeft: qty,
          quantityTotal: qty,
          distance: 0,
          address: profile?.address ?? '',
          latitude: profile?.latitude ?? 36.8065,
          longitude: profile?.longitude ?? 10.1815,
          exampleItems: exampleItems.split(',').map((s) => s.trim()).filter(Boolean),
          isActive: true,
        };
        addBasket(newBasket);
      }
      setLoading(false);
      router.back();
    }, 600);
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

        <ScrollView style={styles.form} contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('business.createBasket.name')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={name}
              onChangeText={setName}
              placeholder={t('business.createBasket.namePlaceholder')}
              placeholderTextColor={theme.colors.muted}
            />
          </View>

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
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('business.createBasket.category')}
            </Text>
            <TouchableOpacity
              style={[styles.input, styles.pickerButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, ...theme.shadows.shadowSm }]}
              onPress={() => setShowCategoryPicker(!showCategoryPicker)}
            >
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body }]}>{category}</Text>
              <ChevronDown size={18} color={theme.colors.muted} />
            </TouchableOpacity>
            {showCategoryPicker && (
              <View style={[styles.pickerDropdown, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, marginTop: 4, ...theme.shadows.shadowMd }]}>
                {CATEGORY_OPTIONS.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.pickerItem, {
                      padding: theme.spacing.md,
                      backgroundColor: category === cat ? theme.colors.primary + '12' : 'transparent',
                    }]}
                    onPress={() => { setCategory(cat); setShowCategoryPicker(false); }}
                  >
                    <Text style={[{
                      color: category === cat ? theme.colors.primary : theme.colors.textPrimary,
                      ...theme.typography.body,
                      fontWeight: category === cat ? ('600' as const) : ('400' as const),
                    }]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={[styles.row, { marginBottom: theme.spacing.xl }]}>
            <View style={[styles.halfField, { marginRight: theme.spacing.md }]}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
                {t('business.createBasket.originalPrice')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                value={originalPrice}
                onChangeText={setOriginalPrice}
                placeholder="20"
                placeholderTextColor={theme.colors.muted}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
                {t('business.createBasket.discountedPrice')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                value={discountedPrice}
                onChangeText={setDiscountedPrice}
                placeholder="10"
                placeholderTextColor={theme.colors.muted}
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('business.createBasket.quantity')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={quantity}
              onChangeText={setQuantity}
              placeholder="5"
              placeholderTextColor={theme.colors.muted}
              keyboardType="numeric"
            />
          </View>

          <View style={[styles.row, { marginBottom: theme.spacing.xl }]}>
            <View style={[styles.halfField, { marginRight: theme.spacing.md }]}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
                {t('business.createBasket.pickupStart')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                value={pickupStart}
                onChangeText={setPickupStart}
                placeholder="18:00"
                placeholderTextColor={theme.colors.muted}
              />
            </View>
            <View style={styles.halfField}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
                {t('business.createBasket.pickupEnd')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                value={pickupEnd}
                onChangeText={setPickupEnd}
                placeholder="19:00"
                placeholderTextColor={theme.colors.muted}
              />
            </View>
          </View>

          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('business.createBasket.exampleItems')}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={exampleItems}
              onChangeText={setExampleItems}
              placeholder={t('business.createBasket.exampleItemsPlaceholder')}
              placeholderTextColor={theme.colors.muted}
            />
          </View>
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider, ...theme.shadows.shadowLg }]}>
          <PrimaryCTAButton
            onPress={handleSave}
            title={isEditing ? t('business.createBasket.save') : t('business.createBasket.create')}
            loading={loading}
          />
        </View>
      </KeyboardAvoidingView>
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
  form: {
    flex: 1,
  },
  field: {},
  label: {},
  input: {
    height: 52,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  textArea: {
    height: 100,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  row: {
    flexDirection: 'row',
  },
  halfField: {
    flex: 1,
  },
  pickerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerDropdown: {
    overflow: 'hidden',
  },
  pickerItem: {},
  footer: {},
});
