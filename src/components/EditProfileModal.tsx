/**
 * EditProfileModal — edit the user's name + gender from a single place.
 *
 * Editing used to live inline on the profile "Informations personnelles"
 * section; it now lives here and is opened from the Settings identity card.
 * The profile section is read-only. Mirrors the old inline save path
 * (updateUserProfile → authStore.setUser).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { ModalCard } from '@/src/components/ui/ModalCard';
import { useAuthStore } from '@/src/stores/authStore';
import { updateUserProfile } from '@/src/services/profile';
import { getErrorMessage } from '@/src/lib/api';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function EditProfileModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? '');
  const [gender, setGender] = useState<string | null>((user as any)?.gender ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Re-seed from the current user every time the modal opens.
  useEffect(() => {
    if (visible) {
      setName(user?.name ?? '');
      setGender((user as any)?.gender ?? null);
      setError('');
    }
  }, [visible, user]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('profile.nameRequired', { defaultValue: 'Le nom est obligatoire.' }));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await updateUserProfile({ name: trimmed, gender: gender ?? undefined });
      if (user) setUser({ ...user, name: trimmed, gender } as any);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, t('profile.updateFailed', { defaultValue: 'La mise à jour a échoué.' })));
    } finally {
      setLoading(false);
    }
  };

  const genderOptions: { key: string | null; label: string }[] = [
    { key: null, label: t('profile.genderNotSet', { defaultValue: 'Non précisé' }) },
    { key: 'male', label: t('profile.genderMale', { defaultValue: 'Homme' }) },
    { key: 'female', label: t('profile.genderFemale', { defaultValue: 'Femme' }) },
  ];

  return (
    <ModalCard visible={visible} onClose={onClose} title={t('profile.editProfile', { defaultValue: 'Modifier le profil' })}>
      {/* Name */}
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 6 }}>
        {t('profile.name')}
      </Text>
      <TextInput
        style={{
          color: theme.colors.textPrimary,
          ...theme.typography.body,
          backgroundColor: theme.colors.bg,
          borderRadius: theme.radii.r12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderWidth: 1,
          borderColor: theme.colors.divider,
          marginBottom: 18,
        }}
        value={name}
        onChangeText={(v) => { setName(v); if (error) setError(''); }}
        placeholder={t('profile.name')}
        placeholderTextColor={theme.colors.muted}
      />

      {/* Gender */}
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.bodySm, marginBottom: 6 }}>
        {t('profile.gender', { defaultValue: 'Genre' })}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
        {genderOptions.map((opt) => {
          const selected = gender === opt.key;
          return (
            <TouchableOpacity
              key={opt.key ?? 'none'}
              onPress={() => setGender(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 10,
                borderRadius: theme.radii.pill,
                backgroundColor: selected ? theme.colors.primary + '18' : theme.colors.bg,
                borderWidth: selected ? 1.5 : 1,
                borderColor: selected ? theme.colors.primary : theme.colors.divider,
              }}
            >
              <Text style={{ color: selected ? theme.colors.primary : theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: selected ? '600' : '400' }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {error ? (
        <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, marginBottom: 12 }}>{error}</Text>
      ) : null}

      <TouchableOpacity
        onPress={save}
        disabled={loading}
        accessibilityRole="button"
        style={{
          backgroundColor: theme.colors.primary,
          borderRadius: theme.radii.pill,
          paddingVertical: 14,
          alignItems: 'center',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>{t('common.save')}</Text>
        )}
      </TouchableOpacity>
    </ModalCard>
  );
}
