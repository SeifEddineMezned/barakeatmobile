import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Phone, Navigation, ChevronLeft } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { DiscountBadge } from '@/src/components/DiscountBadge';
import { Chip } from '@/src/components/Chip';
import { mockBaskets } from '@/src/mocks/baskets';

export default function BasketDetailsScreen() {
  const { id } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const basket = useMemo(() => mockBaskets.find((b) => b.id === id), [id]);

  if (!basket) {
    return null;
  }

  const handleReserve = () => {
    router.push({ pathname: '/reserve', params: { basketId: basket.id } });
  };

  const handleCall = () => {
    Linking.openURL(`tel:+21612345678`);
  };

  const handleDirections = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${basket.latitude},${basket.longitude}`;
    Linking.openURL(url);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.heroContainer}>
          {basket.imageUrl ? (
            <Image source={{ uri: basket.imageUrl }} style={styles.heroImage} />
          ) : (
            <View style={[styles.heroPlaceholder, { backgroundColor: theme.colors.primaryLight }]} />
          )}
          <View style={[styles.badgeOverlay, { top: 60, left: theme.spacing.xl }]}>
            <DiscountBadge percentage={basket.discountPercentage} />
          </View>
          <TouchableOpacity
            style={[
              styles.backButton,
              { top: 60, left: theme.spacing.xl, backgroundColor: theme.colors.surface, ...theme.shadows.shadowMd },
            ]}
            onPress={() => router.back()}
          >
            <ChevronLeft size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={[styles.content, { padding: theme.spacing.xl }]}>
          <View style={styles.merchantRow}>
            {basket.merchantLogo ? (
              <Image source={{ uri: basket.merchantLogo }} style={styles.merchantLogo} />
            ) : (
              <View style={[styles.merchantLogo, { backgroundColor: theme.colors.divider }]} />
            )}
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body }]}>
              {basket.merchantName}
            </Text>
          </View>

          <Text
            style={[
              styles.basketName,
              { color: theme.colors.textPrimary, ...theme.typography.h1, marginTop: theme.spacing.md },
            ]}
          >
            {basket.name}
          </Text>

          <View style={[styles.chipsRow, { marginTop: theme.spacing.lg }]}>
            <Chip
              label={`${basket.pickupWindow.start} - ${basket.pickupWindow.end}`}
              icon={<Clock size={14} color={theme.colors.textSecondary} />}
            />
            <Chip label={`${basket.quantityLeft} ${t('basket.quantity', { count: basket.quantityLeft })}`} />
            <Chip label={t('basket.payOnPickup')} variant="filled" />
          </View>

          <View
            style={[
              styles.priceBlock,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                padding: theme.spacing.xl,
                marginTop: theme.spacing.xl,
                ...theme.shadows.shadowMd,
              },
            ]}
          >
            <View style={styles.priceRow}>
              <View>
                <Text style={[{ color: theme.colors.muted, ...theme.typography.bodySm }]}>
                  {t('basket.pickupWindow')}
                </Text>
                <Text
                  style={[
                    {
                      color: theme.colors.textPrimary,
                      ...theme.typography.h3,
                      marginTop: theme.spacing.xs,
                    },
                  ]}
                >
                  {basket.pickupWindow.start} - {basket.pickupWindow.end}
                </Text>
              </View>
              <View style={styles.priceRight}>
                <Text
                  style={[
                    {
                      color: theme.colors.muted,
                      ...theme.typography.body,
                      textDecorationLine: 'line-through',
                      textAlign: 'right',
                    },
                  ]}
                >
                  {basket.originalPrice} TND
                </Text>
                <Text
                  style={[
                    {
                      color: theme.colors.primary,
                      ...theme.typography.h1,
                      fontWeight: '700' as const,
                      textAlign: 'right',
                    },
                  ]}
                >
                  {basket.discountedPrice} TND
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.section, { marginTop: theme.spacing.xxl }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
              {t('basket.whatYouMightGet')}
            </Text>
            <View style={styles.itemsGrid}>
              {basket.exampleItems.map((item, index) => (
                <View
                  key={index}
                  style={[
                    styles.itemChip,
                    {
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.radii.r8,
                      padding: theme.spacing.md,
                      ...theme.shadows.shadowSm,
                    },
                  ]}
                >
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>{item}</Text>
                </View>
              ))}
            </View>
            <Text
              style={[
                {
                  color: theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                  marginTop: theme.spacing.md,
                  fontStyle: 'italic',
                },
              ]}
            >
              {t('basket.surpriseNote')}
            </Text>
          </View>

          <View style={[styles.section, { marginTop: theme.spacing.xxl }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.md }]}>
              {t('basket.merchantInfo')}
            </Text>
            <View
              style={[
                styles.merchantInfoCard,
                {
                  backgroundColor: theme.colors.surface,
                  borderRadius: theme.radii.r16,
                  padding: theme.spacing.xl,
                  ...theme.shadows.shadowSm,
                },
              ]}
            >
              <View style={[styles.infoRow, { marginBottom: theme.spacing.lg }]}>
                <MapPin size={20} color={theme.colors.textSecondary} />
                <View style={styles.infoText}>
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm }]}>
                    {t('basket.address')}
                  </Text>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginTop: theme.spacing.xs }]}>
                    {basket.address}
                  </Text>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    {
                      backgroundColor: theme.colors.bg,
                      borderRadius: theme.radii.r12,
                      padding: theme.spacing.md,
                      flex: 1,
                    },
                  ]}
                  onPress={handleCall}
                >
                  <Phone size={20} color={theme.colors.primary} />
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.bodySm, marginTop: theme.spacing.xs }]}>
                    {t('basket.call')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    {
                      backgroundColor: theme.colors.bg,
                      borderRadius: theme.radii.r12,
                      padding: theme.spacing.md,
                      flex: 1,
                    },
                  ]}
                  onPress={handleDirections}
                >
                  <Navigation size={20} color={theme.colors.primary} />
                  <Text style={[{ color: theme.colors.primary, ...theme.typography.bodySm, marginTop: theme.spacing.xs }]}>
                    {t('basket.directions')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={[styles.partnerBadge, { marginTop: theme.spacing.xl, marginBottom: theme.spacing.xxl }]}>
            <Text
              style={[
                {
                  color: theme.colors.secondary,
                  ...theme.typography.bodySm,
                  textAlign: 'center',
                  fontWeight: '600' as const,
                },
              ]}
            >
              ✓ {t('basket.partnerBadge')}
            </Text>
          </View>
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
          onPress={handleReserve}
          title={t('basket.reserveBasket')}
          disabled={basket.quantityLeft === 0}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  heroContainer: {
    position: 'relative',
    width: '100%',
    height: 300,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
  },
  badgeOverlay: {
    position: 'absolute',
  },
  backButton: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {},
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  merchantLogo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  basketName: {},
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priceBlock: {},
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceRight: {},
  section: {},
  itemsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemChip: {},
  merchantInfoCard: {},
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    marginLeft: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerBadge: {},
  footer: {},
});
