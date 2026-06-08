import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { X, MapPin } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { useTheme } from '@/src/theme/ThemeProvider';
import { addMember, removeMember, type OrgMemberFromAPI, type OrgLocationFromAPI } from '@/src/services/teams';

interface Props {
  visible: boolean;
  onClose: () => void;
  orgId: number | string | undefined;
  userId: number | string | undefined;
  memberships: OrgMemberFromAPI[];       // all memberships for this user in this org
  locations: OrgLocationFromAPI[];       // every location in the org
  currentRole: 'admin' | 'member';       // preserved when creating new rows
  currentPermissions: Record<string, string>;
  currentEmail: string;
  currentName: string;
}

/**
 * Multi-location manager. Replaces the single-select "Reassign location"
 * modal. Lets an org/location admin diff the set of locations a user belongs
 * to — checking a new one creates a membership row, unchecking deletes one.
 *
 * Semantics:
 * - The master "Tout sélectionner" checkbox is a UX shortcut only — it ticks
 *   every location at once. It does NOT mean "org admin"; that promotion is
 *   handled exclusively in the role modal.
 * - Hidden entirely for users who are currently org admins (single row with
 *   location_id=null) — they have no per-location set to edit.
 * - Save is disabled when zero boxes are checked; removing the user entirely
 *   lives in the "Retirer le membre" flow.
 */
export function TeamLocationsManagerModal({
  visible, onClose, orgId, userId, memberships, locations,
  currentRole, currentPermissions, currentEmail, currentName,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Is this user currently an org-admin? If so, don't render — the role modal
  // owns their scope.
  const isOrgAdminUser = useMemo(
    () => memberships.some((m) => m.role === 'admin' && !m.location_id),
    [memberships]
  );

  useEffect(() => {
    if (!visible) return;
    const initial = new Set<number>();
    for (const m of memberships) if (m.location_id) initial.add(Number(m.location_id));
    setSelectedIds(initial);
    setError(null);
  }, [visible, memberships]);

  const allChecked = locations.length > 0 && selectedIds.size === locations.length;
  const toggleMaster = () => {
    if (allChecked) setSelectedIds(new Set());
    else setSelectedIds(new Set(locations.map((l) => Number(l.id))));
  };
  const toggleLocation = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!orgId || !userId) return;
    if (selectedIds.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      // Diff: delete memberships whose location_id isn't in the target set,
      // and create a membership for each newly-selected location.
      const currentLocIds = new Set(memberships.map((m) => Number(m.location_id)).filter(Boolean));
      const toDelete = memberships.filter((m) => m.location_id && !selectedIds.has(Number(m.location_id)));
      const toCreate = Array.from(selectedIds).filter((id) => !currentLocIds.has(id));

      // Deletes first — avoids the backend's (org, user, location) uniqueness
      // tripping if a row was swapped (delete A, add A wouldn't happen in one
      // pass, but the pattern keeps the DB state clean regardless).
      for (const m of toDelete) {
        await removeMember(orgId, m.membership_id);
      }
      // For creates, addMember requires email/name/password — on the backend
      // the existing restaurant-typed user row is reused by email lookup, so
      // the password field is effectively ignored. Pass a throwaway.
      for (const locId of toCreate) {
        await addMember(orgId, {
          email: currentEmail,
          name: currentName,
          password: 'unused-' + Math.random().toString(36).slice(-6),
          role: currentRole,
          location_id: locId,
          permissions: currentPermissions,
        });
      }
      // Invalidate my-context too — if the admin just modified their own set
      // of locations, the header dropdown / dashboard switcher both read from
      // my-context.location_ids and would otherwise show stale rows.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['org-details'] }),
        queryClient.invalidateQueries({ queryKey: ['my-context'] }),
      ]);
      await queryClient.refetchQueries({ queryKey: ['org-details', orgId] });
      await queryClient.refetchQueries({ queryKey: ['my-context'] });
      onClose();
    } catch (err: any) {
      setError(getErrorMessage(err, t('business.team.updateFailed', { defaultValue: 'Échec de la mise à jour' })));
    }
    setSaving(false);
  };

  // Don't surface the modal for org admins — caller should also hide the menu
  // item, but this is a belt-and-braces guard.
  if (isOrgAdminUser) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 380 }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
              {t('business.team.manageLocations', { defaultValue: 'Gérer les emplacements' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 16 }}>
              {t('business.team.orgAdminNoLocationSet', { defaultValue: "Admin de l'organisation — aucun emplacement spécifique. Modifiez le rôle pour scoper cette personne à des emplacements." })}
            </Text>
            <TouchableOpacity onPress={onClose} style={{ backgroundColor: theme.colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{t('common.ok', { defaultValue: 'OK' })}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 380, maxHeight: '85%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3 }}>
              {t('business.team.manageLocations', { defaultValue: 'Gérer les emplacements' })}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 16, marginBottom: 14 }}>
            {t('business.team.manageLocationsHint', { defaultValue: 'Cochez les emplacements où ce membre doit avoir accès.' })}
          </Text>

          {/* Master checkbox */}
          <TouchableOpacity
            onPress={toggleMaster}
            style={{
              flexDirection: 'row', alignItems: 'center',
              padding: 12, borderRadius: 12, marginBottom: 10,
              borderWidth: 1,
              borderColor: allChecked ? theme.colors.primary : theme.colors.divider,
              backgroundColor: allChecked ? theme.colors.primary + '10' : theme.colors.bg,
            }}
          >
            <View style={{
              width: 20, height: 20, borderRadius: 6, borderWidth: 2,
              borderColor: allChecked ? theme.colors.primary : theme.colors.muted,
              backgroundColor: allChecked ? theme.colors.primary : 'transparent',
              marginRight: 10, justifyContent: 'center', alignItems: 'center',
            }}>
              {allChecked && <Text style={{ color: '#fff', fontSize: 13, lineHeight: 15, fontWeight: '700' }}>✓</Text>}
            </View>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
              {t('business.team.selectAllLocations', { defaultValue: 'Tout sélectionner' })}
            </Text>
          </TouchableOpacity>

          <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
            {locations.map((loc) => {
              const id = Number(loc.id);
              const active = selectedIds.has(id);
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
                      {loc.name ?? '—'}
                    </Text>
                    {loc.address ? (
                      <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                        {loc.address}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {error ? (
            <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 8, textAlign: 'center' }}>{error}</Text>
          ) : null}

          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || selectedIds.size === 0}
            style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12, opacity: (saving || selectedIds.size === 0) ? 0.5 : 1 }}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                {t('common.save', { defaultValue: 'Enregistrer' })}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
