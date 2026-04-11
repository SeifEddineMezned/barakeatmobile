import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyProfile, fetchMyBaskets, updateLocationById } from '@/src/services/business';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useAuthStore } from '@/src/stores/authStore';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';

export default function AvailabilityScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const queryClient = useQueryClient();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const { user } = useAuthStore();

  const [pickupStart, setPickupStart] = useState('');
  const [pickupEnd, setPickupEnd] = useState('');

  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 30_000,
  });

  // Baskets hold the EFFECTIVE pickup times (these are what we update successfully)
  const basketsQuery = useQuery({
    queryKey: ['my-baskets', selectedLocationId],
    queryFn: () => fetchMyBaskets(selectedLocationId),
    staleTime: 30_000,
  });

  // Seed form: prefer basket times > location times
  React.useEffect(() => {
    const basket = basketsQuery.data?.[0];
    const start = basket?.pickup_start_time ?? profileQuery.data?.pickup_start_time;
    const end = basket?.pickup_end_time ?? profileQuery.data?.pickup_end_time;
    if (start) setPickupStart(start.substring(0, 5));
    if (end) setPickupEnd(end.substring(0, 5));
  }, [basketsQuery.data, profileQuery.data, selectedLocationId]);

  const toTimeField = (hhmm: string): string =>
    hhmm.includes(':') && hhmm.split(':').length === 2 ? `${hhmm}:00` : hhmm;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const userId = (user as any)?.id as number | undefined;
      const locationId = selectedLocationId ?? profileQuery.data?.id;
      if (!locationId) throw new Error('Profil non chargé. Veuillez réessayer.');
      // PUT /api/locations/:id — same confirmed pattern as PUT /api/baskets/:id
      await updateLocationById(
        locationId,
        {
          pickup_start_time: toTimeField(pickupStart),
          pickup_end_time: toTimeField(pickupEnd),
        },
        userId,
        profileQuery.data?.organization_id ?? undefined
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      alert.showAlert(t('common.success'), t('business.availability.saved'));
      router.back();
    },
    onError: (err: any) => {
      const msg = err?.message ?? t('common.errorOccurred');
      alert.showAlert(t('common.error'), msg);
    },
  });

  if (profileQuery.isLoading || basketsQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.header, {
        paddingHorizontal: theme.spacing.xl,
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.md,
      }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' as const }}>
          {t('business.availability.title')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.r16,
          padding: theme.spacing.xl,
          marginTop: theme.spacing.lg,
          ...theme.shadows.shadowSm,
        }}>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 6 }}>
            {t('business.availability.pickupStart')}
          </Text>
          <TextInput
            style={[styles.timeInput, {
              backgroundColor: theme.colors.bg,
              borderRadius: theme.radii.r12,
              color: theme.colors.textPrimary,
              ...theme.typography.h3,
            }]}
            value={pickupStart}
            onChangeText={setPickupStart}
            placeholder="HH:MM"
            placeholderTextColor={theme.colors.muted}
            keyboardType="numbers-and-punctuation"
          />

          <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: theme.spacing.lg }} />

          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 6 }}>
            {t('business.availability.pickupEnd')}
          </Text>
          <TextInput
            style={[styles.timeInput, {
              backgroundColor: theme.colors.bg,
              borderRadius: theme.radii.r12,
              color: theme.colors.textPrimary,
              ...theme.typography.h3,
            }]}
            value={pickupEnd}
            onChangeText={setPickupEnd}
            placeholder="HH:MM"
            placeholderTextColor={theme.colors.muted}
            keyboardType="numbers-and-punctuation"
          />
        </View>

        <View style={{ marginTop: theme.spacing.xxl }}>
          <PrimaryCTAButton
            onPress={() => saveMutation.mutate()}
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
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  content: { flex: 1 },
  timeInput: { height: 52, paddingHorizontal: 16 },
});
