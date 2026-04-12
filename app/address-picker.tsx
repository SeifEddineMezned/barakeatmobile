import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  TextInput, Platform, StyleSheet, ActivityIndicator,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, Home, Briefcase, Plus, ChevronLeft, Check, Trash2, Edit3, Navigation } from 'lucide-react-native';
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

  // ── Autocomplete state ─────────────────────────────────────────────────────
  const [addressSearch, setAddressSearch] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortCtrl = useRef<AbortController | null>(null);

  const fetchSuggestions = useCallback(async (query: string) => {
    // Cancel previous in-flight request
    abortCtrl.current?.abort();
    const controller = new AbortController();
    abortCtrl.current = controller;

    setSuggestionLoading(true);
    setSuggestionError(null);

    try {
      const url =
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1&countrycodes=tn`;

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          // Nominatim requires a meaningful User-Agent per usage policy
          'User-Agent': 'BarakeatMobileApp/1.0 (contactbarakeat@gmail.com)',
        },
      });

      if (!res.ok) {
        throw new Error(`Geocoding error: ${res.status} ${res.statusText}`);
      }

      const data: NominatimResult[] = await res.json();
      console.log('[AddressPicker] Nominatim results:', data.length, 'for query:', query);
      setSuggestions(data);
      if (data.length === 0) {
        setSuggestionError(null); // not an error, just no results
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Stale request cancelled — don't touch state
        return;
      }
      console.error('[AddressPicker] fetchSuggestions failed:', err);
      setSuggestionError(t('addressPicker.searchError', { defaultValue: 'Search failed. Check your connection.' }));
      setSuggestions([]);
    } finally {
      setSuggestionLoading(false);
    }
  }, [t]);

  const handleSearchChange = useCallback((text: string) => {
    setAddressSearch(text);
    setSuggestionError(null);

    // Clear suggestions immediately on empty input
    if (!text.trim()) {
      setSuggestions([]);
      setSuggestionLoading(false);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortCtrl.current?.abort();
      return;
    }

    // Debounce: only fire after 400 ms of no typing
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void fetchSuggestions(text.trim());
    }, 400);
  }, [fetchSuggestions]);

  const handleSuggestionSelect = useCallback((item: NominatimResult) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    setAddressSearch(item.display_name);
    setSuggestions([]);
    setSuggestionError(null);
    setPendingRegion({ lat, lng });
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      600,
    );
    Keyboard.dismiss();
  }, []);

  // Cleanup debounce + abort on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortCtrl.current?.abort();
    };
  }, []);

  // Reset search when switching steps
  useEffect(() => {
    setAddressSearch('');
    setSuggestions([]);
    setSuggestionError(null);
    setSuggestionLoading(false);
  }, [step]);
  // ── End autocomplete state ─────────────────────────────────────────────────

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
    setStep('edit');
  };

  const handleEditConfirm = () => {
    if (editingAddress) {
      void updateAddress(editingAddress.id, { lat: pendingRegion.lat, lng: pendingRegion.lng });
    }
    reset();
  };

  const handleMapConfirm = () => setStep('form');

  const handleFormSave = () => {
    const label = labelInput.trim() || t('addressPicker.defaultLabel', { defaultValue: 'Mon adresse' });
    void addAddress({ label, lat: pendingRegion.lat, lng: pendingRegion.lng });
    reset();
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
                    style={[styles.addrRow, { borderBottomColor: theme.colors.divider }]}
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
                      onPress={() => {
                        void removeAddress(addr.id);
                      }}
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
          {/* Search bar + dropdown — must be ABOVE the map layer */}
          <View style={styles.searchContainer}>
            <View style={[styles.searchBar, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, ...theme.shadows.shadowMd }]}>
              <MapPin size={16} color={theme.colors.primary} />
              <TextInput
                style={[theme.typography.body, styles.searchInput, { color: theme.colors.textPrimary }]}
                placeholder={t('addressPicker.searchPlaceholder', { defaultValue: 'Search address or place…' })}
                placeholderTextColor={theme.colors.muted}
                value={addressSearch}
                onChangeText={handleSearchChange}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel={t('addressPicker.searchPlaceholder', { defaultValue: 'Search address or place…' })}
              />
              {suggestionLoading && <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginLeft: 6 }} />}
              {addressSearch.length > 0 && !suggestionLoading && (
                <TouchableOpacity
                  onPress={() => handleSearchChange('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 18, lineHeight: 20 }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Dropdown — rendered only when there is something to show */}
            {(suggestions.length > 0 || !!suggestionError || (!suggestionLoading && !suggestionError && addressSearch.trim().length >= 2 && suggestions.length === 0)) && (
              <View style={[styles.suggestionsDropdown, { backgroundColor: theme.colors.surface, ...theme.shadows.shadowLg }]}>
                {suggestionError ? (
                  <View style={styles.suggestionStateRow}>
                    <Text style={[theme.typography.bodySm, { color: theme.colors.error ?? '#e53e3e' }]}>{suggestionError}</Text>
                  </View>
                ) : suggestions.length === 0 && !suggestionLoading && addressSearch.trim().length >= 2 ? (
                  <View style={styles.suggestionStateRow}>
                    <Text style={[theme.typography.bodySm, { color: theme.colors.muted }]}>
                      {t('addressPicker.noResults', { defaultValue: 'No results found' })}
                    </Text>
                  </View>
                ) : (
                  suggestions.map((item, idx) => (
                    <TouchableOpacity
                      key={`${item.place_id}_${idx}`}
                      onPress={() => handleSuggestionSelect(item)}
                      style={[styles.suggestionRow, idx < suggestions.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
                      activeOpacity={0.7}
                    >
                      <MapPin size={14} color={theme.colors.primary} style={{ marginRight: 10, flexShrink: 0 }} />
                      <Text style={[theme.typography.bodySm, { color: theme.colors.textPrimary, flex: 1 }]} numberOfLines={2}>
                        {item.display_name}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
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
          {/* Search bar + dropdown — must be ABOVE the map layer */}
          <View style={styles.searchContainer}>
            <View style={[styles.searchBar, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, ...theme.shadows.shadowMd }]}>
              <MapPin size={16} color={theme.colors.primary} />
              <TextInput
                style={[theme.typography.body, styles.searchInput, { color: theme.colors.textPrimary }]}
                placeholder={t('addressPicker.searchPlaceholder', { defaultValue: 'Search address or place…' })}
                placeholderTextColor={theme.colors.muted}
                value={addressSearch}
                onChangeText={handleSearchChange}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel={t('addressPicker.searchPlaceholder', { defaultValue: 'Search address or place…' })}
              />
              {suggestionLoading && <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginLeft: 6 }} />}
              {addressSearch.length > 0 && !suggestionLoading && (
                <TouchableOpacity
                  onPress={() => handleSearchChange('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 18, lineHeight: 20 }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Dropdown */}
            {(suggestions.length > 0 || suggestionError || (!suggestionLoading && addressSearch.trim().length >= 2 && suggestions.length === 0 && !suggestionError === false)) && (
              <View style={[styles.suggestionsDropdown, { backgroundColor: theme.colors.surface, ...theme.shadows.shadowLg }]}>
                {suggestionError ? (
                  <View style={styles.suggestionStateRow}>
                    <Text style={[theme.typography.bodySm, { color: theme.colors.error ?? '#e53e3e' }]}>{suggestionError}</Text>
                  </View>
                ) : suggestions.length === 0 && !suggestionLoading && addressSearch.trim().length >= 2 ? (
                  <View style={styles.suggestionStateRow}>
                    <Text style={[theme.typography.bodySm, { color: theme.colors.muted }]}>
                      {t('addressPicker.noResults', { defaultValue: 'No results found' })}
                    </Text>
                  </View>
                ) : (
                  suggestions.map((item, idx) => (
                    <TouchableOpacity
                      key={`${item.place_id}_${idx}`}
                      onPress={() => handleSuggestionSelect(item)}
                      style={[styles.suggestionRow, idx < suggestions.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}
                      activeOpacity={0.7}
                    >
                      <MapPin size={14} color={theme.colors.primary} style={{ marginRight: 10, flexShrink: 0 }} />
                      <Text style={[theme.typography.bodySm, { color: theme.colors.textPrimary, flex: 1 }]} numberOfLines={2}>
                        {item.display_name}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
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
                {t('addressPicker.editLocation')} — {editingAddress.label}
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
    </SafeAreaView>
  );
}

// Nominatim response shape (minimal — only fields we use)
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
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
  // ── Search / autocomplete ──────────────────────────────────────
  // Wraps the input bar + the dropdown together. Must sit ABOVE the map
  // on both iOS (zIndex) and Android (elevation).
  searchContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 50,
    elevation: 50,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    minHeight: 46,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    marginRight: 4,
    // fontSize handled by theme.typography.body
  },
  suggestionsDropdown: {
    marginTop: 4,
    borderRadius: 12,
    overflow: 'hidden',
    maxHeight: 280,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionStateRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  // ── Map center pin ─────────────────────────────────────────────
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
    top: 78, // pushed down to clear search bar
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
