import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Heart, Clock, MapPin, Star, ShoppingBag, Tag } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { Basket } from '@/src/types';

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
  const entranceOpacity = React.useRef(new Animated.Value(0)).current;
  const entranceTranslateY = React.useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(entranceOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.timing(entranceTranslateY, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
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
    router.push(`/restaurant/${basket.merchantId}` as never);
  }, [basket.merchantId, router]);

  const handleFavoritePress = useCallback(() => {
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

  const isLowStock = basket.quantityLeft > 0 && basket.quantityLeft < 3;
  const bagsCountColor = isLowStock ? '#1a1a1a' : '#fff';
  const bagsBgColor = isLowStock ? theme.colors.secondary : theme.colors.primary;

  return (
    <Animated.View style={{ opacity: entranceOpacity, transform: [{ translateY: entranceTranslateY }, { scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.95}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            ...theme.shadows.shadowMd,
          },
        ]}
      >
        {/* Image area */}
        <View style={styles.imageContainer}>
          {basket.imageUrl ? (
            <Image source={{ uri: basket.imageUrl }} style={[styles.image, { borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 }]} />
          ) : (
            <View
              style={[
                styles.imagePlaceholder,
                { backgroundColor: theme.colors.bagsLeftBg, borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 },
              ]}
            />
          )}

          {/* Bags left badge — top left */}
          <View style={[styles.bagsLeftBadge, { backgroundColor: bagsBgColor, borderRadius: theme.radii.r12 }]}>
            <ShoppingBag size={16} color={bagsCountColor} />
            <Text style={[styles.bagsLeftText, { color: bagsCountColor, ...theme.typography.bodySm, fontWeight: '700' as const, marginLeft: 5 }]}>
              {basket.quantityLeft}
            </Text>
          </View>

          {/* Heart button — top right */}
          <TouchableOpacity
            onPress={handleFavoritePress}
            style={[
              styles.favoriteButton,
              { backgroundColor: 'rgba(255,255,255,0.92)', ...theme.shadows.shadowSm },
            ]}
          >
            <Animated.View style={{ transform: [{ scale: favoriteAnim }] }}>
              <Heart
                size={17}
                color={isFavorite ? theme.colors.error : theme.colors.textSecondary}
                fill={isFavorite ? theme.colors.error : 'transparent'}
              />
            </Animated.View>
          </TouchableOpacity>
        </View>

        {/* Content area */}
        <View style={[styles.content, { padding: theme.spacing.sm, paddingHorizontal: theme.spacing.md }]}>
          {/* Merchant row: logo + name + rating */}
          <View style={styles.merchantRow}>
            {basket.merchantLogo ? (
              <Image source={{ uri: basket.merchantLogo }} style={styles.merchantLogo} />
            ) : (
              <View style={[styles.merchantLogo, { backgroundColor: theme.colors.divider }]} />
            )}
            <View style={styles.merchantInfo}>
              <Text
                style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}
                numberOfLines={1}
              >
                {basket.merchantName}
              </Text>
            </View>
            {/* Rating — right side of merchant row */}
            {basket.merchantRating != null && (
              <View style={[styles.ratingChip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r8 }]}>
                <Star size={11} color={theme.colors.starYellow} fill={theme.colors.starYellow} />
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '700' as const, marginLeft: 3 }]}>
                  {basket.merchantRating.toFixed(1)}
                </Text>
              </View>
            )}
          </View>

          {/* Category row */}
          {basket.category && basket.category !== 'Tous' && (
            <View style={[styles.categoryRow, { marginTop: 3 }]}>
              <Tag size={10} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 4 }]} numberOfLines={1}>
                {basket.category}
              </Text>
            </View>
          )}

          {/* Details row: chips + price */}
          <View style={[styles.detailsRow, { marginTop: theme.spacing.xs }]}>
            <View style={styles.chipRow}>
              <View style={[styles.inlineChip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 }]}>
                <Clock size={11} color={theme.colors.textSecondary} />
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }]}>
                  {basket.pickupWindow.start}-{basket.pickupWindow.end}
                </Text>
              </View>
              <View style={[styles.inlineChip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.pill, paddingHorizontal: 8, paddingVertical: 3 }]}>
                <MapPin size={11} color={theme.colors.textSecondary} />
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }]}>
                  {basket.distance}km
                </Text>
              </View>
            </View>
            <View style={styles.priceBlock}>
              <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through' }]}>
                {basket.originalPrice} TND
              </Text>
              <Text style={[{ color: theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const }]}>
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
    marginBottom: 12,
    overflow: 'hidden',
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    height: 120,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
  },
  bagsLeftBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  bagsLeftText: {},
  favoriteButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {},
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  merchantLogo: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
  },
  merchantInfo: {
    flex: 1,
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginLeft: 6,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 38,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flex: 1,
  },
  inlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceBlock: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
});
