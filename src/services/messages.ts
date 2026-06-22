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
  /** Sticky flag — true once the merchant has reported this customer thread. */
  reported_by_business?: boolean;
  /** When the merchant reported it, the reason key, and any free-text detail
   *  they typed (used when the reason is "other"). */
  reported_at?: string | null;
  reported_reason?: string | null;
  reported_details?: string | null;
}

/** Reasons accepted by POST /conversations/:id/report — mirror the backend. */
export type ConversationReportReason = 'abuse' | 'harassment' | 'spam' | 'fraud' | 'dispute' | 'other';

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

export async function sendMessage(conversationId: number, text: string, idempotencyKey?: string): Promise<Message> {
  // idempotencyKey: per-tap UUID minted by the chat screen. Sent as the
  // Idempotency-Key header AND as `client_request_id` in the body so a proxy
  // that strips custom headers still gets the dedup signal through. When the
  // backend sees a (sender_id, key) pair it has already processed, it returns
  // the original message row instead of inserting a duplicate.
  const key = idempotencyKey && idempotencyKey.length > 0 ? idempotencyKey : undefined;
  const res = await apiClient.post<any>(
    `/api/messages/conversations/${conversationId}`,
    { text, client_request_id: key },
    key ? { headers: { 'Idempotency-Key': key } } : undefined
  );
  return res.data;
}

export async function updateConversationStatus(conversationId: number, status: 'open' | 'closed' | 'blocked'): Promise<void> {
  await apiClient.put(`/api/messages/conversations/${conversationId}/status`, { status });
}

/**
 * Archive a conversation from the BUSINESS-side list. One-way: once a
 * conversation is archived it disappears from the merchant's /conversations
 * response (any team member with access — the flag is conversation-scoped
 * not user-scoped). The buyer's view is intentionally unaffected.
 *
 * Backed by PUT /api/messages/conversations/:id/archive on the server.
 * Refuses if the requester is the conversation's buyer (the buyer cannot
 * archive a thread from under the merchant's feet).
 */
export async function archiveConversation(conversationId: number): Promise<void> {
  await apiClient.put(`/api/messages/conversations/${conversationId}/archive`);
}

/**
 * Report a customer conversation (merchant-side only). The backend emails the
 * full chat transcript to the support inbox and sets a sticky flag on the
 * conversation so its card shows it was reported. Returns whether the thread
 * had already been reported before this call.
 */
export async function reportConversation(
  conversationId: number,
  reason: ConversationReportReason,
  details?: string,
): Promise<{ alreadyReported: boolean }> {
  const res = await apiClient.post<any>(`/api/messages/conversations/${conversationId}/report`, {
    reason,
    ...(details ? { details } : {}),
  });
  return { alreadyReported: !!res.data?.already_reported };
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
