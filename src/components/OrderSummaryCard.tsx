/**
 * OrderSummaryCard — compact "this is the order this screen refers to"
 * panel used at the top of the leave-a-review screen AND the report-an-
 * issue screen, so both surfaces read as siblings instead of one being
 * a fat card and the other being a one-line text caption.
 *
 * Layout: 48 px basket thumbnail on the left (falls back to a tinted
 * ShoppingBag placeholder when no image URL resolved). On the right the
 * basket name on top with the org logo + name as a small caption row
 * tucked under it. If quantity OR total is provided, a divider separates
 * the header row from the metric chips beneath it; rows that have no
 * value just render nothing, so a card with only image + name still
 * looks complete (no awkward empty divider line).
 *
 * Sizing knobs (image, paddings, font weights) are deliberately one tier
 * smaller than the prior implementations because the user asked for the
 * card to take less vertical space on the review screen.
 */
import React from 'react';
import { View, Text, Image } from 'react-native';
import { ShoppingBag, Banknote } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { orderIdToCode } from '@/src/utils/orderCode';

interface Props {
  basketImage?: string | null;
  basketName?: string | null;
  locationLogo?: string | null;
  locationName?: string | null;
  quantity?: number;
  total?: number;
  /** Reservation id — rendered as a BK-XXXXX pill in the top-right
   *  corner so both parties (customer + business) immediately see
   *  which order this surface refers to. Pill is hidden when null. */
  orderId?: number | string | null;
}

export function OrderSummaryCard({
  basketImage,
  basketName,
  locationLogo,
  locationName,
  quantity,
  total,
  orderId,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (!basketImage && !basketName && !locationLogo && !locationName && !quantity && !total && !orderId) {
    return null;
  }
  const orderCode = (orderId != null && orderId !== '')
    ? orderIdToCode(Number(orderId))
    : null;
  const hasMetrics = (quantity && quantity > 0) || (total && Number(total) > 0);
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.r16,
        padding: 10,
        marginBottom: theme.spacing.md,
        ...theme.shadows.shadowSm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {basketImage ? (
          <Image
            source={{ uri: basketImage }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.colors.divider,
            }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              backgroundColor: theme.colors.primary + '12',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShoppingBag size={20} color={theme.colors.primary} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            {basketName ? (
              <Text
                style={{
                  flex: 1,
                  color: theme.colors.textPrimary,
                  ...theme.typography.bodySm,
                  fontWeight: '700' as const,
                }}
                numberOfLines={2}
              >
                {basketName}
              </Text>
            ) : <View style={{ flex: 1 }} />}
            {orderCode ? (
              <View
                style={{
                  backgroundColor: theme.colors.primary + '15',
                  borderRadius: 6,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  marginTop: 1,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.primary,
                    ...theme.typography.caption,
                    fontWeight: '700' as const,
                    letterSpacing: 0.3,
                  }}
                >
                  {orderCode}
                </Text>
              </View>
            ) : null}
          </View>
          {(locationLogo || locationName) ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                marginTop: 2,
              }}
            >
              {locationLogo ? (
                <Image
                  source={{ uri: locationLogo }}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: theme.colors.divider,
                  }}
                />
              ) : null}
              {locationName ? (
                <Text
                  style={{
                    flex: 1,
                    color: theme.colors.textSecondary,
                    ...theme.typography.caption,
                    fontWeight: '600' as const,
                  }}
                  numberOfLines={1}
                >
                  {locationName}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      {hasMetrics ? (
        <View
          style={{
            height: 1,
            backgroundColor: theme.colors.divider,
            marginTop: 8,
            marginBottom: 6,
          }}
        />
      ) : null}
      {hasMetrics ? (
        // Two metric blocks sit side-by-side under the divider. Dropped the
        // earlier `flex: 1` per column + `flex: 1` per inner Text — that
        // forced each metric to claim half the card width and pushed the
        // two values to opposite ends of the row, leaving a wide visual gap
        // in the middle. Now each metric is intrinsically-sized (icon +
        // label only), and the row uses a fixed `gap: 18` so both metrics
        // cluster together on the left, naturally close to each other.
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 18,
            paddingVertical: 4,
            flexWrap: 'wrap',
          }}
        >
          {quantity && quantity > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: '#114b3c',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <ShoppingBag size={10} color="#e3ff5c" />
              </View>
              <Text
                style={{
                  color: theme.colors.textPrimary,
                  ...theme.typography.caption,
                  fontWeight: '600' as const,
                }}
                numberOfLines={1}
              >
                {quantity} {quantity > 1
                  ? t('basket.baskets', { defaultValue: 'paniers' })
                  : t('basket.basket', { defaultValue: 'panier' })}
              </Text>
            </View>
          ) : null}
          {total && total > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: '#114b3c',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Banknote size={10} color="#e3ff5c" />
              </View>
              <Text
                style={{
                  color: theme.colors.textPrimary,
                  ...theme.typography.caption,
                  fontWeight: '600' as const,
                }}
                numberOfLines={1}
              >
                {Number(total).toFixed(2)} TND
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
