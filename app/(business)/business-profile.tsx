import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, Image, TextInput, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import {
  ChevronRight, MapPin, Clock, Phone, Store,
  Users, UserPlus, Trash2, Shield, CreditCard, Camera, X, UtensilsCrossed
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useBusinessStore, DEFAULT_PERMISSIONS } from '@/src/stores/businessStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMyProfile, fetchMyBaskets } from '@/src/services/business';
import { fetchMyContext, fetchOrganizationDetails, addMember as addMemberAPI, updateMember, removeMember as removeMemberAPI } from '@/src/services/teams';
import * as ImagePicker from 'expo-image-picker';
import type { TeamMember, TeamRole, TeamPermission } from '@/src/types';

export default function BusinessProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const store = useBusinessStore();
  const { team, addTeamMember, removeTeamMember, updateTeamMemberRole } = store;
  const selectedLocationId = useBusinessStore((s) => s.selectedLocationId);
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['my-profile', selectedLocationId],
    queryFn: () => fetchMyProfile(selectedLocationId),
    staleTime: 60_000,
    retry: 1,
  });

  const contextQuery = useQuery({
    queryKey: ['team-context'],
    queryFn: fetchMyContext,
    staleTime: 60_000,
  });

  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', contextQuery.data?.organization_id],
    queryFn: () => fetchOrganizationDetails(contextQuery.data!.organization_id!),
    enabled: !!contextQuery.data?.organization_id,
    staleTime: 60_000,
  });

  // Baskets hold the EFFECTIVE pickup times (updatable via PUT /api/baskets/:id)
  // The locations table pickup_start_time cannot be updated on this backend.
  const basketsQuery = useQuery({
    queryKey: ['my-baskets', selectedLocationId],
    queryFn: () => fetchMyBaskets(selectedLocationId),
    staleTime: 30_000,
  });

  const teamMembers = orgDetailsQuery.data?.members ?? team.map((m: TeamMember) => ({
    membership_id: m.id,
    name: m.name,
    email: m.email,
    role: m.role === 'admin' ? 'admin' : 'member',
    status: 'active',
  }));

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      const orgId = contextQuery.data?.organization_id;
      if (!orgId) throw new Error('No organization');
      // Backend requires name, email, password as mandatory fields
      const tempPassword = Math.random().toString(36).slice(-8);
      return addMemberAPI(orgId, {
        email: newMemberEmail.trim(),
        name: newMemberName.trim(),
        password: tempPassword,
        role: newMemberRole === 'admin' ? 'admin' : 'member',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      setShowAddMemberModal(false);
      setNewMemberName('');
      setNewMemberEmail('');
      Alert.alert(t('common.success'), t('business.profile.memberAdded'));
    },
    onError: (err: any) => {
      Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const orgId = contextQuery.data?.organization_id;
      if (!orgId) throw new Error('No organization');
      await removeMemberAPI(orgId, memberId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
    },
  });

  // Merge API profile data with store defaults
  const profile = profileQuery.data
    ? {
        id: String(profileQuery.data.id),
        name: profileQuery.data.name,
        email: user?.email ?? '',
        phone: profileQuery.data.phone ?? undefined,
        address: profileQuery.data.address ?? '',
        category: profileQuery.data.category ?? '',
        description: profileQuery.data.description ?? undefined,
        logo: profileQuery.data.image_url ?? undefined,
        coverPhoto: profileQuery.data.cover_image_url ?? undefined,
        hours: (() => {
          // Prefer basket pickup times — baskets are updatable via PUT /api/baskets/:id.
          // The locations table times can't be updated (backend bug), so we fall back
          // to location data only when no basket times exist.
          const firstBasket = basketsQuery.data?.[0];
          const start = firstBasket?.pickup_start_time ?? profileQuery.data.pickup_start_time;
          const end = firstBasket?.pickup_end_time ?? profileQuery.data.pickup_end_time;
          return start && end
            ? `${start.substring(0, 5)} - ${end.substring(0, 5)}`
            : undefined;
        })(),
        latitude: profileQuery.data.latitude ?? 0,
        longitude: profileQuery.data.longitude ?? 0,
        isSupermarket: (profileQuery.data.category ?? '').toLowerCase() === 'supermarket',
      }
    : store.profile;
  // Location hours editor state
  const [showHoursModal, setShowHoursModal] = useState(false);
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_LABELS: Record<string, string> = { Mon: t('business.dashboard.days.Mon'), Tue: t('business.dashboard.days.Tue'), Wed: t('business.dashboard.days.Wed'), Thu: t('business.dashboard.days.Thu'), Fri: t('business.dashboard.days.Fri'), Sat: t('business.dashboard.days.Sat'), Sun: t('business.dashboard.days.Sun') };
  // Seed modal from basket times (those are what we actually save)
  const firstBasket = basketsQuery.data?.[0];
  const defaultStart = firstBasket?.pickup_start_time?.substring(0, 5)
    ?? profileQuery.data?.pickup_start_time?.substring(0, 5)
    ?? '09:00';
  const defaultEnd = firstBasket?.pickup_end_time?.substring(0, 5)
    ?? profileQuery.data?.pickup_end_time?.substring(0, 5)
    ?? '18:00';
  const [hoursStart, setHoursStart] = useState(defaultStart);
  const [hoursEnd, setHoursEnd] = useState(defaultEnd);
  const [sameAllDays, setSameAllDays] = useState(true);
  const [dayHours, setDayHours] = useState<Record<string, { start: string; end: string }>>(
    Object.fromEntries(DAYS.map(d => [d, { start: defaultStart, end: defaultEnd }]))
  );
  const [hoursSaving, setHoursSaving] = useState(false);

  const handleSaveHours = async () => {
    setHoursSaving(true);
    try {
      const { updateLocationById } = await import('@/src/services/business');
      const userId = user?.id ? Number(user.id) : undefined;
      const locationId = profileQuery.data?.id;
      if (!locationId) throw new Error('Profil non chargé');
      const toTime = (hhmm: string) => hhmm.includes(':') && hhmm.split(':').length === 2 ? `${hhmm}:00` : hhmm;
      // PUT /api/locations/:id — same pattern as confirmed-working PUT /api/baskets/:id
      await updateLocationById(
        locationId,
        {
          pickup_start_time: toTime(sameAllDays ? hoursStart : dayHours['Mon'].start),
          pickup_end_time: toTime(sameAllDays ? hoursEnd : dayHours['Mon'].end),
        },
        userId,
        profileQuery.data?.organization_id ?? undefined
      );
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      setShowHoursModal(false);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
    } finally {
      setHoursSaving(false);
    }
  };

  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState<string | null>(null);
  const [showPermissionsModal, setShowPermissionsModal] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<TeamRole>('restricted');

  const handleAddMember = useCallback(() => {
    if (!newMemberName.trim() || !newMemberEmail.trim()) return;
    addMemberMutation.mutate();
  }, [newMemberName, newMemberEmail, addMemberMutation]);

  const handleRemoveMember = useCallback((memberId: string) => {
    Alert.alert(
      t('business.profile.removeMember'),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => removeMemberMutation.mutate(memberId) },
      ]
    );
  }, [removeMemberMutation, t]);

  const handleChangeRole = useCallback((memberId: string, role: TeamRole) => {
    const perms: TeamPermission = DEFAULT_PERMISSIONS[role];
    updateTeamMemberRole(memberId, role, perms);
    setShowRoleModal(null);
  }, [updateTeamMemberRole]);

  const handleTogglePermission = useCallback((memberId: string, permKey: keyof TeamPermission) => {
    const member = team.find((m) => m.id === memberId);
    if (!member) return;
    const newPerms: TeamPermission = { ...member.permissions, [permKey]: !member.permissions[permKey] };
    updateTeamMemberRole(memberId, 'custom', newPerms);
  }, [team, updateTeamMemberRole]);

  const handleChangeCover = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 5],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const formData = new FormData();
        const uri = result.assets[0].uri;
        const filename = uri.split('/').pop() ?? 'cover.jpg';
        formData.append('cover_image', { uri, name: filename, type: 'image/jpeg' } as any);
        try {
          const { updateMyProfile } = await import('@/src/services/business');
          const userId = (user as any)?.id as number | undefined;
          await updateMyProfile(formData, userId);
          profileQuery.refetch();
          Alert.alert(t('common.success'), t('business.profile.imageUpdated'));
        } catch (err: any) {
          Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
        }
      }
    } catch {
      Alert.alert(t('common.error'), t('common.errorOccurred'));
    }
  };

  const handleChangeLogo = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const formData = new FormData();
        const uri = result.assets[0].uri;
        const filename = uri.split('/').pop() ?? 'logo.jpg';
        formData.append('image', { uri, name: filename, type: 'image/jpeg' } as any);
        try {
          const { updateMyProfile } = await import('@/src/services/business');
          const userId = (user as any)?.id as number | undefined;
          await updateMyProfile(formData, userId);
          profileQuery.refetch();
          Alert.alert(t('common.success'), t('business.profile.imageUpdated'));
        } catch (err: any) {
          Alert.alert(t('common.error'), err?.message ?? t('common.errorOccurred'));
        }
      }
    } catch {
      Alert.alert(t('common.error'), t('common.errorOccurred'));
    }
  };

  const roleLabel = (role: TeamRole) => {
    switch (role) {
      case 'admin': return t('business.profile.admin');
      case 'restricted': return t('business.profile.restricted');
      case 'custom': return t('business.profile.custom');
      default: return role;
    }
  };

  const roleColor = (role: TeamRole) => {
    switch (role) {
      case 'admin': return theme.colors.primary;
      case 'restricted': return theme.colors.accentWarm;
      case 'custom': return theme.colors.accentFresh;
      default: return theme.colors.muted;
    }
  };

  const permissionLabels: { key: keyof TeamPermission; label: string }[] = [
    { key: 'dashboard', label: t('business.profile.permCanViewDashboard') },
    { key: 'baskets', label: t('business.profile.permCanManageBaskets') },
    { key: 'orders', label: t('business.profile.permCanViewOrders') },
    { key: 'profile', label: t('business.profile.permCanEditProfile') },
    { key: 'team', label: t('business.profile.permCanManageTeam') },
    { key: 'financial', label: t('business.profile.permCanViewFinancial') },
  ];

  const selectedMemberForPerms = showPermissionsModal ? team.find((m) => m.id === showPermissionsModal) : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={[]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xs }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.profile.title')}
        </Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.coverSection, { borderRadius: theme.radii.r16, overflow: 'hidden', ...theme.shadows.shadowSm }]}>
          {profile?.coverPhoto ? (
            <Image source={{ uri: profile.coverPhoto }} style={styles.coverImage} />
          ) : (
            <View style={[styles.coverImage, { backgroundColor: theme.colors.primary + '20' }]} />
          )}
          <View style={[styles.coverOverlay, { backgroundColor: 'rgba(0,0,0,0.2)' }]} />
          <TouchableOpacity onPress={handleChangeCover} style={[styles.coverEditBtn, { backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: theme.radii.r8, padding: 6 }]}>
            <Camera size={16} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={[styles.profileCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, marginTop: -30, marginHorizontal: theme.spacing.sm, ...theme.shadows.shadowMd }]}>
          <View style={styles.profileTop}>
            <View style={styles.logoWrap}>
              {profile?.logo ? (
                <Image source={{ uri: profile.logo }} style={[styles.profileLogo, { borderRadius: theme.radii.r16 }]} />
              ) : (
                <View style={[styles.profileLogo, { borderRadius: theme.radii.r16, backgroundColor: theme.colors.primary + '15' }]}>
                  <Store size={32} color={theme.colors.primary} />
                </View>
              )}
              <TouchableOpacity onPress={handleChangeLogo} style={[styles.logoEditBtn, { backgroundColor: theme.colors.primary, borderRadius: 12, width: 24, height: 24 }]}>
                <Camera size={12} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.profileInfo}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {!selectedLocationId && contextQuery.data?.organization_name
                  ? contextQuery.data.organization_name
                  : profile?.name ?? user?.name}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                {!selectedLocationId ? t('business.profile.allLocationsLabel', { defaultValue: 'Organization' }) : profile?.category}
              </Text>
            </View>
          </View>
        </View>

        {/* Team Management Card (only visible to admin/owner) */}
        {(contextQuery.data?.role === 'admin' || contextQuery.data?.role === 'owner') && (
        <TouchableOpacity
          onPress={() => router.push('/business/team' as never)}
          style={[styles.infoCard, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            marginTop: theme.spacing.lg,
            padding: theme.spacing.lg,
            ...theme.shadows.shadowSm,
            flexDirection: 'row',
            alignItems: 'center',
          }]}
          activeOpacity={0.7}
        >
          <View style={[{
            backgroundColor: theme.colors.primary + '12',
            borderRadius: theme.radii.r12,
            width: 44,
            height: 44,
            justifyContent: 'center',
            alignItems: 'center',
          }]}>
            <Users size={22} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {t('business.profile.teamManagement')}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
              {teamMembers.length} {t('business.team.members')}
            </Text>
          </View>
          <ChevronRight size={20} color={theme.colors.muted} />
        </TouchableOpacity>
        )}

        {/* Menu Items Card — above Business Info */}
        <TouchableOpacity
          onPress={() => router.push('/business/menu-items' as never)}
          style={[styles.infoCard, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            marginTop: theme.spacing.sm,
            padding: theme.spacing.lg,
            ...theme.shadows.shadowSm,
            flexDirection: 'row',
            alignItems: 'center',
          }]}
          activeOpacity={0.7}
        >
          <View style={[{
            backgroundColor: theme.colors.primary + '12',
            borderRadius: theme.radii.r12,
            width: 44,
            height: 44,
            justifyContent: 'center',
            alignItems: 'center',
          }]}>
            <UtensilsCrossed size={22} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3 }]}>
              {t('business.profile.menuItems')}
            </Text>
          </View>
          <ChevronRight size={20} color={theme.colors.muted} />
        </TouchableOpacity>

        {/* Business Info Card */}
        <View style={[styles.infoCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            {t('business.profile.businessInfo')}
          </Text>

          {[
            { icon: Store, label: t('business.profile.name'), value: (!selectedLocationId && contextQuery.data?.organization_name) ? contextQuery.data.organization_name : (profile?.name ?? '-') },
            { icon: MapPin, label: t('business.profile.address'), value: profile?.address ?? '-' },
            { icon: Phone, label: t('business.profile.phone'), value: profile?.phone ?? '-' },
            { icon: Clock, label: t('business.profile.hours'), value: profile?.hours ?? '-', onPress: () => setShowHoursModal(true) },
          ].map((item, index) => {
            const IconComp = item.icon;
            const Wrapper = item.onPress ? TouchableOpacity : View;
            return (
              <Wrapper
                key={index}
                onPress={item.onPress}
                activeOpacity={0.7}
                style={[styles.infoRow, {
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.divider,
                }]}
              >
                <View style={styles.infoRowLeft}>
                  <IconComp size={18} color={theme.colors.textSecondary} />
                  <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                    {item.label}
                  </Text>
                </View>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const, flex: 1, textAlign: 'right' as const }]} numberOfLines={2}>
                  {item.value}
                </Text>
                {item.onPress && <ChevronRight size={16} color={theme.colors.muted} style={{ marginLeft: 4 }} />}
              </Wrapper>
            );
          })}

          {profile?.description ? (
            <View style={[{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 4 }]}>
                {t('business.profile.description')}
              </Text>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm }]}>
                {profile.description}
              </Text>
            </View>
          ) : null}

        </View>

        <View style={[styles.infoCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            {t('business.profile.financialInfo')}
          </Text>
          <View style={[styles.infoRow, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <View style={styles.infoRowLeft}>
              <CreditCard size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('business.profile.iban')}
              </Text>
            </View>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
              {profile?.iban ?? '••••••••••••'}
            </Text>
          </View>
          <TouchableOpacity style={[styles.infoRow, { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider }]}>
            <View style={styles.infoRowLeft}>
              <CreditCard size={18} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginLeft: 10 }]}>
                {t('business.profile.paymentHistory')}
              </Text>
            </View>
            <ChevronRight size={18} color={theme.colors.muted} />
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

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
              <TouchableOpacity onPress={() => setShowAddMemberModal(false)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, marginTop: theme.spacing.lg }]}
              value={newMemberName}
              onChangeText={setNewMemberName}
              placeholder={t('business.profile.memberName')}
              placeholderTextColor={theme.colors.muted}
            />
            <TextInput
              style={[styles.modalInput, { backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, color: theme.colors.textPrimary, ...theme.typography.body, marginTop: theme.spacing.md }]}
              value={newMemberEmail}
              onChangeText={setNewMemberEmail}
              placeholder={t('business.profile.memberEmail')}
              placeholderTextColor={theme.colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm }]}>
              {t('business.profile.memberRole')}
            </Text>
            {(['admin', 'restricted'] as TeamRole[]).map((role) => (
              <TouchableOpacity
                key={role}
                onPress={() => setNewMemberRole(role)}
                style={[{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: theme.spacing.md,
                  borderRadius: theme.radii.r12,
                  marginBottom: theme.spacing.xs,
                  backgroundColor: newMemberRole === role ? roleColor(role) + '15' : theme.colors.bg,
                  borderWidth: newMemberRole === role ? 1.5 : 0,
                  borderColor: roleColor(role),
                }]}
              >
                <Shield size={16} color={roleColor(role)} />
                <Text style={[{ color: newMemberRole === role ? roleColor(role) : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: newMemberRole === role ? ('600' as const) : ('400' as const), marginLeft: 10 }]}>
                  {roleLabel(role)}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={handleAddMember}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.lg }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('common.add')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showRoleModal !== null} transparent animationType="fade" onRequestClose={() => setShowRoleModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRoleModal(null)}>
          <View
            style={[styles.modalContent, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r24, padding: theme.spacing.xl, ...theme.shadows.shadowLg }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: theme.spacing.lg }]}>
              {t('business.profile.memberRole')}
            </Text>
            {(['admin', 'restricted'] as TeamRole[]).map((role) => (
              <TouchableOpacity
                key={role}
                onPress={() => showRoleModal && handleChangeRole(showRoleModal, role)}
                style={[{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: theme.spacing.lg,
                  borderRadius: theme.radii.r12,
                  marginBottom: theme.spacing.sm,
                  backgroundColor: theme.colors.bg,
                }]}
              >
                <Shield size={18} color={roleColor(role)} />
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                  {roleLabel(role)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => setShowRoleModal(null)}
              style={[{ padding: theme.spacing.md, marginTop: theme.spacing.sm }]}
            >
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center' as const }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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

            {selectedMemberForPerms && (
              <View style={{ marginTop: theme.spacing.md }}>
                <View style={[{ backgroundColor: theme.colors.bg, borderRadius: theme.radii.r12, padding: theme.spacing.md, marginBottom: theme.spacing.lg }]}>
                  <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' as const }]}>
                    {selectedMemberForPerms.name}
                  </Text>
                  <Text style={[{ color: roleColor(selectedMemberForPerms.role), ...theme.typography.caption, marginTop: 2 }]}>
                    {roleLabel(selectedMemberForPerms.role)}
                  </Text>
                </View>

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
                      value={selectedMemberForPerms.permissions[key]}
                      onValueChange={() => handleTogglePermission(selectedMemberForPerms.id, key)}
                      trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }}
                      thumbColor={selectedMemberForPerms.permissions[key] ? theme.colors.primary : theme.colors.muted}
                    />
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              onPress={() => setShowPermissionsModal(null)}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r12, padding: theme.spacing.lg, marginTop: theme.spacing.xl }]}
            >
              <Text style={[{ color: '#fff', ...theme.typography.button, textAlign: 'center' as const }]}>
                {t('common.done')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Location Hours Editor Modal */}
      <Modal visible={showHoursModal} transparent animationType="fade" onRequestClose={() => setShowHoursModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setShowHoursModal(false)}>
          <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 40, paddingHorizontal: 20, maxHeight: '80%' }} onStartShouldSetResponder={() => true}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.divider, marginBottom: 16 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                {t('business.profile.hours')}
              </Text>
              <TouchableOpacity onPress={() => setShowHoursModal(false)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Same for all days toggle */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                {t('business.baskets.sameAllDays')}
              </Text>
              <Switch
                value={sameAllDays}
                onValueChange={(v) => {
                  setSameAllDays(v);
                  if (v) setDayHours(Object.fromEntries(DAYS.map(d => [d, { start: hoursStart, end: hoursEnd }])));
                }}
                trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '60' }}
                thumbColor={sameAllDays ? theme.colors.primary : '#ccc'}
              />
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {sameAllDays ? (
                <View style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 16, gap: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('business.availability.startTime')}</Text>
                    <TextInput value={hoursStart} onChangeText={setHoursStart} placeholder="HH:MM" style={{ color: theme.colors.textPrimary, ...theme.typography.h3, backgroundColor: theme.colors.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, textAlign: 'center', minWidth: 80 }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm }}>{t('business.availability.endTime')}</Text>
                    <TextInput value={hoursEnd} onChangeText={setHoursEnd} placeholder="HH:MM" style={{ color: theme.colors.textPrimary, ...theme.typography.h3, backgroundColor: theme.colors.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, textAlign: 'center', minWidth: 80 }} />
                  </View>
                </View>
              ) : (
                DAYS.map(day => (
                  <View key={day} style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginBottom: 8 }}>{DAY_LABELS[day]}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput value={dayHours[day]?.start ?? '09:00'} onChangeText={(v) => setDayHours(prev => ({ ...prev, [day]: { ...prev[day], start: v } }))} placeholder="HH:MM" style={{ flex: 1, color: theme.colors.textPrimary, ...theme.typography.bodySm, backgroundColor: theme.colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, textAlign: 'center' }} />
                      <Text style={{ color: theme.colors.muted }}>-</Text>
                      <TextInput value={dayHours[day]?.end ?? '18:00'} onChangeText={(v) => setDayHours(prev => ({ ...prev, [day]: { ...prev[day], end: v } }))} placeholder="HH:MM" style={{ flex: 1, color: theme.colors.textPrimary, ...theme.typography.bodySm, backgroundColor: theme.colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, textAlign: 'center' }} />
                    </View>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity
              onPress={handleSaveHours}
              disabled={hoursSaving}
              style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16, opacity: hoursSaving ? 0.5 : 1 }}
            >
              <Text style={{ color: '#fff', ...theme.typography.button }}>
                {hoursSaving ? t('common.loading') : t('common.save')}
              </Text>
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
  header: {},
  content: {
    flex: 1,
  },
  coverSection: {
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: 140,
  },
  coverOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  coverEditBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  profileCard: {},
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoWrap: {
    position: 'relative',
  },
  profileLogo: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoEditBtn: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  infoCard: {},
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 120,
  },
  teamSection: {},
  teamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  teamMemberRow: {
    flexDirection: 'row',
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
