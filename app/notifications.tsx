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
import { useBusinessStore } from '@/src/stores/businessStore';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { NotificationDetail } from '@/src/components/NotificationDetail';

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
      const params = { ...(parsed.params ?? {}) };
      // Ensure 'location' param is always present — old notifications used 'locationName' instead
      if (!params.location) {
        params.location = params.locationName ?? params.restaurant ?? params.restaurantName ?? '';
      }
      const i18nKey = `notifications.${parsed.key}`;
      const translated = t(i18nKey, params);
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
  if (key.includes('basket_picked_up')) {
    return { Icon: CheckCircle, color: '#22c55e', bg: '#22c55e18' };
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
    <View style={{ marginBottom: theme.spacing.sm }}>
      <Animated.View {...(selectionMode ? {} : panResponder.panHandlers)} style={{ transform: [{ translateX }] }}>
        <TouchableOpacity
          // Card is flush (no shadow, 14px radius) with an overflowed left
          // accent strip colored by notification type for unread items. This
          // replaces the old tinted icon circle — the strip carries the type
          // signal, the icon stays neutral inline, and the layout feels closer
          // to Uber Eats' inbox than to a generic Material alert.
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r14,
            paddingVertical: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            borderWidth: 1,
            borderColor: theme.colors.divider,
            overflow: 'hidden',
          }}
          onPress={handlePress}
          activeOpacity={0.7}
        >
          {!item.is_read && !selectionMode && (
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: color }} />
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {selectionMode && (
              <View style={{
                width: 22, height: 22, borderRadius: 11, marginRight: 10,
                borderWidth: 2, borderColor: isSelected ? theme.colors.primary : theme.colors.divider,
                backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                justifyContent: 'center', alignItems: 'center',
              }}>
                {isSelected && <CheckCircle size={12} color="#fff" />}
              </View>
            )}
            {notifImage && isOrderRelated && !isBusiness ? (
              <Image source={{ uri: notifImage }} style={{ width: 36, height: 36, borderRadius: 10, marginRight: theme.spacing.md }} resizeMode="cover" />
            ) : (
              // Icon keeps its type color (primary for new reservations, red
              // for cancelled, blue for messages, etc.) so business users can
              // scan the inbox at a glance. No tinted background circle —
              // the color lives on the glyph itself, which reads as modern
              // rather than as an AI "status badge".
              <View style={{ width: 36, alignItems: 'center', marginRight: theme.spacing.md }}>
                <Icon size={20} color={color} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              {item.title ? (
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, lineHeight: 19, fontFamily: item.is_read ? 'Poppins_400Regular' : 'Poppins_600SemiBold', fontWeight: item.is_read ? ('400' as const) : ('600' as const) }} numberOfLines={1}>
                  {resolveNotifText(item.title, t)}
                </Text>
              ) : null}
              <Text
                style={{ color: item.title ? theme.colors.textSecondary : theme.colors.textPrimary, fontSize: 13, lineHeight: 18, fontFamily: (!item.title && !item.is_read) ? 'Poppins_600SemiBold' : 'Poppins_400Regular', fontWeight: !item.title && !item.is_read ? ('600' as const) : ('400' as const), marginTop: item.title ? 2 : 0 }}
                numberOfLines={2}
              >
                {resolveNotifText(item.message, t)}
              </Text>
            </View>
            {!selectionMode && (
              <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginLeft: theme.spacing.md }}>
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

  // Restore masked notifications to their normal feed (inverse of batchHide).
  // Masking is client-side only (AsyncStorage set), so unmasking is just a set-removal.
  const batchUnhide = useCallback(() => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      selectedIds.forEach(id => next.delete(id));
      AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
    exitSelectionMode();
  }, [selectedIds, exitSelectionMode]);

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

      {/* Filter tabs — tighter 8px radius (matches FilterChip) so they
          read as flat controls rather than the generic oval pills. */}
      <View style={{ flexDirection: 'row', paddingHorizontal: theme.spacing.xl, gap: 8, marginBottom: theme.spacing.sm }}>
        {(['all', 'unread', 'hidden'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={{
              paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
              backgroundColor: filter === f ? theme.colors.primary : theme.colors.surface,
              borderWidth: 1, borderColor: filter === f ? theme.colors.primary : theme.colors.divider,
            }}
          >
            <Text style={{
              color: filter === f ? '#fff' : theme.colors.textSecondary,
              fontSize: 12, fontFamily: 'Poppins_600SemiBold', fontWeight: '600', letterSpacing: 0.1,
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

      {/* Action bar — bottom of screen, only in selection mode with items selected.
          Labeled pill buttons (not bare icons) so it reads as a clear action toolbar
          rather than floating decoration. Left side shows the selection count. */}
      {selectionMode && selectedIds.size > 0 && (
        <View style={{
          position: 'absolute', bottom: 20, left: 16, right: 16,
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: theme.colors.surface, borderRadius: 16,
          paddingVertical: 10, paddingHorizontal: 14,
          ...theme.shadows.shadowLg,
          borderWidth: 1, borderColor: theme.colors.divider,
        }}>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700', marginRight: 4 }}>
            ({selectedIds.size})
          </Text>
          <View style={{ flex: 1 }} />
          {filter === 'hidden' ? (
            /* Masked tab: unmask + delete */
            <>
              <TouchableOpacity
                onPress={batchUnhide}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.primary + '15', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 }}
              >
                <EyeOff size={16} color={theme.colors.primary} style={{ transform: [{ rotate: '0deg' }] }} />
                <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '700' }}>
                  {t('notifications.unmask', { defaultValue: 'Démasquer' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={batchDelete}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.error, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 }}
              >
                <Trash2 size={16} color="#fff" />
                <Text style={{ color: '#fff', ...theme.typography.caption, fontWeight: '700' }}>
                  {t('common.delete', { defaultValue: 'Supprimer' })}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            /* Normal tabs: mark read + mask */
            <>
              <TouchableOpacity
                onPress={batchMarkRead}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.primary, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 }}
              >
                <CheckCheck size={16} color="#fff" />
                <Text style={{ color: '#fff', ...theme.typography.caption, fontWeight: '700' }}>
                  {t('notifications.markRead', { defaultValue: 'Marquer lu' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={batchHide}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 }}
              >
                <EyeOff size={16} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '700' }}>
                  {t('notifications.mask', { defaultValue: 'Masquer' })}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Notification detail popup */}
      <Modal visible={detailNotif !== null} transparent animationType="fade" onRequestClose={() => setDetailNotif(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          {/* Backdrop — only this dismisses the modal */}
          <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={1} onPress={() => setDetailNotif(null)} />
          {detailNotif && (() => {
            const notifType = detailNotif.type ?? '';
            const isMessage = notifType.includes('message') || notifType.includes('reply');
            const isPickupConfirmed = notifType.includes('pickup_confirmed') || notifType.includes('collected');
            const isBasketPickedUp = notifType.includes('basket_picked_up');
            const isNewReservation = notifType.includes('new_reservation') || notifType.includes('order_confirmed');
            const isCancelled = notifType.includes('cancelled');
            const isReview = notifType.includes('review');
            let msgParams: Record<string, any> = {};
            try { const p = JSON.parse(detailNotif.message); if (p?.params) msgParams = p.params; } catch {}
            const locationName = msgParams.location ?? msgParams.locationName ?? msgParams.restaurantName ?? null;
            const basketName = msgParams.basketName ?? msgParams.basket_name ?? null;
            const qty = msgParams.quantity ?? msgParams.qty ?? msgParams.count ?? null;
            const price = msgParams.price ?? msgParams.total ?? null;
            const handleAction = () => {
              setDetailNotif(null);
              if (isMessage) { router.push({ pathname: '/message/[id]', params: { id: String(detailNotif.reference_id ?? '') } } as never); return; }
              if (isPickupConfirmed && !isBusiness) { router.push({ pathname: '/review', params: { reservationId: String(detailNotif.reference_id ?? ''), locationName: locationName ?? '', basketName: basketName ?? '', quantity: String(qty ?? 1), total: String(price ?? 0) } } as never); return; }
              if (isBasketPickedUp) {
                if (isBusiness) {
                  useBusinessStore.getState().setTargetOrder(String(detailNotif.reference_id ?? ''), msgParams.location_id ?? null);
                  router.push('/(business)/incoming-orders' as never);
                } else {
                  router.push('/(tabs)/orders' as never);
                }
                return;
              }
              if (isNewReservation || isCancelled) {
                if (isBusiness) {
                  useBusinessStore.getState().setTargetOrder(String(detailNotif.reference_id ?? ''), msgParams.location_id ?? null);
                  router.push('/(business)/incoming-orders' as never);
                } else {
                  router.push('/(tabs)/orders' as never);
                }
                return;
              }
              else if (isReview) {
                // Only business users may enter the business flow.
                if (isBusiness) router.push('/(business)/dashboard');
              }
            };
            return (
              <NotificationDetail notif={detailNotif} theme={theme} t={t} isBusiness={isBusiness} onClose={() => setDetailNotif(null)} onAction={handleAction} />
            );
          })()}
        </View>
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
