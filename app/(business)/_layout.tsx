import { Tabs } from "expo-router";
import { LayoutDashboard, ShoppingBag, ClipboardList, User, Bell, Settings, ChevronDown, MapPin, Check, Building2, Plus, QrCode, Hand, Clock, CheckCircle, MessageCircle, Store } from "lucide-react-native";
import React from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, Animated, Dimensions, PanResponder, Modal, StyleSheet, ScrollView, useWindowDimensions, BackHandler } from "react-native";
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
import { NoLocationCTA } from "@/src/components/NoLocationCTA";
import { DelayedLoader } from "@/src/components/DelayedLoader";
import { DemoTapHintToast } from "@/src/components/DemoTapHintToast";
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
  const brandAnim = React.useRef(new Animated.Value(0)).current;

  // Compute visible tabs based on permissions (computed below, default all 4)
  const allTabNames = ['dashboard', 'my-baskets', 'incoming-orders', 'business-profile'];
  const navWidth = Dimensions.get('window').width - 64;
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

  // my-context (role / org / location memberships) doesn't change
  // mid-session except when an admin actively re-assigns the user.
  // Old config (staleTime 10s + refetchOnMount 'always' + 60s interval +
  // refetchOnWindowFocus + refetchOnReconnect) was firing 1–2 req/min
  // baseline plus a refetch on every tab swap. Dropped to 5 min stale
  // + 5 min interval; opt back into reconnect explicitly so a fresh
  // session after a network blip still picks up role changes. The
  // 'always' mount and window-focus refetches are dropped — they
  // were duplicating the work for zero benefit.
  const myContextQuery = useQuery({
    queryKey: ['my-context'],
    queryFn: fetchMyContext,
    enabled: isAuthenticated && user?.role === 'business',
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnReconnect: true,
  });

  const orgId = myContextQuery.data?.organization_id;
  const myRole = myContextQuery.data?.role;

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
  const hasNoLocation = isOrgAdmin
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
  const canCreateDeleteBaskets = isAdminOrOwner || hasPerm('create_delete_baskets');
  const canEditQuantities = isAdminOrOwner || hasPerm('edit_quantities');
  const canManageBaskets = canCreateDeleteBaskets || canEditQuantities || hasPerm('edit_basket_info');
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
    if (!selectedLocationId) {
      if (isDashboard && isAdminOrOwner) {
        return myContextQuery.data?.organization_name ?? t('business.allLocations', { defaultValue: 'Tous les emplacements' });
      }
      return t('business.location', { defaultValue: 'Emplacement' });
    }
    const loc = orgLocations.find((l) => l.id === Number(selectedLocationId));
    return loc?.name ?? t('business.location', { defaultValue: 'Location' });
  }, [selectedLocationId, orgLocations, isAdminOrOwner, isDashboard, t]);

  // PanResponder for swipe-to-dismiss on the location modal
  const modalPanResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
    onPanResponderRelease: (_, g) => {
      if (g.dy > 60) {
        setLocationModalVisible(false);
      }
    },
  }), []);

  // Layout-level pending-orders badge poll. NOT focus-gated — business
  // users want to see the orders badge update across every tab in the
  // partner app. Bumped 30s → 45s and staleTime 15s → 30s to cut the
  // baseline drip; freshness is restored sharply when the user opens
  // the incoming-orders tab (which invalidates this query).
  const todayOrdersQuery = useQuery({
    queryKey: ['today-orders-count', selectedLocationId],
    queryFn: () => fetchTodayOrders(selectedLocationId),
    enabled: isAuthenticated && user?.role === 'business',
    refetchInterval: 45_000,
    staleTime: 30_000,
  });

  const pendingOrderCount = (todayOrdersQuery.data ?? []).filter(
    (o: any) => o.status === 'confirmed' || o.status === 'reserved' || o.status === 'pending'
  ).length;

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
        // Pill trigger — matches the dashboard's location switcher so the
        // business interface has one consistent control across all tabs.
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
            maxWidth: 220,
            borderWidth: hasNoLocation ? 1 : 0,
            borderColor: hasNoLocation ? '#e67e22' : 'transparent',
          }}
          activeOpacity={0.7}
        >
          {hasNoLocation
            ? <MapPin size={14} color="#e67e22" />
            : <Building2 size={14} color={theme.colors.primary} />}
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: hasNoLocation ? '#e67e22' : theme.colors.textPrimary, fontSize: 13, fontWeight: '600', fontFamily: 'Poppins_600SemiBold', flexShrink: 1 }}
          >
            {hasNoLocation
              ? t('business.locationSwitcher.noLocationYet', { defaultValue: 'Aucun emplacement' })
              : selectedLocationName}
          </Text>
          <ChevronDown size={13} color={hasNoLocation ? '#e67e22' : theme.colors.textSecondary} />
        </TouchableOpacity>
      ) : (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6, ...theme.shadows.shadowMd, maxWidth: 220 }}>
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

  const headerRight = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TouchableOpacity
        onPress={() => router.push('/settings' as never)}
        style={{ marginRight: 12 }}
      >
        <Settings size={20} color={theme.colors.textPrimary} />
      </TouchableOpacity>
      {isAuthenticated ? (
        <TouchableOpacity
          onPress={() => router.push('/notifications' as never)}
          style={{ marginRight: 16 }}
        >
          <Bell size={20} color={theme.colors.textPrimary} />
          {unreadCount > 0 && (
            <View style={{
              position: 'absolute',
              top: -4,
              right: -6,
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
              const color = isFocused ? '#FFFFFF' : theme.colors.textSecondary;
              const iconColor = isFocused ? '#FFFFFF' : theme.colors.textSecondary;

              const onPress = () => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                // Refetch permissions on every tab press (cheap — only fires if stale)
                if (myContextQuery.isStale) void myContextQuery.refetch();
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                  setActiveIndex(index);
                  // Animate glass pill to this tab
                  Animated.spring(glassAnim, {
                    toValue: index * tabWidth,
                    useNativeDriver: true,
                    friction: 10,
                    tension: 100,
                  }).start();
                }
              };

              let icon = null;
              let badge = 0;
              const iconSize = 22;
              // Single clean icon — no double-stacking which caused washout on dark bg
              const renderBizIcon = (IconComp: any) => (
                <IconComp size={iconSize} color={iconColor} />
              );
              switch (route.name) {
                case 'dashboard': icon = renderBizIcon(LayoutDashboard); break;
                case 'my-baskets': icon = renderBizIcon(ShoppingBag); break;
                case 'incoming-orders':
                  icon = renderBizIcon(ClipboardList);
                  if (pendingOrderCount > 0) {
                    badge = pendingOrderCount;
                  }
                  break;
                case 'business-profile': icon = renderBizIcon(User); break;
              }

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
                    {icon}
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
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={{
                      color,
                      fontSize: 8,
                      fontFamily: 'Poppins_500Medium',
                      marginTop: 3,
                      width: tabWidth - 16,
                      textAlign: 'center',
                    }}
                  >
                    {options.title ?? route.name}
                  </Text>
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
        }}
      />
      <Tabs.Screen
        name="business-profile"
        options={{
          title: t('business.profile.title'),
          tabBarIcon: ({ size, focused }) => <User size={size} color={focused ? '#FFFFFF' : theme.colors.textSecondary} fill={focused ? theme.colors.primary : 'transparent'} />,
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
                {!selectedLocationId && <Check size={18} color={theme.colors.primary} />}
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
                  {isSelected && <Check size={18} color={theme.colors.primary} />}
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
      canConfirmPickup={isAdminOrOwner || hasPerm('confirm_pickup')}
      canMessage={isAdminOrOwner || hasPerm('messaging')}
      isOrgAdmin={isOrgAdmin}
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

function buildWalkthroughSteps(visibleTabs: string[], canCreateDeleteBaskets: boolean, canEditQuantities: boolean, canEditProfile: boolean, canConfirmPickup: boolean, canMessage: boolean, isOrgAdmin: boolean, hasNoLocation: boolean, insetsTop: number, SCREEN_W_BIZ: number): BizStep[] {
  // ── Special case: no location yet ──────────────────────────────────────
  // Org admin with zero locations — every other step would point at a
  // screen that just shows NoLocationCTA, so we short-circuit to a single
  // step that highlights the "add your first location" button. The user
  // taps it, navigates to /business/add-location, and the walkthrough
  // ends. Once they have a location they can replay the full tour from
  // Settings → Mode démo.
  if (hasNoLocation) {
    return [{
      tabIndex: 0,
      routeName: 'dashboard',
      icon: MapPin,
      titleKey: 'walkthrough.biz.addLocation.title',
      descKey: 'walkthrough.biz.addLocation.desc',
      highlight: 'element',
      tooltipPosition: 'top',
      requireTap: true,
      advanceOnPath: '/business/add-location',
      measureKey: 'addLocationCta',
    }];
  }
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
    // 1b. Intermediary page — reuse an existing org basket. Org-admins manage
    // baskets across locations, so only they get this "you can reuse" step;
    // other roles skip straight to the create-new CTA below.
    if (isOrgAdmin) {
      steps.push({
        tabIndex: basketIdx,
        routeName: 'my-baskets',
        icon: ShoppingBag,
        titleKey: 'walkthrough.biz.reuseBasket.title',
        descKey: 'walkthrough.biz.reuseBasket.desc',
        highlight: 'element',
        target: { top: insetsTop + 130, left: 16, width: SCREEN_W_BIZ - 32, height: 76, radius: 12 },
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
    // 3. Pickup time card — Suivant
    steps.push({
      tabIndex: basketIdx,
      routeName: 'my-baskets',
      icon: Clock,
      titleKey: 'walkthrough.biz.formPickup.title',
      descKey: 'walkthrough.biz.formPickup.desc',
      highlight: 'element',
      target: { top: 320, left: 16, width: SCREEN_W_BIZ - 32, height: 80, radius: 16 },
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
    steps.push({ tabIndex: profileIdx, routeName: 'business-profile', icon: User, titleKey: 'walkthrough.biz.profile.title', descKey: 'walkthrough.biz.profile.desc', highlight: 'tab' });
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
    // Gestion d'équipe — admins only. Tap the team card on the profile
    // page to navigate to /business/team. The sub-screen overlay there
    // renders the next two steps on top of that pushed screen.
    if (isOrgAdmin) {
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
      // Locations list — preview step. Highlights the whole locations
      // section first so the user understands what the section contains
      // (their points of vente / dépôts), then the next step focuses on
      // the "+" button. Mirrors the members-list / + member pattern so
      // both sections get the same two-beat introduction.
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
      // Locations section — highlight the "+ add location" button. The
      // team page scrolls the locations section into view on step entry
      // (see team.tsx). 18-radius matches the small round + button.
      steps.push({
        tabIndex: profileIdx,
        routeName: 'business-profile',
        icon: MapPin,
        titleKey: 'walkthrough.biz.teamAddLocation.title',
        descKey: 'walkthrough.biz.teamAddLocation.desc',
        highlight: 'element',
        target: { radius: 16 },
        tooltipPosition: 'bottom',
        measureKey: 'teamAddLocationBtn',
      });
      // Members list — preview step. Highlights the whole members section
      // first so the user sees the full list (and can read who's on the
      // team), then the next step focuses on the "+" button. Splitting the
      // tour this way avoids the previous jump where the halo went straight
      // from a small + on locations to a small + on members with no context
      // about what the section even contained.
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
      // Members section — highlight the "+ add member" button. Scrolls
      // the members section into view first so the button is visible.
      steps.push({
        tabIndex: profileIdx,
        routeName: 'business-profile',
        icon: User,
        titleKey: 'walkthrough.biz.teamAddMember.title',
        descKey: 'walkthrough.biz.teamAddMember.desc',
        highlight: 'element',
        target: { radius: 16 },
        tooltipPosition: 'top',
        measureKey: 'teamAddMemberBtn',
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

function BusinessWalkthroughOverlay({ navRef, tabWidth, theme, t, visibleTabs, canCreateDeleteBaskets, canEditQuantities, canEditProfile, canConfirmPickup, canMessage, isOrgAdmin, hasNoLocation, insetsTop, insetsBottom, router }: { navRef: any; tabWidth: number; theme: any; t: any; visibleTabs: string[]; canCreateDeleteBaskets: boolean; canEditQuantities: boolean; canEditProfile: boolean; canConfirmPickup: boolean; canMessage: boolean; isOrgAdmin: boolean; hasNoLocation: boolean; insetsTop: number; insetsBottom: number; router: any }) {
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
  const { originRef, originX, originY, originMeasured, remeasure: remeasureOrigin } = useOverlayOriginOffset();
  const BIZ_WALKTHROUGH_STEPS = React.useMemo(() => buildWalkthroughSteps(visibleTabs, canCreateDeleteBaskets, canEditQuantities, canEditProfile, canConfirmPickup, canMessage, isOrgAdmin, hasNoLocation, insetsTop, SCREEN_W_LIVE), [visibleTabs, canCreateDeleteBaskets, canEditQuantities, canEditProfile, canConfirmPickup, canMessage, isOrgAdmin, hasNoLocation, insetsTop, SCREEN_W_LIVE]);
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
  React.useEffect(() => {
    if (step === null) { setHaloReady(false); contentAnim.setValue(0); return; }
    setTtHeight(0);
    contentAnim.setValue(0);
    const mk = BIZ_WALKTHROUGH_STEPS[step]?.measureKey;
    // Team sub-screen steps run a scrollTo (60 ms) + deferred remeasure
    // (350–450 ms). The halo must wait for the remeasure to commit or it
    // lands at the pre-scroll rect. Other element steps just need a beat
    // for the first onLayout to settle (e.g. profile cards that re-layout
    // after their underlying data query resolves).
    const isTeamScroll = mk === 'teamOrgCard' || mk === 'teamLocationsSection' || mk === 'teamAddLocationBtn' || mk === 'teamAddMemberBtn' || mk === 'teamMembersSection';
    const delay = isTeamScroll ? 520 : 260;
    setHaloReady(false);
    const t = setTimeout(() => setHaloReady(true), delay);
    return () => clearTimeout(t);
  }, [step, BIZ_WALKTHROUGH_STEPS]);
  React.useEffect(() => {
    if (haloReady) Animated.timing(contentAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
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
        });
      } else {
        setCurrentStep(null);
      }
      // Settings hand-off: push /settings once, mark the overlay flag, and
      // return. The settings screen renders its own cutout overlay.
      if (s?.isSettings) {
        setShowSettingsOverlay(true);
        try { router.push('/settings'); } catch {}
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
  React.useEffect(() => {
    if (step === null) return;
    const s = BIZ_WALKTHROUGH_STEPS[step];
    const mk = s?.measureKey;
    if (mk === 'scanQrBack' && !pathname.startsWith('/business/scan-qr')) {
      nextStep(BIZ_WALKTHROUGH_STEPS.length);
    } else if (mk === 'chatBack' && !pathname.startsWith('/message')) {
      nextStep(BIZ_WALKTHROUGH_STEPS.length);
    }
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

  if (step === null) return null;
  const current = BIZ_WALKTHROUGH_STEPS[step];
  if (!current) return null;
  // Settings step — the settings screen renders its own overlay.
  if (current.isSettings) return null;
  // Inline-modal steps — the React Native Modal sits above the walkthrough
  // overlay's zIndex, so the modal renders its own halo + inline tooltip
  // for these steps. Return null so the layout overlay doesn't fight the
  // modal with its own dim mask.
  if (current.highlight === 'inline-modal') return null;

  const StepIcon = current.icon;
  const isLast = step === BIZ_WALKTHROUGH_STEPS.length - 1;
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
  // Tab steps advance on tapping the mask; element steps never do (we want
  // the user to tap the actual feature through the unmasked hole).
  const maskPress = current.highlight === 'tab' ? handleAdvance : undefined;
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
            {step + 1}/{BIZ_WALKTHROUGH_STEPS.length}
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
