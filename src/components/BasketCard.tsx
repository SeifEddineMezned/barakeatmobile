import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Heart, Clock, MapPin, Star, ShoppingBag, Tag, Layers, Info, X } from 'lucide-react-native';
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
  const [infoVisible, setInfoVisible] = useState(false);

  const isSoldOut = basket.quantityLeft <= 0;

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
    if (isSoldOut) return;
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim, isSoldOut]);

  const handlePressOut = useCallback(() => {
    if (isSoldOut) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim, isSoldOut]);

  const handlePress = useCallback(() => {
    if (isSoldOut) return;
    router.push(`/restaurant/${basket.merchantId}` as never);
  }, [basket.merchantId, router, isSoldOut]);

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

  // Badge: green when available, red when sold out
  const bagsBgColor = isSoldOut ? theme.colors.error : theme.colors.primary;
  const bagsCountColor = '#fff';

  const hasDescription = !!(basket.description && basket.description.trim().length > 0);

  return (
    <>
      <Animated.View style={[
        { opacity: entranceOpacity, transform: [{ translateY: entranceTranslateY }, { scale: scaleAnim }] },
        isSoldOut && styles.soldOutCard,
      ]}>
        <TouchableOpacity
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={isSoldOut ? 1 : 0.95}
          disabled={isSoldOut}
          style={[
            styles.card,
            {
              backgroundColor: isSoldOut ? '#f0f0f0' : theme.colors.surface,
              borderRadius: theme.radii.r16,
              ...theme.shadows.shadowMd,
            },
          ]}
        >
          {/* Image area — cover photo of the business */}
          <View style={styles.imageContainer}>
            {(basket.coverImageUrl || basket.imageUrl) ? (
              <Image
                source={{ uri: basket.coverImageUrl ?? basket.imageUrl }}
                style={[
                  styles.image,
                  { borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 },
                  isSoldOut && styles.soldOutImage,
                ]}
              />
            ) : (
              <View
                style={[
                  styles.imagePlaceholder,
                  { backgroundColor: isSoldOut ? '#d0d0d0' : theme.colors.bagsLeftBg, borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 },
                ]}
              />
            )}

            {/* Badges row — top left */}
            <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6 }}>
              {/* Bags left badge: green when available, red when sold out */}
              <View style={[
                styles.bagsLeftBadge,
                { backgroundColor: bagsBgColor, borderRadius: theme.radii.r12, position: 'relative', top: 0, left: 0 },
              ]}>
                <ShoppingBag size={16} color={bagsCountColor} />
                <Text style={[styles.bagsLeftText, { color: bagsCountColor, ...theme.typography.bodySm, fontWeight: '700' as const, marginLeft: 5 }]}>
                  {basket.quantityLeft}
                </Text>
              </View>
              {/* Basket types badge — only shown if > 1 type and not sold out */}
              {!isSoldOut && basket.basketTypeCount != null && basket.basketTypeCount > 1 && (
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#e3ff5c',
                  borderRadius: theme.radii.r12,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}>
                  <Layers size={14} color="#1a1a1a" />
                  <Text style={{ color: '#1a1a1a', ...theme.typography.bodySm, fontWeight: '700' as const, marginLeft: 5 }}>
                    {basket.basketTypeCount}
                  </Text>
                </View>
              )}
            </View>

            {/* Top-right buttons row: info + heart */}
            <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 6 }}>
              {/* Info button — only shown if description exists */}
              {hasDescription && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation(); setInfoVisible(true); }}
                  style={[
                    styles.iconButton,
                    { backgroundColor: 'rgba(255,255,255,0.92)', ...theme.shadows.shadowSm },
                  ]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Info size={16} color={theme.colors.primary} />
                </TouchableOpacity>
              )}
              {/* Heart (favorite) button */}
              <TouchableOpacity
                onPress={handleFavoritePress}
                style={[
                  styles.iconButton,
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

            {/* Sold-out overlay label */}
            {isSoldOut && (
              <View style={styles.soldOutOverlay}>
                <View style={styles.soldOutLabel}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                    Sold Out
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Content area */}
          <View style={[styles.content, { padding: theme.spacing.sm, paddingHorizontal: theme.spacing.md }]}>
            {/* Merchant row: logo + name + rating */}
            <View style={styles.merchantRow}>
              {basket.merchantLogo ? (
                <Image source={{ uri: basket.merchantLogo }} style={[styles.merchantLogo, isSoldOut && { opacity: 0.5 }]} />
              ) : (
                <View style={[styles.merchantLogo, { backgroundColor: theme.colors.divider }]} />
              )}
              <View style={styles.merchantInfo}>
                <Text
                  style={[{ color: isSoldOut ? theme.colors.muted : theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}
                  numberOfLines={1}
                >
                  {basket.merchantName}
                </Text>
              </View>
              {/* Rating */}
              {basket.merchantRating != null && (
                <View style={[styles.ratingChip, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r8 }]}>
                  <Star size={11} color={theme.colors.starYellow} fill={theme.colors.starYellow} />
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '700' as const, marginLeft: 3 }]}>
                    {basket.merchantRating.toFixed(1)}
                  </Text>
                  {basket.reviewCount != null && basket.reviewCount > 0 && (
                    <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, marginLeft: 2 }]}>
                      ({basket.reviewCount})
                    </Text>
                  )}
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
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  {basket.basketTypeCount != null && basket.basketTypeCount > 1 && (
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginRight: 3 }]}>
                      from
                    </Text>
                  )}
                  <Text style={[{ color: isSoldOut ? theme.colors.muted : theme.colors.primary, ...theme.typography.h2, fontWeight: '700' as const }]}>
                    {basket.discountedPrice} TND
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {/* Description Info Modal */}
      <Modal
        visible={infoVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setInfoVisible(false)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setInfoVisible(false)}
        >
          <View style={styles.modalSheet}>
            {/* Handle */}
            <View style={styles.modalHandle} />
            {/* Header */}
            <View style={styles.modalHeader}>
              {basket.merchantLogo ? (
                <Image source={{ uri: basket.merchantLogo }} style={styles.modalLogo} />
              ) : (
                <View style={[styles.modalLogo, { backgroundColor: '#e8f5f2', justifyContent: 'center', alignItems: 'center' }]}>
                  <ShoppingBag size={20} color="#114b3c" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} numberOfLines={2}>{basket.merchantName}</Text>
                {basket.category && basket.category !== 'Tous' && (
                  <Text style={styles.modalCategory}>{basket.category}</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setInfoVisible(false)} style={styles.modalCloseBtn}>
                <X size={18} color="#6b6b6b" />
              </TouchableOpacity>
            </View>
            {/* Divider */}
            <View style={styles.modalDivider} />
            {/* Description */}
            <View style={styles.modalDescriptionContainer}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalDescription}>
                  {basket.description && basket.description.trim().length > 0
                    ? basket.description
                    : 'No description available.'}
                </Text>
              </ScrollView>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    overflow: 'hidden',
  },
  soldOutCard: {
    opacity: 0.6,
  },
  soldOutImage: {
    opacity: 0.5,
  },
  soldOutOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  soldOutLabel: {
    backgroundColor: 'rgba(217,79,79,0.88)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  bagsLeftText: {},
  iconButton: {
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
  // Info modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 12,
    maxHeight: '60%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e0e0e0',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  modalLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
    color: '#1a1a1a',
    lineHeight: 22,
  },
  modalCategory: {
    fontSize: 12,
    color: '#6b6b6b',
    fontFamily: 'Poppins_400Regular',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#e8e8e3',
    marginBottom: 16,
  },
  modalDescriptionContainer: {
    maxHeight: 200,
  },
  modalDescription: {
    fontSize: 14,
    lineHeight: 22,
    color: '#3a3a3a',
    fontFamily: 'Poppins_400Regular',
  },
});
