import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView,
  TextInput, Platform, Dimensions, StyleSheet,
} from 'react-native';
import { MapPin, Home, Briefcase, Plus, ChevronLeft, X, Check, Trash2 } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { useAddressStore } from '@/src/stores/addressStore';
import { resolveAddressLabel, defaultAddressKey } from '@/src/utils/addressLabel';

let MapView: any = null;
if (Platform.OS !== 'web') {
  const maps = require('react-native-maps');
  MapView = maps.default;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;
const QUICK_LABELS = ['Home', 'Work'];

type Step = 'list' | 'map' | 'form';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function LocationPickerModal({ visible, onClose }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { addresses, selectedId, addAddress, removeAddress, selectAddress } = useAddressStore();
  const [searchText, setSearchText] = useState('');

  const [step, setStep] = useState<Step>('list');
  const [pendingRegion, setPendingRegion] = useState({ lat: 36.8065, lng: 10.1815 });
  const [labelInput, setLabelInput] = useState('');

  const reset = () => {
    setStep('list');
    setLabelInput('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSelectAddress = (id: string) => {
    selectAddress(id);
    handleClose();
  };

  const handleMapConfirm = () => setStep('form');

  const handleFormSave = () => {
    const label = labelInput.trim() || 'My Location';
    void addAddress({ label, lat: pendingRegion.lat, lng: pendingRegion.lng });
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>

        {/* ── Step: Address List ────────────────────────────────────── */}
        {step === 'list' && (
          <View style={[styles.sheet, { backgroundColor: theme.colors.bg, maxHeight: SCREEN_HEIGHT * 0.7 }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.colors.divider }]}>
              <Text style={[theme.typography.h2, { color: theme.colors.textPrimary, flex: 1 }]}>{t('address.addresses', { defaultValue: 'Addresses' })}</Text>
              <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={22} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Search bar */}
            <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder={t('address.searchPlaceholder', { defaultValue: 'Rechercher une adresse...' })}
                placeholderTextColor={theme.colors.muted}
                style={{ height: 40, backgroundColor: theme.colors.surface, borderRadius: 10, paddingHorizontal: 14, color: theme.colors.textPrimary, ...theme.typography.bodySm, borderWidth: 1, borderColor: theme.colors.divider }}
              />
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
              {/* Add new button */}
              <TouchableOpacity
                onPress={() => setStep('map')}
                style={[styles.addBtn, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, ...theme.shadows.shadowSm }]}
              >
                <View style={[styles.addBtnIcon, { backgroundColor: theme.colors.primary + '18', borderRadius: 8 }]}>
                  <Plus size={18} color={theme.colors.primary} />
                </View>
                <Text style={[theme.typography.body, { color: theme.colors.primary, fontWeight: '600' as const }]}>
                  {t('address.addNew', { defaultValue: 'Add new address' })}
                </Text>
              </TouchableOpacity>

              {/* Saved addresses list */}
              {addresses.length > 0 && (
                <>
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary, fontWeight: '600' as const, marginBottom: 8, letterSpacing: 0.5, textTransform: 'none' as const }]}>
                    {t('address.saved', { defaultValue: 'Saved addresses' })}
                  </Text>
                  {addresses.filter(a => !searchText.trim() || a.label.toLowerCase().includes(searchText.toLowerCase())).map((addr) => {
                    const isSelected = addr.id === selectedId;
                    const dk = defaultAddressKey(addr.label);
                    const Icon = dk === 'home' ? Home : dk === 'work' ? Briefcase : MapPin;
                    return (
                      <TouchableOpacity
                        key={addr.id}
                        onPress={() => handleSelectAddress(addr.id)}
                        style={[styles.addrRow, { borderBottomColor: theme.colors.divider, backgroundColor: isSelected ? theme.colors.primary + '20' : 'transparent', borderRadius: 12, paddingHorizontal: 12, borderWidth: isSelected ? 1.5 : 0, borderColor: isSelected ? theme.colors.primary : 'transparent' }]}
                      >
                        <Icon size={20} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
                        <Text
                          style={[
                            theme.typography.body,
                            { color: theme.colors.textPrimary, flex: 1, marginLeft: 14, fontWeight: isSelected ? ('600' as const) : ('400' as const) },
                          ]}
                          numberOfLines={1}
                        >
                          {resolveAddressLabel(addr.label, t)}
                        </Text>
                        {isSelected && <Check size={18} color={theme.colors.primary} />}
                        <TouchableOpacity
                          onPress={() => void removeAddress(addr.id)}
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
          </View>
        )}

        {/* ── Step: Map Pin Picker ──────────────────────────────────── */}
        {step === 'map' && (
          <View style={[styles.mapSheet, { backgroundColor: theme.colors.bg, height: SCREEN_HEIGHT * 0.75 }]}>
            <View style={[styles.mapHeader, { backgroundColor: theme.colors.bg, borderBottomColor: theme.colors.divider }]}>
              <TouchableOpacity onPress={() => setStep('list')} style={{ marginRight: 12 }}>
                <ChevronLeft size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>{t('address.chooseLocation', { defaultValue: 'Choose location' })}</Text>
            </View>

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

              {/* Fixed center pin — brighter Material blue (#2196F3)
                  with a white core dot for precision. Larger and
                  crisper than the old design so the user can see
                  exactly which pixel they're picking. Mirrors the
                  customer-side address-picker geometry. */}
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
                  {t('address.moveMapPin', { defaultValue: 'Move the map to position the pin' })}
                </Text>
              </View>
            </View>

            <View style={[styles.mapFooter, { backgroundColor: theme.colors.bg }]}>
              <TouchableOpacity
                onPress={handleMapConfirm}
                style={[styles.confirmBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16 }]}
              >
                <Text style={[theme.typography.button, { color: '#fff' }]}>{t('address.confirmLocation', { defaultValue: 'Confirm location' })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Step: Label Form ──────────────────────────────────────── */}
        {step === 'form' && (
          <View style={[styles.sheet, { backgroundColor: theme.colors.bg }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.colors.divider }]}>
              <TouchableOpacity onPress={() => setStep('map')} style={{ marginRight: 12 }}>
                <ChevronLeft size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <Text style={[theme.typography.h3, { color: theme.colors.textPrimary }]}>{t('address.labelPlace', { defaultValue: 'Label this place' })}</Text>
            </View>

            <View style={{ paddingHorizontal: 20, paddingBottom: 48, paddingTop: 8 }}>
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
                placeholder={t('address.customNamePlaceholder', { defaultValue: 'Or enter a custom name...' })}
                placeholderTextColor={theme.colors.muted}
                value={labelInput}
                onChangeText={setLabelInput}
              />

              <TouchableOpacity
                onPress={handleFormSave}
                style={[styles.confirmBtn, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r16 }]}
              >
                <Text style={[theme.typography.button, { color: '#fff' }]}>{t('address.save', { defaultValue: 'Save address' })}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    borderRadius: 24,
    width: '100%',
    maxWidth: 420,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    marginBottom: 16,
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
  mapSheet: {
    borderRadius: 24,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 420,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  centerPin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    alignItems: 'center',
    // Composite (22 dot + 14 stem = 36 tall). Offset by half-width
    // and full-height so the stem TIP — the actual geographic pick
    // point — sits exactly on the map's center pixel.
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 4,
  },
  // White inner core — precision indicator. Tiny dot the user's eye
  // locks onto so they can see EXACTLY which pixel is being picked.
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
