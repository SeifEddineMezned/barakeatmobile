/**
 * useOverlayOriginOffset
 *
 * Returns a ref + the {x, y} offset of where that ref currently sits in
 * absolute window coordinates. Used by the walkthrough overlays so they can
 * translate `measureInWindow`-published rects (which are in window space)
 * into the overlay's own local coordinate space — no matter what parent
 * wraps the overlay (root Stack, SafeAreaView, Expo Router Stack…).
 *
 * Previously we tried to guess this offset by adding `StatusBar.currentHeight`
 * on Android, but the relationship between `measureInWindow` and a sibling
 * overlay's `top: 0` differs by device (Samsung edge-to-edge vs Pixel 6
 * edge-to-edge vs iOS). Self-measuring eliminates the guess.
 *
 * Usage:
 *   const { originRef, originX, originY } = useOverlayOriginOffset();
 *   ...
 *   <View ref={originRef} collapsable={false} style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
 *   <View style={{ position: 'absolute', top: rect.y - originY, left: rect.x - originX, width: rect.w, height: rect.h }} />
 *
 * The 1×1 ref view MUST be marked `collapsable={false}` on Android so RN
 * doesn't optimise it away, and it should sit at the same parent as the
 * halos it's calibrating (so its measured position == the overlay origin
 * that absolutely-positioned siblings render against).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

export interface OriginOffset {
  originRef: React.RefObject<View | null>;
  originX: number;
  originY: number;
  // True once measureInWindow has returned a real value at least once. Overlays
  // gate their halo paint on this so the FIRST step (when the overlay just went
  // null→rendered and the offset is still the {0,0} default) never paints a halo
  // at the stale origin and then snaps to the correct one.
  originMeasured: boolean;
  remeasure: () => void;
}

export function useOverlayOriginOffset(): OriginOffset {
  const originRef = useRef<View | null>(null);
  const [{ x, y, measured }, setOrigin] = useState({ x: 0, y: 0, measured: false });

  const remeasure = useCallback(() => {
    // requestAnimationFrame so we measure after the next layout pass — if we
    // measure synchronously on mount, Android occasionally returns (0, 0)
    // before the view has been positioned by Yoga.
    requestAnimationFrame(() => {
      originRef.current?.measureInWindow((mx, my) => {
        // Bail on (NaN, NaN) which happens on Android when the ref view is
        // momentarily not attached (e.g., during a screen pop animation).
        if (typeof mx === 'number' && typeof my === 'number' && !Number.isNaN(mx) && !Number.isNaN(my)) {
          setOrigin((prev) => (prev.x === mx && prev.y === my && prev.measured ? prev : { x: mx, y: my, measured: true }));
        }
      });
    });
  }, []);

  // Re-measure once on mount. Callers can also call `remeasure` from
  // `onLayout` if their host screen can shift after first render.
  useEffect(() => {
    remeasure();
  }, [remeasure]);

  return { originRef, originX: x, originY: y, originMeasured: measured, remeasure };
}
