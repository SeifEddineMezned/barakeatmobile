import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { useTheme } from '@/src/theme/ThemeProvider';
import { ModalCard } from '@/src/components/ui/ModalCard';
import { updateMember, removeMember, addMember, type OrgMemberFromAPI, type OrgLocationFromAPI } from '@/src/services/teams';

type RoleChoice = 'member' | 'location_admin' | 'org_admin';

interface Props {
  visible: boolean;
  onClose: () => void;
  orgId: number | string | undefined;
  userId: number | string | undefined;
  memberships: OrgMemberFromAPI[];
  locations: OrgLocationFromAPI[];
  currentEmail: string;
  currentName: string;
  currentPermissions: Record<string, string>;
}

/**
 * Role change modal — operates on the WHOLE user (every membership in the
 * org), not on a single membership_id. Writing a role flips every sibling
 * row in sync so "role" is a user-level concept in the UI.
 *
 *  - member          → role='member' on every row, location_ids preserved.
 *                      If the user is currently org-admin (single null-location
 *                      row), the modal exposes a location picker inline — the
 *                      first picked location replaces the org-admin row, the
 *                      rest become new membership rows.
 *  - location_admin  → same as member, but role='admin'.
 *  - org_admin       → delete all rows, insert one (role='admin',
 *                      location_id=null). Owner-only on the backend.
 */
export function TeamRoleChangeModal({
  visible, onClose, orgId, userId, memberships,
  locations, currentEmail, currentName, currentPermissions,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [roleChoice, setRoleChoice] = useState<RoleChoice>('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<number>>(new Set());

  const isCurrentlyOrgAdmin = useMemo(
    () => memberships.some((m) => m.role === 'admin' && !m.location_id),
    [memberships]
  );
  const isCurrentlyAdmin = useMemo(
    () => memberships.some((m) => m.role === 'admin'),
    [memberships]
  );

  // Full admin permission set. The backend grants this at member CREATION
  // time when `role === 'admin'` (see backend/routes/teams.js:437), but the
  // role-update endpoint only writes the columns it receives in the body —
  // so without explicitly sending permissions on a role flip TO admin, the
  // promoted user would silently keep whatever perms they had as a member.
  // That stranded location admins with `confirm_pickup: 'none'` even though
  // the team UI advertises admins as having all permissions by default.
  const FULL_ADMIN_PERMS: Record<string, string> = {
    confirm_pickup: 'write',
    edit_quantities: 'write',
    edit_basket_info: 'write',
    create_delete_baskets: 'write',
    view_history: 'write',
    messaging: 'write',
    cancel_order: 'write',
  };

  // Show the inline location picker when demoting away from org-admin —
  // that's the only transition where we lack a location to scope the new
  // role(s) to.
  const showInlinePicker = isCurrentlyOrgAdmin && (roleChoice === 'member' || roleChoice === 'location_admin');

  useEffect(() => {
    if (!visible) return;
    if (isCurrentlyOrgAdmin) setRoleChoice('org_admin');
    else if (isCurrentlyAdmin) setRoleChoice('location_admin');
    else setRoleChoice('member');
    setError(null);
    setSelectedLocationIds(new Set());
  }, [visible, isCurrentlyOrgAdmin, isCurrentlyAdmin]);

  const toggleLocation = (id: number) => {
    setSelectedLocationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!orgId || !userId) return;
    setSaving(true);
    setError(null);
    try {
      if (roleChoice === 'org_admin') {
        // org_admin: wipe every existing membership, then insert a single
        // (role='admin', location_id=null) row. The safest way with the
        // current API is to reuse one of the existing membership rows: update
        // it to null-location + admin, then delete the rest.
        if (memberships.length === 0) {
          setError(t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour' }));
          setSaving(false);
          return;
        }
        const [keep, ...drop] = memberships;
        // Promotion to org-admin — write the full admin perm set alongside
        // the role flip so the user actually has every per-org capability,
        // not just the perms they happened to carry from their prior role.
        const updated = await updateMember(orgId, keep.membership_id, {
          role: 'admin',
          location_id: null,
          permissions: FULL_ADMIN_PERMS,
        });
        // Defensive: confirm the row actually flipped (role='admin' AND no
        // location). On a healthy deployment this always passes; the check
        // exists to avoid a false "success" if anything along the wire
        // partially applies. Message is intentionally user-friendly — no
        // mention of "server" / "backend" since this is shown to end users.
        const updatedRole = (updated && typeof updated === 'object') ? (updated as any).role : undefined;
        const updatedLocId = (updated && typeof updated === 'object') ? (updated as any).location_id : undefined;
        if (updatedRole !== 'admin' || (updatedLocId !== null && updatedLocId !== undefined)) {
          setError(t('business.team.changeRoleRetry', {
            defaultValue: "Impossible de mettre à jour ce rôle pour le moment. Veuillez réessayer.",
          }));
          setSaving(false);
          return;
        }
        for (const m of drop) await removeMember(orgId, m.membership_id);
      } else if (showInlinePicker) {
        // Demotion from org-admin to a location-scoped role. The user picks
        // one or more locations inline; we reuse the existing org-admin row
        // for the first location, then addMember for any extras (the backend
        // dedupes by email — the password is a throwaway).
        const newRole = roleChoice === 'member' ? 'member' : 'admin';
        const picked = Array.from(selectedLocationIds);
        if (picked.length === 0) {
          setError(t('business.profile.locationRequired', { defaultValue: 'Veuillez sélectionner au moins un emplacement' }));
          setSaving(false);
          return;
        }
        if (memberships.length === 0) {
          setError(t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour' }));
          setSaving(false);
          return;
        }
        const [keep, ...rest] = memberships;
        // Demotion from org-admin: when the new role is also `admin`
        // (i.e. demoting to location admin), we still want the full admin
        // perm set on every new row — admins have all perms regardless of
        // scope. When demoting to member, preserve whatever perms the user
        // already had so we don't accidentally drop a basic-member's
        // hand-picked capability set.
        const permsForNewRows = newRole === 'admin' ? FULL_ADMIN_PERMS : currentPermissions;
        await updateMember(orgId, keep.membership_id, {
          role: newRole,
          location_id: picked[0],
          permissions: permsForNewRows,
        });
        for (const m of rest) await removeMember(orgId, m.membership_id);
        for (const locId of picked.slice(1)) {
          await addMember(orgId, {
            email: currentEmail,
            name: currentName,
            password: 'unused-' + Math.random().toString(36).slice(-6),
            role: newRole,
            location_id: locId,
            permissions: permsForNewRows,
          });
        }
      } else {
        // Same-scope role flip (member ↔ location_admin) — preserve existing
        // location_ids, just rewrite role on every membership row. When
        // flipping TO admin, also write the full admin perm set in the same
        // request so the promoted user gains every admin capability instead
        // of silently inheriting their old member-tier perms (which is what
        // left location admins with `confirm_pickup: 'none'` and made the
        // demo skip the verify-pickup / chat sub-tours).
        const newRole = roleChoice === 'member' ? 'member' : 'admin';
        const updateBody = newRole === 'admin'
          ? { role: newRole, permissions: FULL_ADMIN_PERMS }
          : { role: newRole };
        for (const m of memberships) {
          await updateMember(orgId, m.membership_id, updateBody);
        }
      }
      // Refetch EVERY org-details / my-context query, active or not, regardless
      // of how its orgId is typed in the key (the team screen and the
      // member-detail screen can key by number vs string). refetchType: 'all'
      // is what makes the members list reliably reflect the new role — a
      // plain invalidate only refetches the currently-active query, and the
      // old explicit refetchQueries(['org-details', orgId]) silently missed
      // when the orgId type didn't match. my-context is refreshed too so the
      // header dropdown / dashboard update when an admin changes their own role.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['org-details'], refetchType: 'all' }),
        queryClient.invalidateQueries({ queryKey: ['my-context'], refetchType: 'all' }),
      ]);
      onClose();
    } catch (err: any) {
      setError(getErrorMessage(err, t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour' })));
    }
    setSaving(false);
  };

  const options: { key: RoleChoice; label: string; desc: string }[] = [
    {
      key: 'member',
      label: t('business.team.roleMember', { defaultValue: 'Membre' }),
      desc: t('business.team.roleMemberDesc', { defaultValue: 'Accès limité par permissions' }),
    },
    {
      key: 'location_admin',
      label: t('business.team.roleLocationAdmin', { defaultValue: "Admin de l'emplacement" }),
      desc: t('business.team.roleLocationAdminDesc', { defaultValue: "Modifie l'emplacement et gère ses membres" }),
    },
    {
      key: 'org_admin',
      label: t('business.team.roleOrgAdmin', { defaultValue: "Admin de l'organisation" }),
      desc: t('business.team.roleOrgAdminDesc', { defaultValue: "Peut créer et supprimer des emplacements" }),
    },
  ];

  return (
    <ModalCard visible={visible} onClose={onClose} title={t('business.team.changeRole', { defaultValue: 'Changer le rôle' })} maxWidth={380}>
          <>
            {options.map((opt) => {
              const active = roleChoice === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => setRoleChoice(opt.key)}
                  style={{
                    padding: 14, borderRadius: 12, marginBottom: 10,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.primary : theme.colors.divider,
                    backgroundColor: active ? theme.colors.primary + '10' : theme.colors.bg,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: active ? theme.colors.primary : theme.colors.muted, justifyContent: 'center', alignItems: 'center' }}>
                      {active ? <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: theme.colors.primary }} /> : null}
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' }}>{opt.label}</Text>
                  </View>
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 4, marginLeft: 28 }}>{opt.desc}</Text>
                </TouchableOpacity>
              );
            })}

            {showInlinePicker && (
              <View style={{ marginTop: 6, marginBottom: 6 }}>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600', marginBottom: 4 }}>
                  {t('business.team.pickLocationsForDemotion', { defaultValue: 'Choisir les emplacements' })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 11, lineHeight: 15, marginBottom: 10 }}>
                  {t('business.team.pickLocationsForDemotionHint', { defaultValue: "Cochez les emplacements à attribuer. Une ligne de membre sera créée pour chacun." })}
                </Text>
                {locations.map((loc) => {
                  const id = Number(loc.id);
                  const active = selectedLocationIds.has(id);
                  return (
                    <TouchableOpacity
                      key={id}
                      onPress={() => toggleLocation(id)}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        padding: 12, borderRadius: 12, marginBottom: 6,
                        borderWidth: 1,
                        borderColor: active ? theme.colors.primary : theme.colors.divider,
                        backgroundColor: active ? theme.colors.primary + '10' : theme.colors.bg,
                      }}
                    >
                      <View style={{
                        width: 20, height: 20, borderRadius: 6, borderWidth: 2,
                        borderColor: active ? theme.colors.primary : theme.colors.muted,
                        backgroundColor: active ? theme.colors.primary : 'transparent',
                        marginRight: 10, justifyContent: 'center', alignItems: 'center',
                      }}>
                        {active && <Text style={{ color: '#fff', fontSize: 13, lineHeight: 15, fontWeight: '700' }}>✓</Text>}
                      </View>
                      <MapPin size={14} color="#114b3c" />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                          {(loc as any).name ?? '—'}
                        </Text>
                        {(loc as any).address ? (
                          <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                            {(loc as any).address}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {locations.length === 0 && (
                  <Text style={{ color: theme.colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                    {t('business.team.noLocationsForDemotion', { defaultValue: "Aucun emplacement disponible. Créez-en un avant de rétrograder." })}
                  </Text>
                )}
              </View>
            )}
          </>
          {error ? (
            <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 8, textAlign: 'center' }}>{error}</Text>
          ) : null}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || (showInlinePicker && selectedLocationIds.size === 0)}
            style={{
              backgroundColor: theme.colors.primary,
              borderRadius: 14,
              paddingVertical: 14,
              alignItems: 'center',
              marginTop: 12,
              opacity: saving || (showInlinePicker && selectedLocationIds.size === 0) ? 0.5 : 1,
            }}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('common.save', { defaultValue: 'Enregistrer' })}</Text>
            )}
          </TouchableOpacity>
    </ModalCard>
  );
}
