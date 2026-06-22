import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { ArrowLeft, ShieldCheck } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchMyContext, fetchOrganizationDetails, updateMember } from '@/src/services/teams';

type PermissionKey =
  | 'confirm_pickup'
  | 'edit_quantities'
  | 'edit_basket_info'
  | 'create_delete_baskets'
  | 'view_history'
  | 'messaging'
  | 'cancel_order';

const permStringToBool = (val: any): boolean => val === 'write' || val === true;
const permBoolToString = (val: boolean): string => (val ? 'write' : 'none');

const EMPTY_PERMS: Record<PermissionKey, boolean> = {
  confirm_pickup: false,
  edit_quantities: false,
  edit_basket_info: false,
  create_delete_baskets: false,
  view_history: false,
  messaging: false,
  cancel_order: false,
};

const ALL_PERMS: Record<PermissionKey, boolean> = {
  confirm_pickup: true,
  edit_quantities: true,
  edit_basket_info: true,
  create_delete_baskets: true,
  view_history: true,
  messaging: true,
  cancel_order: true,
};

export default function PermissionsScreen() {
  const { membershipId, orgId: orgIdParam, memberName: memberNameParam, memberRole: memberRoleParam } = useLocalSearchParams<{
    membershipId: string;
    orgId?: string;
    memberName?: string;
    memberRole?: string;
  }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Fall back to my-context for org id when caller didn't pass it.
  const contextQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 60_000 });
  const orgId = orgIdParam ? Number(orgIdParam) : contextQuery.data?.organization_id;

  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
    // ALWAYS refetch on mount — when the user demotes someone from admin to
    // member on the team / member-detail screen and then opens this page,
    // they expect the toggles to immediately reflect the new role (un-faded,
    // editable). Without this, the page can render cached "admin" data
    // until the next stale check and the toggles look locked until the
    // user taps one.
    refetchOnMount: 'always',
  });

  const currentMember = useMemo(() => {
    const members = (orgDetailsQuery.data as any)?.members ?? [];
    return members.find((m: any) => String(m.membership_id) === String(membershipId));
  }, [orgDetailsQuery.data, membershipId]);

  // Org admins implicitly hold every permission; toggles are displayed locked
  // on and save is a no-op so a stale all-true payload can't overwrite a role
  // demotion in flight elsewhere.
  //
  // User-wide check: if ANY of the same user's memberships in this org is an
  // org-admin row (admin + no location), lock the editor — even when the
  // screen was opened with a membershipId pointing at a residual location row.
  const isTargetOrgAdmin = useMemo(() => {
    if (memberRoleParam === 'owner') return true;
    if (!currentMember) return false;
    const all = (orgDetailsQuery.data as any)?.members ?? [];
    return all.some(
      (m: any) =>
        String(m.user_id) === String(currentMember.user_id) &&
        m.role === 'admin' &&
        !m.location_id,
    );
  }, [orgDetailsQuery.data, currentMember, memberRoleParam]);

  // Location admins (role='admin' + location_id) also implicitly hold every
  // permission. The lock used to only kick in for org admins — a member newly
  // promoted via the role-change modal would still see editable toggles
  // contradicting the role, and could narrow their own permissions back from
  // under the admin role.
  const isTargetLocationAdmin = useMemo(() => {
    if (isTargetOrgAdmin) return false;
    if (!currentMember) return false;
    const all = (orgDetailsQuery.data as any)?.members ?? [];
    return all.some(
      (m: any) =>
        String(m.user_id) === String(currentMember.user_id) &&
        m.role === 'admin' &&
        !!m.location_id,
    );
  }, [orgDetailsQuery.data, currentMember, isTargetOrgAdmin]);

  // Single flag used by every "lock + force-all-on" branch below.
  const isTargetAdmin = isTargetOrgAdmin || isTargetLocationAdmin;

  // Every membership this user holds in this org — perms are a per-USER
  // concept in the UI even though the DB stores one row per membership.
  const userMemberships = useMemo(() => {
    const all = (orgDetailsQuery.data as any)?.members ?? [];
    if (!currentMember) return [];
    return all.filter((m: any) => String(m.user_id) === String(currentMember.user_id));
  }, [orgDetailsQuery.data, currentMember]);

  const [permsState, setPermsState] = useState<Record<PermissionKey, boolean>>(EMPTY_PERMS);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);

  // Initial hydration — pull perms out of the org-details cache into local
  // toggle state. Runs once per mount.
  useEffect(() => {
    if (hydrated || !currentMember) return;
    if (isTargetAdmin) {
      setPermsState(ALL_PERMS);
    } else {
      const raw = currentMember?.permissions ?? {};
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      setPermsState({
        confirm_pickup: permStringToBool(parsed?.confirm_pickup),
        edit_quantities: permStringToBool(parsed?.edit_quantities),
        edit_basket_info: permStringToBool(parsed?.edit_basket_info),
        create_delete_baskets: permStringToBool(parsed?.create_delete_baskets),
        view_history: permStringToBool(parsed?.view_history),
        messaging: permStringToBool(parsed?.messaging),
        cancel_order: permStringToBool(parsed?.cancel_order),
      });
    }
    setHydrated(true);
  }, [currentMember, isTargetOrgAdmin, hydrated]);

  // Re-sync local state when admin status FLIPS while the page is open
  // (e.g. user opened the page when the member was admin, then the
  // background org-details refetch landed showing the member is now a
  // plain member). Without this, the visual opacity / disabled flag flip
  // off via isTargetAdmin, but the toggle values stayed at ALL_PERMS
  // (= the all-on snapshot from the admin hydration) — so the toggles
  // looked editable but every value read as "on". Reading freshly from
  // currentMember.permissions makes the visual match the saved state.
  const prevIsTargetAdminRef = React.useRef(isTargetAdmin);
  useEffect(() => {
    const prev = prevIsTargetAdminRef.current;
    prevIsTargetAdminRef.current = isTargetAdmin;
    if (!hydrated || !currentMember) return;
    if (prev === isTargetAdmin) return;
    if (isTargetAdmin) {
      setPermsState(ALL_PERMS);
    } else {
      const raw = currentMember?.permissions ?? {};
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      setPermsState({
        confirm_pickup: permStringToBool(parsed?.confirm_pickup),
        edit_quantities: permStringToBool(parsed?.edit_quantities),
        edit_basket_info: permStringToBool(parsed?.edit_basket_info),
        create_delete_baskets: permStringToBool(parsed?.create_delete_baskets),
        view_history: permStringToBool(parsed?.view_history),
        messaging: permStringToBool(parsed?.messaging),
        cancel_order: permStringToBool(parsed?.cancel_order),
      });
    }
  }, [isTargetAdmin, currentMember, hydrated]);

  const permissionLabels: { key: PermissionKey; label: string; desc: string }[] = [
    { key: 'confirm_pickup', label: t('business.profile.permConfirmPickup', { defaultValue: 'Confirmer les retraits' }), desc: t('business.profile.permConfirmPickupDesc', { defaultValue: "Scanner le QR / saisir le code pour confirmer le retrait d'un client" }) },
    { key: 'edit_quantities', label: t('business.profile.permEditQuantities', { defaultValue: 'Modifier les quantités' }), desc: t('business.profile.permEditQuantitiesDesc', { defaultValue: 'Changer la quantité disponible des paniers, mettre en pause les ventes' }) },
    { key: 'edit_basket_info', label: t('business.profile.permEditBasketInfo', { defaultValue: 'Modifier les paniers' }), desc: t('business.profile.permEditBasketInfoDesc', { defaultValue: 'Modifier le prix, description, horaires de retrait et instructions' }) },
    { key: 'create_delete_baskets', label: t('business.profile.permCreateDeleteBaskets', { defaultValue: 'Créer et supprimer des paniers' }), desc: t('business.profile.permCreateDeleteBasketsDesc', { defaultValue: 'Ajouter de nouveaux paniers ou supprimer des paniers existants' }) },
    { key: 'view_history', label: t('business.profile.permViewHistory', { defaultValue: 'Historique et statistiques' }), desc: t('business.profile.permViewHistoryDesc', { defaultValue: "Voir les stats de vente, l'historique des commandes et les graphiques de performance" }) },
    { key: 'messaging', label: t('business.profile.permMessaging', { defaultValue: 'Messagerie clients' }), desc: t('business.profile.permMessagingDesc', { defaultValue: 'Envoyer et recevoir des messages avec les clients' }) },
    { key: 'cancel_order', label: t('business.profile.permCancelOrder', { defaultValue: 'Annuler des commandes' }), desc: t('business.profile.permCancelOrderDesc', { defaultValue: 'Annuler les commandes entrantes et rembourser les clients en crédits' }) },
  ];

  const handleSave = useCallback(async () => {
    if (!orgId || !membershipId) return;
    if (isTargetAdmin) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        confirm_pickup: permBoolToString(permsState.confirm_pickup),
        edit_quantities: permBoolToString(permsState.edit_quantities),
        edit_basket_info: permBoolToString(permsState.edit_basket_info),
        create_delete_baskets: permBoolToString(permsState.create_delete_baskets),
        view_history: permBoolToString(permsState.view_history),
        messaging: permBoolToString(permsState.messaging),
        cancel_order: permBoolToString(permsState.cancel_order),
      };
      const targets = userMemberships.length > 0 ? userMemberships : [{ membership_id: membershipId }];
      for (const m of targets) {
        await updateMember(orgId, m.membership_id, { permissions: payload });
      }
      await queryClient.invalidateQueries({ queryKey: ['org-details'] });
      await queryClient.invalidateQueries({ queryKey: ['my-context'] });
      await queryClient.refetchQueries({ queryKey: ['org-details', orgId] });
      router.back();
    } catch (err: any) {
      Alert.alert(
        t('common.error', { defaultValue: 'Erreur' }),
        getErrorMessage(err, t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour des permissions' })),
      );
    } finally {
      setSaving(false);
    }
  }, [orgId, membershipId, isTargetOrgAdmin, permsState, userMemberships, queryClient, router, t]);

  const loading = !orgId || orgDetailsQuery.isLoading || !hydrated;
  const headerSubtitle = memberNameParam ? String(memberNameParam) : '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <View style={[styles.header, { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <ArrowLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2 }} numberOfLines={1}>
            {t('business.profile.permissions', { defaultValue: 'Permissions' })}
          </Text>
          {headerSubtitle ? (
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: theme.spacing.xl }}
            showsVerticalScrollIndicator={false}
          >
            {isTargetAdmin && (
              <View style={{ backgroundColor: theme.colors.primary + '12', borderRadius: theme.radii.r12, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <ShieldCheck size={16} color={theme.colors.primary} style={{ marginTop: 1 }} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17, flex: 1 }}>
                  {isTargetOrgAdmin
                    ? t('business.team.orgAdminLockedNote', { defaultValue: "Admin de l'organisation — toutes les permissions sont activées par défaut et ne peuvent pas être modifiées." })
                    : t('business.team.locationAdminLockedNote', { defaultValue: "Admin de l'emplacement — toutes les permissions sont activées par défaut et ne peuvent pas être modifiées." })}
                </Text>
              </View>
            )}

            {permissionLabels.map(({ key, label, desc }) => {
              const displayValue = isTargetAdmin ? true : permsState[key];
              return (
                <View
                  key={key}
                  style={{
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.divider,
                    opacity: isTargetAdmin ? 0.55 : 1,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1, marginRight: 12 }}>
                      {label}
                    </Text>
                    <Switch
                      value={displayValue}
                      onValueChange={(val) => {
                        if (!isTargetAdmin) setPermsState((prev) => ({ ...prev, [key]: val }));
                      }}
                      disabled={isTargetAdmin}
                      // Mirrors the Switch styling used in /settings — solid
                      // primary track on, neutral divider track off, white
                      // thumb on, surface thumb off (Android only — iOS keeps
                      // the native thumb default). The previous translucent
                      // (primary + '50') track + colored thumb pattern was
                      // out of step with the rest of the app's toggles.
                      trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                      thumbColor={displayValue ? '#fff' : (Platform.OS === 'android' ? theme.colors.surface : undefined)}
                      ios_backgroundColor={theme.colors.divider}
                    />
                  </View>
                  <Text style={{ color: displayValue ? theme.colors.textSecondary : theme.colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
                    {desc}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          <View style={{ paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.colors.divider, backgroundColor: theme.colors.bg }}>
            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.r14, paddingVertical: 14, alignItems: 'center', opacity: saving ? 0.5 : 1 }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                  {t('common.save', { defaultValue: 'Enregistrer' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
});
