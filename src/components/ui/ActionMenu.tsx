/**
 * ActionMenu — presentational building blocks for the 3-dot (kebab) popover.
 *
 * Only the *visual* card + rows live here; call sites keep their own absolute
 * positioning / measurement and dismiss logic (box-none Pressable, root-Modal,
 * etc.) untouched. Swap the inline white card for <ActionMenuCard> and each
 * <TouchableOpacity> row for <ActionMenuItem> / <ActionMenuDivider>.
 *
 * The card inherits the warm-paper texture from PaperSurface (gradient wash +
 * hairline border + soft shadow); the destructive row gets a faint muted inset
 * background so "delete" reads calm instead of relying on red text alone.
 */
import React from 'react';
import { View, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { tokens } from '@/src/theme/tokens';
import { PaperSurface } from './PaperSurface';

interface ActionMenuCardProps {
  children: React.ReactNode;
  /** Positioning / size style from the call site (absolute top/right, minWidth…). */
  style?: StyleProp<ViewStyle>;
}

export function ActionMenuCard({ children, style }: ActionMenuCardProps) {
  return (
    <PaperSurface radius={tokens.radii.r14} shadow="md" style={[{ minWidth: 168, paddingVertical: 4 }, style]}>
      {children}
    </PaperSurface>
  );
}

interface ActionMenuItemProps {
  /** A lucide icon node sized 15, colored by the caller. */
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  /** Renders the label in red + a faint muted inset background. */
  destructive?: boolean;
}

export function ActionMenuItem({ icon, label, onPress, destructive = false }: ActionMenuItemProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 11,
        paddingHorizontal: 14,
        gap: 10,
        backgroundColor: destructive ? tokens.colors.surfaceMuted : 'transparent',
      }}
    >
      {icon}
      <Text
        style={{
          color: destructive ? '#b94545' : tokens.colors.textPrimary,
          ...tokens.typography.bodySm,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function ActionMenuDivider() {
  return <View style={{ height: 1, backgroundColor: tokens.colors.divider, marginHorizontal: 12 }} />;
}
