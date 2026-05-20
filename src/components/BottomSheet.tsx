import React, { useEffect, useRef } from 'react';
import { View, Modal, Animated, TouchableWithoutFeedback, PanResponder, ViewStyle, StyleSheet } from 'react-native';
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
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 14, tension: 90 }),
        Animated.timing(backdrop, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 400, duration: 180, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, translateY, backdrop]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 0.9) {
          onClose();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 12, tension: 100 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
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
          {...panResponder.panHandlers}
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
              paddingTop: hideHandle ? 20 : 8,
              maxHeight: `${Math.round(maxHeightFraction * 100)}%` as any,
              transform: [{ translateY }],
              ...theme.shadows.shadowLg,
            },
            contentStyle,
          ]}
        >
          {!hideHandle && (
            <View style={{ alignItems: 'center', paddingBottom: 8 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.divider }} />
            </View>
          )}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
