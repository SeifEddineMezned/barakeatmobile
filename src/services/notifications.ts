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

export async function checkFavoriteNotifications(favoriteLocationIds: (number | string)[]): Promise<void> {
  if (!favoriteLocationIds.length) return;
  await apiClient.post('/api/notifications/check-favorites', { favorite_location_ids: favoriteLocationIds }).catch(() => {});
}
