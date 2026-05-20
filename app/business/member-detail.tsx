import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Alert, Switch, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Mail, MapPin, Shield, ShieldCheck, Crown, ShoppingBag, Edit3, Clock, User, MoreVertical, Trash2, Key, X, CheckCircle, MessageCircle, Package, Users, Settings } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/src/lib/api';
import { fetchMyContext, fetchOrganizationDetails, updateMember, sendMemberEmail } from '@/src/services/teams';
import { useBusinessStore } from '@/src/stores/businessStore';
import { orderIdToCode } from '@/src/utils/orderCode';
import { TeamRoleChangeModal } from '@/src/components/TeamRoleChangeModal';
import { TeamLocationsManagerModal } from '@/src/components/TeamLocationsManagerModal';
import { TeamRemoveMemberDialog } from '@/src/components/TeamRemoveMemberDialog';

type PermissionKey = 'confirm_pickup' | 'edit_quantities' | 'edit_basket_info' | 'create_delete_baskets' | 'view_history' | 'messaging' | 'cancel_order';

const permStringToBool = (val: any): boolean => val === 'write' || val === true;
const permBoolToString = (val: boolean): string => val ? 'write' : 'none';

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

  const queryClient = useQueryClient();
  const [showMenu, setShowMenu] = useState(false);
  const [activityFilter, setActivityFilter] = useState('all');
  // Removal runs through the shared TeamRemoveMemberDialog — this screen is
  // per-user (no filter), so it always targets every membership. Scoped removes
  // live in team.tsx where the admin might be filtered to one location.
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  // Permissions modal state
  const [showPermsModal, setShowPermsModal] = useState(false);
  const [permsState, setPermsState] = useState<Record<PermissionKey, boolean>>({
    confirm_pickup: false, edit_quantities: false, edit_basket_info: false, create_delete_baskets: false, view_history: false, messaging: false, cancel_order: false,
  });
  const [permsSaving, setPermsSaving] = useState(false);

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

  const permissionLabels: { key: PermissionKey; label: string; desc: string }[] = [
    { key: 'confirm_pickup', label: t('business.profile.permConfirmPickup', { defaultValue: 'Confirmer les retraits' }), desc: t('business.profile.permConfirmPickupDesc', { defaultValue: "Scanner le QR / saisir le code pour confirmer le retrait d'un client" }) },
    { key: 'edit_quantities', label: t('business.profile.permEditQuantities', { defaultValue: 'Modifier les quantités' }), desc: t('business.profile.permEditQuantitiesDesc', { defaultValue: 'Changer la quantité disponible des paniers, mettre en pause les ventes' }) },
    { key: 'edit_basket_info', label: t('business.profile.permEditBasketInfo', { defaultValue: 'Modifier les paniers' }), desc: t('business.profile.permEditBasketInfoDesc', { defaultValue: 'Modifier le prix, description, horaires de retrait et instructions' }) },
    { key: 'create_delete_baskets', label: t('business.profile.permCreateDeleteBaskets', { defaultValue: 'Créer et supprimer des paniers' }), desc: t('business.profile.permCreateDeleteBasketsDesc', { defaultValue: 'Ajouter de nouveaux paniers ou supprimer des paniers existants' }) },
    { key: 'view_history', label: t('business.profile.permViewHistory', { defaultValue: 'Historique et statistiques' }), desc: t('business.profile.permViewHistoryDesc', { defaultValue: "Voir les stats de vente, l'historique des commandes et les graphiques de performance" }) },
    { key: 'messaging', label: t('business.profile.permMessaging', { defaultValue: 'Messagerie clients' }), desc: t('business.profile.permMessagingDesc', { defaultValue: 'Envoyer et recevoir des messages avec les clients' }) },
    { key: 'cancel_order', label: t('business.profile.permCancelOrder', { defaultValue: 'Annuler des commandes' }), desc: t('business.profile.permCancelOrderDesc', { defaultValue: 'Annuler les commandes entrantes et rembourser les clients en crédits' }) },
  ];

  // Resolve the current member row from the cached org details so we can
  // seed the role/location modals with today's values.
  const currentMember = React.useMemo(() => {
    const members = (orgDetailsQuery.data as any)?.members ?? [];
    return members.find((m: any) => String(m.membership_id) === memberId || String(m.user_id) === memberId);
  }, [orgDetailsQuery.data, memberId]);

  // Org admins implicitly have every permission at runtime — the toggles are
  // locked on and the save is skipped so role demotions don't get overwritten
  // by a stale all-true payload.
  const isTargetOrgAdmin = currentMember?.role === 'admin' && !currentMember?.location_id;

  const handleOpenPermissions = useCallback(() => {
    setShowMenu(false);
    if (isTargetOrgAdmin) {
      setPermsState({
        confirm_pickup: true, edit_quantities: true, edit_basket_info: true,
        create_delete_baskets: true, view_history: true, messaging: true, cancel_order: true,
      });
      setShowPermsModal(true);
      return;
    }
    const perms = currentMember?.permissions ?? {};
    const parsed = typeof perms === 'string' ? JSON.parse(perms) : perms;
    setPermsState({
      confirm_pickup: permStringToBool(parsed?.confirm_pickup),
      edit_quantities: permStringToBool(parsed?.edit_quantities),
      edit_basket_info: permStringToBool(parsed?.edit_basket_info),
      create_delete_baskets: permStringToBool(parsed?.create_delete_baskets),
      view_history: permStringToBool(parsed?.view_history),
      messaging: permStringToBool(parsed?.messaging),
      cancel_order: permStringToBool(parsed?.cancel_order),
    });
    setShowPermsModal(true);
  }, [currentMember, isTargetOrgAdmin]);

  // All of this user's memberships in this org — used everywhere the
  // user-centric actions need to fan out (perms save, role change, locations
  // manager, remove).
  const userMemberships = React.useMemo(() => {
    const all = (orgDetailsQuery.data as any)?.members ?? [];
    if (!currentMember) return [];
    return all.filter((m: any) => String(m.user_id) === String(currentMember.user_id));
  }, [orgDetailsQuery.data, currentMember]);

  const handleSavePermissions = useCallback(async () => {
    if (!orgId || !memberId) return;
    if (isTargetOrgAdmin) {
      // Admin perms are implicit — nothing to persist. Just close.
      setShowPermsModal(false);
      return;
    }
    setPermsSaving(true);
    try {
      const permsPayload: Record<string, string> = {
        confirm_pickup: permBoolToString(permsState.confirm_pickup),
        edit_quantities: permBoolToString(permsState.edit_quantities),
        edit_basket_info: permBoolToString(permsState.edit_basket_info),
        create_delete_baskets: permBoolToString(permsState.create_delete_baskets),
        view_history: permBoolToString(permsState.view_history),
        messaging: permBoolToString(permsState.messaging),
        cancel_order: permBoolToString(permsState.cancel_order),
      };
      // Apply the same perms to every membership the user holds in this org
      // so "permissions" is a per-user concept in the UI (DB still stores per
      // membership row, but we keep them in sync).
      const targets = userMemberships.length > 0 ? userMemberships : [{ membership_id: memberId }];
      console.log('[MemberDetail] Saving permissions to', targets.length, 'membership(s) for org', orgId);
      for (const m of targets) {
        await updateMember(orgId, m.membership_id, { permissions: permsPayload });
      }
      await queryClient.invalidateQueries({ queryKey: ['org-details'] });
      await queryClient.invalidateQueries({ queryKey: ['my-context'] });
      await queryClient.refetchQueries({ queryKey: ['org-details', orgId] });
      setShowPermsModal(false);
    } catch (err: any) {
      console.error('[MemberDetail] Permission save failed:', err?.message, err?.data);
      Alert.alert(t('common.error', { defaultValue: 'Erreur' }), err?.message ?? t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour des permissions' }));
    }
    setPermsSaving(false);
  }, [orgId, memberId, permsState, queryClient, t, isTargetOrgAdmin, userMemberships]);

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
      setEmailError(err?.message ?? t('business.team.emailSendFailed', { defaultValue: "L'envoi de l'email a échoué" }));
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
          <TouchableOpacity onPress={() => setShowMenu(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
                    backgroundColor: isActive ? theme.colors.primary : theme.colors.bg,
                    borderWidth: isActive ? 0 : 1,
                    borderColor: theme.colors.divider,
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
                      {activity.description.replace(/#(\d+)/g, (_, num) => orderIdToCode(Number(num)))}
                    </Text>
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
          <View style={{ position: 'absolute', top: 60, right: 20, backgroundColor: theme.colors.surface, borderRadius: 16, ...theme.shadows.shadowLg, overflow: 'hidden', minWidth: 220 }}>
            <TouchableOpacity onPress={handleOpenPermissions} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}>
              <Key size={18} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' }}>
                {t('business.profile.permissions', { defaultValue: 'Permissions' })}
              </Text>
            </TouchableOpacity>
            {memberRole !== 'owner' ? (
              <>
                <View style={{ height: 1, backgroundColor: theme.colors.divider }} />
                <TouchableOpacity onPress={handleOpenRoleModal} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}>
                  <ShieldCheck size={18} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' }}>
                    {t('business.team.changeRole', { defaultValue: 'Changer le rôle' })}
                  </Text>
                </TouchableOpacity>
                <View style={{ height: 1, backgroundColor: theme.colors.divider }} />
                <TouchableOpacity onPress={handleOpenLocationModal} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}>
                  <MapPin size={18} color={theme.colors.primary} />
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' }}>
                    {t('business.team.reassignLocation', { defaultValue: 'Réassigner à un emplacement' })}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
            <View style={{ height: 1, backgroundColor: theme.colors.divider }} />
            <TouchableOpacity onPress={handleSendEmail} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}>
              <Mail size={18} color={theme.colors.primary} />
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '500' }}>
                {t('business.team.sendEmail', { defaultValue: 'Envoyer un email' })}
              </Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: theme.colors.divider }} />
            <TouchableOpacity onPress={handleDeleteMember} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }}>
              <Trash2 size={18} color="#ef4444" />
              <Text style={{ color: '#ef4444', ...theme.typography.bodySm, fontWeight: '500' }}>
                {t('business.team.removeMember', { defaultValue: 'Retirer le membre' })}
              </Text>
            </TouchableOpacity>
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

      {/* Permissions Modal */}
      <Modal visible={showPermsModal} transparent animationType="fade" onRequestClose={() => setShowPermsModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          {/* maxHeight caps the modal at 85% of the screen so the Save button is
              always visible regardless of how many permission toggles exist or
              how small the phone is. The toggle list inside scrolls. */}
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 380, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
                {t('business.profile.permissions', { defaultValue: 'Permissions' })}
              </Text>
              <TouchableOpacity onPress={() => setShowPermsModal(false)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {isTargetOrgAdmin && (
              <View style={{ backgroundColor: theme.colors.primary + '12', borderRadius: 12, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <ShieldCheck size={16} color={theme.colors.primary} style={{ marginTop: 1 }} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17, flex: 1 }}>
                  {t('business.team.orgAdminLockedNote', { defaultValue: "Admin de l'organisation — toutes les permissions sont activées par défaut et ne peuvent pas être modifiées." })}
                </Text>
              </View>
            )}

            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 4 }}
              showsVerticalScrollIndicator={false}
            >
              {permissionLabels.map(({ key, label, desc }) => (
                <View
                  key={key}
                  style={{
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.divider,
                    opacity: isTargetOrgAdmin ? 0.55 : 1,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1, marginRight: 12 }}>
                      {label}
                    </Text>
                    <Switch
                      value={permsState[key]}
                      onValueChange={(val) => { if (!isTargetOrgAdmin) setPermsState((prev) => ({ ...prev, [key]: val })); }}
                      disabled={isTargetOrgAdmin}
                      trackColor={{ false: theme.colors.divider, true: theme.colors.primary + '50' }}
                      thumbColor={permsState[key] ? theme.colors.primary : theme.colors.muted}
                    />
                  </View>
                  <Text style={{ color: permsState[key] ? theme.colors.textSecondary : theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 }}>
                    {desc}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              onPress={handleSavePermissions}
              disabled={permsSaving}
              style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18, opacity: permsSaving ? 0.5 : 1 }}
            >
              {permsSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                  {t('common.save', { defaultValue: 'Enregistrer' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TeamRoleChangeModal
        visible={showRoleModal}
        onClose={() => setShowRoleModal(false)}
        orgId={orgId}
        userId={currentMember?.user_id}
        memberships={userMemberships}
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
              <TouchableOpacity onPress={() => setShowEmailModal(false)}>
                <X size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              {t('business.team.emailSubject', { defaultValue: 'Sujet' })}
            </Text>
            <TextInput
              style={{ backgroundColor: theme.colors.bg, borderRadius: 12, padding: 12, color: theme.colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: theme.colors.divider, marginBottom: 14 }}
              value={emailSubject}
              onChangeText={setEmailSubject}
              placeholder={t('business.team.emailSubjectPlaceholder', { defaultValue: "Sujet de l'email..." })}
              placeholderTextColor={theme.colors.muted}
            />
            <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
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
