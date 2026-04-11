import React, { useCallback, useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  ScrollView,
  Image,
  Animated,
  PanResponder,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ArrowLeft, ShoppingBag, Star, XCircle, Bell, CheckCircle, Clock, MapPin, Navigation, User, MoreHorizontal, EyeOff, X, Trash2, Check, MessageCircle, Zap } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import {
  fetchNotifications,
  markNotificationRead,
  deleteNotification,
  NotificationFromAPI,
} from '@/src/services/notifications';
import { useAuthStore } from '@/src/stores/authStore';
import { DelayedLoader } from '@/src/components/DelayedLoader';

function timeAgo(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return t('timeAgo.seconds', { count: diff });
  if (diff < 3600) return t('timeAgo.minutes', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('timeAgo.hours', { count: Math.floor(diff / 3600) });
  const days = Math.floor(diff / 86400);
  if (days < 7) return t('timeAgo.days', { count: days });
  if (days < 30) return t('timeAgo.weeks', { count: Math.floor(days / 7) });
  return t('timeAgo.months', { count: Math.floor(days / 30) });
}

/**
 * Backend stores notification title as a plain i18n key string
 * e.g. "notif_title_new_reservation"
 * and message as a JSON string: {"key":"notif_message_...","params":{...}}
 * This helper resolves both to human-readable text.
 *
 * Safe parsing rules:
 *  1. If the field is a JSON string → parse it, extract { key, params }, translate.
 *  2. If parsing fails or field is a plain string → treat it as an i18n key.
 *  3. If the key is unknown (i18next returns the dotted path itself) → return `fallback`
 *     so raw keys / raw JSON are NEVER shown to the user.
 */
function resolveNotifText(
  raw: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
  fallback = ''
): string {
  if (!raw) return fallback;

  // 1. Try parsing as JSON (backend stores message as serialised {key, params})
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.key === 'string') {
      const i18nKey = `notifications.${parsed.key}`;
      const translated = t(i18nKey, parsed.params ?? {});
      // i18next returns the key string itself when missing → treat as unknown
      return translated !== i18nKey ? translated : fallback;
    }
  } catch {
    // Not JSON – fall through to plain-key lookup
  }

  // 2. Treat as a plain i18n key (backend stores title as bare key string)
  const i18nKey = `notifications.${raw}`;
  const translated = t(i18nKey, {});
  // If no translation found, return fallback (never expose raw key or raw JSON)
  return translated !== i18nKey ? translated : fallback;
}

function getNotifIcon(type?: string | null, title?: string | null): { Icon: any; color: string; bg: string } {
  const key = type ?? title ?? '';
  if (key.includes('order_confirmed') || key.includes('new_reservation')) {
    return { Icon: ShoppingBag, color: '#114b3c', bg: '#114b3c18' };
  }
  if (key.includes('pickup_confirmed') || key.includes('collected')) {
    return { Icon: CheckCircle, color: '#22c55e', bg: '#22c55e18' };
  }
  if (key.includes('cancelled')) {
    return { Icon: XCircle, color: '#ef4444', bg: '#ef444418' };
  }
  if (key.includes('review')) {
    return { Icon: Star, color: '#f59e0b', bg: '#f59e0b18' };
  }
  if (key.includes('message') || key.includes('reply')) {
    return { Icon: MessageCircle, color: '#3b82f6', bg: '#3b82f618' };
  }
  if (key.includes('streak')) {
    return { Icon: Zap, color: '#f97316', bg: '#f9731618' };
  }
  return { Icon: Bell, color: '#6b7280', bg: '#6b728018' };
}

/** Notification card — swipe left to hide in one gesture, optional selection checkbox */
function NotifCard({ item, theme, t, onPress, onHide, getReservationImage, isBusiness, selectionMode, isSelected, onToggleSelect }: {
  item: NotificationFromAPI; theme: any; t: any;
  onPress: (item: NotificationFromAPI) => void;
  onHide: (id: number) => void;
  getReservationImage: (refId?: number) => string | null;
  isBusiness?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const { Icon, color, bg } = getNotifIcon(item.type, item.title);
  const selModeRef = useRef(selectionMode);
  selModeRef.current = selectionMode;

  const notifImage = React.useMemo(() => {
    try {
      const parsed = JSON.parse(item.message);
      const p = parsed?.params ?? {};
      const fromParams = p.locationImage ?? p.location_image ?? p.restaurant_image ?? p.image_url ?? p.basketImage ?? p.basket_image ?? null;
      if (fromParams) return fromParams;
    } catch {}
    return getReservationImage(item.reference_id) ?? null;
  }, [item.message, item.reference_id, getReservationImage]);
  const isOrderRelated = (item.type ?? '').includes('reservation') || (item.type ?? '').includes('order') || (item.type ?? '').includes('pickup') || (item.type ?? '').includes('cancelled');

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => !selModeRef.current && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_, g) => {
      if (g.dx < 0) translateX.setValue(g.dx);
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -60) {
        // One swipe left → slide off and hide
        Animated.timing(translateX, { toValue: -500, duration: 180, useNativeDriver: true }).start(() => {
          onHide(item.id);
          translateX.setValue(0);
        });
      } else {
        // Snap back
        Animated.spring(translateX, { toValue: 0, friction: 8, useNativeDriver: true }).start();
      }
    },
  })).current;

  const handlePress = () => {
    if (selectionMode) {
      onToggleSelect?.(item.id);
    } else {
      onPress(item);
    }
  };

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Animated.View {...(selectionMode ? {} : panResponder.panHandlers)} style={{ transform: [{ translateX }] }}>
        <TouchableOpacity
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r12,
            padding: theme.spacing.lg,
          }}
          onPress={handlePress}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Selection checkbox */}
            {selectionMode && (
              <View style={{
                width: 24, height: 24, borderRadius: 12, marginRight: 10,
                borderWidth: 2, borderColor: isSelected ? theme.colors.primary : theme.colors.divider,
                backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                justifyContent: 'center', alignItems: 'center',
              }}>
                {isSelected && <CheckCircle size={14} color="#fff" />}
              </View>
            )}
            {notifImage && isOrderRelated && !isBusiness ? (
              <View style={{ marginRight: theme.spacing.md }}>
                <Image source={{ uri: notifImage }} style={{ width: 40, height: 40, borderRadius: 12 }} resizeMode="cover" />
                {!item.is_read && (
                  <View style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary, borderWidth: 2, borderColor: theme.colors.surface }} />
                )}
              </View>
            ) : (
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', marginRight: theme.spacing.md }}>
                <Icon size={18} color={color} />
                {!item.is_read && !selectionMode && (
                  <View style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary, borderWidth: 2, borderColor: theme.colors.surface }} />
                )}
              </View>
            )}
            <View style={{ flex: 1 }}>
              {item.title ? (
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: item.is_read ? ('400' as const) : ('600' as const) }} numberOfLines={1}>
                  {resolveNotifText(item.title, t)}
                </Text>
              ) : null}
              <Text
                style={{ color: item.title ? theme.colors.textSecondary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: !item.title && !item.is_read ? ('600' as const) : ('400' as const), marginTop: item.title ? 2 : 0 }}
                numberOfLines={2}
              >
                {resolveNotifText(item.message, t)}
              </Text>
            </View>
            {!selectionMode && (
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: theme.spacing.md }}>
                {timeAgo(item.created_at, t)}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isBusiness = user?.role === 'business';
  // Get cached reservations to find location images for notifications
  const cachedReservations = queryClient.getQueryData<any[]>(['reservations']) ?? [];
  const getReservationImage = useCallback((refId?: number) => {
    if (!refId) return null;
    const r = cachedReservations.find((res: any) => res.id === refId || String(res.id) === String(refId));
    if (!r) return null;
    return r.restaurant_image ?? r.org_image_url ?? r.restaurant?.image_url ?? r.basket?.image_url ?? r.basket?.cover_image_url ?? null;
  }, [cachedReservations]);
  const [detailNotif, setDetailNotif] = useState<NotificationFromAPI | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'hidden'>('all');
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Persist hidden notification IDs to AsyncStorage
  const HIDDEN_KEY = '@barakeat_hidden_notifs';
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(HIDDEN_KEY);
        if (stored) setHiddenIds(new Set(JSON.parse(stored)));
      } catch {}
    })();
  }, []);

  const hideNotification = useCallback((id: number) => {
    setHiddenIds(prev => {
      const next = new Set(prev).add(id);
      AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
    // Also mark as read when masking
    markNotificationRead(id).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.refetchQueries({ queryKey: ['unread-count'] });
    }).catch(() => {});
  }, [queryClient]);

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    staleTime: 30_000,
  });

  // Selection mode helpers
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const filteredData = React.useMemo(() => {
    return (notificationsQuery.data ?? []).filter(n => {
      if (filter === 'hidden') return hiddenIds.has(n.id);
      if (hiddenIds.has(n.id)) return false;
      if (filter === 'unread' && n.is_read) return false;
      return true;
    });
  }, [notificationsQuery.data, filter, hiddenIds]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredData.map(n => n.id)));
  }, [filteredData]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const batchMarkRead = useCallback(async () => {
    try {
      await Promise.all([...selectedIds].map(id => markNotificationRead(id)));
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.refetchQueries({ queryKey: ['unread-count'] });
    } catch {}
    exitSelectionMode();
  }, [selectedIds, queryClient, exitSelectionMode]);

  const batchHide = useCallback(async () => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      selectedIds.forEach(id => next.add(id));
      AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
    try {
      await Promise.all([...selectedIds].map(id => markNotificationRead(id)));
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.refetchQueries({ queryKey: ['unread-count'] });
    } catch {}
    exitSelectionMode();
  }, [selectedIds, exitSelectionMode, queryClient]);

  const batchDelete = useCallback(async () => {
    try {
      await Promise.all([...selectedIds].map(id => deleteNotification(id)));
      // Remove from hidden set too
      setHiddenIds(prev => {
        const next = new Set(prev);
        selectedIds.forEach(id => next.delete(id));
        AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    } catch {}
    exitSelectionMode();
  }, [selectedIds, exitSelectionMode, queryClient]);

  const handlePressNotification = useCallback(
    async (item: NotificationFromAPI) => {
      if (!item.is_read) {
        try {
          await markNotificationRead(item.id);
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          void queryClient.refetchQueries({ queryKey: ['unread-count'] });
        } catch {}
      }
      setDetailNotif(item);
    },
    [queryClient]
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationFromAPI }) => {
      return <NotifCard item={item} theme={theme} t={t} onPress={handlePressNotification} onHide={hideNotification} getReservationImage={getReservationImage} isBusiness={isBusiness} selectionMode={selectionMode} isSelected={selectedIds.has(item.id)} onToggleSelect={toggleSelect} />;
    },
    [theme, handlePressNotification, hideNotification, t, selectionMode, selectedIds, toggleSelect]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <StatusBar style="dark" />
      <View
        style={[
          styles.header,
          {
            paddingHorizontal: theme.spacing.xl,
            paddingTop: theme.spacing.lg,
            paddingBottom: theme.spacing.md,
          },
        ]}
      >
        {selectionMode ? (
          <>
            <View style={styles.headerLeft}>
              <TouchableOpacity onPress={selectedIds.size === filteredData.length ? () => setSelectedIds(new Set()) : selectAll}>
                <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600' }}>
                  {selectedIds.size === filteredData.length ? t('notifications.deselectAll', { defaultValue: 'Désélectionner' }) : t('notifications.selectAll', { defaultValue: 'Tout sélectionner' })}
                </Text>
              </TouchableOpacity>
              {selectedIds.size > 0 && (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 10 }}>
                  ({selectedIds.size})
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={exitSelectionMode}>
              <X size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.headerLeft}>
              <TouchableOpacity onPress={() => router.back()} style={{ marginRight: theme.spacing.md }}>
                <ArrowLeft size={24} color={theme.colors.textPrimary} />
              </TouchableOpacity>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {t('notifications.title')}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelectionMode(true)}>
              <MoreHorizontal size={22} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Filter tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: theme.spacing.xl, gap: 8, marginBottom: theme.spacing.sm }}>
        {(['all', 'unread', 'hidden'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={{
              paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
              backgroundColor: filter === f ? theme.colors.primary : theme.colors.surface,
              borderWidth: 1, borderColor: filter === f ? theme.colors.primary : theme.colors.divider,
            }}
          >
            <Text style={{
              color: filter === f ? '#fff' : theme.colors.textSecondary,
              ...theme.typography.caption, fontWeight: '600',
            }}>
              {f === 'all' ? t('notifications.filterAll', { defaultValue: 'Toutes' })
                : f === 'unread' ? t('notifications.filterUnread', { defaultValue: 'Non lues' })
                : t('notifications.filterHidden', { defaultValue: 'Masquées' })}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {notificationsQuery.isLoading ? (
        <DelayedLoader />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filteredData}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{
            padding: theme.spacing.xl,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={notificationsQuery.isRefetching}
              onRefresh={() => {
                void notificationsQuery.refetch();
              }}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -60 }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.primary + '12', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Bell size={32} color={theme.colors.primary} />
              </View>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 6 }}>
                {t('notifications.emptyTitle', { defaultValue: 'Aucune notification' })}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, textAlign: 'center', lineHeight: 20 }}>
                {t('notifications.emptyDesc', { defaultValue: 'Vos notifications apparaîtront ici.' })}
              </Text>
            </View>
          }
        />
      )}

      {/* Floating action buttons — bottom-right, only in selection mode with items selected */}
      {selectionMode && selectedIds.size > 0 && (
        <View style={{ position: 'absolute', bottom: 28, right: 20, flexDirection: 'row', gap: 10 }}>
          {filter === 'hidden' ? (
            /* Masked tab: only delete */
            <TouchableOpacity
              onPress={batchDelete}
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.error, justifyContent: 'center', alignItems: 'center', ...theme.shadows.shadowMd }}
            >
              <Trash2 size={20} color="#fff" />
            </TouchableOpacity>
          ) : (
            /* Normal tabs: mark read + mask */
            <>
              <TouchableOpacity
                onPress={batchMarkRead}
                style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', ...theme.shadows.shadowMd }}
              >
                <CheckCheck size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={batchHide}
                style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.textSecondary, justifyContent: 'center', alignItems: 'center', ...theme.shadows.shadowMd }}
              >
                <EyeOff size={20} color="#fff" />
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Notification detail popup */}
      <Modal visible={detailNotif !== null} transparent animationType="fade" onRequestClose={() => setDetailNotif(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }} activeOpacity={1} onPress={() => setDetailNotif(null)}>
          <View
            style={{ backgroundColor: theme.colors.surface, borderRadius: 24, width: '100%', maxWidth: 420, maxHeight: '90%', overflow: 'hidden', ...theme.shadows.shadowLg }}
            onStartShouldSetResponder={() => true}
          >
            {detailNotif && (() => {
              const { Icon, color, bg } = getNotifIcon(detailNotif.type, detailNotif.title);
              const notifType = detailNotif.type ?? '';
              const isNewReservation = notifType.includes('new_reservation') || notifType.includes('order_confirmed');
              const isCancelled = notifType.includes('cancelled');
              const isReview = notifType.includes('review');
              const isPickupConfirmed = notifType.includes('pickup_confirmed') || notifType.includes('collected');
              const isMessage = notifType.includes('message') || notifType.includes('reply');

              // Extract params from JSON message — handle multiple possible key names
              let msgParams: Record<string, any> = {};
              try {
                const parsed = JSON.parse(detailNotif.message);
                if (parsed?.params) msgParams = parsed.params;
              } catch {}

              // Normalise param keys — backends use varied naming conventions
              const basketName = msgParams.basketName ?? msgParams.basket_name ?? msgParams.basketname ?? null;
              const locationName = msgParams.location ?? msgParams.locationName ?? msgParams.restaurantName ?? msgParams.restaurant_name ?? msgParams.location_name ?? msgParams.merchantName ?? null;
              const customerName = msgParams.customerName ?? msgParams.customer_name ?? null;
              // Backend sends "time" as "HH:MM - HH:MM" string, or separate start/end
              const pickupStart = msgParams.pickupStart ?? msgParams.pickup_start ?? msgParams.startTime ?? null;
              const pickupEnd = msgParams.pickupEnd ?? msgParams.pickup_end ?? msgParams.endTime ?? null;
              const pickupTime = msgParams.time ?? ((pickupStart && pickupEnd) ? `${String(pickupStart).substring(0,5)} – ${String(pickupEnd).substring(0,5)}` : (pickupStart ?? pickupEnd ?? null));
              const qty = msgParams.quantity ?? msgParams.qty ?? msgParams.count ?? null;
              const rating = msgParams.rating ?? null;
              const comment = msgParams.comment ?? msgParams.review ?? null;
              const price = msgParams.price ?? msgParams.total ?? msgParams.amount ?? null;
              const pickupCode = msgParams.code ?? msgParams.pickupCode ?? msgParams.pickup_code ?? null;
              const basketImage = msgParams.basketImage ?? msgParams.basket_image ?? msgParams.image_url ?? null;
              const notifAddress = msgParams.address ?? msgParams.restaurant_address ?? null;
              const locationImage = msgParams.locationImage ?? msgParams.location_image ?? msgParams.restaurant_image ?? null;
              // Review category ratings
              const ratingService = msgParams.rating_service ?? null;
              const ratingQuality = msgParams.rating_quality ?? null;
              const ratingQuantity = msgParams.rating_quantity ?? null;
              const ratingVariety = msgParams.rating_variety ?? null;

              const senderName = msgParams.senderName ?? msgParams.sender_name ?? null;

              const hasDetails = basketName || locationName || customerName || pickupTime || qty || rating || comment || price || pickupCode;
              const hasAction = isNewReservation || isCancelled || isReview || isPickupConfirmed || isMessage;

              const handleAction = () => {
                setDetailNotif(null);
                if (isMessage) {
                  // Navigate to chat — reference_id is conversation.id
                  router.push({ pathname: '/message/[id]', params: { id: String(detailNotif.reference_id ?? '') } } as never);
                  return;
                }
                if (isPickupConfirmed && !isBusiness) {
                  router.push({ pathname: '/review', params: { reservationId: String(detailNotif.reference_id ?? ''), locationName: locationName ?? '', basketName: basketName ?? '', quantity: String(qty ?? 1), total: String(price ?? 0) } } as never);
                  return;
                }
                if (isNewReservation || isCancelled) {
                  router.push(isBusiness ? '/(business)/incoming-orders' : '/(tabs)/orders');
                } else if (isReview) {
                  router.push('/(business)/dashboard');
                }
              };

              return (
                <>
                  {/* Coloured top strip */}
                  <View style={{ backgroundColor: color, paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' }}>
                      <Icon size={20} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      {detailNotif.title ? (
                        <Text style={{ color: '#fff', ...theme.typography.h3, fontWeight: '700' }}>
                          {resolveNotifText(detailNotif.title, t)}
                        </Text>
                      ) : null}
                      <Text style={{ color: 'rgba(255,255,255,0.75)', ...theme.typography.caption, marginTop: 2 }}>
                        {timeAgo(detailNotif.created_at, t)}
                      </Text>
                    </View>
                  </View>

                  <View style={{ padding: 24 }}>
                  <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 640 }} contentContainerStyle={{ paddingBottom: 8 }}>
                    {/* Location / basket image */}
                    {(locationImage || basketImage) ? (
                      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16, justifyContent: 'center' }}>
                        {locationImage ? (
                          <Image source={{ uri: locationImage }} style={{ width: 70, height: 70, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" />
                        ) : null}
                        {basketImage && basketImage !== locationImage ? (
                          <Image source={{ uri: basketImage }} style={{ width: 70, height: 70, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" />
                        ) : null}
                      </View>
                    ) : isNewReservation ? (
                      <View style={{ alignItems: 'center', marginBottom: 16 }}>
                        <Image source={require('@/assets/images/barakeat_paper_bag.png')} style={{ width: 80, height: 80, borderRadius: 16 }} resizeMode="cover" />
                      </View>
                    ) : null}

                    {/* Message */}
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22, marginBottom: 12 }}>
                      {resolveNotifText(detailNotif.message, t)}
                    </Text>

                    {/* Order confirmed: 4 clean rows — qty, price, pickup time, code */}
                    {(isNewReservation || notifType.includes('order_confirmed')) && (
                      <>
                        {/* Basket name */}
                        {basketName && (
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700', marginBottom: 12 }}>
                            {basketName}{locationName ? ` — ${locationName}` : ''}
                          </Text>
                        )}

                        {/* Info rows — matches order card expanded style */}
                        <View style={{ backgroundColor: '#114b3c08', borderRadius: 14, padding: 14, marginBottom: 16, gap: 0 }}>
                          {/* Row 0: Customer name (business only) */}
                          {isBusiness && customerName ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                                <User size={13} color="#e3ff5c" />
                              </View>
                              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                                {customerName}
                              </Text>
                            </View>
                          ) : null}
                          {/* Row 1: Address + itinerary */}
                          {notifAddress && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: (isBusiness && customerName) ? 1 : 0, borderTopColor: theme.colors.divider }}>
                              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                                <MapPin size={13} color="#e3ff5c" />
                              </View>
                              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                                {notifAddress}
                              </Text>
                              <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(notifAddress)}`)} style={{ backgroundColor: '#114b3c', borderRadius: 10, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' }}>
                                <Navigation size={13} color="#e3ff5c" />
                              </TouchableOpacity>
                            </View>
                          )}
                          {/* Row 2: Quantity */}
                          {qty && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: (notifAddress || (isBusiness && customerName)) ? 1 : 0, borderTopColor: theme.colors.divider }}>
                              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                                <ShoppingBag size={13} color="#e3ff5c" />
                              </View>
                              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                                {qty} {Number(qty) > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}
                              </Text>
                            </View>
                          )}
                          {/* Row 3: Price */}
                          {price && !isCancelled && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                                <Text style={{ color: '#e3ff5c', fontSize: 9, fontWeight: '700' }}>TND</Text>
                              </View>
                              <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', flex: 1 }}>
                                {Number(qty ?? 1) > 1 ? (Number(price) * Number(qty ?? 1)).toFixed(2) : price} TND
                              </Text>
                            </View>
                          )}
                          {/* Row 4: Pickup time */}
                          {pickupTime && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                                <Clock size={13} color="#e3ff5c" />
                              </View>
                              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                                {t('notifications.pickupAt', { defaultValue: 'Retrait' })} : {pickupTime}
                              </Text>
                            </View>
                          )}
                        </View>

                        {/* Code de retrait — separate dark div */}
                        {pickupCode && (
                          <View style={{ backgroundColor: '#114b3c', borderRadius: 16, padding: 18, marginBottom: 16, alignItems: 'center' }}>
                            <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.caption, marginBottom: 6 }}>
                              {t('reserve.success.pickupCode', { defaultValue: 'Code de retrait' })}
                            </Text>
                            <Text style={{ color: '#e3ff5c', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 6 }}>
                              {pickupCode}
                            </Text>
                          </View>
                        )}
                      </>
                    )}

                    {/* Cancelled info banner */}
                    {isCancelled && (
                      <View style={{ backgroundColor: '#ef444410', borderRadius: 12, padding: 14, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <XCircle size={20} color="#ef4444" />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#ef4444', ...theme.typography.bodySm, fontWeight: '700' }}>
                            {t('notifications.cancelledInfo', { defaultValue: 'Commande annulée' })}
                          </Text>
                          {customerName ? <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 2 }}>
                            {customerName}
                          </Text> : null}
                          {qty && <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                            <Text style={{ fontWeight: '700' }}>{qty}</Text> {Number(qty) > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}
                          </Text>}
                        </View>
                      </View>
                    )}

                    {/* Pickup confirmed — order summary with review prompt */}
                    {isPickupConfirmed && !isBusiness && (
                      <View style={{ backgroundColor: '#16a34a10', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <CheckCircle size={18} color="#16a34a" />
                          <Text style={{ color: '#16a34a', ...theme.typography.bodySm, fontWeight: '700' }}>
                            {t('notifications.pickupComplete', { defaultValue: 'Retrait effectué' })}
                          </Text>
                        </View>
                        {(basketName || locationName) && (
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: 4 }}>
                            {basketName ? <Text style={{ fontWeight: '700' }}>{basketName}</Text> : null}
                            {basketName && locationName ? ' — ' : ''}
                            {locationName ?? ''}
                          </Text>
                        )}
                        {(qty || price) && (
                          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                            {qty ? <><Text style={{ fontWeight: '700', color: theme.colors.textPrimary }}>{qty}</Text> {Number(qty) > 1 ? 'paniers' : 'panier'}</> : null}
                            {qty && price ? ' · ' : ''}
                            {price ? <Text style={{ fontWeight: '700', color: theme.colors.primary }}>{price} TND</Text> : null}
                          </Text>
                        )}
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 8, fontStyle: 'italic' }}>
                          {t('notifications.reviewPromptHint', { defaultValue: 'Partagez votre expérience en laissant un avis !' })}
                        </Text>
                      </View>
                    )}

                    {/* Pickup code already shown inside the order card above */}

                    {/* Review detail card — dedicated section for new_review type */}
                    {isReview && (
                      <View style={{ backgroundColor: '#f59e0b10', borderRadius: 14, padding: 16, marginBottom: 16 }}>
                        {/* Customer name */}
                        {customerName ? (
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700', marginBottom: 10 }}>
                            {customerName}
                          </Text>
                        ) : null}
                        {/* Overall star rating */}
                        {rating ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }}>
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} size={22} color="#f59e0b" fill={s <= Math.round(Number(rating)) ? '#f59e0b' : 'transparent'} />
                            ))}
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700', marginLeft: 8 }}>
                              {Number(rating).toFixed(1)}
                            </Text>
                          </View>
                        ) : null}
                        {/* 4 category ratings */}
                        {(ratingService || ratingQuality || ratingQuantity || ratingVariety) ? (
                          <View style={{ gap: 6, marginBottom: comment ? 12 : 0 }}>
                            {([
                              { label: t('review.service', { defaultValue: 'Service' }), val: ratingService },
                              { label: t('review.quality', { defaultValue: 'Qualité' }), val: ratingQuality },
                              { label: t('review.quantity', { defaultValue: 'Quantité' }), val: ratingQuantity },
                              { label: t('review.variety', { defaultValue: 'Variété' }), val: ratingVariety },
                            ] as const).map((cat) => cat.val != null ? (
                              <View key={cat.label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{cat.label}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                                  {[1, 2, 3, 4, 5].map((s) => (
                                    <Star key={s} size={11} color="#f59e0b" fill={s <= Math.round(Number(cat.val)) ? '#f59e0b' : 'transparent'} />
                                  ))}
                                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.caption, fontWeight: '700', marginLeft: 4, minWidth: 20, textAlign: 'right' }}>
                                    {Number(cat.val).toFixed(1)}
                                  </Text>
                                </View>
                              </View>
                            ) : null)}
                          </View>
                        ) : null}
                        {/* Comment */}
                        {comment ? (
                          <View style={{ borderTopWidth: 1, borderTopColor: '#f59e0b30', paddingTop: 10 }}>
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontStyle: 'italic', lineHeight: 20 }}>
                              « {comment} »
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    )}

                    {/* Message detail card */}
                    {isMessage && (
                      <View style={{ backgroundColor: '#3b82f610', borderRadius: 14, padding: 16, marginBottom: 16 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#3b82f620', justifyContent: 'center', alignItems: 'center' }}>
                            <MessageCircle size={18} color="#3b82f6" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' }}>
                              {senderName || t('notifications.someone', { defaultValue: 'Quelqu\'un' })}
                            </Text>
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                              {t('notifications.messageReceived', { defaultValue: 'vous a envoy\u00e9 un message concernant votre commande' })}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 10 }}>
                          {t('notifications.tapToViewConversation', { defaultValue: 'Appuyez pour voir la conversation' })}
                        </Text>
                      </View>
                    )}

                    {/* Detail rows — skip for order_confirmed, review, and message (have dedicated sections above) */}
                    {hasDetails && !isNewReservation && !isReview && !isMessage && (
                      <View style={{ backgroundColor: theme.colors.bg, borderRadius: 14, padding: 16, marginBottom: 16, gap: 12 }}>
                        {basketName ? (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>
                              {t('notifications.basket', { defaultValue: 'Panier' })}
                            </Text>
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }} numberOfLines={1}>
                              {basketName}
                            </Text>
                          </View>
                        ) : null}
                        {locationName ? (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>
                              {t('notifications.location', { defaultValue: 'Commerce' })}
                            </Text>
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }} numberOfLines={1}>
                              {locationName}
                            </Text>
                          </View>
                        ) : null}
                        {customerName ? (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>
                              {t('notifications.customer', { defaultValue: 'Client' })}
                            </Text>
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>
                              {customerName}
                            </Text>
                          </View>
                        ) : null}
                        {qty ? (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>
                              {t('notifications.quantity', { defaultValue: 'Quantité' })}
                            </Text>
                            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>
                              {qty}
                            </Text>
                          </View>
                        ) : null}
                        {price && !isCancelled ? (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>
                              {t('notifications.price', { defaultValue: 'Prix' })}
                            </Text>
                            <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', flex: 2, textAlign: 'right' }}>
                              {price} TND
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    )}

                  </ScrollView>
                  {/* Action buttons — with top spacing */}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                    {hasAction && (
                      <TouchableOpacity
                        onPress={handleAction}
                        style={{ flex: 1, backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
                      >
                        <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                          {isMessage
                            ? t('notifications.viewConversation', { defaultValue: 'Voir la conversation' })
                            : isPickupConfirmed && !isBusiness
                            ? t('notifications.leaveReview', { defaultValue: 'Laisser un avis' })
                            : isReview
                            ? t('notifications.viewDashboard', { defaultValue: 'Tableau de bord' })
                            : t('notifications.viewOrder', { defaultValue: 'Voir la commande' })}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => setDetailNotif(null)}
                      style={{
                        flex: hasAction ? undefined : 1,
                        backgroundColor: theme.colors.bg,
                        borderRadius: 14,
                        paddingVertical: 14,
                        paddingHorizontal: 20,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>
                        {t('common.close', { defaultValue: 'Fermer' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  </View>{/* end padding:20 */}
                </>
              );
            })()}
          </View>
        </TouchableOpacity>
      </Modal>
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  notificationItem: {},
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  notificationContent: {
    flex: 1,
  },
});
