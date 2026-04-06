import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Alert, Modal, TextInput, Animated } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { isPickupExpiredInTz } from '@/src/utils/timezone';
import { MapPin, Clock, Navigation, ChevronLeft, Star, ShoppingBag, RefreshCw, Flag, X, Tag, Package, Bookmark, AlertTriangle } from 'lucide-react-native';
import { useFavoritesStore } from '@/src/stores/favoritesStore';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchBasketById } from '@/src/services/baskets';
import { normalizeRawBasketToBasket } from '@/src/utils/normalizeRestaurant';
import { submitReport } from '@/src/services/reports';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { apiClient } from '@/src/lib/api';
import { DelayedLoader } from '@/src/components/DelayedLoader';

const HERO_FULL = 240;
const HERO_MINI = 88;

interface ReviewBarProps {
  label: string;
  value: number;
  color: string;
}

function ReviewBar({ label, value, color }: ReviewBarProps) {
  const theme = useTheme();
  const percentage = (value / 5) * 100;

  return (
    <View style={reviewStyles.row}>
      <Text style={[reviewStyles.label, { color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
        {label} <Text style={{ fontWeight: '700' as const }}>{value.toFixed(1)}</Text>
      </Text>
      <View style={[reviewStyles.barBg, { backgroundColor: theme.colors.divider, borderRadius: 4 }]}>
        <View style={[reviewStyles.barFill, { width: `${percentage}%`, backgroundColor: color, borderRadius: 4 }]} />
      </View>
    </View>
  );
}

const reviewStyles = StyleSheet.create({
  row: {
    marginBottom: 12,
  },
  label: {
    marginBottom: 6,
  },
  barBg: {
    height: 8,
    width: '100%',
  },
  barFill: {
    height: 8,
  },
});

export default function BasketDetailsScreen() {
  const { id } = useLocalSearchParams();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  // ALL hooks must be called before any early returns
  const [showReportModal, setShowReportModal] = useState(false);
  const [warningExpanded, setWarningExpanded] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descNeedsSeeMore, setDescNeedsSeeMore] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportLoading, setReportLoading] = useState(false);

  const scrollY = useRef(new Animated.Value(0)).current;

  const heroHeight = scrollY.interpolate({
    inputRange: [0, HERO_FULL - HERO_MINI],
    outputRange: [HERO_FULL, HERO_MINI],
    extrapolate: 'clamp',
  });

  // Mini header fades in as hero collapses
  const miniHeaderOpacity = scrollY.interpolate({
    inputRange: [HERO_FULL - HERO_MINI - 60, HERO_FULL - HERO_MINI],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Pickup row fades in smoothly when address/time scrolls off
  const pickupStickyOpacity = scrollY.interpolate({
    inputRange: [240, 310],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Image fades out as hero collapses
  const heroImageOpacity = scrollY.interpolate({
    inputRange: [0, (HERO_FULL - HERO_MINI) * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const restaurantQuery = useQuery({
    queryKey: ['basket', id],
    queryFn: () => fetchBasketById(String(id)),
    enabled: !!id,
    retry: 2,
  });

  const basket = restaurantQuery.data ? normalizeRawBasketToBasket(restaurantQuery.data as any) : null;

  // Fetch menu items — only if business explicitly enabled (show_menu_items === true)
  const rawData = restaurantQuery.data as any;
  const showMenuItems = rawData?.show_menu_items === true;
  const pickupInstructions = rawData?.pickup_instructions ?? null;
  const locationId = basket?.merchantId;
  const basketId = String(id);

  const basketMenuItemsQuery = useQuery({
    queryKey: ['basket-menu-items', basketId],
    queryFn: async () => {
      const res = await apiClient.get<any>(`/api/baskets/${basketId}/menu-items`);
      const data = res.data;
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'items' in data) return data.items;
      return [];
    },
    enabled: showMenuItems && !!basketId,
    retry: 1,
  });

  const locationMenuItemsQuery = useQuery({
    queryKey: ['menu-items', locationId],
    queryFn: async () => {
      const res = await apiClient.get<any>(`/api/locations/${locationId}/menu-items`);
      const data = res.data;
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'items' in data) return data.items;
      return [];
    },
    enabled: showMenuItems && !!locationId && (basketMenuItemsQuery.isError || (basketMenuItemsQuery.isSuccess && (basketMenuItemsQuery.data ?? []).length === 0)),
    retry: 1,
  });

  const menuItems: { id: number; name: string; description?: string | null; image_url?: string | null }[] = showMenuItems
    ? ((basketMenuItemsQuery.data ?? []).length > 0 ? basketMenuItemsQuery.data : locationMenuItemsQuery.data) ?? []
    : [];

  const [selectedMenuItem, setSelectedMenuItem] = useState<{ name: string; description?: string | null } | null>(null);

  const overallRating = basket?.reviews
    ? ((basket.reviews.service + basket.reviews.quantite + basket.reviews.qualite + basket.reviews.variete) / 4).toFixed(1)
    : basket?.merchantRating?.toFixed(1) ?? '0.0';

  // Must be called before early returns (Rules of Hooks)
  const { isBasketTypeStarred, toggleStarredBasketType } = useFavoritesStore();
  const isStarred = isBasketTypeStarred(String(id));

  if (restaurantQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16, zIndex: 10 }]}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <DelayedLoader />
      </View>
    );
  }

  if (restaurantQuery.isError || !basket) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16, zIndex: 10 }]}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center' as const, marginBottom: 16 }]}>
          {t('common.errorOccurred')}
        </Text>
        <TouchableOpacity
          onPress={() => restaurantQuery.refetch()}
          style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: 20, paddingVertical: 12 }]}
        >
          <RefreshCw size={16} color="#fff" />
          <Text style={[{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' as const, marginLeft: 8 }]}>
            {t('common.retry')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleReserve = () => {
    router.push({ pathname: '/reserve', params: { basketId: basket.id } } as any);
  };

  const handleDirections = () => {
    const query = basket?.hasCoords
      ? `${basket.latitude},${basket.longitude}`
      : encodeURIComponent(basket?.address ?? '');
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };

  const handleReport = async () => {
    if (!reportReason.trim()) return;
    setReportLoading(true);
    try {
      await submitReport({ restaurant_id: basket?.merchantId ?? String(id), reason: reportReason.trim(), details: reportDetails.trim() || undefined });
      Alert.alert(t('common.success'), t('report.success'));
      setShowReportModal(false);
      setReportReason('');
      setReportDetails('');
    } catch {
      Alert.alert(t('common.error'), t('report.error'));
    } finally {
      setReportLoading(false);
    }
  };

  const categoryKey = basket.category?.toLowerCase() ?? '';
  const isGenericCategory = !categoryKey || categoryKey === 'all' || categoryKey === 'tous' || categoryKey === 'all' || categoryKey === 'كل';
  const categoryLabel = !isGenericCategory
    ? t(`categories.${categoryKey}`, { defaultValue: basket.category ?? '' })
    : null;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />

      {/* Animated hero (shrinks as user scrolls) */}
      <Animated.View style={[styles.heroContainer, { height: heroHeight }]}>
        <Animated.Image
          source={basket.imageUrl ? { uri: basket.imageUrl } : undefined}
          style={[styles.heroImage, { opacity: heroImageOpacity }]}
        />
        {!basket.imageUrl && (
          <Animated.View style={[styles.heroPlaceholder, { backgroundColor: theme.colors.bagsLeftBg, opacity: heroImageOpacity }]} />
        )}
        <View style={styles.heroOverlay} />

        {/* Back + action buttons — always visible */}
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', ...theme.shadows.shadowMd }]}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>

        <View style={{ position: 'absolute', top: 52, right: 16, flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={() => toggleStarredBasketType(String(id))}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' }}
          >
            <Bookmark size={18} color={isStarred ? '#e3ff5c' : '#fff'} fill={isStarred ? '#e3ff5c' : 'transparent'} />
          </TouchableOpacity>
          {/* Report button removed per CEO request */}
        </View>

        {/* Quantity / category badges — bottom-right of photo, fade out with image */}
        <Animated.View style={{ position: 'absolute', bottom: 12, right: theme.spacing.lg, flexDirection: 'row', gap: 6, opacity: heroImageOpacity }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#e3ff5c', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
            <ShoppingBag size={12} color="#114b3c" />
            <Text style={{ color: '#114b3c', fontSize: 11, fontWeight: '700', marginLeft: 4 }}>
              {basket.quantityLeft}
            </Text>
          </View>
          {categoryLabel ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
              <Tag size={11} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginLeft: 4 }}>
                {categoryLabel}
              </Text>
            </View>
          ) : null}
        </Animated.View>

      </Animated.View>

      {/* Green top bar bg — covers back button area only, matches info bar */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 88,
          backgroundColor: '#114b3c',
          opacity: miniHeaderOpacity,
          zIndex: 4,
        }}
        pointerEvents="none"
      />

      {/* Sticky info bar — appears below back button when hero collapses */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 88,
          left: 0,
          right: 0,
          backgroundColor: '#114b3c',
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          opacity: miniHeaderOpacity,
          zIndex: 5,
        }}
        pointerEvents="none"
      >
        {basket.merchantLogo ? (
          <Image source={{ uri: basket.merchantLogo }} style={{ width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', marginRight: 10 }} />
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }} numberOfLines={1}>
            {basket.name}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'Poppins_400Regular' }} numberOfLines={1}>
            {basket.merchantName}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <View style={{ backgroundColor: '#e3ff5c', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: 'row', alignItems: 'center' }}>
            <ShoppingBag size={10} color="#114b3c" />
            <Text style={{ color: '#114b3c', fontSize: 10, fontWeight: '700', marginLeft: 3 }}>{basket.quantityLeft >= 10 ? '9+' : basket.quantityLeft}</Text>
          </View>
          {categoryLabel ? (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>{categoryLabel}</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>

      {/* Sticky pickup time row — appends below info bar when address/time scrolls off */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 140,
          left: 0,
          right: 0,
          backgroundColor: '#114b3c',
          paddingHorizontal: 16,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          opacity: pickupStickyOpacity,
          zIndex: 5,
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(255,255,255,0.1)',
        }}
        pointerEvents="none"
      >
        <Clock size={12} color="#e3ff5c" />
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginLeft: 6 }}>
          {basket.pickupWindow.start} – {basket.pickupWindow.end}
        </Text>
        {basket.address ? (
          <>
            <View style={{ width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 10 }} />
            <MapPin size={11} color="rgba(255,255,255,0.6)" />
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, marginLeft: 4, flex: 1 }} numberOfLines={1}>
              {basket.address}
            </Text>
          </>
        ) : null}
      </Animated.View>

      {/* Scrollable content */}
      <Animated.ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* Spacer so content starts below the hero */}
        <View style={{ height: HERO_FULL }} />

        <View style={[styles.content, { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }]}>
          {/* Name + merchant */}
          <View style={styles.merchantRow}>
            {basket.merchantLogo ? (
              <Image source={{ uri: basket.merchantLogo }} style={styles.merchantLogo} />
            ) : (
              <View style={[styles.merchantLogo, { backgroundColor: theme.colors.divider }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {basket.name}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                {basket.merchantName}
              </Text>
            </View>
          </View>

          {/* Pickup time (left) + Address/directions (right) */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r12,
            padding: theme.spacing.md,
            marginTop: theme.spacing.md,
            ...theme.shadows.shadowSm,
          }}>
            {/* Left: pickup window */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 12 }}>
              <Clock size={14} color={theme.colors.primary} />
              <View style={{ marginLeft: 6 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 10, fontFamily: 'Poppins_400Regular' }}>
                  {t('basket.pickup', { defaultValue: 'Retrait' })}
                </Text>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' as const }}>
                  {basket.pickupWindow.start} – {basket.pickupWindow.end}
                </Text>
              </View>
            </View>

            {/* Divider */}
            <View style={{ width: 1, height: 32, backgroundColor: theme.colors.divider }} />

            {/* Right: address + itinerary */}
            {basket.address ? (
              <TouchableOpacity onPress={handleDirections} activeOpacity={0.7} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 12 }}>
                <MapPin size={14} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, flex: 1, marginLeft: 6 }} numberOfLines={1}>
                  {basket.address}
                </Text>
                <View style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r8, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 6 }}>
                  <Navigation size={11} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>{t('basket.getDirections')}</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </View>

          {/* What you can find — single text block with see more */}
          <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
              {t('basket.whatInside', { defaultValue: 'Que pouvez-vous trouver dans vos paniers ?' })}
            </Text>
            {(() => {
              const itemsStr = basket.exampleItems?.length ? basket.exampleItems.join(', ') : null;
              // Avoid duplicating description if items are the same text
              const descText = basket.description
                ? (itemsStr && itemsStr !== basket.description ? `${basket.description} — ${itemsStr}` : basket.description)
                : (itemsStr || t('basket.whatInsideDefault', { defaultValue: 'Un assortiment surprise de produits frais du jour, sélectionnés par le commerçant.' }));
              const isPlaceholder = !basket.description && (!basket.exampleItems || basket.exampleItems.length === 0);
              return (
                <TouchableOpacity activeOpacity={0.7} onPress={() => setDescExpanded(!descExpanded)}>
                  <Text
                    style={{ color: isPlaceholder ? theme.colors.muted : theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22, fontStyle: isPlaceholder ? 'italic' : 'normal' }}
                    numberOfLines={descExpanded ? undefined : 3}
                    onTextLayout={(e) => { if (!descExpanded && e.nativeEvent.lines.length > 3) setDescNeedsSeeMore(true); }}
                  >
                    {descText}
                    {descNeedsSeeMore && !descExpanded && (
                      <Text style={{ color: theme.colors.primary, fontWeight: '600' }}> ...{t('common.seeMore', { defaultValue: 'voir plus' })}</Text>
                    )}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>

          {/* Surprise basket info warning — tap to expand */}
          <TouchableOpacity
            onPress={() => setWarningExpanded(!warningExpanded)}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              backgroundColor: '#eff35c18',
              borderRadius: theme.radii.r12,
              padding: theme.spacing.md,
              marginTop: theme.spacing.md,
              gap: 10,
              borderWidth: 1,
              borderColor: '#eff35c40',
            }}>
            <AlertTriangle size={16} color="#b8a600" style={{ marginTop: 2 }} />
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1, lineHeight: 18 }} numberOfLines={warningExpanded ? undefined : 2}>
              {t('basket.surpriseWarning', { defaultValue: 'Ceci est un panier surprise ! Le contenu exact varie chaque jour selon les invendus du commerçant. Vous pourriez recevoir des articles différents de ceux indiqués.' })}
            </Text>
          </TouchableOpacity>

          {/* Pickup Instructions — always shown */}
          <View style={[styles.section, { marginTop: theme.spacing.lg, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, padding: theme.spacing.md, ...theme.shadows.shadowSm }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.sm }}>
              <Package size={16} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginLeft: 8 }]}>
                {t('basket.pickupInstructions')}
              </Text>
            </View>
            <Text style={[{ color: pickupInstructions ? theme.colors.textSecondary : theme.colors.muted, ...theme.typography.body, lineHeight: 22, fontStyle: pickupInstructions ? 'normal' : 'italic' as const }]}>
              {pickupInstructions || t('basket.noPickupInstructions', { defaultValue: 'Pas d\'instructions spéciales. Présentez votre code de retrait à l\'arrivée.' })}
            </Text>
          </View>

          {/* Menu Items — only if business explicitly enabled show_menu_items */}
          {FeatureFlags.ENABLE_MENU_ITEMS && showMenuItems && menuItems.length > 0 && (
            <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
                {t('basket.menuItems')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                {menuItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => item.description ? setSelectedMenuItem({ name: item.name, description: item.description }) : undefined}
                    activeOpacity={item.description ? 0.7 : 1}
                    style={{ width: 130, marginHorizontal: 4, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, overflow: 'hidden', ...theme.shadows.shadowSm }}
                  >
                    {item.image_url ? (
                      <Image source={{ uri: item.image_url }} style={{ width: 130, height: 90 }} />
                    ) : (
                      <View style={{ width: 130, height: 90, backgroundColor: theme.colors.divider, justifyContent: 'center', alignItems: 'center' }}>
                        <ShoppingBag size={24} color={theme.colors.muted} />
                      </View>
                    )}
                    <Text numberOfLines={2} style={{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '600', padding: 8, textAlign: 'center' }}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Reviews */}
          {basket.reviews && (
            <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
              <View style={styles.reviewHeader}>
                <View>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                    {t('basket.overallExperience')}
                  </Text>
                  {basket.reviewCount != null && (
                    <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
                      {t('basket.basedOnReviews', { count: basket.reviewCount })}
                    </Text>
                  )}
                </View>
                <View style={[styles.overallBadge, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12 }]}>
                  <Star size={16} color="#fff" fill="#fff" />
                  <Text style={[{ color: '#fff', ...theme.typography.h3, fontWeight: '700', marginLeft: 4 }]}>
                    {overallRating}
                  </Text>
                </View>
              </View>
              <View style={[styles.reviewBarsContainer, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, marginTop: theme.spacing.md, ...theme.shadows.shadowSm }]}>
                <ReviewBar label={t('basket.reviewService')} value={basket.reviews.service} color={theme.colors.primary} />
                <ReviewBar label={t('basket.reviewQualite')} value={basket.reviews.qualite} color={theme.colors.primary} />
                <ReviewBar label={t('basket.reviewVariete')} value={basket.reviews.variete} color={theme.colors.secondary} />
                <ReviewBar label={t('basket.reviewQuantite')} value={basket.reviews.quantite} color={theme.colors.secondary} />
              </View>
            </View>
          )}
        </View>
      </Animated.ScrollView>

      {/* Sticky bottom bar: price + reserve button */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: theme.colors.surface,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.lg,
          paddingBottom: theme.spacing.xl,
          borderTopWidth: 1,
          borderTopColor: theme.colors.divider,
          ...theme.shadows.shadowLg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 75,
          justifyContent: 'center',
        }}
      >
        <View>
          {basket.originalPrice > 0 && basket.originalPrice > basket.discountedPrice && (
            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textDecorationLine: 'line-through' }}>
              {basket.originalPrice} TND
            </Text>
          )}
          <Text style={{ color: theme.colors.primary, fontSize: 22, fontWeight: '800', fontFamily: 'Poppins_700Bold' }}>
            {basket.discountedPrice} TND
          </Text>
        </View>
        <View style={{ width: 180 }}>
          <PrimaryCTAButton
            onPress={handleReserve}
            compact
            borderRadius={16}
            title={
              basket.quantityLeft <= 0
                ? t('basket.soldOut')
                : isPickupExpiredInTz(basket.pickupWindow?.end)
                ? t('orders.status.expired')
                : t('basket.reserve')
            }
            disabled={basket.quantityLeft <= 0 || isPickupExpiredInTz(basket.pickupWindow?.end)}
          />
        </View>
      </View>

      {/* Menu item description popup */}
      <Modal visible={!!selectedMenuItem} transparent animationType="fade" onRequestClose={() => setSelectedMenuItem(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={() => setSelectedMenuItem(null)}>
          <View style={{ width: '100%', maxWidth: 340, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }} onStartShouldSetResponder={() => true}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, flex: 1 }}>{selectedMenuItem?.name}</Text>
              <TouchableOpacity onPress={() => setSelectedMenuItem(null)} style={{ marginLeft: 8 }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22 }}>
              {selectedMenuItem?.description}
            </Text>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showReportModal} transparent animationType="fade" onRequestClose={() => setShowReportModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={() => setShowReportModal(false)}>
          <View style={{ width: '100%', maxWidth: 400, backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }} onStartShouldSetResponder={() => true}>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }}>{t('report.title')}</Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }}>{t('report.reasonLabel')}</Text>
            <TextInput
              style={{ height: 48, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 16, color: theme.colors.textPrimary, ...theme.typography.body }}
              value={reportReason}
              onChangeText={setReportReason}
              placeholder={t('report.reasonPlaceholder')}
              placeholderTextColor={theme.colors.muted}
            />
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }}>{t('report.detailsLabel')}</Text>
            <TextInput
              style={{ height: 100, backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, paddingHorizontal: 16, paddingTop: 12, color: theme.colors.textPrimary, ...theme.typography.body, textAlignVertical: 'top' }}
              value={reportDetails}
              onChangeText={setReportDetails}
              placeholder={t('report.detailsPlaceholder')}
              placeholderTextColor={theme.colors.muted}
              multiline
            />
            <TouchableOpacity
              onPress={handleReport}
              disabled={reportLoading || !reportReason.trim()}
              style={{ backgroundColor: theme.colors.error, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl, opacity: reportLoading || !reportReason.trim() ? 0.5 : 1 }}
            >
              <Text style={{ color: '#fff', ...theme.typography.button, textAlign: 'center' }}>{reportLoading ? t('common.loading') : t('report.submit')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,75,60,0.25)',
  },
  backButton: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  content: {},
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  merchantLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  section: {},
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overallBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reviewBarsContainer: {},
});
