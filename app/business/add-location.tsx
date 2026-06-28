import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ShieldCheck, CheckCircle2 } from 'lucide-react-native';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addLocation, fetchMyContext } from '@/src/services/teams';
import { getErrorMessage } from '@/src/lib/api';
import { verifyOrAlarm } from '@/src/hooks/useVerifyOnError';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { LocationFormFields, type LocationFormValue } from '@/src/components/LocationFormFields';
import { useBusinessStore } from '@/src/stores/businessStore';
import { validateBizDayWindow } from '@/src/utils/timezone';

export default function AddLocationScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<LocationFormValue>({
    name: '', address: '', coords: null, phone: '', category: '',
    pickupStart: '', pickupEnd: '', pickupInstructions: '', bagDescription: '',
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Held so we can programmatically scroll the focused pickup-instructions
  // field above the keyboard on Android (see the onPickupInstructionsFocus
  // wiring below). iOS handles this via KeyboardAvoidingView padding +
  // built-in keyboard insets; Android needs the explicit scrollToEnd.
  const scrollViewRef = useRef<ScrollView>(null);

  const contextQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 60_000 });
  const orgId = contextQuery.data?.organization_id ?? null;

  const toTime = (hhmm: string) =>
    hhmm && hhmm.includes(':') && hhmm.split(':').length === 2 ? `${hhmm}:00` : (hhmm || undefined);

  const mutation = useMutation({
    onMutate: () => {
      const existing = ((queryClient.getQueryData<any>(['org-details', orgId])?.locations ?? []) as any[]);
      const preIds = new Set(existing.map((l: any) => l?.id));
      return { preIds, expectedName: form.name.trim() };
    },
    mutationFn: async () => {
      if (!orgId) throw new Error(t('business.team.noOrganization', { defaultValue: "Aucune organisation trouvée. Veuillez d'abord créer une organisation." }));
      // Enforce the cross-03:30 / zero-duration rule here too — the team
      // location form previously accepted (e.g.) 00:00→05:00 because only
      // create-basket and business-profile checked it. The 03:30 cron
      // refills inventory, so any window straddling that boundary breaks
      // both reservation logic and the daily-reinit math.
      if (form.pickupStart && form.pickupEnd) {
        const status = validateBizDayWindow(form.pickupStart, form.pickupEnd);
        if (status === 'zero') {
          throw new Error(t('business.availability.invalidWindow', { defaultValue: "L'heure de fin doit être différente de l'heure de début." }));
        }
        if (status === 'crosses-reset') {
          throw new Error(t('business.availability.crossReset', { defaultValue: "Le créneau ne peut pas traverser la réinitialisation quotidienne (03:30). Choisissez un début ≥ 03:30, ou une fin ≤ 03:29." }));
        }
      }
      return addLocation(orgId, {
        name: form.name.trim() || undefined,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        category: form.category || undefined,
        pickup_start_time: toTime(form.pickupStart),
        pickup_end_time: toTime(form.pickupEnd),
        pickup_instructions: form.pickupInstructions.trim() || null,
        bag_description: form.bagDescription.trim() || null,
        ...(form.coords ? { latitude: form.coords.lat, longitude: form.coords.lng } : {}),
      });
    },
    onSuccess: (newLoc) => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      // Auto-select the newly-created location so the user lands on it when
      // they navigate to Baskets / Orders. Without this the top-left dropdown
      // stays on whatever was selected before (often null → "Emplacement")
      // and the first basket the user creates gets attached to the wrong
      // location.
      const newId = (newLoc as any)?.id;
      if (newId != null) {
        useBusinessStore.getState().setSelectedLocationId(Number(newId));
      }
      setSuccessMsg(t('business.team.locationAdded', { defaultValue: 'Emplacement ajouté avec succès.' }));
    },
    onError: async (err, _vars, context) => {
      // Verify before alarming: if the location actually got created
      // even though the response was lost, just navigate to the
      // success state silently. Prevents the user from re-tapping and
      // creating duplicate locations (each tied to its own basket and
      // pickup window).
      await verifyOrAlarm<any>({
        error: err,
        queryClient,
        verifyKey: ['org-details', orgId],
        verify: (fresh: any) => {
          const locations = ((fresh as any)?.locations ?? []) as any[];
          const newLoc = locations.find((l: any) => {
            const isNew = l?.id != null && !context?.preIds?.has(l.id);
            const nameMatch = String(l?.name ?? '').trim() === String(context?.expectedName ?? '').trim();
            return isNew && nameMatch;
          });
          if (!newLoc) return false;
          // Auto-select the recovered location, same as onSuccess.
          useBusinessStore.getState().setSelectedLocationId(Number(newLoc.id));
          return true;
        },
        onConfirmed: () => {
          void queryClient.invalidateQueries({ queryKey: ['org-details'] });
          setSuccessMsg(t('business.team.locationAdded', { defaultValue: 'Emplacement ajouté avec succès.' }));
        },
        onUnconfirmed: () => setErrorMsg(getErrorMessage(err)),
      });
    },
  });

  // Pickup window is now mandatory: the backend already defaults to 11:00→14:00
  // when omitted, which let merchants create a location without consciously
  // picking hours and then wonder why baskets surfaced at the wrong time.
  // Forcing both fields here makes the choice deliberate.
  const canSubmit =
    !!form.name.trim() &&
    (!!form.address.trim() || !!form.coords) &&
    !!form.category &&
    !!form.pickupStart &&
    !!form.pickupEnd;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <View
        style={[
          styles.header,
          {
            borderBottomColor: theme.colors.divider,
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 48,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ position: 'absolute', left: 16, top: 12 }}
        >
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        {/* pointerEvents="none" — title paints later than the absolute back
            button and would otherwise swallow taps over the icon. */}
        <Text pointerEvents="none" style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
          {t('business.team.addLocation', { defaultValue: 'Ajouter un emplacement' })}
        </Text>
      </View>

      {/* KeyboardAvoidingView only on iOS — Android's windowSoftInputMode
          'adjustResize' (the Expo default) already shrinks the visible viewport
          when the keyboard opens, so we just need to ensure the ScrollView
          scrolls the focused field above the keyboard. The 'height' /'padding'
          variants for Android only shrink the container without scrolling,
          which produced the "band of padding above the keyboard" the user
          reported. We rely on the ScrollView ref below for both platforms. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={{ padding: 20, paddingBottom: 0 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 20 }}>
            {t('business.team.addLocationDesc', { defaultValue: 'Ajoutez un nouvel emplacement pour votre organisation.' })}
          </Text>

          <LocationFormFields
            value={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            // When the pickup-instructions textbox gains focus, scroll it
            // to the top of the visible area so the keyboard never covers
            // what the user is typing. The delay lets the keyboard finish
            // animating in before we measure — without it the scrollTo
            // lands on a stale y position and the field re-disappears.
            onPickupInstructionsFocus={() => {
              setTimeout(() => {
                scrollViewRef.current?.scrollToEnd({ animated: true });
              }, 250);
            }}
          />

          {FeatureFlags.REQUIRE_LOCATION_APPROVAL && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#114b3c08', borderRadius: 12, padding: 12, marginTop: 20, gap: 8 }}>
              <ShieldCheck size={16} color="#114b3c" style={{ marginTop: 1 }} />
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 }}>
                {t('business.team.adminApprovalNote', { defaultValue: "L'ajout de ce nouvel emplacement sera soumis à validation par notre équipe admin." })}
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={() => mutation.mutate()}
            disabled={mutation.isPending || !canSubmit}
            style={{
              backgroundColor: '#114b3c',
              borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24,
              // Stay green when disabled — just faded (matches PrimaryCTAButton),
              // instead of turning grey.
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                {FeatureFlags.REQUIRE_LOCATION_APPROVAL
                  ? t('business.team.submitLocation', { defaultValue: 'Soumettre la demande' })
                  : t('business.team.addLocationBtn', { defaultValue: "Ajouter l'emplacement" })}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Error modal */}
      <Modal visible={!!errorMsg} transparent animationType="fade" onRequestClose={() => setErrorMsg(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <BarakeatErrorIcon size={28} color="#ef4444" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 10 }}>
              {t('auth.error')}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {errorMsg}
            </Text>
            <TouchableOpacity onPress={() => setErrorMsg(null)} style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}>
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Success modal */}
      <Modal visible={!!successMsg} transparent animationType="fade" onRequestClose={() => { setSuccessMsg(null); router.back(); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#114b3c18', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <CheckCircle2 size={28} color="#114b3c" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 10 }}>
              {t('common.success', { defaultValue: 'Succès' })}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {successMsg}
            </Text>
            <TouchableOpacity onPress={() => { setSuccessMsg(null); router.back(); }} style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}>
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
});
