import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { TimePicker } from '@/src/components/TimePicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { verifyOrAlarm } from '@/src/hooks/useVerifyOnError';
import { X, Clock } from 'lucide-react-native';
import { validateBizDayWindow } from '@/src/utils/timezone';
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

  // Live validation status — re-evaluated on every pickerStart/end change so
  // the hint flips red and the save button disables the instant the merchant
  // picks an invalid window (zero / <15 min / crosses 03:30). Matches the
  // price-discount pattern in create-basket.tsx (warning text doubles as
  // the error indicator instead of stacking two messages).
  const windowStatus = React.useMemo(
    () => validateBizDayWindow(pickupStart, pickupEnd),
    [pickupStart, pickupEnd],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const userId = (user as any)?.id as number | undefined;
      const locationId = selectedLocationId ?? profileQuery.data?.id;
      if (!locationId) throw new Error('Profil non chargé. Veuillez réessayer.');
      const newStart = toTimeField(pickupStart);
      const newEnd = toTimeField(pickupEnd);
      // PUT /api/locations/:id — backend now (a) hard-blocks the save with
      // 409 `ordered_basket_window_shortened` if any of today's confirmed
      // orders would have their pickup window shortened, and (b) returns
      // `affected_custom_baskets` listing baskets with custom pickup times
      // that now fall outside the new location hours (informational only —
      // they are NOT auto-clamped any more; the merchant must decide). The
      // previous client-side clamp-each-basket loop is gone — it was the
      // source of the "3:00-3:00" bug the user kept hitting.
      const res = await updateLocationById(
        locationId,
        { pickup_start_time: newStart, pickup_end_time: newEnd },
        userId,
        profileQuery.data?.organization_id ?? undefined
      );
      return res;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['business-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      // Heads-up popup AFTER the save committed. Baskets using "horaires
      // du commerce" (NULL columns) automatically pick up the new location
      // hours; baskets with their OWN pickup_start_time / pickup_end_time
      // are now LEFT UNTOUCHED on the backend (per the user's request:
      // never auto-modify custom-pickup baskets). If any such baskets
      // exist, surface a one-button confirmation pointing the merchant to
      // the baskets page to verify them. The popup is purely informational
      // — the location change is already saved by the time it appears.
      const baskets = basketsQuery.data ?? [];
      const customCount = baskets.filter((b) => b.pickup_start_time != null || b.pickup_end_time != null).length;
      if (customCount > 0) {
        alert.showAlert(
          t('business.availability.customWarningTitle', { defaultValue: 'Vérifiez vos paniers' }),
          t('business.availability.customWarningBody', {
            defaultValue: "1 ou plusieurs paniers ont des horaires de retraits personnalisés et n'ont pas été modifiés.\nAllez à Mes Paniers pour vérifier qu'ils sont toujours corrects.",
          }),
          [
            {
              text: t('business.availability.goToBaskets', { defaultValue: 'Voir mes paniers' }),
              onPress: () => {
                router.back(); // close availability screen
                router.push('/(business)/my-baskets' as never);
              },
            },
          ],
          { layout: 'sheet', type: 'info' },
        );
        return; // navigation handled in the action onPress
      }
      router.back();
    },
    onError: async (err: any) => {
      // 409 ordered_basket_window_shortened — show the specific conflict.
      // List up to 5 affected orders so the merchant knows whose pickup
      // they'd be stranding. Suppress verifyOrAlarm in this branch since
      // the change definitively did NOT commit (the backend rejected
      // BEFORE the UPDATE).
      const errCode = err?.data?.error ?? err?.response?.data?.error;
      if (errCode === 'ordered_basket_window_shortened') {
        const affected = err?.data?.affected ?? err?.response?.data?.affected ?? [];
        const lines = (Array.isArray(affected) ? affected : []).slice(0, 5)
          .map((b: any) => `• ${b.basket_name ?? 'Panier'}${b.customer_name ? ` (${b.customer_name})` : ''}: ${b.current_window} → ${b.new_window}`)
          .join('\n');
        const extraCount = Math.max(0, (Array.isArray(affected) ? affected.length : 0) - 5);
        alert.showAlert(
          t('business.availability.orderConflictTitle', { defaultValue: 'Commandes en cours' }),
          `${t('business.availability.orderConflictBody', {
            defaultValue: "Vous ne pouvez pas raccourcir l'horaire — des clients ont déjà commandé pour aujourd'hui.",
          })}\n\n${lines}${extraCount > 0 ? `\n\n+${extraCount} ${t('business.availability.moreOrders', { defaultValue: 'autres' })}` : ''}`,
        );
        return;
      }
      // Verify before alarming. Availability save updates the location
      // pickup window AND clamps every basket — multi-step; the first
      // step often succeeds even if the response was lost.
      const newStart = toTimeField(pickupStart);
      const newEnd = toTimeField(pickupEnd);
      await verifyOrAlarm<any>({
        error: err,
        queryClient,
        verifyKey: ['my-profile'],
        verify: (fresh: any) => {
          if (!fresh) return false;
          const liveStart = String(fresh?.pickup_start_time ?? '').substring(0, 5);
          const liveEnd = String(fresh?.pickup_end_time ?? '').substring(0, 5);
          const sentStart = String(newStart ?? '').substring(0, 5);
          const sentEnd = String(newEnd ?? '').substring(0, 5);
          return liveStart === sentStart && liveEnd === sentEnd;
        },
        onConfirmed: () => {
          void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
          void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
          void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
          void queryClient.invalidateQueries({ queryKey: ['business-analytics'] });
          void queryClient.invalidateQueries({ queryKey: ['locations'] });
          alert.showAlert(t('common.success'), t('business.availability.saved'));
          router.back();
        },
        onUnconfirmed: () => alert.showAlert(t('common.error'), getErrorMessage(err)),
      });
    },
  });

  const handleSavePress = () => {
    // Cross-03:30 / zero-duration / too-short check — once the rule fires
    // there's nothing else to validate. (The save button is also disabled
    // when status !== 'ok' so this is a belt-and-suspenders guard for the
    // case where the merchant tapped before validation updated.)
    const status = windowStatus;
    if (status !== 'ok') {
      const msg = status === 'zero'
        ? t('business.availability.invalidWindow', { defaultValue: "L'heure de fin doit être différente de l'heure de début." })
        : status === 'too-short'
          ? t('business.availability.tooShort', { defaultValue: 'Le créneau de retrait doit durer au moins 15 minutes.' })
          : t('business.availability.crossReset', { defaultValue: "Le créneau ne peut pas traverser la réinitialisation quotidienne (03:30). Choisissez un début ≥ 03:30, ou une fin ≤ 03:29." });
      alert.showAlert(t('common.error', { defaultValue: 'Erreur' }), msg);
      return;
    }
    // Save unconditionally — the location-hour change is independent of
    // any custom-pickup baskets the merchant might have. If a save error
    // happens (ordered-basket conflict, network) the onError surfaces it;
    // if the save succeeds AND there are custom-pickup baskets, the
    // onSuccess shows an informational popup pointing the merchant to
    // the baskets page to verify them (no longer a pre-save blocker).
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
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
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
        {/* Cross-reset / duration rule reminder. Two states share the same
            slot:
              - default (windowStatus === 'ok'): muted-grey hint about the
                03:30 rule, same as the hours modal in business-profile.
              - error (zero / too-short / crosses-reset): same row, but the
                icon + text flip to red and the copy swaps to the specific
                violation. The save button below disables to match. Single
                element with two visual states — matches the price-discount
                pattern in create-basket.tsx (no stacked duplicate hints). */}
        {(() => {
          const isError = windowStatus !== 'ok';
          const hintColor = isError ? theme.colors.error : theme.colors.muted;
          const message = !isError
            ? t('business.availability.crossResetHint', {
                defaultValue: 'Le créneau ne doit pas traverser 03:30 (réinitialisation quotidienne). Commencez ≥ 03:30 ou terminez ≤ 03:29.',
              })
            : windowStatus === 'zero'
              ? t('business.availability.invalidWindow', { defaultValue: "L'heure de fin doit être différente de l'heure de début." })
              : windowStatus === 'too-short'
                ? t('business.availability.tooShort', { defaultValue: 'Le créneau de retrait doit durer au moins 15 minutes.' })
                : t('business.availability.crossReset', { defaultValue: "Le créneau ne peut pas traverser la réinitialisation quotidienne (03:30). Choisissez un début ≥ 03:30, ou une fin ≤ 03:29." });
          return (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: theme.spacing.lg, paddingHorizontal: 4 }}>
              <Clock size={12} color={hintColor} style={{ marginTop: 2 }} />
              <Text style={{ color: hintColor, ...theme.typography.caption, flex: 1, lineHeight: 15 }}>
                {message}
              </Text>
            </View>
          );
        })()}

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
            disabled={saveMutation.isPending || windowStatus !== 'ok'}
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
