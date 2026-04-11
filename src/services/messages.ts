import { apiClient } from '@/src/lib/api';

export interface Conversation {
  id: number;
  business_user_id: number;
  buyer_id: number;
  reservation_id?: number;
  location_id?: number;
  status: 'open' | 'closed' | 'blocked';
  created_at: string;
  updated_at: string;
  business_name?: string;
  buyer_name?: string;
  org_name?: string;
  org_image?: string;
  unread_count: number;
  last_message?: string;
  last_message_at?: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name?: string;
  text: string;
  is_read: boolean;
  created_at: string;
}

export async function createConversation(data: {
  buyer_id: number;
  reservation_id?: number;
  location_id?: number;
  message: string;
}): Promise<{ conversation: Conversation; message: Message }> {
  const res = await apiClient.post<any>('/api/messages/conversations', data);
  return res.data;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await apiClient.get<any>('/api/messages/conversations');
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchMessages(conversationId: number): Promise<{ conversation: Conversation; messages: Message[] }> {
  const res = await apiClient.get<any>(`/api/messages/conversations/${conversationId}`);
  return res.data;
}

export async function sendMessage(conversationId: number, text: string): Promise<Message> {
  const res = await apiClient.post<any>(`/api/messages/conversations/${conversationId}`, { text });
  return res.data;
}

export async function updateConversationStatus(conversationId: number, status: 'open' | 'closed' | 'blocked'): Promise<void> {
  await apiClient.put(`/api/messages/conversations/${conversationId}/status`, { status });
}

export async function fetchUnreadMessageCount(): Promise<number> {
  const res = await apiClient.get<any>('/api/messages/unread-count');
  return res.data?.count ?? 0;
}

export async function getConversationByReservation(reservationId: number | string): Promise<Conversation | null> {
  const res = await apiClient.get<any>(`/api/messages/conversations/by-reservation/${reservationId}`);
  return res.data ?? null;
}

/** Returns a map of reservation_id → unread message count for all conversations */
export async function fetchConversationUnreads(): Promise<Record<number, number>> {
  const convs = await fetchConversations();
  const map: Record<number, number> = {};
  for (const c of convs) {
    if (c.reservation_id && Number(c.unread_count) > 0) {
      map[c.reservation_id] = Number(c.unread_count);
    }
  }
  return map;
}
