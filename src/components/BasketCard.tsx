import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Heart, Clock, MapPin, Star, ShoppingBag } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
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

  const handlePressIn = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    router.push(`/basket/${basket.id}` as never);
  }, [basket.id, router]);

  const handleFavoritePress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
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

          <View style={[styles.bagsLeftBadge, { backgroundColor: bagsBgColor, borderRadius: theme.radii.r12 }]}>
            <ShoppingBag size={16} color={bagsCountColor} />
            <Text style={[styles.bagsLeftText, { color: bagsCountColor, ...theme.typography.bodySm, fontWeight: '700' as const, marginLeft: 5 }]}>
              {basket.quantityLeft}
            </Text>
          </View>

          {basket.merchantRating != null && (
            <View style={[styles.ratingBadge, { backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: theme.radii.r8 }]}>
              <Star size={12} color={theme.colors.starYellow} fill={theme.colors.starYellow} />
              <Text style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '700' as const, marginLeft: 3 }]}>
                {basket.merchantRating.toFixed(1)}
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={handleFavoritePress}
            style={[
              styles.favoriteButton,
              { backgroundColor: 'rgba(255,255,255,0.9)', ...theme.shadows.shadowSm },
            ]}
          >
            <Animated.View style={{ transform: [{ scale: favoriteAnim }] }}>
              <Heart
                size={18}
                color={isFavorite ? theme.colors.error : theme.colors.textSecondary}
                fill={isFavorite ? theme.colors.error : 'transparent'}
              />
            </Animated.View>
          </TouchableOpacity>
        </View>

        <View style={[styles.content, { padding: theme.spacing.sm, paddingHorizontal: theme.spacing.md }]}>
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
          </View>

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
  ratingBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  favoriteButton: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
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
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
  },
  inlineChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  priceBlock: {
    alignItems: 'flex-end',
  },
});
