import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

export type StatusTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

interface StatusDotProps {
  tone: StatusTone;
  label: string;
  /** Compact mode shrinks the dot and lightens the label for use in dense rows. */
  compact?: boolean;
  /**
   * Override the label color. By default the label uses textPrimary so the
   * label itself reads as copy, not as a loud colored chip.
   */
  color?: string;
}

// Single-line status indicator — a tiny colored dot paired with a plain-color
// label. Replaces the tinted-pill pattern (`backgroundColor: color + '18'`)
// that was splashed across every status, role, and payment badge.
//
// Usage:
//   <StatusDot tone="danger" label="Annulée" />
//   <StatusDot tone="success" label="Vendu" />
export function StatusDot({ tone, label, compact, color }: StatusDotProps) {
  const theme = useTheme();
  const toneColor =
    tone === 'success' ? theme.colors.statusSuccess
      : tone === 'warn' ? theme.colors.statusWarn
      : tone === 'danger' ? theme.colors.statusDanger
      : tone === 'info' ? theme.colors.statusInfo
      : theme.colors.statusNeutral;
  const dotSize = compact ? 5 : 7;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: toneColor,
        }}
      />
      <Text
        style={{
          color: color ?? (compact ? theme.colors.textSecondary : theme.colors.textPrimary),
          fontSize: compact ? 11 : 12,
          lineHeight: compact ? 14 : 16,
          fontFamily: 'Poppins_600SemiBold',
          fontWeight: '600',
          letterSpacing: 0.1,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
