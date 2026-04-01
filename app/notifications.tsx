import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ArrowLeft, ShoppingBag, Star, XCircle, Bell, CheckCircle } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { StatusBar } from 'expo-status-bar';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  NotificationFromAPI,
} from '@/src/services/notifications';
import { useNotificationStore } from '@/src/stores/notificationStore';
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
  return { Icon: Bell, color: '#6b7280', bg: '#6b728018' };
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const decrementUnread = useNotificationStore((s) => s.decrementUnread);
  const clearUnread = useNotificationStore((s) => s.clearUnread);
  const [detailNotif, setDetailNotif] = useState<NotificationFromAPI | null>(null);

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    staleTime: 30_000,
  });

  const handleMarkAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead();
      clearUnread();
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    } catch {
      // silently fail
    }
  }, [clearUnread, queryClient]);

  const handlePressNotification = useCallback(
    async (item: NotificationFromAPI) => {
      if (!item.is_read) {
        try {
          await markNotificationRead(item.id);
          decrementUnread();
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
        } catch {
          // silently fail
        }
      }
      setDetailNotif(item);
    },
    [decrementUnread, queryClient]
  );

  const renderItem = useCallback(
    ({ item }: { item: NotificationFromAPI }) => (
      <TouchableOpacity
        style={[
          styles.notificationItem,
          {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r12,
            padding: theme.spacing.lg,
            marginBottom: theme.spacing.md,
          },
        ]}
        onPress={() => handlePressNotification(item)}
        activeOpacity={0.7}
      >
        <View style={styles.notificationRow}>
          {(() => {
            const { Icon, color, bg } = getNotifIcon(item.type, item.title);
            return (
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', marginRight: theme.spacing.md }}>
                <Icon size={18} color={color} />
                {!item.is_read && (
                  <View style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary, borderWidth: 2, borderColor: theme.colors.surface }} />
                )}
              </View>
            );
          })()}
          <View style={styles.notificationContent}>
            {item.title ? (
              <Text
                style={[
                  {
                    color: theme.colors.textPrimary,
                    ...theme.typography.bodySm,
                    fontWeight: item.is_read ? ('400' as const) : ('600' as const),
                  },
                ]}
                numberOfLines={1}
              >
                {resolveNotifText(item.title, t)}
              </Text>
            ) : null}
            <Text
              style={[
                {
                  color: item.title ? theme.colors.textSecondary : theme.colors.textPrimary,
                  ...theme.typography.bodySm,
                  fontWeight: !item.title && !item.is_read ? ('600' as const) : ('400' as const),
                  marginTop: item.title ? 2 : 0,
                },
              ]}
              numberOfLines={2}
            >
              {resolveNotifText(item.message, t)}
            </Text>
          </View>
          <Text
            style={[
              {
                color: theme.colors.textSecondary,
                ...theme.typography.caption,
                marginLeft: theme.spacing.md,
              },
            ]}
          >
            {timeAgo(item.created_at, t)}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [theme, handlePressNotification]
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
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: theme.spacing.md }}>
            <ArrowLeft size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
            {t('notifications.title')}
          </Text>
        </View>
        <TouchableOpacity onPress={handleMarkAllRead}>
          <CheckCheck size={22} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      {notificationsQuery.isLoading ? (
        <DelayedLoader />
      ) : (
        <FlatList
          data={notificationsQuery.data ?? []}
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
            <View style={styles.emptyState}>
              <Text
                style={[
                  {
                    color: theme.colors.textSecondary,
                    ...theme.typography.body,
                    textAlign: 'center' as const,
                  },
                ]}
              >
                {t('notifications.empty')}
              </Text>
            </View>
          }
        />
      )}

      {/* Notification detail popup */}
      <Modal visible={detailNotif !== null} transparent animationType="fade" onRequestClose={() => setDetailNotif(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} activeOpacity={1} onPress={() => setDetailNotif(null)}>
          <View
            style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 380 }}
            onStartShouldSetResponder={() => true}
          >
            {detailNotif && (() => {
              const { Icon, color, bg } = getNotifIcon(detailNotif.type, detailNotif.title);
              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                      <Icon size={22} color={color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      {detailNotif.title ? (
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                          {resolveNotifText(detailNotif.title, t)}
                        </Text>
                      ) : null}
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                        {timeAgo(detailNotif.created_at, t)}
                      </Text>
                    </View>
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 22, marginBottom: 20 }}>
                    {resolveNotifText(detailNotif.message, t)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setDetailNotif(null)}
                    style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                      {t('common.close', { defaultValue: 'Close' })}
                    </Text>
                  </TouchableOpacity>
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
