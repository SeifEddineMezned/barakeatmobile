import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Star, Camera, CheckCircle2 } from 'lucide-react-native';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';
import * as ImagePicker from 'expo-image-picker';
import { ensureCameraAccess } from '@/src/lib/photoPermission';
import { useImageCropper } from '@/src/components/ImageCropper';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { submitReview } from '@/src/services/reviews';
import { fetchMyReservations } from '@/src/services/reservations';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { OrderSummaryCard } from '@/src/components/OrderSummaryCard';
import { isActionAlreadyDoneError } from '@/src/lib/api';

function StarRatingRow({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  required?: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        starStyles.row,
        {
          marginBottom: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
      ]}
    >
      <Text
        style={[
          {
            color: theme.colors.textPrimary,
            ...theme.typography.bodySm,
            flex: 1,
          },
        ]}
      >
        {label}
        {required ? <Text style={{ color: theme.colors.error }}> *</Text> : null}
      </Text>
      <View style={starStyles.stars}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => {
              onChange(star);
            }}
            style={{ paddingHorizontal: 2 }}
          >
            <Star
              size={22}
              color={theme.colors.accentWarm}
              fill={star <= value ? theme.colors.accentWarm : 'transparent'}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const starStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default function ReviewScreen() {
  // orders.tsx sends { locationId, reservationId } — read the exact same param names.
  // 'restaurantId' was the old name; 'locationId' is what the current orders screen sends
  // and what the backend expects as 'location_id' in the review payload.
  const {
    locationId,
    reservationId,
    locationName,
    locationLogo,
    basketImage,
    basketName,
    quantity,
    total,
  } = useLocalSearchParams<{
    locationId: string;
    reservationId: string;
    locationName?: string;
    locationLogo?: string;
    basketImage?: string;
    basketName?: string;
    quantity?: string;
    total?: string;
  }>();
  const { t } = useTranslation();
  const { pickPhoto } = useImageCropper();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const customAlert = useCustomAlert();

  const [ratingService, setRatingService] = useState(0);
  const [ratingQuantity, setRatingQuantity] = useState(0);
  const [ratingQuality, setRatingQuality] = useState(0);
  const [ratingVariety, setRatingVariety] = useState(0);
  const [comment, setComment] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string; onDismiss?: () => void } | null>(null);

  // The deep-link route from the pickup-confirmed notification only carries
  // whatever fields the notification payload happened to stamp — and several
  // of those (basket_image, basket_name, location_logo) are absent on older
  // notifications. To always show a real basket photo in the order-summary
  // card, fall back to the user's reservation list cache and pull the
  // matching row's image/name/logo from there. Cheap: this query is the
  // same key the /orders tab uses, so we typically get the cached array
  // for free without hitting the network.
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
  // Resolved image / name / logo — prefer the deep-link param, fall back
  // through every common shape the reservation row can carry. Without
  // these fallbacks the customer saw the placeholder `ShoppingBag` icon
  // because `basketImage` came in as an empty string from the notif.
  // basket_image_url is the field the /reservations/my endpoint actually
  // returns (joined from baskets.image_url) — the old chain checked
  // r.basket_image (no _url) and missed it, which is why the card kept
  // falling back to the ShoppingBag placeholder even when the reservation
  // had a perfectly good basket photo cached.
  const resolvedBasketImage =
    (basketImage && basketImage.trim()) ||
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
    || r?.location_name
    || r?.basket?.merchantName
    || r?.basket?.merchant_name
    || null;
  const resolvedLocationLogo =
    (locationLogo && locationLogo.trim())
    || r?.restaurant?.image_url
    || r?.basket?.merchantLogo
    || r?.basket?.merchant_logo
    || null;

  // We store the picked image as a data URL (data:image/jpeg;base64,…) so it can
  // be submitted directly to the backend, which uploads data URLs to Cloudinary.
  // The data URL also works as <Image source={{ uri }} /> input, so we reuse the
  // same state for both preview and upload.
  const assetToDataUrl = (asset: ImagePicker.ImagePickerAsset): string | null => {
    if (!asset.base64) return null;
    const mime = asset.mimeType || 'image/jpeg';
    return `data:${mime};base64,${asset.base64}`;
  };

  const launchLibrary = async () => {
    // Custom limited-access-aware grid (handles its own permission popup).
    const res = await pickPhoto({ base64: true });
    if (res?.dataUrl) setSelectedImage(res.dataUrl);
  };

  const launchCamera = async () => {
    if (!(await ensureCameraAccess())) return;
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7, base64: true });
    if (!result.canceled && result.assets?.[0]) {
      const dataUrl = assetToDataUrl(result.assets[0]);
      if (dataUrl) setSelectedImage(dataUrl);
    }
  };

  const pickImage = () => {
    // Branded Barakeat sheet popup (was a native Alert.alert ActionSheet
    // that looked generic on both platforms). Cancel row removed per the
    // user — the sheet's backdrop tap + swipe-down already serve as a
    // dismiss path, so a third "Annuler" button was redundant.
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

  const overallRating = Math.round(
    (ratingService + ratingQuantity + ratingQuality + ratingVariety) / 4
  );

  const mutation = useMutation({
    mutationFn: () => {
      const numericLocationId = Number(locationId);
      // Hard guard — never allow submitting with an invalid id
      if (!Number.isFinite(numericLocationId) || numericLocationId <= 0) {
        return Promise.reject(new Error('Invalid location ID — cannot submit review.'));
      }
      return submitReview({
        location_id: numericLocationId,
        reservation_id: reservationId ? Number(reservationId) : undefined,
        rating: overallRating,
        rating_service: ratingService,
        rating_quantity: ratingQuantity,
        rating_quality: ratingQuality,
        rating_variety: ratingVariety,
        comment: comment.trim() || undefined,
        // Backend expects a data URL (data:image/…;base64,…) — selectedImage is now
        // stored in that form after the fix above. Previously we sent a local file
        // URI under the wrong field name and the photo was silently dropped.
        image_data_url: selectedImage || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      setToastMsg({ type: 'success', text: t('review.success'), onDismiss: () => router.back() });
    },
    onError: (err) => {
      // Ghost-success: if the backend says "you already reviewed this", the
      // user's first attempt actually committed and the second hit landed on
      // the dup guard. Show success copy — the review IS saved server-side.
      if (isActionAlreadyDoneError(err, 'review')) {
        void queryClient.invalidateQueries({ queryKey: ['reservations'] });
        setToastMsg({ type: 'success', text: t('review.success'), onDismiss: () => router.back() });
        return;
      }
      setToastMsg({ type: 'error', text: t('review.error') });
    },
  });

  const canSubmit =
    ratingService > 0 && ratingQuantity > 0 && ratingQuality > 0 && ratingVariety > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    mutation.mutate();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.header, { padding: theme.spacing.xl }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
            <X size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
            {t('review.title')}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={[{ padding: theme.spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Order summary — single card. Image on the left; basket
              name on top of the right column with the org logo + name
              tucked underneath as a small caption row (so the user's
              eye lands on the basket first, with the venue as context).
              Resolved fields come from a fallback chain that falls
              back to the cached reservation row when the deep-link
              params are empty (older notifs miss basket_image etc). */}
          <OrderSummaryCard
            basketImage={resolvedBasketImage}
            basketName={resolvedBasketName}
            locationLogo={resolvedLocationLogo}
            locationName={resolvedLocationName}
            quantity={quantity ? Number(quantity) : undefined}
            total={total ? Number(total) : undefined}
            orderId={reservationId ?? null}
          />


          <Text
            style={[
              {
                color: theme.colors.textPrimary,
                ...theme.typography.h3,
                marginBottom: theme.spacing.md,
              },
            ]}
          >
            {t('review.rateExperience')}
          </Text>

          <View
            style={[
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                padding: theme.spacing.lg,
                marginBottom: theme.spacing.lg,
                ...theme.shadows.shadowSm,
              },
            ]}
          >
            <StarRatingRow
              label={t('basket.reviewService')}
              value={ratingService}
              onChange={setRatingService}
              required
            />
            <StarRatingRow
              label={t('basket.reviewQuantite')}
              value={ratingQuantity}
              onChange={setRatingQuantity}
              required
            />
            <StarRatingRow
              label={t('basket.reviewQualite')}
              value={ratingQuality}
              onChange={setRatingQuality}
              required
            />
            <StarRatingRow
              label={t('basket.reviewVariete')}
              value={ratingVariety}
              onChange={setRatingVariety}
              required
            />
          </View>

          <Text
            style={[
              {
                color: theme.colors.textPrimary,
                ...theme.typography.body,
                marginBottom: theme.spacing.sm,
              },
            ]}
          >
            {t('review.comment', { defaultValue: 'Comment (optional)' })}
          </Text>
          <TextInput
            style={[
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                padding: theme.spacing.lg,
                color: theme.colors.textPrimary,
                ...theme.typography.body,
                minHeight: 100,
                textAlignVertical: 'top',
                ...theme.shadows.shadowSm,
              },
            ]}
            placeholder={t('review.commentPlaceholder', { defaultValue: 'Share your experience...' })}
            placeholderTextColor={theme.colors.muted}
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={500}
          />

          {/* Photo upload — same shape as claim.tsx: section subtitle on top,
              identical dark-green button below. The "(optionnel)" lives in
              the subtitle here; the button copy itself is the action, not
              the optionality flag. */}
          <View style={{ marginTop: theme.spacing.xl }}>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', marginBottom: 8 }}>
              {t('review.addPhotoLabel', { defaultValue: 'Ajouter une photo (optionnel)' })}
            </Text>
            {/* Ghost-style photo button — light surface + primary-coloured icon
                and label, with a subtle primary-tinted border. Distinct from
                the filled dark-green submit CTA at the bottom of the form so
                the user can tell "optional attachment" apart from "send". */}
            <TouchableOpacity
              onPress={pickImage}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                backgroundColor: theme.colors.surface,
                borderWidth: 1.5,
                borderColor: theme.colors.primary + '40',
                borderRadius: theme.radii.r16,
                paddingVertical: 16,
                paddingHorizontal: 16,
              }}
            >
              <Camera size={20} color={theme.colors.primary} />
              <Text
                style={{
                  color: theme.colors.primary,
                  ...theme.typography.body,
                  fontWeight: '600',
                }}
              >
                {t('common.insertOrTakePhoto', { defaultValue: 'Insérer ou prendre une photo' })}
              </Text>
            </TouchableOpacity>
            <Text style={{ color: theme.colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8, paddingHorizontal: 4 }}>
              {t('review.photoWarning', { defaultValue: 'En ajoutant une photo, vous acceptez qu\'elle puisse \u00eatre utilis\u00e9e pour promouvoir Barakeat sur nos r\u00e9seaux sociaux et supports marketing.' })}
            </Text>

            {selectedImage && (
              <View
                style={{
                  marginTop: theme.spacing.md,
                  alignItems: 'flex-start',
                }}
              >
                <View style={{ position: 'relative' }}>
                  <Image
                    source={{ uri: selectedImage }}
                    style={{
                      width: 120,
                      height: 120,
                      borderRadius: theme.radii.r16,
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => setSelectedImage(null)}
                    style={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      backgroundColor: '#114b3c',
                      borderRadius: 12,
                      width: 24,
                      height: 24,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={14} color="#e3ff5c" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: theme.colors.surface,
              paddingHorizontal: theme.spacing.xl,
              paddingVertical: theme.spacing.lg,
              borderTopWidth: 1,
              borderTopColor: theme.colors.divider,
              ...theme.shadows.shadowLg,
            },
          ]}
        >
          <PrimaryCTAButton
            onPress={handleSubmit}
            title={t('review.submit')}
            loading={mutation.isPending}
            disabled={!canSubmit}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Toast modal */}
      <Modal visible={!!toastMsg} transparent animationType="fade" onRequestClose={() => { toastMsg?.onDismiss?.(); setToastMsg(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: toastMsg?.type === 'success' ? '#114b3c18' : '#ef444418', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              {toastMsg?.type === 'success' ? <CheckCircle2 size={28} color="#114b3c" /> : <BarakeatErrorIcon size={28} color="#ef4444" />}
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {toastMsg?.type === 'success' ? t('common.success') : t('auth.error')}
            </Text>
            <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              {toastMsg?.text}
            </Text>
            <TouchableOpacity
              onPress={() => { toastMsg?.onDismiss?.(); setToastMsg(null); }}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>OK</Text>
            </TouchableOpacity>
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
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  footer: {},
});
