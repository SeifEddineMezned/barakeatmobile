import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, AlertCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useBusinessStore } from '@/src/stores/businessStore';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import type { Basket } from '@/src/types';

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
  const [originalPrice, setOriginalPrice] = useState(existingBasket?.originalPrice?.toString() ?? '');
  const [discountedPrice, setDiscountedPrice] = useState(existingBasket?.discountedPrice?.toString() ?? '');
  const [basketContents, setBasketContents] = useState(existingBasket?.exampleItems?.join(', ') ?? '');
  const [loading, setLoading] = useState(false);
  const [priceError, setPriceError] = useState('');

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

  const handleDiscountedPriceChange = (val: string) => {
    setDiscountedPrice(val);
    if (originalPrice && val) {
      validatePrice(originalPrice, val);
    } else {
      setPriceError('');
    }
  };

  const handleOriginalPriceChange = (val: string) => {
    setOriginalPrice(val);
    if (val && discountedPrice) {
      validatePrice(val, discountedPrice);
    } else {
      setPriceError('');
    }
  };

  const handleSave = () => {
    if (!name.trim() || !originalPrice || !discountedPrice) return;
    if (!validatePrice(originalPrice, discountedPrice)) return;

    setLoading(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const orig = parseFloat(originalPrice);
    const disc = parseFloat(discountedPrice);
    const discount = orig > 0 ? Math.round(((orig - disc) / orig) * 100) : 0;

    setTimeout(() => {
      if (isEditing && editId) {
        updateBasket(editId, {
          name: name.trim(),
          description: description.trim(),
          originalPrice: orig,
          discountedPrice: disc,
          discountPercentage: discount,
          exampleItems: basketContents.split(',').map((s) => s.trim()).filter(Boolean),
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
          category: profile?.category ?? 'Patisseries/Boulangeries',
          originalPrice: orig,
          discountedPrice: disc,
          discountPercentage: discount,
          pickupWindow: { start: profile?.hours?.split(' - ')[0] ?? '18:00', end: profile?.hours?.split(' - ')[1] ?? '19:00' },
          quantityLeft: 5,
          quantityTotal: 5,
          distance: 0,
          address: profile?.address ?? '',
          latitude: profile?.latitude ?? 36.8065,
          longitude: profile?.longitude ?? 10.1815,
          exampleItems: basketContents.split(',').map((s) => s.trim()).filter(Boolean),
          isActive: false,
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
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          <View style={[styles.row, { marginBottom: theme.spacing.xl }]}>
            <View style={[styles.halfField, { marginRight: theme.spacing.md }]}>
              <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
                {t('business.createBasket.originalPrice')}
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
                value={originalPrice}
                onChangeText={handleOriginalPriceChange}
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
                style={[styles.input, {
                  backgroundColor: theme.colors.surface,
                  borderColor: priceError ? theme.colors.error : theme.colors.divider,
                  borderRadius: theme.radii.r12,
                  color: theme.colors.textPrimary,
                  ...theme.typography.body,
                  ...theme.shadows.shadowSm,
                }]}
                value={discountedPrice}
                onChangeText={handleDiscountedPriceChange}
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

          <View style={[styles.field, { marginBottom: theme.spacing.xl }]}>
            <Text style={[styles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }]}>
              {t('business.createBasket.basketContents')}
            </Text>
            <TextInput
              style={[styles.textArea, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, ...theme.shadows.shadowSm }]}
              value={basketContents}
              onChangeText={setBasketContents}
              placeholder={t('business.createBasket.contentsPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: theme.colors.surface, paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.divider, ...theme.shadows.shadowLg }]}>
          <PrimaryCTAButton
            onPress={handleSave}
            title={isEditing ? t('business.createBasket.save') : t('business.createBasket.create')}
            loading={loading}
            disabled={!!priceError}
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
    minHeight: 100,
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
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footer: {},
});
