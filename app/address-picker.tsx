import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  TextInput, Platform, StyleSheet, Modal, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, Home, Briefcase, Plus, ChevronLeft, Check, Trash2, Edit3, Navigation, AlertTriangle } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { EditIcon8, DeleteIcon8 } from '@/src/components/ui/Icon8';
import { useAddressStore, type SavedAddress } from '@/src/stores/addressStore';
import { resolveAddressLabel, defaultAddressKey } from '@/src/utils/addressLabel';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { searchAddresses, reverseGeocode } from '@/src/services/geocoding';
import { useCustomAlert } from '@/src/components/CustomAlert';

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
  const customAlert = useCustomAlert();
  const { addresses, selectedId, addAddress, updateAddress, removeAddress, selectAddress } = useAddressStore();

  const [step, setStep] = useState<Step>('list');
  const [pendingRegion, setPendingRegion] = useState({ lat: 36.8065, lng: 10.1815 });
  const mapRef = useRef<any>(null);

  const goToCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Previously silent — the button felt broken. Surface a branded popup
        // that explains why and offers a one-tap route into iOS/Android
        // Settings to flip the permission.
        customAlert.showAlert(
          t('permissions.locationTitle', { defaultValue: 'Localisation désactivée' }),
          t('permissions.locationBody', { defaultValue: "Pour utiliser votre position actuelle, autorisez l'accès à la localisation dans les Réglages." }),
          [
            { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
            { text: t('permissions.openSettings', { defaultValue: 'Ouvrir les Réglages' }), onPress: () => Linking.openSettings() },
          ],
          { type: 'warning' },
        );
        return;
      }
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
  // Inline error on the name page (e.g. duplicate name). Cleared on edits.
  const [nameError, setNameError] = useState('');
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);
  // Address pending-delete: stored as the full object so the modal can show its label
  const [addressPendingDelete, setAddressPendingDelete] = useState<SavedAddress | null>(null);

  // Default: show map of the currently selected address
  const selectedAddress = addresses.find((a) => a.id === selectedId) ?? null;

  const reset = () => {
    setStep('list');
    setLabelInput('');
    setNameError('');
    setEditingAddress(null);
    setReverseGeocodedName('');
    // Re-arm auto-fill for the next session. Without this, after the user
    // typed a custom label once and went back to the list, the next "add
    // address" session would inherit the no-auto-fill state and never show
    // the resolved address.
    labelAutoFilledRef.current = true;
  };

  const handleBack = () => {
    // The name page (form) is step 2 of BOTH create (from map) and edit (from
    // the edit map) — go back to whichever page 1 we came from.
    if (step === 'form') { setStep(editingAddress ? 'edit' : 'map'); setNameError(''); return; }
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

  // Edit flow, page 1 (map) → page 2 (name). The name is NOT editable on the
  // map page anymore — the user confirms/changes it on the name page, exactly
  // like the create flow.
  const handleEditMapConfirm = () => {
    setNameError('');
    setStep('form');
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
    setNameError('');
    setStep('form');
  };

  // Save the name page — for create AND edit. Two addresses may not share a
  // name (case-insensitive), excluding the one being edited.
  const handleFormSave = () => {
    const label = labelInput.trim() || t('addressPicker.defaultLabel', { defaultValue: 'Mon adresse' });
    const duplicate = addresses.some(
      (a) => a.id !== editingAddress?.id && a.label.trim().toLowerCase() === label.toLowerCase()
    );
    if (duplicate) {
      setNameError(t('addressPicker.duplicateName', { defaultValue: 'Ce nom est déjà utilisé. Choisissez-en un autre.' }));
      return;
    }
    if (editingAddress) {
      void updateAddress(editingAddress.id, { lat: pendingRegion.lat, lng: pendingRegion.lng, label });
    } else {
      void addAddress({ label, lat: pendingRegion.lat, lng: pendingRegion.lng });
    }
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
    : (editingAddress
        ? t('addressPicker.confirmName', { defaultValue: 'Confirmer le nom' })
        : t('addressPicker.labelPlace'));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.divider, justifyContent: 'center', alignItems: 'center', minHeight: 48 }]}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ position: 'absolute', left: 16, top: 12 }}
        >
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        {/* pointerEvents="none" — title paints later than the absolute back
            button and would otherwise swallow taps over the icon. */}
        <Text pointerEvents="none" style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
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
                    {resolveAddressLabel(selectedAddress.label, t)}
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
                const dk = defaultAddressKey(addr.label);
                const Icon = dk === 'home' ? Home : dk === 'work' ? Briefcase : MapPin;
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
                        {resolveAddressLabel(addr.label, t)}
                      </Text>
                      {/* Show coordinates as address detail */}
                      <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 2 }]}>
                        {addr.lat.toFixed(4)}, {addr.lng.toFixed(4)}
                      </Text>
                    </View>
                    {/* Edit / Delete buttons — each in a 36 px round
                        chip so the icons read as proper tap targets
                        instead of bare glyphs. Icons themselves are
                        bumped to 22 px (was 16). The "selected"
                        Check that used to sit between row-text and
                        actions was redundant with the row's
                        highlighted background + primary border, so
                        it's dropped — the visual state of the row
                        already conveys selection. */}
                    <TouchableOpacity
                      onPress={() => handleEditAddress(addr)}
                      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                      style={{
                        width: 36, height: 36, borderRadius: 18,
                        backgroundColor: theme.colors.primary + '12',
                        justifyContent: 'center', alignItems: 'center',
                        marginLeft: 10,
                      }}
                    >
                      <EditIcon8 size={22} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setAddressPendingDelete(addr)}
                      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                      style={{
                        width: 36, height: 36, borderRadius: 18,
                        backgroundColor: '#b9454514',
                        justifyContent: 'center', alignItems: 'center',
                        marginLeft: 10,
                      }}
                    >
                      <DeleteIcon8 size={22} />
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

            {/* Fixed center pin — brighter blue (#2196F3, Material
                blue 500) so it reads as a map marker, not a brand
                element. White-bordered outer ring + tiny white core
                dot give the user a precise "this is exactly where
                you're picking" indicator. Same geometry across all
                three picker surfaces (LocationPickerModal +
                LocationFormFields) so the picking feedback feels
                consistent customer-side and business-side. The
                stem tip lands at the map's geographic center —
                see centerPin's `marginTop: -(pinDot.height +
                pinStem.height)` in styles below. */}
            <View style={styles.centerPin} pointerEvents="none">
              <View style={[styles.pinDot, { backgroundColor: '#2196F3' }]}>
                <View style={styles.pinCore} />
              </View>
              <View style={[styles.pinStem, { backgroundColor: '#2196F3' }]} />
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

            {/* Fixed center pin — brighter blue (#2196F3, Material
                blue 500) so it reads as a map marker, not a brand
                element. White-bordered outer ring + tiny white core
                dot give the user a precise "this is exactly where
                you're picking" indicator. Same geometry across all
                three picker surfaces (LocationPickerModal +
                LocationFormFields) so the picking feedback feels
                consistent customer-side and business-side. The
                stem tip lands at the map's geographic center —
                see centerPin's `marginTop: -(pinDot.height +
                pinStem.height)` in styles below. */}
            <View style={styles.centerPin} pointerEvents="none">
              <View style={[styles.pinDot, { backgroundColor: '#2196F3' }]}>
                <View style={styles.pinCore} />
              </View>
              <View style={[styles.pinStem, { backgroundColor: '#2196F3' }]} />
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
            {/* The name is edited on the next page (Confirmer le nom), not here. */}
            <TouchableOpacity
              onPress={goToCurrentLocation}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: theme.radii.r16, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }}
            >
              <Navigation size={14} color={theme.colors.primary} />
              <Text style={[theme.typography.bodySm, { color: theme.colors.primary, fontWeight: '600' }]}>{t('addressPicker.useCurrentLocation', { defaultValue: 'Utiliser ma position actuelle' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleEditMapConfirm}
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
                if (nameError) setNameError('');
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
                    if (nameError) setNameError('');
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
              if (nameError) setNameError('');
              setLabelInput(v);
            }}
          />

          {/* Duplicate-name (or other) error. */}
          {nameError ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -12, marginBottom: 18 }}>
              <AlertTriangle size={14} color={theme.colors.error} />
              <Text style={[theme.typography.bodySm, { color: theme.colors.error, flex: 1 }]}>{nameError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={handleFormSave}
            style={[styles.confirmBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16 }]}
          >
            <Text style={[theme.typography.button, { color: '#fff' }]}>
              {editingAddress
                ? t('addressPicker.confirmName', { defaultValue: 'Confirmer le nom' })
                : t('addressPicker.saveAddress')}
            </Text>
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
                <Text style={{ fontWeight: '700' }}>{resolveAddressLabel(addressPendingDelete.label, t)}</Text>
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
    // Composite is 22 (dot) + 14 (stem) tall. Offset by -half-width
    // and -full-height so the STEM TIP — the actual geographic pick
    // point — lands exactly at the map's center.
    marginLeft: -11,
    marginTop: -36,
  },
  pinDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2.5,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    // Subtle elevation so the pin sits above the map tiles instead
    // of looking flat against them.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 4,
  },
  // White inner core — the precision indicator. Sits dead center
  // inside the blue dot so the user can see EXACTLY which pixel is
  // being picked. Without it the blue dot reads as a generic blob;
  // with it the eye locks onto the precise pick point.
  pinCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  pinStem: {
    width: 3,
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
