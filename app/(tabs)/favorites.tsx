import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Heart, Bookmark, Clock, ShoppingBag, TimerOff } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { BasketCard } from '@/src/components/BasketCard';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { fetchLocations } from '@/src/services/restaurants';
import { fetchBaskets } from '@/src/services/baskets';
import { normalizeLocationToBasket, normalizeRawBasketToBasket } from '@/src/utils/normalizeRestaurant';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { useAddressStore } from '@/src/stores/addressStore';
import { useStatusBarStyleOnFocus } from '@/src/hooks/useStatusBarStyleOnFocus';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useSplashStore } from '@/src/stores/splashStore';
import { buildDemoListingBasket, DEMO_LOCATION_ID } from '@/src/lib/demoData';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function PulsingHeart({ color }: { color: string }) {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);
  const fillOpacity = pulseAnim.interpolate({ inputRange: [1, 1.35], outputRange: [0, 1] });
  return (
    <View style={{ position: 'absolute', top: 8, right: 8 }}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Heart size={22} color={color} fill="transparent" />
      </Animated.View>
      <Animated.View style={{ position: 'absolute', opacity: fillOpacity }}>
        <Heart size={22} color={color} fill={color} />
      </Animated.View>
    </View>
  );
}

// Same scale-pulse + fade-in-fill loop as PulsingHeart, swapped to a Bookmark
// glyph so the saved-baskets empty state has a matching animated illustration
// instead of the previous static icon. Keeps the empty-state language
// consistent across the two favorites sub-tabs.
function PulsingBookmark({ color }: { color: string }) {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);
  const fillOpacity = pulseAnim.interpolate({ inputRange: [1, 1.35], outputRange: [0, 1] });
  return (
    <View style={{ position: 'absolute', top: 8, right: 8 }}>
      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
        <Bookmark size={22} color={color} fill="transparent" />
      </Animated.View>
      <Animated.View style={{ position: 'absolute', opacity: fillOpacity }}>
        <Bookmark size={22} color={color} fill={color} />
      </Animated.View>
    </View>
  );
}

/** Inline basket row card — same layout as in restaurant/[id].tsx */
function StarredBasketRow({ basket, onPress, onSavePress }: { basket: any; onPress: () => void; onSavePress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const soldOut = basket.quantityLeft <= 0;
  const pickupExpired = !soldOut && isPickupExpiredInTz(basket.pickupWindow?.end);
  const unavailable = soldOut || pickupExpired;

  // Bounce-on-press for the save (Bookmark) button. Timing (not spring) so
  // the duration is deterministic and visibly long enough to register —
  // earlier spring config completed so fast the user perceived "nothing
  // happened". 150ms scale-up + 200ms settle = 350ms total visible.
  // Toggle fires from the completion callback so the parent doesn't unmount
  // the card mid-animation.
  const saveAnim = useRef(new Animated.Value(1)).current;
  const handleSavePress = useCallback(() => {
    saveAnim.setValue(1);
    Animated.sequence([
      Animated.timing(saveAnim, { toValue: 1.5, duration: 150, useNativeDriver: true }),
      Animated.timing(saveAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onSavePress();
    });
  }, [saveAnim, onSavePress]);

  return (
    // Plain View so the bookmark TouchableOpacity isn't nested inside another
    // TouchableOpacity. Nested touchables on RN can race — the outer card's
    // activeOpacity dim + onPress sometimes won the touch, eating the inner
    // bounce. The inner pressable below carries the open-detail tap; the
    // bookmark sits next to it as a sibling.
    <View
      style={[
        {
          backgroundColor: unavailable ? '#f0f0f0' : theme.colors.surface,
          borderRadius: theme.radii.r16,
          marginBottom: 12,
          overflow: 'visible',
          opacity: unavailable ? 0.55 : 1,
          ...theme.shadows.shadowSm,
        },
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={{ flexDirection: 'row', borderRadius: theme.radii.r16 }}
      >
        {/* Status badge — bottom-right corner, anchored over the
            image. Was top-left, where it sat on top of the basket
            name and competed with it visually. Moving it to the
            bottom-right of the image puts it where the eye lands
            after scanning name → price → image, and the save
            (Bookmark) action still owns the card's top-right
            corner — no overlap. */}
        <View style={{
          position: 'absolute', bottom: 8, right: 8, zIndex: 2,
          backgroundColor: soldOut ? theme.colors.error : pickupExpired ? '#888' : theme.colors.primary,
          borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
          flexDirection: 'row', alignItems: 'center', gap: 4,
        }}>
          {pickupExpired && !soldOut
            ? <TimerOff size={12} color="#fff" />
            : <ShoppingBag size={12} color="#fff" />}
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
            {soldOut
              ? t('basket.soldOut')
              : pickupExpired
              ? t('orders.pickupEnded', { defaultValue: 'Expired' })
              : basket.quantityLeft}
          </Text>
        </View>

        {/* Left: text info */}
        <View style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
          <Text
            style={[{ color: unavailable ? theme.colors.muted : theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}
            numberOfLines={1}
          >
            {basket.name}
          </Text>
          <Text
            style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}
            numberOfLines={1}
          >
            {basket.merchantName}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }}>
            <Text style={[{ color: unavailable ? theme.colors.muted : theme.colors.primary, ...theme.typography.body, fontWeight: '700' as const }]}>
              {basket.discountedPrice} {t('common.currency', { defaultValue: 'TND' })}
            </Text>
            {basket.originalPrice > 0 && (
              <Text style={[{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through', marginLeft: 6 }]}>
                {basket.originalPrice} {t('common.currency', { defaultValue: 'TND' })}
              </Text>
            )}
          </View>
          {basket.pickupWindow?.start ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Clock size={11} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginLeft: 3 }}>
                {basket.pickupWindow.start}–{basket.pickupWindow.end}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Right: image */}
        <View style={{ width: 90, height: 90, alignSelf: 'center', marginRight: 10 }}>
          {basket.imageUrl ? (
            <Image
              source={{ uri: basket.imageUrl }}
              style={{ width: 90, height: 90, borderRadius: theme.radii.r12 }}
            />
          ) : (
            <View style={{ width: 90, height: 90, borderRadius: theme.radii.r12, backgroundColor: theme.colors.divider, justifyContent: 'center', alignItems: 'center' }}>
              <ShoppingBag size={28} color={theme.colors.muted} />
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Save (bookmark) action — sibling of the open-detail TouchableOpacity,
          NOT nested inside it. zIndex puts it above the press target so the
          tap registers here cleanly. Bounce-then-toggle (see handleSavePress). */}
      <TouchableOpacity
        onPress={handleSavePress}
        accessibilityLabel={t('favorites.removeFromFavorites', { defaultValue: 'Retirer des favoris' })}
        accessibilityRole="button"
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        activeOpacity={0.7}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          width: 32, height: 32, borderRadius: 16,
          backgroundColor: 'rgba(255,255,255,0.95)',
          alignItems: 'center', justifyContent: 'center',
          ...theme.shadows.shadowSm,
        }}
      >
        <Animated.View style={{ transform: [{ scale: saveAnim }] }}>
          <Bookmark size={17} color={theme.colors.primary} fill={theme.colors.primary} />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

export default function FavoritesScreen() {
  useStatusBarStyleOnFocus('dark');
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { favoriteBasketIds, starredBasketTypeIds, toggleBasketFavorite, toggleStarredBasketType, isBasketFavorite } = useFavoritesStore();
  const { addresses, selectedId } = useAddressStore();
  const demoAddress = useAddressStore((s) => s.demoAddress);
  const selectedAddr = demoAddress ?? addresses.find((a) => a.id === selectedId);
  const [activeTab, setActiveTab] = useState<'favorites' | 'starred'>('favorites');

  // Shares ['locations'] cache with home + map. 5-min staleTime.
  // Gated on `!showSplash` so the favorites tab can't fire its own pre-splash
  // fetch — without this, when the tabs layout pre-mounts both home and
  // favorites, the favorites query races the splash and burns a budget slot
  // on the rate limiter before home's coordinated boot-time prefetch lands.
  // Home is already gated this way; matching here means a single coordinated
  // burst after splash, not two cascades.
  const showSplash = useSplashStore((s) => s.showSplash);
  const locationsQuery = useQuery({
    queryKey: ['locations'],
    queryFn: fetchLocations,
    staleTime: 5 * 60_000,
    enabled: !showSplash,
  });

  const basketsQuery = useQuery({
    queryKey: ['baskets'],
    queryFn: fetchBaskets,
    staleTime: 60_000,
    enabled: starredBasketTypeIds.length > 0,
  });

  // During the customer demo, prepend a synthetic demo basket so the
  // Favorites tab can render the user's freshly-favorited demo location
  // even though the real backend doesn't carry the 'demo' id. Mirrors
  // app/(tabs)/index.tsx (lines 462-475) where the home feed prepends
  // the same demoListingBasket; without this the favorites tab landed
  // empty after the walkthrough's "tap the heart" step because the demo
  // location id never appears in locationsQuery.data.
  const demoCustomerActive = useWalkthroughStore((s) => s.demoCustomerActive);
  // Reset scroll to top THE MOMENT any demo arms (under the welcome cover,
  // before any halo paints). Tab screens preserve scroll across navigation,
  // so a user who scrolled favorites down and then triggered the demo would
  // otherwise see every subsequent favorites halo offset by their pre-demo
  // scroll position.
  const mainScrollRef = useRef<ScrollView>(null);
  const demoSequencePending = useWalkthroughStore((s) => s.demoSequencePending);
  useEffect(() => {
    if (!demoSequencePending) return;
    mainScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [demoSequencePending]);
  const demoListingBasket = useMemo(
    () => buildDemoListingBasket({
      merchantName: t('walkthrough.customer.demoLocationName', { defaultValue: 'Chez Joe (démo)' }),
      name: t('walkthrough.customer.demoBasketName', { defaultValue: 'Panier Surprise' }),
      description: t('walkthrough.customer.demoBasketDesc', { defaultValue: 'Démonstration — aucune commande réelle n\'est créée.' }),
    }),
    [t],
  );

  const allBaskets = useMemo(() => {
    const real = locationsQuery.data ? locationsQuery.data.map(normalizeLocationToBasket) : [];
    if (!demoCustomerActive) return real;
    // De-dup defensively: drop any incidental row that happens to share
    // the demo id, then prepend the synthetic entry.
    return [demoListingBasket, ...real.filter((b) => b.id !== DEMO_LOCATION_ID)];
  }, [locationsQuery.data, demoCustomerActive, demoListingBasket]);

  const addDistance = (basket: any) => {
    if (selectedAddr && basket.latitude && basket.longitude) {
      const dist = haversineKm(selectedAddr.lat, selectedAddr.lng, basket.latitude, basket.longitude);
      return { ...basket, distance: Math.round(dist * 10) / 10 };
    }
    return basket;
  };

  const favoriteBaskets = useMemo(
    () => allBaskets.filter((basket) => favoriteBasketIds.includes(basket.id)).map(addDistance),
    [allBaskets, favoriteBasketIds, selectedAddr]
  );

  const starredBaskets = useMemo(() => {
    if (!starredBasketTypeIds.length) return [];
    const fromAPI = (basketsQuery.data ?? [])
      .map((b: any) => normalizeRawBasketToBasket(b as any, undefined, {
        // Inherit location hours when the basket row is NULL (matches
        // backend convention; otherwise the normaliser would slap on the
        // hardcoded 18:00/19:00 default and show wrong pickup times).
        start: b?.location?.pickup_start_time ?? b?.location_pickup_start_time ?? b?.restaurant?.pickup_start_time ?? null,
        end: b?.location?.pickup_end_time ?? b?.location_pickup_end_time ?? b?.restaurant?.pickup_end_time ?? null,
      }))
      .filter((b) => starredBasketTypeIds.includes(b.id))
      .map(addDistance);
    if (fromAPI.length > 0) return fromAPI;
    return allBaskets.filter((b) => starredBasketTypeIds.includes(b.id)).map(addDistance);
  }, [basketsQuery.data, allBaskets, starredBasketTypeIds, selectedAddr]);

  const isEmpty = activeTab === 'favorites' ? favoriteBaskets.length === 0 : starredBaskets.length === 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      {/* Header */}
      <View style={{ paddingHorizontal: theme.spacing.xl, paddingTop: 50, paddingBottom: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>{t('favorites.title')}</Text>
          {activeTab === 'favorites' && favoriteBaskets.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary + '14', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, gap: 5 }}>
              <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{favoriteBaskets.length}</Text>
              <Heart size={14} color={theme.colors.primary} fill={theme.colors.primary} />
            </View>
          )}
          {activeTab === 'starred' && starredBaskets.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#e3ff5c33', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, gap: 5 }}>
              <Text style={{ color: theme.colors.primaryDark, fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{starredBaskets.length}</Text>
              <Bookmark size={14} color={theme.colors.primaryDark} fill={theme.colors.primaryDark} />
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
          <TouchableOpacity
            onPress={() => setActiveTab('favorites')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'favorites' }}
            style={{
              flex: 1, paddingVertical: 10, alignItems: 'center',
              borderBottomWidth: 2,
              borderBottomColor: activeTab === 'favorites' ? theme.colors.primary : 'transparent',
              marginBottom: -1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Heart size={15} color={activeTab === 'favorites' ? theme.colors.primary : theme.colors.textSecondary} fill={activeTab === 'favorites' ? theme.colors.primary : 'transparent'} />
              <Text style={{ color: activeTab === 'favorites' ? theme.colors.primary : theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: activeTab === 'favorites' ? '600' : '400' }}>
                {t('favorites.baskets')}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('starred')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'starred' }}
            style={{
              flex: 1, paddingVertical: 10, alignItems: 'center',
              borderBottomWidth: 2,
              borderBottomColor: activeTab === 'starred' ? theme.colors.primary : 'transparent',
              marginBottom: -1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Bookmark size={15} color={activeTab === 'starred' ? theme.colors.primary : theme.colors.textSecondary} fill={activeTab === 'starred' ? theme.colors.primary : 'transparent'} />
              <Text style={{ color: activeTab === 'starred' ? theme.colors.primary : theme.colors.textSecondary, ...theme.typography.bodySm, fontWeight: activeTab === 'starred' ? '600' : '400' }}>
                {t('favorites.starred')}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyTitle, { color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
            {activeTab === 'favorites' ? t('favorites.emptyTitle') : t('favorites.emptyStarredTitle')}
          </Text>
          <Text style={[styles.emptyDesc, { color: theme.colors.textSecondary, ...theme.typography.body, marginTop: theme.spacing.md }]}>
            {activeTab === 'favorites' ? t('favorites.emptyDesc') : t('favorites.emptyStarredDesc')}
          </Text>

          <View style={{ marginTop: 32, alignItems: 'center' }}>
            <View style={{
              width: 180, height: 130,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              ...theme.shadows.shadowMd,
              overflow: 'visible',
              position: 'relative',
            }}>
              <View style={{ height: 80, backgroundColor: theme.colors.divider, borderTopLeftRadius: theme.radii.r16, borderTopRightRadius: theme.radii.r16 }} />
              <View style={{ padding: 12 }}>
                <View style={{ width: 80, height: 8, borderRadius: 4, backgroundColor: theme.colors.divider }} />
                <View style={{ width: 50, height: 6, borderRadius: 3, backgroundColor: theme.colors.divider, marginTop: 6 }} />
              </View>
              {activeTab === 'favorites'
                ? <PulsingHeart color={theme.colors.primary} />
                : <PulsingBookmark color={theme.colors.primary} />}
            </View>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/(tabs)' as never)}
            style={[styles.ctaButton, {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r16,
              paddingVertical: theme.spacing.lg,
              paddingHorizontal: theme.spacing.xxxl,
              marginTop: theme.spacing.xxl,
            }]}
          >
            <Text style={[{ color: '#fff', ...theme.typography.button }]}>
              {t('favorites.findBasket')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          ref={mainScrollRef}
          style={styles.content}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'favorites'
            ? favoriteBaskets.map((basket) => (
                <BasketCard
                  key={basket.id}
                  basket={basket}
                  isFavorite={isBasketFavorite(basket.id)}
                  onFavoritePress={() => toggleBasketFavorite(basket.id)}
                />
              ))
            : starredBaskets.map((basket) => (
                <StarredBasketRow
                  key={basket.id}
                  basket={basket}
                  onPress={() => router.push(`/basket/${basket.id}` as never)}
                  onSavePress={() => toggleStarredBasketType(basket.id)}
                />
              ))
          }
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyDesc: {
    textAlign: 'center',
    lineHeight: 22,
  },
  ctaButton: {},
});
