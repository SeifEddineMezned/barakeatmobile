import { Tabs } from "expo-router";
import { LayoutDashboard, ShoppingBag, ClipboardList, User, Bell, Settings, ChevronDown, MapPin, Check, Building2, Plus, QrCode, Hand, Clock, CheckCircle, MessageCircle, Store } from "lucide-react-native";
import React from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, Animated, Dimensions, PanResponder, Modal, StyleSheet, ScrollView, useWindowDimensions, BackHandler, AppState, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useSegments } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/src/theme/ThemeProvider";
import { getUnreadCount } from "@/src/services/notifications";
import { fetchTodayOrders } from "@/src/services/business";
import { fetchMyContext, fetchOrganizationDetails } from "@/src/services/teams";
import { useNotificationStore } from "@/src/stores/notificationStore";
import { useAuthStore } from "@/src/stores/authStore";
import { useBusinessStore } from "@/src/stores/businessStore";
import { useWalkthroughStore } from "@/src/stores/walkthroughStore";
import { useSplashStore } from "@/src/stores/splashStore";
import { NoLocationCTA } from "@/src/components/NoLocationCTA";
import { DelayedLoader } from "@/src/components/DelayedLoader";
import { DemoTapHintToast } from "@/src/components/DemoTapHintToast";
import { fetchConversationUnreads, fetchConversations } from "@/src/services/messages";
import { usePollWhenForegrounded } from "@/src/hooks/usePollWhenFocused";
import { getBusinessDayDateStr } from "@/src/utils/timezone";
import { isPendingReservationActive } from "@/src/utils/orderExpiry";
import Svg, { Path } from 'react-native-svg';
import { useOverlayOriginOffset } from "@/src/components/useOverlayOriginOffset";


export default function BusinessTabLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  // Chat-icon plumbing — header chat button publishes its window-space
  // center to the notification store so the SpeechBubblePopup that fires
  // on a message notif visually springs from this exact icon. Tap routes
  // to the full-page /business/conversations screen (was a bottom sheet,
  // promoted to a real screen at user request).
  const setChatIconOrigin = useNotificationStore((s) => s.setChatIconOrigin);
  // Conversation unread map — same query the per-order chat icons in
  // incoming-orders.tsx use, so React-Query dedupes the fetch.
  const msgUnreadsQuery = useQuery({
    queryKey: ['conversation-unreads'],
    queryFn: fetchConversationUnreads,
    staleTime: 25_000,
    enabled: isAuthenticated,
  });
  // Full conversation list — shared cache with /business/conversations
  // (same ['conversations'] key) so this doesn't add a second network
  // request. We need the full rows here so the header badge counts the
  // SAME conversations the conversations screen shows: a conversation
  // whose last message is >7 days old is dropped from the list, so its
  // unread_count should not inflate the badge.
  //
  // Refetch every 30 s while the app is FOREGROUNDED. The layout never
  // unmounts so without an interval the badge would only refresh when
  // something else (the conversations screen, the message thread)
  // happened to remount the shared cache.
  //
  // Why usePollWhenForegrounded (NOT a bare `refetchInterval: 30_000`):
  // the layout-level mount persists when the app is backgrounded, so a
  // bare interval kept firing /conversations every 30 s with the phone
  // in the user's pocket — the server's auto-close UPDATEs ran on each
  // hit and the load contributed to the "save → 503 popup → but
  // actually saved" symptom. Gating on AppState pauses the poll
  // entirely while backgrounded; push notifications already invalidate
  // ['conversations'] on foreground return so the badge is fresh the
  // moment the user comes back.
  const conversationsRefetch = usePollWhenForegrounded(30_000);
  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    staleTime: 25_000,
    refetchInterval: conversationsRefetch,
    refetchOnWindowFocus: true,
    enabled: isAuthenticated,
  });
  // Badge value = NUMBER OF CONVERSATIONS with unread messages, not the
  // sum of unread message counts. "4" on the badge then matches "4 red
  // dots in the conversations list" 1:1, which is what the user is
  // expecting when they tap through. Summing message counts caused the
  // badge to overshoot (one chatty thread with 5 unread messages read
  // as "5 unread" on the badge even though it was a single conversation).
  const msgUnreadsTotal = React.useMemo(() => {
    // Badge counts only ACTIONABLE unreads — what the user can act on
    // today. Two filters mirror the À venir tab on the conversations
    // page so the badge number always matches what the list shows:
    //
    //   1. Conversation status must be open (closed / blocked threads
    //      are no longer actionable).
    //   2. Last message must fall inside TODAY's business day (the
    //      03:30 Tunisia cutoff), or be a brand-new open thread with no
    //      history yet. Without this the badge was counting messages
    //      from previous business days OR from months ago — the user
    //      reported the badge showing "1" while the À venir list showed
    //      stale unreads from before the 03:30 reset.
    //
    // Past-tab unreads (older than the business-day boundary) are
    // intentionally NOT counted — they're reachable in Anciennes, but
    // shouldn't push the merchant to open the chat surface right now.
    const now = new Date();
    const todayBizDateStr = getBusinessDayDateStr(now);
    const convs = conversationsQuery.data ?? [];
    let count = 0;
    for (const c of convs) {
      const unread = Number(c.unread_count) || 0;
      if (unread <= 0) continue;
      if (c.status !== 'open') continue;
      const lastMs = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      if (lastMs === 0) {
        // No history yet — fresh open thread, count it.
        count += 1;
        continue;
      }
      const lastBizDateStr = getBusinessDayDateStr(new Date(lastMs));
      if (lastBizDateStr === todayBizDateStr) count += 1;
    }
    return count;
  }, [conversationsQuery.data]);
  const brandAnim = React.useRef(new Animated.Value(0)).current;

  // Compute visible tabs based on permissions (computed below, default all 4)
  const allTabNames = ['dashboard', 'my-baskets', 'incoming-orders', 'business-profile'];
  const navWidth = Dimensions.get('window').width - 64;
  // Single animated value drives BOTH the pill's translateX AND the
  // icon/label crossfade. The previous "two parallel Animated.Values"
  // approach (glassAnim + tabIndexAnim) introduced three different ways
  // they could drift on slow Android — colour-stays-grey + pill-snap-back
  // bugs the user kept hitting on one specific phone. Driving every visual
  // off `glassAnim` (real pill position) by interpolation makes drift
  // impossible: if the pill is where it should be, the colours follow.
  // Same pattern as the customer navbar in app/(tabs)/_layout.tsx.
  const glassAnim = React.useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Track live glassAnim x for swipe calculations
  const glassX = React.useRef(0);
  React.useEffect(() => {
    const id = glassAnim.addListener(({ value }) => { glassX.current = value; });
    return () => glassAnim.removeListener(id);
  }, [glassAnim]);

  // Refs so PanResponder (created once) can see latest navigation state
  const navStateRef = React.useRef<any>(null);
  const navRef = React.useRef<any>(null);

  const swipePanResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
    onPanResponderGrant: () => {
      glassAnim.stopAnimation();
      glassAnim.setOffset(glassX.current);
      glassAnim.setValue(0);
    },
    onPanResponderMove: (_, g) => {
      const maxX = tabWidth * (tabCount - 1);
      const clamped = Math.max(-glassX.current, Math.min(maxX - glassX.current, g.dx));
      glassAnim.setValue(clamped);
    },
    onPanResponderRelease: (_, g) => {
      glassAnim.flattenOffset();
      const raw = glassX.current;
      let targetIdx = Math.round(raw / tabWidth);
      if (g.vx > 0.4) targetIdx = Math.min(tabCount - 1, Math.floor(raw / tabWidth) + 1);
      else if (g.vx < -0.4) targetIdx = Math.max(0, Math.ceil(raw / tabWidth) - 1);
      targetIdx = Math.max(0, Math.min(tabCount - 1, targetIdx));

      Animated.spring(glassAnim, {
        toValue: targetIdx * tabWidth,
        useNativeDriver: true,
        friction: 10,
        tension: 100,
      }).start();
      setActiveIndex(targetIdx);
      // Navigate to the visible tab's route name
      const targetRoute = visibleTabs[targetIdx];
      if (targetRoute) navRef.current?.navigate(targetRoute);
    },
    onPanResponderTerminate: () => {
      glassAnim.flattenOffset();
    },
  }), [glassAnim, tabWidth, tabCount, visibleTabs, activeIndex]);

  // Block only users we can clearly identify as customers. Admin / owner /
  // member team accounts are all valid business users. Cross-role redirect is
  // handled by the root layout in app/_layout.tsx.
  const normalizedRole = String(user?.role ?? '').toLowerCase();
  const normalizedType = String((user as any)?.type ?? '').toLowerCase();
  const isCustomerUser =
    normalizedRole === 'customer' || normalizedRole === 'buyer' ||
    normalizedType === 'customer' || normalizedType === 'buyer';
  React.useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/auth/sign-in' as never);
    }
  }, [isAuthenticated]);

  const unreadQuery = useQuery({
    queryKey: ['unread-count'],
    queryFn: getUnreadCount,
    enabled: isAuthenticated,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const queryClient = useQueryClient();
  const prevUnreadRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (unreadQuery.data !== undefined) {
      // When unread count INCREASES, a new notification arrived — likely a new order
      // or a cancellation. Refresh not only the orders list but also the basket
      // quantity views (my-baskets dashboard + location cards): those UIs would
      // otherwise show stale counts until next focus/mount, which is what the
      // "basket quantity not responsive" complaint describes.
      if (prevUnreadRef.current !== undefined && unreadQuery.data > prevUnreadRef.current) {
        void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
        void queryClient.invalidateQueries({ queryKey: ['location-orders'] });
        void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
        void queryClient.invalidateQueries({ queryKey: ['locations'] });
        // Prefix-match: invalidates any ['location', id] and ['basket', id] caches.
        void queryClient.invalidateQueries({ queryKey: ['location'] });
        void queryClient.invalidateQueries({ queryKey: ['basket'] });
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location'] });
        // Restaurant stats card refreshes too, so revenue/basket counts track reality.
        void queryClient.invalidateQueries({ queryKey: ['restaurant-stats'] });
        // Force an immediate popup refresh so the bell-count bump and the
        // popup queue land on the same tick. Without this the bell shows
        // a new unread but the popup waits up to 30 s for its own poll.
        void useNotificationStore.getState().triggerPopupPoll();
      }
      prevUnreadRef.current = unreadQuery.data;
      setUnreadCount(unreadQuery.data);
    }
  }, [unreadQuery.data, setUnreadCount, queryClient]);

  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const setSelectedLocationId = useBusinessStore((s) => s.setSelectedLocationId);

  // Fetch org context & locations for the location dropdown
  const [locationModalVisible, setLocationModalVisible] = React.useState(false);

  // my-context (role / org / location memberships) doesn't change mid-
  // session except when an admin actively re-assigns the user. Polling
  // tightly to detect that change is wasteful — instead the backend
  // sends a silent `member_updated` push to the affected user the moment
  // role / permissions change, and the listener below refetches once
  // on receipt. The conservative 5 min interval here is the fallback for
  // the rare case where the push gets dropped (device offline, token
  // expired, FCM/APNs hiccup). Foreground-transition refetch ALSO runs
  // — covers the user backgrounding the app during the membership
  // change.
  const myContextQuery = useQuery({
    queryKey: ['my-context'],
    queryFn: fetchMyContext,
    enabled: isAuthenticated && user?.role === 'business',
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnReconnect: true,
  });

  // Foreground transition refetch — covers the case where the device
  // backgrounded our app, an admin changed this user's role on the
  // server, the silent push fired but the OS coalesced or dropped it
  // (common when the screen is locked for a while), and the user
  // brought us back. AppState 'change' → active fires before any
  // tab/focus event in JS.
  const refetchMyContext = myContextQuery.refetch;
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refetchMyContext();
    });
    return () => sub.remove();
  }, [refetchMyContext]);

  const orgId = myContextQuery.data?.organization_id;
  const myRole = myContextQuery.data?.role;

  // ── Auto-refresh on role / permission / location-membership change ─────
  // When the my-context payload tells us this business user's role,
  // permission set, or location assignment moved (i.e. an admin changed
  // them on the team-management screen, either locally or from another
  // device), play the Barakeat halo splash and re-fetch every dependent
  // query. The splash gives the user a visible "we're applying your new
  // role" beat AND naturally remounts the heavy tabs UI underneath so the
  // visible-tab gates / permission gates pick up the new values without
  // a manual restart. We deliberately NOT close + reopen the app — the
  // user reported that's jarring; this preserves the running JS instance,
  // the auth session, and the cached tabs state and just refreshes what
  // role/perms control.
  //
  // The snapshot is initialised on the FIRST data load (so the splash
  // doesn't fire on every cold start), then compared on every subsequent
  // data update. Compares via JSON.stringify because permissions/location
  // membership are records/arrays — identity comparison would always
  // diff on a React Query refetch even when the payload is identical.
  const triggerSplash = useSplashStore((s) => s.triggerSplash);
  const roleSnapshotRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const data = myContextQuery.data;
    if (!data) return;
    const snapshot = JSON.stringify({
      role: (data as any).role ?? null,
      permissions: (data as any).permissions ?? null,
      location_id: (data as any).location_id ?? null,
      location_ids: (data as any).location_ids ?? null,
    });
    if (roleSnapshotRef.current === null) {
      // First sighting — capture without firing.
      roleSnapshotRef.current = snapshot;
      return;
    }
    if (roleSnapshotRef.current === snapshot) return;
    roleSnapshotRef.current = snapshot;
    // Show the halo splash (non-login variant so we don't show the welcome
    // carousel after) and invalidate org-details so the new role's
    // location-list / member-list paints fresh under the splash. Other
    // permission-gated queries hang off the same key family and pick up
    // the change automatically.
    triggerSplash(false);
    void queryClient.invalidateQueries({ queryKey: ['org-details'], refetchType: 'all' });
    void queryClient.invalidateQueries({ queryKey: ['business-today-orders'], refetchType: 'all' });
    void queryClient.invalidateQueries({ queryKey: ['baskets'], refetchType: 'all' });
  }, [myContextQuery.data, triggerSplash, queryClient]);

  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });

  const orgLocations = orgDetailsQuery.data?.locations ?? [];
  const myLocationId = myContextQuery.data?.location_id;
  // Full set of locations this user belongs to. Source-of-truth preference:
  //   1. location_ids from my-context — polled every ~60s (same cadence as
  //      permissions), so remote membership changes show up quickly.
  //   2. membership rows in orgDetails matching my user_id — fallback for
  //      any device where my-context hasn't been updated yet.
  //   3. The single location_id from the primary membership (back-compat).
  // Previously we preferred org-details, but its 5-minute staleTime made
  // location-reassignments lag on the target member's device while their
  // permissions appeared to update instantly — felt like a bug.
  const myLocationIds = React.useMemo<number[]>(() => {
    const ids = myContextQuery.data?.location_ids;
    if (Array.isArray(ids) && ids.length > 0) return ids.map(Number);
    const uid = String(user?.id ?? '');
    const rows = (orgDetailsQuery.data?.members ?? []) as any[];
    const fromOrgDetails = new Set<number>();
    for (const m of rows) {
      if (String(m.user_id) === uid && m.location_id != null) fromOrgDetails.add(Number(m.location_id));
    }
    if (fromOrgDetails.size > 0) return Array.from(fromOrgDetails);
    return myLocationId != null ? [Number(myLocationId)] : [];
  }, [user?.id, orgDetailsQuery.data?.members, myContextQuery.data?.location_ids, myLocationId]);
  // Org admin = admin/owner with NO location constraint (access to all).
  // Location admin = admin WITH at least one location. They get profile
  // access too, but gestion d'équipe is scoped to their location(s).
  const isOrgAdmin = (myRole === 'admin' || myRole === 'owner') && myLocationIds.length === 0;
  const isLocationAdmin = myRole === 'admin' && myLocationIds.length > 0;
  const isAdminOrOwner = isOrgAdmin; // Only org-level admins get full org-wide access
  // Org owner/admin with zero locations — switcher shows an orange "no
  // location yet" affordance, mirroring the dashboard pill.
  //
  // Suppressed while the walkthrough is running so the demo plays out over
  // a populated UI (basket / order injection via demoBasketActive /
  // demoOrderActive). The dashboard "add your first location" popup
  // re-fires the moment the walkthrough ends (its focus-effect depends on
  // walkthroughStep), so the user still gets nudged to create a real
  // location once the demo is done.
  const walkthroughStep = useWalkthroughStore((s) => s.step);
  const hasNoLocation = walkthroughStep === null
    && isOrgAdmin
    && !!orgId
    && !orgDetailsQuery.isLoading
    && orgLocations.length === 0;
  // Any user with 2+ location memberships can switch via the dropdown — even
  // regular members. Single-location users (and org-admins in a single-
  // location org) see the name as static text with no chevron — nothing
  // to switch to, so the dropdown affordance would be misleading.
  const canSwitchLocation =
    (isOrgAdmin && orgLocations.length > 1) || myLocationIds.length > 1;
  const rawPerms = myContextQuery.data?.permissions ?? {};
  const hasPerm = (key: string) => { const v = (rawPerms as any)[key]; return v === true || v === 'true' || v === 'write'; };
  // New granular permission keys
  const canViewDashboard = true; // Dashboard always visible
  const canViewOrders = true; // Incoming orders always visible for all members
  // Granular basket permissions — mirror the exact flags my-baskets.tsx uses
  // to gate each action, so the demo only walks through what this member can
  // actually do.
  // Same role-trumps-perms policy as the canConfirmPickup / canMessage
  // gates below: every admin (org or location) gets every per-location
  // capability by default, regardless of what their stored permissions
  // column happens to say. Heals legacy admin rows whose perms were never
  // rewritten and matches the team-management UI's contract.
  const canCreateDeleteBaskets = isAdminOrOwner || isLocationAdmin || hasPerm('create_delete_baskets');
  const canEditQuantities = isAdminOrOwner || isLocationAdmin || hasPerm('edit_quantities');
  const canManageBaskets = canCreateDeleteBaskets || canEditQuantities || isLocationAdmin || hasPerm('edit_basket_info');
  // Profile tab — org admins see the full org profile; location admins see a
  // version scoped to their location only (the team screen enforces the scope).
  const canEditProfile = isOrgAdmin || isLocationAdmin;

  // Compute visible tabs
  const visibleTabs = React.useMemo(() => {
    const tabs: string[] = [];
    if (canViewDashboard) tabs.push('dashboard');
    if (canManageBaskets) tabs.push('my-baskets');
    if (canViewOrders) tabs.push('incoming-orders');
    if (canEditProfile) tabs.push('business-profile');
    return tabs.length > 0 ? tabs : ['dashboard']; // At minimum show dashboard
  }, [canViewDashboard, canManageBaskets, canViewOrders, canEditProfile]);
  const tabCount = visibleTabs.length;
  const tabWidth = navWidth / tabCount;

  // Re-snap the glass-pill indicator whenever the tab COUNT changes (i.e.
  // when the role/permission auto-refresh has just added or removed a
  // visible tab). The existing inline animation inside the tab-bar
  // renderer only re-fires on `activeIndex` change — but on a permission
  // refresh the active tab can stay at the same INDEX while `tabWidth`
  // changes underneath it (4 tabs → 3 tabs means `navWidth / tabCount`
  // is now different). Without this effect the pill keeps its old pixel
  // x — computed against the old tabWidth — and renders under the wrong
  // button. `setValue` (not spring) so the visual lines up instantly,
  // hidden behind the refresh splash that's already on screen during a
  // role/perm change.
  React.useEffect(() => {
    glassAnim.setValue(activeIndex * tabWidth);
    // `activeIndex` intentionally NOT in the dep array. This effect exists
    // to snap the pill when the TAB LAYOUT changes (a permission refresh
    // adds/removes a tab → tabWidth recomputes). When the user simply
    // taps a tab, `activeIndex` updates via setActiveIndex but tabWidth
    // doesn't move — we want the press handler's spring (or the in-renderer
    // auto-sync's spring) to drive the pill, NOT a hard setValue snap. The
    // previous deps included `activeIndex`, and on slow Android the snap
    // landed mid-spring and hard-cut the pill to its target, leaving the
    // colour crossfade out of sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabCount, tabWidth, glassAnim]);

  // Measure the floating tab bar in window coords so the demo's tab halos
  // sit exactly on the pills (no inset/`bottom:20` guesswork). Re-measured on
  // every layout (rotation, nav-bar changes) and published to the walkthrough
  // store under 'bizTabBar'.
  const tabBarMeasureRef = React.useRef<View>(null);
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  const measureTabBar = React.useCallback(() => {
    tabBarMeasureRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setMeasuredRect('bizTabBar', { x, y, w, h });
    });
  }, [setMeasuredRect]);

  // Lock handled in the unified effect below

  // Auto-pick a valid location whenever the persisted / current selection
  // isn't actually one the user can access. Three cases this catches:
  //   1. Cold start with no persisted ID → pick the first valid one.
  //   2. Cold start with a stale persisted ID (org changed, location was
  //      soft-deleted, member reassigned) → snap to first valid.
  //   3. Navigating away from the dashboard while admin still on "all" →
  //      pick a specific location since other pages need one.
  // Wait until orgDetailsQuery has resolved before deciding — running this
  // against an empty in-flight list would falsely treat the persisted ID as
  // invalid and reset it.
  const isDashboard = activeIndex === 0;
  const locationDefaultApplied = useBusinessStore((s) => s.locationDefaultApplied);
  const markLocationDefaultApplied = useBusinessStore((s) => s.markLocationDefaultApplied);
  React.useEffect(() => {
    if (orgDetailsQuery.isLoading) return;
    const validIds = isAdminOrOwner
      ? orgLocations.map((l) => Number(l.id))
      : myLocationIds.map(Number);
    if (validIds.length === 0) return;
    const selNum = selectedLocationId != null ? Number(selectedLocationId) : null;
    const isValid = selNum != null && validIds.includes(selNum);

    // First-run path: nothing has ever been picked on this device. Always
    // land on the first available location (top of list / most recent) so
    // the dropdown shows an actual location name instead of "Tous les
    // emplacements". After this fires once, locationDefaultApplied flips
    // permanently true and subsequent nulls are treated as a deliberate
    // user choice (Tous).
    if (!locationDefaultApplied) {
      if (!isValid) {
        setSelectedLocationId(validIds[0]);  // also flips the flag (see store)
      } else {
        markLocationDefaultApplied();
      }
      return;
    }

    // Returning sessions:
    //   • org admins on dashboard may legitimately have null (Tous)
    //   • everyone else needs a concrete id for per-location queries
    // Stale persisted IDs (org changed, location deleted, member reassigned)
    // get snapped to the first valid.
    const allowNull = isAdminOrOwner && isDashboard;
    if (!isValid && !allowNull) {
      setSelectedLocationId(validIds[0]);
    } else if (!isValid && allowNull && selNum != null) {
      // Stale ID for an admin on the dashboard → revert to Tous rather
      // than displaying a phantom location name.
      setSelectedLocationId(null);
    }
  }, [isDashboard, selectedLocationId, orgLocations, setSelectedLocationId, isAdminOrOwner, myLocationIds, orgDetailsQuery.isLoading, locationDefaultApplied, markLocationDefaultApplied]);

  // Derive the current location name for display. Important: do NOT silently
  // fall back to `orgLocations[0]?.name` when nothing is selected — that
  // displayed a real location's name while `selectedLocationId` was still
  // null, so per-location queries would return wrong data while the UI
  // looked correct. The auto-pick effect above keeps `selectedLocationId`
  // pointed at a valid id, so this null branch is rare and we surface it
  // honestly with the placeholder copy.
  const selectedLocationName = React.useMemo(() => {
    // No locations created yet → unified "Aucun emplacement" label so the
    // switcher pill reads the same on dashboard, my-baskets and orders. The
    // dashboard branch below would otherwise fall through to the org name or
    // "Tous les emplacements" placeholder, which made the dropdown look
    // inconsistent across tabs in the empty-org state.
    if (hasNoLocation) {
      return t('business.locationSwitcher.noLocationYet', { defaultValue: 'Aucun emplacement' });
    }
    if (!selectedLocationId) {
      if (isDashboard && isAdminOrOwner) {
        return myContextQuery.data?.organization_name ?? t('business.allLocations', { defaultValue: 'Tous les emplacements' });
      }
      return t('business.location', { defaultValue: 'Emplacement' });
    }
    const loc = orgLocations.find((l) => l.id === Number(selectedLocationId));
    return loc?.name ?? t('business.location', { defaultValue: 'Location' });
  }, [hasNoLocation, selectedLocationId, orgLocations, isAdminOrOwner, isDashboard, t]);

  // PanResponder for swipe-to-dismiss on the location modal
  const modalPanResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
    onPanResponderRelease: (_, g) => {
      if (g.dy > 60) {
        setLocationModalVisible(false);
      }
    },
  }), []);

  // Layout-level pending-orders poll. NOT focus-gated — business
  // users want to see the orders badge update across every tab in the
  // partner app. Bumped 30s → 45s and staleTime 15s → 30s to cut the
  // baseline drip; freshness is restored sharply when the user opens
  // the incoming-orders tab (which invalidates this query).
  //
  // Always fetches WITHOUT a location filter so we have data for every
  // location the user can see — this powers two surfaces:
  //   1. The nav-bar orders badge (count for the CURRENTLY selected
  //      location, or sum across all locations on the dashboard's
  //      "Tous" view).
  //   2. The per-location count chips inside the location-switcher
  //      modal — replaces the old "this one is selected" checkmark
  //      with a more useful "this one has N incoming orders" hint so
  //      multi-location merchants can see at a glance which venue
  //      needs attention before they even tap.
  const todayOrdersQuery = useQuery({
    queryKey: ['today-orders-count'],
    queryFn: () => fetchTodayOrders(null),
    enabled: isAuthenticated && user?.role === 'business',
    refetchInterval: 45_000,
    staleTime: 30_000,
  });

  // Per-location active-pending count. Derived in JS (no extra
  // network) from the same fetch above; the shared
  // `isPendingReservationActive` predicate keeps these counts
  // aligned with the dashboard "En attente" tile and the incoming-
  // orders En cours tab — anything that's actually pending right
  // now, nothing older or already-expired.
  const pendingCountByLocation = React.useMemo(() => {
    const today = getBusinessDayDateStr(new Date());
    const map = new Map<number, number>();
    for (const o of todayOrdersQuery.data ?? []) {
      if (!isPendingReservationActive(o, today)) continue;
      const lid = Number((o as any).location_id);
      if (!Number.isFinite(lid)) continue;
      map.set(lid, (map.get(lid) ?? 0) + 1);
    }
    return map;
  }, [todayOrdersQuery.data]);

  // Pending-orders badge value for the bottom-nav icon. Counts only
  // the SELECTED location's pending orders (or sums across all
  // locations when the user is on the dashboard's "Tous" view, where
  // selectedLocationId is null). Same predicate basis as
  // pendingCountByLocation above, so the badge and the modal chips
  // can never disagree.
  const pendingOrderCount = React.useMemo(() => {
    if (selectedLocationId) {
      return pendingCountByLocation.get(Number(selectedLocationId)) ?? 0;
    }
    let total = 0;
    for (const n of pendingCountByLocation.values()) total += n;
    return total;
  }, [pendingCountByLocation, selectedLocationId]);

  React.useEffect(() => {
    Animated.spring(brandAnim, {
      toValue: 1,
      friction: 6,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, []);

  const headerBrand = () => (
    <Animated.View style={{
      // marginLeft removed — the 16px left inset is provided by
      // headerLeftContainerStyle below so the pill aligns pixel-perfectly with
      // the dashboard's custom floating header (which uses `left: 16`).
      flexDirection: 'row',
      alignItems: 'center',
      opacity: brandAnim,
      transform: [
        { translateX: brandAnim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
        { scale: brandAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 1.05, 1] }) },
      ],
    }}>
      {canSwitchLocation ? (
        // Pill trigger — matches the dashboard's location switcher exactly:
        // brand-primary Building2 + textPrimary text + chevron, no orange
        // / MapPin special case for the empty-org state. The
        // "Aucun emplacement" copy already comes from selectedLocationName,
        // so the pill stays informative without flipping its whole palette.
        <TouchableOpacity
          onPress={() => setLocationModalVisible(true)}
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            ...theme.shadows.shadowMd,
            maxWidth: 240,
          }}
          activeOpacity={0.7}
        >
          <Building2 size={14} color={theme.colors.primary} />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flexShrink: 1 }}
          >
            {selectedLocationName}
          </Text>
          <ChevronDown size={13} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        // Static (non-tappable) pill — used when the user only has one
        // location to choose from. Same styling as the interactive pill
        // and the dashboard pill so every tab reads identically.
        <View style={{
          backgroundColor: theme.colors.surface,
          borderRadius: 20,
          paddingHorizontal: 12,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          ...theme.shadows.shadowMd,
          maxWidth: 240,
        }}>
          <Building2 size={14} color={theme.colors.primary} />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flexShrink: 1 }}
          >
            {selectedLocationName}
          </Text>
        </View>
      )}
    </Animated.View>
  );

  // Builds the right-hand cluster of the nav header. `includeChat: false`
  // produces the Settings + Bell pair without the conversations shortcut —
  // used on the incoming-orders tab where every order card already has its
  // own per-order chat button, so the global one is redundant.
  const buildHeaderRight = (includeChat: boolean) => () => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TouchableOpacity
        onPress={() => router.push('/settings' as never)}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        style={{ marginRight: 12, padding: 6 }}
      >
        <Settings size={20} color={theme.colors.textPrimary} />
      </TouchableOpacity>
      {/* Chat icon — pushes the full-page /business/conversations route.
          Sits between Settings and the bell so the cluster reads as
          "system / chat / notifications". onLayout publishes the icon's
          window-space center to the notification store so the
          SpeechBubblePopup that fires on chat notifs springs from this
          exact spot. */}
      {includeChat && isAuthenticated ? (
        <TouchableOpacity
          onPress={() => router.push('/business/conversations' as never)}
          onLayout={(e) => {
            (e.target as any)?.measureInWindow?.((x: number, y: number, w: number, h: number) => {
              if (w > 0 && h > 0) setChatIconOrigin({ x: x + w / 2, y: y + h });
            });
          }}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ marginRight: 12, padding: 6 }}
        >
          <MessageCircle size={20} color={theme.colors.textPrimary} />
          {msgUnreadsTotal > 0 && (
            <View style={{
              position: 'absolute',
              top: 2,
              right: 0,
              backgroundColor: theme.colors.error,
              borderRadius: 8,
              minWidth: 16,
              height: 16,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 4,
            }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {msgUnreadsTotal > 99 ? '99+' : msgUnreadsTotal}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      ) : null}
      {isAuthenticated ? (
        <TouchableOpacity
          onPress={() => router.push('/notifications' as never)}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={{ marginRight: 10, padding: 6 }}
        >
          <Bell size={20} color={theme.colors.textPrimary} />
          {unreadCount > 0 && (
            <View style={{
              position: 'absolute',
              top: 2,
              right: 0,
              backgroundColor: theme.colors.error,
              borderRadius: 8,
              minWidth: 16,
              height: 16,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 4,
            }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
  // Default header — full Settings + Chat + Bell cluster.
  const headerRight = buildHeaderRight(true);
  // Variant without the chat icon — applied to the incoming-orders tab,
  // where each card already has its own per-order chat button.
  const headerRightNoChat = buildHeaderRight(false);

  // Hard render-gate: block the business UI only for unauthenticated users
  // and users we can clearly identify as customers. Team admins / owners /
  // members are still allowed through so their queries keep running.
  if (!isAuthenticated || isCustomerUser) {
    return null;
  }

  // Wait for the perms query to settle before mounting the tab navigator.
  // Without this gate the tabs render at 2 first (permissions empty → only
  // dashboard + incoming-orders) and pop to 4 a moment later when
  // myContextQuery resolves — the visible "2→4 tab flip" jitter the user
  // reported. We render while either:
  //   • data has landed (success path), OR
  //   • the query errored (typically offline) — render the degraded 2-tab
  //     fallback rather than trapping the user on a loader forever.
  // TanStack returns cached data synchronously, so a warm reload doesn't
  // even briefly paint the loader.
  const permsReady = myContextQuery.data !== undefined || myContextQuery.isError;
  if (!permsReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#f9f9f6' }}>
        <DelayedLoader />
      </View>
    );
  }

  return (
    <>
    <Tabs
      screenOptions={{
        // Bottom-tabs v7 ships with a "shift" slide animation as its default.
        // For mobile bottom-tab UX a hard switch is what users expect, and
        // it also keeps the demo's step-1 → step-2 transition (dashboard →
        // baskets) crisp — no horizontal page slide between tabs.
        animation: 'none',
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        headerShown: true,
        headerTitle: '',
        headerShadowVisible: false,
        // Pin the header content height to 52 so the location pill sits at a
        // deterministic vertical position (insets.top + 26 center) on every
        // tab — the dashboard's custom floating header mirrors this exactly so
        // the pill never shifts when switching tabs. 52 also matches the
        // location-dropdown modal's `insets.top + 52` anchor.
        headerStyle: { backgroundColor: theme.colors.bg, height: insets.top + 52 },
        headerStatusBarHeight: insets.top,
        // Pin the headerLeft / headerRight container insets to the exact same
        // horizontal anchor the dashboard's custom floating header uses (left: 16,
        // right: 16). Without this, RN-Navigation applies its own platform-default
        // paddingHorizontal to those containers — combined with the marginLeft: 16
        // that used to live on `headerBrand` — that pushed the location pill
        // several pixels further from the screen edge than on the dashboard, so
        // the pill visibly jumped sideways when switching tabs.
        headerLeftContainerStyle: { paddingLeft: 16, paddingRight: 0 },
        headerRightContainerStyle: { paddingRight: 16, paddingLeft: 0 },
        headerLeft: headerBrand,
        headerRight: headerRight,
      }}
      tabBar={(props) => {
        const { state, descriptors, navigation } = props;
        navStateRef.current = state;
        navRef.current = navigation;

        // Map real route index to visible tab index
        const currentRouteName = state.routes[state.index]?.name;
        const visibleIdx = visibleTabs.indexOf(currentRouteName);

        // If current route is not visible, force navigate to first visible tab
        if (visibleIdx < 0 && visibleTabs.length > 0) {
          requestAnimationFrame(() => {
            navigation.navigate(visibleTabs[0]);
          });
        }

        const safeVisIdx = visibleIdx >= 0 ? visibleIdx : 0;
        const targetX = safeVisIdx * tabWidth;
        if (activeIndex !== safeVisIdx) {
          requestAnimationFrame(() => {
            Animated.spring(glassAnim, {
              toValue: targetX,
              useNativeDriver: true,
              friction: 10,
              tension: 100,
            }).start();
            setActiveIndex(safeVisIdx);
          });
        }

        return (
          <View
            ref={tabBarMeasureRef}
            onLayout={measureTabBar}
            {...swipePanResponder.panHandlers}
            style={{
              position: 'absolute',
              bottom: 20,
              left: 32,
              right: 32,
              height: 68,
              backgroundColor: theme.colors.surface,
              borderRadius: 20,
              borderTopWidth: 0,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 10,
              paddingBottom: 0,
              paddingHorizontal: 0,
              flexDirection: 'row',
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            {/* Glass slider indicator */}
            <Animated.View
              style={{
                position: 'absolute',
                width: tabWidth - 12,
                height: 52,
                backgroundColor: theme.colors.primary,
                borderRadius: 22,
                left: 6,
                transform: [{ translateX: glassAnim }],
              }}
            />

            {state.routes.filter((route) => visibleTabs.includes(route.name)).map((route, index) => {
              const { options } = descriptors[route.key];
              const isFocused = index === safeVisIdx;
              const inactiveColor = theme.colors.textSecondary;
              const activeColor = '#FFFFFF';
              // White-overlay opacity interpolated from the PILL'S LIVE X
              // (glassAnim), not from a parallel index value. Peaks at 1
              // when the pill is centred on this tab, fades to 0 over the
              // immediate neighbours. Because the source IS the pill
              // position, the colours physically cannot get out of sync —
              // if the pill is on this tab, this tab is white. Same
              // pattern as the customer navbar (app/(tabs)/_layout.tsx).
              const whiteOpacity = glassAnim.interpolate({
                inputRange: [(index - 1) * tabWidth, index * tabWidth, (index + 1) * tabWidth],
                outputRange: [0, 1, 0],
                extrapolate: 'clamp',
              });

              const onPress = () => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                // Refetch permissions on every tab press (cheap — only fires if stale)
                if (myContextQuery.isStale) void myContextQuery.refetch();
                if (!isFocused && !event.defaultPrevented) {
                  // Only navigate — do NOT setActiveIndex or start a spring
                  // here. The in-renderer auto-sync above watches navigation
                  // state and triggers the pill spring on the next render
                  // after nav state propagates. Doing both produced a race
                  // on slow Android: setActiveIndex's re-render fired the
                  // auto-sync (which still saw the OLD safeVisIdx because
                  // nav state hadn't propagated yet), sending the pill back
                  // to the previous tab for a frame.
                  navigation.navigate(route.name);
                }
              };

              let IconComp: any = null;
              let badge = 0;
              const iconSize = 22;
              switch (route.name) {
                case 'dashboard': IconComp = LayoutDashboard; break;
                case 'my-baskets': IconComp = ShoppingBag; break;
                case 'incoming-orders':
                  IconComp = ClipboardList;
                  if (pendingOrderCount > 0) badge = pendingOrderCount;
                  break;
                // Commerce-oriented Store icon (was the customer User
                // glyph). The merchant tab IS the business profile, so
                // the storefront silhouette reads truer than a person.
                case 'business-profile': IconComp = Store; break;
              }
              // Two stacked icons + two stacked labels per tab. The gray pair
              // is the always-on baseline; the white pair sits on top with
              // animated opacity that the native driver crossfades in/out as
              // the pill slides past this tab's index. This is what removes
              // the perceived "old button fades out before the pill moves"
              // jank on slow Android phones — the JS thread no longer has to
              // re-render anything for the color to track the pill.
              const label = options.title ?? route.name;
              const labelStyle = {
                fontSize: 8,
                fontFamily: 'Poppins_500Medium',
                marginTop: 3,
                width: tabWidth - 16,
                textAlign: 'center' as const,
              };

              return (
                <TouchableOpacity
                  key={route.key}
                  onPress={onPress}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 68,
                    paddingHorizontal: 4,
                  }}
                  activeOpacity={0.7}
                >
                  <View style={{ position: 'relative' }}>
                    {/* Two-layer icon (gray underneath + white overlay with
                        animated opacity, source = glassAnim). Both platforms
                        use the same render path — the crossfade can't drift
                        because it reads the pill's actual position. */}
                    {IconComp && (
                      <View style={{ width: iconSize, height: iconSize }}>
                        <IconComp size={iconSize} color={inactiveColor} />
                        <Animated.View style={{ position: 'absolute', top: 0, left: 0, opacity: whiteOpacity }}>
                          <IconComp size={iconSize} color={activeColor} />
                        </Animated.View>
                      </View>
                    )}
                    {badge > 0 && (
                      <View style={{
                        position: 'absolute',
                        top: -4,
                        right: -10,
                        backgroundColor: theme.colors.error,
                        borderRadius: 8,
                        minWidth: 16,
                        height: 16,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 4,
                      }}>
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>{badge > 99 ? '99+' : badge}</Text>
                      </View>
                    )}
                  </View>
                  {/* Stacked gray + animated-white labels — same crossfade
                      story as the icon above, both platforms. */}
                  <View style={{ marginTop: 3, height: 12, justifyContent: 'center' }}>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={[labelStyle, { color: inactiveColor, marginTop: 0 }]}
                    >
                      {label}
                    </Text>
                    <Animated.Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={[labelStyle, { color: activeColor, marginTop: 0, position: 'absolute', left: 0, right: 0, opacity: whiteOpacity }]}
                    >
                      {label}
                    </Animated.Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t('business.dashboard.tabLabel', { defaultValue: 'Accueil' }),
          headerShown: false,
          tabBarIcon: ({ size, focused }) => <LayoutDashboard size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="my-baskets"
        options={{
          title: t('business.baskets.title'),
          tabBarIcon: ({ size, focused }) => <ShoppingBag size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
      <Tabs.Screen
        name="incoming-orders"
        options={{
          title: t('business.orders.title'),
          tabBarIcon: ({ size, focused }) => <ClipboardList size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
          // Per-order cards on this tab already carry their own chat
          // button, so the global chat shortcut would be redundant.
          // Strip it from the header on this screen only — Settings + Bell
          // still render.
          headerRight: headerRightNoChat,
        }}
      />
      <Tabs.Screen
        name="business-profile"
        options={{
          // Short "Profil" / "Profile" / "الملف" label so the tab
          // doesn't ellipsize on narrow phones. The full
          // `business.profile.title` ("Business Profile" / "Infos
          // Commerce") is still used inside the screen header.
          title: t('business.profile.tabLabel', { defaultValue: 'Profil' }),
          // Store (storefront) instead of User (customer glyph) — this
          // tab IS the merchant's profile, so a commerce icon reads
          // truer than a person icon.
          tabBarIcon: ({ size, focused }) => <Store size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
        }}
      />
    </Tabs>

    {/* Location selector — inline dropdown that expands below the header
        brand. Uses a transparent Modal so it layers above tabs; the panel
        itself is anchored top-left (just under the header) rather than
        sliding up from the bottom like a sheet. */}
    <Modal
      visible={locationModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setLocationModalVisible(false)}
    >
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' }}
        activeOpacity={1}
        onPress={() => setLocationModalVisible(false)}
      >
        <View
          style={{
            position: 'absolute',
            top: (insets.top ?? 0) + 52,
            left: 12,
            right: 12,
            maxHeight: '70%',
            backgroundColor: theme.colors.surface,
            borderRadius: 16,
            paddingVertical: 8,
            paddingHorizontal: 8,
            ...theme.shadows.shadowLg,
            borderWidth: 1,
            borderColor: theme.colors.divider,
          }}
          onStartShouldSetResponder={() => true}
        >
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {/* "All locations" option — only on dashboard, and only when the
                user actually sees 2+ locations. With a single location the
                "Tous" entry is just visual noise. */}
            {isDashboard && orgLocations.filter((loc) => isOrgAdmin || myLocationIds.includes(Number(loc.id))).length > 1 && (
              <TouchableOpacity
                onPress={() => { setSelectedLocationId(null); setLocationModalVisible(false); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  backgroundColor: !selectedLocationId ? theme.colors.primary + '12' : 'transparent',
                }}
                activeOpacity={0.7}
              >
                <Store size={18} color={!selectedLocationId ? theme.colors.primary : theme.colors.textSecondary} />
                <Text style={{
                  flex: 1,
                  marginLeft: 10,
                  color: !selectedLocationId ? theme.colors.primary : theme.colors.textPrimary,
                  fontSize: 14,
                  fontWeight: !selectedLocationId ? '700' : '500',
                  fontFamily: !selectedLocationId ? 'Poppins_700Bold' : 'Poppins_500Medium',
                }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t('business.allLocations', { defaultValue: 'Tous les emplacements' })}
                </Text>
                {/* Per-location modal chip — same total used by the
                    nav-bar badge so the two numbers always agree.
                    Replaces the old "this row is selected"
                    checkmark; the row's tinted background already
                    conveys selection, so the slot is freed up for
                    something more useful: "this venue has N orders
                    waiting on you right now". */}
                {(() => {
                  let total = 0;
                  for (const n of pendingCountByLocation.values()) total += n;
                  return total > 0 ? (
                    <View style={{
                      minWidth: 24, height: 24,
                      borderRadius: 12,
                      backgroundColor: theme.colors.primary,
                      paddingHorizontal: 7,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}>
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                        {total}
                      </Text>
                    </View>
                  ) : null;
                })()}
              </TouchableOpacity>
            )}

            {/* Individual locations — org admins see every location; everyone
                else only sees the ones they actually belong to (myLocationIds).
                Uses Building2 to match the dashboard's switcher. */}
            {orgLocations.filter((loc) => isOrgAdmin || myLocationIds.includes(Number(loc.id))).map((loc) => {
              const isSelected = Number(selectedLocationId) === loc.id;
              return (
                <TouchableOpacity
                  key={loc.id}
                  onPress={() => { setSelectedLocationId(loc.id); setLocationModalVisible(false); }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    backgroundColor: isSelected ? theme.colors.primary + '12' : 'transparent',
                  }}
                  activeOpacity={0.7}
                >
                  <Building2 size={18} color={isSelected ? theme.colors.primary : theme.colors.textSecondary} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={{
                        color: isSelected ? theme.colors.primary : theme.colors.textPrimary,
                        fontSize: 14,
                        fontWeight: isSelected ? '700' : '500',
                        fontFamily: isSelected ? 'Poppins_700Bold' : 'Poppins_500Medium',
                      }}
                    >
                      {loc.name ?? t('business.unnamedLocation', { defaultValue: 'Unnamed location' })}
                    </Text>
                    {loc.address ? (
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 2 }} numberOfLines={1} ellipsizeMode="tail">
                        {loc.address}
                      </Text>
                    ) : null}
                  </View>
                  {/* Pending-orders chip for this location. Same
                      predicate the nav-bar badge uses (so the two
                      numbers can never drift). Hidden when zero —
                      the row's tinted background already shows
                      selection, so we don't need a placeholder. */}
                  {(() => {
                    const count = pendingCountByLocation.get(loc.id) ?? 0;
                    return count > 0 ? (
                      <View style={{
                        minWidth: 24, height: 24,
                        borderRadius: 12,
                        backgroundColor: theme.colors.primary,
                        paddingHorizontal: 7,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                          {count}
                        </Text>
                      </View>
                    ) : null;
                  })()}
                </TouchableOpacity>
              );
            })}

            {/* Empty state — admin with zero locations gets the same CTA the
                dashboard switcher shows, so the affordance to add a first
                point-de-vente is reachable from every tab. */}
            {orgLocations.length === 0 && !orgDetailsQuery.isLoading && isOrgAdmin && (
              <View style={{ paddingVertical: 8 }}>
                <NoLocationCTA
                  compact
                  onPressOverride={() => {
                    setLocationModalVisible(false);
                    router.push('/business/add-location' as never);
                  }}
                />
              </View>
            )}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>

    {/* ── Interactive business tab walkthrough overlay ── */}
    <BusinessWalkthroughOverlay
      navRef={navRef}
      tabWidth={tabWidth}
      theme={theme}
      t={t}
      visibleTabs={visibleTabs}
      canCreateDeleteBaskets={canCreateDeleteBaskets}
      canEditQuantities={canEditQuantities}
      canEditProfile={canEditProfile}
      // role='admin' (org or location) is treated as "all per-location
      // capabilities enabled" regardless of stored permission flags. This
      // matches the team-management UI's promise ("admin = all perms by
      // default") AND it heals any legacy admin account whose permissions
      // column never got rewritten (members promoted to admin via the
      // role-change modal BEFORE that modal was fixed to write the full
      // admin perm set on promotion). Without this, those legacy admins
      // would show as `confirm_pickup: 'none'` in the DB even though
      // they're admins, and the demo (plus real UI) would silently strip
      // their chat / confirm-pickup / basket-management affordances.
      canConfirmPickup={isAdminOrOwner || isLocationAdmin || hasPerm('confirm_pickup')}
      canMessage={isAdminOrOwner || isLocationAdmin || hasPerm('messaging')}
      isOrgAdmin={isOrgAdmin}
      isLocationAdmin={isLocationAdmin}
      hasNoLocation={hasNoLocation}
      insetsTop={insets.top}
      insetsBottom={insets.bottom}
      router={router}
    />
    </>
  );
}

// ── Business walkthrough spotlight ─────────────────────────────────────────
// highlight: 'tab' = cutout around tab pill; 'element' = cutout around an
// on-screen element positioned from one of the screen edges.
// `target` accepts width/height (preferred — matches rectangular buttons) OR
// a legacy square `size`. `requireTap` means the tooltip has no Next button —
// the walkthrough advances only when the user actually interacts with the
// feature (e.g., navigates to `advanceOnPath`). `isSettings` is the final
// stage and is rendered by settings.tsx instead of this overlay.
type HighlightType = 'tab' | 'element' | 'inline-modal';
type StepKey = 'basketCreate' | 'pickup' | 'settings';
import type { MeasuredKey } from '@/src/stores/walkthroughStore';
interface BizStep {
  tabIndex: number;
  routeName: string;
  icon: any;
  titleKey: string;
  descKey: string;
  highlight: HighlightType;
  target?: { top?: number; bottom?: number; left?: number; right?: number; size?: number; width?: number; height?: number; radius?: number };
  tooltipPosition?: 'bottom' | 'top';
  requireTap?: boolean;
  advanceOnPath?: string;
  // What the user taps for a `requireTap` step — drives the tap-hint copy
  // ("Appuyez sur la carte" vs "le bouton"). Defaults to 'button'.
  tapTarget?: 'card' | 'button';
  // Watch a flag in the walkthrough store; advance when it flips true.
  // 'modal' watches verifyModalOpen (Verify Pickup modal opened); 'expand'
  // watches expandedDemoCard (user expanded the demo order card).
  advanceOnFlag?: 'modal' | 'expand';
  isSettings?: boolean;
  // Pull the measured rect from the walkthrough store by key — pixel-perfect.
  measureKey?: MeasuredKey;
  // Effects that fire when the user enters this step. Set demo flags so
  // screens know to inject fake data / mock backend calls.
  enter?: { demoBasket?: boolean; demoOrder?: boolean; demoScanCode?: string | null };
}

// NOTE: Do NOT capture window dimensions at module load — on Pixel 6 (and
// other tall Android devices) the live window height after edge-to-edge
// initialisation is larger than the value Dimensions returns at first
// require, which left the dim mask too short (visible un-dimmed sliver
// above the system nav bar) and the tab halo too high (computed against
// the stale height while the tab pill is positioned `bottom: 20` from
// the live window). Live values come from `useWindowDimensions()` below.

function buildWalkthroughSteps(visibleTabs: string[], canCreateDeleteBaskets: boolean, canEditQuantities: boolean, canEditProfile: boolean, canConfirmPickup: boolean, canMessage: boolean, isOrgAdmin: boolean, isLocationAdmin: boolean, _hasNoLocation: boolean, insetsTop: number, SCREEN_W_BIZ: number): BizStep[] {
  // The previous "no location yet" short-circuit (one step pointing at the
  // add-location CTA halo) is gone. The walkthrough now always runs the
  // full demo, even for brand-new org admins with zero locations:
  // hasNoLocation is suppressed while the walkthrough is active (see the
  // [_layout.tsx:206] declaration), so the dashboard / orders / baskets
  // pages render their normal UI and the existing demoBasketActive /
  // demoOrderActive injections populate it with fake data. The
  // "Ajoutez votre premier point de vente" nudge is then surfaced as a
  // centered popup on the dashboard the moment the walkthrough ends.
  const steps: BizStep[] = [];
  // ── Dashboard ─────────────────────────────────────────────────────────
  const dashIdx = visibleTabs.indexOf('dashboard');
  if (dashIdx >= 0) {
    steps.push({ tabIndex: dashIdx, routeName: 'dashboard', icon: LayoutDashboard, titleKey: 'walkthrough.biz.dashboard.title', descKey: 'walkthrough.biz.dashboard.desc', highlight: 'tab' });
  }
  // ── Baskets — interactive sub-tour through create-basket form ─────────
  const basketIdx = visibleTabs.indexOf('my-baskets');
  if (basketIdx >= 0 && (canCreateDeleteBaskets || canEditQuantities)) {
    steps.push({ tabIndex: basketIdx, routeName: 'my-baskets', icon: ShoppingBag, titleKey: 'walkthrough.biz.baskets.title', descKey: 'walkthrough.biz.baskets.desc', highlight: 'tab' });
    // ── Create-basket flow — ONLY for members who can create/delete baskets.
    // A quantity-only member skips straight to the demo basket card + qty edit.
    if (canCreateDeleteBaskets) {
    // 1. Tap the real Add Basket button → form opens
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Plus,
      titleKey: 'walkthrough.biz.basketCreate.title',
      descKey: 'walkthrough.biz.basketCreate.desc',
      highlight: 'element',
      target: { top: insetsTop + 54, right: 20, width: 140, height: 40, radius: 12 },
      tooltipPosition: 'bottom',
      requireTap: true,
      // The "+" now opens the intermediary "Ajouter un panier" page first.
      advanceOnPath: '/business/select-org-basket',
      measureKey: 'addBasket',
      // Activate demo basket NOW so create-basket pre-fills on mount.
      enter: { demoBasket: true },
    });
    // 1b. Intermediary page — reuse an existing org basket. The actual
    // select-org-basket page shows the "existing baskets" list to BOTH org
    // admins AND location admins (every admin manages baskets within their
    // scope), so the demo step needs to show for both. The previous
    // `if (isOrgAdmin)` gate skipped this step for location admins even
    // though they SAW the existing-baskets option in the real form —
    // creating a mismatch between the demo and the actual UI.
    if (isOrgAdmin || isLocationAdmin) {
      steps.push({
        tabIndex: basketIdx,
        routeName: 'my-baskets',
        icon: ShoppingBag,
        titleKey: 'walkthrough.biz.reuseBasket.title',
        descKey: 'walkthrough.biz.reuseBasket.desc',
        highlight: 'element',
        // Fallback rect tuned for the FIRST basket card position now that
        // selectOrgExistingList wraps only the first card (~76 px tall)
        // instead of the whole heading + list block. The +270 vertical
        // budget covers the page chrome above the card: header (~54) +
        // "Créer un nouveau" CTA (~92) + section divider + "Paniers
        // existants" subtitle (~36) + "Ou choisissez un panier existant"
        // caption (~28). The host page still publishes a precise measured
        // rect; this is only what paints if that publish fails (unlikely
        // — the wait-for-measured-rect logic in SubScreenWalkthroughOverlay
        // holds the dim mask up to 1500 ms).
        target: { top: insetsTop + 270, left: 16, width: SCREEN_W_BIZ - 32, height: 76, radius: 12 },
        tooltipPosition: 'bottom',
        measureKey: 'selectOrgExistingList',
      });
    }
    // 1c. The "Créer un nouveau panier" CTA on the intermediary page → opens
    // the manual form. requireTap advances when the create-basket route loads.
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Plus,
      titleKey: 'walkthrough.biz.createNewBasket.title',
      descKey: 'walkthrough.biz.createNewBasket.desc',
      highlight: 'element',
      target: { top: insetsTop + 64, left: 16, width: SCREEN_W_BIZ - 32, height: 76, radius: 16 },
      tooltipPosition: 'bottom',
      requireTap: true,
      advanceOnPath: '/business/create-basket',
      measureKey: 'selectOrgCreateNew',
    });
    // 2. Daily reset card — Suivant (must come BEFORE the pickup-time step:
    // daily quantity is the field higher up the form, and the pickup-time
    // description references the profile defaults the user will see later)
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: ClipboardList,
      titleKey: 'walkthrough.biz.formReinit.title',
      descKey: 'walkthrough.biz.formReinit.desc',
      highlight: 'element',
      target: { top: 200, left: 16, width: SCREEN_W_BIZ - 32, height: 80, radius: 16 },
      tooltipPosition: 'bottom',
      measureKey: 'formDailyReset',
    });
    // 3. Pickup time card — Suivant. Rectangular halo (radius: 0) per
    // design request — the underlying "Heure de retrait" card on the form
    // Halo wraps the two TimePicker boxes (pickupCardRef now lives on
    // the time-pickers row, not the toggle below). Rounded radius so
    // the cutout matches the rest of the business demo's halos — the
    // earlier zero-radius value was tuned to the square-cornered
    // checkbox the ref USED to point at; now that the ref hugs the
    // rounded TimePicker row, the cutout needs the same rounded
    // corners as every other step.
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Clock,
      titleKey: 'walkthrough.biz.formPickup.title',
      descKey: 'walkthrough.biz.formPickup.desc',
      highlight: 'element',
      target: { top: 320, left: 16, width: SCREEN_W_BIZ - 32, height: 80, radius: 14 },
      tooltipPosition: 'bottom',
      measureKey: 'formPickupTime',
    });
    // 4. Confirm button — user taps for real, intercepted to skip backend.
    // `radius: 28` gives the cutout a pill shape that hugs the actual
    // (PrimaryCTAButton) button corners; the smaller value 14 left visible
    // corner-gap between the halo and the rounded button.
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Check,
      titleKey: 'walkthrough.biz.formConfirm.title',
      descKey: 'walkthrough.biz.formConfirm.desc',
      highlight: 'element',
      target: { bottom: 24, left: 16, width: SCREEN_W_BIZ - 32, height: 52, radius: 28 },
      tooltipPosition: 'top',
      requireTap: true,
      advanceOnPath: '/(business)/my-baskets',
      measureKey: 'formConfirmBtn',
    });
    } // end create-basket flow
    // 5. Demo basket card on list — Suivant. Shown for create OR quantity
    // members. When the create flow was skipped (quantity-only member) we
    // inject the demo basket here so there's a card to highlight and edit.
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: ShoppingBag,
      titleKey: 'walkthrough.biz.demoBasket.title',
      descKey: 'walkthrough.biz.demoBasket.desc',
      highlight: 'element',
      target: { top: insetsTop + 110, left: 16, width: SCREEN_W_BIZ - 32, height: 100, radius: 16 },
      tooltipPosition: 'bottom',
      measureKey: 'demoBasketCard',
      ...(canCreateDeleteBaskets ? {} : { enter: { demoBasket: true } }),
    });
    // ── Quantity-edit flow — ONLY for members who can edit quantities. A
    // create-only member sees the card above (step 5) then moves on to orders.
    if (canEditQuantities) {
    // 6. Quantity edit — prompt the user to TAP the demo card to open the
    // availability sheet (which has the +/- controls). Highlight the whole
    // card; advance when the detail modal opens (expandedDemoCard flag).
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Plus,
      titleKey: 'walkthrough.biz.basketQty.title',
      descKey: 'walkthrough.biz.basketQty.desc',
      highlight: 'element',
      target: { top: insetsTop + 110, left: 16, width: SCREEN_W_BIZ - 32, height: 100, radius: 16 },
      tooltipPosition: 'bottom',
      requireTap: true,
      tapTarget: 'card',
      advanceOnFlag: 'expand',
      measureKey: 'demoBasketCard',
    });
    // 6a-c. Sequential sub-steps INSIDE the availability modal. Native RN
    // Modal sits above the layout overlay, so the modal renders its own
    // halo border + inline tooltip for these steps. `highlight: 'inline-modal'`
    // tells the layout overlay to render nothing for them. Advance is driven
    // by the modal's onPress handlers (each calls `nextStep(999)` directly).
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Plus,
      titleKey: 'walkthrough.biz.modalMinus.title',
      descKey: 'walkthrough.biz.modalMinus.desc',
      highlight: 'inline-modal',
      requireTap: true,
      measureKey: 'modalQtyMinus',
    });
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Plus,
      titleKey: 'walkthrough.biz.modalPlus.title',
      descKey: 'walkthrough.biz.modalPlus.desc',
      highlight: 'inline-modal',
      requireTap: true,
      measureKey: 'modalQtyPlus',
    });
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Check,
      titleKey: 'walkthrough.biz.modalSave.title',
      descKey: 'walkthrough.biz.modalSave.desc',
      highlight: 'inline-modal',
      requireTap: true,
      measureKey: 'modalSave',
    });
    // 6d. After save — highlight the updated qty pill on the basket card.
    // Standard 'element' step with Next button (no requireTap, no advanceOn*).
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: ShoppingBag,
      titleKey: 'walkthrough.biz.basketCardQty.title',
      descKey: 'walkthrough.biz.basketCardQty.desc',
      highlight: 'element',
      target: { top: insetsTop + 110, left: 28, width: 60, height: 28, radius: 14 },
      tooltipPosition: 'bottom',
      measureKey: 'demoBasketCardQty',
    });
    } // end quantity-edit flow
  }
  // ── Orders — interactive sub-tour ────────────────────────────────────
  const ordersIdx = visibleTabs.indexOf('incoming-orders');
  if (ordersIdx >= 0) {
    // Orders tab intro — show the (empty) orders page first. No demo order
    // is injected yet so the user sees the page as it normally would after
    // a fresh login. They press Suivant to continue.
    steps.push({
      tabIndex: ordersIdx,
      routeName: 'incoming-orders',
      icon: ClipboardList,
      titleKey: 'walkthrough.biz.orders.title',
      descKey: 'walkthrough.biz.orders.desc',
      highlight: 'tab',
    });
    // Order arrives — flip demoOrderActive on so the injected demo order +
    // the in-app notification popup appear. The popup is the surface that
    // advances the demo (tap "Voir la commande"), so this step uses
    // `inline-modal` to let the popup own the screen.
    steps.push({
      tabIndex: ordersIdx,
      routeName: 'incoming-orders',
      icon: ClipboardList,
      titleKey: 'walkthrough.biz.orderArrives.title',
      descKey: 'walkthrough.biz.orderArrives.desc',
      highlight: 'inline-modal',
      measureKey: 'orderArrives',
      enter: { demoOrder: true },
    });
    // Demo order card — user taps to expand
    steps.push({
      tabIndex: ordersIdx,
      routeName: 'incoming-orders',
      icon: ClipboardList,
      titleKey: 'walkthrough.biz.orderCard.title',
      descKey: 'walkthrough.biz.orderCard.desc',
      highlight: 'element',
      target: { top: insetsTop + 110, left: 16, width: SCREEN_W_BIZ - 32, height: 100, radius: 16 },
      tooltipPosition: 'bottom',
      requireTap: true,
      tapTarget: 'card',
      advanceOnFlag: 'expand',
      measureKey: 'demoOrderCard',
    });
    // Chat button — only if user can message. Tapping it navigates to the
    // message screen; the demo's chat-screen step then prompts the user to
    // tap back to return.
    if (canMessage) {
      steps.push({
        tabIndex: ordersIdx,
        routeName: 'incoming-orders',
        icon: MessageCircle,
        titleKey: 'walkthrough.biz.orderChat.title',
        descKey: 'walkthrough.biz.orderChat.desc',
        highlight: 'element',
        target: { top: insetsTop + 130, left: SCREEN_W_BIZ - 80, width: 32, height: 32, radius: 16 },
        tooltipPosition: 'bottom',
        requireTap: true,
        advanceOnPath: '/message/',
        measureKey: 'orderCardChat',
      });
      // Chat screen — prompts user to tap the back arrow to return.
      // `inline-modal` so the layout overlay renders nothing here; the
      // chat screen renders its own walkthrough tooltip.
      steps.push({
        tabIndex: ordersIdx,
        routeName: 'incoming-orders',
        icon: MessageCircle,
        titleKey: 'walkthrough.biz.chatBack.title',
        descKey: 'walkthrough.biz.chatBack.desc',
        highlight: 'inline-modal',
        measureKey: 'chatBack',
      });
    }
    // Per-card "Confirmer" button — opens Verify Pickup modal
    if (canConfirmPickup) {
      steps.push({
        tabIndex: ordersIdx,
        routeName: 'incoming-orders',
        icon: CheckCircle,
        titleKey: 'walkthrough.biz.orderConfirm.title',
        descKey: 'walkthrough.biz.orderConfirm.desc',
        highlight: 'element',
        target: { top: insetsTop + 280, left: 24, width: SCREEN_W_BIZ / 2 - 32, height: 40, radius: 12 },
        tooltipPosition: 'top',
        requireTap: true,
        advanceOnFlag: 'modal',
        measureKey: 'orderCardConfirmBtn',
      });
      // Verify Pickup modal — explain the code input. The user can either
      // type the example code (DEMO1) and confirm to trigger the demo
      // success flow, or just press Suivant on the walkthrough tooltip to
      // skip ahead. `inline-modal` highlight tells the layout overlay to
      // render null for this step; the verify modal renders its own tooltip
      // card so it sits above the modal sheet.
      steps.push({
        tabIndex: ordersIdx,
        routeName: 'incoming-orders',
        icon: CheckCircle,
        titleKey: 'walkthrough.biz.verifyInput.title',
        descKey: 'walkthrough.biz.verifyInput.desc',
        highlight: 'inline-modal',
        measureKey: 'verifyModalInput',
      });
      // QR scanner FAB shortcut — bottom-right of the orders screen. Tap
      // the FAB to navigate to /business/scan-qr; the next step renders an
      // instruction popup there and advances when the user comes back.
      // Auto-closes the verify modal on step entry so the FAB underneath
      // is reachable. `demoOrder: false` clears the injected demo order
      // from the list — by this point the user has "confirmed pickup", so
      // the order has logically moved out of the incoming tab.
      steps.push({
        tabIndex: ordersIdx,
        routeName: 'incoming-orders',
        icon: QrCode,
        titleKey: 'walkthrough.biz.qrFab.title',
        descKey: 'walkthrough.biz.qrFab.desc',
        highlight: 'element',
        target: { bottom: 100, right: 24, width: 56, height: 56, radius: 28 },
        tooltipPosition: 'top',
        requireTap: true,
        advanceOnPath: '/business/scan-qr',
        measureKey: 'qrFab',
        enter: { demoOrder: false },
      });
      // On the scan-qr screen — prompt the user to tap back to return.
      // `inline-modal` so the layout overlay renders nothing here; the
      // scan-qr screen renders its own walkthrough instruction popup.
      steps.push({
        tabIndex: ordersIdx,
        routeName: 'incoming-orders',
        icon: QrCode,
        titleKey: 'walkthrough.biz.scanQrBack.title',
        descKey: 'walkthrough.biz.scanQrBack.desc',
        highlight: 'inline-modal',
        measureKey: 'scanQrBack',
      });
    }
  }
  // ── Profile — gestion d'équipe + infos commerce ───────────────────────
  const profileIdx = visibleTabs.indexOf('business-profile');
  if (profileIdx >= 0 && canEditProfile) {
    // This step's glyph mirrors the tab's icon, so when the tab uses
    // Store the walkthrough hint card uses Store too. The OTHER
    // profile-section steps below stay on User / Building2 because
    // they specifically reference team-members / org info.
    // Defensive `demoOrder: false` cleanup: the orders sub-tour normally
    // clears the injected demo order on its qrFab step, but that step is
    // gated on `canConfirmPickup`. A user role that has chat (canMessage)
    // but NOT confirm-pickup would skip qrFab and arrive here with the
    // demo order still injected on the (background) incoming-orders tab.
    // Re-clearing on profile-tab entry guarantees the orders tab is clean
    // before the user navigates back to it from profile/settings.
    steps.push({ tabIndex: profileIdx, routeName: 'business-profile', icon: Store, titleKey: 'walkthrough.biz.profile.title', descKey: 'walkthrough.biz.profile.desc', highlight: 'tab', enter: { demoOrder: false } });
    // Infos commerce comes BEFORE the team tour. That way the team tour
    // can navigate into /business/team and continue to the settings hand-
    // off without needing to pop back to /business/profile mid-demo.
    steps.push({
      tabIndex: profileIdx,
      routeName: 'business-profile',
      icon: Building2,
      titleKey: 'walkthrough.biz.profileInfo.title',
      descKey: 'walkthrough.biz.profileInfo.desc',
      highlight: 'element',
      target: { top: insetsTop + 320, left: 16, width: SCREEN_W_BIZ - 32, height: 100, radius: 16 },
      tooltipPosition: 'bottom',
      measureKey: 'profileBusinessInfo',
    });
    // Gestion d'équipe — every admin (org OR location). Tap the team card
    // on the profile page to navigate to /business/team. The sub-screen
    // overlay there renders the team-page steps on top of that pushed
    // screen. Location admins get a SCOPED version of the team tour:
    // they see the org/location info card at the top and the members
    // list of their location, but the locations-section step is skipped
    // because location admins don't manage locations across the org.
    if (isOrgAdmin || isLocationAdmin) {
      steps.push({
        tabIndex: profileIdx,
        routeName: 'business-profile',
        icon: User,
        titleKey: 'walkthrough.biz.profileTeam.title',
        descKey: 'walkthrough.biz.profileTeam.desc',
        highlight: 'element',
        target: { top: insetsTop + 200, left: 16, width: SCREEN_W_BIZ - 32, height: 80, radius: 16 },
        tooltipPosition: 'bottom',
        requireTap: true,
        tapTarget: 'card',
        advanceOnPath: '/business/team',
        measureKey: 'profileTeamCard',
      });
      // Org info / stats card at the top of the team page. `target.radius`
      // matches the green banner's borderRadius (theme.radii.r16 = 16) so
      // the halo's rounded corners follow the card's actual shape.
      steps.push({
        tabIndex: profileIdx,
        routeName: 'business-profile',
        icon: Building2,
        titleKey: 'walkthrough.biz.teamOrg.title',
        descKey: 'walkthrough.biz.teamOrg.desc',
        highlight: 'element',
        target: { radius: 16 },
        tooltipPosition: 'bottom',
        measureKey: 'teamOrgCard',
      });
      // Locations list — ORG ADMINS ONLY. Location admins are scoped to
      // their own location and don't manage the org-wide locations list,
      // so highlighting "your points of vente" reads as misleading. They
      // skip straight from the org/info card to the members list.
      if (isOrgAdmin) {
        steps.push({
          tabIndex: profileIdx,
          routeName: 'business-profile',
          icon: MapPin,
          titleKey: 'walkthrough.biz.teamLocations.title',
          descKey: 'walkthrough.biz.teamLocations.desc',
          highlight: 'element',
          target: { radius: 16 },
          tooltipPosition: 'bottom',
          measureKey: 'teamLocationsSection',
        });
      }
      // Members list — preview step. Highlights the whole members section
      // so the user sees the full list. The follow-up "+ add member" step
      // was also removed for the same reason as above (navigating into the
      // add-member flow during the demo risks side-effects).
      steps.push({
        tabIndex: profileIdx,
        routeName: 'business-profile',
        icon: User,
        titleKey: 'walkthrough.biz.teamMembers.title',
        descKey: 'walkthrough.biz.teamMembers.desc',
        highlight: 'element',
        target: { radius: 16 },
        tooltipPosition: 'top',
        measureKey: 'teamMembersSection',
      });
    }
  }
  // Settings hand-off (final)
  steps.push({
    tabIndex: 0,
    routeName: 'dashboard',
    icon: Settings,
    titleKey: 'walkthrough.biz.settingsDemo.title',
    descKey: 'walkthrough.biz.settingsDemo.desc',
    highlight: 'element',
    isSettings: true,
  });
  return steps;
}

// SVG path: full screen rectangle plus an inner rounded-rectangle hole drawn
// with the opposite winding so even-odd fill renders the dim area minus a
// perfect rounded cutout (no rectangle-with-rounded-border mismatch).
function buildCutoutPath(sw: number, sh: number, x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (w <= 0 || h <= 0) return `M0 0 H${sw} V${sh} H0 Z`;
  const x2 = x + w;
  const y2 = y + h;
  return [
    `M0 0 H${sw} V${sh} H0 Z`,
    `M${x + radius} ${y}`,
    `H${x2 - radius}`,
    `A${radius} ${radius} 0 0 1 ${x2} ${y + radius}`,
    `V${y2 - radius}`,
    `A${radius} ${radius} 0 0 1 ${x2 - radius} ${y2}`,
    `H${x + radius}`,
    `A${radius} ${radius} 0 0 1 ${x} ${y2 - radius}`,
    `V${y + radius}`,
    `A${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    'Z',
  ].join(' ');
}

// Cutout mask backed by SVG so the dim region follows the rounded highlight
// shape exactly. The SVG itself is non-interactive; four absorber frames
// arranged around the cutout rect (top / bottom / left / right) catch any
// tap outside the cutout so the user can't accidentally hit unrelated
// surfaces (tab bar pills, FAB, header back, etc.) and auto-quit the demo.
// The cutout area has no absorber, so taps fall through to the highlighted
// element. If `onOutsidePress` is provided (tab steps), the frame taps call
// it — preserves the "tap anywhere to advance the demo" UX. Otherwise the
// frame taps are absorbed silently (no-op).
function CutoutMask({ x, y, w, h, radius = 0, onOutsidePress, sw, sh }: { x: number; y: number; w: number; h: number; radius?: number; onOutsidePress?: () => void; sw: number; sh: number }) {
  const d = buildCutoutPath(sw, sh, x, y, w, h, radius);
  // Clamp the cutout rect so the four frames don't get negative widths /
  // heights when the highlight is near a screen edge.
  const cx = Math.max(0, x);
  const cy = Math.max(0, y);
  const cw = Math.max(0, Math.min(w, sw - cx));
  const ch = Math.max(0, Math.min(h, sh - cy));
  const Frame = ({ style }: { style: any }) => (
    onOutsidePress
      ? <TouchableOpacity activeOpacity={1} onPress={onOutsidePress} style={style} />
      : <View
          style={style}
          onStartShouldSetResponder={() => true}
          onResponderRelease={() => { /* absorb silently — the hint toast
              only fires for taps on actual blocked buttons (per-button
              gates), not for taps on empty dim space. */ }}
        />
  );
  return (
    <View style={StyleSheet.absoluteFillObject}>
      {/* Visual dim — non-interactive. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <Svg width={sw} height={sh} style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Path d={d} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
        </Svg>
      </View>
      {/* Tap absorbers around the cutout. */}
      <Frame style={{ position: 'absolute', left: 0, right: 0, top: 0, height: cy }} />
      <Frame style={{ position: 'absolute', left: 0, right: 0, top: cy + ch, bottom: 0 }} />
      <Frame style={{ position: 'absolute', top: cy, height: ch, left: 0, width: cx }} />
      <Frame style={{ position: 'absolute', top: cy, height: ch, left: cx + cw, right: 0 }} />
    </View>
  );
}

function BusinessWalkthroughOverlay({ navRef, tabWidth, theme, t, visibleTabs, canCreateDeleteBaskets, canEditQuantities, canEditProfile, canConfirmPickup, canMessage, isOrgAdmin, isLocationAdmin, hasNoLocation, insetsTop, insetsBottom, router }: { navRef: any; tabWidth: number; theme: any; t: any; visibleTabs: string[]; canCreateDeleteBaskets: boolean; canEditQuantities: boolean; canEditProfile: boolean; canConfirmPickup: boolean; canMessage: boolean; isOrgAdmin: boolean; isLocationAdmin: boolean; hasNoLocation: boolean; insetsTop: number; insetsBottom: number; router: any }) {
  // Live dimensions — recompute on every window-size change (rotation,
  // system-bar visibility changes, foldable hinge). The tab pill is
  // positioned `bottom: 20` from the live window bottom, so the tab halo
  // and the full-window dim mask both have to be computed against the
  // same live values to stay aligned on tall devices like the Pixel 6.
  const { width: SCREEN_W_LIVE, height: SCREEN_H_LIVE } = useWindowDimensions();
  // Self-measure where this overlay's root sits in window coordinates. The
  // halo + tooltip code below renders inside a wrapper that's translated by
  // (-originX, -originY), so its (0, 0) coincides with absolute window (0, 0).
  // That means `measureInWindow`-published rect coords can be used directly
  // for `top:` / `left:` — no per-device guesswork (Samsung edge-to-edge vs
  // Pixel 6 vs iOS) for status-bar offsets.
  // Pre-seed the origin offset with insetsTop so the first paint of the
  // overlay already lands at the correct vertical origin. See the
  // useOverlayOriginOffset hook + the matching call in the customer overlay
  // for the rationale — without this, the first frame after the demo welcome
  // cover dismisses snaps up by insetsTop pixels once the async measurement
  // returns.
  const { originRef, originX, originY, originMeasured, remeasure: remeasureOrigin } = useOverlayOriginOffset({ y: insetsTop });
  const BIZ_WALKTHROUGH_STEPS = React.useMemo(() => buildWalkthroughSteps(visibleTabs, canCreateDeleteBaskets, canEditQuantities, canEditProfile, canConfirmPickup, canMessage, isOrgAdmin, isLocationAdmin, hasNoLocation, insetsTop, SCREEN_W_LIVE), [visibleTabs, canCreateDeleteBaskets, canEditQuantities, canEditProfile, canConfirmPickup, canMessage, isOrgAdmin, isLocationAdmin, hasNoLocation, insetsTop, SCREEN_W_LIVE]);
  const step = useWalkthroughStore((s) => s.step);
  const nextStep = useWalkthroughStore((s) => s.nextStep);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  const setShowSettingsOverlay = useWalkthroughStore((s) => s.setShowSettingsOverlay);
  const measuredRects = useWalkthroughStore((s) => s.measuredRects);
  const setDemoBasketActive = useWalkthroughStore((s) => s.setDemoBasketActive);
  const setDemoOrderActive = useWalkthroughStore((s) => s.setDemoOrderActive);
  const setDemoScanCode = useWalkthroughStore((s) => s.setDemoScanCode);
  const verifyModalOpen = useWalkthroughStore((s) => s.verifyModalOpen);
  const expandedDemoCard = useWalkthroughStore((s) => s.expandedDemoCard);
  const setExpandedDemoCardFlag = useWalkthroughStore((s) => s.setExpandedDemoCard);
  const setVerifyModalOpenFlag = useWalkthroughStore((s) => s.setVerifyModalOpen);
  const setCurrentStep = useWalkthroughStore((s) => s.setCurrentStep);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const segments = useSegments();
  const pathname = '/' + (segments as string[]).join('/');

  // Track whether the overlay is already faded in. We only run the
  // 0→1 fade on the FIRST step (or when the walkthrough is re-entered
  // from null), not between adjacent step transitions. Resetting to 0
  // on every step change made the entire overlay snap to invisible
  // each tap, then fade back in over 300 ms — combined with the
  // tab-navigation slide it read as "not smooth at all". Now the dim
  // mask stays at opacity 1 and only the cutout/tooltip positions
  // change between steps.
  const fadeInDoneRef = React.useRef(false);
  // Halo settling: hide the halo + tooltip for a short window after a step
  // change so any pending scrollTo / measureInWindow updates land BEFORE we
  // paint. Without this, the overlay reads the previous step's cached rect
  // (or an initial onLayout rect that gets overwritten once data finishes
  // loading), draws the halo there, then snaps to the corrected position —
  // visible to the user as jitter. The dim mask still appears immediately
  // so the demo never feels frozen during the wait.
  const [haloReady, setHaloReady] = React.useState(false);
  // Measured tooltip height — drives the on-screen clamp so the card always
  // fits. Reset to 0 on every step so each step's content re-measures.
  const [ttHeight, setTtHeight] = React.useState(0);
  // Per-step content fade — the halo ring + tooltip fade in once the rect has
  // settled (haloReady) so step-to-step transitions glide instead of popping.
  const contentAnim = React.useRef(new Animated.Value(0)).current;
  // `displayedStep` is the step the overlay is RENDERING right now. `step`
  // (from the store) is the TARGET. They diverge briefly during a step
  // transition: when the user advances, we animate contentAnim 1→0 first
  // so the previous step's halo / tooltip / cutout-reveal fade out at
  // their CURRENT position, THEN we swap displayedStep to the target and
  // fade back in at the new position. Without this two-phase commit the
  // cutout rectangle's position would change the same instant `step`
  // updated — producing the visible "snap" the user reported between
  // steps. The dim mask itself stays at opacity 1 throughout so the
  // background never flashes bright.
  const [displayedStep, setDisplayedStep] = React.useState<number | null>(null);
  const activeStepMeasureKey = displayedStep !== null ? BIZ_WALKTHROUGH_STEPS[displayedStep]?.measureKey : null;
  // Subscribe to THIS step's measured rect so we can flip haloReady the
  // moment the host page publishes a rect — instead of timing out blindly
  // and snapping later from the fallback. Used by the no-snap effect below.
  const activeStepMeasuredRect = useWalkthroughStore((s) =>
    activeStepMeasureKey ? s.measuredRects[activeStepMeasureKey] : null,
  );

  // Effect 1 — target step transition. On a step change, smoothly fade out
  // the current displayed step, then swap displayedStep to the new target.
  // First entry (displayedStep === null) skips the fade-out because there's
  // nothing to fade out from.
  //
  // Safety net: previously this relied SOLELY on the Animated.timing
  // `finished: true` callback to commit the displayedStep swap. When two
  // step transitions happened in quick succession (or some other animation
  // ran on `contentAnim` mid-fade), the first timing's callback fired with
  // `finished: false` and the swap was SKIPPED — `displayedStep` stayed
  // behind, `haloReady` never reset, and the overlay rendered the
  // PREVIOUS step's halo / tooltip indefinitely (or nothing if the
  // previous step was inline-modal). That's exactly the "tooltip fails to
  // show, screen doesn't fade, doesn't advance" intermittent symptom the
  // user reported. Use a parallel setTimeout as the floor: whichever
  // fires first (the animation's done callback OR the 220 ms timer) wins.
  // Even if Animated.timing is hijacked, the timer guarantees the swap.
  React.useEffect(() => {
    if (step === displayedStep) return;
    if (displayedStep === null) {
      // Fresh entry — show the target step immediately. The normal fade-in
      // happens via Effect 3 once the rect settles.
      setDisplayedStep(step);
      return;
    }
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      setHaloReady(false);
      setDisplayedStep(step);
    };
    const timer = setTimeout(commit, 220);
    Animated.timing(contentAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      commit();
    });
    return () => clearTimeout(timer);
  }, [step, displayedStep, contentAnim]);

  // Effect 2 — displayedStep settled. Reset halo state and wait for the
  // new step's rect to land (or for a fixed-position step, fire on the
  // next frame).
  React.useEffect(() => {
    if (displayedStep === null) { setHaloReady(false); contentAnim.setValue(0); return; }
    setTtHeight(0);
    setHaloReady(false);
    // Steps that highlight a fixed-position element (e.g. tab pills) don't
    // need any host measurement — they paint from the step's `target` rect.
    // For those we flip haloReady immediately on the next frame so the
    // halo glides in without the previous timer-based 260 ms wait.
    if (!activeStepMeasureKey) {
      const raf = requestAnimationFrame(() => setHaloReady(true));
      return () => cancelAnimationFrame(raf);
    }
    // Element steps — wait for the host to publish a measured rect. If we
    // already have one (re-entering the step), fire on the next frame.
    if (activeStepMeasuredRect) {
      const raf = requestAnimationFrame(() => setHaloReady(true));
      return () => cancelAnimationFrame(raf);
    }
    // Not measured yet → hold the dim mask up to 1500 ms while we wait.
    // The effect re-fires when `activeStepMeasuredRect` flips non-null
    // (see the deps below), so as soon as the rect lands we paint
    // immediately. The timeout is the safety net for steps whose host
    // never publishes (e.g. the page declined for this key).
    const t = setTimeout(() => setHaloReady(true), 1500);
    return () => clearTimeout(t);
  }, [displayedStep, BIZ_WALKTHROUGH_STEPS, activeStepMeasureKey, !!activeStepMeasuredRect, contentAnim]);

  // Effect 3 — once the new rect is ready, fade the content back in.
  // Longer duration (260 ms) than the fade-out (180 ms) so the new step
  // emerges with a gentler easing — feels less like a hard cut.
  //
  // Safety net: if the fade-in is interrupted (another animation hijacks
  // contentAnim), the timing callback fires with `finished: false` and
  // contentAnim might be stuck somewhere between 0 and 1 — leaving the
  // halo + tooltip partially visible / invisible. A 320 ms fallback
  // setValue(1) ensures it always lands at 1 even if the animation never
  // gets to.
  React.useEffect(() => {
    if (!haloReady) return;
    const timer = setTimeout(() => contentAnim.setValue(1), 320);
    Animated.timing(contentAnim, { toValue: 1, duration: 260, useNativeDriver: true }).start(({ finished }) => {
      if (finished) clearTimeout(timer);
    });
    return () => clearTimeout(timer);
  }, [haloReady, contentAnim]);
  React.useEffect(() => {
    if (step !== null) {
      if (!fadeInDoneRef.current) {
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
        fadeInDoneRef.current = true;
      }
      const s = BIZ_WALKTHROUGH_STEPS[step];
      // Reset advance flags between steps — a flag flipped during the
      // previous step would otherwise auto-advance the next step that uses
      // the same `advanceOnFlag`. Reset only happens on step ENTRY so the
      // step's own user-triggered flag flip still works.
      setExpandedDemoCardFlag(false);
      setVerifyModalOpenFlag(false);
      // Apply this step's enter effects (demo flag setters). These persist
      // until cleared explicitly — typical pattern is: step N sets demoBasket,
      // step N+K (after the basket flow ends) sets demoBasket back to false.
      if (s?.enter) {
        if (s.enter.demoBasket !== undefined) setDemoBasketActive(s.enter.demoBasket);
        if (s.enter.demoOrder !== undefined) setDemoOrderActive(s.enter.demoOrder);
        if (s.enter.demoScanCode !== undefined) setDemoScanCode(s.enter.demoScanCode);
      }
      // NOTE: do NOT blanket-invalidate measuredRects[s.measureKey] here.
      // Many element steps target already-rendered surfaces (Add Basket
      // button on my-baskets, demo basket card, profile cards, …). Those
      // elements only fire onLayout once at mount — wiping their rect now
      // would strand the overlay in dim-only mode forever because nothing
      // ever re-publishes. Cross-run pollution is already handled by
      // `startWalkthrough` clearing measuredRects; the create-basket form
      // fields that need re-measurement after auto-scroll self-invalidate
      // inside their effect (see create-basket.tsx:252).
      // Publish step metadata so SubScreenWalkthroughOverlay (mounted on
      // pushed Stack screens like /business/create-basket) can render this
      // step's highlight when the user is above the tabs.
      if (s?.measureKey) {
        // Forward the step's positional `target` to the store too — without
        // this, sub-screens that *can't* publish a measured rect (e.g.
        // /business/select-org-basket's "existing baskets" list when the
        // org has none, so the View is never rendered and its ref stays
        // null) would render only the dim mask with no tooltip / Suivant,
        // leaving the user stuck. With the target propagated, the overlay
        // falls back to the step's hard-coded rect and the demo continues.
        // BizStep.target carries a `size` helper that the store shape
        // doesn't know about — map it onto width/height so the sub-screen
        // overlay can use the same rect math as the layout-level one.
        const target = s.target ? {
          top: s.target.top,
          bottom: s.target.bottom,
          left: s.target.left,
          right: s.target.right,
          width: s.target.width ?? s.target.size,
          height: s.target.height ?? s.target.size,
          radius: s.target.radius,
        } : undefined;
        setCurrentStep({
          measureKey: s.measureKey,
          titleKey: s.titleKey,
          descKey: s.descKey,
          tooltipPosition: s.tooltipPosition,
          isLast: step === BIZ_WALKTHROUGH_STEPS.length - 1,
          stepIndex: step,
          totalSteps: BIZ_WALKTHROUGH_STEPS.length,
          requireTap: !!s.requireTap,
          tapTarget: s.tapTarget,
          // Pass the step's target radius through so SubScreenWalkthroughOverlay
          // can match it (it previously hardcoded 18, which mismatched
          // pill-shaped buttons like the create-basket confirm CTA).
          radius: s.target?.radius,
          target,
        });
      } else {
        setCurrentStep(null);
      }
      // Settings hand-off: push /settings once, mark the overlay flag, and
      // return. The settings screen renders its own cutout overlay.
      //
      // Before the push we drop any pushed sub-screen the prior step left
      // behind (typically /business/team after the team sub-tour) by
      // router.replace-ing to /(business)/dashboard, AND we point the tabs
      // navigator at the dashboard tab. That way the back button from
      // /settings pops to the dashboard — same as when the user reaches
      // settings through the normal gear-icon path — instead of stranding
      // them on /business/team with no UI cue to leave it.
      if (s?.isSettings) {
        setShowSettingsOverlay(true);
        try {
          // Point the tabs nav at the dashboard FIRST so the (business)
          // group sitting underneath /settings has the right tab selected
          // for when the user backs out.
          try { navRef.current?.navigate('dashboard'); } catch {}
          // ONE navigation operation, not two — the previous version
          // dispatched router.replace('/(business)/dashboard') AND
          // router.push('/settings') in the same tick, which raced inside
          // Expo Router and could end up with /settings push being
          // discarded by the in-flight replace. The user-visible symptom
          // was the Next button on the team-management last step
          // "skipping" the settings overlay entirely and landing the user
          // on /(tabs)/ — the customer search home — because the demo-end
          // route correction kicked in with no /settings screen to anchor
          // against. Use replace from sub-screens (pops /business/team
          // cleanly) and push from tabs (keeps the (business) layout in
          // the back-stack so dismissing /settings returns to dashboard).
          const onSubScreen = pathname.startsWith('/business/');
          if (onSubScreen) {
            router.replace('/settings' as never);
          } else {
            router.push('/settings' as never);
          }
        } catch {}
        return;
      }
      if (s?.routeName && navRef.current) {
        const onSubScreen = pathname.startsWith('/business/') || pathname.startsWith('/settings');
        if (s.highlight === 'tab') {
          // Tab step: pop any pushed sub-screen via router.replace (the
          // REPLACE action is always handled by the Stack — avoids the
          // GO_BACK / POP_TO_TOP dev warnings) and switch tabs.
          if (onSubScreen && !s.isSettings) {
            try { router.replace(`/(business)/${s.routeName}` as never); } catch {}
          }
          // Always also tell the Tabs navigator to switch tabs. The Tabs
          // sit underneath any pushed Stack screen, so this is harmless —
          // and it covers the case where router.replace silently failed
          // (which left the demo stuck on the orders/scan-qr tab after the
          // scanQrBack step advanced, with no profile-tour steps showing).
          try { navRef.current.navigate(s.routeName); } catch {}
        }
        // Element steps: do NOT navigate. The user has either just landed on
        // a pushed sub-screen (e.g. /business/create-basket after tapping
        // Add Basket) or is still on the previous tab. Calling navRef.navigate
        // here would pop the freshly-pushed screen, which is exactly the bug
        // that was preventing the create-basket form from staying open.
      }
    } else {
      // Walkthrough ended — make sure settings overlay is cleared too.
      setShowSettingsOverlay(false);
      // Allow the fade-in to play again next time the walkthrough starts.
      fadeInDoneRef.current = false;
    }
  }, [step]);

  // Auto-advance when the user navigates to the path specified on the
  // current step — i.e., they actually tapped the real button through the
  // cutout. This is what makes `requireTap` steps "advance on interaction".
  React.useEffect(() => {
    if (step === null) return;
    const s = BIZ_WALKTHROUGH_STEPS[step];
    if (s?.advanceOnPath && pathname.startsWith(s.advanceOnPath)) {
      nextStep(BIZ_WALKTHROUGH_STEPS.length);
    }
  }, [pathname, step, BIZ_WALKTHROUGH_STEPS, nextStep]);

  // Safety net for sub-screen "tap back" steps: if the user has left the
  // expected sub-screen but the walkthrough is still on the corresponding
  // inline-modal step, advance. The sub-screen's own unmount-cleanup
  // already calls nextStep in the happy path; this is the belt-and-
  // suspenders so the demo can never strand the user on the orders tab
  // with no overlay UI to recover from.
  //
  // Defer by ~80 ms so the sub-screen's unmount cleanup (which fires
  // SYNCHRONOUSLY during React's unmount commit) lands first and
  // advances `step` — which causes this effect to re-run with a fresh
  // step where `measureKey` no longer matches, making the safety net a
  // no-op in the happy path. Without this defer, BOTH paths fire on the
  // same React tick (the unmount cleanup updates the store but the
  // currentStep reflector in BizOverlay's [step] effect hasn't run
  // yet, so this effect still sees the old measureKey) — step advances
  // TWICE, and on a step list whose total happens to align with that
  // double advance, the second call ends the walkthrough via the
  // clearDemoState branch in nextStep. That's the "scan-qr → Next
  // cleared the demo" symptom.
  React.useEffect(() => {
    if (step === null) return;
    const s = BIZ_WALKTHROUGH_STEPS[step];
    const mk = s?.measureKey;
    if (mk !== 'scanQrBack' && mk !== 'chatBack') return;
    const timer = setTimeout(() => {
      const latestStep = useWalkthroughStore.getState().step;
      if (latestStep === null) return;
      const latestS = BIZ_WALKTHROUGH_STEPS[latestStep];
      const latestMk = latestS?.measureKey;
      if (latestMk === 'scanQrBack' && !pathname.startsWith('/business/scan-qr')) {
        nextStep(BIZ_WALKTHROUGH_STEPS.length);
      } else if (latestMk === 'chatBack' && !pathname.startsWith('/message')) {
        nextStep(BIZ_WALKTHROUGH_STEPS.length);
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [pathname, step, BIZ_WALKTHROUGH_STEPS, nextStep]);

  // Hardware-back interceptor: while the walkthrough is active, the only
  // legitimate exit is the "Quitter la démo" / "OK, terminer la démo" button
  // in the tooltip. Android's hardware back (or gesture-back) used to pop
  // the navigation stack out from under the walkthrough — that left the
  // demo basket / order injected on screens the demo didn't expect, and the
  // user had no way to fully clean up without restarting.
  // Returning true from the listener consumes the event so the navigator
  // never sees it. The listener self-removes once `step` returns to null
  // (after the user taps Quit, which calls skipWalkthrough → clearDemoState).
  React.useEffect(() => {
    if (step === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [step]);

  // Auto-advance when a watched store flag flips true. Used for steps that
  // wait on the user to expand the demo card or open the verify modal.
  React.useEffect(() => {
    if (step === null) return;
    const s = BIZ_WALKTHROUGH_STEPS[step];
    if (s?.advanceOnFlag === 'expand' && expandedDemoCard) {
      nextStep(BIZ_WALKTHROUGH_STEPS.length);
    } else if (s?.advanceOnFlag === 'modal' && verifyModalOpen) {
      nextStep(BIZ_WALKTHROUGH_STEPS.length);
    }
  }, [step, expandedDemoCard, verifyModalOpen, BIZ_WALKTHROUGH_STEPS, nextStep]);

  // Render based on the DISPLAYED step (the one currently faded-in or
  // mid-transition), not the TARGET `step`. This is what keeps the
  // cutout / halo / tooltip stable during the 180 ms fade-out: the user
  // sees the previous step's content fade gracefully, the swap happens
  // while contentAnim ≈ 0, then the new step's content fades in.
  if (displayedStep === null) return null;
  const current = BIZ_WALKTHROUGH_STEPS[displayedStep];
  if (!current) return null;
  // Settings step — the settings screen renders its own overlay.
  if (current.isSettings) return null;
  // Inline-modal steps — the React Native Modal sits above the walkthrough
  // overlay's zIndex, so the modal renders its own halo + inline tooltip
  // for these steps. Return null so the layout overlay doesn't fight the
  // modal with its own dim mask.
  if (current.highlight === 'inline-modal') return null;

  const StepIcon = current.icon;
  const isLast = displayedStep === BIZ_WALKTHROUGH_STEPS.length - 1;
  const tabBarLeft = 32;

  // Compute the cutout rectangle (x, y, w, h) in screen coordinates, plus
  // the tooltip/arrow position.
  let rectX = 0, rectY = 0, rectW = 0, rectH = 0, rectRadius = 16;
  let tooltipStyle: any;
  let arrowStyle: any;

  if (current.highlight === 'element' && (current.target || current.measureKey)) {
    const t2 = current.target;
    // Prefer the measured rect — it's accurate across devices / header
    // heights. If a step declares a measureKey, the measured rect is the
    // ONLY source of truth: don't fall back to a hardcoded target, because
    // a stale fallback put the cutout on the bottom navbar (the demoBasket
    // race). Render nothing until the host screen publishes the rect.
    const measured = current.measureKey ? (measuredRects[current.measureKey] ?? null) : null;
    if (current.measureKey && (!measured || !haloReady || !originMeasured)) {
      // Wait for the measurement (and the post-step-change settling window)
      // — render only the dim mask in the meantime so we don't paint a
      // misplaced halo / off-screen tooltip that then snaps into place.
      return (
        <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }} onLayout={remeasureOrigin}>
          {/* Measure the overlay origin DURING the settle so the halo's first
              visible frame (once haloReady flips) is already positioned with the
              correct origin — no wrong-place-then-snap. Mirrors SubScreen. */}
          <View ref={originRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
          {/* Extend the dim past the window edges so the status bar / nav bar
              area is covered on Samsung edge-to-edge (where the window doesn't
              start at the physical top). Mirrors the customer/SubScreen dim. */}
          <View pointerEvents="none" style={{ position: 'absolute', top: -insetsTop - 100, left: 0, right: 0, bottom: -insetsBottom - 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        </Animated.View>
      );
    }
    const w = measured ? measured.w : (t2?.width ?? t2?.size ?? 44);
    const h = measured ? measured.h : (t2?.height ?? t2?.size ?? 44);
    const cx = measured ? measured.x + w / 2 :
      (t2?.right != null ? SCREEN_W_LIVE - t2.right - w / 2 : (t2?.left ?? 0) + w / 2);
    const cy = measured ? measured.y + h / 2 :
      (t2?.bottom != null ? SCREEN_H_LIVE - t2.bottom - h / 2 : (t2?.top ?? 0) + h / 2);
    // Expand by 6px for a visible breathing room around the element.
    rectX = cx - w / 2 - 6;
    rectY = cy - h / 2 - 6;
    rectW = w + 12;
    rectH = h + 12;
    rectRadius = (t2?.radius ?? 12) + 6;

  } else {
    // Tab highlight — use the MEASURED floating tab-bar rect (window coords)
    // so the halo sits exactly on the pill, device-independently. No
    // inset/`bottom:20` guesswork (the old formula subtracted insetsBottom and
    // floated the halo above the real pill on home-indicator devices). Render
    // the dim-only mask until the bar is measured + settled to avoid a flash.
    const bar = measuredRects['bizTabBar'] ?? null;
    if (!bar || !haloReady || !originMeasured) {
      return (
        <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }} onLayout={remeasureOrigin}>
          {/* Measure origin during the settle (see element-branch note above). */}
          <View ref={originRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
          {/* Edge-extended dim — covers status bar / nav bar on Samsung edge-to-edge. */}
          <View pointerEvents="none" style={{ position: 'absolute', top: -insetsTop - 100, left: 0, right: 0, bottom: -insetsBottom - 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        </Animated.View>
      );
    }
    // Glass pill: 52px tall, vertically centered in the 68px bar; each tab
    // spans `tabWidth` with the pill inset 6px on each side.
    const pillW = tabWidth - 12;
    const pillLeft = bar.x + (current.tabIndex * tabWidth) + 6;
    const pillTop = bar.y + (bar.h - 52) / 2;
    rectX = pillLeft - 2;
    rectY = pillTop - 2;
    rectW = pillW + 4;
    rectH = 52 + 4;
    rectRadius = 22;
  }

  // ── Unified tooltip placement ── derived from the halo rect so it works for
  // BOTH element and tab steps. Width is responsive (never wider than the
  // screen), the side with room is chosen, and the final position is CLAMPED
  // so the whole card always stays inside the safe viewport on any phone.
  {
    const TAB_BAR_HEIGHT = 88; // 68px pill + 20px gap from screen bottom
    const ttWidth = Math.min(280, SCREEN_W_LIVE - 32);
    const ttH = ttHeight || 220; // measured after first layout; estimate on first paint
    const gap = 16;
    const safeTop = insetsTop + 12;
    const safeBottom = TAB_BAR_HEIGHT + insetsBottom + 12;
    const anchorCx = rectX + rectW / 2;
    const elementTop = rectY;
    const elementBottom = rectY + rectH;
    const spaceBelow = (SCREEN_H_LIVE - safeBottom) - (elementBottom + gap);
    const spaceAbove = (elementTop - gap) - safeTop;
    const fitsBelow = ttH <= spaceBelow;
    const fitsAbove = ttH <= spaceAbove;
    let below = current.tooltipPosition
      ? current.tooltipPosition === 'bottom'
      : (rectY + rectH / 2) < SCREEN_H_LIVE / 2;
    if (below && !fitsBelow && fitsAbove) below = false;
    else if (!below && !fitsAbove && fitsBelow) below = true;
    else if (!fitsBelow && !fitsAbove) below = spaceBelow >= spaceAbove; // neither fits → roomier side
    const ttLeft = Math.max(16, Math.min(anchorCx - ttWidth / 2, SCREEN_W_LIVE - ttWidth - 16));
    // SHRINK, don't cover. Scale the tooltip to fit the room beside the element
    // instead of clamping it on top of the highlighted element. Center-origin
    // scale → offset layoutTop so the visual box sits in the gap.
    const available = below ? spaceBelow : spaceAbove;
    const ttScale = ttH > available ? Math.max(0.7, available / ttH) : 1;
    const scaledH = ttH * ttScale;
    const ttTop = below
      ? (elementBottom + gap) - (ttH - scaledH) / 2
      : (elementTop - gap) - (ttH + scaledH) / 2;
    tooltipStyle = {
      position: 'absolute' as const,
      top: ttTop,
      left: ttLeft,
      width: ttWidth,
      ...(ttScale < 1 ? { transform: [{ scale: ttScale }] } : null),
    };
    // Arrow only at full scale (center-origin scaling shifts the box edges).
    arrowStyle = ttScale === 1 ? {
      position: 'absolute' as const,
      left: Math.max(20, Math.min(anchorCx - ttLeft - 8, ttWidth - 28)),
      width: 16, height: 16, backgroundColor: '#fff',
      transform: [{ rotate: '45deg' }],
      ...(below ? { top: -8 } : { bottom: -8 }),
    } : null;
  }

  const handleAdvance = () => nextStep(BIZ_WALKTHROUGH_STEPS.length);
  // "Quitter la démo" — always exits the entire walkthrough, regardless of
  // step type. The previous behaviour (skipToNextTab on element steps) was
  // confusing because the same label "Skip" did different things.
  const handleSkip = skipWalkthrough;
  // Mask taps NEVER advance the demo — even on tab steps. The previous
  // behaviour (`current.highlight === 'tab' ? handleAdvance : undefined`)
  // turned every dim-area tap into a Suivant on tab steps, so a stray
  // tap on the dimmed surroundings of the highlighted tab pill silently
  // skipped the user to the next step. The tooltip already exposes an
  // explicit "Suivant" button (tab steps aren't requireTap) and the tab
  // pill itself is tappable through the cutout — those two paths are the
  // only legitimate ways to move forward.
  const maskPress = undefined;
  const showNextButton = !current.requireTap;
  const showTapHint = !!current.requireTap;

  return (
    <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }} onLayout={remeasureOrigin}>
      {/* 1×1 origin probe — measureInWindow on this ref tells us where the
          overlay's own (0,0) sits in window coords. collapsable={false} is
          essential on Android so RN doesn't optimise the view away. */}
      <View ref={originRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
      {/* Window-coords canvas — translating by (-originX, -originY) makes the
          wrapper's (0, 0) coincide with window (0, 0), and giving it explicit
          window-sized width/height makes `bottom:` based positioning also
          measure from window bottom. Now all the inner code can use rectX /
          rectY (which came from measureInWindow) directly for top: / left:. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: -originY, left: -originX, width: SCREEN_W_LIVE, height: SCREEN_H_LIVE }}>
        {/* Edge-to-edge dim extensions — cover the status bar (above the window)
            and the system nav bar (below the window) on Samsung edge-to-edge
            devices, where useWindowDimensions() is shorter than the physical
            screen and the SVG below would otherwise leave the very top/bottom
            un-dimmed. Same rgba as the cutout SVG so the seams are invisible.
            Mirrors the customer / SubScreen overlays. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: -insetsTop - 100, left: 0, right: 0, height: insetsTop + 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', bottom: -insetsBottom - 100, left: 0, right: 0, height: insetsBottom + 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
        {/* Cutout mask — SVG path, the dim region exactly follows the rounded
            highlight shape (no rectangle-with-rounded-border mismatch). */}
        <CutoutMask x={rectX} y={rectY} w={rectW} h={rectH} radius={rectRadius} onOutsidePress={maskPress} sw={SCREEN_W_LIVE} sh={SCREEN_H_LIVE} />
        {/* Halo ring + tooltip fade in together once the layout has settled. */}
        <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, opacity: contentAnim }}>
        {/* Highlight ring — non-interactive (pointerEvents none) so taps on
            the element beneath the hole go through untouched. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', left: rectX, top: rectY, width: rectW, height: rectH,
            borderRadius: rectRadius, borderWidth: 3, borderColor: '#e3ff5c', backgroundColor: 'transparent',
          }}
        />
        {/* Tooltip */}
        <View
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h > 0 && h !== ttHeight) setTtHeight(h);
          }}
          style={{
            ...tooltipStyle,
            backgroundColor: '#fff', borderRadius: 20, padding: 20,
            shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
          }}>
          <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_500Medium', marginBottom: 10 }}>
            {displayedStep + 1}/{BIZ_WALKTHROUGH_STEPS.length}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#114b3c12', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
              <StepIcon size={22} color="#114b3c" />
            </View>
            <Text style={{ color: '#114b3c', fontSize: 17, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1 }}>
              {t(current.titleKey)}
            </Text>
          </View>
          <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, marginBottom: showTapHint ? 10 : 16 }}>
            {t(current.descKey)}
          </Text>
          {showTapHint && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, backgroundColor: '#114b3c0f', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 }}>
              <Hand size={14} color="#114b3c" />
              <Text style={{ color: '#114b3c', fontSize: 12, fontFamily: 'Poppins_600SemiBold', marginLeft: 6, flex: 1 }}>
                {current.tapTarget === 'card'
                  ? t('walkthrough.tapCardToContinue', { defaultValue: 'Appuyez sur la carte entourée pour continuer.' })
                  : t('walkthrough.tapToContinue', { defaultValue: 'Appuyez sur le bouton entouré pour continuer.' })}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TouchableOpacity onPress={handleSkip}>
              <Text style={{ color: theme.colors.muted, fontSize: 13, fontFamily: 'Poppins_500Medium' }}>
                {t('walkthrough.exitDemo', { defaultValue: 'Quitter la démo' })}
              </Text>
            </TouchableOpacity>
            {showNextButton && (
              <TouchableOpacity
                onPress={handleAdvance}
                style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
              >
                <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {isLast ? t('walkthrough.done', { defaultValue: 'C\'est parti !' }) : t('walkthrough.next', { defaultValue: 'Suivant' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {/* Arrow — only when the card sits adjacent to the element. */}
          {arrowStyle && <View style={arrowStyle} />}
        </View>
        </Animated.View>
        {/* "Follow instructions" toast — flashes when a blocked tap is
            absorbed by one of the four frame absorbers. */}
        <DemoTapHintToast />
      </View>
      </Animated.View>
  );
}
