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
import { CheckCheck, ArrowLeft, ShoppingBag, Star, XCircle, Bell, CheckCircle, Clock, MapPin, Navigation, User, MoreHorizontal, EyeOff, X, Check, MessageCircle, Zap } from 'lucide-react-native';
import { adminBroadcastContent } from '@/src/utils/adminBroadcast';
import { DeleteIcon8 } from '@/src/components/ui/Icon8';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import {
  fetchNotifications,
  markNotificationRead,
  deleteNotification,
  bulkDeleteNotifications,
  bulkMarkNotificationsRead,
  NotificationFromAPI,
} from '@/src/services/notifications';
import { useAuthStore } from '@/src/stores/authStore';
import { useBusinessStore } from '@/src/stores/businessStore';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { NotificationDetail } from '@/src/components/NotificationDetail';
import { useCustomAlert } from '@/src/components/CustomAlert';

// Hard cap on how many notifications a single batch action will touch the
// backend with. The bulk endpoints execute a single SQL statement so they
// comfortably handle the page's LIMIT 50, but we cap here to keep behaviour
// predictable under load and to give the user a clear "X traités, recommencez"
// message instead of a silent-feeling op if the selection ever balloons.
const BATCH_CAP = 25;

// Bulk operations route through dedicated /bulk-delete and /bulk-mark-read
// endpoints — one HTTP request per batch, one atomic SQL operation per request.
// The earlier per-id fan-out (with retry+throttle) still left a few survivors
// when the rate limiter dropped retries; the bulk path eliminates that window.

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
      // Prepend the org name to the location whenever the backend sent it
      // in the params. Mirrors what NotificationDetail does with a React-
      // Query org lookup; here we use what's already on the payload so
      // the list rows stay zero-query. Older notifs that don't carry
      // `org_name` fall through to plain location — no regression.
      const orgName = String(params.org_name ?? '').trim();
      const locName = String(params.location ?? '').trim();
      if (orgName && locName && orgName !== locName) {
        params.location = `${orgName} - ${locName}`;
      }
      // Backfill `count` from the legacy field names so old notifications (saved
      // before the i18next plural conversion) still pick the right _one/_other
      // variant instead of falling through to the missing base key.
      if (params.count == null) {
        params.count = params.quantity ?? params.qty ?? params.streak ?? params.rating;
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
  if (key.includes('admin_broadcast') || key.includes('broadcast') || key.includes('announcement')) {
    // Admin/platform announcement — brand green accent. The card/popup render
    // the Barakeat logo as the avatar instead of this icon.
    return { Icon: Bell, color: '#114b3c', bg: '#114b3c18' };
  }
  if (key.includes('order_confirmed') || key.includes('new_reservation')) {
    return { Icon: ShoppingBag, color: '#114b3c', bg: '#114b3c18' };
  }
  if (key.includes('basket_picked_up')) {
    return { Icon: CheckCircle, color: '#22c55e', bg: '#22c55e18' };
  }
  if (key.includes('low_stock')) {
    // "Bientôt épuisé" — a time-ticker (clock) signals urgency.
    return { Icon: Clock, color: '#f59e0b', bg: '#f59e0b18' };
  }
  if (key.includes('pickup_confirmed') || key.includes('collected')) {
    return { Icon: CheckCircle, color: '#22c55e', bg: '#22c55e18' };
  }
  if (key.includes('pickup_reminder') || key.includes('pickup_closing')) {
    // Time-based pickup nudge (opening soon / closing soon) — clock = urgency.
    return { Icon: Clock, color: '#f59e0b', bg: '#f59e0b18' };
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
function NotifCard({ item, theme, t, onPress, onHide, getReservationImage, selectionMode, isSelected, onToggleSelect, isBusiness }: {
  item: NotificationFromAPI; theme: any; t: any;
  onPress: (item: NotificationFromAPI) => void;
  onHide: (id: number) => void;
  getReservationImage: (refId?: number) => string | null;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
  isBusiness?: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const { Icon, color, bg } = getNotifIcon(item.type, item.title);
  // Admin/platform broadcasts store the admin-authored title/message as PLAIN
  // text (not an i18n {key, params} blob), so resolveNotifText would treat them
  // as unknown keys and blank them out. Render the raw text directly, and show
  // the Barakeat logo as the avatar instead of the generic bell icon.
  const isAdminBroadcast = (item.type ?? '').includes('admin_broadcast') || (item.type ?? '').includes('broadcast') || (item.type ?? '').includes('announcement');
  // Computed inline (not memoized) so it re-resolves to the CURRENT app language
  // when the user switches languages and the screen re-renders.
  const adminContent = isAdminBroadcast ? adminBroadcastContent(item) : null;
  const titleText = isAdminBroadcast ? (adminContent?.title ?? '') : resolveNotifText(item.title, t);
  const bodyText = isAdminBroadcast ? (adminContent?.body ?? '') : resolveNotifText(item.message, t);
  const selModeRef = useRef(selectionMode);
  selModeRef.current = selectionMode;

  const notifImage = React.useMemo(() => {
    if (isAdminBroadcast) return adminContent?.image ?? null;
    try {
      const parsed = JSON.parse(item.message);
      const p = parsed?.params ?? {};
      // Image preference depends on the viewer:
      //   - Business: every notif card shows the BASKET image of the
      //     concerned basket — the org logo would be redundant since the
      //     business is reading from inside its own portal.
      //   - Customer: prefer the partner's org logo (brand identity), with
      //     basket/location images as fallbacks for older notifications.
      const fromParams = isBusiness
        ? (p.basketImage ?? p.basket_image ?? p.org_logo_url ?? p.locationImage ?? p.location_image ?? p.restaurant_image ?? p.image_url ?? null)
        : (p.org_logo_url ?? p.locationImage ?? p.location_image ?? p.restaurant_image ?? p.image_url ?? p.basketImage ?? p.basket_image ?? null);
      if (fromParams) return fromParams;
    } catch {}
    return getReservationImage(item.reference_id) ?? null;
  }, [item.message, item.reference_id, getReservationImage, isBusiness, isAdminBroadcast, adminContent?.image]);

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
            {notifImage ? (
              // Org logo (circular) when the notification carries one.
              // Notifications without org context (streak, wallet credit, etc.)
              // keep the colored typed icon below so the inbox stays scannable.
              <Image source={{ uri: notifImage }} style={{ width: 36, height: 36, borderRadius: 18, marginRight: theme.spacing.md }} resizeMode="cover" />
            ) : isAdminBroadcast ? (
              // Platform announcement → Barakeat logo avatar (not a generic bell).
              <Image source={require('@/assets/images/barakeat_halo_logo_ios.png')} style={{ width: 36, height: 36, borderRadius: 18, marginRight: theme.spacing.md }} resizeMode="cover" />
            ) : (
              <View style={{ width: 36, alignItems: 'center', marginRight: theme.spacing.md }}>
                <Icon size={20} color={color} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              {titleText ? (
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, lineHeight: 19, fontFamily: item.is_read ? 'Poppins_400Regular' : 'Poppins_600SemiBold', fontWeight: item.is_read ? ('400' as const) : ('600' as const) }} numberOfLines={1}>
                  {titleText}
                </Text>
              ) : null}
              <Text
                style={{ color: titleText ? theme.colors.textSecondary : theme.colors.textPrimary, fontSize: 13, lineHeight: 18, fontFamily: (!titleText && !item.is_read) ? 'Poppins_600SemiBold' : 'Poppins_400Regular', fontWeight: !titleText && !item.is_read ? ('600' as const) : ('400' as const), marginTop: titleText ? 2 : 0 }}
                numberOfLines={2}
              >
                {bodyText}
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
  const customAlert = useCustomAlert();
  const { user } = useAuthStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isRestoringSession = useAuthStore((s) => s.isRestoringSession);
  const isBusiness = user?.role === 'business';

  // Belt-and-suspenders for the push-tap-without-auth case. If we somehow land
  // here without a session (residual route restoration, a stale deep link,
  // anything that slipped past the _layout tap-handler gate), bounce to
  // sign-in immediately instead of hanging the loader on a 401'd fetch.
  useEffect(() => {
    if (!isRestoringSession && !isAuthenticated) {
      router.replace('/auth/sign-in' as never);
    }
  }, [isAuthenticated, isRestoringSession, router]);

  // Render-time short-circuit: when this screen is opened without a session,
  // return null SYNCHRONOUSLY on the first render so the wave loader never
  // paints while React waits for the useEffect above to fire the redirect.
  // Without this the user briefly saw "empty page with infinite Barakeat
  // wave" during the gap between mount and redirect, especially noticeable
  // when they were on verify-email (pre-auth) and a stale InAppNotification
  // popup's "see all" pushed them here.
  if (!isRestoringSession && !isAuthenticated) {
    return null;
  }
  // Get cached reservations to find location images for notifications
  const cachedReservations = queryClient.getQueryData<any[]>(['reservations']) ?? [];
  const getReservationImage = useCallback((refId?: number) => {
    if (!refId) return null;
    const r = cachedReservations.find((res: any) => res.id === refId || String(res.id) === String(refId));
    if (!r) return null;
    // Business viewers want the BASKET image on every card (the org logo is
    // redundant from inside their own portal); customers prefer the partner's
    // brand image. Mirrors the params-image preference in NotifCard.
    return isBusiness
      ? (r.basket?.image_url ?? r.basket?.cover_image_url ?? r.restaurant_image ?? r.org_image_url ?? r.restaurant?.image_url ?? null)
      : (r.restaurant_image ?? r.org_image_url ?? r.restaurant?.image_url ?? r.basket?.image_url ?? r.basket?.cover_image_url ?? null);
  }, [cachedReservations, isBusiness]);
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

  // Auto-open a specific notification's detail modal when the page was opened
  // via the in-app popup's bell shortcut (which appends ?openId=<id>). Waits
  // for the list query to resolve so we can resolve the id to a notif row,
  // and only fires once per id to survive re-renders.
  const { openId } = useLocalSearchParams<{ openId?: string }>();
  const openIdAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || openIdAppliedRef.current === openId) return;
    const list = notificationsQuery.data ?? [];
    if (list.length === 0) return;
    const found = list.find((n) => String(n.id) === String(openId));
    if (found) {
      setDetailNotif(found);
      openIdAppliedRef.current = openId;
    }
  }, [openId, notificationsQuery.data]);

  // Selection mode helpers
  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Retention: read notifications older than 7 days are AUTO-MASKED — they
  // join the "Masquées" filter alongside items the user manually swiped to
  // hide. We don't write them into the AsyncStorage `hiddenIds` set (which
  // would grow unbounded over time); we compute auto-masked status on the
  // fly from `created_at + is_read` and OR it into the filter logic.
  // Notifications of any state older than 30 days get hard-deleted from
  // the backend once per app session (see the auto-delete effect below).
  const RETENTION_ARCHIVE_DAYS = 7;
  const RETENTION_DELETE_DAYS = 30;
  const isAutoMasked = useCallback((n: NotificationFromAPI): boolean => {
    if (!n.is_read) return false;
    if (!n.created_at) return false;
    const ageMs = Date.now() - new Date(n.created_at).getTime();
    return ageMs > RETENTION_ARCHIVE_DAYS * 86400_000;
  }, []);

  const filteredData = React.useMemo(() => {
    return (notificationsQuery.data ?? []).filter(n => {
      // Chat / reply notifications are surfaced through the speech-bubble popup
      // and the conversation screens — NEVER the bell list, for ALL users. They
      // still arrive as OS push notifications; they just don't clutter the
      // notifications page (which stays focused on order/pickup/review events).
      const tp = (n.type ?? '').toLowerCase();
      if (tp.includes('message') || tp.includes('reply')) return false;
      const isHiddenOrMasked = hiddenIds.has(n.id) || isAutoMasked(n);
      if (filter === 'hidden') return isHiddenOrMasked;
      if (isHiddenOrMasked) return false;
      if (filter === 'unread' && n.is_read) return false;
      return true;
    });
  }, [notificationsQuery.data, filter, hiddenIds, isAutoMasked, isBusiness]);

  // Auto-delete sweep — once per app session per fresh data arrival, delete
  // notifications older than 30 days from the backend. Gated by a ref so it
  // doesn't refire on every re-render. Batched via Promise.allSettled to
  // avoid hammering the API.
  const deleteSweepRunRef = useRef(false);
  useEffect(() => {
    if (deleteSweepRunRef.current) return;
    const list = notificationsQuery.data;
    if (!list || list.length === 0) return;
    const cutoff = Date.now() - RETENTION_DELETE_DAYS * 86400_000;
    const toDelete = list.filter((n) => n.created_at && new Date(n.created_at).getTime() < cutoff);
    if (toDelete.length === 0) {
      deleteSweepRunRef.current = true;
      return;
    }
    deleteSweepRunRef.current = true;
    console.log('[Notifications] Auto-delete sweep — removing', toDelete.length, 'notifications older than', RETENTION_DELETE_DAYS, 'days');
    bulkDeleteNotifications(toDelete.map((n) => n.id)).catch(() => {}).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.refetchQueries({ queryKey: ['unread-count'] });
    });
  }, [notificationsQuery.data, queryClient]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredData.map(n => n.id)));
  }, [filteredData]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  // Helper: cap a selection at BATCH_CAP and surface a "X traités à la fois,
  // recommencez pour les autres" notice when the selection overflows the cap.
  // Returns the ids slice that the caller should process this round (preserves
  // the original Set's insertion order — newest-first, since selectAll iterates
  // filteredData which is sorted DESC by created_at on the backend).
  const sliceForBatch = useCallback((all: number[], total: number) => {
    if (total <= BATCH_CAP) return all;
    customAlert.showAlert(
      t('notifications.batchCapTitle', { defaultValue: 'Trop d\'éléments sélectionnés' }),
      t('notifications.batchCapBody', {
        cap: BATCH_CAP,
        total,
        defaultValue: 'Pour éviter de surcharger le serveur, seuls {{cap}} éléments sur {{total}} seront traités à la fois. Recommencez pour les éléments restants.',
      }),
    );
    return all.slice(0, BATCH_CAP);
  }, [customAlert, t]);

  const batchMarkRead = useCallback(async () => {
    const all = [...selectedIds];
    const ids = sliceForBatch(all, all.length);
    try {
      await bulkMarkNotificationsRead(ids);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.refetchQueries({ queryKey: ['unread-count'] });
    } catch {}
    exitSelectionMode();
  }, [selectedIds, queryClient, exitSelectionMode, sliceForBatch]);

  const batchHide = useCallback(async () => {
    const all = [...selectedIds];
    const ids = sliceForBatch(all, all.length);
    setHiddenIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
    try {
      await bulkMarkNotificationsRead(ids);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.refetchQueries({ queryKey: ['unread-count'] });
    } catch {}
    exitSelectionMode();
  }, [selectedIds, exitSelectionMode, queryClient, sliceForBatch]);

  const batchDelete = useCallback(async () => {
    // Single bulk DELETE (one HTTP, one atomic SQL DELETE … WHERE id = ANY($ids))
    // instead of N per-id DELETEs. The fan-out version tripped the rate limiter
    // on a few requests and — because the shared 429-retry layer skips
    // non-idempotent verbs — those failed silently, leaving a handful of
    // notifications behind on "tout sélectionner → Supprimer". The BATCH_CAP
    // additionally bounds each request so behaviour stays predictable on very
    // large selections; the alert tells the user when their selection was
    // sliced so they know to repeat the action.
    const all = [...selectedIds];
    const ids = sliceForBatch(all, all.length);
    try { await bulkDeleteNotifications(ids); } catch {}
    setHiddenIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.refetchQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    exitSelectionMode();
  }, [selectedIds, exitSelectionMode, queryClient, sliceForBatch]);

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
      return <NotifCard item={item} theme={theme} t={t} onPress={handlePressNotification} onHide={hideNotification} getReservationImage={getReservationImage} selectionMode={selectionMode} isSelected={selectedIds.has(item.id)} onToggleSelect={toggleSelect} isBusiness={isBusiness} />;
    },
    [theme, handlePressNotification, hideNotification, t, selectionMode, selectedIds, toggleSelect, isBusiness]
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
            <TouchableOpacity onPress={exitSelectionMode} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
              <X size={22} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </>
        ) : (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 36 }}>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              style={{ position: 'absolute', left: 0 }}
            >
              <ArrowLeft size={24} color={theme.colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
              {t('notifications.title')}
            </Text>
            <TouchableOpacity
              onPress={() => setSelectionMode(true)}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              style={{ position: 'absolute', right: 0 }}
            >
              <MoreHorizontal size={22} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
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
                <DeleteIcon8 size={16} color="#fff" />
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
            const isStreak = notifType.includes('streak');
            // Customer pickup-window notifs (reminder ~1h before start,
            // closing ~1h before end, expired after the window, extended
            // when the merchant grants extra time). Without these flags
            // the detail popup's "Voir la commande" CTA had no matching
            // branch in handleAction below and silently no-op'd — same
            // problem the in-app popup had before being patched.
            const isPickupReminder = notifType.includes('pickup_reminder');
            const isPickupClosing = notifType.includes('pickup_closing');
            const isPickupExtended = notifType.includes('pickup_extended');
            const isOrderExpired = notifType.includes('order_expired');
            const handleAction = () => {
              setDetailNotif(null);
              if (isMessage) { router.push({ pathname: '/message/[id]', params: { id: String(detailNotif.reference_id ?? '') } } as never); return; }
              if (isStreak) { router.push('/(tabs)' as never); return; }
              if (!isBusiness && (isPickupReminder || isPickupClosing || isPickupExtended || isOrderExpired)) {
                // Land on the orders tab and target the matching reservation
                // so the screen scrolls + auto-expands it. Expired rows live
                // in the issues tab; the rest are still actionable upcoming
                // orders.
                router.push({
                  pathname: '/(tabs)/orders',
                  params: {
                    tab: isOrderExpired ? 'issues' : 'upcoming',
                    target: String(detailNotif.reference_id ?? ''),
                  },
                } as never);
                return;
              }
              if (isPickupConfirmed && !isBusiness) {
                router.push({ pathname: '/review', params: {
                  reservationId: String(detailNotif.reference_id ?? ''),
                  locationId: String(msgParams.location_id ?? msgParams.locationId ?? ''),
                  locationName: locationName ?? '',
                  locationLogo: msgParams.locationImage ?? msgParams.location_image ?? '',
                  basketImage: msgParams.basketImage ?? msgParams.basket_image ?? '',
                  basketName: basketName ?? '',
                  quantity: String(qty ?? 1),
                  total: String(price ?? 0),
                } } as never);
                return;
              }
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
                  // Business: setTargetOrder + the incoming-orders screen
                  // auto-switches to the "issues" tab when the target's
                  // status is cancelled. Path is the same for both new
                  // reservations and cancellations.
                  useBusinessStore.getState().setTargetOrder(String(detailNotif.reference_id ?? ''), msgParams.location_id ?? null);
                  router.push('/(business)/incoming-orders' as never);
                } else if (isCancelled) {
                  // Customer cancelled notif → "issues" (problems) tab so
                  // the cancelled order is visible instead of the empty
                  // "upcoming" tab where it would no longer appear.
                  // `target` carries the cancelled reservation id; the
                  // orders screen scrolls + highlights it (red border) on arrival.
                  router.push({
                    pathname: '/(tabs)/orders',
                    params: { tab: 'issues', target: String(detailNotif.reference_id ?? '') },
                  } as never);
                } else {
                  // Customer order-confirmed / new-reservation notif → mirror
                  // the post-reservation "Voir la commande" popup behaviour:
                  // land on the upcoming tab with target=<id> so the orders
                  // screen scrolls to + auto-expands the freshly confirmed
                  // card. tab=upcoming (NOT issues) tells the orders screen
                  // to skip the red border — this is a positive landing.
                  const refId = String(detailNotif.reference_id ?? '');
                  if (refId) {
                    router.push({
                      pathname: '/(tabs)/orders',
                      params: { tab: 'upcoming', target: refId },
                    } as never);
                  } else {
                    router.push('/(tabs)/orders' as never);
                  }
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
