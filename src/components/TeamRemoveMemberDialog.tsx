import React, { useState, useMemo } from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Trash2 } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/src/lib/api';
import { useTheme } from '@/src/theme/ThemeProvider';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { removeMember, type OrgMemberFromAPI, type OrgLocationFromAPI } from '@/src/services/teams';

interface Props {
  visible: boolean;
  onClose: () => void;
  onRemoved?: () => void;             // fired after a successful remove (e.g. to pop a screen)
  orgId: number | string | undefined;
  memberName: string;
  memberships: OrgMemberFromAPI[];    // all of this user's memberships in the org
  /** Filter scope the admin is currently viewing. `null` = unfiltered (remove from all). */
  scopedLocationId: number | null;
  /** All org locations — used to look up human names for the "Il restera à A, B" line. */
  locations: OrgLocationFromAPI[];
}

/**
 * Shared confirmation dialog for removing a team member. Behavior depends on
 * scope:
 *
 *  - When viewing a specific location (`scopedLocationId != null`): removes
 *    only the membership at that location. If it's the user's last membership
 *    in the org, warn that their business account will be deleted.
 *  - When viewing unfiltered (`scopedLocationId == null`): removes ALL of the
 *    user's memberships. Always account-deleting since there won't be any
 *    memberships left.
 *  - A secondary "Retirer de tous les emplacements" button appears when
 *    scoped AND the user has sibling memberships — skips the scoped-delete
 *    and removes everywhere in one pass.
 *
 * The backend already cleans up the `users` row only when the last membership
 * is gone, so we don't need to gate the destructive copy separately — it's
 * accurate as long as we tell the truth about whether this delete is the
 * last one.
 */
export function TeamRemoveMemberDialog({
  visible, onClose, onRemoved, orgId, memberName, memberships, scopedLocationId, locations,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'scoped' | 'all'>('scoped');
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!visible) return;
    setMode(scopedLocationId != null ? 'scoped' : 'all');
    setError(null);
  }, [visible, scopedLocationId]);

  const scopedMembership = useMemo(
    () => memberships.find((m) => Number(m.location_id) === Number(scopedLocationId)),
    [memberships, scopedLocationId]
  );
  const otherMemberships = useMemo(
    () => memberships.filter((m) => String(m.membership_id) !== String(scopedMembership?.membership_id)),
    [memberships, scopedMembership]
  );
  const otherLocationNames = useMemo(
    () => otherMemberships
      .map((m) => locations.find((l) => Number(l.id) === Number(m.location_id))?.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0),
    [otherMemberships, locations]
  );

  // Is this delete going to wipe the user's business account?
  const willDeleteAccount = mode === 'all' || (mode === 'scoped' && otherMemberships.length === 0);
  // Which location name to show in the main sentence when scoped?
  const scopedLocationName = locations.find((l) => Number(l.id) === Number(scopedLocationId))?.name ?? '';

  const handleConfirm = async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'all') {
        for (const m of memberships) await removeMember(orgId, m.membership_id);
      } else if (scopedMembership) {
        await removeMember(orgId, scopedMembership.membership_id);
      }
      // my-context is the source-of-truth for my own memberships too, so
      // invalidate it in case an admin just removed themselves (rare but
      // possible — e.g. a location admin leaving their own location).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['org-details'] }),
        queryClient.invalidateQueries({ queryKey: ['my-context'] }),
      ]);
      await queryClient.refetchQueries({ queryKey: ['org-details', orgId] });
      await queryClient.refetchQueries({ queryKey: ['my-context'] });
      setLoading(false);
      onClose();
      onRemoved?.();
    } catch (err: any) {
      setError(getErrorMessage(err, t('business.team.removeMemberFailed', { defaultValue: 'Échec du retrait du membre' })));
      setLoading(false);
    }
  };

  // Copy for the main explanation line.
  let bodyText = '';
  if (mode === 'all') {
    bodyText = t('business.team.removeFromAllDesc', {
      defaultValue: `${memberName} sera retiré de tous les emplacements de cette organisation.`,
    });
  } else if (scopedMembership && otherMemberships.length > 0) {
    bodyText = t('business.team.removeFromOneKeepOthers', {
      defaultValue: `${memberName} sera retiré de ${scopedLocationName}. Il restera membre de : ${otherLocationNames.join(', ')}.`,
    });
  } else {
    bodyText = t('business.team.removeLastMembership', {
      defaultValue: `${memberName} n'est rattaché qu'à ${scopedLocationName}. Son compte business sera entièrement supprimé si vous continuez.`,
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <PaperSurface radius={24} shadow="lg" style={{ width: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingTop: 10, paddingHorizontal: 24, paddingBottom: insets.bottom + 20, alignItems: 'center' }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.divider, marginBottom: 16 }} />
          <View style={{ backgroundColor: theme.colors.surfaceMuted, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
            <Trash2 size={26} color={theme.colors.textSecondary} />
          </View>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, textAlign: 'center', marginBottom: 10 }}>
            {t('business.profile.removeMember', { defaultValue: 'Retirer le membre' })}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 14 }}>
            {bodyText}
          </Text>

          {willDeleteAccount && (
            <View style={{ backgroundColor: theme.colors.warning + '14', borderRadius: 12, padding: 12, width: '100%', marginBottom: 14, borderWidth: 1, borderColor: theme.colors.warning + '40' }}>
              <Text style={{ color: '#9a6b15', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
                {t('business.team.accountWillBeDeletedWarn', { defaultValue: 'Son compte business sera entièrement supprimé.' })}
              </Text>
            </View>
          )}

          {/* Secondary toggle: "remove from all locations" when scoped + has siblings */}
          {scopedLocationId != null && otherMemberships.length > 0 && (
            <TouchableOpacity
              onPress={() => setMode(mode === 'all' ? 'scoped' : 'all')}
              style={{ paddingVertical: 6, marginBottom: 14 }}
            >
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' }}>
                {mode === 'all'
                  ? t('business.team.backToScopedRemove', { defaultValue: 'Retirer seulement de cet emplacement' })
                  : t('business.team.removeFromAllLocations', { defaultValue: 'Retirer de tous les emplacements' })}
              </Text>
            </TouchableOpacity>
          )}

          {error ? (
            <Text style={{ color: theme.colors.error, fontSize: 12, textAlign: 'center', marginBottom: 10 }}>{error}</Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
            <TouchableOpacity
              onPress={onClose}
              disabled={loading}
              style={{ flex: 1, backgroundColor: theme.colors.bg, borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.divider, opacity: loading ? 0.6 : 1 }}
            >
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>
                {t('common.cancel', { defaultValue: 'Annuler' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleConfirm}
              disabled={loading}
              style={{ flex: 1, backgroundColor: theme.colors.error, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? <ActivityIndicator color="#fff" /> : (
                <Text style={{ color: '#fff', fontWeight: '600' }}>
                  {t('business.team.confirmRemove', { defaultValue: 'Retirer' })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </PaperSurface>
      </View>
    </Modal>
  );
}
