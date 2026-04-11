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

type PermissionKey = 'availability' | 'reservations' | 'profile' | 'menu' | 'team';
type RolePreset = 'full_access' | 'orders_only' | 'view_only';

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
    id: 'full_access',
    labelKey: 'business.team.roleFullAccess',
    descKey: 'business.team.roleFullAccessDesc',
    role: 'admin',
    permissions: { availability: true, reservations: true, profile: true, menu: true, team: true },
  },
  {
    id: 'orders_only',
    labelKey: 'business.team.roleOrdersOnly',
    descKey: 'business.team.roleOrdersOnlyDesc',
    role: 'member',
    permissions: { availability: false, reservations: true, profile: false, menu: false, team: false },
  },
  {
    id: 'view_only',
    labelKey: 'business.team.roleViewOnly',
    descKey: 'business.team.roleViewOnlyDesc',
    role: 'member',
    permissions: { availability: true, reservations: true, profile: true, menu: true, team: true },
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
  const [locationId, setLocationId] = useState<number | null>(preSelectedLocation);
  const [selectedPreset, setSelectedPreset] = useState<RolePreset | null>('orders_only');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sendCredentials, setSendCredentials] = useState(true);
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>({
    availability: false, reservations: true, profile: false, menu: false, team: false,
  });

  const contextQuery = useQuery({ queryKey: ['team-context'], queryFn: fetchMyContext, staleTime: 60_000 });
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

  const permissionLabels: { key: PermissionKey; label: string }[] = [
    { key: 'availability', label: t('business.team.permAvailability', { defaultValue: 'Disponibilit\u00e9' }) },
    { key: 'reservations', label: t('business.team.permReservations', { defaultValue: 'Commandes' }) },
    { key: 'profile', label: t('business.team.permProfile', { defaultValue: 'Profil' }) },
    { key: 'menu', label: t('business.team.permMenu', { defaultValue: 'Menu' }) },
    { key: 'team', label: t('business.team.permTeam', { defaultValue: '\u00c9quipe' }) },
  ];

  const canSubmit = name.trim() && email.trim() && password;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No organization');
      const finalLocationId = locationId ?? preSelectedLocation ?? undefined;
      const permsPayload: Record<string, string> = {
        availability: permBoolToString(permissions.availability),
        reservations: permBoolToString(permissions.reservations),
        profile: permBoolToString(permissions.profile),
        menu: permBoolToString(permissions.menu),
        team: permBoolToString(permissions.team),
      };
      return addMember(orgId, {
        email: email.trim(),
        name: name.trim(),
        password,
        role,
        permissions: permsPayload,
        ...(finalLocationId ? { location_id: finalLocationId } : {}),
      });
    },
    onSuccess: async (data) => {
      void queryClient.invalidateQueries({ queryKey: ['org-details'] });
      void queryClient.invalidateQueries({ queryKey: ['team-context'] });
      const tempPw = data?.temporary_password || password;
      // Send credentials email if toggle is on
      if (sendCredentials && orgId && data?.membership_id) {
        try { await sendMemberCredentials(orgId, data.membership_id, tempPw); } catch {}
      }
      alert.showAlert(
        t('common.success'),
        `${t('business.profile.memberAdded')}\n\n${t('business.team.fieldEmail', { defaultValue: 'Email' })}: ${email.trim()}\n${t('business.team.fieldPassword', { defaultValue: 'Mot de passe' })}: ${tempPw}${sendCredentials ? '\n\n' + t('business.team.credentialsSent', { defaultValue: 'Identifiants envoyés par email.' }) : ''}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    },
    onError: (err: any) => {
      alert.showAlert(t('common.error'), err?.message ?? t('common.errorOccurred'));
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
            {permissionLabels.map(({ key, label }) => (
              <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, flex: 1 }}>{label}</Text>
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
            ))}
          </View>
        )}

        {/* ── Location Assignment ── */}
        {locations.length > 0 && !preSelectedLocation && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
              {t('business.team.assignLocation', { defaultValue: 'Assigner \u00e0 un emplacement' })}
            </Text>
            {locations.map((loc: any) => (
              <TouchableOpacity
                key={loc.id}
                onPress={() => setLocationId(locationId === loc.id ? null : loc.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  padding: 14, borderRadius: 12, marginBottom: 6,
                  backgroundColor: locationId === loc.id ? '#114b3c15' : theme.colors.surface,
                  borderWidth: locationId === loc.id ? 1.5 : 1,
                  borderColor: locationId === loc.id ? '#114b3c' : theme.colors.divider,
                }}
              >
                <MapPin size={14} color="#114b3c" />
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14, marginLeft: 8 }}>
                  {loc.name ?? loc.address ?? 'Location'}
                </Text>
              </TouchableOpacity>
            ))}
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
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  input: {
    borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15,
  },
});
