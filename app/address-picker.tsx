import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  TextInput, Platform, StyleSheet, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, Home, Briefcase, Plus, ChevronLeft, Check, Trash2, Edit3, Navigation, AlertTriangle } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { EditIcon8, DeleteIcon8 } from '@/src/components/ui/Icon8';
import { useAddressStore, type SavedAddress } from '@/src/stores/addressStore';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { searchAddresses, reverseGeocode } from '@/src/services/geocoding';

let MapView: any = null;
let Marker: any = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
}

const QUICK_LABELS = ['home', 'work'] as const;

type Step = 'list' | 'map' | 'form' | 'edit';

export default function AddressPickerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { addresses, selectedId, addAddress, updateAddress, removeAddress, selectAddress } = useAddressStore();

  const [step, setStep] = useState<Step>('list');
  const [pendingRegion, setPendingRegion] = useState({ lat: 36.8065, lng: 10.1815 });
  const mapRef = useRef<any>(null);

  const goToCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setPendingRegion(coords);
      mapRef.current?.animateToRegion({ latitude: coords.lat, longitude: coords.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 600);
      // The map's onRegionChangeComplete will fire after the animation lands
      // and trigger fetchReverseGeocode automatically — no need to call it
      // here too.
    } catch {}
  };
  const [labelInput, setLabelInput] = useState('');
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);
  // Address pending-delete: stored as the full object so the modal can show its label
  const [addressPendingDelete, setAddressPendingDelete] = useState<SavedAddress | null>(null);

  // Default: show map of the currently selected address
  const selectedAddress = addresses.find((a) => a.id === selectedId) ?? null;

  const reset = () => {
    setStep('list');
    setLabelInput('');
    setEditingAddress(null);
    setReverseGeocodedName('');
    // Re-arm auto-fill for the next session. Without this, after the user
    // typed a custom label once and went back to the list, the next "add
    // address" session would inherit the no-auto-fill state and never show
    // the resolved address.
    labelAutoFilledRef.current = true;
  };

  const handleBack = () => {
    if (step === 'form') { setStep('map'); return; }
    if (step === 'map') { reset(); return; }
    if (step === 'edit') { reset(); return; }
    router.back();
  };

  const handleSelectAddress = (addr: SavedAddress) => {
    selectAddress(addr.id);
  };

  const handleEditAddress = (addr: SavedAddress) => {
    setEditingAddress(addr);
    setPendingRegion({ lat: addr.lat, lng: addr.lng });
    setLabelInput(addr.label);
    setStep('edit');
    // The label was user-supplied last time, so don't overwrite it as the
    // user pans the map. They can clear the field to opt back into auto.
    labelAutoFilledRef.current = false;
    // Pre-fetch the resolved address for the existing pin so the tooltip
    // under the pin shows what's there.
    fetchReverseGeocode(addr.lat, addr.lng);
  };

  const handleEditConfirm = () => {
    if (editingAddress) {
      const trimmed = labelInput.trim();
      void updateAddress(editingAddress.id, {
        lat: pendingRegion.lat,
        lng: pendingRegion.lng,
        label: trimmed || editingAddress.label,
      });
    }
    reset();
  };

  const handleMapConfirm = () => {
    // If the user typed/picked a label earlier but has since panned the pin
    // far enough that the label is no longer about the same place, auto-
    // accept the freshly resolved name so the saved entry matches the pin.
    // 200 m is roughly the spread of a neighbourhood block — beyond that, a
    // typed search term is almost certainly stale.
    const source = labelSourceCoordsRef.current;
    const STALE_THRESHOLD_M = 200;
    const isStale = source != null && haversineMeters(source, pendingRegion) > STALE_THRESHOLD_M;
    if (reverseGeocodedName && (labelInput.trim().length === 0 || isStale)) {
      setLabelInput(reverseGeocodedName);
      labelSourceCoordsRef.current = { ...pendingRegion };
    }
    setStep('form');
  };

  const handleFormSave = () => {
    const label = labelInput.trim() || t('addressPicker.defaultLabel', { defaultValue: 'Mon adresse' });
    void addAddress({ label, lat: pendingRegion.lat, lng: pendingRegion.lng });
    reset();
  };

  // Address text search — handled by the shared geocoding module: device
  // native geocoder first (Apple/Google, far better Tunisian POI coverage),
  // Nominatim fallback. 400 ms debounce.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchLocation = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!text.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      const hits = await searchAddresses(text);
      setSearchResults(hits);
    }, 400);
  };

  // ── Reverse geocoding on pin move ─────────────────────────────────────
  // When the user drags the map to a new spot, fetch the address for the
  // pin coordinates and (a) show it under the pin so they know what they're
  // pointing at, (b) pre-fill the address-label field in the form step so
  // the saved address text matches the actual pin position instead of being
  // an unrelated leftover from a previous search.
  const [reverseGeocodedName, setReverseGeocodedName] = useState<string>('');
  const reverseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the label field still reflects an auto-fill — we replace it
  // on every successful reverse-geocode. Once the user types into the label
  // field themselves we stop overwriting so we don't clobber their input.
  const labelAutoFilledRef = useRef(true);
  // Coords where the current labelInput was last set from a search hit or
  // suggestion. Used by the form-step auto-accept logic: if the user pans
  // far from this point before confirming, the label is stale.
  const labelSourceCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const fetchReverseGeocode = (lat: number, lng: number) => {
    if (reverseTimeout.current) clearTimeout(reverseTimeout.current);
    reverseTimeout.current = setTimeout(async () => {
      const formatted = await reverseGeocode(lat, lng);
      if (!formatted) return;
      // Always update the chip — it's the user's only signal that the pin
      // moved, and gating it on labelAutoFilledRef previously meant typed
      // labels would freeze the chip.
      setReverseGeocodedName(formatted);
      // Only auto-fill the label field if the user hasn't supplied custom
      // text — otherwise they'd lose what they typed mid-pan.
      if (labelAutoFilledRef.current) {
        setLabelInput(formatted);
      }
    }, 500);
  };

  // Approx great-circle distance (m). Used to decide whether the typed label
  // is "stale" relative to the current pin before saving.
  const haversineMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const title =
    step === 'list' ? t('addressPicker.title')
    : step === 'map' ? t('addressPicker.chooseLocation')
    : step === 'edit' ? t('addressPicker.editLocation')
    : t('addressPicker.labelPlace');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[theme.typography.h2, { color: theme.colors.textPrimary, flex: 1, marginLeft: 12 }]}>
          {title}
        </Text>
      </View>

      {/* ── Step: Address List ──────────────────────────────── */}
      {step === 'list' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48, paddingTop: 16 }}>
          {/* Map preview for selected address — shown by default */}
          {selectedAddress && (
            <View style={[styles.mapPreview, { borderRadius: theme.radii.r16, overflow: 'hidden', ...theme.shadows.shadowSm, marginBottom: 20 }]}>
              {MapView && Platform.OS !== 'web' ? (
                <MapView
                  style={{ width: '100%', height: 200 }}
                  region={{
                    latitude: selectedAddress.lat,
                    longitude: selectedAddress.lng,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                  }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  pitchEnabled={false}
                  rotateEnabled={false}
                >
                  {Marker && (
                    <Marker
                      coordinate={{ latitude: selectedAddress.lat, longitude: selectedAddress.lng }}
                    />
                  )}
                </MapView>
              ) : (
                <View style={{ width: '100%', height: 200, backgroundColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' }}>
                  <MapPin size={32} color={theme.colors.muted} />
                  <Text style={[theme.typography.bodySm, { color: theme.colors.muted, marginTop: 8 }]}>
                    {selectedAddress.label}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 4 }]}>
                    {selectedAddress.lat.toFixed(4)}, {selectedAddress.lng.toFixed(4)}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Add new button */}
          <TouchableOpacity
            onPress={() => setStep('map')}
            style={[styles.addBtn, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, ...theme.shadows.shadowSm }]}
          >
            <View style={[styles.addBtnIcon, { backgroundColor: theme.colors.primary + '18', borderRadius: 8 }]}>
              <Plus size={18} color={theme.colors.primary} />
            </View>
            <Text style={[theme.typography.body, { color: theme.colors.primary, fontWeight: '600' as const }]}>
              {t('addressPicker.addNew')}
            </Text>
          </TouchableOpacity>

          {/* Saved addresses list */}
          {addresses.length > 0 && (
            <>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, fontWeight: '600' as const, marginBottom: 8, letterSpacing: 0.5, textTransform: 'none' as const }]}>
                {t('addressPicker.savedAddresses')}
              </Text>
              {addresses.map((addr) => {
                const isSelected = addr.id === selectedId;
                const labelLower = addr.label.toLowerCase();
                const Icon = labelLower === 'home' ? Home : labelLower === 'work' ? Briefcase : MapPin;
                return (
                  <TouchableOpacity
                    key={addr.id}
                    onPress={() => handleSelectAddress(addr)}
                    style={[styles.addrRow, { borderBottomColor: theme.colors.divider, backgroundColor: isSelected ? theme.colors.primary + '15' : 'transparent', borderRadius: 12, borderWidth: isSelected ? 1.5 : 0, borderColor: isSelected ? theme.colors.primary + '40' : 'transparent', marginBottom: 4, paddingHorizontal: 12 }]}
                  >
                    <Icon size={20} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <Text
                        style={[
                          theme.typography.body,
                          { color: theme.colors.textPrimary, fontWeight: isSelected ? ('600' as const) : ('400' as const) },
                        ]}
                        numberOfLines={1}
                      >
                        {addr.label}
                      </Text>
                      {/* Show coordinates as address detail */}
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>
                        {addr.lat.toFixed(4)}, {addr.lng.toFixed(4)}
                      </Text>
                    </View>
                    {isSelected && <Check size={18} color={theme.colors.primary} />}
                    {/* Edit button */}
                    <TouchableOpacity
                      onPress={() => handleEditAddress(addr)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{ marginLeft: 10 }}
                    >
                      <EditIcon8 size={16} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setAddressPendingDelete(addr)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{ marginLeft: 10 }}
                    >
                      <DeleteIcon8 size={16} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      )}

      {/* ── Step: Map Pin Picker (new address) ─────────────── */}
      {step === 'map' && (
        <View style={{ flex: 1 }}>
          {/* Search bar */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.colors.bg, zIndex: 10 }}>
            <TextInput
              value={searchQuery}
              onChangeText={handleSearchLocation}
              placeholder={t('addressPicker.searchPlace', { defaultValue: 'Rechercher une adresse ou un lieu...' })}
              placeholderTextColor={theme.colors.muted}
              style={{ height: 42, backgroundColor: theme.colors.surface, borderRadius: 12, paddingHorizontal: 14, color: theme.colors.textPrimary, ...theme.typography.bodySm, borderWidth: 1, borderColor: theme.colors.divider }}
            />
            {searchResults.length > 0 && (
              <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, marginTop: 6, borderWidth: 1, borderColor: theme.colors.divider, overflow: 'hidden' }}>
                {searchResults.map((r, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => {
                      setPendingRegion({ lat: r.lat, lng: r.lng });
                      mapRef.current?.animateToRegion({ latitude: r.lat, longitude: r.lng, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 400);
                      setSearchQuery('');
                      setSearchResults([]);
                      // Use the suggestion text as the resolved name and
                      // record the coords so handleMapConfirm can detect a
                      // pan-drift later. The onRegionChangeComplete then
                      // refines it with a cleaner road/suburb tuple.
                      setReverseGeocodedName(r.name);
                      if (labelAutoFilledRef.current) setLabelInput(r.name);
                      labelSourceCoordsRef.current = { lat: r.lat, lng: r.lng };
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.colors.divider }}
                  >
                    <MapPin size={14} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 10, flex: 1 }} numberOfLines={2}>{r.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            {MapView && Platform.OS !== 'web' ? (
              <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                initialRegion={{
                  latitude: 36.8065,
                  longitude: 10.1815,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                onRegionChangeComplete={(region: any) => {
                  setPendingRegion({ lat: region.latitude, lng: region.longitude });
                  fetchReverseGeocode(region.latitude, region.longitude);
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

            {/* Fixed center pin */}
            <View style={styles.centerPin} pointerEvents="none">
              <View style={[styles.pinDot, { backgroundColor: theme.colors.primary }]} />
              <View style={[styles.pinStem, { backgroundColor: theme.colors.primary }]} />
            </View>

            {/* Instruction tooltip */}
            <View style={[styles.tooltip, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
              <MapPin size={14} color="#fff" />
              <Text style={[theme.typography.caption, { color: '#fff', marginLeft: 6 }]}>
                {t('addressPicker.dragToMove', { defaultValue: 'Move the map to position the pin' })}
              </Text>
            </View>
            {/* Resolved address — what the pin currently points at, fetched
                via reverse geocode ~500 ms after the pin settles. Display
                only; the Confirm button below carries this name into the
                form step (handleMapConfirm auto-accepts it). */}
            {reverseGeocodedName ? (
              <View style={[styles.resolvedAddress, { backgroundColor: 'rgba(255,255,255,0.95)' }]}>
                <MapPin size={14} color={theme.colors.primary} />
                <Text style={[theme.typography.caption, { color: theme.colors.textPrimary, marginLeft: 6, flex: 1 }]} numberOfLines={2}>
                  {reverseGeocodedName}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.mapFooter, { backgroundColor: theme.colors.bg, gap: 10 }]}>
            <TouchableOpacity
              onPress={goToCurrentLocation}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: theme.radii.r16, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }}
            >
              <Navigation size={14} color={theme.colors.primary} />
              <Text style={[theme.typography.bodySm, { color: theme.colors.primary, fontWeight: '600' }]}>{t('addressPicker.useCurrentLocation', { defaultValue: 'Utiliser ma position actuelle' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleMapConfirm}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16 }]}
            >
              <Text style={[theme.typography.button, { color: '#fff' }]}>{t('addressPicker.confirmLocation')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Step: Edit existing address location ────────────── */}
      {step === 'edit' && editingAddress && (
        <View style={{ flex: 1 }}>
          {/* Search bar */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.colors.bg, zIndex: 10 }}>
            <TextInput
              value={searchQuery}
              onChangeText={handleSearchLocation}
              placeholder={t('addressPicker.searchPlace', { defaultValue: 'Rechercher une adresse ou un lieu...' })}
              placeholderTextColor={theme.colors.muted}
              style={{ height: 42, backgroundColor: theme.colors.surface, borderRadius: 12, paddingHorizontal: 14, color: theme.colors.textPrimary, ...theme.typography.bodySm, borderWidth: 1, borderColor: theme.colors.divider }}
            />
            {searchResults.length > 0 && (
              <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, marginTop: 6, borderWidth: 1, borderColor: theme.colors.divider, overflow: 'hidden' }}>
                {searchResults.map((r, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => {
                      setPendingRegion({ lat: r.lat, lng: r.lng });
                      mapRef.current?.animateToRegion({ latitude: r.lat, longitude: r.lng, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 400);
                      setSearchQuery('');
                      setSearchResults([]);
                      // Use the suggestion text as the resolved name and
                      // record the coords so handleMapConfirm can detect a
                      // pan-drift later. The onRegionChangeComplete then
                      // refines it with a cleaner road/suburb tuple.
                      setReverseGeocodedName(r.name);
                      if (labelAutoFilledRef.current) setLabelInput(r.name);
                      labelSourceCoordsRef.current = { lat: r.lat, lng: r.lng };
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: theme.colors.divider }}
                  >
                    <MapPin size={14} color={theme.colors.primary} />
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 10, flex: 1 }} numberOfLines={2}>{r.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            {MapView && Platform.OS !== 'web' ? (
              <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                initialRegion={{
                  latitude: editingAddress.lat,
                  longitude: editingAddress.lng,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                onRegionChangeComplete={(region: any) => {
                  setPendingRegion({ lat: region.latitude, lng: region.longitude });
                  fetchReverseGeocode(region.latitude, region.longitude);
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

            {/* Fixed center pin */}
            <View style={styles.centerPin} pointerEvents="none">
              <View style={[styles.pinDot, { backgroundColor: theme.colors.primary }]} />
              <View style={[styles.pinStem, { backgroundColor: theme.colors.primary }]} />
            </View>

            {/* Editing label */}
            <View style={[styles.tooltip, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
              <EditIcon8 size={14} tintColor="#fff" />
              <Text style={[theme.typography.caption, { color: '#fff', marginLeft: 6 }]}>
                {t('addressPicker.editLocation')}
              </Text>
            </View>
            {reverseGeocodedName ? (
              <View style={[styles.resolvedAddress, { backgroundColor: 'rgba(255,255,255,0.95)' }]}>
                <MapPin size={14} color={theme.colors.primary} />
                <Text style={[theme.typography.caption, { color: theme.colors.textPrimary, marginLeft: 6, flex: 1 }]} numberOfLines={2}>
                  {reverseGeocodedName}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.mapFooter, { backgroundColor: theme.colors.bg, gap: 10 }]}>
            {/* Editable label — lets the user rename "Maman" → "Travail" etc. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: theme.colors.divider }}>
              <EditIcon8 size={14} />
              <TextInput
                value={labelInput}
                onChangeText={(v) => {
                  labelAutoFilledRef.current = false;
                  setLabelInput(v);
                }}
                placeholder={editingAddress.label}
                placeholderTextColor={theme.colors.muted}
                style={{ flex: 1, color: theme.colors.textPrimary, ...theme.typography.bodySm }}
                maxLength={40}
              />
            </View>
            <TouchableOpacity
              onPress={goToCurrentLocation}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: theme.radii.r16, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }}
            >
              <Navigation size={14} color={theme.colors.primary} />
              <Text style={[theme.typography.bodySm, { color: theme.colors.primary, fontWeight: '600' }]}>{t('addressPicker.useCurrentLocation', { defaultValue: 'Utiliser ma position actuelle' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleEditConfirm}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16 }]}
            >
              <Text style={[theme.typography.button, { color: '#fff' }]}>{t('addressPicker.confirmLocation')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Step: Label Form ──────────────────────────────── */}
      {step === 'form' && (
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16 }}>
          {/* Detected address suggestion — shown when reverse-geocode found a
              name AND the user hasn't already overridden the label. One tap
              accepts the detected text as the saved label, so users don't
              have to retype what the pin already resolved to. They can still
              ignore this and use a quick label or type a custom name below. */}
          {reverseGeocodedName && reverseGeocodedName !== labelInput ? (
            <TouchableOpacity
              onPress={() => {
                labelAutoFilledRef.current = false;
                setLabelInput(reverseGeocodedName);
              }}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: theme.colors.primary + '0F',
                borderColor: theme.colors.primary + '44',
                borderWidth: 1,
                borderRadius: theme.radii.r12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 12,
              }}
            >
              <MapPin size={16} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_500Medium', letterSpacing: 0.5, textTransform: 'none' as const }}>
                  {t('addressPicker.detectedLabel', { defaultValue: 'Adresse détectée' })}
                </Text>
                <Text style={[theme.typography.bodySm, { color: theme.colors.textPrimary, marginTop: 1 }]} numberOfLines={2}>
                  {reverseGeocodedName}
                </Text>
              </View>
              <View style={{ backgroundColor: theme.colors.primary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radii.pill }}>
                <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Poppins_600SemiBold' }}>
                  {t('addressPicker.useDetected', { defaultValue: 'Utiliser' })}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {/* Quick label chips */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {QUICK_LABELS.map((ql) => {
              const QIcon = ql === 'home' ? Home : Briefcase;
              const qlLabel = t(`addressPicker.label_${ql}`, { defaultValue: ql === 'home' ? 'Maison' : 'Travail' });
              const isActive = labelInput === qlLabel;
              return (
                <TouchableOpacity
                  key={ql}
                  onPress={() => {
                    labelAutoFilledRef.current = false;
                    setLabelInput(qlLabel);
                  }}
                  style={[
                    styles.quickChip,
                    {
                      borderColor: isActive ? theme.colors.primary : theme.colors.divider,
                      backgroundColor: isActive ? theme.colors.primary + '12' : 'transparent',
                      borderRadius: theme.radii.pill,
                    },
                  ]}
                >
                  <QIcon size={14} color={isActive ? theme.colors.primary : theme.colors.textSecondary} />
                  <Text style={[theme.typography.bodySm, { color: isActive ? theme.colors.primary : theme.colors.textPrimary, fontWeight: '600' as const, marginLeft: 5 }]}>
                    {qlLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Custom label input */}
          <TextInput
            style={[
              theme.typography.body,
              {
                color: theme.colors.textPrimary,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r12,
                padding: 14,
                marginBottom: 24,
                borderWidth: 1,
                borderColor: theme.colors.divider,
              },
            ]}
            placeholder={t('addressPicker.customNamePlaceholder', { defaultValue: 'Ou entrez un nom personnalisé...' })}
            placeholderTextColor={theme.colors.muted}
            value={labelInput}
            onChangeText={(v) => {
              labelAutoFilledRef.current = false;
              setLabelInput(v);
            }}
          />

          <TouchableOpacity
            onPress={handleFormSave}
            style={[styles.confirmBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16 }]}
          >
            <Text style={[theme.typography.button, { color: '#fff' }]}>{t('addressPicker.saveAddress')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Delete-address confirmation — extra guard so a misplaced tap on the trash
          icon doesn't silently remove a saved location. */}
      <Modal
        visible={addressPendingDelete !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAddressPendingDelete(null)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <PaperSurface radius={20} style={{ padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: theme.colors.surfaceMuted, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Trash2 size={26} color={theme.colors.textSecondary} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('addressPicker.deleteConfirmTitle', { defaultValue: 'Supprimer cette adresse ?' })}
            </Text>
            {addressPendingDelete && (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', marginBottom: 8 }}>
                <Text style={{ fontWeight: '700' }}>{addressPendingDelete.label}</Text>
              </Text>
            )}
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
              {t('addressPicker.deleteIrreversible', { defaultValue: 'Cette action est irréversible.' })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={() => setAddressPendingDelete(null)}
                style={{ flex: 1, backgroundColor: theme.colors.bg, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>
                  {t('common.cancel', { defaultValue: 'Annuler' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const id = addressPendingDelete?.id;
                  setAddressPendingDelete(null);
                  if (id) void removeAddress(id);
                }}
                style={{ flex: 1, backgroundColor: theme.colors.error, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                  {t('common.delete', { defaultValue: 'Supprimer' })}
                </Text>
              </TouchableOpacity>
            </View>
          </PaperSurface>
        </View>
      </Modal>
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
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  mapPreview: {
    backgroundColor: '#f0f0f0',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginBottom: 20,
  },
  addBtnIcon: {
    padding: 8,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  centerPin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    alignItems: 'center',
    marginLeft: -8,
    marginTop: -30,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  pinStem: {
    width: 2,
    height: 14,
  },
  tooltip: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  // Resolved-address chip — pinned just above the bottom action area so it
  // doesn't overlap the centered pin. Light background for readability over
  // map imagery.
  resolvedAddress: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  mapFooter: {
    padding: 20,
  },
  confirmBtn: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
