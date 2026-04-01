import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';

const BRAND_TEXT = 'Barakeat';
const LETTER_DELAY = 80;
const HOLD_DURATION = 450;
const HOP_COUNT = BRAND_TEXT.length;
const HOP_DURATION = 110;  // ms per hop — slightly slower for visibility
const HOP_HEIGHT = -50;    // px upward per hop
const DOT_TRAVEL = 248;    // pixels dot travels left→right
const DOT_DELAY = BRAND_TEXT.length * LETTER_DELAY + 60;

// Split hop into up (40%) and down (60%) for natural arc
const HOP_UP = Math.round(HOP_DURATION * 0.40);
const HOP_DOWN = HOP_DURATION - HOP_UP;

interface SplashAnimationProps {
  onFinish: () => void;
}

export function SplashAnimation({ onFinish }: SplashAnimationProps) {
  const letterAnims = useRef(
    BRAND_TEXT.split('').map(() => ({
      opacity: new Animated.Value(0),
      translateY: new Animated.Value(22),
    }))
  ).current;

  const dotOpacity = useRef(new Animated.Value(0)).current;
  const dotX = useRef(new Animated.Value(-DOT_TRAVEL)).current;
  const dotY = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Stagger letter animations
    const letterAnimations = letterAnims.map((anim, i) =>
      Animated.parallel([
        Animated.timing(anim.opacity, {
          toValue: 1,
          duration: 200,
          delay: i * LETTER_DELAY,
          useNativeDriver: true,
        }),
        Animated.timing(anim.translateY, {
          toValue: 0,
          duration: 260,
          delay: i * LETTER_DELAY,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
      ])
    );

    // Dot appears at starting position the instant travel begins
    const dotOpacityAnim = Animated.timing(dotOpacity, {
      toValue: 1,
      duration: 0,
      delay: DOT_DELAY,
      useNativeDriver: true,
    });

    // Number of actual bounces = letters - 1 (dot hops BETWEEN letters, lands on final position)
    const BOUNCE_COUNT = HOP_COUNT - 1;
    const TRAVEL_TIME = BOUNCE_COUNT * HOP_DURATION;

    // Dot travels left → right — duration matches the Y bounces exactly
    const dotXAnim = Animated.timing(dotX, {
      toValue: 0,
      duration: TRAVEL_TIME,
      delay: DOT_DELAY,
      useNativeDriver: true,
      easing: Easing.linear,
    });

    // Dot Y: one bounce per letter gap, then lands flat at final position
    const travelHops = Array.from({ length: BOUNCE_COUNT }, () =>
      Animated.sequence([
        Animated.timing(dotY, {
          toValue: HOP_HEIGHT,
          duration: HOP_UP,
          useNativeDriver: true,
          easing: Easing.out(Easing.quad),
        }),
        Animated.timing(dotY, {
          toValue: 0,
          duration: HOP_DOWN,
          useNativeDriver: true,
          easing: Easing.in(Easing.quad),
        }),
      ])
    );

    const dotYAnim = Animated.sequence([
      Animated.delay(DOT_DELAY),
      ...travelHops,
    ]);

    // Fade-out overlay after dot has fully landed
    const TOTAL_DOT_TIME = TRAVEL_TIME;
    const fadeOut = Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 420,
      delay: DOT_DELAY + TOTAL_DOT_TIME + HOLD_DURATION,
      useNativeDriver: true,
    });

    Animated.parallel([
      ...letterAnimations,
      dotOpacityAnim,
      dotXAnim,
      dotYAnim,
      fadeOut,
    ]).start(() => {
      onFinish();
    });
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: overlayOpacity }]}>
      <View style={styles.textRow}>
        {BRAND_TEXT.split('').map((letter, i) => (
          <Animated.Text
            key={`splash-letter-${i}`}
            style={[
              styles.letter,
              {
                opacity: letterAnims[i].opacity,
                transform: [{ translateY: letterAnims[i].translateY }],
              },
            ]}
          >
            {letter}
          </Animated.Text>
        ))}
        <Animated.Text
          style={[
            styles.dot,
            {
              opacity: dotOpacity,
              transform: [{ translateX: dotX }, { translateY: dotY }],
            },
          ]}
        >
          .
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#114b3c',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  letter: {
    fontSize: 44,
    fontWeight: '700',
    color: '#e3ff5c',
    fontFamily: 'Poppins_700Bold',
  },
  dot: {
    fontSize: 44,
    fontWeight: '700',
    color: '#e3ff5c',
    fontFamily: 'Poppins_700Bold',
  },
});
