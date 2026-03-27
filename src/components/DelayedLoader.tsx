import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

interface DelayedLoaderProps {
  /** Delay in ms before showing the animation (default 400ms) */
  delay?: number;
  /** Size of the B letter */
  size?: number;
}

/**
 * Shows the Barakeat "B." bouncing animation, but only after a delay.
 * If the content loads before the delay, nothing is shown.
 */
export function DelayedLoader({ delay = 400, size = 36 }: DelayedLoaderProps) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(bounceAnim, {
            toValue: -12,
            duration: 300,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(bounceAnim, {
            toValue: 0,
            duration: 300,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(200),
        ])
      ).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [delay]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Animated.View style={{ flexDirection: 'row', alignItems: 'baseline', transform: [{ translateY: bounceAnim }] }}>
        <Animated.Text style={[styles.letter, { fontSize: size, color: theme.colors.primary }]}>
          B
        </Animated.Text>
        <Animated.Text style={[styles.dot, { fontSize: size, color: '#e3ff5c' }]}>
          .
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  letter: {
    fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
  },
  dot: {
    fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
  },
});
