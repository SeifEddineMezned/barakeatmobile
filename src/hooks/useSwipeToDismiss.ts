import { useRef } from 'react';
import { Animated, PanResponder, PanResponderInstance } from 'react-native';

interface Options {
  // Drag distance (px) past which release dismisses. Lowered from 90 → 80
  // so a half-hearted flick still closes — feels less binary.
  dismissDy?: number;
  // Vertical fling velocity past which release dismisses. Lowered 0.9 → 0.6
  // so a confident finger-flick closes even with little distance covered.
  dismissVy?: number;
  // Movement (px) required before the move handlers claim the gesture.
  // Lower = the sheet starts following the finger almost immediately
  // instead of jumping after an 8-px deadzone.
  startThresholdDy?: number;
  // When true, dismiss is suppressed (e.g. a network call is in flight
  // inside the sheet and dismissing mid-flight would be unsafe). The
  // sheet still tracks the finger and springs back on release.
  disabled?: boolean;
}

interface Result {
  panHandlers: PanResponderInstance['panHandlers'];
  translateY: Animated.Value;
}

// Swipe-down-to-dismiss for bottom-sheet style modals. Designed to be
// mounted on a DEDICATED swipe zone wrapping the drag-handle pill at
// the top of the sheet (NOT on the whole sheet) — that way a child
// ScrollView / MapView inside the sheet keeps its own scrolling and
// the swipe-down only fires from the grab area the user is targeting.
//
// Gesture model (the "dynamic" part):
//   - Sheet follows the finger 1:1 while dragging DOWN.
//   - Rubber-bands at 1/3 ratio when dragging UP (no upward dismissal,
//     but a tiny bit of give so the gesture feels alive, not blocked).
//   - On release we project the gesture forward by ~60 ms of velocity;
//     `projected_dy = dy + vy*60`. If that crosses `dismissDy` OR
//     the raw vy crosses `dismissVy`, the sheet animates out. Else it
//     springs back to 0.
//   - Close duration scales with fling speed so a fast flick closes
//     fast and a slow drag closes slowly. Feels analog, not stepped.
export function useSwipeToDismiss(onDismiss: () => void, opts: Options = {}): Result {
  const {
    dismissDy = 80,
    dismissVy = 0.6,
    startThresholdDy = 4,
    disabled = false,
  } = opts;

  const translateY = useRef(new Animated.Value(0)).current;
  // Mutable refs let the PanResponder (created once) see the latest
  // `onDismiss` and `disabled` without rebuilding mid-gesture (which
  // would break the active drag).
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const panResponder = useRef(
    PanResponder.create({
      // Claim every touch on the swipe zone IMMEDIATELY — both as start
      // responder and capture-phase responder so we always win against
      // any child View that might also want the touch (won't happen in
      // practice on a handle area, but the capture flag is cheap
      // insurance). Without this, a quick swipe-then-release didn't
      // register the start and the sheet sat still.
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      // Also claim mid-gesture moves that drift in from outside the
      // handle area (e.g. user starts on the body and drags up through
      // the handle) — same capture-phase claim so a nested ScrollView
      // doesn't steal the gesture once the user is committed.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > startThresholdDy && Math.abs(g.dy) > Math.abs(g.dx),
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dy) > startThresholdDy && Math.abs(g.dy) > Math.abs(g.dx),
      // Once we're the responder, hold on to it. Without this, an
      // unrelated child's terminate request can yank the gesture
      // mid-drag and the sheet snaps back unexpectedly.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dy >= 0) {
          translateY.setValue(g.dy);
        } else {
          // Rubber-band when the user drags UP — gives 1/3 the actual
          // distance so the sheet feels resilient instead of frozen at 0.
          translateY.setValue(g.dy / 3);
        }
      },
      onPanResponderRelease: (_, g) => {
        // Project forward: a release WITH downward momentum should close
        // even if dy hasn't yet hit `dismissDy`. The 60 ms projection
        // matches roughly one ProMotion frame at typical fling speeds.
        const projection = g.dy + g.vy * 60;
        const shouldDismiss =
          !disabledRef.current && (projection > dismissDy || g.vy > dismissVy);
        if (shouldDismiss) {
          // Scale duration with fling velocity. Fast flick → ~120 ms;
          // slow drag-past-threshold → ~280 ms. Snaps without feeling
          // either rushed or sluggish.
          const duration = Math.max(120, Math.min(280, 220 - g.vy * 50));
          Animated.timing(translateY, {
            toValue: 800,
            duration,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) onDismissRef.current();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 10,
            tension: 80,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        // If the gesture gets ripped from us (e.g. modal closed
        // externally), reset translateY so a subsequent open doesn't
        // start at a non-zero offset.
        translateY.setValue(0);
      },
    })
  ).current;

  return { panHandlers: panResponder.panHandlers, translateY };
}
