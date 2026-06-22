import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Send, Lock, MoreVertical, MessageCircle, User as UserIcon, Flag, Check, X, ChevronRight, Ban } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMessages, sendMessage, updateConversationStatus, createConversation, getConversationByReservation, reportConversation, type Message, type ConversationReportReason } from '@/src/services/messages';
import { ModalCard } from '@/src/components/ui/ModalCard';
import { fetchLocationById } from '@/src/services/restaurants';
import { fetchReservationById } from '@/src/services/reservations';
import { orderIdToCode } from '@/src/utils/orderCode';

// Join "Org" + "Location" into a display name without producing
// "Org - Org - Location" when the location row was legacy-stored with
// the org prefix already baked in. Mirrors the SQL CASE the backend
// uses on /conversations/:id and /reservations/:id so all three
// surfaces render the same name.
function joinOrgLocation(orgRaw: string | null | undefined, locRaw: string | null | undefined): string | null {
  const org = orgRaw?.trim() || null;
  const loc = locRaw?.trim() || null;
  if (org && loc) {
    if (loc === org) return org;
    if (loc.startsWith(`${org} - `)) return loc;
    return `${org} - ${loc}`;
  }
  return org ?? loc ?? null;
}
import { StatusBar } from 'expo-status-bar';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { getErrorMessage, makeAttemptKey } from '@/src/lib/api';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { OrderSummaryCard } from '@/src/components/OrderSummaryCard';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { buildDemoOrder } from '@/src/lib/demoData';
import { Hand } from 'lucide-react-native';
import { usePollWhenFocused } from '@/src/hooks/usePollWhenFocused';
import { deriveInitials } from '@/src/utils/initials';

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string; reservationId?: string; buyerId?: string; locationId?: string; demo?: string }>();
  const rawId = params.id ?? '';
  const isReservationBased = rawId.startsWith('res-');
  const reservationId = isReservationBased ? rawId.replace('res-', '') : params.reservationId;
  const [resolvedConvId, setResolvedConvId] = useState<number | null>(isReservationBased ? null : Number(rawId) || null);
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const alert = useCustomAlert();
  const flatListRef = useRef<FlatList>(null);
  const [text, setText] = useState('');
  const [showMenu, setShowMenu] = useState(false);

  // ── Report-customer flow (merchant side) ─────────────────────────────────
  // The merchant flags a problematic customer thread; the backend emails the
  // full transcript to support and stickily marks the conversation. We surface
  // a branded confirmation (no native Alert) and reflect the flagged state on
  // the menu immediately via `reportedLocal` until the conversations query
  // refresh confirms `reported_by_business`.
  const CONV_REPORT_REASONS: ConversationReportReason[] = ['abuse', 'harassment', 'spam', 'fraud', 'dispute', 'other'];
  const [reportVisible, setReportVisible] = useState(false);          // reason picker / result
  const [reportInfoVisible, setReportInfoVisible] = useState(false);  // status info (already flagged)
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportResult, setReportResult] = useState<'success' | 'error' | null>(null);
  // When the merchant taps "Autre", the picker reveals a free-text box instead
  // of submitting immediately. `otherText` holds what they type.
  const [otherSelected, setOtherSelected] = useState(false);
  const [otherText, setOtherText] = useState('');
  // Optimistic local record (reason + free-text + when) so the header flag
  // colours and the status popup work immediately, before the conversations
  // refetch confirms the server fields.
  const [reportedLocal, setReportedLocal] = useState<{ reason: ConversationReportReason; at: string; details?: string | null } | null>(null);
  const reasonLabel = (reason: string) => t(`messages.report.reasons.${reason}`, { defaultValue: t('messages.report.reasons.other', { defaultValue: 'Autre' }) });
  // Motif line for the status popup: a custom "other" note shows the typed text
  // + a "(du client)" tag; everything else shows the translated reason label.
  const reportMotif = (info: { reason: ConversationReportReason | string; details?: string | null } | null): string => {
    if (!info) return '';
    if (info.reason === 'other' && info.details && String(info.details).trim()) {
      return `« ${String(info.details).trim()} » ${t('messages.report.fromClient', { defaultValue: '(du client)' })}`;
    }
    return reasonLabel(String(info.reason));
  };
  const resetReportFlow = () => { setOtherSelected(false); setOtherText(''); };
  const openReport = () => { setShowMenu(false); setReportResult(null); resetReportFlow(); setReportVisible(true); };
  const closeReport = () => { setReportVisible(false); setReportResult(null); resetReportFlow(); };
  const openReportInfo = () => { setShowMenu(false); setReportInfoVisible(true); };
  const closeReportInfo = () => setReportInfoVisible(false);
  const submitReport = async (reason: ConversationReportReason, details?: string) => {
    if (!conversationId || reportSubmitting) return;
    const trimmed = details?.trim() || undefined;
    setReportSubmitting(true);
    try {
      await reportConversation(conversationId, reason, trimmed);
      setReportedLocal({ reason, at: new Date().toISOString(), details: trimmed ?? null });
      setReportResult('success');
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch {
      setReportResult('error');
    } finally {
      setReportSubmitting(false);
    }
  };

  // Demo: this screen was opened from the orders walkthrough's chat step.
  // Show an instruction popup pointing at the back button, and advance the
  // walkthrough when the user navigates away (back) so the demo continues
  // on the orders screen. Detection uses the `demo=1` param the demo sets
  // when calling router.push.
  const isDemo = params.demo === '1';
  const walkthroughCurrentStep = useWalkthroughStore((s) => s.currentStep);
  // Idempotency guard: prevents this unmount cleanup from racing the
  // (business) layout's safety-net effect, which also calls nextStep
  // when pathname leaves /message. If both fire in the same tick, step
  // advances twice and on a borderline step count the second call can
  // end the walkthrough via clearDemoState. Mirrors the same guard on
  // /business/scan-qr.
  const chatBackAdvanceFiredRef = useRef(false);
  useEffect(() => {
    if (!isDemo) return;
    return () => {
      // On unmount (user taps back / nav pops the screen), advance the
      // walkthrough past the chatBack step.
      if (chatBackAdvanceFiredRef.current) return;
      if (useWalkthroughStore.getState().currentStep?.measureKey === 'chatBack') {
        chatBackAdvanceFiredRef.current = true;
        useWalkthroughStore.getState().nextStep(999);
      }
    };
  }, [isDemo]);

  // Resolve conversation from reservation ID if needed. Disabled in demo
  // mode because the demo reservation id ('demo-order-1') has no real
  // conversation on the backend — firing the lookup would error and
  // break the chat screen for the walkthrough.
  const convLookupQuery = useQuery({
    queryKey: ['conversation-by-reservation', reservationId],
    queryFn: () => getConversationByReservation(Number(reservationId)),
    enabled: !isDemo && isReservationBased && !resolvedConvId,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    if (convLookupQuery.data?.id && !resolvedConvId) {
      setResolvedConvId(convLookupQuery.data.id);
    }
  }, [convLookupQuery.data]);

  const conversationId = resolvedConvId;

  // Live-chat poll, focus-gated. Was the second-biggest source of
  // /api/messages traffic at 6 req/min per open chat. 15s gives the
  // chat a near-live feel; pausing on screen exit + the 30s global
  // staleTime keep returning users from re-firing on every revisit.
  const messagesRefetch = usePollWhenFocused(15_000);
  const messagesQuery = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => fetchMessages(conversationId!),
    enabled: !isDemo && !!conversationId,
    staleTime: 10_000,
    refetchInterval: messagesRefetch,
  });

  const conversation = messagesQuery.data?.conversation;
  const messages = messagesQuery.data?.messages ?? [];

  // Report state of THIS thread — optimistic local first, then the server
  // fields. Drives the header flag colour + which popup the flag opens.
  const reportInfo: { reason: ConversationReportReason | string; at?: string | null; details?: string | null } | null = reportedLocal
    ?? (conversation?.reported_by_business
      ? { reason: (conversation.reported_reason as ConversationReportReason) ?? 'other', at: conversation.reported_at ?? null, details: conversation.reported_details ?? null }
      : null);
  const isReported = !!reportInfo;
  // Header flag press: already-flagged → status info popup; else → reason picker.
  const onFlagPress = () => { if (isReported) openReportInfo(); else openReport(); };

  // Every time fetchMessages succeeds, the backend has just executed an
  // `UPDATE messages SET is_read = true` for everything this user hadn't
  // seen yet — so the unread badge that the orders screens (customer +
  // business) render on the order card's chat icon needs to be re-counted.
  // Without this invalidation the orders screen would keep showing the stale
  // unread count until the 30 s poll tick caught up. `dataUpdatedAt` flips
  // on every successful fetch (initial load, manual refetch, poll), so
  // this effect fires after each one. Conversation list also gets
  // invalidated so the inbox `(business)/conversations` reflects the same
  // change immediately.
  const messagesUpdatedAt = messagesQuery.dataUpdatedAt;
  useEffect(() => {
    if (!messagesUpdatedAt) return;
    void queryClient.invalidateQueries({ queryKey: ['conversation-unreads'] });
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
  }, [messagesUpdatedAt, queryClient]);
  const isBusiness = user?.role === 'business';
  const isMyBusiness = conversation?.business_user_id === Number(user?.id);
  // In demo mode the input bar is hidden — the chat screen is a read-only
  // static placeholder so the user can see the conversation surface, then
  // tap back to continue the walkthrough. Sending a message would hit the
  // backend with a fake reservation id and fail.
  const canReply = !isDemo && (!conversationId || conversation?.status === 'open' || (conversation?.status === 'blocked' && isMyBusiness));
  const isClosed = conversation?.status === 'closed';
  const isBlocked = conversation?.status === 'blocked';
  // Fallback location fetch — keeps the chat header populated when the
  // customer opens this screen from an order card BEFORE the conversation
  // row exists (no message has been sent yet, so /conversations/:id has
  // nothing to return). The route always carries the order's
  // `locationId`, so a one-shot /api/locations/:id call lets us paint the
  // org logo + "Org - Location" title immediately. Gated on:
  //   • customer side only — business chat headers identify the buyer.
  //   • we don't already have the merchant name from the conversation
  //     payload (when present it's authoritative and already correct).
  //   • a locationId is in the route params.
  const fallbackLocationId = params.locationId;
  const conversationHasMerchantInfo = !!(
    (conversation as any)?.res_location_name
    || conversation?.org_name
    || conversation?.business_name
  );
  const locationFallbackQuery = useQuery({
    queryKey: ['location', String(fallbackLocationId ?? '')],
    queryFn: () => fetchLocationById(String(fallbackLocationId)),
    enabled: !isBusiness && !!fallbackLocationId && !conversationHasMerchantInfo && !isDemo,
    staleTime: 5 * 60_000,
  });
  const fallbackLocation = locationFallbackQuery.data;

  // Reservation summary fallback — populates the OrderSummaryCard at the
  // top of the chat with basket name / image / qty / total BEFORE a
  // conversation row exists. The chat screen is opened from an order
  // card (which carries `reservationId` in the route params), so a
  // one-shot /api/reservations/:id call hydrates the card immediately
  // even though /conversations/:id has nothing to return yet. Skipped
  // in demo mode (demo reservation id is fake).
  const conversationHasOrderInfo = !!(
    (conversation as any)?.res_basket_name
    || (conversation as any)?.res_basket_image_url
    || (conversation as any)?.res_total != null
    || (conversation as any)?.res_quantity != null
  );
  const reservationFallbackQuery = useQuery({
    queryKey: ['reservation-chat-fallback', String(reservationId ?? '')],
    queryFn: () => fetchReservationById(String(reservationId)),
    // Fetched whenever a reservation_id exists (not just when the conversation
    // row lacks order display data) — the wall-clock-expired check below needs
    // pickup_end_time + reservation_date, neither of which the LIST endpoint
    // exposes. 5-min staleTime + React Query caching means the cost is one
    // network call per fresh chat open, often served from cache.
    enabled: !isDemo && !!reservationId,
    staleTime: 5 * 60_000,
  });
  const fallbackReservation = reservationFallbackQuery.data;
  // Reservation-status derivation — used to decide whether "Réouvrir la
  // conversation" is offered. Once the order is in a terminal state there's
  // nothing left to talk about; the menu hides the reopen action. Pulled
  // from the conversation row's joined `res_status` first (list endpoint),
  // then the single-reservation fallback (chat opened from an order card
  // before any message exists).
  const TERMINAL_RESV_STATUSES = ['picked_up', 'collected', 'completed', 'cancelled', 'expired', 'refunded'];
  const orderStatus = String(
    (conversation as any)?.res_status
      ?? (fallbackReservation as any)?.status
      ?? ''
  ).toLowerCase();
  // Wall-clock-expired safety net: a reservation whose pickup window has
  // already passed should be treated as terminal even if the server status
  // is still 'confirmed' (the expire-stale-reservations cron runs nightly
  // at ~03:30 Tunisia time, so during the day there can be confirmed-but-
  // already-expired orders in the system). The conversations LIST partition
  // already does this client-side; mirror it here so the chat page's reopen
  // gating stays consistent with the tab the conversation lives in.
  // Reads pickup_end_time + reservation_date from the fallback row; if the
  // window is over, the order is effectively terminal regardless of status.
  const isOrderWallClockExpired = (() => {
    const resv: any = fallbackReservation;
    if (!resv) return false;
    const dateStr: string | null = resv.reservation_date
      ? String(resv.reservation_date).substring(0, 10)
      : (resv.created_at ? String(resv.created_at).substring(0, 10) : null);
    if (!dateStr) return false;
    const endTime = resv.pickup_end_time ?? resv.pickup_end ?? resv.basket?.pickup_end_time ?? null;
    const timeStr = endTime ? String(endTime).substring(0, 5) : '23:59';
    const combined = new Date(`${dateStr}T${timeStr}:00`);
    if (!Number.isFinite(combined.getTime())) return false;
    return Date.now() > combined.getTime();
  })();
  const isOrderTerminal = (
    (!!orderStatus && TERMINAL_RESV_STATUSES.includes(orderStatus))
    || isOrderWallClockExpired
  );
  // Whether the three-dots menu has any actionable items. Open threads
  // always do (close + block); blocked threads do too when the order is
  // still active (unblock). CLOSED threads never have a menu — the only
  // action used to be "Réouvrir la conversation" but that was removed per
  // user request, so the 3-dot trigger is now hidden for every closed
  // conversation (terminal-order or not).
  const hasMenuActions =
    conversation?.status === 'open'
    || (conversation?.status === 'blocked' && !isOrderTerminal);

  // Customer-side title resolution. Four data sources can populate this,
  // depending on which endpoint hydrated which piece of state first:
  //   1. `res_location_name` — the compound "Org - Location" that
  //      GET /conversations/:id computes via JOIN on the linked
  //      reservation (or directly via c.location_id). Preferred.
  //   2. `org_name` + `business_name` — separate fields from the LIST
  //      endpoint. `business_name` is COALESCE(l.name, o.name, u.name)
  //      so it usually equals the LOCATION name; we build the compound
  //      here when both fields are present AND different (otherwise we
  //      end up with "Org - Org" when `business_name` fell back to
  //      org.name on rows missing location.name).
  //   3. Single field — when only one of org_name / business_name is
  //      populated, that one wins on its own.
  //   4. The fallback /api/locations/:id query above — populated only
  //      when the conversation row is empty (no message yet) so the
  //      header isn't stuck on "Commerce" before the first message.
  // The localized "Commerce" sentinel in the JSX below is reached only
  // when EVERY one of those sources is genuinely null.
  const customerSideMerchant = (() => {
    if (conversation) {
      const compound = (conversation as any)?.res_location_name as string | undefined;
      if (compound && compound.trim()) return compound.trim();
      // Same dedup as joinOrgLocation — guard against `business_name`
      // being the legacy compound "Org - Location" stored on
      // locations.name. Without this we render "Burger Co - Burger Co
      // - Centre Ville" whenever the backend list endpoint returns
      // both fields and l.name is already prefixed.
      const compoundFromList = joinOrgLocation(conversation.org_name, conversation.business_name);
      if (compoundFromList) return compoundFromList;
    }
    if (fallbackReservation?.restaurant_name?.trim()) {
      return fallbackReservation.restaurant_name.trim();
    }
    if (fallbackLocation) {
      const fromLocation = joinOrgLocation(
        (fallbackLocation as any)?.org_name,
        (fallbackLocation as any)?.name,
      );
      if (fromLocation) return fromLocation;
    }
    return null;
  })();
  // Business-side title — just the buyer name. The order code used to
  // be appended here ("Sami · BK-12345") but is now shown as a pill
  // inside the OrderSummaryCard right below the header, so repeating
  // it in the title would be visual noise. Falls back to the order
  // code on its own when the buyer name is missing (deleted /
  // anonymised user) so the merchant still has SOMETHING identifying
  // the thread; falls back to "Client" only for legacy direct-message
  // threads with no reservation at all.
  const businessSideTitle = (() => {
    const buyer = conversation?.buyer_name?.trim() || null;
    if (buyer) return buyer;
    // Fallback BEFORE the conversation row exists (no message has been
    // sent yet). The reservation summary endpoint now ships buyer_name,
    // so the merchant sees the customer's name from the first frame
    // instead of "Commande BK-XXXX" until they send the first reply.
    const fallbackBuyer = fallbackReservation?.buyer_name?.trim() || null;
    if (fallbackBuyer) return fallbackBuyer;
    const resvId = conversation?.reservation_id ?? params.reservationId;
    if (resvId != null && resvId !== '') {
      return t('messages.orderThreadTitle', {
        code: orderIdToCode(Number(resvId)),
        defaultValue: 'Commande {{code}}',
      });
    }
    return null;
  })();
  const otherName = isDemo
    ? t('walkthrough.biz.demoOrderCustomer', { defaultValue: 'Sami (démo)' })
    : (isBusiness ? businessSideTitle : customerSideMerchant);

  // Synchronous send guard. `sendMutation.isPending` is updated by React
  // Query via state — it doesn't flip to true until the next render. On
  // Android the Send button's TouchableOpacity is prone to firing twice
  // in the same tick (the user reported duplicate messages after a tap),
  // and both calls slip past the isPending check because neither sees the
  // updated value yet. A ref flag flips synchronously inside handleSend
  // and clears in onSettled, so the second tap is rejected immediately.
  const sendingRef = useRef(false);

  const sendMutation = useMutation({
    mutationFn: async (vars: { msg: string; tempId: number; attemptKey: string }) => {
      if (conversationId) {
        // attemptKey is the per-tap idempotency token. If this POST commits
        // server-side but the response is lost mid-flight, a subsequent
        // retry with the same key returns the original message row instead
        // of inserting a duplicate. The key lives on `vars` so the same
        // value is re-used across any retry of THIS attempt.
        return sendMessage(conversationId, vars.msg, vars.attemptKey);
      }
      // No conversation yet — create one (for buyer initiating first message).
      // createConversation has its own server-side flow and isn't covered by
      // the messages idempotency index; a duplicate-tap in this rare path
      // would create two conversations. Lower priority — typical chat use
      // already has a conversationId by the second message.
      const buyerId = Number(params.buyerId || user?.id || 0);
      const result = await createConversation({
        buyer_id: buyerId,
        reservation_id: reservationId ? Number(reservationId) : undefined,
        location_id: params.locationId ? Number(params.locationId) : undefined,
        message: vars.msg,
      });
      setResolvedConvId(result.conversation.id);
      return result.message;
    },
    // Optimistic update: bubble appears instantly so the chat feels like
    // iMessage / WhatsApp instead of "tap → 2s of dead UI → bubble appears".
    //
    // The previous implementation used `invalidateQueries` in onSuccess /
    // onError to trigger a refetch that would reconcile the optimistic
    // bubble with the server. That ran into two failure modes on Android:
    //   1. Refetch race — a 15s poll tick mid-send could overwrite the
    //      cache with stale server data BEFORE the POST committed,
    //      removing the optimistic bubble. By the time the POST returned,
    //      the invalidate→refetch chain wouldn't fire again until the
    //      next tick.
    //   2. Ghost-success — POST succeeds server-side, response gets
    //      dropped by the cellular radio, onError fires with the cache
    //      already missing the optimistic.
    // The fix is to use explicit setQueryData mutations in onSuccess and
    // onError — no refetch, no race. The 15s poll keeps the conversation
    // fresh; we no longer need to force a refetch on every send.
    onMutate: async (vars) => {
      if (!conversationId) return;
      await queryClient.cancelQueries({ queryKey: ['messages', conversationId] });
      const optimisticMsg: Message = {
        id: vars.tempId,
        conversation_id: conversationId,
        sender_id: Number(user?.id ?? 0),
        sender_name: user?.name,
        text: vars.msg,
        is_read: false,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<{ conversation: any; messages: Message[] } | undefined>(
        ['messages', conversationId],
        (old) => {
          if (!old) return { conversation: conversation ?? null, messages: [optimisticMsg] };
          const messages = Array.isArray(old.messages) ? old.messages : [];
          return { ...old, messages: [...messages, optimisticMsg] };
        },
      );
    },
    onSuccess: (realMsg, vars) => {
      // Replace the optimistic bubble with the real one in-place. No
      // invalidate → no refetch → no race with the poll tick.
      if (conversationId) {
        queryClient.setQueryData<{ conversation: any; messages: Message[] } | undefined>(
          ['messages', conversationId],
          (old) => {
            if (!old) return { conversation: conversation ?? null, messages: [realMsg] };
            const messages = Array.isArray(old.messages) ? old.messages : [];
            const withoutOptimistic = messages.filter((m) => m.id !== vars.tempId);
            // If the poll already pulled the real message in (rare but
            // possible if a 15s tick lands between POST commit and
            // onSuccess), skip the append so we don't double-render.
            if (withoutOptimistic.some((m) => m.id === realMsg.id)) {
              return { ...old, messages: withoutOptimistic };
            }
            return { ...old, messages: [...withoutOptimistic, realMsg] };
          },
        );
      }
      // Conversation list (last-message preview) and by-reservation lookup
      // CAN safely invalidate — they don't host the optimistic bubble.
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (reservationId) void queryClient.invalidateQueries({ queryKey: ['conversation-by-reservation', reservationId] });
    },
    // Silent onError. Defining ANY onError makes the global MutationCache
    // popup in app/_layout.tsx skip this mutation (see the `if
    // (mutation.options.onError) return;` guard there), so the alarming
    // "Erreur — Une erreur est survenue" popup never fires on a chat send.
    //
    // We leave the optimistic bubble in place — the Android "ghost success"
    // case (POST commits, response dropped) is the COMMON failure on
    // cellular. Removing the bubble there would be worse UX than leaving
    // it: the customer iPhone already sees the message; making it
    // disappear on the sender's screen reads as "send failed" when it
    // didn't. The next 15s poll reconciles: if the server has it, the
    // optimistic gets replaced by the real one via the poll's setQueryData;
    // if it doesn't, the optimistic eventually disappears, but the user
    // has had 15s of "it looks sent" to make their next move.
    onError: () => {
      // Intentional no-op on the messages cache. Conversation list is safe
      // to refresh — its preview reads last_message_at which the optimistic
      // doesn't write to.
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onSettled: () => {
      sendingRef.current = false;
    },
  });

  const handleSend = () => {
    if (sendingRef.current) return;
    if (!text.trim() || sendMutation.isPending) return;
    const msg = text.trim();
    // Negative id so it can never collide with a Postgres BIGSERIAL.
    const tempId = -Date.now();
    // Fresh attempt key per tap. Different from `tempId` (which is a local UI
    // identifier for the optimistic bubble) — `attemptKey` is the server-side
    // dedup token. A retry of this SAME tap (e.g. an internal axios retry,
    // future "Réessayer" affordance) would reuse the key; a deliberate second
    // tap gets a new key and is correctly recorded as a second message.
    const attemptKey = makeAttemptKey();
    sendingRef.current = true;
    setText('');
    sendMutation.mutate({ msg, tempId, attemptKey });
  };

  // Inner mutation path — fires the PUT and surfaces the success/error toast.
  // No confirmation prompt here; the public `requestStatusChange` below decides
  // when to gate it behind a confirm modal.
  const applyStatusChange = async (status: 'open' | 'closed' | 'blocked') => {
    if (!conversationId) return;
    try {
      await updateConversationStatus(conversationId, status);
      void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      alert.showAlert(t('common.success'), status === 'closed'
        ? t('messages.conversationClosed', { defaultValue: 'Conversation fermée.' })
        : status === 'blocked'
        ? t('messages.buyerBlocked', { defaultValue: 'Le client ne peut plus répondre.' })
        : t('messages.conversationReopened', { defaultValue: 'Conversation réouverte.' }));
    } catch (err) {
      alert.showAlert(t('common.error'), getErrorMessage(err));
    }
  };

  // Public entry — closed/blocked are destructive and identical-looking in the
  // dropdown, which trained merchants to mis-tap one for the other (closing a
  // conversation they only meant to mute, or vice versa). Gate both behind a
  // confirm modal that spells out who is affected. Reopen ('open') is the safe
  // action and runs immediately, same as before.
  const handleStatusChange = (status: 'open' | 'closed' | 'blocked') => {
    if (!conversationId) return;
    setShowMenu(false);
    if (status === 'open') {
      void applyStatusChange('open');
      return;
    }
    const isClose = status === 'closed';
    alert.showAlert(
      isClose
        ? t('messages.closeConfirmTitle', { defaultValue: 'Fermer cette conversation ?' })
        : t('messages.blockConfirmTitle', { defaultValue: 'Bloquer les réponses ?' }),
      isClose
        ? t('messages.closeConfirmBody', { defaultValue: "Plus personne ne pourra envoyer de message dans cette conversation. Vous gardez l'historique." })
        : t('messages.blockConfirmBody', { defaultValue: 'Le client ne pourra plus vous écrire dans cette conversation. Vous, vous pourrez toujours lui envoyer des messages.' }),
      [
        { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
        {
          text: isClose
            ? t('messages.closeConfirmCta', { defaultValue: 'Fermer' })
            : t('messages.blockConfirmCta', { defaultValue: 'Bloquer' }),
          style: 'destructive',
          onPress: () => { void applyStatusChange(status); },
        },
      ],
    );
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);
    }
  }, [messages.length]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === Number(user?.id);
    return (
      <View style={{
        alignSelf: isMe ? 'flex-end' : 'flex-start',
        maxWidth: '78%',
        marginVertical: 4,
        marginHorizontal: 12,
      }}>
        <View style={{
          backgroundColor: isMe ? '#114b3c' : theme.colors.surface,
          borderRadius: 18,
          borderBottomRightRadius: isMe ? 4 : 18,
          borderBottomLeftRadius: isMe ? 18 : 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
          ...(isMe ? {} : { borderWidth: 1, borderColor: theme.colors.divider }),
        }}>
          <Text style={{ color: isMe ? '#fff' : theme.colors.textPrimary, fontSize: 14, lineHeight: 20 }}>
            {item.text}
          </Text>
        </View>
        <Text style={{
          color: theme.colors.muted,
          fontSize: 10,
          marginTop: 3,
          alignSelf: isMe ? 'flex-end' : 'flex-start',
          marginHorizontal: 4,
        }}>
          {new Date(item.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  if ((isReservationBased && convLookupQuery.isLoading) || (conversationId && messagesQuery.isLoading && !messagesQuery.data)) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        >
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        {/* Avatar to the left of the title.
            - Customer side: org logo as a circular image. Falls back to a
              tinted MessageCircle when no logo URL came back yet.
            - Business side: initials of the customer's name in the brand
              palette (#114b3c bg, #e3ff5c letters) — same look as the
              Settings identity card, Leaderboard rows, and the conversations
              list. `deriveInitials` skips middle names so "Mohamed Ali
              Gharbi" → "MG". */}
        {(() => {
          if (isBusiness) {
            return (
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: '#114b3c',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginLeft: 10,
                }}
              >
                <Text style={{ color: '#e3ff5c', fontSize: 12, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 0.4 }}>
                  {deriveInitials(otherName)}
                </Text>
              </View>
            );
          }
          const orgLogoUrl =
            (conversation as any)?.res_location_logo
            ?? (conversation as any)?.org_image
            // Reservation summary fallback — same fetch that hydrates
            // the OrderSummaryCard, so the org logo paints from the
            // moment the customer opens the chat from an order card.
            ?? fallbackReservation?.org_logo_url
            ?? (fallbackLocation as any)?.image_url
            ?? (fallbackLocation as any)?.cover_image_url
            ?? null;
          if (orgLogoUrl) {
            return (
              <Image
                source={{ uri: orgLogoUrl }}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  marginLeft: 10,
                  borderWidth: 1,
                  borderColor: theme.colors.divider,
                }}
              />
            );
          }
          return (
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: theme.colors.primary + '12',
                justifyContent: 'center',
                alignItems: 'center',
                marginLeft: 10,
              }}
            >
              <UserIcon size={16} color={theme.colors.primary} />
            </View>
          );
        })()}
        <View style={{ flex: 1, marginLeft: 10 }}>
          {/* Title is the other party's name (the buyer when the business
              is viewing, the merchant when the customer is). Falls back
              to a contextual "Client" / "Commerce" label when the name
              is missing — never to the generic "Messages" sentinel. */}
          <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
            {otherName
              ?? (isBusiness
                ? t('business.orders.customer', { defaultValue: 'Client' })
                : t('messages.merchant', { defaultValue: 'Commerce' }))}
          </Text>
          {(isClosed || isBlocked) && (
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
              {isBlocked ? t('messages.blocked', { defaultValue: 'Bloquée' }) : t('messages.closed', { defaultValue: 'Fermée' })}
            </Text>
          )}
        </View>
        {/* Report the customer — lives on the top bar next to the name, NOT
            in the ⋮ menu. Red + filled once the thread has been flagged;
            tapping it then opens the report-status popup instead of the
            reason picker. Merchant-only. */}
        {isMyBusiness && (
          <TouchableOpacity
            onPress={onFlagPress}
            style={{ padding: 8 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityState={{ selected: isReported }}
            accessibilityLabel={t(isReported ? 'messages.reportedCustomer' : 'messages.reportCustomer', { defaultValue: isReported ? 'Client signalé' : 'Signaler le client' })}
          >
            <Flag size={19} color={isReported ? '#ef4444' : theme.colors.textSecondary} fill={isReported ? '#ef4444' : 'transparent'} />
          </TouchableOpacity>
        )}
        {isMyBusiness && hasMenuActions && (
          <TouchableOpacity onPress={() => setShowMenu(!showMenu)} style={{ padding: 8 }}>
            <MoreVertical size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Business menu dropdown. A full-screen transparent backdrop sits behind
          it so a tap ANYWHERE else on the screen dismisses the menu. */}
      {showMenu && isMyBusiness && hasMenuActions && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setShowMenu(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
          />
          <PaperSurface radius={12} shadow="md" style={{ position: 'absolute', top: 60, right: 16, zIndex: 100, minWidth: 180 }}>
            {conversation?.status === 'open' && (
              <>
                {/* Order: lighter-impact first, heaviest last. Block-replies only
                    mutes the buyer's side (you can still talk to them), so it
                    goes on top in neutral textPrimary. Closing the conversation
                    shuts BOTH sides down — the bigger consequence — so it sits
                    last in destructive red to match the weight. Old layout had
                    these reversed: close (more impactful) on top in black, block
                    (less impactful) on bottom in red, which made the color
                    contradict the actual blast radius.
                    Icons: `Ban` for block-replies (already used at line ~370
                    for the buyer's blocked badge → visual continuity); `Lock`
                    for close (matches the lock + "Cette conversation est
                    fermée." copy that replaces the input bar after close, so
                    the icon previews exactly the resulting state). */}
                <TouchableOpacity
                  onPress={() => handleStatusChange('blocked')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
                >
                  <Ban size={16} color={theme.colors.textPrimary} />
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 14 }}>{t('messages.blockBuyer', { defaultValue: 'Bloquer les réponses' })}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleStatusChange('closed')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}
                >
                  <Lock size={16} color={theme.colors.error} />
                  <Text style={{ color: theme.colors.error, fontSize: 14 }}>{t('messages.closeConversation', { defaultValue: 'Fermer la conversation' })}</Text>
                </TouchableOpacity>
              </>
            )}
            {/* Recovery actions are split by current state, and BOTH are
                gated on the order NOT being terminal. Once the underlying
                order is finished (picked_up / collected / completed /
                cancelled / expired / refunded), reopening the conversation
                in any form — unblock-replies for blocked threads, reopen
                for closed threads — is pointless and we hide the option.
                The merchant has no further work to do on a past order, so
                offering "let the customer write again" would be misleading.
                  - BLOCKED + active order → "Débloquer les réponses"
                  - CLOSED  + active order → "Réouvrir la conversation"
                Both hit `applyStatusChange('open')` — same backend op,
                different label + visibility logic. */}
            {conversation?.status === 'blocked' && !isOrderTerminal && (
              <TouchableOpacity onPress={() => handleStatusChange('open')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
                <Ban size={16} color={theme.colors.primary} />
                <Text style={{ color: theme.colors.primary, fontSize: 14 }}>{t('messages.unblockReplies', { defaultValue: 'Débloquer les réponses' })}</Text>
              </TouchableOpacity>
            )}
            {/* "Réouvrir la conversation" action removed per user request —
                closed conversations no longer offer any reopen affordance.
                The 3-dot menu trigger is hidden entirely for closed threads
                via hasMenuActions above, so this branch would never render
                anyway, but the JSX is removed for clarity. */}
          </PaperSurface>
        </>
      )}

      {/* Android note: `behavior={undefined}` (the old value) made the
          KeyboardAvoidingView a no-op, leaving the TextInput buried under
          the keyboard. The app sets `edgeToEdgeEnabled: true` in app.json,
          and on Android 15+ edge-to-edge mode breaks the OS-level
          `adjustResize` behavior — the keyboard now slides OVER the
          activity instead of shrinking it, so the JS side must handle
          avoidance. `behavior="padding"` is the cross-platform default
          that adds bottom padding equal to the keyboard height. */}
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors.surfaceMuted }} behavior="padding" keyboardVerticalOffset={0}>
        {/* Order summary card — pinned above the messages so both parties
            always see WHICH order this thread is about. Renders for both
            customer AND business sides, AND before the first message has
            been sent: the OrderSummaryCard component itself short-circuits
            when every field is null, but as long as the customer's
            fallback location query OR the conversation payload contains
            the merchant identity the card paints with whatever info is
            available. */}
        {(() => {
          // Demo mode runs with every backend query disabled, so the usual
          // cascade (conversation → fallbackReservation → fallbackLocation)
          // returns undefined for every field and the card never renders.
          // Pull the SAME demo order shape we inject into the orders tab
          // so the card paints with matching text + image — basket name,
          // merchant logo, location name, quantity, total, order code.
          if (isDemo) {
            const demo = buildDemoOrder();
            return (
              <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, backgroundColor: theme.colors.bg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                <OrderSummaryCard
                  basketImage={(demo.basket as any)?.image_url ?? undefined}
                  basketName={demo.basket_name ?? (demo.basket as any)?.name ?? undefined}
                  locationLogo={(demo.basket as any)?.merchantLogo ?? (demo.restaurant as any)?.image_url ?? undefined}
                  locationName={demo.restaurant?.name ?? undefined}
                  quantity={demo.quantity}
                  total={typeof demo.total === 'number' ? demo.total : Number(demo.total_price ?? 0)}
                  orderId={demo.id}
                />
              </View>
            );
          }
          // Data sources cascade: conversation row (when hydrated) →
          // reservation summary (the /api/reservations/:id fallback that
          // runs while we're still pre-first-message) → location
          // fallback (org logo only). The card paints with whatever
          // info is available at this moment so the customer / merchant
          // see the order context from the second they open the chat.
          const basketImage = (conversation as any)?.res_basket_image_url
            ?? fallbackReservation?.basket_image_url
            ?? undefined;
          const basketName = (conversation as any)?.res_basket_name
            ?? fallbackReservation?.basket_name
            ?? undefined;
          const locationLogo = (conversation as any)?.res_location_logo
            ?? (conversation as any)?.org_image
            ?? fallbackReservation?.org_logo_url
            ?? (fallbackLocation as any)?.image_url
            ?? (fallbackLocation as any)?.cover_image_url
            ?? undefined;
          const locationName = customerSideMerchant
            ?? (conversation as any)?.res_location_name
            ?? fallbackReservation?.restaurant_name
            ?? undefined;
          const rawQty = (conversation as any)?.res_quantity ?? fallbackReservation?.quantity;
          const quantity = rawQty != null ? Number(rawQty) : undefined;
          const rawTotal = (conversation as any)?.res_total ?? fallbackReservation?.total;
          const total = rawTotal != null ? Number(rawTotal) : undefined;
          // Render the card iff anything would actually show — keeps the
          // top of the chat clean on legacy direct-message threads.
          const orderId = conversation?.reservation_id ?? params.reservationId ?? null;
          if (!basketImage && !basketName && !locationLogo && !locationName && !quantity && !total && !orderId) return null;
          return (
            <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, backgroundColor: theme.colors.bg, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
              <OrderSummaryCard
                basketImage={basketImage}
                basketName={basketName}
                locationLogo={locationLogo}
                locationName={locationName ?? undefined}
                quantity={quantity}
                total={total}
                orderId={orderId}
              />
            </View>
          );
        })()}
        {/* Status banner — surfaces at the TOP of the chat whenever the
            conversation is blocked or closed, so both sides understand what
            the state means in plain language. The merchant in a BLOCKED
            convo otherwise wouldn't see any explanation at all (their input
            bar stays functional, the bottom lockbar only shows when canReply
            is false). Closed convos show the same banner to both sides since
            neither can send. Banner copy is tailored to the viewer. */}
        {(isBlocked || isClosed) && (
          <View
            style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 10,
              marginHorizontal: 12, marginTop: 8, marginBottom: 4,
              padding: 12, borderRadius: 12,
              backgroundColor: theme.colors.surface,
              borderWidth: 1, borderColor: theme.colors.divider,
            }}
          >
            <Lock size={16} color={theme.colors.textSecondary} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 }}>
              {isClosed
                ? t('messages.banner.closed', { defaultValue: "Cette conversation est fermée. Plus personne ne peut envoyer de message ici — vous gardez l'historique." })
                : isMyBusiness
                  ? t('messages.banner.blockedMerchant', { defaultValue: "Vous avez bloqué les réponses du client dans cette conversation. Vous pouvez toujours lui envoyer des messages ; il ne peut pas répondre." })
                  : t('messages.banner.blockedBuyer', { defaultValue: "Le commerçant a bloqué les réponses dans cette conversation. Vous ne pouvez plus lui écrire ici, mais il peut encore vous envoyer des messages." })}
            </Text>
          </View>
        )}
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessage}
          contentContainerStyle={{ paddingVertical: 12, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            // Friendly empty state — replaces the previous bare
            // "Aucun message." line. Pulls in the merchant / customer
            // name when available so it reads "Pas encore de message
            // avec <Org - Location>. Démarrez la conversation".
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingVertical: 60 }}>
              <View style={{
                width: 72, height: 72, borderRadius: 36,
                backgroundColor: theme.colors.primary + '10',
                justifyContent: 'center', alignItems: 'center',
                marginBottom: 16,
              }}>
                <MessageCircle size={32} color={theme.colors.primary} />
              </View>
              {/* Short, name-free title — the merchant / customer name is
                  already visible in the header above and inside the order
                  summary card, so repeating it here was redundant. The
                  18px marginBottom is intentional: it visually separates
                  the title from the action-prompt sentence underneath so
                  the two read as title + caption instead of one fused
                  paragraph. */}
              <Text style={{
                color: theme.colors.textPrimary,
                fontSize: 16, fontWeight: '600',
                fontFamily: 'Poppins_600SemiBold',
                textAlign: 'center', marginBottom: 18,
              }}>
                {t('messages.emptyTitle', { defaultValue: 'Pas encore de message' })}
              </Text>
              <Text style={{
                color: theme.colors.muted,
                fontSize: 13, lineHeight: 19,
                fontFamily: 'Poppins_400Regular',
                textAlign: 'center',
              }}>
                {canReply
                  ? t('messages.emptySubtitleCanReply', { defaultValue: 'Écrivez le premier message pour démarrer la conversation.' })
                  : t('messages.emptySubtitle', { defaultValue: 'Les messages apparaîtront ici dès qu’ils arriveront.' })}
              </Text>
            </View>
          }
        />

        {/* Input bar */}
        {canReply ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider, backgroundColor: theme.colors.bg }}>
            <TextInput
              style={{
                flex: 1, backgroundColor: theme.colors.surface, borderRadius: 20,
                paddingHorizontal: 16, paddingVertical: 10, fontSize: 14,
                color: theme.colors.textPrimary, maxHeight: 100,
                borderWidth: 1, borderColor: theme.colors.divider,
              }}
              value={text}
              onChangeText={setText}
              placeholder={t('messages.inputPlaceholder', { defaultValue: 'Écrire un message...' })}
              placeholderTextColor={theme.colors.muted}
              multiline
              returnKeyType="default"
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!text.trim() || sendMutation.isPending}
              style={{
                backgroundColor: text.trim() ? '#114b3c' : theme.colors.divider,
                width: 42, height: 42, borderRadius: 21,
                justifyContent: 'center', alignItems: 'center', marginLeft: 8,
              }}
            >
              <Send size={18} color={text.trim() ? '#e3ff5c' : theme.colors.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: theme.colors.divider, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <Lock size={14} color={theme.colors.muted} />
            <Text style={{ flex: 1, color: theme.colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 18 }}>
              {/* In-place lock copy. The top banner carries the fuller
                  explanation; this short line is just the reminder of why
                  the typing field is replaced. */}
              {isClosed
                ? t('messages.conversationClosedInfo', { defaultValue: "Conversation fermée — plus personne ne peut écrire ici." })
                : t('messages.blockedInfo', { defaultValue: 'Le commerçant a bloqué les réponses dans cette conversation.' })}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Demo instruction popup — tells the user to tap the back arrow to
          continue the walkthrough. Pointer-events box-none so taps fall
          through to the (haloed) back arrow at the top. */}
      {isDemo && walkthroughCurrentStep?.measureKey === 'chatBack' && (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 24 }}>
          <View style={{
            backgroundColor: '#fff',
            borderRadius: 20,
            padding: 18,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 20,
            elevation: 12,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#114b3c12', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                <Hand size={18} color="#114b3c" />
              </View>
              <Text style={{ color: '#114b3c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1 }}>
                {t('walkthrough.biz.chatBack.title', { defaultValue: 'Retour à la commande' })}
              </Text>
            </View>
            <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, marginBottom: 10 }}>
              {t('walkthrough.biz.chatBack.desc', { defaultValue: 'Voici la conversation avec le client. Appuyez sur la flèche de retour en haut à gauche pour revenir aux commandes et continuer la démo.' })}
            </Text>
            {/* Suivant — primary path to leave the chat demo step. Advances
                the demo AND pops the chat screen back to incoming-orders,
                same as tapping the header back arrow. Sets the idempotency
                ref BEFORE nextStep + router.back so the unmount cleanup is
                a guaranteed no-op (it'd otherwise race with the safety-net
                effect — see the scan-qr `handleClose` comment for the full
                description of that race). We DO need `router.back()` here
                (unlike scan-qr) because the next step after `chatBack` is
                `orderCardConfirmBtn`, which is an ELEMENT step — the
                (business) layout's [step] effect does not navigate for
                element steps, so without popping the chat screen we'd be
                stuck on top of the demo halo. */}
            <TouchableOpacity
              onPress={() => {
                if (useWalkthroughStore.getState().currentStep?.measureKey === 'chatBack') {
                  chatBackAdvanceFiredRef.current = true;
                  useWalkthroughStore.getState().nextStep(999);
                }
                router.back();
              }}
              style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4, marginBottom: 8 }}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Poppins_700Bold', fontWeight: '700' }}>
                {t('walkthrough.next', { defaultValue: 'Suivant' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => useWalkthroughStore.getState().skipWalkthrough()} style={{ alignItems: 'center' }}>
              <Text style={{ color: theme.colors.muted, fontSize: 13, fontFamily: 'Poppins_500Medium' }}>
                {t('walkthrough.exitDemo', { defaultValue: 'Quitter la démo' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Report-customer modal — branded reason picker + confirmation.
          Standalone ModalCard (no other Modal is open on this screen) so the
          nested-Modal flakiness that bit the dashboard review flow doesn't
          apply here. */}
      <ModalCard
        visible={reportVisible}
        onClose={closeReport}
        title={reportResult ? undefined : t('messages.report.title', { defaultValue: 'Signaler ce client' })}
        maxWidth={360}
      >
        {reportResult ? (
          (() => {
            const isError = reportResult === 'error';
            const accent = isError ? '#ef4444' : theme.colors.primary;
            return (
              <View style={{ alignItems: 'center', paddingTop: 8 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: accent + '18', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
                  {isError ? <X size={30} color={accent} /> : <Check size={30} color={accent} />}
                </View>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 17, fontFamily: 'Poppins_700Bold', fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
                  {isError
                    ? t('common.error', { defaultValue: 'Erreur' })
                    : t('messages.report.thanksTitle', { defaultValue: 'Merci' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', fontFamily: 'Poppins_400Regular', marginBottom: 20 }}>
                  {isError
                    ? t('messages.report.error', { defaultValue: 'Le signalement a échoué. Réessayez.' })
                    : t('messages.report.thanksBody', { defaultValue: "La conversation a été transmise à notre équipe. Nous reviendrons vers vous si nécessaire." })}
                </Text>
                <TouchableOpacity
                  onPress={isError ? () => setReportResult(null) : closeReport}
                  style={{ backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, alignSelf: 'stretch', alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Poppins_600SemiBold', fontWeight: '600' }}>
                    {isError ? t('messages.report.retry', { defaultValue: 'Réessayer' }) : t('messages.report.ok', { defaultValue: 'OK' })}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })()
        ) : otherSelected ? (
          // ── "Autre" → free-text box ──
          <View>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontFamily: 'Poppins_600SemiBold', fontWeight: '600', marginBottom: 6 }}>
              {t('messages.report.reasons.other', { defaultValue: 'Autre' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_400Regular', marginBottom: 12 }}>
              {t('messages.report.otherPrompt', { defaultValue: 'Décrivez le problème en quelques mots.' })}
            </Text>
            <TextInput
              value={otherText}
              onChangeText={setOtherText}
              placeholder={t('messages.report.otherPlaceholder', { defaultValue: 'Décrivez le problème…' })}
              placeholderTextColor={theme.colors.muted}
              multiline
              maxLength={500}
              style={{
                minHeight: 90, maxHeight: 160, borderWidth: 1, borderColor: theme.colors.divider,
                borderRadius: 12, padding: 12, fontSize: 14, color: theme.colors.textPrimary,
                textAlignVertical: 'top', backgroundColor: theme.colors.surface, marginBottom: 14,
                fontFamily: 'Poppins_400Regular',
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => { setOtherSelected(false); setOtherText(''); }}
                disabled={reportSubmitting}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.surfaceMuted }}
              >
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontFamily: 'Poppins_500Medium' }}>
                  {t('common.back', { defaultValue: 'Retour' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => submitReport('other', otherText)}
                disabled={reportSubmitting || !otherText.trim()}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.primary, opacity: (reportSubmitting || !otherText.trim()) ? 0.5 : 1 }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontFamily: 'Poppins_600SemiBold', fontWeight: '600' }}>
                  {t('messages.report.send', { defaultValue: 'Envoyer' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_400Regular', marginBottom: 14 }}>
              {t('messages.report.subtitle', { defaultValue: 'Pourquoi signalez-vous cette conversation ?' })}
            </Text>
            {CONV_REPORT_REASONS.map((reason, idx) => (
              <TouchableOpacity
                key={reason}
                disabled={reportSubmitting}
                onPress={() => { if (reason === 'other') setOtherSelected(true); else submitReport(reason); }}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingVertical: 14, paddingHorizontal: 4,
                  borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: theme.colors.divider,
                  opacity: reportSubmitting ? 0.5 : 1,
                }}
              >
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, flex: 1, fontFamily: 'Poppins_400Regular' }}>
                  {t(`messages.report.reasons.${reason}`)}
                </Text>
                <ChevronRight size={18} color={theme.colors.muted} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ModalCard>

      {/* Report-status info popup — shown when the merchant taps an
          already-flagged thread. Mirrors the review-flag info popup: shows what
          they reported it with, when, and the moderation status. */}
      <ModalCard visible={reportInfoVisible} onClose={closeReportInfo} maxWidth={360}>
        {(() => {
          const flaggedDate = reportInfo?.at ? new Date(reportInfo.at).toLocaleDateString('fr-FR') : null;
          return (
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#ef444418', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
                <Flag size={28} color="#ef4444" fill="#ef4444" />
              </View>
              <Text style={{ color: theme.colors.textPrimary, fontSize: 17, fontFamily: 'Poppins_700Bold', fontWeight: '700', textAlign: 'center', marginBottom: 6 }}>
                {t('messages.report.infoTitle', { defaultValue: 'Client signalé' })}
              </Text>
              <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', fontFamily: 'Poppins_400Regular', marginBottom: 16 }}>
                {t('messages.report.infoSubtitle', { defaultValue: 'Voici le statut de votre signalement.' })}
              </Text>
              <View style={{ alignSelf: 'stretch', backgroundColor: theme.colors.surfaceMuted, borderRadius: 14, padding: 16, marginBottom: 18, gap: 12 }}>
                <View>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginBottom: 2 }}>
                    {t('messages.report.infoReason', { defaultValue: 'Motif signalé' })}
                  </Text>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontFamily: 'Poppins_500Medium' }}>
                    {reportMotif(reportInfo)}
                  </Text>
                </View>
                {flaggedDate && (
                  <View>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginBottom: 2 }}>
                      {t('messages.report.infoDate', { defaultValue: 'Signalé le' })}
                    </Text>
                    <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontFamily: 'Poppins_500Medium' }}>{flaggedDate}</Text>
                  </View>
                )}
                <View>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginBottom: 2 }}>
                    {t('messages.report.infoStatus', { defaultValue: 'Statut' })}
                  </Text>
                  <Text style={{ color: theme.colors.primary, fontSize: 14, fontFamily: 'Poppins_600SemiBold', fontWeight: '600' }}>
                    {t('messages.report.statusUnderReview', { defaultValue: "Transmis à notre équipe — en cours d'examen" })}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={closeReportInfo}
                style={{ backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 12, alignSelf: 'stretch', alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Poppins_600SemiBold', fontWeight: '600' }}>
                  {t('messages.report.ok', { defaultValue: 'OK' })}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })()}
      </ModalCard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
