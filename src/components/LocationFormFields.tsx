import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Platform, Modal, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Navigation, Search, X } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { TimePicker } from '@/src/components/TimePicker';
import { searchAddresses, reverseGeocode } from '@/src/services/geocoding';
import { useCustomAlert } from '@/src/components/CustomAlert';

let MapView: any = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
}

// Re-exported from the single canonical source so both legacy import sites
// (this file's existing consumers + the admin "Gestion d'équipe" form) keep
// working without churn while drawing from the same list. Update the list at
// src/lib/locationCategories.ts.
import { LOCATION_CATEGORIES } from '@/src/lib/locationCategories';
export { LOCATION_CATEGORIES };

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
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  value: LocationFormValue;
  onChange: (patch: Partial<LocationFormValue>) => void;
  // Optional: caller (e.g. add-location.tsx) passes a callback that scrolls
  // the parent ScrollView to bring the pickup-instructions textbox above the
  // keyboard on focus. Without this, Android's adjustResize shrinks the
  // viewport but never scrolls the focused field into view, and the user
  // can't see what they're typing in the bottom-most field.
  onPickupInstructionsFocus?: () => void;
}

/**
 * Unified location form used by both add-location and edit-location. Owns the
 * map-picker step internally — consumers only supply `value` + `onChange`.
 * The map step is Nominatim-autocompleted and supports "use current location";
 * the full-screen overlay ensures the picker works inside any scroll container.
 */
export function LocationFormFields({ value, onChange, onPickupInstructionsFocus }: Props) {
  const { t } = useTranslation();
  const customAlert = useCustomAlert();
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
    // Shared geocoding module: device-native geocoder first (Apple/Google
    // — much better Tunisian POI coverage than free Nominatim) with a
    // Nominatim fallback if native returns nothing.
    const hits = await searchAddresses(query);
    setSuggestions(hits);
    setSearching(false);
  }, []);

  // Reverse geocoding: refresh the resolved-address chip every time the map
  // settles on a new spot. Debounced 500 ms; in-memory dedup lives in the
  // shared geocoding module so we don't double-fetch identical coords.
  // NOTE: the resolved text is intentionally NOT pushed back into the search
  // field. The search bar is a user-controlled query input; the bottom chip
  // is where the live pin-address feedback lives. Keeping the two separated
  // means typing a query and panning the pin elsewhere doesn't make the
  // search bar lie about what the user asked for.
  const [reverseGeocodedName, setReverseGeocodedName] = useState('');
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchReverseGeocode = useCallback((lat: number, lng: number) => {
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    reverseTimer.current = setTimeout(async () => {
      const formatted = await reverseGeocode(lat, lng);
      if (!formatted) return;
      // Chip only — never touch the search bar.
      setReverseGeocodedName(formatted);
    }, 500);
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setAddressSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSuggestions(text), 300);
  }, [fetchSuggestions]);

  const handleSelectSuggestion = useCallback((item: AddressSuggestion) => {
    // Picking a suggestion is the ONE intentional way the search bar takes
    // a non-typed value — the user explicitly chose this label.
    setAddressSearch(item.name);
    setReverseGeocodedName(item.name);
    setSuggestions([]);
    setPendingRegion({ lat: item.lat, lng: item.lng });
    mapRef.current?.animateToRegion({
      latitude: item.lat, longitude: item.lng, latitudeDelta: 0.005, longitudeDelta: 0.005,
    }, 600);
  }, []);

  // Live pickup-window validation. The submit handler in the parent already
  // rejects invalid windows, but waiting until "Save" is bad UX — the user
  // gets no feedback until they try to leave. Re-derives whenever either
  // time changes and surfaces a red error line under the time pickers so
  // the user knows immediately that the combination they chose is invalid.
  const pickupWindowError: string | null = useMemo(() => {
    const start = value.pickupStart;
    const end = value.pickupEnd;
    if (!start || !end) return null;
    const toMin = (t: string): number | null => {
      const [hStr, mStr] = String(t).split(':');
      const h = Number(hStr);
      const m = Number(mStr);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      if (h < 0 || h > 23 || m < 0 || m > 59) return null;
      return h * 60 + m;
    };
    const s = toMin(start);
    const e = toMin(end);
    if (s == null || e == null) return null;
    if (s === e) {
      return t('business.availability.errZeroWindow', { defaultValue: 'Le créneau ne peut pas être de durée nulle.' });
    }
    // 03:30 = daily-reset threshold (210 minutes from midnight). The window
    // is invalid when 03:30 falls strictly inside [start, end).
    const T = 3 * 60 + 30;
    const crosses = s < e
      ? (s < T && T < e)
      : (T > s || T < e); // window wraps midnight
    if (crosses) {
      return t('business.availability.errCrossReset', {
        defaultValue: 'Le créneau traverse 03:30 (réinitialisation). Commencez ≥ 03:30 ou terminez ≤ 03:29.',
      });
    }
    return null;
  }, [value.pickupStart, value.pickupEnd, t]);

  const openMap = () => {
    // When the user reopens the picker with an existing address (edit-location)
    // seed the search bar with what was previously saved so they can refine
    // it. From there it only changes on typing or suggestion-tap.
    const existing = value.address ?? '';
    setAddressSearch(existing);
    setReverseGeocodedName(existing);
    setStep('map');
    // If we have coords already, prime the resolved-address chip with the
    // refined reverse-geocode for that point.
    if (value.coords) fetchReverseGeocode(value.coords.lat, value.coords.lng);
  };

  // Submit lock for confirmMap. The one-shot reverse-geocode below can take
  // up to HTTP_TIMEOUT_MS — without this guard a user who taps Confirm twice
  // (or once on a slow connection) would queue up multiple awaits and the
  // modal could stay open with the underlying screen dimmed past the first
  // tap, which is the "faded but clickable" symptom.
  const [confirmingMap, setConfirmingMap] = useState(false);
  const confirmMap = useCallback(async () => {
    if (confirmingMap) return;
    setConfirmingMap(true);
    try {
      // Priority order for the saved address text:
      //   1. The reverse-geocoded chip text shown under the pin RIGHT NOW —
      //      this always matches the actual pin position.
      //   2. If no reverse-geocode has come back yet (user confirmed before
      //      the 500 ms debounce + network round-trip), do a one-shot
      //      synchronous fetch through the shared module so we benefit from
      //      the native geocoder there too. Every backend in that module is
      //      now bounded by HTTP_TIMEOUT_MS, so this can't hang the modal.
      //   3. Whatever's in the search field (typed query or last suggestion).
      //   4. Raw coords as a last resort.
      let resolved = reverseGeocodedName.trim();
      if (!resolved) {
        try {
          resolved = (await reverseGeocode(pendingRegion.lat, pendingRegion.lng)).trim();
        } catch {
          resolved = '';
        }
      }
      const finalAddress = resolved
        || addressSearch.trim()
        || `${pendingRegion.lat.toFixed(5)}, ${pendingRegion.lng.toFixed(5)}`;
      onChange({ coords: pendingRegion, address: finalAddress });
      setStep('form');
    } finally {
      setConfirmingMap(false);
    }
  }, [confirmingMap, reverseGeocodedName, pendingRegion, addressSearch, onChange]);

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
                  key={`${item.lat},${item.lng},${idx}`}
                  onPress={() => handleSelectSuggestion(item)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: theme.colors.divider }}
                >
                  <MapPin size={14} color="#114b3c" style={{ marginRight: 10, flexShrink: 0 }} />
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 13, flex: 1, lineHeight: 18 }} numberOfLines={2}>
                    {item.name}
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
              // Trailing edge only — `onRegionChangeComplete` fires reliably
              // on both iOS and Android once the gesture ends, which is all
              // we need to refresh the chip. The previous `onRegionChange`
              // pair + 10 m dedup cache combined to suppress the trailing
              // fetch on Android (the dedup cell was set during the first
              // mid-gesture coord and matched the final one), which is what
              // froze the chip when panning to a different spot.
              onRegionChangeComplete={(region: any) => {
                setPendingRegion({ lat: region.latitude, lng: region.longitude });
                fetchReverseGeocode(region.latitude, region.longitude);
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

          {/* Center pin — brighter Material blue (#2196F3), larger
              than before, with a tiny white core dot for precision.
              Same geometry as the customer-side address-picker so the
              picking feedback feels consistent across the two
              interfaces. Was previously a lime accent (#e3ff5c) with
              a MapPin icon inside; the icon read as decoration
              instead of a precision indicator. The white core is
              tighter and gives the user a clear "exactly this pixel"
              target. */}
          <View style={styles.centerPin} pointerEvents="none">
            <View style={[styles.pinDot, { backgroundColor: '#2196F3' }]}>
              <View style={styles.pinCore} />
            </View>
            <View style={[styles.pinStem, { backgroundColor: '#2196F3' }]} />
          </View>

          <View style={[styles.tooltip, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
            <MapPin size={14} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, marginLeft: 6 }}>
              {t('addressPicker.dragToMove', { defaultValue: 'Déplacez la carte pour positionner le repère' })}
            </Text>
          </View>
          {/* Resolved address — what the pin currently points at. Fetched
              via reverse geocoding ~500 ms after the pin settles so the user
              can verify the position before confirming. Solves the prior
              "uses the last searched name even if pin is elsewhere" bug. */}
          {reverseGeocodedName ? (
            <View style={[styles.resolvedAddress, { backgroundColor: 'rgba(255,255,255,0.95)' }]}>
              <MapPin size={14} color="#114b3c" />
              <Text style={{ color: theme.colors.textPrimary, fontSize: 12, marginLeft: 6, flex: 1 }} numberOfLines={2}>
                {reverseGeocodedName}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ backgroundColor: theme.colors.bg, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 + insets.bottom, gap: 10 }}>
          <TouchableOpacity
            onPress={async () => {
              try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') {
                  // Branded popup → user understands WHY their tap did nothing
                  // and gets one-tap access to Settings instead of a silent
                  // dead button.
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
                const newRegion = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setPendingRegion(newRegion);
                // User explicitly asked for their current location — clear
                // any stale query from the search bar so it doesn't keep
                // pointing at something unrelated. The resolved address is
                // shown in the chip below the map.
                setAddressSearch('');
                fetchReverseGeocode(newRegion.lat, newRegion.lng);
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
            disabled={confirmingMap}
            style={{ backgroundColor: '#114b3c', borderRadius: 16, paddingVertical: 16, alignItems: 'center', opacity: confirmingMap ? 0.7 : 1 }}
          >
            {confirmingMap ? (
              <ActivityIndicator color="#e3ff5c" />
            ) : (
              <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 16 }}>
                {t('addressPicker.confirmLocation', { defaultValue: "Confirmer l'emplacement" })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // ── Form step ──────────────────────────────────────────────────────────────
  return (
    <View>
      {/* Name */}
      <Text style={label(theme)}>
        {t('business.team.locationName', { defaultValue: 'Nom' })}{' '}
        <Text style={{ color: theme.colors.error }}>*</Text>
      </Text>
      <TextInput
        style={input(theme)}
        value={value.name}
        onChangeText={(v) => onChange({ name: v })}
        placeholder={t('business.team.locationNamePlaceholder', { defaultValue: 'Ex : La Goulette' })}
        placeholderTextColor={theme.colors.muted}
        autoCapitalize="words"
      />

      {/* Address — the only way to set it is via the map picker (search or
          pin). Typing a raw string was allowed before but it let the admin
          create locations with no coordinates, which broke the nearby/map
          discovery for customers. */}
      <Text style={[label(theme), { marginTop: 20 }]}>
        {t('business.team.locationAddress', { defaultValue: 'Adresse' })}{' '}
        <Text style={{ color: theme.colors.error }}>*</Text>
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

      {/* Pickup times — required. Both fields gate the submit button in the
          parent screens (add-location, edit-location) so the user can't
          save a location without a deliberate pickup window. */}
      <Text style={[label(theme), { marginTop: 20 }]}>
        {t('business.availability.pickupStart', { defaultValue: 'Début du retrait' })}{' '}
        <Text style={{ color: theme.colors.error }}>*</Text>
      </Text>
      <TimePicker
        value={value.pickupStart}
        onChange={(v) => onChange({ pickupStart: v })}
        primaryColor={theme.colors.primary}
        textColor={theme.colors.textPrimary}
        bgColor={theme.colors.surface}
        mutedColor={theme.colors.muted}
      />
      <View style={{ height: 12 }} />
      <Text style={label(theme)}>
        {t('business.availability.pickupEnd', { defaultValue: 'Fin du retrait' })}{' '}
        <Text style={{ color: theme.colors.error }}>*</Text>
      </Text>
      <TimePicker
        value={value.pickupEnd}
        onChange={(v) => onChange({ pickupEnd: v })}
        primaryColor={theme.colors.primary}
        textColor={theme.colors.textPrimary}
        bgColor={theme.colors.surface}
        mutedColor={theme.colors.muted}
      />
      {/* Cross-03:30 rule hint — shown upfront so the merchant doesn't
          configure a window that the submit handler will reject. Mirrors
          the same hint already present in the business-profile hours
          sheet and the create-basket form. */}
      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 6, lineHeight: 15 }}>
        {t('business.availability.crossResetHint', {
          defaultValue: 'Le créneau ne doit pas traverser 03:30 (réinitialisation quotidienne). Commencez ≥ 03:30 ou terminez ≤ 03:29.',
        })}
      </Text>
      {pickupWindowError ? (
        <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 6, lineHeight: 16, fontWeight: '600' }}>
          {pickupWindowError}
        </Text>
      ) : null}

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
        onFocus={onPickupInstructionsFocus}
      />

      {mapPickerModal}
    </View>
  );
}

const label = (theme: any) => ({
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: '700' as const,
  textTransform: 'none' as const,
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
    // 22 (dot) + 14 (stem) = 36 tall, half-width 11. Tip lands at
    // the map's geographic center pixel.
    marginLeft: -11, marginTop: -36, alignItems: 'center',
  },
  pinDot: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2.5, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25, shadowRadius: 2, elevation: 4,
  },
  // White precision core — the user's eye locks onto this tiny dot
  // so they know EXACTLY which pixel is being picked.
  pinCore: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#fff',
  },
  pinStem: { width: 3, height: 14 },
  tooltip: {
    position: 'absolute', top: 16, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  // Resolved-address chip — pinned just above the bottom action bar so it
  // doesn't overlap the centered pin or the "Drag" hint.
  resolvedAddress: {
    position: 'absolute', bottom: 16, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
  },
});
