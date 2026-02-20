import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Heart, MapPin, Clock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Basket } from '@/src/types';
import { DiscountBadge } from './DiscountBadge';
import { Chip } from './Chip';

interface BasketCardProps {
  basket: Basket;
  onFavoritePress?: () => void;
  isFavorite?: boolean;
}

export function BasketCard({ basket, onFavoritePress, isFavorite = false }: BasketCardProps) {
  const theme = useTheme();
  const router = useRouter();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const favoriteAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    router.push(`/basket/${basket.id}`);
  }, [basket.id, router]);

  const handleFavoritePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Animated.sequence([
      Animated.spring(favoriteAnim, {
        toValue: 1.3,
        useNativeDriver: true,
      }),
      Animated.spring(favoriteAnim, {
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
    onFavoritePress?.();
  }, [favoriteAnim, onFavoritePress]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            ...theme.shadows.shadowMd,
          },
        ]}
      >
        <View style={styles.imageContainer}>
          {basket.imageUrl ? (
            <Image source={{ uri: basket.imageUrl }} style={styles.image} />
          ) : (
            <View
              style={[
                styles.imagePlaceholder,
                { backgroundColor: theme.colors.primaryLight, borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 },
              ]}
            />
          )}
          <View style={styles.badgeContainer}>
            <DiscountBadge percentage={basket.discountPercentage} />
          </View>
          <TouchableOpacity
            onPress={handleFavoritePress}
            style={[
              styles.favoriteButton,
              { backgroundColor: theme.colors.surface, ...theme.shadows.shadowSm },
            ]}
          >
            <Animated.View style={{ transform: [{ scale: favoriteAnim }] }}>
              <Heart
                size={20}
                color={isFavorite ? theme.colors.discount : theme.colors.textSecondary}
                fill={isFavorite ? theme.colors.discount : 'transparent'}
              />
            </Animated.View>
          </TouchableOpacity>
        </View>

        <View style={[styles.content, { padding: theme.spacing.lg }]}>
          <View style={styles.merchantRow}>
            {basket.merchantLogo ? (
              <Image source={{ uri: basket.merchantLogo }} style={styles.merchantLogo} />
            ) : (
              <View
                style={[
                  styles.merchantLogo,
                  { backgroundColor: theme.colors.divider },
                ]}
              />
            )}
            <Text
              style={[
                styles.merchantName,
                { color: theme.colors.textSecondary, ...theme.typography.bodySm },
              ]}
              numberOfLines={1}
            >
              {basket.merchantName}
            </Text>
          </View>

          <Text
            style={[
              styles.basketName,
              { color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: theme.spacing.xs },
            ]}
            numberOfLines={2}
          >
            {basket.name}
          </Text>

          <View style={[styles.chipsRow, { marginTop: theme.spacing.md }]}>
            <Chip
              label={`${basket.pickupWindow.start} - ${basket.pickupWindow.end}`}
              icon={<Clock size={12} color={theme.colors.textSecondary} />}
              size="sm"
            />
            <Chip
              label={`${basket.distance}km`}
              icon={<MapPin size={12} color={theme.colors.textSecondary} />}
              size="sm"
            />
            <Chip
              label={`${basket.quantityLeft} left`}
              size="sm"
              variant="filled"
            />
          </View>

          <View style={[styles.priceRow, { marginTop: theme.spacing.lg }]}>
            <View>
              <Text
                style={[
                  styles.originalPrice,
                  {
                    color: theme.colors.muted,
                    ...theme.typography.bodySm,
                    textDecorationLine: 'line-through',
                  },
                ]}
              >
                {basket.originalPrice} TND
              </Text>
              <Text
                style={[
                  styles.discountedPrice,
                  { color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const },
                ]}
              >
                {basket.discountedPrice} TND
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
    overflow: 'hidden',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    height: 180,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
  },
  badgeContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
  },
  favoriteButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {},
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  merchantLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  merchantName: {
    flex: 1,
  },
  basketName: {},
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  originalPrice: {},
  discountedPrice: {},
});
