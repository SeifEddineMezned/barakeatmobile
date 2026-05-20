import React from 'react';
import { TouchableOpacity, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

interface FilterChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  /** Optional leading icon (lucide component). Rendered at 14px. */
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  /** Suffix string (e.g. a count) shown after the label in a muted color. */
  suffix?: string | number;
  disabled?: boolean;
  style?: ViewStyle;
}

// Rectangular filter chip. Replaces the oval `borderRadius: 20` pills with a
// tighter 8px-radius outline that feels closer to Uber Eats / Deliveroo and
// less generic. Active state is a filled primary pill — unambiguous selection
// without needing a tint overlay.
//
// Usage:
//   <FilterChip label="Tout" active={filter === 'all'} onPress={() => setFilter('all')} />
//   <FilterChip label="Admins" suffix={3} icon={Shield} />
export function FilterChip({ label, active, onPress, icon: Icon, suffix, disabled, style }: FilterChipProps) {
  const theme = useTheme();
  const fg = active ? '#fff' : theme.colors.textSecondary;
  const suffixColor = active ? 'rgba(255,255,255,0.75)' : theme.colors.muted;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        {
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: active ? theme.colors.primary : theme.colors.divider,
          backgroundColor: active ? theme.colors.primary : theme.colors.surface,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      {Icon ? <Icon size={13} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 12, fontFamily: 'Poppins_600SemiBold', fontWeight: '600', letterSpacing: 0.1 }}>
        {label}
      </Text>
      {suffix != null && suffix !== '' ? (
        <View>
          <Text style={{ color: suffixColor, fontSize: 11, fontFamily: 'Poppins_400Regular' }}>
            {String(suffix)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}
