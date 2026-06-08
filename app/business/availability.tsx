import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { TimePicker } from '@/src/components/TimePicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { X, Clock } from 'lucide-react-native';
import { validateBizDayWindow } from '@/src/utils/timezone';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyProfile, fetchMyBaskets, updateLocationById, updateBasket } from '@/src/services/business';
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

  // Normalize any HH:MM or HH:MM:SS string to HH:MM:SS for lexicographic comparison.
  const normalizeTime = (v: string | null | undefined): string | null => {
    if (!v) return null;
    const parts = v.split(':');
    if (parts.length === 2) return `${v}:00`;
    if (parts.length === 3) return v;
    return null;
  };

  const clampToWindow = (v: string | null | undefined, lo: string, hi: string): string => {
    const n = normalizeTime(v);
    if (!n) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const userId = (user as any)?.id as number | undefined;
      const locationId = selectedLocationId ?? profileQuery.data?.id;
      if (!locationId) throw new Error('Profil non chargé. Veuillez réessayer.');
      const newStart = toTimeField(pickupStart);
      const newEnd = toTimeField(pickupEnd);
      // PUT /api/locations/:id — same confirmed pattern as PUT /api/baskets/:id
      await updateLocationById(
        locationId,
        { pickup_start_time: newStart, pickup_end_time: newEnd },
        userId,
        profileQuery.data?.organization_id ?? undefined
      );
      // Clamp each basket's pickup window to the new location window.
      // Non-conflicting baskets keep their original times (re-sent in case the
      // updateLocationById fallback overwrote all baskets to newStart/newEnd).
      const baskets = basketsQuery.data ?? [];
      await Promise.all(
        baskets.map((b) =>
          updateBasket(b.id, {
            pickup_start_time: clampToWindow(b.pickup_start_time, newStart, newEnd),
            pickup_end_time: clampToWindow(b.pickup_end_time, newStart, newEnd),
          }).catch((err: any) => {
            console.log('[Availability] Failed to clamp basket', b.id, err?.message);
          })
        )
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['business-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      alert.showAlert(t('common.success'), t('business.availability.saved'));
      router.back();
    },
    onError: (err: any) => {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    },
  });

  const handleSavePress = () => {
    // Cross-03:30 / zero-duration check first — once the rule fires
    // there's nothing else to validate.
    const status = validateBizDayWindow(pickupStart, pickupEnd);
    if (status !== 'ok') {
      const msg = status === 'zero'
        ? t('business.availability.invalidWindow', { defaultValue: "L'heure de fin doit être différente de l'heure de début." })
        : t('business.availability.crossReset', { defaultValue: "Le créneau ne peut pas traverser la réinitialisation quotidienne (03:30). Choisissez un début ≥ 03:30, ou une fin ≤ 03:29." });
      alert.showAlert(t('common.error', { defaultValue: 'Erreur' }), msg);
      return;
    }
    const newStart = toTimeField(pickupStart);
    const newEnd = toTimeField(pickupEnd);
    const baskets = basketsQuery.data ?? [];
    const conflicting = baskets.filter((b) => {
      const bs = normalizeTime(b.pickup_start_time);
      const be = normalizeTime(b.pickup_end_time);
      return (bs !== null && bs < newStart) || (be !== null && be > newEnd);
    });
    if (conflicting.length > 0) {
      alert.showAlert(
        t('business.availability.conflictTitle'),
        t('business.availability.conflictMessage', {
          count: conflicting.length,
          start: newStart.substring(0, 5),
          end: newEnd.substring(0, 5),
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('business.availability.adjustAndSave'),
            onPress: () => saveMutation.mutate(),
          },
        ]
      );
      return;
    }
    saveMutation.mutate();
  };

  if (profileQuery.isLoading || basketsQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
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
        {/* Cross-reset rule reminder — same copy as the hours modal in
            business-profile so the constraint reads consistently from
            either entry point. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: theme.spacing.lg, paddingHorizontal: 4 }}>
          <Clock size={12} color={theme.colors.muted} style={{ marginTop: 2 }} />
          <Text style={{ color: theme.colors.muted, ...theme.typography.caption, flex: 1, lineHeight: 15 }}>
            {t('business.availability.crossResetHint', {
              defaultValue: 'Le créneau ne doit pas traverser 03:30 (réinitialisation quotidienne). Commencez ≥ 03:30 ou terminez ≤ 03:29.',
            })}
          </Text>
        </View>

        <View style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.r16,
          padding: theme.spacing.xl,
          marginTop: theme.spacing.md,
          ...theme.shadows.shadowSm,
        }}>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 6 }}>
            {t('business.availability.pickupStart')}
          </Text>
          <TimePicker
            value={pickupStart}
            onChange={setPickupStart}
            label={t('business.availability.pickupStart')}
            primaryColor={theme.colors.primary}
            textColor={theme.colors.textPrimary}
            bgColor={theme.colors.bg}
            mutedColor={theme.colors.muted}
          />

          <View style={{ height: 1, backgroundColor: theme.colors.divider, marginVertical: theme.spacing.lg }} />

          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 6 }}>
            {t('business.availability.pickupEnd')}
          </Text>
          <TimePicker
            value={pickupEnd}
            onChange={setPickupEnd}
            label={t('business.availability.pickupEnd')}
            primaryColor={theme.colors.primary}
            textColor={theme.colors.textPrimary}
            bgColor={theme.colors.bg}
            mutedColor={theme.colors.muted}
          />
        </View>

        <View style={{ marginTop: theme.spacing.xxl }}>
          <PrimaryCTAButton
            onPress={handleSavePress}
            title={t('business.availability.save')}
            loading={saveMutation.isPending}
            disabled={saveMutation.isPending}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  content: { flex: 1 },
  timeInput: { height: 52, paddingHorizontal: 16 },
});
