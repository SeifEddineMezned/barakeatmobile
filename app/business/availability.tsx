import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Minus, Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchMyProfile, updateQuantity, updateAvailability } from '@/src/services/business';

export default function AvailabilityScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const [quantity, setQuantity] = useState(0);
  const [pickupStart, setPickupStart] = useState('18:00');
  const [pickupEnd, setPickupEnd] = useState('19:00');
  const [isPaused, setIsPaused] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['my-profile'],
    queryFn: fetchMyProfile,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (profileQuery.data) {
      setQuantity(profileQuery.data.available_quantity ?? profileQuery.data.default_daily_quantity ?? 0);
      setPickupStart(profileQuery.data.pickup_start_time?.substring(0, 5) ?? '18:00');
      setPickupEnd(profileQuery.data.pickup_end_time?.substring(0, 5) ?? '19:00');
      setIsPaused(profileQuery.data.is_paused ?? false);
    }
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await updateQuantity(quantity);
      await updateAvailability({
        is_paused: isPaused,
        availability_status: isPaused ? 'paused' : 'available',
      });
    },
    onSuccess: () => {
      Alert.alert(t('common.success'), t('business.availability.saved'));
      router.back();
    },
    onError: () => {
      Alert.alert(t('common.error'), t('common.errorOccurred'));
    },
  });

  const handleDecrement = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuantity((prev) => Math.max(0, prev - 1));
  };

  const handleIncrement = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuantity((prev) => prev + 1);
  };

  const handleSave = () => {
    saveMutation.mutate();
  };

  if (profileQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.md }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' as const }]}>
          {t('business.availability.title')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Quantity Section */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
            {t('business.availability.quantity')}
          </Text>
          <View style={styles.quantitySelector}>
            <TouchableOpacity
              onPress={handleDecrement}
              style={[styles.qtyBtn, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48 }]}
            >
              <Minus size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.display, marginHorizontal: theme.spacing.xxl }]}>
              {quantity}
            </Text>
            <TouchableOpacity
              onPress={handleIncrement}
              style={[styles.qtyBtn, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, width: 48, height: 48 }]}
            >
              <Plus size={20} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Pickup Time Section */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
            {t('business.availability.pickupStart')}
          </Text>
          <TextInput
            style={[styles.timeInput, {
              backgroundColor: theme.colors.bg,
              borderRadius: theme.radii.r12,
              color: theme.colors.textPrimary,
              ...theme.typography.body,
            }]}
            value={pickupStart}
            onChangeText={setPickupStart}
            placeholder="HH:MM"
            placeholderTextColor={theme.colors.muted}
            keyboardType="numbers-and-punctuation"
          />

          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg, marginTop: theme.spacing.xl }]}>
            {t('business.availability.pickupEnd')}
          </Text>
          <TextInput
            style={[styles.timeInput, {
              backgroundColor: theme.colors.bg,
              borderRadius: theme.radii.r12,
              color: theme.colors.textPrimary,
              ...theme.typography.body,
            }]}
            value={pickupEnd}
            onChangeText={setPickupEnd}
            placeholder="HH:MM"
            placeholderTextColor={theme.colors.muted}
            keyboardType="numbers-and-punctuation"
          />
        </View>

        {/* Pause Toggle Section */}
        <View style={[styles.section, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <View style={styles.pauseRow}>
            <Text style={[{ color: isPaused ? theme.colors.error : theme.colors.success, ...theme.typography.body, fontWeight: '600' as const, flex: 1 }]}>
              {isPaused ? t('business.availability.paused') : t('business.availability.active')}
            </Text>
            <Switch
              value={isPaused}
              onValueChange={(val) => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIsPaused(val);
              }}
              trackColor={{ false: theme.colors.divider, true: theme.colors.error + '50' }}
              thumbColor={isPaused ? theme.colors.error : theme.colors.success}
            />
          </View>
        </View>

        {/* Save Button */}
        <View style={{ marginTop: theme.spacing.xxl }}>
          <PrimaryCTAButton
            onPress={handleSave}
            title={t('business.availability.save')}
            loading={saveMutation.isPending}
            disabled={saveMutation.isPending}
          />
        </View>
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
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {},
  quantitySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtn: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeInput: {
    height: 48,
    paddingHorizontal: 16,
  },
  pauseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
