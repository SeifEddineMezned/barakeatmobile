import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, Platform, StyleSheet, ScrollView, ActivityIndicator, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, MapPin, ShieldCheck, Navigation, XCircle, CheckCircle2, Search } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addLocation, fetchMyContext } from '@/src/services/teams';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';

let MapView: any = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
}

const CATEGORIES = ['bakery', 'restaurant', 'grocery', 'cafe', 'supermarket'] as const;

// ── Nominatim address suggestion type ────────────────────────────────────────
interface AddressSuggestion {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

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

  // Search / suggestions
  const [addressSearch, setAddressSearch] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<any>(null);

  // Custom modal states (no native Alert)
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [addressExpanded, setAddressExpanded] = useState(false);

  // Resolve orgId from team context API (same as team.tsx)
  const contextQuery = useQuery({ queryKey: ['team-context'], queryFn: fetchMyContext, staleTime: 60_000 });
  const orgId = contextQuery.data?.organization_id ?? null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error(t('business.team.noOrganization', { defaultValue: 'Aucune organisation trouvée. Veuillez d\'abord créer une organisation.' }));
      return addLocation(orgId, {
        name: name.trim() || undefined,
        address: address.trim() || undefined,
        category: category || undefined,
        ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
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

  // ── Nominatim autocomplete ─────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) { setSuggestions([]); return; }
    setSearching(true);
    try {
      // Bias results toward Tunisia with viewbox but don't strictly limit (bounded=0)
      // so users can still find results elsewhere if needed
      const params = new URLSearchParams({
        format: 'json',
        q: query,
        limit: '8',
        addressdetails: '1',
        viewbox: '7.5,30.2,11.6,37.5', // Tunisia bounding box
        bounded: '0',
        'accept-language': 'fr',
      });
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      const data: AddressSuggestion[] = await resp.json();
      setSuggestions(data);
    } catch {
      setSuggestions([]);
    }
    setSearching(false);
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setAddressSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSuggestions(text), 300);
  }, [fetchSuggestions]);

  const handleSelectSuggestion = useCallback((item: AddressSuggestion) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    setAddressSearch(item.display_name);
    setSuggestions([]);
    setPendingRegion({ lat, lng });
    mapRef.current?.animateToRegion({
      latitude: lat, longitude: lng,
      latitudeDelta: 0.005, longitudeDelta: 0.005,
    }, 600);
  }, []);

  const handleMapConfirm = () => {
    setCoords(pendingRegion);
    setAddress(addressSearch.trim() || `${pendingRegion.lat.toFixed(5)}, ${pendingRegion.lng.toFixed(5)}`);
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
          {/* Search bar with autocomplete */}
          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: suggestions.length > 0 ? 0 : 10, backgroundColor: theme.colors.bg, borderBottomWidth: suggestions.length > 0 ? 0 : 1, borderBottomColor: theme.colors.divider, zIndex: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, paddingHorizontal: 12 }}>
                <Search size={16} color={theme.colors.muted} />
                <TextInput
                  style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 14, color: theme.colors.textPrimary }}
                  value={addressSearch}
                  onChangeText={handleSearchChange}
                  placeholder={t('business.team.searchAddress', { defaultValue: 'Rechercher une adresse...' })}
                  placeholderTextColor={theme.colors.muted}
                  returnKeyType="search"
                  autoCorrect={false}
                />
                {searching && <ActivityIndicator size="small" color={theme.colors.muted} />}
              </View>
            </View>
            {/* Suggestions dropdown */}
            {suggestions.length > 0 && (
              <ScrollView
                style={{ maxHeight: 260, backgroundColor: theme.colors.surface, borderRadius: 12, marginTop: 6, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.divider }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {suggestions.map((item, idx) => (
                  <TouchableOpacity
                    key={item.place_id}
                    onPress={() => handleSelectSuggestion(item)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: theme.colors.divider }}
                  >
                    <MapPin size={14} color="#114b3c" style={{ marginRight: 10, flexShrink: 0 }} />
                    <Text style={{ color: theme.colors.textPrimary, fontSize: 13, flex: 1, lineHeight: 18 }} numberOfLines={2}>
                      {item.display_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={{ flex: 1 }}>
            {MapView && Platform.OS !== 'web' ? (
              <MapView
                ref={mapRef}
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
              <View style={[styles.pinDot, { backgroundColor: '#e3ff5c', justifyContent: 'center', alignItems: 'center' }]}>
                <MapPin size={10} color="#114b3c" />
              </View>
              <View style={[styles.pinStem, { backgroundColor: '#e3ff5c' }]} />
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
                  const newRegion = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                  setPendingRegion(newRegion);
                  mapRef.current?.animateToRegion({
                    latitude: newRegion.lat, longitude: newRegion.lng,
                    latitudeDelta: 0.005, longitudeDelta: 0.005,
                  }, 600);
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
            <MapPin size={16} color={coords ? '#114b3c' : theme.colors.muted} style={{ flexShrink: 0 }} />
            {!coords ? (
              <Text style={{ color: theme.colors.muted, ...theme.typography.body, flex: 1, marginLeft: 10 }} numberOfLines={1}>
                {t('business.team.tapToSelectLocation', { defaultValue: 'Appuyez pour choisir sur la carte' })}
              </Text>
            ) : (
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, flex: 1, marginLeft: 10 }} numberOfLines={1}>
                {t('business.team.changeLocation', { defaultValue: 'Modifier l\'emplacement' })}
              </Text>
            )}
          </TouchableOpacity>
          {coords ? (
            <View style={{ marginTop: 6 }}>
              <TextInput
                style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, lineHeight: 20, backgroundColor: theme.colors.surface, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.divider, padding: 10, minHeight: 40 }}
                value={address}
                onChangeText={setAddress}
                placeholder={t('business.team.editAddressText', { defaultValue: 'Adresse affichée aux clients...' })}
                placeholderTextColor={theme.colors.muted}
                multiline
              />
              <Text style={{ color: theme.colors.muted, fontSize: 10, marginTop: 3 }}>
                {t('business.team.editAddressHint', { defaultValue: 'Modifiez le texte si besoin. Les coordonnées restent inchangées.' })}
              </Text>
            </View>
          ) : null}
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

      {/* Error modal */}
      <Modal visible={!!errorMsg} transparent animationType="fade" onRequestClose={() => setErrorMsg(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <XCircle size={28} color="#ef4444" />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('auth.error')}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {errorMsg}
            </Text>
            <TouchableOpacity
              onPress={() => setErrorMsg(null)}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>OK</Text>
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
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {t('common.success', { defaultValue: 'Succès' })}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {successMsg}
            </Text>
            <TouchableOpacity
              onPress={() => { setSuccessMsg(null); router.back(); }}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
