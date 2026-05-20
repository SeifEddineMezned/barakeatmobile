import React, { useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, Animated, View } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

interface PrimaryCTAButtonProps {
  onPress: () => void;
  title: string;
  disabled?: boolean;
  loading?: boolean;
  /**
   * - `primary`: solid primary fill (green)
   * - `secondary`: outlined primary
   * - `destructive`: ghost text-only in error red (no bg, no border, no
   *   shadow). Use as the TRIGGER button for destructive actions — the
   *   loud red fill lives in the confirmation step, not the trigger.
   */
  variant?: 'primary' | 'secondary' | 'destructive';
  compact?: boolean;
  borderRadius?: number;
  /**
   * Optional ref forwarded to the inner TouchableOpacity. The walkthrough
   * uses this to measure the actual button bounds (`measureInWindow`)
   * instead of an outer wrapper that may stretch to fill its parent.
   */
  innerRef?: React.Ref<View>;
  /**
   * onLayout forwarded to the inner TouchableOpacity. Pair with `innerRef`
   * so the walkthrough can publish accurate measurements when the button
   * mounts or its layout changes.
   */
  onInnerLayout?: (e: any) => void;
  /**
   * When true, the button stretches to fill its parent's cross-axis (full
   * width inside a column-flex parent). Use for primary-action footers
   * where the button should span edge-to-edge of the padded area.
   */
  fullWidth?: boolean;
  /**
   * Suppresses the default shadow / elevation. Use when the button sits in
   * a place where the shadow would visually leak past a surrounding
   * highlight (e.g. the create-basket walkthrough halo).
   */
  flat?: boolean;
}

export function PrimaryCTAButton({
  onPress,
  title,
  disabled = false,
  loading = false,
  variant = 'primary',
  compact = false,
  borderRadius,
  innerRef,
  onInnerLayout,
  fullWidth = false,
  flat = false,
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
  const isDestructive = variant === 'destructive';

  const bg = isPrimary
    ? theme.colors.primary
    : isDestructive
      ? 'transparent'
      : theme.colors.surface;
  const fg = isPrimary
    ? theme.colors.surface
    : isDestructive
      ? theme.colors.error
      : theme.colors.primary;
  const borderW = isPrimary || isDestructive ? 0 : 2;

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, fullWidth ? { width: '100%' } : null]}>
      <TouchableOpacity
        ref={innerRef as any}
        onLayout={onInnerLayout}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        style={[
          compact ? styles.buttonCompact : styles.button,
          fullWidth ? { width: '100%' } : null,
          {
            backgroundColor: bg,
            borderRadius: borderRadius ?? theme.radii.pill,
            borderWidth: borderW,
            borderColor: theme.colors.primary,
            opacity: disabled ? 0.5 : 1,
            ...((isDestructive || flat) ? {} : theme.shadows.shadowMd),
          },
        ]}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : (
          <Text
            style={[
              styles.buttonText,
              {
                color: fg,
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
  buttonCompact: {
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  buttonText: {
    textAlign: 'center',
  },
});
