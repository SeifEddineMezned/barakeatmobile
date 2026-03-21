import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';

const BRAND_TEXT = 'Barakeat';
const LETTER_DELAY = 80;
const HOLD_DURATION = 500;

interface SplashAnimationProps {
  onFinish: () => void;
}

export function SplashAnimation({ onFinish }: SplashAnimationProps) {
  const letterAnims = useRef(
    BRAND_TEXT.split('').map(() => ({
      opacity: new Animated.Value(0),
      translateY: new Animated.Value(20),
    }))
  ).current;

  const dotOpacity = useRef(new Animated.Value(0)).current;
  const dotScale = useRef(new Animated.Value(0.5)).current;
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
          duration: 250,
          delay: i * LETTER_DELAY,
          useNativeDriver: true,
        }),
      ])
    );

    // Dot animation (appears after all letters)
    const dotAnimation = Animated.parallel([
      Animated.timing(dotOpacity, {
        toValue: 1,
        duration: 200,
        delay: BRAND_TEXT.length * LETTER_DELAY,
        useNativeDriver: true,
      }),
      Animated.spring(dotScale, {
        toValue: 1,
        delay: BRAND_TEXT.length * LETTER_DELAY,
        useNativeDriver: true,
      }),
    ]);

    // Fade out
    const fadeOut = Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 400,
      delay: BRAND_TEXT.length * LETTER_DELAY + HOLD_DURATION,
      useNativeDriver: true,
    });

    Animated.parallel([...letterAnimations, dotAnimation, fadeOut]).start(() => {
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
              transform: [{ scale: dotScale }],
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
    color: '#fff',
    fontFamily: 'Poppins_700Bold',
  },
  dot: {
    fontSize: 44,
    fontWeight: '700',
    color: '#e3ff5c',
    fontFamily: 'Poppins_700Bold',
  },
});
