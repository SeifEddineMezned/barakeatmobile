import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronDown, ChevronUp, Key, MapPin } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/src/theme/ThemeProvider';
import {
  fetchMyContext,
  fetchOrganizationDetails,
  addMember,
  sendMemberCredentials,
  type OrgDetailsFromAPI,
} from '@/src/services/teams';
import { useCustomAlert } from '@/src/components/CustomAlert';
import { getErrorMessage } from '@/src/lib/api';
import { formatLocationName } from '@/src/utils/formatLocation';

type PermissionKey = 'confirm_pickup' | 'edit_quantities' | 'edit_basket_info' | 'create_delete_baskets' | 'view_history' | 'messaging' | 'cancel_order';
// Unified with the change-role popup (TeamRoleChangeModal) — three roles
// only: Membre / Admin de l'emplacement / Admin de l'organisation.
// Finer-grained controls live behind "Permissions avancées" below.
type RolePreset = 'member' | 'location_admin' | 'org_admin';

function permBoolToString(val: boolean): string {
  return val ? 'write' : 'none';
}

interface PresetConfig {
  id: RolePreset;
  labelKey: string;
  descKey: string;
  role: 'admin' | 'member';
  permissions: Record<PermissionKey, boolean>;
}

const ROLE_PRESETS: PresetConfig[] = [
  {
    id: 'member',
    labelKey: 'business.team.roleMember',
    descKey: 'business.team.roleMemberDesc',
    role: 'member',
    // Sensible baseline — most members will need to confirm pickups and
    // message customers. Anything else is opt-in via "Permissions avancées".
    permissions: { confirm_pickup: true, edit_quantities: false, edit_basket_info: false, create_delete_baskets: false, view_history: false, messaging: true, cancel_order: false },
  },
  {
    id: 'location_admin',
    labelKey: 'business.team.roleLocationAdmin',
    descKey: 'business.team.roleLocationAdminDesc',
    role: 'admin',
    permissions: { confirm_pickup: true, edit_quantities: true, edit_basket_info: true, create_delete_baskets: true, view_history: true, messaging: true, cancel_order: true },
  },
  {
    id: 'org_admin',
    labelKey: 'business.team.roleOrgAdmin',
    descKey: 'business.team.roleOrgAdminDesc',
    role: 'admin',
    permissions: { confirm_pickup: true, edit_quantities: true, edit_basket_info: true, create_delete_baskets: true, view_history: true, messaging: true, cancel_order: true },
  },
];

export default function AddMemberScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const alert = useCustomAlert();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ locationId?: string }>();
  const preSelectedLocation = params.locationId ? Number(params.locationId) : null;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => Math.random().toString(36).slice(-8));
  const [role, setRole] = useState<'admin' | 'member'>('member');
  // Multi-location: a member can be assigned to multiple locations by creating
  // one membership row per location. preSelectedLocation (when arriving from a
  // location card) seeds the initial selection but the admin can still add more.
  const [locationIds, setLocationIds] = useState<Set<number>>(() => {
    const set = new Set<number>();
    if (preSelectedLocation) set.add(preSelectedLocation);
    return set;
  });
  const [selectedPreset, setSelectedPreset] = useState<RolePreset | null>('member');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sendCredentials, setSendCredentials] = useState(true);
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>({
    confirm_pickup: true, edit_quantities: false, edit_basket_info: false, create_delete_baskets: false, view_history: false, messaging: true, cancel_order: false,
  });

  const contextQuery = useQuery({ queryKey: ['my-context'], queryFn: fetchMyContext, staleTime: 60_000 });
  const orgId = contextQuery.data?.organization_id;

  const orgDetailsQuery = useQuery({
    queryKey: ['org-details', orgId],
    queryFn: () => fetchOrganizationDetails(orgId!),
    enabled: !!orgId,
    staleTime: 60_000,
  });
  const locations = (orgDetailsQuery.data as OrgDetailsFromAPI | undefined)?.locations ?? [];

  const handleSelectPreset = (preset: PresetConfig) => {
    setSelectedPreset(preset.id);
    setRole(preset.role);
    setPermissions(preset.permissions);
  };

  const permissionLabels: { key: PermissionKey; label: string; desc: string }[] = [
    { key: 'confirm_pickup', label: t('business.profile.permConfirmPickup', { defaultValue: 'Confirmer les retraits' }), desc: t('business.profile.permConfirmPickupDesc', { defaultValue: "Scanner le QR / saisir le code pour confirmer le retrait d'un client" }) },
    { key: 'edit_quantities', label: t('business.profile.permEditQuantities', { defaultValue: 'Modifier les quantités' }), desc: t('business.profile.permEditQuantitiesDesc', { defaultValue: 'Changer la quantité disponible des paniers, mettre en pause les ventes' }) },
    { key: 'edit_basket_info', label: t('business.profile.permEditBasketInfo', { defaultValue: 'Modifier les paniers' }), desc: t('business.profile.permEditBasketInfoDesc', { defaultValue: 'Modifier le prix, description, horaires de retrait et instructions' }) },
    { key: 'create_delete_baskets', label: t('business.profile.permCreateDeleteBaskets', { defaultValue: 'Créer et supprimer des paniers' }), desc: t('business.profile.permCreateDeleteBasketsDesc', { defaultValue: 'Ajouter de nouveaux paniers ou supprimer des paniers existants' }) },
    { key: 'view_history', label: t('business.profile.permViewHistory', { defaultValue: 'Historique et statistiques' }), desc: t('business.profile.permViewHistoryDesc', { defaultValue: "Voir les stats de vente, l'historique des commandes et les graphiques de performance" }) },
    { key: 'messaging', label: t('business.profile.permMessaging', { defaultValue: 'Messagerie clients' }), desc: t('business.profile.permMessagingDesc', { defaultValue: 'Envoyer et recevoir des messages avec les clients' }) },
    { key: 'cancel_order', label: t('business.profile.permCancelOrder', { defaultValue: 'Annuler des commandes' }), desc: t('business.profile.permCancelOrderDesc', { defaultValue: 'Annuler les commandes entrantes et rembourser les clients en crédits' }) },
  ];

  const isOrgAdminSelected = selectedPreset === 'org_admin';
  const canSubmit = name.trim() && email.trim() && password && (isOrgAdminSelected || locationIds.size > 0 || locations.length === 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error(t('business.team.noOrg', { defaultValue: 'Organisation introuvable' }));
      const permsPayload: Record<string, string> = {
        confirm_pickup: permBoolToString(permissions.confirm_pickup),
        edit_quantities: permBoolToString(permissions.edit_quantities),
        edit_basket_info: permBoolToString(permissions.edit_basket_info),
        create_delete_baskets: permBoolToString(permissions.create_delete_baskets),
        view_history: permBoolToString(permissions.view_history),
        messaging: permBoolToString(permissions.messaging),
        cancel_order: permBoolToString(permissions.cancel_order),
      };
      const basePayload = {
        email: email.trim(),
        name: name.trim(),
        password,
        role,
        permissions: permsPayload,
      };
      // Org admins have no location constraint — one membership without location_id.
      if (isOrgAdminSelected) {
        const result = await addMember(orgId, basePayload);
        return { firstResult: result, assignedLocationIds: [] as number[] };
      }
      // Non-admins: create one membership per selected location. The first call
      // creates the user account; subsequent calls reuse the same email (backend
      // handles the second-membership-for-existing-user case).
      const ids = Array.from(locationIds);
      if (ids.length === 0) {
        const result = await addMember(orgId, basePayload);
        return { firstResult: result, assignedLocationIds: [] as number[] };
      }
      let firstResult: any = null;
      for (const locId of ids) {
        const res = await addMember(orgId, { ...basePayload, location_id: locId });
        if (!firstResult) firstResult = res;
      }
      return { firstResult, assignedLocationIds: ids };
    },
    onSuccess: async ({ firstResult, assignedLocationIds }) => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      void queryClient.invalidateQueries({ queryKey: ['my-context'] });
      const tempPw = firstResult?.temporary_password || password;
      // Send credentials email once (the user receives a single welcome email
      // regardless of how many location memberships were created).
      let emailStatusLine = '';
      const membershipId = firstResult?.member?.id ?? firstResult?.membership_id;
      if (sendCredentials && orgId && membershipId) {
        try {
          await sendMemberCredentials(orgId, membershipId, tempPw);
          emailStatusLine = '\n\n' + t('business.team.credentialsSent', { defaultValue: 'Identifiants envoyés par email.' });
        } catch (err: any) {
          emailStatusLine = '\n\n' + t('business.team.emailSendFailed', { defaultValue: "L'envoi de l'email a échoué" }) + `: ${getErrorMessage(err)}`;
        }
      }
      const locationNames = assignedLocationIds
        .map((id) => {
          const bare = (locations as any[]).find((l: any) => l.id === id)?.name;
          return bare ? formatLocationName(contextQuery.data?.organization_name, bare) : null;
        })
        .filter(Boolean);
      const locationLine = locationNames.length > 0
        ? `\n${t('business.team.assignedTo', { defaultValue: 'Assigné à' })}: ${locationNames.join(', ')}`
        : '';
      alert.showAlert(
        t('common.success'),
        `${t('business.profile.memberAdded')}\n\n${t('business.team.fieldEmail', { defaultValue: 'Email' })}: ${email.trim()}\n${t('business.team.fieldPassword', { defaultValue: 'Mot de passe' })}: ${tempPw}${locationLine}${emailStatusLine}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    },
    onError: (err: any) => {
      // Backend rejects cross-org partner adds with a typed 409. Surface a
      // dedicated alert that names the conflicting org so the admin knows
      // exactly why the email was refused. The apiClient interceptor
      // unwraps the axios error to { status, message, data, isApiError },
      // so the payload lives at err.data (not err.response.data).
      if (err?.data?.error === 'email_already_partner_elsewhere') {
        const otherOrg =
          err.data.other_org_name
          || t('business.team.addMemberError.otherCommerce', { defaultValue: 'un autre commerce' });
        alert.showAlert(
          t('business.team.addMemberError.title', { defaultValue: 'Email déjà utilisé' }),
          t('business.team.addMemberError.emailInOtherOrg', {
            org: otherOrg,
            defaultValue: `Cet email est déjà associé à ${otherOrg}. Utilisez une adresse différente, ou retirez d'abord ce membre de l'autre commerce.`,
          }),
        );
        return;
      }
      alert.showAlert(t('common.error'), getErrorMessage(err));
    },
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[theme.typography.h2, { color: theme.colors.textPrimary, flex: 1, marginLeft: 12 }]}>
          {t('business.team.addMemberTitle', { defaultValue: 'Ajouter un membre' })}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Name ── */}
        <Text style={styles.sectionLabel}>
          {t('business.team.fieldName', { defaultValue: 'Nom complet' })}
          <Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, color: theme.colors.textPrimary }]}
          value={name}
          onChangeText={setName}
          placeholder={t('business.team.fieldNamePlaceholder', { defaultValue: 'Ex: Ahmed Ben Ali' })}
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="words"
        />

        {/* ── Email ── */}
        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
          {t('business.team.fieldEmail', { defaultValue: 'Email' })}
          <Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, color: theme.colors.textPrimary }]}
          value={email}
          onChangeText={setEmail}
          placeholder={t('business.team.fieldEmailPlaceholder', { defaultValue: 'membre@example.com' })}
          placeholderTextColor={theme.colors.muted}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        {/* ── Password ── */}
        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
          {t('business.team.fieldPassword', { defaultValue: 'Mot de passe temporaire' })}
          <Text style={{ color: theme.colors.error }}> *</Text>
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider, color: theme.colors.textPrimary, flex: 1 }]}
            value={password}
            onChangeText={setPassword}
            placeholder={t('business.team.fieldPasswordPlaceholder', { defaultValue: 'Mot de passe' })}
            placeholderTextColor={theme.colors.muted}
          />
          <TouchableOpacity
            onPress={() => setPassword(Math.random().toString(36).slice(-8))}
            style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingHorizontal: 14, height: 48, justifyContent: 'center' }}
          >
            <Key size={18} color="#e3ff5c" />
          </TouchableOpacity>
        </View>

        {/* ── Role ── */}
        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
          {t('business.team.fieldRole', { defaultValue: 'R\u00f4le' })}
        </Text>
        {ROLE_PRESETS.map((preset) => {
          const isSelected = selectedPreset === preset.id;
          return (
            <TouchableOpacity
              key={preset.id}
              onPress={() => handleSelectPreset(preset)}
              style={{
                flexDirection: 'row', alignItems: 'center',
                padding: 14, borderRadius: 12, marginBottom: 6,
                backgroundColor: isSelected ? '#114b3c12' : theme.colors.surface,
                borderWidth: isSelected ? 1.5 : 1,
                borderColor: isSelected ? '#114b3c' : theme.colors.divider,
              }}
            >
              <View style={{
                width: 18, height: 18, borderRadius: 9, borderWidth: 2,
                borderColor: isSelected ? '#114b3c' : theme.colors.muted,
                backgroundColor: isSelected ? '#114b3c' : 'transparent',
                marginRight: 10, justifyContent: 'center', alignItems: 'center',
              }}>
                {isSelected && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: isSelected ? '#114b3c' : theme.colors.textPrimary, fontSize: 14, fontWeight: isSelected ? '600' : '400' }}>
                  {t(preset.labelKey, { defaultValue: preset.id })}
                </Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 1 }}>
                  {t(preset.descKey, { defaultValue: '' })}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* ── Advanced Permissions ── */}
        <TouchableOpacity
          onPress={() => setShowAdvanced((prev) => !prev)}
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingVertical: 10 }}
        >
          <Text style={{ color: '#114b3c', fontSize: 14, fontWeight: '600', flex: 1 }}>
            {t('business.team.advancedPermissions', { defaultValue: 'Permissions avanc\u00e9es' })}
          </Text>
          {showAdvanced ? <ChevronUp size={16} color="#114b3c" /> : <ChevronDown size={16} color="#114b3c" />}
        </TouchableOpacity>

        {showAdvanced && (
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 12, padding: 14, marginTop: 4, borderWidth: 1, borderColor: theme.colors.divider }}>
            {permissionLabels.map(({ key, label, desc }) => (
              <View key={key} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 12 }}>{label}</Text>
                  <Switch
                    value={permissions[key]}
                    onValueChange={(val) => {
                      setPermissions((prev) => ({ ...prev, [key]: val }));
                      setSelectedPreset(null);
                    }}
                    trackColor={{ false: theme.colors.divider, true: '#114b3c50' }}
                    thumbColor={permissions[key] ? '#114b3c' : theme.colors.muted}
                  />
                </View>
                <Text style={{ color: permissions[key] ? theme.colors.textSecondary : theme.colors.muted, fontSize: 11, lineHeight: 15, marginTop: 4 }}>
                  {desc}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Location Assignment — required for non-org-admin. Multi-select:
             the admin can tick several locations and we create one membership
             per tick. ── */}
        {locations.length > 0 && !isOrgAdminSelected && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
              {t('business.team.assignLocations', { defaultValue: 'Assigner aux emplacements *' })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginBottom: 8 }}>
              {t('business.team.assignLocationsHint', { defaultValue: 'Sélectionnez un ou plusieurs emplacements' })}
            </Text>
            {locations.map((loc: any) => {
              const isChecked = locationIds.has(loc.id);
              return (
                <TouchableOpacity
                  key={loc.id}
                  onPress={() => {
                    setLocationIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(loc.id)) next.delete(loc.id);
                      else next.add(loc.id);
                      return next;
                    });
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    padding: 14, borderRadius: 12, marginBottom: 6,
                    backgroundColor: isChecked ? '#114b3c15' : theme.colors.surface,
                    borderWidth: isChecked ? 1.5 : 1,
                    borderColor: isChecked ? '#114b3c' : theme.colors.divider,
                  }}
                >
                  <View style={{
                    width: 20, height: 20, borderRadius: 6, borderWidth: 2,
                    borderColor: isChecked ? '#114b3c' : theme.colors.muted,
                    backgroundColor: isChecked ? '#114b3c' : 'transparent',
                    marginRight: 10, justifyContent: 'center', alignItems: 'center',
                  }}>
                    {isChecked && <Text style={{ color: '#fff', fontSize: 13, lineHeight: 15, fontWeight: '700' }}>✓</Text>}
                  </View>
                  <MapPin size={14} color="#114b3c" />
                  <Text style={{ color: theme.colors.textPrimary, fontSize: 14, marginLeft: 8, flex: 1 }}>
                    {loc.name ?? loc.address ?? 'Location'}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {locationIds.size === 0 && (
              <Text style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>
                {t('business.profile.locationRequired', { defaultValue: 'Veuillez sélectionner au moins un emplacement' })}
              </Text>
            )}
          </>
        )}

        {/* ── Send credentials toggle ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingVertical: 10 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, flex: 1 }}>
            {t('business.team.sendCredentials', { defaultValue: 'Envoyer les identifiants par email' })}
          </Text>
          <Switch
            value={sendCredentials}
            onValueChange={setSendCredentials}
            trackColor={{ false: theme.colors.divider, true: '#114b3c50' }}
            thumbColor={sendCredentials ? '#114b3c' : theme.colors.muted}
          />
        </View>

        {/* ── Submit ── */}
        <TouchableOpacity
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending || !canSubmit}
          style={{
            backgroundColor: canSubmit ? '#114b3c' : theme.colors.muted,
            borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 28,
          }}
        >
          {mutation.isPending ? (
            <ActivityIndicator color="#e3ff5c" />
          ) : (
            <Text style={{ color: '#e3ff5c', fontWeight: '700', fontSize: 16 }}>
              {t('business.team.addMemberBtn', { defaultValue: 'Ajouter le membre' })}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sectionLabel: {
    color: '#114b3c', fontSize: 13, fontWeight: '700',
    textTransform: 'none', letterSpacing: 0.5, marginBottom: 6,
  },
  input: {
    borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15,
  },
});
