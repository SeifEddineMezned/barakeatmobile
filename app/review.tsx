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
import { X, Star, Camera, XCircle, CheckCircle2 } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { submitReview } from '@/src/services/reviews';

function StarRatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        starStyles.row,
        {
          marginBottom: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
        },
      ]}
    >
      <Text
        style={[
          {
            color: theme.colors.textPrimary,
            ...theme.typography.body,
            flex: 1,
          },
        ]}
      >
        {label}
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
              size={28}
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
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [ratingService, setRatingService] = useState(0);
  const [ratingQuantity, setRatingQuantity] = useState(0);
  const [ratingQuality, setRatingQuality] = useState(0);
  const [ratingVariety, setRatingVariety] = useState(0);
  const [comment, setComment] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string; onDismiss?: () => void } | null>(null);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setToastMsg({ type: 'error', text: t('common.noPermission', { defaultValue: 'Permission refusée.' }) });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      setSelectedImage(result.assets[0].uri);
    }
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
        image_url: selectedImage || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      setToastMsg({ type: 'success', text: t('review.success'), onDismiss: () => router.back() });
    },
    onError: () => {
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
          <TouchableOpacity onPress={() => router.back()}>
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
          {/* Order details card */}
          {(basketImage || locationLogo || basketName || locationName) && (
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                padding: theme.spacing.lg,
                marginBottom: theme.spacing.xl,
                ...theme.shadows.shadowSm,
              }}
            >
              {/* Basket image */}
              {basketImage ? (
                <Image
                  source={{ uri: basketImage }}
                  style={{
                    width: '100%',
                    height: 160,
                    borderRadius: theme.radii.r16,
                    marginBottom: theme.spacing.md,
                  }}
                  resizeMode="cover"
                />
              ) : null}

              {/* Location row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.sm }}>
                {locationLogo ? (
                  <Image
                    source={{ uri: locationLogo }}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      marginRight: theme.spacing.sm,
                      backgroundColor: theme.colors.divider,
                    }}
                  />
                ) : null}
                {locationName ? (
                  <Text
                    style={{
                      color: theme.colors.textPrimary,
                      ...theme.typography.body, fontWeight: '700' as const,
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {locationName}
                  </Text>
                ) : null}
              </View>

              {/* Basket name, quantity, total */}
              {basketName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, flex: 1 }}>
                    {basketName}
                    {quantity && Number(quantity) > 0 ? ` x${quantity}` : ''}
                  </Text>
                  {total ? (
                    <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700' as const }}>
                      {Number(total).toFixed(2)} TND
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}

          <Text
            style={[
              {
                color: theme.colors.textPrimary,
                ...theme.typography.h3,
                marginBottom: theme.spacing.xl,
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
                padding: theme.spacing.xl,
                marginBottom: theme.spacing.xl,
                ...theme.shadows.shadowSm,
              },
            ]}
          >
            <StarRatingRow
              label={t('basket.reviewService')}
              value={ratingService}
              onChange={setRatingService}
            />
            <StarRatingRow
              label={t('basket.reviewQuantite')}
              value={ratingQuantity}
              onChange={setRatingQuantity}
            />
            <StarRatingRow
              label={t('basket.reviewQualite')}
              value={ratingQuality}
              onChange={setRatingQuality}
            />
            <StarRatingRow
              label={t('basket.reviewVariete')}
              value={ratingVariety}
              onChange={setRatingVariety}
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

          {/* Photo upload */}
          <View style={{ marginTop: theme.spacing.xl }}>
            <TouchableOpacity
              onPress={pickImage}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#114b3c',
                borderRadius: theme.radii.r16,
                padding: theme.spacing.lg,
                ...theme.shadows.shadowSm,
              }}
            >
              <Camera size={20} color="#e3ff5c" />
              <Text
                style={{
                  color: '#e3ff5c',
                  ...theme.typography.body,
                  marginLeft: theme.spacing.sm,
                  flex: 1,
                }}
              >
                {t('review.addPhoto', { defaultValue: 'Add a photo' })}
              </Text>
              <Text
                style={{
                  color: 'rgba(227, 255, 92, 0.6)',
                  ...theme.typography.caption,
                }}
              >
                {t('review.photoOptional', { defaultValue: 'Optional' })}
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
              {toastMsg?.type === 'success' ? <CheckCircle2 size={28} color="#114b3c" /> : <XCircle size={28} color="#ef4444" />}
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
