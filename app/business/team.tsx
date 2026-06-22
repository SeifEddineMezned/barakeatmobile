import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Switch, ActivityIndicator, Animated, Image, PanResponder, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useFocusEffect } from 'expo-router';
import { X, UserPlus, Trash2, Shield, Users, MapPin, Crown, ShieldCheck, Key, Plus, ChevronDown, ChevronUp, ChevronLeft, List, Network, Mail, MoreVertical, Building2, MessageCircle, Edit3, AlertTriangle } from 'lucide-react-native';
import { TeamRoleChangeModal } from '@/src/components/TeamRoleChangeModal';
import { TeamLocationsManagerModal } from '@/src/components/TeamLocationsManagerModal';
import { TeamRemoveMemberDialog } from '@/src/components/TeamRemoveMemberDialog';
import { ActionMenuCard, ActionMenuItem, ActionMenuDivider } from '@/src/components/ui/ActionMenu';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { PermissionIcon8, RoleIcon8, EditIcon8, DeleteIcon8 } from '@/src/components/ui/Icon8';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import {
  fetchMyContext,
  fetchOrganizationDetails,
  createOrganization,
  addMember,
  removeMember,
  updateMember,
  addLocation,
  sendMemberEmail,
  fetchDeletedMembers,
  hideDeletedMember,
  type OrgDetailsFromAPI,
  type DeletedMemberFromAPI,
} from '@/src/services/teams';
import { getErrorMessage } from '@/src/lib/api';
import { verifyOrAlarm, createVerifyDisappeared } from '@/src/hooks/useVerifyOnError';
import { FeatureFlags } from '@/src/lib/featureFlags';
import { LOCATION_CATEGORIES } from '@/src/lib/locationCategories';
import { useAuthStore } from '@/src/stores/authStore';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { StatusDot } from '@/src/components/StatusDot';
import { FilterChip } from '@/src/components/FilterChip';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { useSwipeToDismiss } from '@/src/hooks/useSwipeToDismiss';
import { SubScreenWalkthroughOverlay } from '@/src/components/SubScreenWalkthroughOverlay';
import { formatLocationName } from '@/src/utils/formatLocation';

type PermissionKey = 'confirm_pickup' | 'edit_quantities' | 'edit_basket_info' | 'create_delete_baskets' | 'view_history' | 'messaging' | 'cancel_order';

function permBoolToString(val: boolean): string {
  return val ? 'write' : 'none';
}

// ── Role Preset Definitions ─────────────────────────────────────────────────
type RolePreset = 'org_admin' | 'full_access' | 'orders_only' | 'view_only';

interface PresetConfig {
  id: RolePreset;
  label: string;
  description: string;
  role: 'admin' | 'member';
  permissions: Record<PermissionKey, boolean>;
}

const ROLE_PRESETS: PresetConfig[] = [
  {
    id: 'org_admin',
    label: "Admin de l'organisation",
    description: 'Accès total à tous les emplacements et toutes les fonctionnalités',
    role: 'admin',
    permissions: { confirm_pickup: true, edit_quantities: true, edit_basket_info: true, create_delete_baskets: true, view_history: true, messaging: true, cancel_order: true },
  },
  {
    id: 'full_access',
    label: 'Accès complet',
    description: 'Toutes les permissions sans accès admin',
    role: 'member',
    permissions: { confirm_pickup: true, edit_quantities: true, edit_basket_info: true, create_delete_baskets: true, view_history: true, messaging: true, cancel_order: true },
  },
  {
    id: 'orders_only',
    label: 'Commandes uniquement',
    description: 'Voir les commandes et confirmer les retraits',
    role: 'member',
    permissions: { confirm_pickup: true, edit_quantities: false, edit_basket_info: false, create_delete_baskets: false, view_history: false, messaging: true, cancel_order: false },
  },
  {
    id: 'view_only',
    label: 'Membre basique',
    description: 'Accès limité selon les permissions ci-dessous',
    role: 'member',
    permissions: { confirm_pickup: false, edit_quantities: false, edit_basket_info: false, create_delete_baskets: false, view_history: false, messaging: false, cancel_order: false },
  },
];

// ── OrgChartView ──────────────────────────────────────────────────────────
type OrgNode = {
  id: string;
  initials: string;
  label: string;
  sublabel: string;
  isHighlighted: boolean;
  nodeType: 'location' | 'member' | 'team-all';
  data: any;
};

function OrgChartView({
  org,
  userRole = 'owner',
}: {
  org: OrgDetailsFromAPI | undefined;
  userRole?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const members = org?.members ?? [];
  const locations = org?.locations ?? [];
  const orgName = org?.organization?.name ?? t('business.team.orgLabel');

  type LevelState =
    | { type: 'org' }
    | { type: 'location'; id: number | null; name: string };

  const [levelState, setLevelState] = useState<LevelState>(() => {
    if (userRole === 'member' && locations.length <= 1) {
      const loc = locations[0];
      if (loc) return { type: 'location' as const, id: (loc as any).id ?? null, name: (loc as any).name ?? t('business.team.teamLabel') };
      return { type: 'location' as const, id: null, name: t('business.team.teamLabel') };
    }
    return { type: 'org' as const };
  });

  const [memberPreview, setMemberPreview] = useState<any | null>(null);
  const memberSwipe = useSwipeToDismiss(() => setMemberPreview(null));
  const levelAnim = useRef(new Animated.Value(1)).current;

  // Current account holder — used to suffix the user's own member row with
  // "(Vous)" so the admin can spot themselves at a glance.
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isMe = (m: any) => {
    if (currentUserId == null) return false;
    const ids = [m?.user_id, m?.userId, m?.id, m?.membership_user_id]
      .filter((v) => v != null)
      .map((v) => String(v));
    return ids.includes(String(currentUserId));
  };
  const youSuffix = t('common.youSuffix', { defaultValue: '(You)' });

  const doLevelTransition = (next: LevelState) => {
    Animated.timing(levelAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setLevelState(next);
      Animated.timing(levelAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  };

  const { centerLabel, nodes }: { centerLabel: string; nodes: OrgNode[] } = useMemo(() => {
    if (levelState.type === 'org') {
      const locNodes: OrgNode[] = (locations as any[]).map((loc: any) => {
        const count = (members as any[]).filter((m: any) => m.location_id === loc.id).length;
        const name: string = loc.name ?? loc.address ?? 'Location';
        return {
          id: `loc-${loc.id}`,
          initials: name.substring(0, 2).toUpperCase(),
          label: name.length > 8 ? name.substring(0, 7) + '\u2026' : name,
          sublabel: t('business.team.membersCount', { count }),
          isHighlighted: false,
          nodeType: 'location' as const,
          data: { ...loc, _locId: loc.id },
        };
      });
      const unassigned = (members as any[]).filter((m: any) => !m.location_id);
      if (unassigned.length > 0 || locNodes.length === 0) {
        locNodes.push({
          id: 'team-all',
          initials: 'TM',
          label: t('business.team.teamLabel'),
          sublabel: t('business.team.membersCount', { count: unassigned.length > 0 ? unassigned.length : (members as any[]).length }),
          isHighlighted: false,
          nodeType: 'team-all' as const,
          data: { _locId: null },
        });
      }
      return { centerLabel: orgName, nodes: locNodes.slice(0, 8) };
    } else {
      const loc = levelState as { type: 'location'; id: number | null; name: string };
      const locMembers =
        loc.id === null
          ? (members as any[]).filter((m: any) => !m.location_id)
          : (members as any[]).filter((m: any) => m.location_id === loc.id);
      const displayMembers = locMembers.length > 0 ? locMembers : (members as any[]);
      const memberNodes: OrgNode[] = displayMembers.slice(0, 8).map((m: any) => {
        const name: string = m.name ?? m.user_name ?? m.email?.split('@')[0] ?? '?';
        const initials = name
          .split(' ')
          .map((w: string) => w[0] ?? '')
          .join('')
          .toUpperCase()
          .substring(0, 2);
        const isAdmin = m.role === 'admin' || m.role === 'owner';
        return {
          id: String(m.membership_id ?? m.id ?? Math.random()),
          initials,
          label: name.split(' ')[0] ?? name,
          sublabel: m.role === 'owner' ? t('business.team.owner') : isAdmin ? t('business.team.admin') : t('business.team.member'),
          isHighlighted: isAdmin,
          nodeType: 'member' as const,
          data: m,
        };
      });
      return { centerLabel: loc.name, nodes: memberNodes };
    }
  }, [levelState, members, locations, orgName]);

  const nodeAnims = useMemo(
    () => nodes.map(() => new Animated.Value(0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes.length, levelState.type, (levelState as any).id ?? 'org']
  );

  useEffect(() => {
    nodeAnims.forEach((a) => a.setValue(0));
    Animated.stagger(
      80,
      nodeAnims.map((a) =>
        Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 10 })
      )
    ).start();
  }, [nodeAnims]);

  const RING_RADIUS = 118;
  const CENTER_R = 52;
  const NODE_R = 34;

  const handleNodePress = (node: OrgNode) => {
    if (node.nodeType === 'location') {
      doLevelTransition({ type: 'location', id: node.data._locId, name: node.label });
    } else if (node.nodeType === 'team-all') {
      doLevelTransition({ type: 'location', id: null, name: t('business.team.teamLabel') });
    } else if (node.nodeType === 'member') {
      setMemberPreview(node.data);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#114b3c' }}>
      {/* Top nav */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        {levelState.type === 'location' && userRole !== 'member' ? (
          <TouchableOpacity onPress={() => doLevelTransition({ type: 'org' })} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Poppins_400Regular' }}>
              {t('business.team.orgBack')}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 50 }} />
        )}
        <Text style={{ flex: 1, color: 'rgba(255,255,255,0.45)', fontSize: 11, fontFamily: 'Poppins_400Regular', textAlign: 'center' }}>
          {levelState.type === 'org' ? t('business.team.orgLabel') : t('business.team.teamLabel')}
        </Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Chart */}
      <Animated.View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: levelAnim,
          transform: [
            {
              scale: levelAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        }}
      >
        {/* Guide ring */}
        <View
          style={{
            position: 'absolute',
            width: RING_RADIUS * 2,
            height: RING_RADIUS * 2,
            borderRadius: RING_RADIUS,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
            borderStyle: 'dashed',
          }}
        />

        {/* Center circle */}
        <View
          style={{
            position: 'absolute',
            width: CENTER_R * 2,
            height: CENTER_R * 2,
            borderRadius: CENTER_R,
            backgroundColor: '#e3ff5c',
            alignItems: 'center',
            justifyContent: 'center',
            elevation: 8,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 12,
          }}
        >
          <Text
            style={{ color: '#114b3c', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: 11, textAlign: 'center', paddingHorizontal: 8 }}
            numberOfLines={2}
          >
            {centerLabel}
          </Text>
        </View>

        {/* Nodes */}
        {nodes.map((node, i) => {
          const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
          const tx = Math.cos(angle) * RING_RADIUS;
          const ty = Math.sin(angle) * RING_RADIUS;
          const anim = nodeAnims[i] ?? new Animated.Value(1);
          const isLocType = node.nodeType === 'location' || node.nodeType === 'team-all';

          return (
            <Animated.View
              key={node.id}
              style={{
                position: 'absolute',
                width: NODE_R * 2,
                height: NODE_R * 2,
                borderRadius: NODE_R,
                backgroundColor: isLocType
                  ? '#1a6b56'
                  : node.isHighlighted
                  ? 'rgba(255,255,255,0.22)'
                  : 'rgba(255,255,255,0.1)',
                borderWidth: node.isHighlighted ? 2 : 1.5,
                borderColor: node.isHighlighted ? '#e3ff5c' : 'rgba(255,255,255,0.3)',
                alignItems: 'center',
                justifyContent: 'center',
                transform: [
                  { translateX: tx },
                  { translateY: ty },
                  { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
                ],
                opacity: anim,
              }}
            >
              <TouchableOpacity
                style={{ width: NODE_R * 2, height: NODE_R * 2, alignItems: 'center', justifyContent: 'center', padding: 4 }}
                onPress={() => handleNodePress(node)}
                activeOpacity={0.7}
              >
                <Text
                  style={{ color: '#fff', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: node.nodeType === 'member' ? 14 : 10, textAlign: 'center' }}
                  numberOfLines={1}
                >
                  {node.nodeType === 'member' ? node.initials : node.label}
                </Text>
                <Text
                  style={{ color: 'rgba(255,255,255,0.55)', fontSize: 7, fontFamily: 'Poppins_400Regular', textAlign: 'center', marginTop: 1 }}
                  numberOfLines={1}
                >
                  {node.sublabel}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </Animated.View>

      {/* Empty state */}
      {nodes.length === 0 && (
        <View style={{ position: 'absolute', bottom: 60, left: 0, right: 0, alignItems: 'center' }}>
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontFamily: 'Poppins_400Regular', textAlign: 'center', paddingHorizontal: 32 }}>
            {levelState.type === 'org' ? t('business.team.noLocations') : t('business.team.noMembers')}
          </Text>
        </View>
      )}

      {/* Member preview sheet */}
      <Modal
        visible={memberPreview !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setMemberPreview(null)}
      >
        {memberPreview ? (
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
            activeOpacity={1}
            onPress={() => setMemberPreview(null)}
          >
            <Animated.View
              onStartShouldSetResponder={() => true}
              style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingBottom: 24, transform: [{ translateY: memberSwipe.translateY }] }}
            >
              {/* Swipe zone — full-width strip hosts the handle pill
                  AND the PanResponder, so the user can grab anywhere
                  across the top of the sheet to start the swipe-down. */}
              <View
                {...memberSwipe.panHandlers}
                style={{ paddingTop: 10, paddingBottom: 16, alignItems: 'center', marginHorizontal: -24 }}
              >
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: '#e0e0e0' }} />
              </View>

              {/* Avatar + name */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#114b3c20', alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                  <Text style={{ color: '#114b3c', fontWeight: '700', fontSize: 18, fontFamily: 'Poppins_700Bold' }}>
                    {(memberPreview.name ?? memberPreview.user_name ?? memberPreview.email ?? '?')
                      .split(' ')
                      .map((w: string) => (w[0] ?? ''))
                      .join('')
                      .toUpperCase()
                      .substring(0, 2)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#1a1a1a', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                    {memberPreview.name ?? memberPreview.user_name ?? 'Unknown'}
                    {isMe(memberPreview) ? <Text style={{ color: theme.colors.primary, fontWeight: '700' }}> {youSuffix}</Text> : null}
                  </Text>
                  <Text style={{ color: '#777', fontSize: 13, fontFamily: 'Poppins_400Regular', marginTop: 2 }}>
                    {memberPreview.role === 'owner' ? t('business.team.owner') : memberPreview.role === 'admin' ? t('business.team.admin') : t('business.team.member')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setMemberPreview(null)}>
                  <X size={20} color="#777" />
                </TouchableOpacity>
              </View>

              {/* Email */}
              {(memberPreview.email ?? memberPreview.user_email) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' }}>
                  <View style={{ marginRight: 10 }}>
                    <Mail size={15} color="#888" />
                  </View>
                  <Text style={{ color: '#555', fontSize: 13, fontFamily: 'Poppins_400Regular' }}>
                    {memberPreview.email ?? memberPreview.user_email}
                  </Text>
                </View>
              ) : null}

              {/* Stats row */}
              <View style={{ flexDirection: 'row', marginTop: 16, gap: 10 }}>
                {[
                  {
                    label: t('business.team.activePerms'),
                    value: String(
                      Object.values(memberPreview.permissions ?? {}).filter(
                        (v) => v === 'write' || v === true
                      ).length
                    ),
                  },
                  {
                    label: t('business.team.roleLabel'),
                    value: memberPreview.role === 'owner'
                      ? t('business.team.owner')
                      : memberPreview.role === 'admin'
                      ? t('business.team.admin')
                      : t('business.team.member'),
                  },
                  {
                    label: t('business.team.locationLabel'),
                    value: memberPreview.location_name ??
                      (memberPreview.location_id ? t('business.team.assigned') : t('business.team.all')),
                  },
                ].map((stat) => (
                  <View key={stat.label} style={{ flex: 1, backgroundColor: '#f5f5f5', borderRadius: 12, padding: 10, alignItems: 'center' }}>
                    <Text style={{ color: '#114b3c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                      {stat.value}
                    </Text>
                    <Text style={{ color: '#999', fontSize: 10, fontFamily: 'Poppins_400Regular', marginTop: 2, textAlign: 'center' }}>
                      {stat.label}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={{ height: 24 }} />
            </Animated.View>
          </TouchableOpacity>
        ) : null}
      </Modal>
    </View>
  );
}

export default function TeamScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const alert = useCustomAlert();

  // Current account holder — used to suffix the user's own member row with
  // "(Vous)" so the admin can spot themselves at a glance in the team list.
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isMe = (m: any) => {
    if (currentUserId == null) return false;
    const ids = [m?.user_id, m?.userId, m?.id, m?.membership_user_id]
      .filter((v) => v != null)
      .map((v) => String(v));
    return ids.includes(String(currentUserId));
  };
  const youSuffix = t('common.youSuffix', { defaultValue: '(You)' });

  // Walkthrough — publish rects for the team-tour halos. The pushed-screen
  // SubScreenWalkthroughOverlay (mounted at the bottom of this screen) reads
  // from these keys to render its halo + tooltip on top of the pushed view.
  const setMeasuredRect = useWalkthroughStore((s) => s.setMeasuredRect);
  const teamOrgCardRef = useRef<View>(null);
  const teamLocationsSectionRef = useRef<View>(null);
  const teamMembersSectionRef = useRef<View>(null);
  const teamAddLocationBtnRef = useRef<View>(null);
  const teamAddMemberBtnRef = useRef<View>(null);
  // Scroll handle so the step-entry effect can bring sections into view
  // before they're highlighted. Also track each section's y-offset inside
  // the scroll content (captured via onLayout) for the scrollTo target.
  const teamScrollViewRef = useRef<ScrollView | null>(null);
  const teamSectionYRef = useRef<Record<string, number>>({});
  const captureTeamSectionY = useCallback(
    (key: string) => (e: any) => {
      if (e?.nativeEvent?.layout) teamSectionYRef.current[key] = e.nativeEvent.layout.y;
    },
    [],
  );
  // True between the moment a team step's entry effect clears the
  // measured rect and the moment its deferred remeasure (post-scroll-
  // settle) publishes the new one. While the flag is set, onLayout-
  // driven measureTeamRect calls are dropped — that prevents the mid-
  // scroll onLayout rect from "publishing then snapping" the halo when
  // the deferred remeasure lands. The deferred remeasure itself calls
  // measureTeamRect AFTER clearing the flag, so the authoritative final
  // rect still goes through.
  const suppressTeamMeasureRef = useRef(false);
  const measureTeamRect = useCallback(
    (key: 'teamOrgCard' | 'teamLocationsSection' | 'teamMembersSection' | 'teamAddLocationBtn' | 'teamAddMemberBtn', ref: React.RefObject<View | null>) => () => {
      if (suppressTeamMeasureRef.current) return;
      requestAnimationFrame(() => {
        ref.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
          if (w > 0 && h > 0) {
            setMeasuredRect(key, {
              x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
            });
          }
        });
      });
    },
    [setMeasuredRect],
  );

  // Defensive re-measure on demo step entry. onLayout only fires when the
  // View's layout changes — but the cached rect can go stale across demo
  // restarts (the walkthrough store clears `measuredRects`, while the
  // already-mounted View never re-fires onLayout). Steps that target
  // sections below the fold (locations, members) also scroll the page
  // first so the halo lands on something visible, then re-measure once
  // the scroll has settled.
  const teamWalkthroughCurrentStep = useWalkthroughStore((s) => s.currentStep);
  useEffect(() => {
    const k = teamWalkthroughCurrentStep?.measureKey;
    if (k !== 'teamOrgCard' && k !== 'teamLocationsSection' && k !== 'teamAddLocationBtn' && k !== 'teamAddMemberBtn' && k !== 'teamMembersSection') return;
    // Clear the previous (pre-scroll) rect for THIS key immediately so the
    // overlay shows dim-only until we re-measure AFTER the scroll settles.
    // Without this the onLayout-published rect (captured at the page's initial
    // scroll offset) trips the overlay's fast-path and the halo flashes at the
    // wrong spot, then snaps once the post-scroll re-measure lands — the team
    // "halos jump around while scrolling" jitter.
    setMeasuredRect(k, null);
    // Mute onLayout-driven publishes for the duration of this step's
    // scroll-then-remeasure cycle (see measureTeamRect's guard). Re-armed
    // for every team step entry; the deferred remeasure below clears it
    // immediately before doing the authoritative measure so the final
    // rect still gets through.
    suppressTeamMeasureRef.current = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const scrollToSection = (sectionKey: string) => {
      const y = teamSectionYRef.current[sectionKey];
      if (y != null && teamScrollViewRef.current) {
        teamScrollViewRef.current.scrollTo({ y: Math.max(0, y - 24), animated: true });
      }
    };
    const remeasure = () => {
      // Authoritative post-scroll measure — bypass the mute flag so this
      // one is allowed to publish.
      suppressTeamMeasureRef.current = false;
      if (k === 'teamOrgCard') measureTeamRect('teamOrgCard', teamOrgCardRef)();
      else if (k === 'teamLocationsSection') measureTeamRect('teamLocationsSection', teamLocationsSectionRef)();
      else if (k === 'teamAddLocationBtn') measureTeamRect('teamAddLocationBtn', teamAddLocationBtnRef)();
      else if (k === 'teamAddMemberBtn') measureTeamRect('teamAddMemberBtn', teamAddMemberBtnRef)();
      else if (k === 'teamMembersSection') measureTeamRect('teamMembersSection', teamMembersSectionRef)();
    };
    if (k === 'teamOrgCard') {
      timers.push(setTimeout(() => { scrollToSection('teamOrgCard'); }, 60));
      timers.push(setTimeout(remeasure, 350));
    } else if (k === 'teamLocationsSection' || k === 'teamAddLocationBtn') {
      timers.push(setTimeout(() => { scrollToSection('teamLocations'); }, 60));
      timers.push(setTimeout(remeasure, 450));
    } else if (k === 'teamAddMemberBtn' || k === 'teamMembersSection') {
      timers.push(setTimeout(() => { scrollToSection('teamMembers'); }, 60));
      timers.push(setTimeout(remeasure, 450));
    }
    return () => {
      timers.forEach(clearTimeout);
      // Step changed before the deferred remeasure ran — un-mute so the
      // next step's onLayout publishes aren't strangled.
      suppressTeamMeasureRef.current = false;
    };
  }, [teamWalkthroughCurrentStep?.measureKey, measureTeamRect, setMeasuredRect]);

  const [viewMode, setViewMode] = useState<'list' | 'chart'>('list');
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  // Add-member form state (backend requires name, email, password)
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'member'>('member');
  const [newMemberLocationId, setNewMemberLocationId] = useState<number | null>(null);
  const [permissionsState, setPermissionsState] = useState<Record<PermissionKey, boolean>>({
    confirm_pickup: true, edit_quantities: false, edit_basket_info: false, create_delete_baskets: false, view_history: false, messaging: true, cancel_order: false,
  });

  // Role preset state for add-member modal
  const [selectedPreset, setSelectedPreset] = useState<RolePreset | null>('orders_only');
  const [showAdvancedPermissions, setShowAdvancedPermissions] = useState(false);

  // Add-location modal state
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [newLocationCategory, setNewLocationCategory] = useState('');

  const [memberMenuId, setMemberMenuId] = useState<string | null>(null);
  // Role / location modal targets — keyed by user_id since the modals now
  // operate on every membership the user holds in this org (unified role /
  // unified location set).
  const [roleModalTarget, setRoleModalTarget] = useState<{ userId: string | number } | null>(null);
  const [locationModalTarget, setLocationModalTarget] = useState<{ userId: string | number } | null>(null);
  const [emailTarget, setEmailTarget] = useState<{ memberId: string; memberName: string } | null>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);

  // Create-org modal state (shown when user has no organization)
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');

  // Step 1: Get the user's org context (which org they belong to)
  const contextQuery = useQuery({
    queryKey: ['my-context'],
    queryFn: fetchMyContext,
    staleTime: 60_000,
  });

  const orgId = contextQuery.data?.organization_id;
  const hasOrg = !!orgId;
  const myRole = contextQuery.data?.role ?? 'member';
  const myLocationId = contextQuery.data?.location_id ?? null;
  // Location admins are `admin` + a specific location_id. They keep access to
  // gestion d'équipe but scoped to their one location (no locations list, no
  // org name in the header, only members assigned to that location).
  const isLocationAdminOnly = myRole === 'admin' && !!myLocationId;
  const isOrgAdmin = (myRole === 'owner' || myRole === 'admin') && !myLocationId;
  // Anyone who can access this screen at all.
  const canAccessTeam = isOrgAdmin || isLocationAdminOnly;

  // Step 2: Fetch full org details (org + members + locations) in ONE call
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: hasOrg,
    staleTime: 60_000,
  });

  // Refetch the org/members whenever this screen regains focus. Role/location
  // changes made on the member-detail sub-screen (and its modals) should be
  // reflected the moment the user navigates back here, even if a cache
  // invalidation was missed. Cheap — this screen isn't opened in a hot loop.
  useFocusEffect(
    useCallback(() => {
      if (hasOrg) void orgDetailsQuery.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasOrg, orgId])
  );

  // 30-day archive of members who self-deleted. Empty array hides the section
  // entirely. Visible to org-admins and the owner; location-admins don't see
  // their location's deleted members here — that's a future scoping decision.
  const deletedMembersQuery = useQuery({
    queryKey: ['deleted-members', orgId],
    queryFn: () => fetchDeletedMembers(orgId!),
    enabled: hasOrg && isOrgAdmin,
    staleTime: 60_000,
  });
  const deletedMembers: DeletedMemberFromAPI[] = deletedMembersQuery.data ?? [];
  const hideDeletedMemberMutation = useMutation({
    mutationFn: (deletedUserId: number) => hideDeletedMember(orgId!, deletedUserId),
    onSuccess: () => { void deletedMembersQuery.refetch(); },
  });

  const orgDetails: OrgDetailsFromAPI | undefined = orgDetailsQuery.data;
  const org = orgDetails?.organization;
  const members = orgDetails?.members ?? [];
  const locations = orgDetails?.locations ?? [];
  // Used by formatLocationName(...) wherever this screen renders a location.
  // Falls back to context's organization_name if orgDetails hasn't loaded.
  const orgName = org?.name ?? contextQuery.data?.organization_name ?? '';

  const generatePassword = () => {
    return Math.random().toString(36).slice(-8);
  };

  const resetAddMemberForm = () => {
    setNewMemberName('');
    setNewMemberEmail('');
    setNewMemberPassword('');
    setNewMemberRole('member');
    setNewMemberLocationId(null);
    setSelectedPreset('orders_only');
    setShowAdvancedPermissions(false);
    // Reset permissions to Orders Only defaults
    const ordersOnly = ROLE_PRESETS.find((p) => p.id === 'orders_only')!;
    setPermissionsState(ordersOnly.permissions);
  };

  const handleSelectPreset = (preset: PresetConfig) => {
    setSelectedPreset(preset.id);
    setNewMemberRole(preset.role);
    setPermissionsState(preset.permissions);
  };

  const createOrgMutation = useMutation({
    mutationFn: async () => {
      if (!newOrgName.trim()) throw new Error('Organization name is required');
      return createOrganization({ name: newOrgName.trim() });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-context'] });
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      setShowCreateOrgModal(false);
      setNewOrgName('');
      alert.showAlert(t('common.success'), t('business.team.orgCreated', { defaultValue: 'Organization created!' }));
    },
    onError: async (err: any) => {
      // Verify before alarming: if the response was lost but the org
      // was actually created, my-context refetch will surface it. The
      // user is then sent to the post-create flow without seeing a
      // misleading failure popup.
      const expectedName = newOrgName.trim();
      await verifyOrAlarm<any>({
        error: err,
        queryClient,
        verifyKey: ['my-context'],
        verify: (fresh: any) => {
          if (!fresh?.organization_id) return false;
          return String(fresh?.organization_name ?? '').trim() === expectedName;
        },
        onConfirmed: () => {
          void queryClient.invalidateQueries({ queryKey: ['my-context'] });
          void queryClient.invalidateQueries({ queryKey: ['org-details'] });
          setShowCreateOrgModal(false);
          setNewOrgName('');
          alert.showAlert(t('common.success'), t('business.team.orgCreated', { defaultValue: 'Organization created!' }));
        },
        onUnconfirmed: () => alert.showAlert(t('common.error'), getErrorMessage(err)),
      });
    },
  });

  const addMemberMutation = useMutation({
    onMutate: () => {
      const existing = ((queryClient.getQueryData<any>(['org-details', orgId])?.members ?? []) as any[]);
      const preIds = new Set(existing.map((m: any) => String(m.user_id ?? m.membership_id ?? m.id)));
      return { preIds, expectedEmail: newMemberEmail.trim().toLowerCase() };
    },
    mutationFn: async () => {
      if (!orgId) throw new Error(t('business.team.noOrg', { defaultValue: 'Organisation introuvable' }));
      // Org admin: no location constraint. Others: MUST have explicit location
      const locationId = isNewMemberOrgAdmin ? undefined : newMemberLocationId;
      // Build permissions payload from current state and pass it to the API
      const permsPayload: Record<string, string> = {
        confirm_pickup: permBoolToString(permissionsState.confirm_pickup),
        edit_quantities: permBoolToString(permissionsState.edit_quantities),
        edit_basket_info: permBoolToString(permissionsState.edit_basket_info),
        create_delete_baskets: permBoolToString(permissionsState.create_delete_baskets),
        view_history: permBoolToString(permissionsState.view_history),
        messaging: permBoolToString(permissionsState.messaging),
        cancel_order: permBoolToString(permissionsState.cancel_order),
      };
      return addMember(orgId, {
        email: newMemberEmail.trim(),
        name: newMemberName.trim(),
        password: newMemberPassword,
        role: newMemberRole,
        permissions: permsPayload,
        ...(locationId ? { location_id: locationId } : {}),
      });
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      void queryClient.invalidateQueries({ queryKey: ['my-context'] });
      setShowAddMemberModal(false);
      resetAddMemberForm();
      // Show the temporary password so the owner can share it
      const tempPw = data?.temporary_password || newMemberPassword;
      alert.showAlert(
        t('common.success'),
        `${t('business.profile.memberAdded')}\n\n${t('business.profile.memberEmail')}: ${newMemberEmail.trim()}\n${t('business.team.tempPasswordLabel', { defaultValue: 'Password' })}: ${tempPw}`
      );
    },
    onError: async (err: any, _vars, context) => {
      // Verify before alarming. The member-add endpoint also fires an
      // email with credentials inline — a re-tap on timeout would
      // produce a duplicate-email outcome that's hard to undo.
      await verifyOrAlarm<any>({
        error: err,
        queryClient,
        verifyKey: ['org-details', orgId],
        verify: (fresh: any) => {
          const members = ((fresh as any)?.members ?? []) as any[];
          return members.some((m: any) => {
            const id = String(m.user_id ?? m.membership_id ?? m.id);
            const isNew = !context?.preIds?.has(id);
            const emailMatch = String(m.email ?? '').toLowerCase() === context?.expectedEmail;
            return isNew && emailMatch;
          });
        },
        onConfirmed: () => {
          void queryClient.invalidateQueries({ queryKey: ['org-details'] });
          void queryClient.invalidateQueries({ queryKey: ['my-context'] });
          setShowAddMemberModal(false);
          resetAddMemberForm();
          alert.showAlert(
            t('common.success'),
            `${t('business.profile.memberAdded')}\n\n${t('business.profile.memberEmail')}: ${context?.expectedEmail ?? newMemberEmail.trim()}\n${t('business.team.tempPasswordLabel', { defaultValue: 'Password' })}: ${newMemberPassword}`
          );
        },
        onUnconfirmed: () => alert.showAlert(t('common.error'), getErrorMessage(err)),
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      if (!orgId) throw new Error('No organization');
      await removeMember(orgId, memberId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
    },
    onError: async (err: any, memberId) => {
      // Verify by checking the member is gone from the org-details list.
      await verifyOrAlarm<any>({
        error: err,
        queryClient,
        verifyKey: ['org-details', orgId],
        verify: (fresh: any) => {
          const members = ((fresh as any)?.members ?? []) as any[];
          return !members.some((m: any) =>
            String(m.user_id ?? m.membership_id ?? m.id) === String(memberId),
          );
        },
        onConfirmed: () => {
          void queryClient.invalidateQueries({ queryKey: ['org-details'] });
        },
        onUnconfirmed: () => alert.showAlert(t('common.error'), getErrorMessage(err)),
      });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: async ({ memberId, role, permissions }: { memberId: string; role?: string; permissions?: Record<string, string> }) => {
      if (!orgId) throw new Error('No organization');
      await updateMember(orgId, memberId, { role, permissions });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
    },
    onError: async (err: any, { memberId, role, permissions }) => {
      // Verify the member now has the requested role / permissions.
      await verifyOrAlarm<any>({
        error: err,
        queryClient,
        verifyKey: ['org-details', orgId],
        verify: (fresh: any) => {
          const members = ((fresh as any)?.members ?? []) as any[];
          const live = members.find((m: any) =>
            String(m.user_id ?? m.membership_id ?? m.id) === String(memberId),
          );
          if (!live) return false;
          if (role && String(live.role ?? '') !== String(role)) return false;
          if (permissions) {
            const livePerms = (live.permissions ?? {}) as Record<string, string>;
            for (const [k, v] of Object.entries(permissions)) {
              if (String(livePerms[k] ?? '') !== String(v)) return false;
            }
          }
          return true;
        },
        onConfirmed: () => {
          void queryClient.invalidateQueries({ queryKey: ['org-details'] });
        },
        onUnconfirmed: () => alert.showAlert(t('common.error'), getErrorMessage(err)),
      });
    },
  });

  const addLocationMutation = useMutation({
    onMutate: () => {
      const existing = ((queryClient.getQueryData<any>(['org-details', orgId])?.locations ?? []) as any[]);
      const preIds = new Set(existing.map((l: any) => l?.id));
      return { preIds, expectedName: newLocationName.trim() };
    },
    mutationFn: async () => {
      if (!orgId) throw new Error('No organization');
      return addLocation(orgId, {
        name: newLocationName.trim() || undefined,
        address: newLocationAddress.trim() || undefined,
        category: newLocationCategory || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      setShowAddLocationModal(false);
      setNewLocationName('');
      setNewLocationAddress('');
      setNewLocationCategory('');
      alert.showAlert(
        t('common.success'),
        t('business.team.locationAdded', { defaultValue: 'Location added successfully.' })
      );
    },
    onError: async (err: any, _vars, context) => {
      await verifyOrAlarm<any>({
        error: err,
        queryClient,
        verifyKey: ['org-details', orgId],
        verify: (fresh: any) => {
          const locations = ((fresh as any)?.locations ?? []) as any[];
          return locations.some((l: any) => {
            const isNew = l?.id != null && !context?.preIds?.has(l.id);
            const nameMatch = String(l?.name ?? '').trim() === String(context?.expectedName ?? '').trim();
            return isNew && nameMatch;
          });
        },
        onConfirmed: () => {
          void queryClient.invalidateQueries({ queryKey: ['org-details'] });
          setShowAddLocationModal(false);
          setNewLocationName('');
          setNewLocationAddress('');
          setNewLocationCategory('');
          alert.showAlert(
            t('common.success'),
            t('business.team.locationAdded', { defaultValue: 'Location added successfully.' })
          );
        },
        onUnconfirmed: () => alert.showAlert(t('common.error'), getErrorMessage(err)),
      });
    },
  });

  const deleteLocationMutation = useMutation({
    mutationFn: async (locationId: number) => {
      if (!orgId) throw new Error('No organization');
      const { deleteLocation } = await import('@/src/services/teams');
      await deleteLocation(orgId, locationId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      if (selectedLocation) setSelectedLocation(null);
    },
    onError: async (err: any, locationId) => {
      console.error('[Team] Delete location failed:', err?.status, err?.message);
      // 409 settlement guard short-circuits BEFORE verify — it's a
      // deterministic deny, not a timeout, so the location is still
      // there and we want to surface the deferred-deletion explanation.
      if (err?.status === 409 && err?.data?.code === 'pending_settlement') {
        alert.showAlert(
          t('business.team.deleteLocationBlockedTitle', { defaultValue: 'Suppression différée' }),
          err?.data?.message ?? err?.message,
        );
        return;
      }
      // Otherwise: verify-before-alarming. If the location is gone from
      // the refetched org-details, the DELETE succeeded server-side and
      // we trigger the standard onSuccess UX silently.
      await verifyOrAlarm<any>({
        error: err,
        queryClient,
        verifyKey: ['org-details', orgId],
        verify: createVerifyDisappeared(
          (cache) => ((cache as any)?.locations ?? []),
          locationId,
        ),
        onConfirmed: () => {
          void queryClient.invalidateQueries({ queryKey: ['org-details'] });
          void queryClient.invalidateQueries({ queryKey: ['my-baskets'] });
          void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
          if (selectedLocation) setSelectedLocation(null);
        },
        onUnconfirmed: () => alert.showAlert(
          t('common.error'),
          t('business.team.deleteLocationFailed', { defaultValue: "Impossible de masquer l'emplacement. Veuillez réessayer." }),
        ),
      });
    },
  });

  // Location row 3-dot menu + styled delete-confirmation. Mirrors the member
  // card pattern: inline dropdown below the tapped row, no centered popup.
  const [locationMenuId, setLocationMenuId] = useState<number | null>(null);
  const [deleteLocationTarget, setDeleteLocationTarget] = useState<{ id: number; name: string } | null>(null);
  // Per-row expand toggle for long addresses — keyed by location id.
  const handleEditLocation = useCallback((locationId: number) => {
    setLocationMenuId(null);
    router.push({ pathname: '/business/edit-location', params: { id: String(locationId) } } as never);
  }, [router]);
  const handleRequestDeleteLocation = useCallback((locationId: number, locationName: string) => {
    setLocationMenuId(null);
    setDeleteLocationTarget({ id: locationId, name: locationName });
  }, []);

  // Remove-member target — the shared TeamRemoveMemberDialog operates on the
  // whole user and uses `selectedLocation` (if set) as the scope. That way a
  // filtered view removes only the filtered membership while an unfiltered
  // view removes everywhere in one pass.
  const [removeMemberTarget, setRemoveMemberTarget] = useState<{ userId: string | number; name: string } | null>(null);
  const handleRemoveMember = useCallback((userId: string | number | undefined, memberName: string) => {
    if (!userId) return;
    setRemoveMemberTarget({ userId, name: memberName });
  }, []);

  const handleChangeRole = useCallback((memberId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    updateMemberMutation.mutate({ memberId, role: newRole });
  }, [updateMemberMutation]);

  const openPermissionsScreen = useCallback(
    (membershipId: string, memberName: string, memberRole: string) => {
      router.push({
        pathname: '/business/permissions/[membershipId]',
        params: {
          membershipId,
          orgId: orgId != null ? String(orgId) : '',
          memberName,
          memberRole,
        },
      } as never);
    },
    [router, orgId],
  );

  // Role → StatusDot tone mapping. Owner is success-green (top-of-hierarchy),
  // admin uses the brand primary info tone, members stay neutral. Replaces
  // the old tinted pill pattern (color + bg + icon).
  const getRoleTone = (role: string): { tone: 'success' | 'info' | 'neutral'; label: string } => {
    switch (role) {
      case 'owner':
        return { tone: 'success', label: t('business.team.owner', { defaultValue: 'Owner' }) };
      case 'admin':
        return { tone: 'info', label: t('business.team.admin') };
      default:
        return { tone: 'neutral', label: t('business.team.member') };
    }
  };

  const isLoading = contextQuery.isLoading || (hasOrg && orgDetailsQuery.isLoading);
  const isError = contextQuery.isError || (hasOrg && orgDetailsQuery.isError);
  const noOrg = !isLoading && !isError && !hasOrg;

  const permissionLabels: { key: PermissionKey; label: string; desc: string }[] = [
    { key: 'confirm_pickup', label: t('business.profile.permConfirmPickup', { defaultValue: 'Confirmer les retraits' }), desc: t('business.profile.permConfirmPickupDesc', { defaultValue: "Scanner le QR / saisir le code pour confirmer le retrait d'un client" }) },
    { key: 'edit_quantities', label: t('business.profile.permEditQuantities', { defaultValue: 'Modifier les quantités' }), desc: t('business.profile.permEditQuantitiesDesc', { defaultValue: 'Changer la quantité disponible des paniers, mettre en pause les ventes' }) },
    { key: 'edit_basket_info', label: t('business.profile.permEditBasketInfo', { defaultValue: 'Modifier les paniers' }), desc: t('business.profile.permEditBasketInfoDesc', { defaultValue: 'Modifier le prix, description, horaires de retrait et instructions' }) },
    { key: 'create_delete_baskets', label: t('business.profile.permCreateDeleteBaskets', { defaultValue: 'Créer et supprimer des paniers' }), desc: t('business.profile.permCreateDeleteBasketsDesc', { defaultValue: 'Ajouter de nouveaux paniers ou supprimer des paniers existants' }) },
    { key: 'view_history', label: t('business.profile.permViewHistory', { defaultValue: 'Historique et statistiques' }), desc: t('business.profile.permViewHistoryDesc', { defaultValue: "Voir les stats de vente, l'historique des commandes et les graphiques de performance" }) },
    { key: 'messaging', label: t('business.profile.permMessaging', { defaultValue: 'Messagerie clients' }), desc: t('business.profile.permMessagingDesc', { defaultValue: 'Envoyer et recevoir des messages avec les clients' }) },
    { key: 'cancel_order', label: t('business.profile.permCancelOrder', { defaultValue: 'Annuler des commandes' }), desc: t('business.profile.permCancelOrderDesc', { defaultValue: 'Annuler les commandes entrantes et rembourser les clients en crédits' }) },
  ];

  // Unique member count — dedupe by user_id so a multi-location member
  // isn't counted N times. Used for the stats card and the "view all" pill
  // in the locations section.
  const uniqueMemberCount = useMemo(() => {
    const ids = new Set<string>();
    for (const m of members as any[]) ids.add(String(m.user_id ?? m.membership_id));
    return ids.size;
  }, [members]);

  // Location admins are locked to their one location — never expose other
  // locations' members. Org admins can freely filter via the locations list.
  const scopedMembers = isLocationAdminOnly
    ? members.filter((m: any) => m.location_id === myLocationId)
    : members;
  const displayedMembers = selectedLocation
    ? scopedMembers.filter((m: any) => m.location_id === selectedLocation)
    : scopedMembers;

  // Dedupe by user_id — a member in multiple locations should render as one
  // card with a badge per location. The `primary` membership is used as the
  // representative for actions that don't span siblings (send-email, nav to
  // detail screen). Admin-in-any-location wins the primary role so the card
  // badge reflects the highest privilege.
  //
  // Split into two buckets:
  //  - orgPeople: owner + org admins (admin with null location) — rendered in
  //    the dedicated "Admins de l'organisation" section. Computed from the
  //    full scoped members list so that picking a specific location in the
  //    filter doesn't hide them (org admins transcend any single location).
  //  - teamPeople: everyone else — rendered in the Members section below.
  //    Respects the selected-location filter.
  type GroupedUser = { primary: any; all: any[]; locations: { id: number; name: string }[]; isOrgLevel: boolean };
  const groupMembers = (list: any[]): Map<string, GroupedUser> => {
    const locNameById = new Map<number, string>();
    for (const l of locations) locNameById.set(Number((l as any).id), (l as any).name ?? (l as any).address ?? '');
    const byUser = new Map<string, GroupedUser>();
    for (const m of list) {
      const key = String(m.user_id ?? m.membership_id);
      if (!byUser.has(key)) byUser.set(key, { primary: m, all: [], locations: [], isOrgLevel: false });
      const entry = byUser.get(key)!;
      entry.all.push(m);
      if (m.role === 'owner') entry.primary = m;
      else if (m.role === 'admin' && entry.primary.role !== 'owner') entry.primary = m;
      if (m.role === 'admin' && !m.location_id) entry.isOrgLevel = true;
      if (m.role === 'owner') entry.isOrgLevel = true;
      const locName = m.location_id ? locNameById.get(Number(m.location_id)) : undefined;
      if (m.location_id && locName) entry.locations.push({ id: Number(m.location_id), name: locName });
    }
    return byUser;
  };
  // Users who are org-level (owner OR admin with no location_id) anywhere
  // across the full members list. Used to suppress org admins from the
  // location-filtered Members section even when a residual per-location row
  // for the same user exists in the data.
  const orgAdminUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of members as any[]) {
      if (m.role === 'owner' || (m.role === 'admin' && !m.location_id)) {
        ids.add(String(m.user_id));
      }
    }
    return ids;
  }, [members]);

  const { orgPeople, teamPeople } = useMemo(() => {
    // Org admins come from the unfiltered scoped list so they stay visible
    // regardless of which specific location is selected.
    const orgs: GroupedUser[] = [];
    for (const g of groupMembers(scopedMembers).values()) {
      if (g.isOrgLevel) orgs.push(g);
    }
    // Team members come from the location-filtered list.
    const teams: GroupedUser[] = [];
    for (const g of groupMembers(displayedMembers).values()) {
      if (g.isOrgLevel) continue;
      // Cross-user guard: if this user is an org admin via ANY row in the
      // full members list, never show them in the Members section — even
      // when a residual per-location row passes the location filter.
      if (orgAdminUserIds.has(String(g.primary.user_id))) continue;
      teams.push(g);
    }
    return { orgPeople: orgs, teamPeople: teams };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedMembers, displayedMembers, locations, orgAdminUserIds]);

  // Orphan members: non-org-admin users who have NO row with a real
  // location_id. Surfaced in a dedicated warning section so admins can spot
  // and fix the bad data via "Assigner un emplacement".
  const orphanPeople = useMemo(() => {
    const out: GroupedUser[] = [];
    for (const g of groupMembers(scopedMembers).values()) {
      if (g.isOrgLevel) continue;
      if (orgAdminUserIds.has(String(g.primary.user_id))) continue;
      if (g.locations.length === 0) out.push(g);
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedMembers, orgAdminUserIds, locations]);

  const handleAddMemberFromLocation = () => {
    // Location admin always adds members into their one location; org admin
    // honours the currently-filtered location if any.
    const targetLocation = isLocationAdminOnly ? myLocationId : selectedLocation;
    if (targetLocation) {
      router.push(`/business/add-member?locationId=${targetLocation}` as never);
    } else {
      router.push('/business/add-member' as never);
    }
  };

  const isNewMemberOrgAdmin = selectedPreset === 'org_admin';
  const canAddMember = newMemberName.trim() && newMemberEmail.trim() && newMemberPassword && (isNewMemberOrgAdmin || newMemberLocationId || (locations.length === 0));

  // Helper: get initials from a name
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Helper: find location name for a member
  const getLocationName = (locationId: number | undefined | null) => {
    if (!locationId) return null;
    const loc = locations.find((l: any) => l.id === locationId);
    if (!loc) return null;
    return loc.name ?? loc.address ?? null;
  };

  // ── Shared header ─────────────────────────────────────────────────────────
  const renderHeader = (title?: string) => (
    <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
      <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <ChevronLeft size={24} color={theme.colors.textPrimary} />
      </TouchableOpacity>
      <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' as const }]}>
        {title ?? t('business.profile.teamManagement')}
      </Text>
      {FeatureFlags.ENABLE_TEAM_ORG_CHART ? (
        <TouchableOpacity
          onPress={() => setViewMode((prev) => (prev === 'list' ? 'chart' : 'list'))}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {viewMode === 'list' ? (
            <Network size={22} color={theme.colors.textPrimary} />
          ) : (
            <List size={22} color={theme.colors.textPrimary} />
          )}
        </TouchableOpacity>
      ) : (
        <View style={{ width: 24 }} />
      )}
    </View>
  );

  // ── Render ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        {renderHeader()}
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  // Guard: non-admin members cannot access team management
  if (!isLoading && hasOrg && !canAccessTeam) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        {renderHeader()}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' }}>
            {t('business.team.noPermission', { defaultValue: 'Vous n\'avez pas la permission d\'accéder à cette page.' })}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        {renderHeader()}
        <View style={styles.centered}>
          <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center', marginBottom: 16 }]}>
            {t('common.errorOccurred')}
          </Text>
          <TouchableOpacity
            onPress={() => { void contextQuery.refetch(); void orgDetailsQuery.refetch(); }}
            style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: 24, paddingVertical: 12 }}
          >
            <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      {/* Header */}
      {renderHeader(t('business.profile.teamManagement'))}

      {/* Org chart view (alternative to list) */}
      {viewMode === 'chart' && FeatureFlags.ENABLE_TEAM_ORG_CHART ? (
        <OrgChartView org={orgDetailsQuery.data} userRole={contextQuery.data?.role ?? 'owner'} />
      ) : (
      /* No-org state: prompt to create */
      noOrg ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: theme.colors.primary + '12',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: 20,
          }}>
            <Users size={40} color={theme.colors.primary} />
          </View>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginTop: 4, textAlign: 'center' }}>
            {t('business.team.noOrgTitle', { defaultValue: 'No Organization Yet' })}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 10, textAlign: 'center', lineHeight: 22 }}>
            {t('business.team.noOrgDesc', { defaultValue: 'Create an organization to manage your team and locations.' })}
          </Text>
          <TouchableOpacity
            onPress={() => setShowCreateOrgModal(true)}
            style={{
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.r12,
              paddingHorizontal: 28,
              paddingVertical: 14,
              marginTop: 28,
              flexDirection: 'row',
              alignItems: 'center',
              ...theme.shadows.shadowMd,
            }}
          >
            <Plus size={18} color="#fff" />
            <Text style={{ color: '#fff', ...theme.typography.button, marginLeft: 8 }}>
              {t('business.team.createOrg', { defaultValue: 'Create Organization' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          ref={teamScrollViewRef}
          style={styles.content}
          contentContainerStyle={{ padding: theme.spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {/* Organization Info Card — brand-colored header */}
          {/* Org card with overlapping stats */}
          <View
            ref={teamOrgCardRef as any}
            onLayout={(e) => {
              captureTeamSectionY('teamOrgCard')(e);
              measureTeamRect('teamOrgCard', teamOrgCardRef)();
            }}
            collapsable={false}
            style={{ marginBottom: 24 }}
          >
            {/* Green banner — taller to allow overlap */}
            <View style={{
              backgroundColor: '#114b3c',
              borderRadius: theme.radii.r16,
              padding: theme.spacing.xl,
              paddingBottom: 40,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {org?.image_url ? (
                  <Image source={{ uri: org.image_url }} style={{ width: 52, height: 52, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' }} />
                ) : (
                  <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                    {isLocationAdminOnly ? (
                      <MapPin size={26} color="#e3ff5c" />
                    ) : (
                      <Building2 size={26} color="#e3ff5c" />
                    )}
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 14 }}>
                  {/* Location admins see "Org - Location" here for their
                      scoped view; org admins see just the org name. */}
                  <Text style={{ color: '#fff', ...theme.typography.h2 }}>
                    {isLocationAdminOnly
                      ? formatLocationName(orgName, locations.find((l: any) => l.id === myLocationId)?.name ?? contextQuery.data?.location_name, '--')
                      : (org?.name ?? '--')}
                  </Text>
                  {!isLocationAdminOnly && org?.category ? (
                    <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: 'rgba(227,255,92,0.2)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 }}>
                      <Text style={{ color: '#e3ff5c', ...theme.typography.caption, fontWeight: '600' }}>
                        {t(`categories.${org.category.toLowerCase()}`, { defaultValue: org.category })}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Stats card — overlaps the green banner */}
            <View style={{
              flexDirection: 'row',
              backgroundColor: theme.colors.surface,
              borderRadius: 14,
              marginTop: -24,
              marginHorizontal: 20,
              paddingVertical: 14,
              ...theme.shadows.shadowMd,
            }}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Users size={14} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                    {uniqueMemberCount}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 2 }}>
                  {t('business.team.members')}
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: theme.colors.divider }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MapPin size={14} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                    {locations.length}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 2 }}>
                  {t('business.team.locations', { defaultValue: 'Emplacements' })}
                </Text>
              </View>
            </View>
          </View>

          {/* Org Admins section — owner + users who are admin with NO
              location (org-wide admins). Hidden for location admins since
              they only see their own scope. */}
          {!isLocationAdminOnly && orgPeople.length > 0 && (
            <View style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              marginTop: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            }}>
              <View style={{ padding: theme.spacing.lg }}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                  {t('business.team.orgAdminsSection', { defaultValue: "Admins de l'organisation" })} ({orgPeople.length})
                </Text>
              </View>
              {orgPeople.map((group, idx) => {
                const member = group.primary;
                const memberId = String(member.membership_id ?? member.id ?? idx);
                const userIdKey = String(member.user_id ?? memberId);
                const memberRole = member.role ?? 'admin';
                const memberName = member.name ?? member.user_name ?? member.email?.split('@')[0] ?? '';
                const memberEmail = member.email ?? member.user_email ?? '';
                const roleChip = getRoleTone(memberRole);
                const isOwner = memberRole === 'owner';
                const initials = getInitials(memberName);
                const menuKey = `org-${userIdKey}`;
                return (
                  <TouchableOpacity
                    key={userIdKey}
                    activeOpacity={0.7}
                    onPress={() => router.push({ pathname: '/business/member-detail', params: { memberId, memberUserId: String(member.user_id ?? ''), memberName, memberEmail, memberRole, locationName: '' } } as never)}
                    style={{
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.lg,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.divider,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{
                        backgroundColor: '#114b3c18',
                        borderRadius: 22, width: 44, height: 44,
                        justifyContent: 'center', alignItems: 'center', flexShrink: 0,
                      }}>
                        <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', lineHeight: 20 }}>
                          {initials}
                        </Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                            {memberName || memberEmail}
                            {isMe(member) ? <Text style={{ color: theme.colors.primary, fontWeight: '700' }}> {youSuffix}</Text> : null}
                          </Text>
                          <StatusDot tone={roleChip.tone} label={roleChip.label} />
                        </View>
                        {memberEmail && memberName ? (
                          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                            {memberEmail}
                          </Text>
                        ) : null}
                      </View>
                      {!isOwner && canAccessTeam && (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation?.(); setMemberMenuId(memberMenuId === menuKey ? null : menuKey); }}
                          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                          style={{ padding: 4 }}
                        >
                          <MoreVertical size={18} color={theme.colors.textSecondary} />
                        </TouchableOpacity>
                      )}
                    </View>
                    {/* Dropdown — org admins don't get "Manage locations"
                        since they have no per-location set. */}
                    {memberMenuId === menuKey && !isOwner && canAccessTeam && (
                      // iOS-action-sheet-flavored inline menu. Soft shadow
                      // instead of a hard border, neutral icons throughout
                      // (the menu is utility — no brand color), and the
                      // destructive row sits behind a subtle divider.
                      <ActionMenuCard style={{ marginTop: 10, marginBottom: 10, alignSelf: 'stretch' }}>
                        <ActionMenuItem
                          icon={<PermissionIcon8 size={16} />}
                          label={t('business.profile.permissions')}
                          onPress={() => { setMemberMenuId(null); openPermissionsScreen(memberId, memberName, member.role); }}
                        />
                        <ActionMenuDivider />
                        <ActionMenuItem
                          icon={<RoleIcon8 size={16} />}
                          label={t('business.team.changeRole', { defaultValue: 'Changer le rôle' })}
                          onPress={() => { setMemberMenuId(null); setRoleModalTarget({ userId: member.user_id }); }}
                        />
                        <ActionMenuDivider />
                        <ActionMenuItem
                          icon={<Mail size={16} color={theme.colors.textSecondary} />}
                          label={t('business.team.sendEmail', { defaultValue: 'Envoyer un email' })}
                          onPress={() => { setMemberMenuId(null); setEmailTarget({ memberId, memberName: memberName ?? '' }); }}
                        />
                        <ActionMenuDivider />
                        <ActionMenuItem
                          destructive
                          icon={<DeleteIcon8 size={16} />}
                          label={t('business.profile.removeMember')}
                          onPress={() => { setMemberMenuId(null); handleRemoveMember(member.user_id, memberName); }}
                        />
                      </ActionMenuCard>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Locations Section — hidden for location admins since they only
              belong to one location (no cross-location context to show). */}
          {!isLocationAdminOnly && (locations.length > 0 || orgId) && (
            <View
              ref={teamLocationsSectionRef as any}
              onLayout={(e) => {
                captureTeamSectionY('teamLocations')(e);
                measureTeamRect('teamLocationsSection', teamLocationsSectionRef)();
              }}
              collapsable={false}
              style={{
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radii.r16,
                marginTop: theme.spacing.lg,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                overflow: 'hidden',
              }}
            >
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: theme.spacing.lg,
                paddingTop: theme.spacing.lg,
                paddingBottom: theme.spacing.sm,
              }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                  {t('business.team.locations', { defaultValue: 'Locations' })}
                </Text>
                {/* "+" button in Locations section header (admin only) */}
                {isOrgAdmin && (
                <TouchableOpacity
                  ref={teamAddLocationBtnRef as any}
                  onLayout={measureTeamRect('teamAddLocationBtn', teamAddLocationBtnRef)}
                  onPress={() => router.push('/business/add-location' as never)}
                  style={{
                    backgroundColor: theme.colors.primary + '12',
                    borderRadius: 16,
                    width: 32,
                    height: 32,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <Plus size={18} color={theme.colors.primary} />
                </TouchableOpacity>
                )}
              </View>

              {/* "Voir tout" filter chip — rectangular, flat 8px radius,
                  filled primary when active. Matches the chip style used in
                  the business orders / home filters for consistency. */}
              {locations.length > 0 && (
                <View style={{ paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm, alignSelf: 'flex-start' }}>
                  <FilterChip
                    icon={Users}
                    label={t('business.dashboard.viewAll', { defaultValue: 'Voir tout' })}
                    suffix={uniqueMemberCount}
                    active={selectedLocation === null}
                    onPress={() => setSelectedLocation(null)}
                  />
                </View>
              )}

              {locations.length === 0 && (
                <View style={{
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.xl,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.divider,
                  alignItems: 'center',
                }}>
                  <MapPin size={20} color={theme.colors.muted} />
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 8, textAlign: 'center' }}>
                    {t('business.team.noLocations', { defaultValue: 'No locations yet. Tap + to add one.' })}
                  </Text>
                </View>
              )}

              {locations.map((loc: any, index: number) => (
                <View key={loc.id ?? index}>
                {(() => {
                  const isSelected = selectedLocation === loc.id;
                  return (
                <TouchableOpacity
                  onPress={() => setSelectedLocation(loc.id)}
                  style={{
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.divider,
                    flexDirection: 'row',
                    alignItems: 'center',
                    // Strong highlight when selected: primary-green fill + white
                    // text, so the active filter is unmissable.
                    backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                  }}
                >
                  <View style={{
                    backgroundColor: isSelected ? 'rgba(255,255,255,0.18)' : theme.colors.primary + '12',
                    borderRadius: 10,
                    width: 36,
                    height: 36,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                    <MapPin size={18} color={isSelected ? '#fff' : theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: isSelected ? '#fff' : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' }}>
                        {loc.name ?? loc.address ?? `Location ${index + 1}`}
                      </Text>
                      {/* Per-location category chip — sits next to the
                          location name so the user can see the value
                          they just changed in the edit-location form
                          reflected immediately. The team screen's top
                          header still shows the ORG's category (mirrored
                          server-side on every location-category save —
                          see teams.js PUT location). */}
                      {loc.category ? (
                        <View style={{
                          backgroundColor: isSelected ? 'rgba(255,255,255,0.22)' : theme.colors.primary + '12',
                          borderRadius: 8,
                          paddingHorizontal: 7,
                          paddingVertical: 1,
                        }}>
                          <Text style={{
                            color: isSelected ? '#fff' : theme.colors.primary,
                            fontSize: 10,
                            fontWeight: '700',
                          }}>
                            {t(`categories.${String(loc.category).toLowerCase()}`, { defaultValue: loc.category })}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {loc.address && loc.name && (
                      // Full address, no truncation. The previous version
                      // collapsed it to the first comma-chunk with a "Voir
                      // plus / Voir moins" toggle; user wanted the toggle
                      // gone and the address shown as-is.
                      <Text
                        style={{ color: isSelected ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary, ...theme.typography.caption, marginTop: 1 }}
                      >
                        {loc.address}
                      </Text>
                    )}
                  </View>
                  {/* Member-count pill — icon + number, mirroring the basket
                      quantity chips elsewhere in the app. */}
                  <View style={{
                    backgroundColor: isSelected ? 'rgba(255,255,255,0.18)' : theme.colors.primary + '10',
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <Users size={12} color={isSelected ? '#fff' : theme.colors.primary} />
                    <Text style={{ color: isSelected ? '#fff' : theme.colors.primary, ...theme.typography.caption, fontWeight: '700' }}>
                      {members.filter((m: any) => m.location_id === loc.id).length}
                    </Text>
                  </View>
                  {/* 3-dot menu on the far right — sits AFTER the member count
                      so Modifier / Supprimer is never adjacent to the count. */}
                  {isOrgAdmin && (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setLocationMenuId(locationMenuId === loc.id ? null : loc.id);
                      }}
                      style={{ marginLeft: 8, padding: 4 }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MoreVertical size={18} color={isSelected ? 'rgba(255,255,255,0.8)' : theme.colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
                  );
                })()}

                {/* Inline dropdown — mirrors the member menu pattern */}
                {locationMenuId === loc.id && isOrgAdmin && (
                  <ActionMenuCard style={{ marginTop: 10, marginHorizontal: theme.spacing.lg, marginBottom: 10 }}>
                    <ActionMenuItem
                      icon={<EditIcon8 size={16} />}
                      label={t('business.team.editLocation', { defaultValue: "Modifier l'emplacement" })}
                      onPress={() => handleEditLocation(loc.id)}
                    />
                    <ActionMenuDivider />
                    <ActionMenuItem
                      destructive
                      icon={<DeleteIcon8 size={16} />}
                      label={t('business.team.deleteLocation', { defaultValue: "Supprimer l'emplacement" })}
                      onPress={() => handleRequestDeleteLocation(loc.id, loc.name ?? loc.address ?? 'Location')}
                    />
                  </ActionMenuCard>
                )}
                </View>
              ))}
            </View>
          )}

          {/* Members Section */}
          <View
            ref={teamMembersSectionRef as any}
            onLayout={(e) => {
              captureTeamSectionY('teamMembers')(e);
              measureTeamRect('teamMembersSection', teamMembersSectionRef)();
            }}
            collapsable={false}
            style={[{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              marginTop: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            }]}
          >
            <View style={[{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: theme.spacing.lg,
              paddingBottom: theme.spacing.sm,
            }]}>
              <View style={{ flex: 1 }}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                  {t('business.team.members')} ({teamPeople.length})
                </Text>
                {/* Scope label — makes it obvious whose members are being shown.
                    Hidden when the viewer is a location-only admin (can only
                    ever see their one location), since "Tous les emplacements"
                    would be misleading. */}
                {(() => {
                  if (isLocationAdminOnly) return null;
                  const selectedLocBare = selectedLocation
                    ? ((locations.find((l: any) => l.id === selectedLocation) as any)?.name
                        ?? (locations.find((l: any) => l.id === selectedLocation) as any)?.address
                        ?? '')
                    : null;
                  const selectedLocName = selectedLocBare
                    ? formatLocationName(orgName, selectedLocBare)
                    : null;
                  const label = selectedLocName
                    ? t('business.team.membersAtLocation', { location: selectedLocName, defaultValue: selectedLocName })
                    : t('business.team.membersAllLocations', { defaultValue: 'Tous les emplacements' });
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <MapPin size={11} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' }} numberOfLines={1}>
                        {label}
                      </Text>
                    </View>
                  );
                })()}
              </View>
              {/* Inline add-member button for quick access — location admins
                  get this too for their own location. */}
              {canAccessTeam && (
                <TouchableOpacity
                  ref={teamAddMemberBtnRef as any}
                  onLayout={measureTeamRect('teamAddMemberBtn', teamAddMemberBtnRef)}
                  onPress={handleAddMemberFromLocation}
                  style={{
                    backgroundColor: theme.colors.primary + '12',
                    borderRadius: 16,
                    width: 32,
                    height: 32,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                  accessibilityLabel={t('business.profile.addMember')}
                >
                  <UserPlus size={16} color={theme.colors.primary} />
                </TouchableOpacity>
              )}
            </View>

            {/* Zero-member onboarding card */}
            {teamPeople.length === 0 && (
              <View style={{
                paddingHorizontal: theme.spacing.xl,
                paddingVertical: theme.spacing.xl,
                borderTopWidth: 1,
                borderTopColor: theme.colors.divider,
                alignItems: 'center',
              }}>
                <View style={{
                  backgroundColor: theme.colors.primary + '15',
                  borderRadius: 32,
                  width: 64,
                  height: 64,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: theme.spacing.lg,
                }}>
                  <Users size={32} color={theme.colors.primary} />
                </View>
                <Text style={{
                  color: theme.colors.textPrimary,
                  ...theme.typography.h3,
                  textAlign: 'center',
                  marginBottom: theme.spacing.sm,
                }}>
                  {t('business.team.buildTeamTitle')}
                </Text>
                <Text style={{
                  color: theme.colors.textSecondary,
                  ...theme.typography.bodySm,
                  textAlign: 'center',
                  marginBottom: theme.spacing.xl,
                  lineHeight: 20,
                }}>
                  {t('business.team.buildTeamDesc')}
                </Text>
                {canAccessTeam && (
                <TouchableOpacity
                  onPress={handleAddMemberFromLocation}
                  style={{
                    backgroundColor: theme.colors.primary,
                    borderRadius: theme.radii.r12,
                    paddingHorizontal: 24,
                    paddingVertical: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                  }}
                >
                  <UserPlus size={16} color="#fff" />
                  <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600', marginLeft: 8 }}>
                    {t('business.team.addFirstMember')}
                  </Text>
                </TouchableOpacity>
                )}
              </View>
            )}

            {/* Member Cards — one per user (deduped). Users in multiple
                locations get a row of location badges; the 3-dot actions
                operate on all their memberships in this org. Owners and org
                admins live in the "Admins de l'organisation" section and
                aren't rendered here. */}
            {teamPeople.map((group, idx) => {
              const member = group.primary;
              const memberId = String(member.membership_id ?? member.id ?? idx);
              const userIdKey = String(member.user_id ?? memberId);
              const memberRole = member.role ?? 'member';
              const memberName = member.name ?? member.user_name ?? member.email?.split('@')[0] ?? '';
              const memberEmail = member.email ?? member.user_email ?? '';
              const isOwner = memberRole === 'owner';
              // A location admin is role='admin' on any of this user's
              // memberships (org admins are already pulled into the dedicated
              // org section, so an "admin" here is always a LOCATION admin).
              // Show it regardless of the selected-location filter — otherwise a
              // member just promoted to "admin of location" keeps showing
              // "Membre" on the all-locations view and the change looks like it
              // never applied. Labelled distinctly from the org "Admin" so it's
              // not mistaken for an org-wide admin.
              const isLocationAdmin = !isOwner && group.all.some((m: any) => m.role === 'admin');
              const displayedRole = isOwner ? 'owner' : isLocationAdmin ? 'admin' : 'member';
              const roleChip = isLocationAdmin
                ? { tone: 'info' as const, label: t('business.team.roleLocationAdmin', { defaultValue: "Admin de l'emplacement" }) }
                : getRoleTone(displayedRole);
              const initials = getInitials(memberName);

              return (
                <TouchableOpacity
                  key={userIdKey}
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/business/member-detail', params: { memberId, memberUserId: String(member.user_id ?? ''), memberName, memberEmail, memberRole, locationName: formatLocationName(orgName, group.locations[0]?.name) } } as never)}
                  style={{
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.lg,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.divider,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{
                      backgroundColor: '#114b3c18',
                      borderRadius: 22, width: 44, height: 44,
                      justifyContent: 'center', alignItems: 'center', flexShrink: 0,
                    }}>
                      <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', lineHeight: 20 }}>
                        {initials}
                      </Text>
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                          {memberName || memberEmail}
                          {isMe(member) ? <Text style={{ color: theme.colors.primary, fontWeight: '700' }}> {youSuffix}</Text> : null}
                        </Text>
                        <StatusDot tone={roleChip.tone} label={roleChip.label} />
                      </View>
                      {memberEmail && memberName ? (
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                          {memberEmail}
                        </Text>
                      ) : null}
                      {/* Location badges — one per membership. */}
                      {group.locations.length > 0 ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                          {group.locations.map((loc) => (
                            <View
                              key={loc.id}
                              style={{
                                flexDirection: 'row', alignItems: 'center',
                                backgroundColor: '#114b3c10',
                                borderRadius: theme.radii.r8,
                                paddingHorizontal: 6, paddingVertical: 2,
                              }}
                            >
                              <MapPin size={10} color="#114b3c" />
                              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }}>
                                {formatLocationName(orgName, loc.name)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>

                    {FeatureFlags.ENABLE_INTRA_BUSINESS_MESSAGING && String(member.user_id ?? member.id) !== String(useAuthStore.getState().user?.id) && (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation?.();
                          router.push({ pathname: '/message/[id]', params: { id: `internal-${member.user_id ?? member.id}`, recipientId: String(member.user_id ?? member.id), recipientName: memberName } } as never);
                        }}
                        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                        style={{ padding: 4, marginRight: 8 }}
                      >
                        <MessageCircle size={18} color={theme.colors.primary} />
                      </TouchableOpacity>
                    )}
                    {!isOwner && canAccessTeam && (
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation?.(); setMemberMenuId(memberMenuId === userIdKey ? null : userIdKey); }}
                        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                        style={{ padding: 4 }}
                      >
                        <MoreVertical size={18} color={theme.colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </View>

                  {memberMenuId === userIdKey && !isOwner && canAccessTeam && (
                    <ActionMenuCard style={{ marginTop: 10, marginBottom: 10, alignSelf: 'stretch' }}>
                      <ActionMenuItem
                        icon={<PermissionIcon8 size={16} />}
                        label={t('business.profile.permissions')}
                        onPress={() => { setMemberMenuId(null); openPermissionsScreen(memberId, memberName, member.role); }}
                      />
                      <ActionMenuDivider />
                      <ActionMenuItem
                        icon={<RoleIcon8 size={16} />}
                        label={t('business.team.changeRole', { defaultValue: 'Changer le rôle' })}
                        onPress={() => { setMemberMenuId(null); setRoleModalTarget({ userId: member.user_id }); }}
                      />
                      <ActionMenuDivider />
                      <ActionMenuItem
                        icon={<MapPin size={16} color={theme.colors.textSecondary} />}
                        label={t('business.team.manageLocations', { defaultValue: 'Gérer les emplacements' })}
                        onPress={() => { setMemberMenuId(null); setLocationModalTarget({ userId: member.user_id }); }}
                      />
                      <ActionMenuDivider />
                      <ActionMenuItem
                        icon={<Mail size={16} color={theme.colors.textSecondary} />}
                        label={t('business.team.sendEmail', { defaultValue: 'Envoyer un email' })}
                        onPress={() => { setMemberMenuId(null); setEmailTarget({ memberId, memberName: memberName ?? '' }); }}
                      />
                      <ActionMenuDivider />
                      <ActionMenuItem
                        destructive
                        icon={<DeleteIcon8 size={16} />}
                        label={t('business.profile.removeMember')}
                        onPress={() => { setMemberMenuId(null); handleRemoveMember(member.user_id, memberName); }}
                      />
                    </ActionMenuCard>
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Add Member Button (only shown when there are already members and user is admin) */}
            {/* Bottom add member — icon only, centered */}
            {teamPeople.length > 0 && canAccessTeam && (
              <TouchableOpacity
                onPress={handleAddMemberFromLocation}
                accessibilityLabel={t('business.profile.addMember')}
                style={[{
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: theme.spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.divider,
                }]}
              >
                <UserPlus size={18} color={theme.colors.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Orphan Members Section — non-org-admins with no assigned location.
              Bad data that the add-member UI normally blocks, but historical
              rows may have slipped through. One-tap fix via Assigner. */}
          {orphanPeople.length > 0 && canAccessTeam && (
            <View
              style={[{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                marginTop: theme.spacing.lg,
                borderWidth: 1,
                borderColor: theme.colors.warning + '60',
                ...theme.shadows.shadowSm,
              }]}
            >
              <View style={[{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: theme.spacing.lg,
                paddingBottom: theme.spacing.sm,
              }]}>
                <AlertTriangle size={18} color={theme.colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                    {t('business.team.orphanMembersTitle', { defaultValue: 'Membres sans emplacement' })} ({orphanPeople.length})
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                    {t('business.team.orphanMembersNote', { defaultValue: "Aucun emplacement assigné. Assignez-en un pour qu'ils apparaissent dans les filtres d'emplacement." })}
                  </Text>
                </View>
              </View>

              {orphanPeople.map((group) => {
                const member = group.primary;
                const userIdKey = String(member.user_id ?? member.membership_id);
                const memberName = member.name ?? member.user_name ?? member.email?.split('@')[0] ?? '';
                const memberEmail = member.email ?? member.user_email ?? '';
                const initials = getInitials(memberName);
                return (
                  <View
                    key={userIdKey}
                    style={{
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.lg,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.divider,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <View style={{
                      backgroundColor: '#114b3c18',
                      borderRadius: 22, width: 44, height: 44,
                      justifyContent: 'center', alignItems: 'center', flexShrink: 0,
                    }}>
                      <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', lineHeight: 20 }}>
                        {initials}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }}>
                        {memberName || memberEmail}
                        {isMe(member) ? <Text style={{ color: theme.colors.primary, fontWeight: '700' }}> {youSuffix}</Text> : null}
                      </Text>
                      {memberEmail && memberName ? (
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                          {memberEmail}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      onPress={() => setLocationModalTarget({ userId: member.user_id })}
                      style={{
                        backgroundColor: theme.colors.primary,
                        borderRadius: theme.radii.r12,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <MapPin size={14} color="#fff" />
                      <Text style={{ color: '#fff', ...theme.typography.caption, fontWeight: '700' }}>
                        {t('business.team.assignLocationCta', { defaultValue: 'Assigner' })}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Deleted-member archive — only shown to org admins when at least
              one row exists. Cards auto-disappear after the cron purges 30
              days post-deletion, but an admin can dismiss earlier with the X. */}
          {isOrgAdmin && deletedMembers.length > 0 && (
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radii.r16,
                marginTop: theme.spacing.lg,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                ...theme.shadows.shadowSm,
              }}
            >
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                padding: theme.spacing.lg, paddingBottom: theme.spacing.sm,
              }}>
                <Trash2 size={18} color={theme.colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                    {t('team.deletedMembersTitle', { defaultValue: 'Comptes membres supprimés' })} ({deletedMembers.length})
                  </Text>
                </View>
              </View>

              {deletedMembers.map((dm) => {
                const purgeMs = new Date(dm.purge_at).getTime() - Date.now();
                const daysLeft = Math.max(0, Math.ceil(purgeMs / (1000 * 60 * 60 * 24)));
                const memberName = dm.name || dm.email || `#${dm.id}`;
                const initials = getInitials(memberName);
                const roleLabel = dm.was_org_owner
                  ? t('team.roleOwner', { defaultValue: 'Propriétaire' })
                  : dm.role === 'admin'
                    ? (dm.location_id
                        ? t('team.roleLocationAdmin', { defaultValue: 'Admin emplacement' })
                        : t('team.roleOrgAdmin', { defaultValue: "Admin d'organisation" }))
                    : t('team.roleMember', { defaultValue: 'Membre' });

                return (
                  <View
                    key={dm.id}
                    style={{
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.lg,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.divider,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <View style={{
                      backgroundColor: theme.colors.surfaceMuted,
                      borderRadius: 22, width: 44, height: 44,
                      justifyContent: 'center', alignItems: 'center', flexShrink: 0,
                    }}>
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 16, fontWeight: '700', lineHeight: 20, textDecorationLine: 'line-through' }}>
                        {initials}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }} numberOfLines={1}>
                        {memberName}
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }} numberOfLines={1}>
                        {roleLabel}
                        {dm.location_name ? ` · ${dm.location_name}` : ''}
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                        {t('team.deletedMembersPurgeIn', { defaultValue: 'Suppression définitive dans {{days}} j', days: daysLeft })}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => hideDeletedMemberMutation.mutate(dm.id)}
                      disabled={hideDeletedMemberMutation.isPending}
                      style={{
                        padding: 8, borderRadius: 8,
                        opacity: hideDeletedMemberMutation.isPending ? 0.5 : 1,
                      }}
                      accessibilityLabel={t('common.dismiss', { defaultValue: 'Ignorer' })}
                    >
                      <X size={18} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      ) /* end noOrg ternary */
      )}

      {/* ── Add Member Modal ──────────────────────────────────────────────── */}
      <Modal visible={showAddMemberModal} transparent animationType="fade" onRequestClose={() => setShowAddMemberModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddMemberModal(false)}>
          <ScrollView
            style={{ width: '100%', maxWidth: 400, alignSelf: 'center' }}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.modalHeader}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                  {t('business.profile.addMember')}
                </Text>
                <TouchableOpacity onPress={() => { setShowAddMemberModal(false); resetAddMemberForm(); }}>
                  <X size={20} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Name field */}
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, marginTop: theme.spacing.lg }]}
                value={newMemberName}
                onChangeText={setNewMemberName}
                placeholder={t('business.profile.memberName') || 'Full name'}
                placeholderTextColor={theme.colors.muted}
                autoCapitalize="words"
              />

              {/* Email field */}
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, marginTop: theme.spacing.md }]}
                value={newMemberEmail}
                onChangeText={setNewMemberEmail}
                placeholder={t('business.profile.memberEmail')}
                placeholderTextColor={theme.colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {/* Password field */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.md, gap: 8 }}>
                <TextInput
                  style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, flex: 1 }]}
                  value={newMemberPassword}
                  onChangeText={setNewMemberPassword}
                  placeholder={t('business.profile.tempPassword') || 'Temporary password'}
                  placeholderTextColor={theme.colors.muted}
                />
                <TouchableOpacity
                  onPress={() => setNewMemberPassword(generatePassword())}
                  style={[{
                    backgroundColor: theme.colors.bg,
                    borderRadius: theme.radii.r12,
                    paddingHorizontal: 12,
                    height: 48,
                    justifyContent: 'center',
                  }]}
                >
                  <Key size={18} color={theme.colors.primary} />
                </TouchableOpacity>
              </View>

              {/* ── Role Presets ──────────────────────────────────────────── */}
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }}>
                {t('business.profile.memberRole', { defaultValue: 'Rôle' })}
              </Text>

              {ROLE_PRESETS.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <TouchableOpacity
                    key={preset.id}
                    onPress={() => handleSelectPreset(preset)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: theme.spacing.md,
                      borderRadius: theme.radii.r12,
                      marginBottom: theme.spacing.xs,
                      backgroundColor: isSelected ? theme.colors.primary + '12' : theme.colors.bg,
                      borderWidth: isSelected ? 1.5 : 1,
                      borderColor: isSelected ? theme.colors.primary : theme.colors.divider,
                    }}
                  >
                    <View style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      borderWidth: 2,
                      borderColor: isSelected ? theme.colors.primary : theme.colors.muted,
                      backgroundColor: isSelected ? theme.colors.primary : 'transparent',
                      marginRight: 10,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}>
                      {isSelected && (
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' }} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: isSelected ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: isSelected ? '600' : '400' }}>
                        {preset.label}
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 1 }}>
                        {preset.description}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* ── Advanced permissions (expandable) ─────────────────────── */}
              <TouchableOpacity
                onPress={() => setShowAdvancedPermissions((prev) => !prev)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                  {t('business.team.advancedPermissions', { defaultValue: 'Permissions avancées' })}
                </Text>
                {showAdvancedPermissions
                  ? <ChevronUp size={16} color={theme.colors.primary} />
                  : <ChevronDown size={16} color={theme.colors.primary} />
                }
              </TouchableOpacity>

              {showAdvancedPermissions && (
                <View style={{
                  backgroundColor: theme.colors.bg,
                  borderRadius: theme.radii.r12,
                  padding: theme.spacing.md,
                  marginTop: theme.spacing.xs,
                }}>
                  {isNewMemberOrgAdmin && (
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: theme.spacing.sm }}>
                      {t('business.team.orgAdminLockedNote', { defaultValue: "Admin de l'organisation — toutes les permissions sont activées par défaut et ne peuvent pas être modifiées." })}
                    </Text>
                  )}
                  {permissionLabels.map(({ key, label, desc }) => (
                    <View
                      key={key}
                      style={{
                        paddingVertical: theme.spacing.sm,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.divider,
                        opacity: isNewMemberOrgAdmin ? 0.55 : 1,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1, marginRight: 12 }}>
                          {label}
                        </Text>
                        <Switch
                          value={permissionsState[key]}
                          onValueChange={(val) => {
                            if (isNewMemberOrgAdmin) return;
                            setPermissionsState((prev) => ({ ...prev, [key]: val }));
                            // Deselect preset since user customised
                            setSelectedPreset(null);
                          }}
                          disabled={isNewMemberOrgAdmin}
                          // Matches the Switch styling in /settings — solid
                          // primary track on, white thumb on, surface thumb
                          // off (Android only; iOS keeps the native default).
                          trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                          thumbColor={permissionsState[key] ? '#fff' : (Platform.OS === 'android' ? theme.colors.surface : undefined)}
                          ios_backgroundColor={theme.colors.divider}
                        />
                      </View>
                      <Text style={{ color: permissionsState[key] ? theme.colors.textSecondary : theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 }}>
                        {desc}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Location assignment — required for non-org-admin */}
              {locations.length > 0 && !isNewMemberOrgAdmin && (
                <View style={{ marginTop: theme.spacing.md }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginBottom: theme.spacing.sm }}>
                    {t('business.team.assignLocation', { defaultValue: 'Assigner à un emplacement *' })}
                  </Text>
                  {locations.map((loc: any) => (
                    <TouchableOpacity
                      key={loc.id}
                      onPress={() => setNewMemberLocationId(newMemberLocationId === loc.id ? null : loc.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: theme.spacing.md,
                        borderRadius: theme.radii.r12,
                        marginBottom: theme.spacing.xs,
                        backgroundColor: newMemberLocationId === loc.id ? theme.colors.primary + '15' : theme.colors.bg,
                        borderWidth: newMemberLocationId === loc.id ? 1.5 : 1,
                        borderColor: newMemberLocationId === loc.id ? theme.colors.primary : theme.colors.divider,
                      }}
                    >
                      <MapPin size={14} color={theme.colors.primary} />
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 8 }}>
                        {loc.name ?? loc.address ?? 'Location'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {!newMemberLocationId && (
                    <Text style={{ color: theme.colors.error, fontSize: 11, marginTop: 4 }}>
                      {t('business.profile.locationRequired', { defaultValue: 'Veuillez sélectionner un emplacement' })}
                    </Text>
                  )}
                </View>
              )}

              {/* Submit */}
              <TouchableOpacity
                onPress={() => addMemberMutation.mutate()}
                disabled={addMemberMutation.isPending || !canAddMember}
                style={[{
                  backgroundColor: !canAddMember ? theme.colors.muted : theme.colors.primary,
                  borderRadius: theme.radii.r12,
                  padding: theme.spacing.lg,
                  marginTop: theme.spacing.lg,
                }]}
              >
                {addMemberMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                    {t('common.add')}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableOpacity>
      </Modal>

      {/* ── Permissions Modal ─────────────────────────────────────────────── */}
      {/* ── Add Location Modal ────────────────────────────────────────────── */}
      <Modal visible={showAddLocationModal} transparent animationType="fade" onRequestClose={() => setShowAddLocationModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddLocationModal(false)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg, maxWidth: 420, width: '100%' }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                {t('business.team.addLocation', { defaultValue: 'Ajouter un emplacement' })}
              </Text>
              <TouchableOpacity onPress={() => { setShowAddLocationModal(false); setNewLocationName(''); setNewLocationAddress(''); setNewLocationCategory(''); }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: theme.spacing.sm, lineHeight: 18 }}>
              {t('business.team.addLocationDesc', { defaultValue: 'Ajoutez un nouvel emplacement pour votre organisation. Les informations seront vérifiées par notre équipe.' })}
            </Text>

            <Text style={{ color: '#114b3c', ...theme.typography.caption, fontWeight: '600', marginTop: theme.spacing.lg, marginBottom: 6, textTransform: 'none', letterSpacing: 0.5 }}>
              {t('business.team.locationName', { defaultValue: 'Nom' })} *
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, borderWidth: 1, borderColor: theme.colors.divider }]}
              value={newLocationName}
              onChangeText={setNewLocationName}
              placeholder={t('business.team.locationNamePlaceholder', { defaultValue: 'Ex: La Goulette' })}
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="words"
            />

            <Text style={{ color: '#114b3c', ...theme.typography.caption, fontWeight: '600', marginTop: theme.spacing.lg, marginBottom: 6, textTransform: 'none', letterSpacing: 0.5 }}>
              {t('business.team.locationAddress', { defaultValue: 'Adresse' })} *
            </Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, borderWidth: 1, borderColor: theme.colors.divider }]}
              value={newLocationAddress}
              onChangeText={setNewLocationAddress}
              placeholder={t('business.team.locationAddressPlaceholder', { defaultValue: 'Ex: 12 Rue de la République, Tunis' })}
              placeholderTextColor={theme.colors.muted}
            />

            <Text style={{ color: '#114b3c', ...theme.typography.caption, fontWeight: '600', marginTop: theme.spacing.lg, marginBottom: 6, textTransform: 'none', letterSpacing: 0.5 }}>
              {t('business.profile.category', { defaultValue: 'Catégorie' })}
            </Text>
            {/* Dropdown-style category selector */}
            <View style={{
              backgroundColor: theme.colors.bg,
              borderRadius: theme.radii.r12,
              borderWidth: 1,
              borderColor: newLocationCategory ? '#114b3c40' : theme.colors.divider,
              overflow: 'hidden',
            }}>
              {LOCATION_CATEGORIES.map((cat, idx) => {
                const isActive = newLocationCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setNewLocationCategory(isActive ? '' : cat)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderTopWidth: idx > 0 ? 1 : 0,
                      borderTopColor: theme.colors.divider,
                      backgroundColor: isActive ? '#114b3c10' : 'transparent',
                    }}
                  >
                    <View style={{
                      width: 18, height: 18, borderRadius: 9,
                      borderWidth: 2,
                      borderColor: isActive ? '#114b3c' : theme.colors.muted,
                      backgroundColor: isActive ? '#114b3c' : 'transparent',
                      justifyContent: 'center', alignItems: 'center',
                      marginRight: 10,
                    }}>
                      {isActive && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />}
                    </View>
                    <Text style={{ color: isActive ? '#114b3c' : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: isActive ? '600' : '400' }}>
                      {t(`categories.${cat}`, { defaultValue: cat })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Admin approval note */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.colors.primary + '08', borderRadius: theme.radii.r12, padding: 12, marginTop: theme.spacing.lg, gap: 8 }}>
              <ShieldCheck size={16} color={theme.colors.primary} style={{ marginTop: 1 }} />
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1, lineHeight: 17 }}>
                {t('business.team.adminApprovalNote', { defaultValue: 'L\'ajout de ce nouvel emplacement sera soumis à validation par notre équipe admin.' })}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => addLocationMutation.mutate()}
              disabled={addLocationMutation.isPending || !newLocationName.trim() || !newLocationAddress.trim()}
              style={[{
                backgroundColor: (!newLocationName.trim() || !newLocationAddress.trim()) ? theme.colors.muted : theme.colors.primary,
                borderRadius: theme.radii.r12,
                padding: theme.spacing.lg,
                marginTop: theme.spacing.lg,
              }]}
            >
              {addLocationMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                  {t('business.team.submitLocation', { defaultValue: 'Soumettre la demande' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Shared role / location modals (same components the member-detail
          page uses) so the dropdown options match the detail-page menu. Both
          now operate on a user_id + all their memberships, not a single row. */}
      {(() => {
        const target = roleModalTarget;
        const userMems = target ? members.filter((m: any) => String(m.user_id) === String(target.userId)) : [];
        const primary = userMems[0];
        const perms = primary?.permissions
          ? (typeof primary.permissions === 'string' ? JSON.parse(primary.permissions) : primary.permissions)
          : {};
        return (
          <TeamRoleChangeModal
            visible={!!target}
            onClose={() => setRoleModalTarget(null)}
            orgId={orgId}
            userId={target?.userId}
            memberships={userMems}
            locations={locations}
            currentEmail={primary?.email ?? (primary as any)?.user_email ?? ''}
            currentName={primary?.name ?? (primary as any)?.user_name ?? ''}
            currentPermissions={perms as Record<string, string>}
          />
        );
      })()}
      {(() => {
        const target = locationModalTarget;
        const userMems = target ? members.filter((m: any) => String(m.user_id) === String(target.userId)) : [];
        const primary = userMems[0];
        const perms = primary?.permissions
          ? (typeof primary.permissions === 'string' ? JSON.parse(primary.permissions) : primary.permissions)
          : {};
        const primaryRole: 'admin' | 'member' = (primary?.role === 'admin' ? 'admin' : 'member');
        return (
          <TeamLocationsManagerModal
            visible={!!target}
            onClose={() => setLocationModalTarget(null)}
            orgId={orgId}
            userId={target?.userId}
            memberships={userMems}
            locations={locations}
            currentRole={primaryRole}
            currentPermissions={perms as Record<string, string>}
            currentEmail={primary?.email ?? (primary as any)?.user_email ?? ''}
            currentName={primary?.name ?? (primary as any)?.user_name ?? ''}
          />
        );
      })()}

      {/* ── Delete Location Confirmation ──────────────────────────────────
          Bottom-sheet pattern with decoupled animations: the backdrop just
          FADES (no slide), the sheet slides up. The grab-handle bar is
          pan-responsive — drag down to dismiss — and tapping anywhere on
          the dimmed backdrop also dismisses. Same affordances the rest of
          the app's bottom sheets use, just rolled into this one inline. */}
      <DeleteLocationSheet
        target={deleteLocationTarget}
        onClose={() => setDeleteLocationTarget(null)}
        onConfirm={() => {
          if (deleteLocationTarget) deleteLocationMutation.mutate(deleteLocationTarget.id);
          setDeleteLocationTarget(null);
        }}
        insetsBottom={insets.bottom}
        theme={theme}
        t={t}
      />

      {/* Shared remove dialog — scope comes from the location filter the admin
          is currently viewing. When filtered, only that membership is removed
          (with a warning if it's the user's last one); when unfiltered, all
          memberships go in one pass. A secondary button lets the admin escape
          scope and remove-from-all even mid-filter. */}
      {(() => {
        const target = removeMemberTarget;
        const userMems = target ? members.filter((m: any) => String(m.user_id) === String(target.userId)) : [];
        return (
          <TeamRemoveMemberDialog
            visible={!!target}
            onClose={() => setRemoveMemberTarget(null)}
            orgId={orgId}
            memberName={target?.name ?? ''}
            memberships={userMems}
            scopedLocationId={selectedLocation ?? null}
            locations={locations}
          />
        );
      })()}

      {/* ── Create Org Modal ──────────────────────────────────────────────── */}
      <Modal visible={showCreateOrgModal} transparent animationType="fade" onRequestClose={() => setShowCreateOrgModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowCreateOrgModal(false)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                {t('business.team.createOrg', { defaultValue: 'Create Organization' })}
              </Text>
              <TouchableOpacity onPress={() => setShowCreateOrgModal(false)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, marginTop: theme.spacing.lg }]}
              value={newOrgName}
              onChangeText={setNewOrgName}
              placeholder={t('business.team.orgNamePlaceholder', { defaultValue: 'Organization name' })}
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="words"
            />
            <TouchableOpacity
              onPress={() => createOrgMutation.mutate()}
              disabled={createOrgMutation.isPending || !newOrgName.trim()}
              style={[{
                backgroundColor: !newOrgName.trim() ? theme.colors.muted : theme.colors.primary,
                borderRadius: theme.radii.r12,
                padding: theme.spacing.lg,
                marginTop: theme.spacing.lg,
              }]}
            >
              {createOrgMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                  {t('common.create', { defaultValue: 'Create' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Send Email Modal ── */}
      <Modal visible={!!emailTarget} transparent animationType="fade" onRequestClose={() => setEmailTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 380 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                {t('business.team.sendEmailTo', { name: emailTarget?.memberName, defaultValue: `Email à ${emailTarget?.memberName ?? ''}` })}
              </Text>
              <TouchableOpacity onPress={() => setEmailTarget(null)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#114b3c', fontSize: 13, fontWeight: '700', textTransform: 'none', letterSpacing: 0.5, marginBottom: 6 }}>
              {t('business.team.emailSubject', { defaultValue: 'Sujet' })}
            </Text>
            <TextInput
              style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 12, color: theme.colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: theme.colors.divider, marginBottom: 14 }}
              value={emailSubject}
              onChangeText={setEmailSubject}
              placeholder={t('business.team.emailSubjectPlaceholder', { defaultValue: 'Sujet de l\'email...' })}
              placeholderTextColor={theme.colors.muted}
            />
            <Text style={{ color: '#114b3c', fontSize: 13, fontWeight: '700', textTransform: 'none', letterSpacing: 0.5, marginBottom: 6 }}>
              {t('business.team.emailBody', { defaultValue: 'Message' })}
            </Text>
            <TextInput
              style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 12, color: theme.colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: theme.colors.divider, minHeight: 120, textAlignVertical: 'top' }}
              value={emailBody}
              onChangeText={setEmailBody}
              placeholder={t('business.team.emailBodyPlaceholder', { defaultValue: 'Écrivez votre message...' })}
              placeholderTextColor={theme.colors.muted}
              multiline
            />
            <TouchableOpacity
              onPress={async () => {
                if (!emailSubject.trim() || !emailBody.trim() || !orgId || !emailTarget) return;
                setEmailSending(true);
                try {
                  await sendMemberEmail(orgId, emailTarget.memberId, emailSubject.trim(), emailBody.trim());
                  alert.showAlert(t('common.success'), t('business.team.emailSent', { defaultValue: 'Email envoyé avec succès.' }));
                  setEmailTarget(null);
                  setEmailSubject('');
                  setEmailBody('');
                } catch (err: any) {
                  alert.showAlert(t('common.error'), getErrorMessage(err));
                }
                setEmailSending(false);
              }}
              disabled={emailSending || !emailSubject.trim() || !emailBody.trim()}
              style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18, opacity: emailSending || !emailSubject.trim() || !emailBody.trim() ? 0.5 : 1 }}
            >
              <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 15 }}>
                {emailSending ? t('common.loading') : t('business.team.sendEmailBtn', { defaultValue: 'Envoyer' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Walkthrough overlay — renders the team-tour halos on this pushed
          Stack screen (the (business) layout overlay sits beneath the
          stack push so it'd otherwise be invisible here). */}
      <SubScreenWalkthroughOverlay keys={['teamOrgCard', 'teamLocationsSection', 'teamMembersSection', 'teamAddLocationBtn', 'teamAddMemberBtn']} />
    </SafeAreaView>
  );
}

/**
 * Bottom-sheet variant of the delete-location confirm.
 *
 * Decoupled animations: the backdrop fades to 0.45 alpha without sliding,
 * the sheet rides an `Animated.spring` translateY from off-screen to 0.
 * Built on Modal animationType="none" because RN's slide preset slides
 * the WHOLE Modal (backdrop included) — the user noticed the dim mask
 * crawling up with the sheet and asked for the standard "fade-in scrim
 * + slide-up sheet" combo.
 *
 * Dismiss affordances:
 *   • Tap the dim backdrop → close.
 *   • Drag the grab-handle (or anywhere in the sheet header area) down
 *     past a small threshold OR with a downward fling velocity → close.
 *   • Cancel / Supprimer buttons → close (with the appropriate action).
 *   • OS back / swipe-from-edge → close.
 *
 * The `target` prop drives mount. When it becomes null we play the exit
 * animation, then unmount the Modal one beat later so the slide-down
 * actually plays instead of the Modal vanishing instantly.
 */
function DeleteLocationSheet({
  target,
  onClose,
  onConfirm,
  insetsBottom,
  theme,
  t,
}: {
  target: { id: number; name: string } | null;
  onClose: () => void;
  onConfirm: () => void;
  insetsBottom: number;
  theme: any;
  t: (k: string, opts?: any) => string;
}) {
  // SHEET_OFFSCREEN is just a generous off-screen offset — the sheet's
  // own height takes over once the spring lands at 0.
  const SHEET_OFFSCREEN = 600;
  const [mounted, setMounted] = React.useState(false);
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;
  const sheetTranslateY = React.useRef(new Animated.Value(SHEET_OFFSCREEN)).current;

  // Sync `mounted` with `target`. On open we mount + animate in. On close
  // we animate out first, then unmount one beat later so the slide-down
  // is visible (unmounting immediately would just blink the sheet away).
  React.useEffect(() => {
    if (target) {
      setMounted(true);
      backdropOpacity.setValue(0);
      sheetTranslateY.setValue(SHEET_OFFSCREEN);
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(sheetTranslateY, { toValue: 0, friction: 12, tension: 80, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(sheetTranslateY, { toValue: SHEET_OFFSCREEN, duration: 220, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Pan-down-to-dismiss. The handle area + the sheet's top region
  // capture the gesture; the buttons further down still receive taps
  // because the responder only claims movement gestures (dy > 8).
  const panResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => {
      if (g.dy > 0) sheetTranslateY.setValue(g.dy);
    },
    onPanResponderRelease: (_e, g) => {
      // Generous dismiss thresholds: 90 px drop OR a downward fling.
      if (g.dy > 90 || g.vy > 0.8) {
        onClose();
      } else {
        Animated.spring(sheetTranslateY, { toValue: 0, friction: 12, tension: 80, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(sheetTranslateY, { toValue: 0, friction: 12, tension: 80, useNativeDriver: true }).start();
    },
  }), [sheetTranslateY, onClose]);

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        {/* Backdrop — fades in, no slide. Tap to dismiss. */}
        <Animated.View
          pointerEvents="auto"
          style={{
            ...StyleSheet.absoluteFillObject,
            backgroundColor: 'rgba(0,0,0,0.45)',
            opacity: backdropOpacity,
          }}
        >
          <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>

        {/* Sheet — slides up via animated translateY, sits at the bottom. */}
        <Animated.View
          {...panResponder.panHandlers}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            transform: [{ translateY: sheetTranslateY }],
          }}
        >
          <PaperSurface
            radius={24}
            shadow="lg"
            style={{
              width: '100%',
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingTop: 10,
              paddingHorizontal: 24,
              paddingBottom: insetsBottom + 20,
              alignItems: 'center',
            }}
          >
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.divider, marginBottom: 16 }} />
            <View style={{ backgroundColor: theme.colors.surfaceMuted, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Trash2 size={26} color={theme.colors.textSecondary} />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 8 }}>
              {t('business.team.deleteLocation', { defaultValue: "Supprimer l'emplacement" })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', lineHeight: 22, marginBottom: 12 }}>
              {t('business.team.deleteLocationConfirm', { defaultValue: 'Êtes-vous sûr de vouloir supprimer' })} <Text style={{ fontWeight: '700' }}>{target?.name}</Text> ?
            </Text>
            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, textAlign: 'center', lineHeight: 18, marginBottom: 24 }}>
              {t('business.team.deleteLocationNote', { defaultValue: "L'emplacement et ses paniers seront masqués. Les commandes passées et les conversations clients restent accessibles à des fins d'historique." })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
              <TouchableOpacity
                onPress={onClose}
                style={{ flex: 1, backgroundColor: theme.colors.bg, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider }}
              >
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' }}>
                  {t('common.cancel', { defaultValue: 'Annuler' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onConfirm}
                style={{ flex: 1, backgroundColor: theme.colors.error, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                  {t('common.delete', { defaultValue: 'Supprimer' })}
                </Text>
              </TouchableOpacity>
            </View>
          </PaperSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalInput: {
    height: 48,
    paddingHorizontal: 16,
  },
});
