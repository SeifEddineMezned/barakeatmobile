/**
 * Conversations screen — full-page list of the merchant's reservation
 * conversations, opened by the header chat icon. Tabbed layout:
 *
 *   1. À venir — conversations whose linked reservation's PICKUP WINDOW
 *      HAS NOT YET ENDED (reservation_date + pickup_end_time > now) AND
 *      the reservation isn't already cancelled / picked up. The status
 *      flag alone isn't enough — a 'confirmed' reservation from 3 days
 *      ago doesn't belong here; the pickup-time check filters those out.
 *   2. Anciennes — every other conversation whose last_message_at falls
 *      within the 7-day cutoff window. Conversations older than 7 days
 *      drop out entirely ("erase after a week" per the user's spec).
 *
 * Each row carries:
 *   - Buyer name on the top-left (top-RIGHT corner holds the unread
 *     badge when the conversation has unseen messages).
 *   - Basket name from the matched reservation (when known).
 *   - Last-message preview underneath, with the order code BK-XXXXX +
 *     "il y a 5 min" on the bottom-right of the same line.
 * Status badge / pickup window are NOT shown — being in À venir already
 * implies the order is confirmed, and the order code is enough to look
 * up details in the orders tab.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowLeft, MessageCircle, Flag, Ban, Lock, Building2 } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { archiveConversation, fetchConversations, type Conversation } from '@/src/services/messages';
import { fetchTodayOrders, fetchLocationOrders, type TodayReservationFromAPI } from '@/src/services/business';
import { fetchMyContext, fetchOrganizationDetails } from '@/src/services/teams';
import { useBusinessStore } from '@/src/stores/businessStore';
import { orderIdToCode } from '@/src/utils/orderCode';
import { deriveInitials } from '@/src/utils/initials';
import { usePollWhenFocused } from '@/src/hooks/usePollWhenFocused';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { getErrorMessage } from '@/src/lib/api';
import { getBusinessDayDateStr } from '@/src/utils/timezone';

// Conversations whose last_message_at is older than this AND aren't in
// the "Upcoming" bucket drop out entirely. Matches the user's spec of
// "remove the old ones after a week".
const RECENT_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;

// True when the reservation's pickup window has already ENDED in wall-
// clock time (date + pickup_end_time < now). The conversation list's
// "À venir" tab only wants pre-pickup conversations — a reservation that
// the backend still flags 'confirmed' because no one ran the expiry job
// stays in 'confirmed' for days, so we have to do the time check
// ourselves rather than trust the status flag.
//
// Date resolution prefers `reservation_date` (when present) and falls
// back to `DATE(created_at)`. The /reservations/location/today endpoint
// does NOT select `reservation_date`, so without this fallback the
// function used to use a hand-rolled "created_at + 24h" rule — which let
// orders made yesterday evening (created_at < 24h ago, pickup window
// already ended) keep showing in "À venir" for hours into the next
// business day. The user reported exactly that as conversations of
// expired / picked-up / cancelled orders leaking into Upcoming.
function isPickupOver(r: any): boolean {
  if (!r) return true;
  let dateStr: string | null = null;
  if (r.reservation_date) {
    dateStr = String(r.reservation_date).substring(0, 10);
  } else if (r.created_at) {
    // YYYY-MM-DD prefix of the timestamp — the order's calendar day.
    dateStr = String(r.created_at).substring(0, 10);
  }
  if (!dateStr) return true; // can't reason about it → assume done, don't show
  const endTime = r.pickup_end_time ?? r.pickup_end ?? r.basket?.pickup_end_time ?? null;
  const startTime = r.pickup_start_time ?? r.pickup_start ?? r.basket?.pickup_start_time ?? null;
  const endStr = endTime ? String(endTime).substring(0, 5) : '23:59';
  const startStr = startTime ? String(startTime).substring(0, 5) : null;
  // Local-time interpretation. A 1-2 h timezone slip vs. business TZ is
  // far smaller than the "3+ days stale" gap the user reported, so this
  // is good enough to keep aged reservations out of the upcoming bucket.
  let combined = new Date(`${dateStr}T${endStr}:00`);
  if (!Number.isFinite(combined.getTime())) return true;
  // Cross-midnight pickup windows (e.g. 21:30 → 02:00 for an overnight
  // bakery): the reservation_date holds the day pickup OPENS; the end
  // time of 02:00 belongs to the NEXT calendar day. Without this
  // detection the date+time concat lands at "yesterday 02:00 AM",
  // making every overnight order look 22+ hours expired the instant
  // the page loads — the cause of "active overnight order shows in
  // Terminées tab even though pickup is still 2h in the future".
  if (startStr) {
    const startCombined = new Date(`${dateStr}T${startStr}:00`);
    if (Number.isFinite(startCombined.getTime()) && combined.getTime() < startCombined.getTime()) {
      combined = new Date(combined.getTime() + 24 * 60 * 60 * 1000);
    }
  }
  return Date.now() > combined.getTime();
}

// Compact "il y a 3min" / "il y a 2j" formatter. Mirrors the orders-tab
// timeAgo so the two surfaces read with the same cadence.
function timeAgo(dateStr: string | null | undefined, t: any): string {
  if (!dateStr) return '';
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 60) return t('timeAgo.seconds', { count: Math.max(diff, 0) });
  if (diff < 3600) return t('timeAgo.minutes', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('timeAgo.hours', { count: Math.floor(diff / 3600) });
  const days = Math.floor(diff / 86400);
  if (days < 7) return t('timeAgo.days', { count: days });
  if (days < 30) return t('timeAgo.weeks', { count: Math.floor(days / 7) });
  return t('timeAgo.months', { count: Math.floor(days / 30) });
}

type TabKey = 'upcoming' | 'old';

export default function BusinessConversationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const user = useAuthStore((s) => s.user);

  const [tab, setTab] = React.useState<TabKey>('upcoming');
  const queryClient = useQueryClient();
  const alert = useCustomAlert();

  // ── Multi-location context ───────────────────────────────────────────────
  // Used to decide whether to render the "Org - Location" sub-label on each
  // conversation row. A user with access to ONE location doesn't need the
  // label — every chat is from the same place, so the line would just add
  // visual noise. Members with access to multiple locations DO need it: the
  // chat list mixes threads from several locations and the merchant needs to
  // tell them apart at a glance without opening each one. Same two queries
  // the dashboard uses, so React Query dedupes the fetches.
  const teamContextQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 60_000 });
  const orgId = teamContextQuery.data?.organization_id;
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  const orgLocations = orgDetailsQuery.data?.locations ?? [];
  const myRole = teamContextQuery.data?.role ?? '';
  const myPrimaryLocationId = teamContextQuery.data?.location_id;
  // Every location this user belongs to. Prefer my-context's `location_ids`
  // (polled, authoritative for membership changes); fall back to org-details
  // members rows; final fallback is the primary location_id from my-context.
  const myLocationIds = React.useMemo<number[]>(() => {
    const ids = (teamContextQuery.data as any)?.location_ids;
    if (Array.isArray(ids) && ids.length > 0) return ids.map(Number);
    const uid = String(user?.id ?? '');
    const fromMembers = new Set<number>();
    for (const m of (orgDetailsQuery.data?.members ?? []) as any[]) {
      if (String(m.user_id) === uid && m.location_id != null) fromMembers.add(Number(m.location_id));
    }
    if (fromMembers.size > 0) return Array.from(fromMembers);
    return myPrimaryLocationId != null ? [Number(myPrimaryLocationId)] : [];
  }, [user?.id, orgDetailsQuery.data?.members, (teamContextQuery.data as any)?.location_ids, myPrimaryLocationId]);
  // An org-scoped admin/owner sees every org location; a multi-location
  // member sees just the ones they belong to. Either way, the row-level
  // label only renders when there's >1 location in play.
  const isOrgScopedAdmin = (myRole === 'admin' || myRole === 'owner') && myLocationIds.length === 0;
  const visibleLocationsCount = isOrgScopedAdmin
    ? orgLocations.length
    : myLocationIds.length;
  const hasMultiLocations = visibleLocationsCount > 1;
  // Lookup: location_id → display name, computed once per orgLocations change.
  const locationNameById = React.useMemo(() => {
    const m = new Map<number, string>();
    for (const loc of orgLocations) {
      if (typeof loc.id === 'number' && loc.name) m.set(loc.id, loc.name);
    }
    return m;
  }, [orgLocations]);
  const orgName = teamContextQuery.data?.organization_name
    ?? orgDetailsQuery.data?.organization?.name
    ?? '';

  // Archive flow — only exposed on the "Anciennes" tab so the merchant
  // can prune finished conversations from their list. The mutation
  // optimistically removes the row from the cached list before the
  // server round-trip resolves so the tap feels instant; on failure we
  // refetch to put the row back. The buyer's view is server-side
  // untouched (see PUT /conversations/:id/archive in messages.js).
  const archiveMutation = useMutation({
    mutationFn: (conversationId: number) => archiveConversation(conversationId),
    onMutate: async (conversationId: number) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const previous = queryClient.getQueryData<Conversation[]>(['conversations']);
      if (previous) {
        queryClient.setQueryData<Conversation[]>(
          ['conversations'],
          previous.filter((c) => Number(c.id) !== Number(conversationId)),
        );
      }
      return { previous };
    },
    onError: (err, _id, ctx) => {
      // Roll back the optimistic removal and surface the failure copy.
      if (ctx?.previous) queryClient.setQueryData(['conversations'], ctx.previous);
      alert.showAlert(t('common.error'), getErrorMessage(err));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
  const handleArchive = (item: Conversation) => {
    alert.showAlert(
      t('messages.archiveConfirmTitle', { defaultValue: 'Archiver cette conversation ?' }),
      t('messages.archiveConfirmBody', { defaultValue: 'Elle disparaîtra de votre liste.' }),
      [
        { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
        {
          text: t('messages.archiveAction', { defaultValue: 'Archiver' }),
          style: 'destructive',
          onPress: () => archiveMutation.mutate(Number(item.id)),
        },
      ],
    );
  };

  // Conversations endpoint — same one the customer /messages page uses,
  // so React-Query dedupes when both surfaces are mounted. Polling
  // cadence tightened from 30 s → 15 s on this screen because new
  // messages should land quickly here even when the FCM listener in
  // app/_layout.tsx misses a push (foreground race, background
  // delivery, etc.). 15 s × this screen's typical session length is a
  // negligible cost.
  const conversationsRefetch = usePollWhenFocused(15_000);
  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    staleTime: 10_000,
    refetchInterval: conversationsRefetch,
  });
  const conversations = conversationsQuery.data ?? [];

  // Today + location orders — used to join each conversation to its
  // reservation so we can show basket name / status / pickup window.
  // Today drives the "Upcoming" tab; the location/all query keeps the
  // historical reservations available for the "Anciennes" tab.
  // Both queries also poll on the same focused-interval as conversations
  // so a freshly-placed reservation (which is what a new customer
  // message is usually attached to) shows up in `reservationById`
  // within the same polling window — otherwise the conversation row
  // renders without basket/order chips until the next manual refetch.
  const ordersRefetch = usePollWhenFocused(15_000);
  const todayOrdersQuery = useQuery({
    queryKey: ['today-orders', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    enabled: selectedLocationId != null,
    staleTime: 10_000,
    refetchInterval: ordersRefetch,
  });
  const locationOrdersQuery = useQuery({
    queryKey: ['location-orders', selectedLocationId, 'all'],
    queryFn: () => fetchLocationOrders(selectedLocationId, 'all'),
    enabled: selectedLocationId != null,
    staleTime: 30_000,
    refetchInterval: ordersRefetch,
  });

  // Reservation lookup map — keyed by reservation id (string) so the
  // conversation row can resolve the basket name / status / window in
  // O(1). Today's rows override historical ones (most up-to-date status).
  const reservationById = useMemo(() => {
    const m = new Map<string, TodayReservationFromAPI>();
    for (const o of locationOrdersQuery.data ?? []) m.set(String(o.id), o);
    for (const o of todayOrdersQuery.data ?? []) m.set(String(o.id), o);
    return m;
  }, [todayOrdersQuery.data, locationOrdersQuery.data]);

  // Resolve the basket display name from a raw reservation row. Priority
  // chain matches what the incoming-orders normalizer uses.
  const resolveBasketName = (r: any): string | null => {
    if (!r) return null;
    return (
      r.basket?.name
      ?? r.basket?.basket_type_name
      ?? r.basket?.type_name
      ?? r.basket?.basket_name
      ?? r.basket_type_name
      ?? r.basket_name
      ?? null
    );
  };

  // Partition conversations into the two tabs.
  //   upcoming = the linked reservation is NOT in a terminal state
  //              (picked_up / collected / completed / cancelled / expired
  //              / refunded) AND the conversation itself isn't CLOSED.
  //              Closing was the merchant's explicit signal of "I'm done
  //              with this thread", so it always lands in Terminées — even
  //              when the underlying order is still incoming. Blocked
  //              chats are different: blocking only mutes the buyer's side,
  //              the merchant might still want to chase, so blocked threads
  //              with an active order STAY in En cours (with a Ban badge
  //              on the row). The merchant can re-open a closed thread
  //              from the chat menu while the order is still active.
  //   old      = the order is finished, OR the conversation is closed,
  //              OR there's no reservation and the thread has gone quiet.
  //              Subject to a 7-day cutoff so the tab stays focused on
  //              recent history.
  const { upcoming, old } = useMemo(() => {
    // Partition rule (the user-facing definition the tabs implement):
    //
    //   Commandes en cours = "the order linked to this conversation is NOT
    //                         finished yet". Period. The conversation's own
    //                         status (open / closed / blocked) DOES NOT
    //                         matter — a merchant who closed a chat is still
    //                         on the hook to fulfil the underlying order, so
    //                         the thread stays here. The chat's state is
    //                         communicated by the Lock / Ban / Flag badges
    //                         on the row instead. The pickup window passing
    //                         doesn't matter either — only the reservation's
    //                         `status` does.
    //
    //   Commandes passées  = "the order is finished" (picked_up, collected,
    //                         completed, cancelled, expired, refunded). Also
    //                         catches orderless chat threads whose last
    //                         activity is recent enough to still be useful.
    //                         Capped by the 7-day cutoff so the tab doesn't
    //                         balloon with ancient archive noise.
    //
    // Previous logic gated En cours on a whitelist of "active" statuses AND
    // `!pickupPassed` AND `isConvOpen`, which dropped genuinely-incoming
    // orders from the actionable tab the moment the merchant closed the chat
    // or the wall clock passed pickup. This version makes the order the sole
    // source of truth.
    const TERMINAL_RESV = ['picked_up', 'collected', 'completed', 'cancelled', 'expired', 'refunded'];
    const nowDate = new Date();
    const now = nowDate.getTime();
    const todayBizDateStr = getBusinessDayDateStr(nowDate);
    const up: Conversation[] = [];
    const ol: Conversation[] = [];
    for (const c of conversations) {
      // Reservation lookup: prefer the fields the conversations LIST endpoint
      // now embeds on the row itself (reservation_status,
      // reservation_pickup_end_time, reservation_date) — that survives even
      // when the separate orders queries (fetchTodayOrders /
      // fetchLocationOrders) didn't return the row for whatever reason
      // (different location filter, recent membership change, etc.). The
      // legacy reservationById map remains as a fallback.
      const embeddedResv =
        c.reservation_id != null && (c as any).reservation_status != null
          ? {
              status: (c as any).reservation_status,
              reservation_date: (c as any).reservation_date,
              pickup_end_time: (c as any).reservation_pickup_end_time,
              // pickup_start_time is read by isPickupOver()'s cross-midnight
              // detection. The backend SELECT returns it as a sibling field
              // to reservation_pickup_end_time so this row alone (no separate
              // fetch) is enough for the partition to correctly classify
              // overnight pickup windows (start > end on the wall clock).
              pickup_start_time: (c as any).reservation_pickup_start_time,
            }
          : null;
      const resv = embeddedResv
        ?? (c.reservation_id != null ? reservationById.get(String(c.reservation_id)) : null);
      const status = (resv as any)?.status?.toLowerCase?.() ?? null;
      // KNOWN states: we've located the reservation row and read its status.
      // If the reservation isn't in our local map (different location filter,
      // not in today's window, not yet fetched), we DON'T claim to know — and
      // that uncertainty has to bias toward En cours for blocked threads,
      // otherwise the merchant loses sight of conversations they're actively
      // managing just because the order lookup hadn't landed yet.
      const isResvKnown = !!resv;
      // Wall-clock safety net: when the reservation row IS in our cache but
      // its status is still 'confirmed' / 'pending' AND its pickup window
      // already ended (e.g. expired today, the daily cron hasn't run yet),
      // treat it as terminal here so the conversation moves to Terminées
      // immediately. Without this the merchant sees expired-pickup orders
      // sitting in "En cours" until 03:30 Tunisia time the next day.
      const isResvWallClockExpired = isResvKnown && isPickupOver(resv);
      const isResvTerminal = (
        (isResvKnown && status ? TERMINAL_RESV.includes(status) : false)
        || isResvWallClockExpired
      );
      const isResvActive = isResvKnown && !isResvTerminal;
      const lastMs = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      const ageMs = lastMs > 0 ? now - lastMs : Number.POSITIVE_INFINITY;
      // 7-day cutoff drops conversations that are clearly stale — but only
      // when we're sure the order isn't still incoming. An active order keeps
      // its thread visible no matter how long ago the last message was.
      if (lastMs > 0 && ageMs > RECENT_CUTOFF_MS && !isResvActive) continue;

      // CLOSED — always Terminées. Closing was the merchant's deliberate
      // "I'm done with this thread" action; we honor it even if the order is
      // still in progress. (They can still reopen the chat from the menu while
      // the order is active, and the order itself remains in their orders tab.)
      if (c.status === 'closed') {
        if (ageMs < RECENT_CUTOFF_MS) ol.push(c);
        continue;
      }

      // BLOCKED — En cours unless we KNOW the order is terminal. Blocking
      // only mutes the buyer's replies; the merchant can still message and
      // still has work to do on the order. The previous version required a
      // known-active reservation to keep blocked threads in En cours, which
      // dropped them to Terminées whenever the reservation lookup missed
      // (the user's "blocked convos in Terminées" report).
      if (c.status === 'blocked') {
        if (isResvTerminal) {
          if (ageMs < RECENT_CUTOFF_MS) ol.push(c);
        } else {
          up.push(c);
        }
        continue;
      }

      // OPEN — straightforward: active order → En cours; orderless fresh
      // thread (no reservation attached yet, recent activity) → En cours;
      // everything else → Terminées subject to the cutoff above.
      if (isResvActive) {
        up.push(c);
        continue;
      }
      const lastBizDateStr = lastMs > 0 ? getBusinessDayDateStr(new Date(lastMs)) : null;
      const isCurrentBizDay = lastBizDateStr === todayBizDateStr;
      if (!isResvKnown && (lastMs === 0 || isCurrentBizDay)) {
        up.push(c);
        continue;
      }
      if (ageMs < RECENT_CUTOFF_MS) {
        ol.push(c);
      }
    }
    const byNewest = (x: Conversation, y: Conversation) => {
      const xMs = x.last_message_at ? new Date(x.last_message_at).getTime() : 0;
      const yMs = y.last_message_at ? new Date(y.last_message_at).getTime() : 0;
      return yMs - xMs;
    };
    up.sort(byNewest);
    ol.sort(byNewest);
    return { upcoming: up, old: ol };
  }, [conversations, reservationById]);

  const data = tab === 'upcoming' ? upcoming : old;

  const renderRow = ({ item }: { item: Conversation }) => {
    const otherName = item.buyer_name ?? t('messages.unknownUser', { defaultValue: 'Utilisateur' });
    const hasUnread = item.unread_count > 0;
    const resv = item.reservation_id != null ? reservationById.get(String(item.reservation_id)) : null;
    const basketName = resolveBasketName(resv);
    const lastTime = timeAgo(item.last_message_at, t);

    const rowBody = (
      <TouchableOpacity
        onPress={() => router.push(`/message/${item.id}` as never)}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 20,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.divider,
          // Opaque background — when the row swipes left over the red
          // Archive panel underneath, we don't want the panel bleeding
          // through the card.
          backgroundColor: theme.colors.bg,
        }}
      >
        {/* Avatar — initials in the brand palette (dark green bg, lime
            letters), matching the Settings identity card + Leaderboard rows.
            `deriveInitials` handles middle-name skipping so "Mohamed Ali
            Gharbi" renders as "MG", not "MA". */}
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#114b3c',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold', letterSpacing: 0.4 }}>
            {deriveInitials(item.buyer_name)}
          </Text>
        </View>

        {/* Center — name (with unread badge top-right), basket, last
            message preview. */}
        <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              style={{
                flex: 1,
                color: theme.colors.textPrimary,
                fontSize: 15,
                fontWeight: hasUnread ? '700' : '600',
                fontFamily: hasUnread ? 'Poppins_700Bold' : 'Poppins_600SemiBold',
              }}
              numberOfLines={1}
            >
              {otherName}
            </Text>
            {item.status === 'blocked' ? (
              <Ban
                size={13}
                color="#ef4444"
                accessibilityLabel={t('messages.blocked', { defaultValue: 'Bloquée' })}
              />
            ) : item.status === 'closed' ? (
              <Lock
                size={13}
                color={theme.colors.textSecondary}
                accessibilityLabel={t('messages.closed', { defaultValue: 'Fermée' })}
              />
            ) : null}
            {item.reported_by_business ? (
              <Flag
                size={13}
                color="#ef4444"
                fill="#ef4444"
                accessibilityLabel={t('messages.reportedBadge', { defaultValue: 'Signalé' })}
              />
            ) : null}
            {hasUnread ? (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: '#ef4444',
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 5,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {item.unread_count > 9 ? '9+' : item.unread_count}
                </Text>
              </View>
            ) : null}
          </View>
          {/* Multi-location label — "Org - Location" sits right under the
              customer's name so a merchant scanning the list can tell at a
              glance WHICH of their locations a chat belongs to without
              opening it. Only rendered when the user actually has access to
              multiple locations (otherwise the info is redundant noise).
              Single-line + ellipsis so a long Org-Location combo can't push
              the basketName / last-message rows out of alignment or wrap
              into a second line on narrow phones. */}
          {hasMultiLocations && item.location_id != null && (() => {
            const locName = locationNameById.get(Number(item.location_id));
            if (!locName) return null;
            const orgForRow = (item.org_name ?? orgName ?? '').trim();
            const display = orgForRow && orgForRow !== locName
              ? `${orgForRow} - ${locName}`
              : locName;
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <Building2 size={11} color={theme.colors.muted} />
                <Text
                  style={{ flex: 1, color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_500Medium' }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {display}
                </Text>
              </View>
            );
          })()}
          {basketName ? (
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2, fontFamily: 'Poppins_400Regular' }}
              numberOfLines={1}
            >
              {basketName}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 }}>
            <Text
              style={{
                flex: 1,
                color: hasUnread ? theme.colors.textPrimary : theme.colors.textSecondary,
                fontSize: 13,
                fontWeight: hasUnread ? '500' : '400',
                lineHeight: 18,
                fontFamily: hasUnread ? 'Poppins_500Medium' : 'Poppins_400Regular',
              }}
              numberOfLines={1}
            >
              {item.last_message ?? '...'}
            </Text>
            {/* Bottom-right — order code + time. Sits inline with the
                last-message line so the card stays a tight three-row
                block instead of a fourth metadata line. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 10 }}>
              {item.reservation_id ? (
                <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: '600', fontFamily: 'Poppins_600SemiBold' }}>
                  {orderIdToCode(item.reservation_id)}
                </Text>
              ) : null}
              {lastTime ? (
                <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular' }}>· {lastTime}</Text>
              ) : null}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );

    // Past-tab rows are wrapped in a Swipeable so the user can swipe LEFT
    // to reveal a red "Archiver" action panel (with a thin white divider
    // hugging its left edge for visual separation from the card). Tap the
    // panel → confirmation alert → archive mutation. The upcoming tab
    // skips this wrap entirely; only past conversations are archivable.
    if (tab === 'old') {
      return (
        <Swipeable
          friction={2}
          rightThreshold={40}
          overshootRight={false}
          renderRightActions={() => (
            <TouchableOpacity
              onPress={() => handleArchive(item)}
              activeOpacity={0.8}
              accessibilityLabel={t('messages.archiveAction', { defaultValue: 'Archiver' })}
              accessibilityRole="button"
              style={{
                backgroundColor: '#ef4444',
                width: 92,
                justifyContent: 'center',
                alignItems: 'center',
                // Thin semi-transparent white left border — the visual
                // "divider" the user asked for, so the panel reads as
                // a distinct action surface rather than fused into the
                // card's right edge.
                borderLeftWidth: 1,
                borderLeftColor: 'rgba(255,255,255,0.45)',
              }}
            >
              <Archive size={22} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', marginTop: 4, fontFamily: 'Poppins_700Bold' }}>
                {t('messages.archiveAction', { defaultValue: 'Archiver' })}
              </Text>
            </TouchableOpacity>
          )}
        >
          {rowBody}
        </Swipeable>
      );
    }
    return rowBody;
  };

  const renderEmpty = () => (
    // The FlatList's contentContainerStyle now owns the centering
    // (flexGrow:1 + justifyContent:'center'), so this view only needs
    // to lay out its own intrinsic content. Centering against the list
    // area (not the whole screen) is the correct frame of reference —
    // the medallion + copy now sit visually balanced under the tabs
    // instead of floating in the middle of the device.
    <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: theme.colors.primary + '10',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <MessageCircle size={36} color={theme.colors.primary} />
      </View>
      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center' }}>
        {tab === 'upcoming'
          ? t('business.chat.emptyUpcoming', { defaultValue: 'Aucune conversation active' })
          : t('business.chat.emptyOld', { defaultValue: 'Pas de conversations anciennes' })}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          ...theme.typography.bodySm,
          marginTop: 6,
          textAlign: 'center',
          lineHeight: 20,
        }}
      >
        {tab === 'upcoming'
          ? t('business.chat.emptyUpcomingDesc', { defaultValue: 'Les conversations liées aux commandes en cours apparaîtront ici.' })
          : t('business.chat.emptyOldDesc', { defaultValue: 'Les conversations de plus d\'une semaine sont automatiquement masquées.' })}
      </Text>
    </View>
  );

  if (conversationsQuery.isLoading && !conversationsQuery.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      {/* Header — back arrow pinned to the left via absolute positioning
          so the title can center horizontally over the row instead of
          sitting left-of-center next to the arrow (the prior layout had
          the title with flex:1 + left-aligned, which put it visually
          unbalanced against the empty right edge). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 12,
          minHeight: 44,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ position: 'absolute', left: 16, top: 8 }}
        >
          <ArrowLeft size={22} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }}>
          {t('business.chat.title', { defaultValue: 'Discussions' })}
        </Text>
      </View>

      {/* Tab switcher — underline style, matches the customer /orders
          and business /incoming-orders tab pattern (border-bottom 2 px
          accent under the active label, transparent otherwise). Keeps
          the visual language consistent across the app. */}
      <View
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.divider,
          marginBottom: 4,
        }}
      >
        {([
          { key: 'upcoming' as TabKey, label: t('business.chat.tabUpcoming', { defaultValue: 'En cours' }) },
          { key: 'old' as TabKey, label: t('business.chat.tabOld', { defaultValue: 'Terminées' }) },
        ]).map(({ key, label }) => {
          const active = tab === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: 'center',
                borderBottomWidth: 2,
                borderBottomColor: active ? theme.colors.primary : 'transparent',
                marginBottom: -1,
              }}
            >
              <Text
                style={{
                  color: active ? theme.colors.primary : theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                  fontWeight: active ? '600' : '400',
                }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Single FlatList for both empty + populated states. When `data` is
          empty, the contentContainerStyle's `flexGrow: 1` +
          `justifyContent: 'center'` centers the ListEmptyComponent
          vertically inside the LIST AREA — i.e. the band between the
          tabs and the bottom safe area — instead of against the whole
          screen. The previous code branched to renderEmpty() with a
          flex:1 SafeAreaView child, which centered against the full
          phone height (so the empty message floated above the tabs on
          tall devices and looked off-balance). */}
      <FlatList
        data={data}
        keyExtractor={(c) => `${tab}-${c.id}`}
        renderItem={renderRow}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={data.length === 0
          ? { flexGrow: 1, justifyContent: 'center', paddingBottom: insets.bottom + 24 }
          : { paddingBottom: insets.bottom + 24 }}
      />
    </SafeAreaView>
  );
}
