import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ArrowLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  NotificationFromAPI,
} from '@/src/services/notifications';
import { useNotificationStore } from '@/src/stores/notificationStore';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const decrementUnread = useNotificationStore((s) => s.decrementUnread);
  const clearUnread = useNotificationStore((s) => s.clearUnread);

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
          <View
            style={[
              styles.dot,
              {
                backgroundColor: item.is_read ? 'transparent' : theme.colors.primary,
                marginRight: theme.spacing.md,
              },
            ]}
          />
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
                {item.title}
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
              {item.message}
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
            {timeAgo(item.created_at)}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [theme, handlePressNotification]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
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
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text
            style={[
              {
                color: theme.colors.textSecondary,
                ...theme.typography.body,
                marginTop: 16,
              },
            ]}
          >
            {t('common.loading')}
          </Text>
        </View>
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
