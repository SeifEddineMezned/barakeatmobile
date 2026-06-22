import { apiClient } from '@/src/lib/api';

export interface NotificationFromAPI {
  id: number;
  user_id: number;
  type?: string;
  title?: string;
  message: string;
  reference_id?: number;
  is_read: boolean;
  created_at: string;
  updated_at?: string;
}

export async function fetchNotifications(): Promise<NotificationFromAPI[]> {
  console.log('[Notifications] Fetching notifications');
  const res = await apiClient.get<NotificationFromAPI[] | { notifications: NotificationFromAPI[] } | { data: NotificationFromAPI[] }>('/api/notifications/my');
  const data = res.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && 'notifications' in data) return (data as any).notifications;
  if (data && typeof data === 'object' && 'data' in data) return (data as any).data;
  return [];
}

export async function markNotificationRead(id: number | string): Promise<void> {
  await apiClient.put(`/api/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.put('/api/notifications/read-all');
}

export async function getUnreadCount(): Promise<number> {
  try {
    const res = await apiClient.get<{ count: number } | { unread_count: number }>('/api/notifications/unread-count');
    const data = res.data;
    if (data && typeof data === 'object' && 'count' in data) return (data as any).count;
    if (data && typeof data === 'object' && 'unread_count' in data) return (data as any).unread_count;
    return 0;
  } catch {
    return 0;
  }
}

export async function deleteNotification(id: number | string): Promise<void> {
  await apiClient.delete(`/api/notifications/${id}`);
}

export async function clearAllNotifications(): Promise<void> {
  await apiClient.delete('/api/notifications/clear-all');
}

// Bulk variants — single HTTP request per batch. Mobile-side "tout sélectionner →
// Supprimer/Marquer lu" used to fan out N individual requests, hit the rate
// limiter on a few, and silently drop them; the bulk endpoints are one atomic
// SQL op per call so the full selection clears in one pass.
export async function bulkDeleteNotifications(ids: (number | string)[]): Promise<{ deleted: number }> {
  if (ids.length === 0) return { deleted: 0 };
  const res = await apiClient.post<{ deleted: number }>('/api/notifications/bulk-delete', { ids });
  return res.data ?? { deleted: 0 };
}

export async function bulkMarkNotificationsRead(ids: (number | string)[]): Promise<{ updated: number }> {
  if (ids.length === 0) return { updated: 0 };
  const res = await apiClient.post<{ updated: number }>('/api/notifications/bulk-mark-read', { ids });
  return res.data ?? { updated: 0 };
}

// Deprecated: favorites notifications are now produced server-side by the
// favorites-notify cron (with push + basket photo + anti-spam), fed by the
// favorites synced via PUT /api/auth/favorites. This client poll used to
// create in-app `favorite_available` rows with no push; calling it now would
// duplicate the cron's output, so it's intentionally a no-op. Kept (with its
// signature) so existing call sites don't break.
export async function checkFavoriteNotifications(_favoriteLocationIds: (number | string)[]): Promise<void> {
  return;
}
