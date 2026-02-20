import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

interface DiscountBadgeProps {
  percentage: number;
}

export function DiscountBadge({ percentage }: DiscountBadgeProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: theme.colors.discount,
          borderRadius: theme.radii.r8,
          ...theme.shadows.shadowSm,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: theme.colors.surface,
            fontSize: 14,
            fontWeight: '700' as const,
          },
        ]}
      >
        -{percentage}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    textAlign: 'center',
  },
});
