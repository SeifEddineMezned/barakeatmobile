import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { X, Star } from 'lucide-react-native';
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
  const { restaurantId, reservationId } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [ratingService, setRatingService] = useState(0);
  const [ratingQuantity, setRatingQuantity] = useState(0);
  const [ratingQuality, setRatingQuality] = useState(0);
  const [ratingVariety, setRatingVariety] = useState(0);

  const overallRating = Math.round(
    (ratingService + ratingQuantity + ratingQuality + ratingVariety) / 4
  );

  const mutation = useMutation({
    mutationFn: () =>
      submitReview({
        restaurant_id: Number(restaurantId),
        reservation_id: reservationId ? Number(reservationId) : undefined,
        rating: overallRating,
        rating_service: ratingService,
        rating_quantity: ratingQuantity,
        rating_quality: ratingQuality,
        rating_variety: ratingVariety,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      Alert.alert(t('common.success'), t('review.success'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    },
    onError: () => {
      Alert.alert(t('common.error'), t('review.error'));
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
