import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  TextInput, Platform, StyleSheet, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, Home, Briefcase, Plus, ChevronLeft, Check, Trash2, Edit3, Navigation, AlertTriangle } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAddressStore, type SavedAddress } from '@/src/stores/addressStore';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

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

  const handleMapConfirm = () => setStep('form');

  const handleFormSave = () => {
    const label = labelInput.trim() || t('addressPicker.defaultLabel', { defaultValue: 'Mon adresse' });
    void addAddress({ label, lat: pendingRegion.lat, lng: pendingRegion.lng });
    reset();
  };

  // Search for location by text (Nominatim / OpenStreetMap autocomplete)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchLocation = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!text.trim()) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        // Use Nominatim for real place name suggestions
        const query = encodeURIComponent(text.trim());
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${query}&format=json&addressdetails=1&limit=5&countrycodes=tn`,
          { headers: { 'Accept-Language': 'fr' } }
        );
        const data = await resp.json();
        setSearchResults(
          data.map((place: any) => ({
            name: place.display_name,
            lat: parseFloat(place.lat),
            lng: parseFloat(place.lon),
          }))
        );
      } catch {
        setSearchResults([]);
      }
    }, 400);
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
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, fontWeight: '600' as const, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' as const }]}>
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
                      <Edit3 size={16} color={theme.colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setAddressPendingDelete(addr)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{ marginLeft: 10 }}
                    >
                      <Trash2 size={16} color={theme.colors.muted} />
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
              <Edit3 size={14} color="#fff" />
              <Text style={[theme.typography.caption, { color: '#fff', marginLeft: 6 }]}>
                {t('addressPicker.editLocation')}
              </Text>
            </View>
          </View>

          <View style={[styles.mapFooter, { backgroundColor: theme.colors.bg, gap: 10 }]}>
            {/* Editable label — lets the user rename "Maman" → "Travail" etc. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: theme.colors.divider }}>
              <Edit3 size={14} color={theme.colors.primary} />
              <TextInput
                value={labelInput}
                onChangeText={setLabelInput}
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
          {/* Quick label chips */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {QUICK_LABELS.map((ql) => {
              const QIcon = ql === 'home' ? Home : Briefcase;
              const qlLabel = t(`addressPicker.label_${ql}`, { defaultValue: ql === 'home' ? 'Maison' : 'Travail' });
              const isActive = labelInput === qlLabel;
              return (
                <TouchableOpacity
                  key={ql}
                  onPress={() => setLabelInput(qlLabel)}
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
            onChangeText={setLabelInput}
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
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: theme.colors.error + '15', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <AlertTriangle size={28} color={theme.colors.error} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('addressPicker.deleteConfirmTitle', { defaultValue: 'Supprimer cette adresse ?' })}
            </Text>
            {addressPendingDelete && (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', marginBottom: 8 }}>
                <Text style={{ fontWeight: '700' }}>{addressPendingDelete.label}</Text>
              </Text>
            )}
            <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 24, fontWeight: '600', lineHeight: 20 }}>
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
          </View>
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
