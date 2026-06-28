import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Mail, MapPin, Shield, ShieldCheck, Crown, ShoppingBag, Edit3, Clock, User, MoreVertical, Trash2, Key, X, CheckCircle, MessageCircle, Package, Users, Settings } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useQuery } from '@tanstack/react-query';
import { apiClient, getErrorMessage } from '@/src/lib/api';
import { fetchMyContext, fetchOrganizationDetails, sendMemberEmail } from '@/src/services/teams';
import { useBusinessStore } from '@/src/stores/businessStore';
import { orderIdToCode } from '@/src/utils/orderCode';
import { TeamRoleChangeModal } from '@/src/components/TeamRoleChangeModal';
import { TeamLocationsManagerModal } from '@/src/components/TeamLocationsManagerModal';
import { TeamRemoveMemberDialog } from '@/src/components/TeamRemoveMemberDialog';
import { ActionMenuCard, ActionMenuItem, ActionMenuDivider } from '@/src/components/ui/ActionMenu';
import { PermissionIcon8, RoleIcon8, DeleteIcon8 } from '@/src/components/ui/Icon8';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';

interface ActivityItem {
  id: number;
  action_type: string;
  description: string;
  created_at: string;
  reference_id?: number;
  metadata?: Record<string, any>;
}

const ACTIVITY_TYPES = [
  { key: 'all', labelKey: 'Tout' },
  { key: 'pickup_confirmed', labelKey: 'Retraits' },
  { key: 'message_sent', labelKey: 'Messages' },
  { key: 'basket_created', labelKey: 'Paniers créés' },
  { key: 'basket_edited', labelKey: 'Paniers modifiés' },
  { key: 'quantity_changed', labelKey: 'Quantités' },
  { key: 'member_updated', labelKey: 'Membres' },
  { key: 'location_updated', labelKey: 'Emplacements' },
] as const;

async function fetchMemberActivity(memberId: string, typeFilter?: string) {
  try {
    const params = typeFilter && typeFilter !== 'all' ? `?type=${typeFilter}&limit=50` : '?limit=50';
    const res = await apiClient.get(`/api/teams/members/${memberId}/activity${params}`);
    return res.data as { activities: ActivityItem[] };
  } catch {
    return { activities: [] };
  }
}

function timeAgo(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return t('timeAgo.seconds', { count: diff });
  if (diff < 3600) return t('timeAgo.minutes', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('timeAgo.hours', { count: Math.floor(diff / 3600) });
  const days = Math.floor(diff / 86400);
  if (days < 7) return t('timeAgo.days', { count: days });
  if (days < 30) return t('timeAgo.weeks', { count: Math.floor(days / 7) });
  return t('timeAgo.months', { count: Math.floor(days / 30) });
}

export default function MemberDetailScreen() {
  const { memberId, memberUserId, memberName, memberEmail, memberRole, locationName } = useLocalSearchParams<{
    memberId: string;
    memberUserId?: string;
    memberName?: string;
    memberEmail?: string;
    memberRole?: string;
    locationName?: string;
  }>();
  // Activity log is keyed by user_id, not membership_id
  const activityUserId = memberUserId || memberId;
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const [showMenu, setShowMenu] = useState(false);
  // Walkthrough lock — the 3-dot menu opens destructive flows (remove
  // member, change role, etc.) that would derail the demo if triggered
  // mid-tour. Read reactively so the icon's disabled/fade state flips
  // the moment the walkthrough starts or ends.
  // `step` is non-null only while a step is actively highlighted; the demo can
  // land on this screen with no step set, so also read `demoSequencePending`
  // (true for the whole demo run, across screens) to keep the 3-dot locked.
  const inWalkthrough = useWalkthroughStore((s) => s.step !== null || s.demoSequencePending);
  const [activityFilter, setActivityFilter] = useState('all');
  // Removal runs through the shared TeamRemoveMemberDialog — this screen is
  // per-user (no filter), so it always targets every membership. Scoped removes
  // live in team.tsx where the admin might be filtered to one location.
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  // Email modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Role / location modals are now shared components (TeamRoleChangeModal,
  // TeamLocationsManagerModal). We only track their open state here.
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);

  const contextQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 60_000 });
  const myRole = contextQuery.data?.role ?? 'member';
  const orgId = contextQuery.data?.organization_id;
  const isAdminOrOwner = myRole === 'owner' || myRole === 'admin';

  // Fetch org details to get this member's current permissions
  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const activityQuery = useQuery({
    queryKey: ['member-activity', activityUserId, activityFilter],
    queryFn: () => fetchMemberActivity(activityUserId, activityFilter),
    staleTime: 30_000,
  });

  // Resolve the current member row from the cached org details so we can
  // seed the role/location modals with today's values.
  const currentMember = React.useMemo(() => {
    const members = (orgDetailsQuery.data as any)?.members ?? [];
    return members.find((m: any) => String(m.membership_id) === memberId || String(m.user_id) === memberId);
  }, [orgDetailsQuery.data, memberId]);

  const handleOpenPermissions = useCallback(() => {
    setShowMenu(false);
    router.push({
      pathname: '/business/permissions/[membershipId]',
      params: {
        membershipId: String(memberId),
        orgId: orgId != null ? String(orgId) : '',
        memberName: memberName ?? '',
        memberRole: memberRole ?? '',
      },
    } as never);
  }, [router, memberId, orgId, memberName, memberRole]);

  // All of this user's memberships in this org — used everywhere the
  // user-centric actions need to fan out (role change, locations
  // manager, remove).
  const userMemberships = React.useMemo(() => {
    const all = (orgDetailsQuery.data as any)?.members ?? [];
    if (!currentMember) return [];
    return all.filter((m: any) => String(m.user_id) === String(currentMember.user_id));
  }, [orgDetailsQuery.data, currentMember]);

  const handleOpenRoleModal = useCallback(() => {
    setShowMenu(false);
    setShowRoleModal(true);
  }, []);

  const handleOpenLocationModal = useCallback(() => {
    setShowMenu(false);
    setShowLocationModal(true);
  }, []);

  const handleSendEmail = useCallback(() => {
    setShowMenu(false);
    setEmailSubject('');
    setEmailBody('');
    setEmailError(null);
    setShowEmailModal(true);
  }, []);

  const handleSendEmailSubmit = useCallback(async () => {
    if (!emailSubject.trim() || !emailBody.trim() || !orgId || !memberId) return;
    setEmailSending(true);
    setEmailError(null);
    try {
      await sendMemberEmail(orgId, memberId, emailSubject.trim(), emailBody.trim());
      setShowEmailModal(false);
      setEmailSubject('');
      setEmailBody('');
    } catch (err: any) {
      // Surface the server's error in the modal instead of silently failing
      // — previously the user couldn't tell whether the email actually went.
      setEmailError(getErrorMessage(err, t('business.team.emailSendFailed', { defaultValue: "L'envoi de l'email a échoué" })));
    }
    setEmailSending(false);
  }, [orgId, memberId, emailSubject, emailBody, t]);

  const handleDeleteMember = () => {
    setShowMenu(false);
    setRemoveConfirmOpen(true);
  };

  const name = memberName || memberEmail?.split('@')[0] || 'Member';
  const initials = name
    .split(' ')
    .map((w: string) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .substring(0, 2);

  const getRoleBadge = () => {
    switch (memberRole) {
      case 'owner': return { color: '#16a34a', bg: '#16a34a15', label: t('business.team.owner', { defaultValue: 'Owner' }), Icon: Crown };
      case 'admin': return { color: theme.colors.primary, bg: theme.colors.primary + '20', label: t('business.team.admin'), Icon: ShieldCheck };
      default: return { color: theme.colors.muted, bg: theme.colors.muted + '25', label: t('business.team.member'), Icon: Shield };
    }
  };

  const badge = getRoleBadge();
  const activities = activityQuery.data?.activities ?? [];

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'pickup_confirmed': return { Icon: CheckCircle, color: '#16a34a' };
      case 'message_sent': return { Icon: MessageCircle, color: '#3b82f6' };
      case 'basket_created': return { Icon: Package, color: theme.colors.primary };
      case 'basket_edited': return { Icon: Edit3, color: '#f59e0b' };
      case 'quantity_changed': return { Icon: Package, color: '#f59e0b' };
      case 'member_added': return { Icon: Users, color: theme.colors.primary };
      case 'member_updated': return { Icon: Settings, color: '#8b5cf6' };
      case 'member_removed': return { Icon: Trash2, color: '#ef4444' };
      case 'location_added': return { Icon: MapPin, color: theme.colors.primary };
      case 'location_updated': return { Icon: MapPin, color: '#f59e0b' };
      default: return { Icon: Clock, color: theme.colors.muted };
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, textAlign: 'center' }}>
          {t('business.team.memberDetail', { defaultValue: 'Member' })}
        </Text>
        {isAdminOrOwner && memberRole !== 'owner' ? (
          <TouchableOpacity
            onPress={inWalkthrough ? undefined : () => setShowMenu(true)}
            disabled={inWalkthrough}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ opacity: inWalkthrough ? 0.3 : 1 }}
          >
            <MoreVertical size={22} color={theme.colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Member Info Card */}
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, padding: theme.spacing.xl, alignItems: 'center' }]}>
          <View style={{
            width: 72, height: 72, borderRadius: 36,
            backgroundColor: theme.colors.primary + '20',
            justifyContent: 'center', alignItems: 'center', marginBottom: 16,
          }}>
            <Text style={{ color: theme.colors.primary, fontSize: 24, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              {initials}
            </Text>
          </View>

          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, textAlign: 'center' }}>
            {name}
          </Text>

          {/* Role badge */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: badge.bg, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, gap: 6 }}>
            <badge.Icon size={14} color={badge.color} />
            <Text style={{ color: badge.color, ...theme.typography.bodySm, fontWeight: '600' }}>
              {badge.label}
            </Text>
          </View>

          {/* Info rows */}
          <View style={{ width: '100%', marginTop: 20 }}>
            {memberEmail ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                <Mail size={16} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 12, flex: 1 }}>
                  {memberEmail}
                </Text>
              </View>
            ) : null}
            {locationName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                <MapPin size={16} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginLeft: 12, flex: 1 }}>
                  {locationName}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Activity Section */}
        <View style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.r16, marginTop: theme.spacing.lg, padding: theme.spacing.xl }]}>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, marginBottom: 12 }}>
            {t('business.team.recentActivity', { defaultValue: 'Activité récente' })}
          </Text>

          {/* Filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
            {ACTIVITY_TYPES.map(({ key, labelKey }) => {
              const isActive = activityFilter === key;
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => setActivityFilter(key)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                    backgroundColor: isActive ? theme.colors.primary : theme.colors.surface,
                    borderWidth: 1,
                    borderColor: isActive ? theme.colors.primary : theme.colors.divider,
                  }}
                >
                  <Text style={{
                    color: isActive ? '#fff' : theme.colors.textSecondary,
                    fontSize: 12, fontWeight: '600',
                  }}>
                    {labelKey}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {activityQuery.isLoading ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          ) : activities.length === 0 ? (
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <User size={24} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginTop: 8, textAlign: 'center' }}>
                {activityFilter === 'all'
                  ? t('business.team.noActivity', { defaultValue: 'Aucune activité récente' })
                  : t('business.team.noActivityFilter', { defaultValue: 'Aucune activité de ce type' })}
              </Text>
            </View>
          ) : (
            activities.map((activity, index) => {
              const { Icon, color } = getActivityIcon(activity.action_type);
              const isOrderRelated = activity.action_type === 'pickup_confirmed' && activity.reference_id;
              // The `#N` → BK-NNN substitution must only run on action types
              // whose description embeds a reservation id. For
              // location_updated / basket_edited etc. the `#N` refers to a
              // location or basket id, and rendering it as "BK-..." made
              // location edits look like order entries.
              const ORDER_HASH_ACTIONS = new Set([
                'pickup_confirmed',
                'reservation_cancelled',
                'message_sent', // description embeds the reservation id when the conversation has one
              ]);
              const descriptionText = ORDER_HASH_ACTIONS.has(activity.action_type)
                ? activity.description.replace(/#(\d+)/g, (_, num) => orderIdToCode(Number(num)))
                : activity.description;
              // Legacy entries logged just "A modifié l'emplacement #N" with no
              // inline change list. If metadata still carries the per-field
              // diff, render it as a secondary line so the activity still
              // says WHAT was changed.
              const FIELD_LABELS_FR: Record<string, string> = {
                name: 'nom', address: 'adresse', phone: 'téléphone', category: 'catégorie',
                pickup_instructions: 'instructions de retrait', pickup_start_time: 'début retrait',
                pickup_end_time: 'fin retrait', latitude: 'latitude', longitude: 'longitude',
                status: 'statut', is_paused: 'pause', bag_description: 'description du panier',
                quantity: 'quantité', original_price: 'prix original', discounted_price: 'prix réduit',
              };
              const fmtVal = (v: any) => (v === null || v === undefined || v === '') ? '∅' : String(v).substring(0, 40);
              const hasInlineChanges = typeof descriptionText === 'string' && descriptionText.includes(' — ');
              const rawChanges = (activity.metadata && activity.metadata.changes) || null;
              let changeSummary = '';
              if (!hasInlineChanges && rawChanges && typeof rawChanges === 'object') {
                const parts: string[] = [];
                for (const [field, diff] of Object.entries(rawChanges)) {
                  if (diff && typeof diff === 'object' && ('from' in diff || 'to' in diff)) {
                    const label = FIELD_LABELS_FR[field] || field;
                    const d = diff as { from?: any; to?: any };
                    parts.push(`${label}: ${fmtVal(d.from)} → ${fmtVal(d.to)}`);
                  }
                }
                if (parts.length > 0) changeSummary = parts.join(', ');
              }
              const Wrapper = isOrderRelated ? TouchableOpacity : View;
              return (
                <Wrapper
                  key={activity.id ?? index}
                  style={{ flexDirection: 'row', paddingVertical: 12, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: theme.colors.divider }}
                  {...(isOrderRelated ? { activeOpacity: 0.7, onPress: () => {
                    const meta = activity.metadata ?? {};
                    const locId = meta.location_id ?? null;
                    useBusinessStore.getState().setTargetOrder(String(activity.reference_id), locId);
                    router.push('/(business)/incoming-orders' as never);
                  } } : {})}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color + '15', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                    <Icon size={16} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm }}>
                      {descriptionText}
                    </Text>
                    {changeSummary ? (
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2, lineHeight: 16 }}>
                        {changeSummary}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 8 }}>
                      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                        {timeAgo(activity.created_at, t)}
                      </Text>
                      {/* Only show order code for order-related activities, not basket IDs */}
                      {isOrderRelated && (
                        <Text style={{ color: theme.colors.primary, ...theme.typography.caption, fontWeight: '600' }}>
                          {orderIdToCode(activity.reference_id!)}
                        </Text>
                      )}
                    </View>
                  </View>
                </Wrapper>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* 3-dot menu modal */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={{ position: 'absolute', top: 60, right: 20 }} onStartShouldSetResponder={() => true}>
            <ActionMenuCard style={{ minWidth: 220 }}>
              <ActionMenuItem
                icon={<PermissionIcon8 size={18} />}
                label={t('business.profile.permissions', { defaultValue: 'Permissions' })}
                onPress={handleOpenPermissions}
              />
              {memberRole !== 'owner' ? (
                <>
                  <ActionMenuDivider />
                  <ActionMenuItem
                    icon={<RoleIcon8 size={18} />}
                    label={t('business.team.changeRole', { defaultValue: 'Changer le rôle' })}
                    onPress={handleOpenRoleModal}
                  />
                  <ActionMenuDivider />
                  <ActionMenuItem
                    icon={<MapPin size={18} color={theme.colors.primary} />}
                    label={t('business.team.reassignLocation', { defaultValue: 'Réassigner à un emplacement' })}
                    onPress={handleOpenLocationModal}
                  />
                </>
              ) : null}
              <ActionMenuDivider />
              <ActionMenuItem
                icon={<Mail size={18} color={theme.colors.primary} />}
                label={t('business.team.sendEmail', { defaultValue: 'Envoyer un email' })}
                onPress={handleSendEmail}
              />
              <ActionMenuDivider />
              <ActionMenuItem
                destructive
                icon={<DeleteIcon8 size={18} />}
                label={t('business.team.removeMember', { defaultValue: 'Retirer le membre' })}
                onPress={handleDeleteMember}
              />
            </ActionMenuCard>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Shared remove dialog — this screen is user-scoped (no filter), so
          the dialog runs in "remove from all" mode and the backend tears down
          the users row only if it's their last membership. */}
      <TeamRemoveMemberDialog
        visible={removeConfirmOpen}
        onClose={() => setRemoveConfirmOpen(false)}
        onRemoved={() => router.back()}
        orgId={orgId}
        memberName={name}
        memberships={userMemberships}
        scopedLocationId={null}
        locations={(orgDetailsQuery.data as any)?.locations ?? []}
      />

      <TeamRoleChangeModal
        visible={showRoleModal}
        onClose={() => setShowRoleModal(false)}
        orgId={orgId}
        userId={currentMember?.user_id}
        memberships={userMemberships}
        locations={(orgDetailsQuery.data as any)?.locations ?? []}
        currentEmail={currentMember?.email ?? memberEmail ?? ''}
        currentName={currentMember?.name ?? memberName ?? ''}
        currentPermissions={(typeof currentMember?.permissions === 'string'
          ? JSON.parse(currentMember.permissions)
          : (currentMember?.permissions ?? {})) as Record<string, string>}
      />

      <TeamLocationsManagerModal
        visible={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        orgId={orgId}
        userId={currentMember?.user_id}
        memberships={userMemberships}
        locations={(orgDetailsQuery.data as any)?.locations ?? []}
        currentRole={(currentMember?.role === 'admin' ? 'admin' : 'member') as 'admin' | 'member'}
        currentPermissions={(typeof currentMember?.permissions === 'string'
          ? JSON.parse(currentMember.permissions)
          : (currentMember?.permissions ?? {})) as Record<string, string>}
        currentEmail={currentMember?.email ?? memberEmail ?? ''}
        currentName={currentMember?.name ?? memberName ?? ''}
      />

      {/* Email Modal */}
      <Modal visible={showEmailModal} transparent animationType="fade" onRequestClose={() => setShowEmailModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 380 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                {t('business.team.sendEmailTo', { name: memberName, defaultValue: `Email à ${memberName ?? ''}` })}
              </Text>
              <TouchableOpacity onPress={() => setShowEmailModal(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700', textTransform: 'none', letterSpacing: 0.5, marginBottom: 6 }}>
              {t('business.team.emailSubject', { defaultValue: 'Sujet' })}
            </Text>
            <TextInput
              style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 12, color: theme.colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: theme.colors.divider, marginBottom: 14 }}
              value={emailSubject}
              onChangeText={setEmailSubject}
              placeholder={t('business.team.emailSubjectPlaceholder', { defaultValue: "Sujet de l'email..." })}
              placeholderTextColor={theme.colors.muted}
            />
            <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700', textTransform: 'none', letterSpacing: 0.5, marginBottom: 6 }}>
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
            {emailError ? (
              <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 10, textAlign: 'center' }}>
                {emailError}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={handleSendEmailSubmit}
              disabled={emailSending || !emailSubject.trim() || !emailBody.trim()}
              style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18, opacity: emailSending || !emailSubject.trim() || !emailBody.trim() ? 0.5 : 1 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                {emailSending ? t('common.loading') : t('business.team.sendEmailBtn', { defaultValue: 'Envoyer' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
});
