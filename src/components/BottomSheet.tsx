import React, { useEffect, useRef } from 'react';
import { View, Modal, Animated, TouchableWithoutFeedback, PanResponder, ViewStyle, StyleSheet, Platform } from 'react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional maximum height as a proportion (0..1) of the screen. Default 0.9. */
  maxHeightFraction?: number;
  /** Hides the drag handle. Default false (handle visible). */
  hideHandle?: boolean;
  contentStyle?: ViewStyle;
}

// Slide-up sheet. Replaces the centered-modal-with-circle-icon pattern that
// screams "AI-generated alert". A drag-down gesture dismisses, tap-outside
// dismisses, and the body sits on safe-area insets so it clears the home bar.
//
// Prefer this for contextual confirmations (cash warning, cancel order).
// Keep centered modals only for true irreversible alerts (delete account).
export function BottomSheet({
  visible,
  onClose,
  children,
  maxHeightFraction = 0.9,
  hideHandle = false,
  contentStyle,
}: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(400)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Deterministic timing (not an underdamped spring). The old spring
      // overshot and oscillated for ~0.5s; with useNativeDriver the button's
      // touch target sits at the settled position while the view is still
      // visually moving, so a quick tap on the confirm button during that
      // window missed and the user had to tap twice. A short, non-overshooting
      // slide settles the hit area almost immediately.
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 400, duration: 180, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, translateY, backdrop]);

  // Velocity-projected, follow-finger gesture. Mirrors src/hooks/
  // useSwipeToDismiss so every sheet in the app feels identical: the
  // body follows the finger 1:1 going down, rubber-bands 1/3 going up,
  // and on release we project the gesture forward by ~60 ms of
  // velocity so a confident flick closes even at small distance.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dy >= 0) translateY.setValue(g.dy);
        else translateY.setValue(g.dy / 3);
      },
      onPanResponderRelease: (_, g) => {
        const projection = g.dy + g.vy * 60;
        if (projection > 80 || g.vy > 0.6) {
          const duration = Math.max(120, Math.min(280, 220 - g.vy * 50));
          Animated.timing(translateY, { toValue: 800, duration, useNativeDriver: true }).start(({ finished }) => {
            if (finished) onCloseRef.current();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 10, tension: 80 }).start();
        }
      },
      onPanResponderTerminate: () => translateY.setValue(0),
    })
  ).current;

  // Only Android devices with on-screen virtual nav buttons need the modal
  // to extend behind the system nav bar — gesture-nav Android and iOS look
  // correct with the default Modal layering. `insets.bottom > 16` cleanly
  // distinguishes a real nav-bar inset from a small home-indicator one.
  const extendsUnderNavBar = Platform.OS === 'android' && insets.bottom > 16;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      // Android-only. statusBarTranslucent is safe everywhere on Android;
      // navigationBarTranslucent is gated to virtual-nav devices so we don't
      // change the layering on gesture-nav phones where the current behaviour
      // is already correct.
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={extendsUnderNavBar}
    >
      <View style={StyleSheet.absoluteFill}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View
            style={{
              ...StyleSheet.absoluteFillObject,
              backgroundColor: 'rgba(0,0,0,0.4)',
              opacity: backdrop,
            }}
          />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: insets.bottom + 16,
              paddingTop: hideHandle ? 20 : 0,
              maxHeight: `${Math.round(maxHeightFraction * 100)}%` as any,
              transform: [{ translateY }],
              ...theme.shadows.shadowLg,
            },
            contentStyle,
          ]}
        >
          {!hideHandle && (
            // Swipe zone — the top strip hosts the handle pill AND the
            // PanResponder. Children with their own scroll views keep
            // their gestures intact because the swipe only fires from
            // this top area, not the whole sheet.
            <View
              {...panResponder.panHandlers}
              style={{ paddingTop: 10, paddingBottom: 12, alignItems: 'center' }}
            >
              <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.divider }} />
            </View>
          )}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
