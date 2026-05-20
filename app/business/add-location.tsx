import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ShieldCheck, XCircle, CheckCircle2 } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addLocation, fetchMyContext } from '@/src/services/teams';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { LocationFormFields, type LocationFormValue } from '@/src/components/LocationFormFields';

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

  const contextQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 60_000 });
  const orgId = contextQuery.data?.organization_id ?? null;

  const toTime = (hhmm: string) =>
    hhmm && hhmm.includes(':') && hhmm.split(':').length === 2 ? `${hhmm}:00` : (hhmm || undefined);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error(t('business.team.noOrganization', { defaultValue: "Aucune organisation trouvée. Veuillez d'abord créer une organisation." }));
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      setSuccessMsg(t('business.team.locationAdded', { defaultValue: 'Emplacement ajouté avec succès.' }));
    },
    onError: (err) => {
      setErrorMsg(getErrorMessage(err));
    },
  });

  const canSubmit = form.name.trim() && (form.address.trim() || form.coords) && form.category;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[theme.typography.h2, { color: theme.colors.textPrimary, flex: 1, marginLeft: 12 }]}>
          {t('business.team.addLocation', { defaultValue: 'Ajouter un emplacement' })}
        </Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: 20 }}>
            {t('business.team.addLocationDesc', { defaultValue: 'Ajoutez un nouvel emplacement pour votre organisation.' })}
          </Text>

          <LocationFormFields
            value={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
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
              backgroundColor: canSubmit ? '#114b3c' : theme.colors.muted,
              borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24,
            }}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#e3ff5c" />
            ) : (
              <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 16 }}>
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
              <XCircle size={28} color="#ef4444" />
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
