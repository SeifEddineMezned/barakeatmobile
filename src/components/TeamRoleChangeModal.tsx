import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { X } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { updateMember, removeMember, type OrgMemberFromAPI } from '@/src/services/teams';

type RoleChoice = 'member' | 'location_admin' | 'org_admin';

interface Props {
  visible: boolean;
  onClose: () => void;
  orgId: number | string | undefined;
  userId: number | string | undefined;
  memberships: OrgMemberFromAPI[];
}

/**
 * Role change modal — operates on the WHOLE user (every membership in the
 * org), not on a single membership_id. Writing a role flips every sibling
 * row in sync so "role" is a user-level concept in the UI.
 *
 *  - member          → role='member' on every row, location_ids preserved.
 *  - location_admin  → role='admin' on every row with a location_id; if the
 *                      user was org-admin (one null-location row), we block
 *                      the transition and tell them to use Manage locations
 *                      first (picking specific locations is a deliberate
 *                      downgrade that shouldn't be a silent auto-convert).
 *  - org_admin       → delete all rows, insert one (role='admin',
 *                      location_id=null). Owner-only on the backend.
 */
export function TeamRoleChangeModal({ visible, onClose, orgId, userId, memberships }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [roleChoice, setRoleChoice] = useState<RoleChoice>('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrentlyOrgAdmin = useMemo(
    () => memberships.some((m) => m.role === 'admin' && !m.location_id),
    [memberships]
  );
  const isCurrentlyAdmin = useMemo(
    () => memberships.some((m) => m.role === 'admin'),
    [memberships]
  );

  useEffect(() => {
    if (!visible) return;
    if (isCurrentlyOrgAdmin) setRoleChoice('org_admin');
    else if (isCurrentlyAdmin) setRoleChoice('location_admin');
    else setRoleChoice('member');
    setError(null);
  }, [visible, isCurrentlyOrgAdmin, isCurrentlyAdmin]);

  const handleSave = async () => {
    if (!orgId || !userId) return;
    setSaving(true);
    setError(null);
    try {
      if (roleChoice === 'member' || roleChoice === 'location_admin') {
        // Location-scoped roles require at least one location membership.
        // If the user is currently org-admin (single null-location row), the
        // caller must route them through Manage locations first to pick real
        // locations. Refuse the transition here.
        if (isCurrentlyOrgAdmin) {
          setError(t('business.team.rolePickLocationsFirst', {
            defaultValue: "Choisissez d'abord des emplacements via « Gérer les emplacements » avant de changer le rôle.",
          }));
          setSaving(false);
          return;
        }
        const newRole = roleChoice === 'member' ? 'member' : 'admin';
        for (const m of memberships) {
          await updateMember(orgId, m.membership_id, { role: newRole });
        }
      } else {
        // org_admin: wipe every existing membership, then insert a single
        // (role='admin', location_id=null) row. The safest way with the
        // current API is to reuse one of the existing membership rows: update
        // it to null-location + admin, then delete the rest.
        if (memberships.length === 0) {
          setError('No memberships to promote');
          setSaving(false);
          return;
        }
        const [keep, ...drop] = memberships;
        await updateMember(orgId, keep.membership_id, { role: 'admin', location_id: null });
        for (const m of drop) await removeMember(orgId, m.membership_id);
      }
      // Invalidate my-context too so the header dropdown / dashboard see the
      // role change immediately when the admin changed their own role.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['org-details'] }),
        queryClient.invalidateQueries({ queryKey: ['my-context'] }),
      ]);
      await queryClient.refetchQueries({ queryKey: ['org-details', orgId] });
      await queryClient.refetchQueries({ queryKey: ['my-context'] });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour' }));
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 380, maxHeight: '85%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
              {t('business.team.changeRole', { defaultValue: 'Changer le rôle' })}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
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
          </ScrollView>
          {error ? (
            <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 8, textAlign: 'center' }}>{error}</Text>
          ) : null}
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12, opacity: saving ? 0.5 : 1 }}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('common.save', { defaultValue: 'Enregistrer' })}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
