import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Alert, Image, TextInput, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import {
  ChevronRight, MapPin, Clock, Phone, Store, LogOut, ArrowLeftRight,
  Users, UserPlus, Trash2, Shield, CreditCard, Headphones, Camera, X
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useBusinessStore, DEFAULT_PERMISSIONS } from '@/src/stores/businessStore';
import type { TeamMember, TeamRole, TeamPermission } from '@/src/types';

export default function BusinessProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const { profile, team, addTeamMember, removeTeamMember, updateTeamMemberRole } = useBusinessStore();
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState<string | null>(null);
  const [showPermissionsModal, setShowPermissionsModal] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<TeamRole>('restricted');

  const handleSignOut = useCallback(() => {
    signOut();
    router.replace('/auth/sign-in' as never);
  }, [signOut, router]);

  const handleSwitchToCustomer = useCallback(() => {
    signOut();
    router.replace('/auth/sign-in' as never);
  }, [signOut, router]);

  const handleAddMember = useCallback(() => {
    if (!newMemberName.trim() || !newMemberEmail.trim()) return;
    const member: TeamMember = {
      id: `tm_${Date.now()}`,
      name: newMemberName.trim(),
      email: newMemberEmail.trim(),
      role: newMemberRole,
      permissions: DEFAULT_PERMISSIONS[newMemberRole],
      addedAt: new Date().toISOString(),
    };
    addTeamMember(member);
    setNewMemberName('');
    setNewMemberEmail('');
    setNewMemberRole('restricted');
    setShowAddMemberModal(false);
  }, [newMemberName, newMemberEmail, newMemberRole, addTeamMember]);

  const handleRemoveMember = useCallback((memberId: string) => {
    Alert.alert(
      t('business.profile.removeMember'),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.confirm'), style: 'destructive', onPress: () => removeTeamMember(memberId) },
      ]
    );
  }, [removeTeamMember, t]);

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
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top']}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.xl }]}>
        <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h1 }]}>
          {t('business.profile.title')}
        </Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: theme.spacing.xl }} showsVerticalScrollIndicator={false}>
        <View style={[styles.coverSection, { borderRadius: theme.radii.r16, overflow: 'hidden', ...theme.shadows.shadowSm }]}>
          {profile?.coverPhoto ? (
            <Image source={{ uri: profile.coverPhoto }} style={styles.coverImage} />
          ) : (
            <View style={[styles.coverImage, { backgroundColor: theme.colors.primary + '20' }]} />
          )}
          <View style={[styles.coverOverlay, { backgroundColor: 'rgba(0,0,0,0.2)' }]} />
          <TouchableOpacity style={[styles.coverEditBtn, { backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: theme.radii.r8, padding: 6 }]}>
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
              <TouchableOpacity style={[styles.logoEditBtn, { backgroundColor: theme.colors.primary, borderRadius: 12, width: 24, height: 24 }]}>
                <Camera size={12} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.profileInfo}>
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h2 }]}>
                {profile?.name ?? user?.name}
              </Text>
              <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 2 }]}>
                {profile?.category}
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.infoCard, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }]}>
            {t('business.profile.businessInfo')}
          </Text>

          {[
            { icon: Store, label: t('business.profile.name'), value: profile?.name ?? '-' },
            { icon: MapPin, label: t('business.profile.address'), value: profile?.address ?? '-' },
            { icon: Phone, label: t('business.profile.phone'), value: profile?.phone ?? '-' },
            { icon: Clock, label: t('business.profile.hours'), value: profile?.hours ?? '-' },
          ].map((item, index) => {
            const IconComp = item.icon;
            return (
              <View
                key={index}
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
              </View>
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

        <View style={[styles.teamSection, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <View style={[styles.teamHeader, { padding: theme.spacing.lg }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Users size={20} color={theme.colors.primary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.h3, marginLeft: 10 }]}>
                {t('business.profile.teamManagement')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowAddMemberModal(true)}
              style={[{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center' }]}
            >
              <UserPlus size={14} color="#fff" />
              <Text style={[{ color: '#fff', ...theme.typography.caption, fontWeight: '600' as const, marginLeft: 4 }]}>
                {t('business.profile.addMember')}
              </Text>
            </TouchableOpacity>
          </View>

          {team.map((member, index) => (
            <View
              key={member.id}
              style={[styles.teamMemberRow, {
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
                borderTopWidth: 1,
                borderTopColor: theme.colors.divider,
              }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' as const }]}>
                  {member.name}
                </Text>
                <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 1 }]}>
                  {member.email}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowRoleModal(member.id)}
                style={[{ backgroundColor: roleColor(member.role) + '15', borderRadius: theme.radii.pill, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6 }]}
              >
                <Text style={[{ color: roleColor(member.role), ...theme.typography.caption, fontWeight: '600' as const }]}>
                  {roleLabel(member.role)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowPermissionsModal(member.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginRight: 8 }}
              >
                <Shield size={16} color={theme.colors.primary} />
              </TouchableOpacity>
              {index > 0 && (
                <TouchableOpacity onPress={() => handleRemoveMember(member.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Trash2 size={16} color={theme.colors.error} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.supportCard, {
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.r16,
            padding: theme.spacing.lg,
            marginTop: theme.spacing.lg,
            ...theme.shadows.shadowSm,
            flexDirection: 'row',
            alignItems: 'center',
          }]}
          activeOpacity={0.7}
        >
          <View style={[{ backgroundColor: theme.colors.primary + '12', borderRadius: theme.radii.r12, width: 40, height: 40, justifyContent: 'center', alignItems: 'center' }]}>
            <Headphones size={20} color={theme.colors.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600' as const }]}>
              {t('business.profile.customerSupport')}
            </Text>
            <Text style={[{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }]}>
              {t('business.profile.customerSupportDesc')}
            </Text>
          </View>
          <ChevronRight size={20} color={theme.colors.muted} />
        </TouchableOpacity>

        <View style={[styles.menuSection, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}>
          <TouchableOpacity
            style={[styles.menuItem, { padding: theme.spacing.lg }]}
            onPress={handleSwitchToCustomer}
          >
            <View style={styles.menuItemLeft}>
              <ArrowLeftRight size={20} color={theme.colors.textSecondary} />
              <Text style={[{ color: theme.colors.textPrimary, ...theme.typography.body, marginLeft: 12 }]}>
                {t('business.profile.switchToCustomer')}
              </Text>
            </View>
            <ChevronRight size={20} color={theme.colors.muted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.signOutBtn, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.lg, marginTop: theme.spacing.lg, ...theme.shadows.shadowSm }]}
          onPress={handleSignOut}
        >
          <LogOut size={20} color={theme.colors.error} />
          <Text style={[{ color: theme.colors.error, ...theme.typography.body, marginLeft: 12 }]}>
            {t('business.profile.signOut')}
          </Text>
        </TouchableOpacity>

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
  supportCard: {},
  menuSection: {},
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
