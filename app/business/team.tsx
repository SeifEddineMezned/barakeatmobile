import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Switch, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { X, UserPlus, Trash2, Shield, Users, MapPin, Crown, ShieldCheck, Key, Plus } from 'lucide-react-native';
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

type PermissionKey = 'availability' | 'reservations' | 'profile' | 'menu' | 'team';

// Backend stores permission values as strings: 'write', 'read', 'none'
function permStringToBool(val: string | boolean | undefined): boolean {
  if (typeof val === 'boolean') return val;
  return val === 'write' || val === 'read';
}

function permBoolToString(val: boolean): string {
  return val ? 'write' : 'none';
}

export default function TeamScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

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
        return { color: '#2563eb', bg: '#2563eb15', label: t('business.profile.admin'), icon: ShieldCheck };
      default:
        return { color: '#ea580c', bg: '#ea580c15', label: t('business.profile.restricted'), icon: Shield };
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
    setShowAddMemberModal(true);
  };

  const canAddMember = newMemberName.trim() && newMemberEmail.trim() && newMemberPassword;

  // ── Render ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <X size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' as const }]}>
            {t('business.profile.teamManagement')}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centered}><ActivityIndicator size="large" color={theme.colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <X size={24} color={theme.colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' as const }]}>
            {t('business.profile.teamManagement')}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.centered}>
          <Text style={[{ color: theme.colors.error, ...theme.typography.body, textAlign: 'center', marginBottom: 16 }]}>
            {t('common.errorOccurred')}
          </Text>
          <TouchableOpacity
            onPress={() => { void contextQuery.refetch(); void orgDetailsQuery.refetch(); }}
            style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, paddingHorizontal: 24, paddingVertical: 12 }}
          >
            <Text style={{ color: '#fff', ...theme.typography.bodySm, fontWeight: '600' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <X size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' as const }]}>
          {org?.name ?? t('business.profile.teamManagement')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* No-org state: prompt to create */}
      {noOrg ? (
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

          {/* Locations */}
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

            {displayedMembers.map((member: any, index: number) => {
              // Backend returns membership_id as the unique id for org membership rows
              const memberId = String(member.membership_id ?? member.id ?? index);
              const memberRole = member.role ?? 'member';
              // Backend joins users table: returns name, email directly
              const memberName = member.name ?? member.user_name ?? '';
              const memberEmail = member.email ?? member.user_email ?? '';
              const badge = getRoleBadge(memberRole);
              const BadgeIcon = badge.icon;
              const isOwner = memberRole === 'owner';

              return (
                <View
                  key={memberId}
                  style={[{
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.divider,
                  }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[{
                      backgroundColor: badge.bg,
                      borderRadius: 20,
                      width: 40,
                      height: 40,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }]}>
                      <BadgeIcon size={18} color={badge.color} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
                        {memberName}
                      </Text>
                      <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 1 }]}>
                        {memberEmail}
                      </Text>
                    </View>
                    <View style={[{
                      backgroundColor: badge.bg,
                      borderRadius: theme.radii.pill,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }]}>
                      <Text style={[{ color: badge.color, ...theme.typography.caption, fontWeight: '600' as const }]}>
                        {badge.label}
                      </Text>
                    </View>
                  </View>

                  {/* Action buttons for owner/admin on non-owner members */}
                  {!isOwner && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: theme.spacing.sm, marginLeft: 52, gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => handleChangeRole(memberId, memberRole)}
                        style={[{
                          backgroundColor: theme.colors.bg,
                          borderRadius: theme.radii.r8,
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                        }]}
                      >
                        <ShieldCheck size={14} color={theme.colors.primary} />
                        <Text style={[{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
                          {memberRole === 'admin' ? t('business.profile.restricted') : t('business.profile.admin')}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => handleOpenPermissions(memberId, member.permissions)}
                        style={[{
                          backgroundColor: theme.colors.bg,
                          borderRadius: theme.radii.r8,
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                        }]}
                      >
                        <Shield size={14} color={theme.colors.textSecondary} />
                        <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
                          {t('business.profile.permissions')}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => handleRemoveMember(memberId, memberName)}
                        style={[{
                          backgroundColor: theme.colors.error + '10',
                          borderRadius: theme.radii.r8,
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                        }]}
                      >
                        <Trash2 size={14} color={theme.colors.error} />
                        <Text style={[{ color: theme.colors.error, ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
                          {t('business.profile.removeMember')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}

            {/* Add Member Button */}
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
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Add Member Modal */}
      <Modal visible={showAddMemberModal} transparent animationType="fade" onRequestClose={() => setShowAddMemberModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowAddMemberModal(false)}>
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

            {/* Name field (required by backend) */}
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

            {/* Temporary password field (required by backend) */}
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

            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }]}>
              {t('business.profile.memberRole')}
            </Text>

            {(['admin', 'member'] as const).map((role) => {
              const isSelected = newMemberRole === role;
              const roleColor = role === 'admin' ? '#2563eb' : '#ea580c';
              const roleLabel = role === 'admin' ? t('business.profile.admin') : t('business.profile.restricted');
              return (
                <TouchableOpacity
                  key={role}
                  onPress={() => setNewMemberRole(role)}
                  style={[{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: theme.spacing.md,
                    borderRadius: theme.radii.r12,
                    marginBottom: theme.spacing.xs,
                    backgroundColor: isSelected ? roleColor + '15' : theme.colors.bg,
                    borderWidth: isSelected ? 1.5 : 0,
                    borderColor: roleColor,
                  }]}
                >
                  <Shield size={16} color={roleColor} />
                  <Text style={[{ color: isSelected ? roleColor : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: isSelected ? ('600' as const) : ('400' as const), marginLeft: 10 }]}>
                    {roleLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {locations.length > 0 && !selectedLocation && (
              <View style={{ marginTop: theme.spacing.md }}>
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: theme.spacing.sm }}>
                  {t('business.team.assignLocation', { defaultValue: 'Assign to Location' })}
                </Text>
                {locations.map((loc: any) => (
                  <TouchableOpacity
                    key={loc.id}
                    onPress={() => setNewMemberLocationId(loc.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: theme.spacing.md,
                      borderRadius: theme.radii.r12,
                      marginBottom: theme.spacing.xs,
                      backgroundColor: newMemberLocationId === loc.id ? theme.colors.primary + '15' : theme.colors.bg,
                      borderWidth: newMemberLocationId === loc.id ? 1.5 : 0,
                      borderColor: theme.colors.primary,
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
        </TouchableOpacity>
      </Modal>

      {/* Permissions Modal */}
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

      {/* Add Location Modal */}
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
