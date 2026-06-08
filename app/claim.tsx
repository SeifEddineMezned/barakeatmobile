import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Share, Alert, KeyboardAvoidingView, Keyboard, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, CheckCircle, Copy, AlertTriangle, Camera, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { submitReport } from '@/src/services/reports';
import { getErrorMessage } from '@/src/lib/api';
import { StatusBar } from 'expo-status-bar';
import { useOrdersStore } from '@/src/stores/ordersStore';

const REASONS = [
  { key: 'food_quality', labelKey: 'claims.foodQuality', defaultLabel: 'Qualité du repas' },
  { key: 'wrong_info', labelKey: 'claims.wrongInfo', defaultLabel: 'Informations incorrectes' },
  { key: 'hygiene', labelKey: 'claims.hygiene', defaultLabel: 'Hygiène' },
  { key: 'not_received', labelKey: 'claims.notReceived', defaultLabel: 'Commande non reçue' },
  { key: 'other', labelKey: 'claims.other', defaultLabel: 'Autre' },
];

export default function ClaimScreen() {
  const { reservationId, locationName, basketName } = useLocalSearchParams<{ reservationId?: string; locationName?: string; basketName?: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const customAlert = useCustomAlert();

  const [reason, setReason] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  // Photo state holds two things: the local preview URI (for display in the
  // form) and the base64 data URL that gets posted to the backend. The
  // unified /api/reviews/report path expects `image_data_url`, NOT a file
  // upload — so we capture the photo with base64:true and keep both forms.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [refNumber, setRefNumber] = useState('');
  const [error, setError] = useState('');

  // Keyboard-aware scrolling: track keyboard height so the textbox can stay visible
  // even when the system keyboard covers the bottom half of the screen.
  const scrollRef = useRef<ScrollView | null>(null);
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const markReservationReported = useOrdersStore((s) => s.markReservationReported);

  const handleSubmit = async () => {
    if (!reason) return;
    const descTrimmed = description.trim();
    // Description is now mandatory — admin triage was getting reason-only
    // claims with no actionable detail. The button below is also gated on
    // descTrimmed, but we keep the explicit error path so a user who taps
    // Submit before typing sees a clear message instead of silent no-op.
    if (!descTrimmed) {
      setError(t('claims.descriptionRequired', { defaultValue: 'Veuillez décrire le problème.' }));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await submitReport({
        reservation_id: reservationId ? Number(reservationId) : undefined,
        reason,
        details: descTrimmed,
        image_data_url: photoDataUrl || undefined,
      });
      const ref = result.reference_number || result.report?.reference_number || '';
      setRefNumber(ref);
      setSubmitted(true);
      // Remember this reservation was reported so the order card hides its
      // Report/Review buttons on next render.
      if (reservationId) markReservationReported(String(reservationId));
    } catch (err: any) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Convert an ImagePicker asset to (uri, dataUrl). The backend wants a
  // base64 data URL, but we still keep the local URI for the preview <Image>.
  const captureAsset = (asset: ImagePicker.ImagePickerAsset) => {
    setPhotoUri(asset.uri);
    if (asset.base64) {
      const mime = asset.mimeType || 'image/jpeg';
      setPhotoDataUrl(`data:${mime};base64,${asset.base64}`);
    } else {
      setPhotoDataUrl(null);
    }
  };

  const launchCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError(t('common.cameraPermRequired', { defaultValue: "L'accès à la caméra est requis." }));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7, base64: true });
    if (!result.canceled && result.assets?.[0]) captureAsset(result.assets[0]);
  };

  const launchLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError(t('common.photoPermRequired', { defaultValue: "L'accès à la galerie photo est requis." }));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, quality: 0.7, base64: true });
    if (!result.canceled && result.assets?.[0]) captureAsset(result.assets[0]);
  };

  const pickPhoto = () => {
    // Migrated off the native Alert.alert ActionSheet — it rendered as the
    // generic grey OS popup which broke brand feel and didn't match the
    // leave-a-review screen's photo picker. Now uses the same Barakeat
    // sheet-layout CustomAlert as review.tsx so both customer photo flows
    // (review + claim/report) share one popup with the green primary
    // buttons instead of the OS-grey defaults.
    customAlert.showAlert(
      t('common.addPhoto', { defaultValue: 'Ajouter une photo' }),
      undefined,
      [
        { text: t('common.takePhoto', { defaultValue: 'Prendre une photo' }), onPress: launchCamera },
        { text: t('common.chooseFromGallery', { defaultValue: 'Choisir depuis la galerie' }), onPress: launchLibrary },
        { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
      ],
      { layout: 'sheet' },
    );
  };

  const copyRef = async () => {
    try {
      await Share.share({ message: refNumber });
    } catch {
      Alert.alert(refNumber);
    }
  };

  if (submitted) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <StatusBar style="dark" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#22c55e15', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
            <CheckCircle size={36} color="#22c55e" />
          </View>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center', marginBottom: 8 }}>
            {t('claims.submitted', { defaultValue: 'Réclamation envoyée' })}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', marginBottom: 24 }}>
            {t('claims.refDesc', { defaultValue: 'Votre numéro de référence :' })}
          </Text>
          <TouchableOpacity onPress={copyRef} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary + '10', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14, gap: 10 }}>
            <Text style={{ color: theme.colors.primary, fontSize: 20, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 1 }}>
              {refNumber}
            </Text>
            <Copy size={18} color={theme.colors.primary} />
          </TouchableOpacity>
          <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 8 }}>
            {t('claims.tapToCopy', { defaultValue: 'Appuyez pour copier' })}
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, marginTop: 32 }}
          >
            <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700' }}>OK</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {t('claims.title', { defaultValue: 'Signaler un problème' })}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 + kbHeight }}
      >
        {locationName ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>
              {t('claims.regarding', { defaultValue: 'Concernant :' })} {locationName}
            </Text>
            {basketName ? (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }}>
                {t('claims.basket', { defaultValue: 'Panier :' })} {basketName}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', marginBottom: 12 }}>
          {t('claims.selectReason', { defaultValue: 'Raison de la réclamation' })}
          <Text style={{ color: theme.colors.error }}> *</Text>
        </Text>

        {REASONS.map((r) => (
          <TouchableOpacity
            key={r.key}
            onPress={() => setReason(r.key)}
            style={{
              flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
              borderWidth: 1, borderColor: reason === r.key ? theme.colors.primary : theme.colors.divider,
              backgroundColor: reason === r.key ? theme.colors.primary + '08' : theme.colors.surface,
              borderRadius: 12, marginBottom: 8,
            }}
          >
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: reason === r.key ? theme.colors.primary : theme.colors.muted, justifyContent: 'center', alignItems: 'center' }}>
              {reason === r.key && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }} />}
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }}>
              {t(r.labelKey, { defaultValue: r.defaultLabel })}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', marginTop: 20, marginBottom: 8 }}>
          {t('claims.description', { defaultValue: 'Description' })}
          <Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          placeholder={t('claims.descPlaceholder', { defaultValue: 'Décrivez le problème...' })}
          placeholderTextColor={theme.colors.muted}
          onFocus={() => {
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
          }}
          style={{
            backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.divider,
            borderRadius: 12, padding: 14, color: theme.colors.textPrimary, ...theme.typography.body,
            minHeight: 100, textAlignVertical: 'top',
          }}
        />

        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', marginTop: 20, marginBottom: 8 }}>
          {/* Photo input is optional on both customer photo surfaces (review
              and report). Subtitle mirrors the review screen exactly so the
              two pages read as siblings. */}
          {t('claims.addPhotoOptional', { defaultValue: 'Ajouter une photo (optionnel)' })}
        </Text>
        {photoUri ? (
          <View style={{ position: 'relative' }}>
            <Image
              source={{ uri: photoUri }}
              style={{ width: '100%', height: 200, borderRadius: 12, backgroundColor: theme.colors.surface }}
              resizeMode="cover"
            />
            <TouchableOpacity
              onPress={() => { setPhotoUri(null); setPhotoDataUrl(null); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                position: 'absolute', top: 8, right: 8,
                backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 16,
                width: 32, height: 32, justifyContent: 'center', alignItems: 'center',
              }}
            >
              <X size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={pickPhoto}
              style={{
                marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
                borderColor: theme.colors.divider, backgroundColor: theme.colors.surface,
              }}
            >
              <Camera size={18} color={theme.colors.textPrimary} />
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body }}>
                {t('claims.changePhoto', { defaultValue: 'Changer la photo' })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          // Identical styling to the review screen's photo button — dark
          // green pill with the lime icon + lime label — so both customer
          // photo-input flows share one visual language.
          <TouchableOpacity
            onPress={pickPhoto}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 10,
              backgroundColor: '#114b3c',
              borderRadius: theme.radii.r16,
              paddingVertical: 16,
              paddingHorizontal: 16,
              ...theme.shadows.shadowSm,
            }}
          >
            <Camera size={20} color="#e3ff5c" />
            <Text style={{ color: '#e3ff5c', ...theme.typography.body, fontWeight: '600' }}>
              {t('common.insertOrTakePhoto', { defaultValue: 'Insérer ou prendre une photo' })}
            </Text>
          </TouchableOpacity>
        )}
        {/* Consent note — disclosed up front so a customer attaching a photo
            knows it'll be seen by Barakeat support and may be shared with
            the merchant while investigating. Styling matches the marketing-
            use disclosure on the leave-a-review screen exactly (color, font
            size, line-height, top margin, side padding) so both customer
            photo flows carry the same visual disclosure block. */}
        <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8, paddingHorizontal: 4 }}>
          {t('claims.photoWarning', {
            defaultValue:
              "En ajoutant une photo, vous acceptez que Barakeat la consulte pour traiter votre réclamation, qu'elle puisse être partagée avec le commerce concerné dans le cadre de l'enquête, et qu'elle soit conservée comme pièce justificative.",
          })}
        </Text>

        {error ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 6 }}>
            <AlertTriangle size={14} color={theme.colors.error} />
            <Text style={{ color: theme.colors.error, ...theme.typography.caption }}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!reason || !description.trim() || loading}
          style={{
            backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 16,
            alignItems: 'center', marginTop: 24, opacity: !reason || !description.trim() || loading ? 0.5 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator color="#e3ff5c" />
          ) : (
            <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700' }}>
              {t('claims.submit', { defaultValue: 'Envoyer la réclamation' })}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
