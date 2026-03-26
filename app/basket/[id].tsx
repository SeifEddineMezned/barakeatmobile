import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, ActivityIndicator, Alert, Modal, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Clock, Phone, Navigation, ChevronLeft, Star, ShoppingBag, RefreshCw, Flag, X } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import { PrimaryCTAButton } from '@/src/components/PrimaryCTAButton';
import { fetchBasketById } from '@/src/services/baskets';
import { normalizeRawBasketToBasket } from '@/src/utils/normalizeRestaurant';
import { submitReport } from '@/src/services/reports';
import { apiClient } from '@/src/lib/api';



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
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportLoading, setReportLoading] = useState(false);

  const restaurantQuery = useQuery({
    queryKey: ['basket', id],
    queryFn: () => fetchBasketById(String(id)),
    enabled: !!id,
    retry: 2,
  });

  const basket = restaurantQuery.data ? normalizeRawBasketToBasket(restaurantQuery.data as any) : null;

  // Fetch menu items — prefer basket-specific items, fall back to all location items
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
    enabled: !!basketId,
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
    enabled: !!locationId && (basketMenuItemsQuery.isError || (basketMenuItemsQuery.isSuccess && (basketMenuItemsQuery.data ?? []).length === 0)),
    retry: 1,
  });

  // Use basket-specific items if available, else fall back to location items
  const menuItemsQuery = {
    data: (basketMenuItemsQuery.data ?? []).length > 0 ? basketMenuItemsQuery.data : locationMenuItemsQuery.data,
    isLoading: basketMenuItemsQuery.isLoading || locationMenuItemsQuery.isLoading,
  };

  const menuItems: { id: number; name: string; description?: string | null; image_url?: string | null }[] = menuItemsQuery.data ?? [];
  const [selectedMenuItem, setSelectedMenuItem] = useState<{ name: string; description?: string | null } | null>(null);

  const overallRating = basket?.reviews
    ? ((basket.reviews.service + basket.reviews.quantite + basket.reviews.qualite + basket.reviews.variete) / 4).toFixed(1)
    : basket?.merchantRating?.toFixed(1) ?? '0.0';

  if (restaurantQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', position: 'absolute', top: 52, left: 16, zIndex: 10 }]}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 16 }]}>
          {t('common.loading')}
        </Text>
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

  const handleCall = () => {
    void Linking.openURL(`tel:+21612345678`);
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

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.heroContainer}>
          {basket.imageUrl ? (
            <Image source={{ uri: basket.imageUrl }} style={styles.heroImage} />
          ) : (
            <View style={[styles.heroPlaceholder, { backgroundColor: theme.colors.bagsLeftBg }]} />
          )}
          <View style={styles.heroOverlay} />
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: 'rgba(255,255,255,0.9)', ...theme.shadows.shadowMd }]}
            onPress={() => router.back()}
          >
            <ChevronLeft size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setShowReportModal(true)}
            style={{ position: 'absolute', top: 52, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' }}
          >
            <Flag size={18} color="#fff" />
          </TouchableOpacity>

          <View style={[styles.heroBottomInfo, { paddingHorizontal: theme.spacing.xl }]}>
            <View style={[styles.bagsChip, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.r8 }]}>
              <ShoppingBag size={13} color="#fff" />
              <Text style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '700' as const, marginLeft: 4 }]}>
                {basket.quantityLeft} {t('basket.quantity', { count: basket.quantityLeft })}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.content, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg }]}>
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

          <View style={[styles.quickInfoRow, { marginTop: theme.spacing.md }]}>
            <View style={[styles.infoChip, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.pill, ...theme.shadows.shadowSm }]}>
              <Clock size={13} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '500' as const, marginLeft: 4 }]}>
                {basket.pickupWindow.start} - {basket.pickupWindow.end}
              </Text>
            </View>
            <View style={[styles.infoChip, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.pill, ...theme.shadows.shadowSm }]}>
              <MapPin size={13} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '500' as const, marginLeft: 4 }]}>
                {basket.distance}km
              </Text>
            </View>
            <View style={[styles.infoChip, { backgroundColor: theme.colors.bagsLeftBg, borderRadius: theme.radii.pill }]}>
              <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const }]}>
                {t('basket.payOnPickup')}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.priceBlock,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                padding: theme.spacing.lg,
                marginTop: theme.spacing.lg,
                ...theme.shadows.shadowSm,
              },
            ]}
          >
            <View style={styles.priceRow}>
              <View>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption }]}>
                  {t('basket.pickupWindow')}
                </Text>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const, marginTop: 2 }]}>
                  {basket.pickupWindow.start} - {basket.pickupWindow.end}
                </Text>
              </View>
              <View style={styles.priceRight}>
                <Text style={[{ color: theme.colors.muted, ...theme.typography.bodySm, textDecorationLine: 'line-through', textAlign: 'right' }]}>
                  {basket.originalPrice} TND
                </Text>
                <Text style={[{ color: theme.colors.primary, ...theme.typography.h1, fontWeight: '700' as const, textAlign: 'right' }]}>
                  {basket.discountedPrice} TND
                </Text>
              </View>
            </View>
          </View>

          {basket.description ? (
            <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
                {t('basket.description')}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22 }]}>
                {basket.description}
              </Text>
            </View>
          ) : null}

          {basket.exampleItems && basket.exampleItems.length > 0 && (
            <View style={[styles.section, { marginTop: theme.spacing.lg }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
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
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                        ...theme.shadows.shadowSm,
                      },
                    ]}
                  >
                    <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>{item}</Text>
                  </View>
                ))}
              </View>
              <Text
                style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: theme.spacing.sm, fontStyle: 'italic' }]}
              >
                {t('basket.surpriseNote')}
              </Text>
            </View>
          )}

          {/* Quick action buttons — Call & Directions */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
            <TouchableOpacity
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, paddingVertical: 12, gap: 6, ...theme.shadows.shadowSm }}
              onPress={handleCall}
            >
              <Phone size={16} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>{t('basket.call')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.r12, paddingVertical: 12, gap: 6, ...theme.shadows.shadowSm }}
              onPress={handleDirections}
            >
              <Navigation size={16} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>{t('basket.directions')}</Text>
            </TouchableOpacity>
          </View>

          {/* Articles du menu — always shown */}
          <View style={[styles.section, { marginTop: theme.spacing.xl }]}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.sm }]}>
              {t('basket.menuItems', { defaultValue: 'Articles du menu' })}
            </Text>
            {menuItems.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                {menuItems.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => item.description ? setSelectedMenuItem({ name: item.name, description: item.description }) : undefined}
                    activeOpacity={item.description ? 0.7 : 1}
                    style={{
                      width: 130,
                      marginHorizontal: 4,
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.radii.r12,
                      overflow: 'hidden',
                      ...theme.shadows.shadowSm,
                    }}
                  >
                    {item.image_url ? (
                      <Image source={{ uri: item.image_url }} style={{ width: 130, height: 90 }} />
                    ) : (
                      <View style={{ width: 130, height: 90, backgroundColor: theme.colors.divider, justifyContent: 'center', alignItems: 'center' }}>
                        <ShoppingBag size={24} color={theme.colors.muted} />
                      </View>
                    )}
                    <Text
                      numberOfLines={2}
                      style={{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '600' as const, padding: 8, textAlign: 'center' }}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <ScrollView horizontal scrollEnabled={false} style={{ marginHorizontal: -4 }}>
                {[0, 1, 2].map((i) => (
                  <View
                    key={i}
                    style={{
                      width: 130,
                      marginHorizontal: 4,
                      backgroundColor: theme.colors.surface,
                      borderRadius: theme.radii.r12,
                      overflow: 'hidden',
                      opacity: 0.5,
                    }}
                  >
                    <View style={{ width: 130, height: 90, backgroundColor: theme.colors.divider }} />
                    <View style={{ padding: 8, alignItems: 'center' }}>
                      <View style={{ width: 60, height: 8, borderRadius: 4, backgroundColor: theme.colors.divider }} />
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            {menuItems.length === 0 && (
              <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textAlign: 'center', marginTop: 8 }}>
                {t('basket.noMenuItems', { defaultValue: 'No items to show yet' })}
              </Text>
            )}
          </View>

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
                  <Text style={[{ color: '#fff', ...theme.typography.h3, fontWeight: '700' as const, marginLeft: 4 }]}>
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

          <View style={{ height: theme.spacing.xxl }} />
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: theme.colors.surface,
            paddingHorizontal: theme.spacing.xl,
            paddingVertical: theme.spacing.md,
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
    position: 'relative',
    width: '100%',
    height: 240,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
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
  },
  heroBottomInfo: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
  },
  bagsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
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
  quickInfoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  infoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
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
    marginLeft: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  footer: {},
});
