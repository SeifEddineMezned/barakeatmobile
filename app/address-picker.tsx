import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  TextInput, Platform, Dimensions, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, Home, Briefcase, Plus, ChevronLeft, Check, Trash2 } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAddressStore, type SavedAddress } from '@/src/stores/addressStore';
import { useRouter } from 'expo-router';

let MapView: any = null;
let Marker: any = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;
const QUICK_LABELS = ['Home', 'Work'];

type Step = 'list' | 'map' | 'form';

export default function AddressPickerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { addresses, selectedId, addAddress, removeAddress, selectAddress } = useAddressStore();

  const [step, setStep] = useState<Step>('list');
  const [pendingRegion, setPendingRegion] = useState({ lat: 36.8065, lng: 10.1815 });
  const [labelInput, setLabelInput] = useState('');
  const [previewAddress, setPreviewAddress] = useState<SavedAddress | null>(null);

  const reset = () => {
    setStep('list');
    setLabelInput('');
    setPreviewAddress(null);
  };

  const handleBack = () => {
    if (step === 'form') { setStep('map'); return; }
    if (step === 'map') { reset(); return; }
    router.back();
  };

  const handleSelectAddress = (addr: SavedAddress) => {
    setPreviewAddress(addr);
    selectAddress(addr.id);
  };

  const handleMapConfirm = () => setStep('form');

  const handleFormSave = () => {
    const label = labelInput.trim() || 'My Location';
    void addAddress({ label, lat: pendingRegion.lat, lng: pendingRegion.lng });
    reset();
  };

  const title = step === 'list' ? 'Addresses' : step === 'map' ? 'Choose location' : 'Label this place';

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
          {/* Map preview for selected address */}
          {previewAddress && (
            <View style={[styles.mapPreview, { borderRadius: theme.radii.r16, overflow: 'hidden', ...theme.shadows.shadowSm, marginBottom: 20 }]}>
              {MapView && Platform.OS !== 'web' ? (
                <MapView
                  style={{ width: '100%', height: 200 }}
                  region={{
                    latitude: previewAddress.lat,
                    longitude: previewAddress.lng,
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
                      coordinate={{ latitude: previewAddress.lat, longitude: previewAddress.lng }}
                    />
                  )}
                </MapView>
              ) : (
                <View style={{ width: '100%', height: 200, backgroundColor: theme.colors.divider, alignItems: 'center', justifyContent: 'center' }}>
                  <MapPin size={32} color={theme.colors.muted} />
                  <Text style={[theme.typography.bodySm, { color: theme.colors.muted, marginTop: 8 }]}>
                    {previewAddress.label}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, marginTop: 4 }]}>
                    {previewAddress.lat.toFixed(4)}, {previewAddress.lng.toFixed(4)}
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
              Add new address
            </Text>
          </TouchableOpacity>

          {/* Saved addresses list */}
          {addresses.length > 0 && (
            <>
              <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, fontWeight: '600' as const, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' as const }]}>
                Saved addresses
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
                    <Text
                      style={[
                        theme.typography.body,
                        { color: theme.colors.textPrimary, flex: 1, marginLeft: 14, fontWeight: isSelected ? ('600' as const) : ('400' as const) },
                      ]}
                      numberOfLines={1}
                    >
                      {addr.label}
                    </Text>
                    {isSelected && <Check size={18} color={theme.colors.primary} />}
                    <TouchableOpacity
                      onPress={() => {
                        void removeAddress(addr.id);
                        if (previewAddress?.id === addr.id) setPreviewAddress(null);
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{ marginLeft: 12 }}
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

      {/* ── Step: Map Pin Picker ──────────────────────────── */}
      {step === 'map' && (
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {MapView && Platform.OS !== 'web' ? (
              <MapView
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
                  Map unavailable on this platform
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
                Move the map to position the pin
              </Text>
            </View>
          </View>

          <View style={[styles.mapFooter, { backgroundColor: theme.colors.bg }]}>
            <TouchableOpacity
              onPress={handleMapConfirm}
              style={[styles.confirmBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16 }]}
            >
              <Text style={[theme.typography.button, { color: '#fff' }]}>Confirm location</Text>
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
              const isActive = labelInput === ql;
              const QIcon = ql === 'Home' ? Home : Briefcase;
              return (
                <TouchableOpacity
                  key={ql}
                  onPress={() => setLabelInput(ql)}
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
                    {ql}
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
            placeholder="Or enter a custom name..."
            placeholderTextColor={theme.colors.muted}
            value={labelInput}
            onChangeText={setLabelInput}
          />

          <TouchableOpacity
            onPress={handleFormSave}
            style={[styles.confirmBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16 }]}
          >
            <Text style={[theme.typography.button, { color: '#fff' }]}>Save address</Text>
          </TouchableOpacity>
        </View>
      )}
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
    paddingVertical: 16,
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
