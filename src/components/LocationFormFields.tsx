import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Platform, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Navigation, Search, X } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { TimePicker } from '@/src/components/TimePicker';

let MapView: any = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
}

// Shared between add-location and edit-location so both forms track the same
// category list without drifting. If this ever needs to live elsewhere we can
// promote it to a dedicated file — inlined for now to keep the change surface
// small.
export const LOCATION_CATEGORIES = ['bakery', 'restaurant', 'grocery', 'cafe', 'supermarket'] as const;

export interface LocationFormValue {
  name: string;
  address: string;
  coords: { lat: number; lng: number } | null;
  phone: string;
  category: string;
  pickupStart: string;
  pickupEnd: string;
  pickupInstructions: string;
  bagDescription: string;
}

interface AddressSuggestion {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface Props {
  value: LocationFormValue;
  onChange: (patch: Partial<LocationFormValue>) => void;
}

/**
 * Unified location form used by both add-location and edit-location. Owns the
 * map-picker step internally — consumers only supply `value` + `onChange`.
 * The map step is Nominatim-autocompleted and supports "use current location";
 * the full-screen overlay ensures the picker works inside any scroll container.
 */
export function LocationFormFields({ value, onChange }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  // SafeAreaView from react-native-safe-area-context doesn't always get its
  // insets inside a <Modal>, so we read the insets directly and pad manually.
  // This guarantees the status bar / notch / camera cutout isn't covered.
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'form' | 'map'>('form');
  const [addressSearch, setAddressSearch] = useState(value.address ?? '');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingRegion, setPendingRegion] = useState<{ lat: number; lng: number }>(() => ({
    lat: value.coords?.lat ?? 36.8065,
    lng: value.coords?.lng ?? 10.1815,
  }));
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapRef = useRef<any>(null);

  // When the parent hydrates coords after the component mounted (edit-location
  // loading from cache), re-center the map's next open.
  useEffect(() => {
    if (value.coords) setPendingRegion({ lat: value.coords.lat, lng: value.coords.lng });
  }, [value.coords?.lat, value.coords?.lng]);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) { setSuggestions([]); return; }
    setSearching(true);
    try {
      const params = new URLSearchParams({
        format: 'json',
        q: query,
        limit: '8',
        addressdetails: '1',
        viewbox: '7.5,30.2,11.6,37.5',
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
      latitude: lat, longitude: lng, latitudeDelta: 0.005, longitudeDelta: 0.005,
    }, 600);
  }, []);

  const openMap = () => {
    setAddressSearch(value.address ?? '');
    setStep('map');
  };

  const confirmMap = () => {
    onChange({
      coords: pendingRegion,
      address: addressSearch.trim() || `${pendingRegion.lat.toFixed(5)}, ${pendingRegion.lng.toFixed(5)}`,
    });
    setStep('form');
  };

  // The map picker is rendered as a full-screen Modal so it doesn't interfere
  // with the parent ScrollView's layout. Previously an absoluteFillObject
  // view collapsed the form — which pushed the Save button to the top and
  // the map never had a proper frame to render in.
  const mapPickerModal = (
    <Modal visible={step === 'map'} animationType="slide" statusBarTranslucent onRequestClose={() => setStep('form')}>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top }}>
        {/* Search bar */}
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: suggestions.length > 0 ? 0 : 10, backgroundColor: theme.colors.bg, borderBottomWidth: suggestions.length > 0 ? 0 : 1, borderBottomColor: theme.colors.divider, zIndex: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={() => setStep('form')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ padding: 4 }}>
              <X size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
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
          {suggestions.length > 0 && (
            <ScrollView
              style={{ maxHeight: 260, backgroundColor: theme.colors.surface, borderRadius: 12, marginTop: 6, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.divider }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
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

        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          {MapView && Platform.OS !== 'web' ? (
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFillObject}
              initialRegion={{
                latitude: pendingRegion.lat,
                longitude: pendingRegion.lng,
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
              <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 8 }}>
                {t('addressPicker.mapUnavailable', { defaultValue: 'Carte non disponible' })}
              </Text>
            </View>
          )}

          <View style={styles.centerPin} pointerEvents="none">
            <View style={[styles.pinDot, { backgroundColor: '#e3ff5c', justifyContent: 'center', alignItems: 'center' }]}>
              <MapPin size={10} color="#114b3c" />
            </View>
            <View style={[styles.pinStem, { backgroundColor: '#e3ff5c' }]} />
          </View>

          <View style={[styles.tooltip, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
            <MapPin size={14} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, marginLeft: 6 }}>
              {t('addressPicker.dragToMove', { defaultValue: 'Déplacez la carte pour positionner le repère' })}
            </Text>
          </View>
        </View>

        <View style={{ backgroundColor: theme.colors.bg, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 + insets.bottom, gap: 10 }}>
          <TouchableOpacity
            onPress={async () => {
              try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                const newRegion = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setPendingRegion(newRegion);
                mapRef.current?.animateToRegion({
                  latitude: newRegion.lat, longitude: newRegion.lng, latitudeDelta: 0.005, longitudeDelta: 0.005,
                }, 600);
              } catch {}
            }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }}
          >
            <Navigation size={14} color="#114b3c" />
            <Text style={{ color: '#114b3c', fontSize: 14, fontWeight: '600' }}>
              {t('addressPicker.useCurrentLocation', { defaultValue: 'Utiliser ma position actuelle' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={confirmMap}
            style={{ backgroundColor: '#114b3c', borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
          >
            <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 16 }}>
              {t('addressPicker.confirmLocation', { defaultValue: "Confirmer l'emplacement" })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // ── Form step ──────────────────────────────────────────────────────────────
  return (
    <View>
      {/* Name */}
      <Text style={label(theme)}>{t('business.team.locationName', { defaultValue: 'Nom' })} *</Text>
      <TextInput
        style={input(theme)}
        value={value.name}
        onChangeText={(v) => onChange({ name: v })}
        placeholder={t('business.team.locationNamePlaceholder', { defaultValue: 'Ex : Succursale Centre-ville' })}
        placeholderTextColor={theme.colors.muted}
        autoCapitalize="words"
      />

      {/* Address — the only way to set it is via the map picker (search or
          pin). Typing a raw string was allowed before but it let the admin
          create locations with no coordinates, which broke the nearby/map
          discovery for customers. */}
      <Text style={[label(theme), { marginTop: 20 }]}>
        {t('business.team.locationAddress', { defaultValue: 'Adresse' })} *
      </Text>
      <TouchableOpacity
        onPress={openMap}
        activeOpacity={0.7}
        style={[input(theme), {
          minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10,
          borderColor: value.coords ? '#114b3c40' : theme.colors.divider,
          backgroundColor: value.coords ? '#114b3c08' : theme.colors.surface,
        }]}
      >
        <MapPin size={18} color={value.coords ? '#114b3c' : theme.colors.muted} />
        <Text
          style={{
            flex: 1,
            color: value.address ? theme.colors.textPrimary : theme.colors.muted,
            fontSize: 14,
          }}
          numberOfLines={2}
        >
          {value.address || t('business.team.tapToSelectLocation', { defaultValue: 'Choisir sur la carte' })}
        </Text>
      </TouchableOpacity>
      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4, lineHeight: 15 }}>
        {value.coords
          ? `${t('business.team.changeLocation', { defaultValue: "Appuyez pour modifier sur la carte" })}  ·  ${value.coords.lat.toFixed(4)}, ${value.coords.lng.toFixed(4)}`
          : t('business.team.addressMustUseMap', { defaultValue: 'Utilisez la carte pour choisir une adresse précise.' })}
      </Text>

      {/* Category — required. Tap a chip to select; picking a second one
          replaces the current choice, so `category` always holds exactly
          one value once set (no deselect). */}
      <Text style={[label(theme), { marginTop: 20 }]}>
        {t('business.team.fieldCategory', { defaultValue: 'Catégorie' })}{' '}
        <Text style={{ color: theme.colors.error }}>*</Text>
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {LOCATION_CATEGORIES.map((c) => {
          const active = value.category === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => onChange({ category: c })}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                borderWidth: 1,
                borderColor: active ? theme.colors.primary : theme.colors.divider,
                backgroundColor: active ? theme.colors.primary + '12' : theme.colors.surface,
              }}
            >
              <Text style={{ color: active ? theme.colors.primary : theme.colors.textSecondary, fontSize: 13, fontWeight: '600' }}>
                {t(`categories.${c}`, { defaultValue: c })}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Pickup times */}
      <Text style={[label(theme), { marginTop: 20 }]}>{t('business.availability.pickupStart', { defaultValue: 'Début du retrait' })}</Text>
      <TimePicker
        value={value.pickupStart}
        onChange={(v) => onChange({ pickupStart: v })}
        primaryColor={theme.colors.primary}
        textColor={theme.colors.textPrimary}
        bgColor={theme.colors.surface}
        mutedColor={theme.colors.muted}
      />
      <View style={{ height: 12 }} />
      <Text style={label(theme)}>{t('business.availability.pickupEnd', { defaultValue: 'Fin du retrait' })}</Text>
      <TimePicker
        value={value.pickupEnd}
        onChange={(v) => onChange({ pickupEnd: v })}
        primaryColor={theme.colors.primary}
        textColor={theme.colors.textPrimary}
        bgColor={theme.colors.surface}
        mutedColor={theme.colors.muted}
      />

      {/* Pickup instructions */}
      <Text style={[label(theme), { marginTop: 20 }]}>
        {t('business.createBasket.pickupInstructions', { defaultValue: 'Instructions de retrait' })}
      </Text>
      <TextInput
        style={[input(theme), { minHeight: 80, textAlignVertical: 'top' }]}
        value={value.pickupInstructions}
        onChangeText={(v) => onChange({ pickupInstructions: v })}
        placeholder={t('business.createBasket.pickupInstructionsPlaceholder', { defaultValue: "Ex : Sonnez à l'entrée arrière" })}
        placeholderTextColor={theme.colors.muted}
        multiline
      />

      {mapPickerModal}
    </View>
  );
}

const label = (theme: any) => ({
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: '700' as const,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginBottom: 6,
});

// Local helper kept for the multi-line description-style TextInputs on this
// screen. Aligned to the new shared inputStyle() helper (48px tall, 10px
// radius, Poppins regular 15px) but stays multi-line-friendly.
const input = (theme: any) => ({
  backgroundColor: theme.colors.surface,
  borderWidth: 1,
  borderColor: theme.colors.divider,
  borderRadius: theme.radii.r10,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: theme.colors.textPrimary,
  fontSize: 15,
  fontFamily: 'Poppins_400Regular',
});

const styles = StyleSheet.create({
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
