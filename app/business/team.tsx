import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Switch, Alert, ActivityIndicator, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { X, UserPlus, Trash2, Shield, Users, MapPin, Crown, ShieldCheck, Key, Plus, ChevronDown, ChevronUp, List, GitBranch, Mail } from 'lucide-react-native';
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
  type OrgDetailsFromAPI,
} from '@/src/services/teams';
import { getErrorMessage } from '@/src/lib/api';
import { FeatureFlags } from '@/src/lib/featureFlags';

type PermissionKey = 'availability' | 'reservations' | 'profile' | 'menu' | 'team';

// Backend stores permission values as strings: 'write', 'read', 'none'
function permStringToBool(val: string | boolean | undefined): boolean {
  if (typeof val === 'boolean') return val;
  return val === 'write' || val === 'read';
}

function permBoolToString(val: boolean): string {
  return val ? 'write' : 'none';
}

// ── Role Preset Definitions ─────────────────────────────────────────────────
type RolePreset = 'full_access' | 'orders_only' | 'view_only';

interface PresetConfig {
  id: RolePreset;
  label: string;
  description: string;
  role: 'admin' | 'member';
  permissions: Record<PermissionKey, boolean>;
}

const ROLE_PRESETS: PresetConfig[] = [
  {
    id: 'full_access',
    label: 'Full Access',
    description: 'Can manage everything',
    role: 'admin',
    permissions: { availability: true, reservations: true, profile: true, menu: true, team: true },
  },
  {
    id: 'orders_only',
    label: 'Orders Only',
    description: 'Can manage reservations only',
    role: 'member',
    permissions: { availability: false, reservations: true, profile: false, menu: false, team: false },
  },
  {
    id: 'view_only',
    label: 'View Only',
    description: 'Read-only access to everything',
    role: 'member',
    permissions: { availability: true, reservations: true, profile: true, menu: true, team: true },
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
  const orgName = org?.name ?? t('business.team.orgLabel');

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
  const levelAnim = useRef(new Animated.Value(1)).current;

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
        const name: string = m.name ?? m.user_name ?? m.email ?? '?';
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
            <View
              onStartShouldSetResponder={() => true}
              style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24 }}
            >
              {/* Handle */}
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#e0e0e0', alignSelf: 'center', marginBottom: 20 }} />

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
            </View>
          </TouchableOpacity>
        ) : null}
      </Modal>
    </View>
  );
}

export default function TeamScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<'list' | 'chart'>('list');
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  // Add-member form state (backend requires name, email, password)
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'admin' | 'member'>('member');
  const [newMemberLocationId, setNewMemberLocationId] = useState<number | null>(null);
  const [permissionsState, setPermissionsState] = useState<Record<PermissionKey, boolean>>({
    availability: true,
    reservations: true,
    profile: false,
    menu: false,
    team: false,
  });

  // Role preset state for add-member modal
  const [selectedPreset, setSelectedPreset] = useState<RolePreset | null>('orders_only');
  const [showAdvancedPermissions, setShowAdvancedPermissions] = useState(false);

  // Add-location modal state
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');

  // Create-org modal state (shown when user has no organization)
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');

  // Step 1: Get the user's org context (which org they belong to)
  const contextQuery = useQuery({
    queryKey: ['team-context'],
    queryFn: fetchMyContext,
    staleTime: 60_000,
  });

  const orgId = contextQuery.data?.organization_id;
  const hasOrg = !!orgId;

  // Step 2: Fetch full org details (org + members + locations) in ONE call
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: hasOrg,
    staleTime: 60_000,
  });

  const orgDetails: OrgDetailsFromAPI | undefined = orgDetailsQuery.data;
  const org = orgDetails?.organization;
  const members = orgDetails?.members ?? [];
  const locations = orgDetails?.locations ?? [];

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
      void queryClient.invalidateQueries({ queryKey: ['team-context'] });
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      setShowCreateOrgModal(false);
      setNewOrgName('');
      Alert.alert(t('common.success'), t('business.team.orgCreated', { defaultValue: 'Organization created!' }));
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No organization');
      const locationId = newMemberLocationId ?? selectedLocation ?? undefined;
      // Build permissions payload from current state
      const permsPayload: Record<string, string> = {
        availability: permBoolToString(permissionsState.availability),
        reservations: permBoolToString(permissionsState.reservations),
        profile: permBoolToString(permissionsState.profile),
        menu: permBoolToString(permissionsState.menu),
        team: permBoolToString(permissionsState.team),
      };
      return addMember(orgId, {
        email: newMemberEmail.trim(),
        name: newMemberName.trim(),
        password: newMemberPassword,
        role: newMemberRole,
        ...(locationId ? { location_id: locationId } : {}),
      });
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      void queryClient.invalidateQueries({ queryKey: ['team-context'] });
      setShowAddMemberModal(false);
      resetAddMemberForm();
      // Show the temporary password so the owner can share it
      const tempPw = data?.temporary_password || newMemberPassword;
      Alert.alert(
        t('common.success'),
        `${t('business.profile.memberAdded')}\n\n${t('business.profile.memberEmail')}: ${newMemberEmail.trim()}\n${t('business.team.tempPasswordLabel', { defaultValue: 'Password' })}: ${tempPw}`
      );
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
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
    onError: (err: any) => {
      Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
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
    onError: (err: any) => {
      Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
    },
  });

  const addLocationMutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No organization');
      return addLocation(orgId, {
        name: newLocationName.trim() || undefined,
        address: newLocationAddress.trim() || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      setShowAddLocationModal(false);
      setNewLocationName('');
      setNewLocationAddress('');
      Alert.alert(
        t('common.success'),
        t('business.team.locationAdded', { defaultValue: 'Location added successfully.' })
      );
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
    },
  });

  const handleRemoveMember = useCallback((memberId: string, memberName: string) => {
    Alert.alert(
      t('business.profile.removeMember'),
      memberName,
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => removeMemberMutation.mutate(memberId) },
      ]
    );
  }, [removeMemberMutation, t]);

  const handleChangeRole = useCallback((memberId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    updateMemberMutation.mutate({ memberId, role: newRole });
  }, [updateMemberMutation]);

  const handleOpenPermissions = useCallback((memberId: string, currentPermissions?: Record<string, any>) => {
    setPermissionsState({
      availability: permStringToBool(currentPermissions?.availability),
      reservations: permStringToBool(currentPermissions?.reservations),
      profile: permStringToBool(currentPermissions?.profile),
      menu: permStringToBool(currentPermissions?.menu),
      team: permStringToBool(currentPermissions?.team),
    });
    setShowPermissionsModal(memberId);
  }, []);

  const handleSavePermissions = useCallback(() => {
    if (!showPermissionsModal) return;
    const member = members.find((m: any) => String(m.membership_id) === showPermissionsModal);
    // Convert booleans back to the string format the backend expects
    const permsPayload: Record<string, string> = {
      availability: permBoolToString(permissionsState.availability),
      reservations: permBoolToString(permissionsState.reservations),
      profile: permBoolToString(permissionsState.profile),
      menu: permBoolToString(permissionsState.menu),
      team: permBoolToString(permissionsState.team),
    };
    updateMemberMutation.mutate({
      memberId: showPermissionsModal,
      role: member?.role ?? 'member',
      permissions: permsPayload,
    });
    setShowPermissionsModal(null);
  }, [showPermissionsModal, permissionsState, updateMemberMutation, members]);

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'owner':
        return { color: '#16a34a', bg: '#16a34a15', label: t('business.team.owner', { defaultValue: 'Owner' }), icon: Crown };
      case 'admin':
        return { color: theme.colors.primary, bg: theme.colors.primary + '20', label: t('business.team.admin'), icon: ShieldCheck };
      default:
        return { color: theme.colors.muted, bg: theme.colors.muted + '25', label: t('business.team.member'), icon: Shield };
    }
  };

  const isLoading = contextQuery.isLoading || (hasOrg && orgDetailsQuery.isLoading);
  const isError = contextQuery.isError || (hasOrg && orgDetailsQuery.isError);
  const noOrg = !isLoading && !isError && !hasOrg;

  const permissionLabels: { key: PermissionKey; label: string }[] = [
    { key: 'availability', label: t('business.availability.title') },
    { key: 'reservations', label: t('business.orders.title') },
    { key: 'profile', label: t('business.profile.title') },
    { key: 'menu', label: t('business.profile.menuItems') },
    { key: 'team', label: t('business.profile.teamManagement') },
  ];

  const displayedMembers = selectedLocation
    ? members.filter((m: any) => m.location_id === selectedLocation)
    : members;

  const handleAddMemberFromLocation = () => {
    if (selectedLocation) {
      setNewMemberLocationId(selectedLocation);
    }
    setNewMemberPassword(generatePassword());
    // Apply default preset
    const defaultPreset = ROLE_PRESETS.find((p) => p.id === 'orders_only')!;
    setSelectedPreset(defaultPreset.id);
    setNewMemberRole(defaultPreset.role);
    setPermissionsState(defaultPreset.permissions);
    setShowAddMemberModal(true);
  };

  const canAddMember = newMemberName.trim() && newMemberEmail.trim() && newMemberPassword;

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
        <X size={24} color={theme.colors.textPrimary} />
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
            <GitBranch size={22} color={theme.colors.textPrimary} />
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
        <View style={styles.centered}><ActivityIndicator size="large" color={theme.colors.primary} /></View>
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
      {renderHeader(org?.name ?? t('business.profile.teamManagement'))}

      {/* Org chart view (alternative to list) */}
      {viewMode === 'chart' && FeatureFlags.ENABLE_TEAM_ORG_CHART ? (
        <OrgChartView org={orgDetailsQuery.data} userRole={contextQuery.data?.role ?? 'owner'} />
      ) : (
      /* No-org state: prompt to create */
      noOrg ? (
        <ScrollView contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Users size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, marginTop: 20, textAlign: 'center' }}>
            {t('business.team.noOrgTitle', { defaultValue: 'No Organization Yet' })}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginTop: 10, textAlign: 'center' }}>
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
            }}
          >
            <Plus size={18} color="#fff" />
            <Text style={{ color: '#fff', ...theme.typography.button, marginLeft: 8 }}>
              {t('business.team.createOrg', { defaultValue: 'Create Organization' })}
            </Text>
          </TouchableOpacity>

          {/* Create Org Modal */}
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
        </ScrollView>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={{ padding: theme.spacing.xl }} showsVerticalScrollIndicator={false}>
          {/* Organization Info Card */}
          <View style={[{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            padding: theme.spacing.xl,
            ...theme.shadows.shadowSm,
          }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.lg }}>
              <View style={[{
                backgroundColor: theme.colors.primary + '12',
                borderRadius: theme.radii.r12,
                width: 48,
                height: 48,
                justifyContent: 'center',
                alignItems: 'center',
              }]}>
                <Users size={24} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                  {org?.name ?? '--'}
                </Text>
                {org?.category ? (
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
                    {org.category}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={{ flexDirection: 'row' }}>
              <View style={[{
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radii.r12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                flex: 1,
                alignItems: 'center' as const,
                marginRight: 8,
              }]}>
                <Users size={16} color={theme.colors.primary} />
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 4 }]}>
                  {members.length}
                </Text>
                <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
                  {t('business.team.members')}
                </Text>
              </View>
              <View style={[{
                backgroundColor: theme.colors.bg,
                borderRadius: theme.radii.r12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                flex: 1,
                alignItems: 'center' as const,
                marginLeft: 8,
              }]}>
                <MapPin size={16} color={theme.colors.primary} />
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginTop: 4 }]}>
                  {locations.length}
                </Text>
                <Text style={[{ color: theme.colors.muted, ...theme.typography.caption }]}>
                  {t('business.profile.address')}
                </Text>
              </View>
            </View>
          </View>

          {/* Locations Section */}
          {(locations.length > 0 || orgId) && (
            <View style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.r16,
              marginTop: theme.spacing.lg,
              ...theme.shadows.shadowSm,
            }}>
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: theme.spacing.lg,
              }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                  {t('business.team.locations', { defaultValue: 'Locations' })}
                </Text>
                {/* "+" button in Locations section header */}
                <TouchableOpacity
                  onPress={() => setShowAddLocationModal(true)}
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
              </View>

              {/* "All" option to clear location filter */}
              {locations.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSelectedLocation(null)}
                  style={{
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.divider,
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: selectedLocation === null ? theme.colors.primary + '08' : 'transparent',
                  }}
                >
                  <View style={{
                    backgroundColor: theme.colors.primary + '12',
                    borderRadius: 10,
                    width: 36,
                    height: 36,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                    <Users size={18} color={theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' }}>
                      {t('business.dashboard.viewAll', { defaultValue: 'View All' })}
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: theme.colors.bg,
                    borderRadius: 12,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                      {t('business.team.membersCount', { count: members.length, defaultValue: `${members.length} members` })}
                    </Text>
                  </View>
                </TouchableOpacity>
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
                <TouchableOpacity
                  key={loc.id ?? index}
                  onPress={() => setSelectedLocation(loc.id)}
                  style={{
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.divider,
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: selectedLocation === loc.id ? theme.colors.primary + '08' : 'transparent',
                  }}
                >
                  <View style={{
                    backgroundColor: theme.colors.primary + '12',
                    borderRadius: 10,
                    width: 36,
                    height: 36,
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                    <MapPin size={18} color={theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' }}>
                      {loc.name ?? loc.address ?? `Location ${index + 1}`}
                    </Text>
                    {loc.address && loc.name && (
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 1 }}>
                        {loc.address}
                      </Text>
                    )}
                  </View>
                  <View style={{
                    backgroundColor: theme.colors.bg,
                    borderRadius: 12,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                      {t('business.team.membersCount', { count: members.filter((m: any) => m.location_id === loc.id).length, defaultValue: `${members.filter((m: any) => m.location_id === loc.id).length} members` })}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Members Section */}
          <View style={[{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            marginTop: theme.spacing.lg,
            ...theme.shadows.shadowSm,
          }]}>
            <View style={[{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: theme.spacing.lg,
            }]}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                {t('business.team.members')} ({displayedMembers.length})
              </Text>
            </View>

            {/* Zero-member onboarding card */}
            {displayedMembers.length === 0 && (
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
              </View>
            )}

            {/* Member Cards */}
            {displayedMembers.map((member: any, index: number) => {
              const memberId = String(member.membership_id ?? member.id ?? index);
              const memberRole = member.role ?? 'member';
              const memberName = member.name ?? member.user_name ?? '';
              const memberEmail = member.email ?? member.user_email ?? '';
              const badge = getRoleBadge(memberRole);
              const isOwner = memberRole === 'owner';
              const initials = getInitials(memberName);
              const locationName = getLocationName(member.location_id);

              return (
                <View
                  key={memberId}
                  style={{
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.lg,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.divider,
                  }}
                >
                  {/* Top row: avatar + name/badges */}
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {/* Avatar circle with initials */}
                    <View style={{
                      backgroundColor: theme.colors.primary + '20',
                      borderRadius: 22,
                      width: 44,
                      height: 44,
                      justifyContent: 'center',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}>
                      <Text style={{
                        color: theme.colors.primary,
                        fontSize: 16,
                        fontWeight: '700',
                        lineHeight: 20,
                      }}>
                        {initials}
                      </Text>
                    </View>

                    {/* Name + badges */}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                          {memberName || memberEmail}
                        </Text>
                        {/* Role badge pill */}
                        <View style={{
                          backgroundColor: badge.bg,
                          borderRadius: theme.radii.pill,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                        }}>
                          <Text style={{ color: badge.color, ...theme.typography.caption, fontWeight: '600' as const }}>
                            {badge.label}
                          </Text>
                        </View>
                      </View>
                      {/* Email subtitle */}
                      {memberEmail && memberName ? (
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                          {memberEmail}
                        </Text>
                      ) : null}
                      {/* Location badge */}
                      {locationName ? (
                        <View style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginTop: 4,
                          alignSelf: 'flex-start',
                          backgroundColor: theme.colors.bg,
                          borderRadius: theme.radii.r8,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}>
                          <MapPin size={10} color={theme.colors.muted} />
                          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginLeft: 3 }}>
                            {locationName}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {/* Quick action row for non-owner members */}
                  {!isOwner && (
                    <View style={{
                      flexDirection: 'row',
                      marginTop: theme.spacing.md,
                      marginLeft: 56,
                      gap: 8,
                    }}>
                      {/* Permissions button */}
                      <TouchableOpacity
                        onPress={() => handleOpenPermissions(memberId, member.permissions)}
                        style={{
                          flex: 1,
                          backgroundColor: theme.colors.bg,
                          borderRadius: theme.radii.r8,
                          paddingVertical: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: theme.colors.divider,
                        }}
                      >
                        <Shield size={13} color={theme.colors.textSecondary} />
                        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }}>
                          {t('business.profile.permissions')}
                        </Text>
                      </TouchableOpacity>

                      {/* Remove button (destructive red) */}
                      <TouchableOpacity
                        onPress={() => handleRemoveMember(memberId, memberName)}
                        style={{
                          flex: 1,
                          backgroundColor: theme.colors.error + '10',
                          borderRadius: theme.radii.r8,
                          paddingVertical: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: theme.colors.error + '30',
                        }}
                      >
                        <Trash2 size={13} color={theme.colors.error} />
                        <Text style={{ color: theme.colors.error, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }}>
                          {t('business.profile.removeMember')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}

            {/* Add Member Button (only shown when there are already members) */}
            {displayedMembers.length > 0 && (
              <TouchableOpacity
                onPress={handleAddMemberFromLocation}
                style={[{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: theme.spacing.lg,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.divider,
                }]}
              >
                <UserPlus size={18} color={theme.colors.primary} />
                <Text style={[{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '600' as const, marginLeft: 8 }]}>
                  {t('business.profile.addMember')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      ) /* end noOrg ternary */
      )} {/* end viewMode ternary */}

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
                Role
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
                  Advanced Permissions
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
                  {permissionLabels.map(({ key, label }) => (
                    <View
                      key={key}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingVertical: theme.spacing.sm,
                        borderBottomWidth: 1,
                        borderBottomColor: theme.colors.divider,
                      }}
                    >
                      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                        {label}
                      </Text>
                      <Switch
                        value={permissionsState[key]}
                        onValueChange={(val) => {
                          setPermissionsState((prev) => ({ ...prev, [key]: val }));
                          // Deselect preset since user customised
                          setSelectedPreset(null);
                        }}
                        trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }}
                        thumbColor={permissionsState[key] ? theme.colors.primary : theme.colors.muted}
                      />
                    </View>
                  ))}
                </View>
              )}

              {/* Location assignment */}
              {locations.length > 0 && !selectedLocation && (
                <View style={{ marginTop: theme.spacing.md }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginBottom: theme.spacing.sm }}>
                    {t('business.team.assignLocation', { defaultValue: 'Assign to Location' })}
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
      <Modal visible={showPermissionsModal !== null} transparent animationType="fade" onRequestClose={() => setShowPermissionsModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowPermissionsModal(null)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                {t('business.profile.permissions')}
              </Text>
              <TouchableOpacity onPress={() => setShowPermissionsModal(null)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: theme.spacing.md }}>
              {permissionLabels.map(({ key, label }) => (
                <View
                  key={key}
                  style={[{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: theme.spacing.md,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.divider,
                  }]}
                >
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }]}>
                    {label}
                  </Text>
                  <Switch
                    value={permissionsState[key]}
                    onValueChange={(val) => setPermissionsState((prev) => ({ ...prev, [key]: val }))}
                    trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }}
                    thumbColor={permissionsState[key] ? theme.colors.primary : theme.colors.muted}
                  />
                </View>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleSavePermissions}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl }]}
            >
              {updateMemberMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                  {t('common.done')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Add Location Modal ────────────────────────────────────────────── */}
      <Modal visible={showAddLocationModal} transparent animationType="fade" onRequestClose={() => setShowAddLocationModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddLocationModal(false)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
                {t('business.team.addLocation', { defaultValue: 'Add Location' })}
              </Text>
              <TouchableOpacity onPress={() => { setShowAddLocationModal(false); setNewLocationName(''); setNewLocationAddress(''); }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, marginTop: theme.spacing.lg }]}
              value={newLocationName}
              onChangeText={setNewLocationName}
              placeholder={t('business.team.locationName', { defaultValue: 'Location name' })}
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="words"
            />

            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, marginTop: theme.spacing.md }]}
              value={newLocationAddress}
              onChangeText={setNewLocationAddress}
              placeholder={t('business.team.locationAddress', { defaultValue: 'Address' })}
              placeholderTextColor={theme.colors.muted}
            />

            <TouchableOpacity
              onPress={() => addLocationMutation.mutate()}
              disabled={addLocationMutation.isPending || (!newLocationName.trim() && !newLocationAddress.trim())}
              style={[{
                backgroundColor: (!newLocationName.trim() && !newLocationAddress.trim()) ? theme.colors.muted : theme.colors.primary,
                borderRadius: theme.radii.r12,
                padding: theme.spacing.lg,
                marginTop: theme.spacing.lg,
              }]}
            >
              {addLocationMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                  {t('common.add')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
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
