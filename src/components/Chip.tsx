import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

interface ChipProps {
  label: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'outlined' | 'filled';
  size?: 'sm' | 'md';
}

export function Chip({ label, icon, variant = 'default', size = 'md' }: ChipProps) {
  const theme = useTheme();

  const isSmall = size === 'sm';
  const isFilled = variant === 'filled';
  const isOutlined = variant === 'outlined';

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: isFilled ? theme.colors.primary : theme.colors.surface,
          borderRadius: theme.radii.pill,
          borderWidth: isOutlined ? 1 : 0,
          borderColor: theme.colors.divider,
          paddingHorizontal: isSmall ? theme.spacing.md : theme.spacing.lg,
          paddingVertical: isSmall ? theme.spacing.xs : theme.spacing.sm,
          ...(!isFilled && theme.shadows.shadowSm),
        },
      ]}
    >
      {icon && <View style={styles.icon}>{icon}</View>}
      <Text
        style={[
          {
            color: isFilled ? theme.colors.surface : theme.colors.textSecondary,
            ...(isSmall ? theme.typography.caption : theme.typography.bodySm),
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 4,
  },
});
