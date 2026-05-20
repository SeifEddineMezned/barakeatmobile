import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMyContext, fetchOrganizationDetails, updateLocation } from '@/src/services/teams';
import { getErrorMessage } from '@/src/lib/api';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { LocationFormFields, type LocationFormValue } from '@/src/components/LocationFormFields';

export default function EditLocationScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const alert = useCustomAlert();
  const params = useLocalSearchParams<{ id?: string }>();
  const locationId = params.id ? Number(params.id) : null;

  const contextQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 60_000 });
  const orgId = contextQuery.data?.organization_id ?? null;
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const [form, setForm] = useState<LocationFormValue>({
    name: '', address: '', coords: null, phone: '', category: '',
    pickupStart: '', pickupEnd: '', pickupInstructions: '', bagDescription: '',
  });

  // Hydrate from cached org details. Seeding `coords` from the saved lat/lng
  // means the map picker opens at the current spot instead of default Tunis.
  useEffect(() => {
    const locations = (orgDetailsQuery.data as any)?.locations ?? [];
    const loc = locations.find((l: any) => Number(l.id) === locationId);
    if (!loc) return;
    setForm({
      name: loc.name ?? '',
      address: loc.address ?? '',
      coords: (loc.latitude != null && loc.longitude != null)
        ? { lat: Number(loc.latitude), lng: Number(loc.longitude) }
        : null,
      phone: loc.phone ?? '',
      category: loc.category ?? '',
      pickupStart: (loc.pickup_start_time ?? '').substring(0, 5),
      pickupEnd: (loc.pickup_end_time ?? '').substring(0, 5),
      pickupInstructions: loc.pickup_instructions ?? '',
      bagDescription: loc.bag_description ?? '',
    });
  }, [orgDetailsQuery.data, locationId]);

  const toTime = (hhmm: string) =>
    hhmm && hhmm.includes(':') && hhmm.split(':').length === 2 ? `${hhmm}:00` : (hhmm || undefined);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !locationId) throw new Error('Organisation ou emplacement introuvable');
      return updateLocation(orgId, locationId, {
        name: form.name.trim() || undefined,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        category: form.category || undefined,
        pickup_instructions: form.pickupInstructions.trim() || null,
        pickup_start_time: toTime(form.pickupStart),
        pickup_end_time: toTime(form.pickupEnd),
        bag_description: form.bagDescription.trim() || null,
        // Pass lat/lng when the user picked / re-picked on the map.
        ...(form.coords ? { latitude: form.coords.lat, longitude: form.coords.lng } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      alert.showAlert(
        t('common.success'),
        t('business.team.locationUpdated', { defaultValue: 'Emplacement mis à jour.' }),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    },
    onError: (err: any) => {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    },
  });

  const canSubmit = !!orgId && !!locationId && !!form.category && !mutation.isPending;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {t('business.team.editLocation', { defaultValue: "Modifier l'emplacement" })}
        </Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <LocationFormFields
            value={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />

          <TouchableOpacity
            onPress={() => mutation.mutate()}
            disabled={!canSubmit}
            style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 24, opacity: canSubmit ? 1 : 0.5 }}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                {t('common.save', { defaultValue: 'Enregistrer' })}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
