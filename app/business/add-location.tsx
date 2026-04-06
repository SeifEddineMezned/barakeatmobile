import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Platform, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, MapPin, ShieldCheck, Navigation } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addLocation } from '@/src/services/teams';
import { useBusinessStore } from '@/src/stores/businessStore';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';

let MapView: any = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
}

const CATEGORIES = ['bakery', 'restaurant', 'grocery', 'cafe', 'pastry', 'supermarket'] as const;

export default function AddLocationScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'form' | 'map'>('form');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [category, setCategory] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pendingRegion, setPendingRegion] = useState<{ lat: number; lng: number }>({ lat: 36.8065, lng: 10.1815 });

  // Resolve orgId from business store context
  const orgId = useBusinessStore((s) => (s as any).organizationId) ?? null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No organization');
      return addLocation(orgId, {
        name: name.trim() || undefined,
        address: address.trim() || undefined,
        category: category || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      Alert.alert(
        t('common.success'),
        t('business.team.locationAdded', { defaultValue: 'Emplacement ajouté avec succès.' }),
        [{ text: 'OK', onPress: () => router.back() }]
      );
    },
    onError: (err) => {
      Alert.alert(t('common.error'), getErrorMessage(err));
    },
  });

  const handleMapConfirm = () => {
    setCoords(pendingRegion);
    setAddress(`${pendingRegion.lat.toFixed(5)}, ${pendingRegion.lng.toFixed(5)}`);
    setStep('form');
  };

  const canSubmit = name.trim() && (address.trim() || coords);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={() => step === 'map' ? setStep('form') : router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[theme.typography.h2, { color: theme.colors.textPrimary, flex: 1, marginLeft: 12 }]}>
          {step === 'map'
            ? t('addressPicker.chooseLocation', { defaultValue: 'Choisir l\'emplacement' })
            : t('business.team.addLocation', { defaultValue: 'Ajouter un emplacement' })}
        </Text>
      </View>

      {step === 'map' ? (
        /* ── Map Step ─────────────────────────────────────────── */
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {MapView && Platform.OS !== 'web' ? (
              <MapView
                style={StyleSheet.absoluteFillObject}
                initialRegion={{
                  latitude: coords?.lat ?? 36.8065,
                  longitude: coords?.lng ?? 10.1815,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                onRegionChangeComplete={(region: any) => {
                  setPendingRegion({ lat: region.latitude, lng: region.longitude });
                }}
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' }]}>
                <MapPin size={32} color={theme.colors.muted} />
                <Text style={[theme.typography.bodySm, { color: theme.colors.muted, marginTop: 8 }]}>
                  {t('addressPicker.mapUnavailable', { defaultValue: 'Carte non disponible' })}
                </Text>
              </View>
            )}

            {/* Center pin */}
            <View style={styles.centerPin} pointerEvents="none">
              <View style={[styles.pinDot, { backgroundColor: '#114b3c' }]} />
              <View style={[styles.pinStem, { backgroundColor: '#114b3c' }]} />
            </View>

            {/* Instruction */}
            <View style={[styles.tooltip, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
              <MapPin size={14} color="#fff" />
              <Text style={[theme.typography.caption, { color: '#fff', marginLeft: 6 }]}>
                {t('addressPicker.dragToMove', { defaultValue: 'Déplacez la carte pour positionner le repère' })}
              </Text>
            </View>
          </View>

          <View style={{ backgroundColor: theme.colors.bg, padding: 20, gap: 10 }}>
            <TouchableOpacity
              onPress={async () => {
                try {
                  const { status } = await Location.requestForegroundPermissionsAsync();
                  if (status !== 'granted') return;
                  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                  setPendingRegion({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                } catch {}
              }}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }}
            >
              <Navigation size={14} color="#114b3c" />
              <Text style={{ color: '#114b3c', fontSize: 14, fontWeight: '600' }}>{t('addressPicker.useCurrentLocation', { defaultValue: 'Utiliser ma position actuelle' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleMapConfirm}
              style={{ backgroundColor: '#114b3c', borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
            >
              <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 16 }}>
                {t('addressPicker.confirmLocation', { defaultValue: 'Confirmer l\'emplacement' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* ── Form Step ────────────────────────────────────────── */
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Description */}
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, lineHeight: 20, marginBottom: 20 }}>
            {t('business.team.addLocationDesc', { defaultValue: 'Ajoutez un nouvel emplacement pour votre organisation. Les informations seront vérifiées par notre équipe.' })}
          </Text>

          {/* Name */}
          <Text style={styles.sectionLabel}>
            {t('business.team.locationName', { defaultValue: 'Nom' })} *
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, color: theme.colors.textPrimary }]}
            value={name}
            onChangeText={setName}
            placeholder={t('business.team.locationNamePlaceholder', { defaultValue: 'Ex: Succursale Centre-Ville' })}
            placeholderTextColor={theme.colors.muted}
            autoCapitalize="words"
          />

          {/* Address — tap to open map */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
            {t('business.team.locationAddress', { defaultValue: 'Adresse' })} *
          </Text>
          <TouchableOpacity
            onPress={() => setStep('map')}
            style={[styles.input, styles.mapButton, { backgroundColor: theme.colors.surface, borderColor: coords ? '#114b3c40' : theme.colors.divider }]}
          >
            <MapPin size={16} color={coords ? '#114b3c' : theme.colors.muted} />
            <Text style={{ color: coords ? theme.colors.textPrimary : theme.colors.muted, ...theme.typography.body, flex: 1, marginLeft: 10 }} numberOfLines={1}>
              {coords ? address : t('business.team.tapToSelectLocation', { defaultValue: 'Appuyez pour choisir sur la carte' })}
            </Text>
          </TouchableOpacity>
          {coords && (
            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 4 }}>
              {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
            </Text>
          )}

          {/* Category */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
            {t('business.profile.category', { defaultValue: 'Catégorie' })}
          </Text>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, overflow: 'hidden', marginTop: 4 }}>
            {CATEGORIES.map((cat, idx) => {
              const isActive = category === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setCategory(isActive ? '' : cat)}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 14, paddingVertical: 11,
                    borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: theme.colors.divider,
                    backgroundColor: isActive ? '#114b3c10' : 'transparent',
                  }}
                >
                  <View style={{
                    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
                    borderColor: isActive ? '#114b3c' : theme.colors.muted,
                    backgroundColor: isActive ? '#114b3c' : 'transparent',
                    justifyContent: 'center', alignItems: 'center', marginRight: 10,
                  }}>
                    {isActive && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />}
                  </View>
                  <Text style={{ color: isActive ? '#114b3c' : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: isActive ? '600' : '400' }}>
                    {t(`categories.${cat}`, { defaultValue: cat })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Admin approval note — only when approval is required */}
          {FeatureFlags.REQUIRE_LOCATION_APPROVAL && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#114b3c08', borderRadius: 12, padding: 12, marginTop: 20, gap: 8 }}>
            <ShieldCheck size={16} color="#114b3c" style={{ marginTop: 1 }} />
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1, lineHeight: 17 }}>
              {t('business.team.adminApprovalNote', { defaultValue: 'L\'ajout de ce nouvel emplacement sera soumis à validation par notre équipe admin.' })}
            </Text>
          </View>
          )}

          {/* Submit */}
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
                  : t('business.team.addLocationBtn', { defaultValue: 'Ajouter l\'emplacement' })}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sectionLabel: {
    color: '#114b3c', fontSize: 13, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  input: {
    borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15,
  },
  mapButton: {
    flexDirection: 'row', alignItems: 'center',
  },
  centerPin: {
    position: 'absolute', top: '50%', left: '50%',
    marginLeft: -8, marginTop: -32, alignItems: 'center',
  },
  pinDot: { width: 16, height: 16, borderRadius: 8 },
  pinStem: { width: 3, height: 20, marginTop: -2 },
  tooltip: {
    position: 'absolute', bottom: 20, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
});
