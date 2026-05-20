/**
 * DemoTapHintToast
 *
 * Subscribes to the walkthrough store's `tapHintTick` counter — every time a
 * blocked tap is absorbed by one of the demo dim overlays, the counter
 * increments and this toast flashes for ~2 seconds with a hint to follow
 * the walkthrough instructions.
 *
 * Rendered inside every overlay that may absorb taps (layout overlay,
 * sub-screen overlay, my-baskets in-modal dim, verify-modal overlay) so the
 * toast is visible whichever dim layer the user happened to tap through.
 */
import React from 'react';
import { Animated, Text, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';

interface Props {
  /** Anchor edge override. When undefined, the toast auto-anchors to the
   *  side OPPOSITE the current step's highlight so it never covers the
   *  haloed element. */
  anchor?: 'top' | 'bottom';
  /** Distance from the safe-area edge in pixels. Default 12. */
  offset?: number;
}

export function DemoTapHintToast({ anchor, offset = 12 }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tapHintTick = useWalkthroughStore((s) => s.tapHintTick);
  const currentStep = useWalkthroughStore((s) => s.currentStep);
  const measuredRects = useWalkthroughStore((s) => s.measuredRects);
  // Auto-anchor: if the active highlight sits in the top half of the
  // screen, drop the toast at the BOTTOM (and vice versa). Falls back to
  // 'top' when there's no rect to read (e.g. inline-modal steps).
  const effectiveAnchor: 'top' | 'bottom' = anchor ?? (() => {
    if (!currentStep) return 'top';
    const rect = measuredRects[currentStep.measureKey];
    if (!rect) return 'top';
    const SH = Dimensions.get('window').height;
    return (rect.y + rect.h / 2) < SH / 2 ? 'bottom' : 'top';
  })();
  const opacity = React.useRef(new Animated.Value(0)).current;
  const slideStart = effectiveAnchor === 'top' ? -12 : 12;
  const translateY = React.useRef(new Animated.Value(slideStart)).current;
  const [visible, setVisible] = React.useState(false);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (tapHintTick === 0) return; // ignore the initial value
    setVisible(true);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 8, tension: 120, useNativeDriver: true }),
    ]).start();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: slideStart, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setVisible(false);
      });
    }, 2200);
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [tapHintTick]);

  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        ...(effectiveAnchor === 'top'
          ? { top: insets.top + offset }
          : { bottom: insets.bottom + offset }),
        backgroundColor: '#114b3c',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 999999,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 14,
        opacity,
        transform: [{ translateY }],
      }}
    >
      <Text style={{ color: '#e3ff5c', fontSize: 13, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginRight: 8 }}>!</Text>
      <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Poppins_500Medium', flex: 1, lineHeight: 18 }}>
        {t('walkthrough.followInstructions', { defaultValue: 'Suivez les instructions de la démo pour continuer.' })}
      </Text>
    </Animated.View>
  );
}
