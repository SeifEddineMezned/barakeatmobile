import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Share, Alert, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, CheckCircle, Copy, AlertTriangle, Camera, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { ensureCameraAccess } from '@/src/lib/photoPermission';
import { useImageCropper } from '@/src/components/ImageCropper';
import * as ImageManipulator from 'expo-image-manipulator';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { submitReport } from '@/src/services/reports';
import { fetchMyReservations } from '@/src/services/reservations';
import { getErrorMessage, makeAttemptKey } from '@/src/lib/api';
import { StatusBar } from 'expo-status-bar';
import { useOrdersStore } from '@/src/stores/ordersStore';
import { OrderSummaryCard } from '@/src/components/OrderSummaryCard';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';

const REASONS = [
  { key: 'food_quality', labelKey: 'claims.foodQuality', defaultLabel: 'Qualité du repas' },
  { key: 'wrong_info', labelKey: 'claims.wrongInfo', defaultLabel: 'Informations incorrectes' },
  { key: 'insufficient_quantity', labelKey: 'claims.insufficientQuantity', defaultLabel: 'Quantité insuffisante' },
  { key: 'not_received', labelKey: 'claims.notReceived', defaultLabel: 'Commande non reçue' },
  { key: 'other', labelKey: 'claims.other', defaultLabel: 'Autre' },
];

export default function ClaimScreen() {
  const { reservationId, locationName, basketName } = useLocalSearchParams<{ reservationId?: string; locationName?: string; basketName?: string }>();
  const { t } = useTranslation();
  // Aliased — this screen already has its own `pickPhoto` (the action sheet).
  const { pickPhoto: pickFromLibrary } = useImageCropper();
  const theme = useTheme();
  const router = useRouter();
  const customAlert = useCustomAlert();

  // Same fallback pattern as the review screen — the deep-link params from
  // the notification carry only the basics; everything else (basket image,
  // org logo, quantity, total) comes from the cached reservations list so
  // the order summary card at the top of the form has the same fidelity as
  // the leave-a-review card.
  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: !!reservationId,
    staleTime: 60_000,
  });
  const matchedReservation = React.useMemo(() => {
    if (!reservationId) return null;
    return (reservationsQuery.data ?? []).find((r: any) => String(r.id) === String(reservationId)) ?? null;
  }, [reservationsQuery.data, reservationId]);
  const r: any = matchedReservation ?? {};
  const resolvedBasketImage =
    r?.basket_image_url ||
    r?.basketImageUrl ||
    r?.basket?.imageUrl ||
    r?.basket?.image_url ||
    r?.basket?.cover_image_url ||
    r?.basket?.coverImageUrl ||
    r?.basket_image ||
    r?.image_url ||
    null;
  const resolvedBasketName =
    (basketName && basketName.trim())
    || r?.basket?.name
    || r?.basket_name
    || null;
  const resolvedLocationName =
    (locationName && locationName.trim())
    || r?.restaurant?.name
    || r?.restaurant_name
    || r?.location_name
    || null;
  const resolvedLocationLogo =
    r?.restaurant?.image_url
    || r?.restaurant_image
    || r?.basket?.merchantLogo
    || r?.basket?.merchant_logo
    || null;
  const resolvedQuantity = r?.quantity ? Number(r.quantity) : undefined;
  const resolvedTotal =
    r?.txn_amount != null ? Number(r.txn_amount)
    : r?.total_price != null ? Number(r.total_price)
    : r?.total != null ? Number(r.total)
    : undefined;

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

  // The KeyboardAvoidingView below already lifts the form above the keyboard.
  // We keep this ref only so focusing the description can gently scroll it into
  // view. We deliberately DON'T also add the keyboard height to the scroll
  // padding — doing both double-compensated and shot the whole form way up.
  const scrollRef = useRef<ScrollView | null>(null);

  const markReservationReported = useOrdersStore((s) => s.markReservationReported);

  // Per-attempt idempotency key. Minted lazily on first submit so a retry of
  // the same attempt (network blip after the image upload + INSERT committed
  // but before we got the response) lands on the existing report row instead
  // of creating a duplicate. Cleared on submit success.
  const submitAttemptKeyRef = useRef<string | null>(null);

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
    if (!submitAttemptKeyRef.current) submitAttemptKeyRef.current = makeAttemptKey();
    try {
      const result = await submitReport({
        reservation_id: reservationId ? Number(reservationId) : undefined,
        reason,
        details: descTrimmed,
        image_data_url: photoDataUrl || undefined,
      }, submitAttemptKeyRef.current);
      const ref = result.reference_number || result.report?.reference_number || '';
      setRefNumber(ref);
      setSubmitted(true);
      // Report durably committed — clear the key so any next report attempt
      // mints a fresh one.
      submitAttemptKeyRef.current = null;
      // Remember this reservation was reported so the order card hides its
      // Report/Review buttons on next render.
      if (reservationId) markReservationReported(String(reservationId));
    } catch (err: any) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Convert an ImagePicker asset to (uri, dataUrl). The backend wants a base64
  // data URL. We DON'T trust the picker's raw base64 — a 12MP phone photo
  // base64-encodes to several MB, which silently 413s / times out the report
  // POST. Downscale to max 1280px wide + JPEG compress first so the payload
  // stays small and the upload reliably succeeds.
  const captureAssetUri = async (uri: string) => {
    setPhotoUri(uri);
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      // Show the downscaled image in the preview too, so what the user sees is
      // what gets uploaded.
      setPhotoUri(manipulated.uri);
      setPhotoDataUrl(manipulated.base64 ? `data:image/jpeg;base64,${manipulated.base64}` : null);
    } catch (e) {
      console.log('[Claim] image manipulate failed:', e);
      setPhotoDataUrl(null);
    }
  };

  const launchCamera = async () => {
    if (!(await ensureCameraAccess())) return;
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) await captureAssetUri(result.assets[0].uri);
  };

  const launchLibrary = async () => {
    // Limited-access-aware grid (handles its own permission popup).
    const res = await pickFromLibrary();
    if (res?.uri) await captureAssetUri(res.uri);
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
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', marginBottom: 24 }}>
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
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <StatusBar style="dark" />
      {/* No borderBottom — matches the leave-review header (review.tsx). The
          two forms now read as siblings instead of the claim form having an
          extra divider line under its title. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ position: 'absolute', left: 16, top: 14 }}
        >
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }}>
          {t('claims.title', { defaultValue: 'Signaler un problème' })}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      >
        {/* Order context — same compact card the leave-a-review screen
            uses at the top, so the two surfaces read as siblings instead
            of the report form having a thin "Concernant : X" caption. */}
        <OrderSummaryCard
          basketImage={resolvedBasketImage}
          basketName={resolvedBasketName}
          locationLogo={resolvedLocationLogo}
          locationName={resolvedLocationName}
          quantity={resolvedQuantity}
          total={resolvedTotal}
          orderId={reservationId ?? null}
        />

        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', marginBottom: 8 }}>
          {t('claims.selectReason', { defaultValue: 'Raison de la réclamation' })}
          <Text style={{ color: theme.colors.error }}> *</Text>
        </Text>

        {REASONS.map((r) => (
          <TouchableOpacity
            key={r.key}
            onPress={() => setReason(r.key)}
            style={{
              flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12,
              borderWidth: 1, borderColor: reason === r.key ? theme.colors.primary : theme.colors.divider,
              backgroundColor: reason === r.key ? theme.colors.primary + '08' : theme.colors.surface,
              borderRadius: 10, marginBottom: 5,
            }}
          >
            <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: reason === r.key ? theme.colors.primary : theme.colors.muted, justifyContent: 'center', alignItems: 'center' }}>
              {reason === r.key && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.primary }} />}
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 10 }}>
              {t(r.labelKey, { defaultValue: r.defaultLabel })}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', marginTop: 14, marginBottom: 6 }}>
          {t('claims.description', { defaultValue: 'Description' })}
          <Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
          placeholder={t('claims.descPlaceholder', { defaultValue: 'Décrivez le problème...' })}
          placeholderTextColor={theme.colors.muted}
          onFocus={() => {
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
          }}
          style={{
            backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.divider,
            borderRadius: 10, padding: 12, color: theme.colors.textPrimary, ...theme.typography.body,
            minHeight: 72, textAlignVertical: 'top',
          }}
        />

        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', marginTop: 14, marginBottom: 6 }}>
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
          // Mirrors the review screen's ghost-style photo button — light
          // surface + primary-coloured icon and label with a subtle border.
          // The filled dark-green CTA at the bottom is the SEND button; this
          // attachment button has to read as visually distinct.
          <TouchableOpacity
            onPress={pickPhoto}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 8,
              backgroundColor: theme.colors.surface,
              borderWidth: 1.5,
              borderColor: theme.colors.primary + '40',
              borderRadius: 12,
              paddingVertical: 11,
              paddingHorizontal: 14,
            }}
          >
            <Camera size={16} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' }}>
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

      </ScrollView>

      {/* Sticky footer — same pattern as the leave-review form (app/review.tsx):
          surface bg + top hairline divider + shadowLg, button always pinned
          to the bottom of the screen above the keyboard. The previous
          implementation kept the submit button inside the ScrollView with
          neon-green text on dark-green bg; PrimaryCTAButton ships the
          canonical pill shape, white text on primary, larger typography,
          and the right padding so the label sits clear of the edges. */}
      <View
        style={{
          backgroundColor: theme.colors.surface,
          paddingHorizontal: theme.spacing.xl,
          paddingVertical: theme.spacing.lg,
          borderTopWidth: 1,
          borderTopColor: theme.colors.divider,
          ...theme.shadows.shadowLg,
        }}
      >
        <PrimaryCTAButton
          onPress={handleSubmit}
          title={t('claims.submit', { defaultValue: 'Envoyer la réclamation' })}
          loading={loading}
          disabled={!reason || !description.trim()}
          fullWidth
        />
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
