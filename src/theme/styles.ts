import { TextStyle, ViewStyle } from 'react-native';
import type { Theme } from './tokens';

// Shared input + label styles for forms. Use these instead of one-off border /
// padding declarations so every form (auth, location, basket, claim, wallet
// gift-code) inherits the same visual language. 48px tall, 10px radius, 1px
// divider border, surface bg, Poppins regular 15px.
export function inputStyle(
  theme: Theme,
  opts: { invalid?: boolean; multiline?: boolean } = {}
): ViewStyle & TextStyle {
  return {
    minHeight: opts.multiline ? 96 : 48,
    height: opts.multiline ? undefined : 48,
    paddingHorizontal: 14,
    paddingVertical: opts.multiline ? 12 : 0,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.r10,
    borderWidth: 1,
    borderColor: opts.invalid ? theme.colors.error : theme.colors.divider,
    fontSize: 15,
    lineHeight: opts.multiline ? 20 : undefined,
    fontFamily: 'Poppins_400Regular',
    color: theme.colors.textPrimary,
    textAlignVertical: opts.multiline ? 'top' : 'auto',
  };
}

// Eyebrow label placed above inputs and status groups. Uppercase, tracked,
// secondary color — matches theme.typography.label.
export function formLabel(theme: Theme, opts: { marginTop?: number } = {}): TextStyle {
  return {
    color: theme.colors.textSecondary,
    marginTop: opts.marginTop ?? 16,
    marginBottom: 8,
    ...theme.typography.label,
  };
}
