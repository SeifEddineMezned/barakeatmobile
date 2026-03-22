import React, { useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

interface PrimaryCTAButtonProps {
  onPress: () => void;
  title: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
}

export function PrimaryCTAButton({
  onPress,
  title,
  disabled = false,
  loading = false,
  variant = 'primary',
}: PrimaryCTAButtonProps) {
  const theme = useTheme();
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const isPrimary = variant === 'primary';

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        style={[
          styles.button,
          {
            backgroundColor: isPrimary ? theme.colors.primary : theme.colors.surface,
            borderRadius: theme.radii.pill,
            borderWidth: isPrimary ? 0 : 2,
            borderColor: theme.colors.primary,
            opacity: disabled ? 0.5 : 1,
            ...theme.shadows.shadowMd,
          },
        ]}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color={isPrimary ? theme.colors.surface : theme.colors.primary} />
        ) : (
          <Text
            style={[
              styles.buttonText,
              {
                color: isPrimary ? theme.colors.surface : theme.colors.primary,
                ...theme.typography.button,
              },
            ]}
          >
            {title}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  buttonText: {
    textAlign: 'center',
  },
});
