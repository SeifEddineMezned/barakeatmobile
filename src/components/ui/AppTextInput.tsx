/**
 * AppTextInput — the calm filled form field used inside popups/modals.
 *
 * Replaces the "heavy solid-teal border box with a label floating above bare
 * text" look. Renders an uppercase eyebrow label, then a filled field
 * (surfaceMuted background + hairline border that turns brand-green on focus),
 * with an optional built-in password eye toggle. Stacking several of these
 * gives clear structure without ad-hoc divider lines.
 *
 * (Auth screens keep using the original <PasswordInput>; this is the modal kit.)
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { tokens } from '@/src/theme/tokens';

interface AppTextInputProps extends Omit<TextInputProps, 'secureTextEntry'> {
  /** Uppercase eyebrow label rendered above the field. */
  label?: string;
  /** Error message rendered in red beneath the field. */
  error?: string | null;
  /** Outer wrapper (label + field + error). Put marginBottom here. */
  containerStyle?: StyleProp<ViewStyle>;
  /** The bordered field box. */
  fieldStyle?: StyleProp<ViewStyle>;
  /** TextInput style. */
  style?: StyleProp<TextStyle>;
  /** Render a password masking field with an eye toggle. */
  secureToggle?: boolean;
  /** Node rendered at the trailing edge of the field (ignored when secureToggle). */
  rightAdornment?: React.ReactNode;
}

export function AppTextInput({
  label,
  error,
  containerStyle,
  fieldStyle,
  style,
  secureToggle = false,
  rightAdornment,
  placeholderTextColor,
  onFocus,
  onBlur,
  ...rest
}: AppTextInputProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={containerStyle}>
      {label ? (
        <Text style={{ color: tokens.colors.textSecondary, ...tokens.typography.label, marginBottom: 8 }}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: tokens.colors.surfaceMuted,
            borderWidth: 1,
            borderColor: focused ? tokens.colors.primary : tokens.colors.border,
            borderRadius: tokens.radii.r12,
            overflow: 'hidden',
          },
          fieldStyle,
        ]}
      >
        <TextInput
          {...rest}
          secureTextEntry={secureToggle ? !revealed : false}
          placeholderTextColor={placeholderTextColor ?? tokens.colors.muted}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[
            { flex: 1, height: 48, paddingHorizontal: 16, color: tokens.colors.textPrimary, ...tokens.typography.body },
            style,
          ]}
        />
        {secureToggle ? (
          <TouchableOpacity
            onPress={() => setRevealed((v) => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ paddingHorizontal: 14 }}
            accessibilityLabel={revealed ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          >
            {revealed ? <Eye size={20} color={tokens.colors.primary} /> : <EyeOff size={20} color={tokens.colors.muted} />}
          </TouchableOpacity>
        ) : (
          rightAdornment
        )}
      </View>
      {error ? (
        <Text style={{ color: tokens.colors.error, ...tokens.typography.caption, marginTop: 6 }}>{error}</Text>
      ) : null}
    </View>
  );
}
