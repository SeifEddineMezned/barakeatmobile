import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Returns the bottom padding a pinned UI element (CTA button, action bar)
 * needs to clear the system safe area AND give the user a comfortable tap
 * gap above whatever sits at the screen edge.
 *
 * Platform behaviour:
 * - **iOS with home indicator:** `insets.bottom` is 34 px on most iPhones,
 *   but the actual indicator pill is only ~5 px tall — the inset bakes in
 *   a generous buffer. Adding extra on top of that makes sticky bars look
 *   bloated. We use HALF the inset (≈17 px on iPhone) which still clears
 *   the indicator with margin to spare. Mirrors how Apple's own toolbars
 *   (Mail, Photos) sit relative to the indicator.
 * - **Android with on-screen virtual nav buttons** (Samsung etc.):
 *   `insets.bottom` reports the nav-bar height (24–48 px). Add `extra` so
 *   the button visually floats above the buttons.
 * - **Android with gesture nav:** `insets.bottom` is small or 0; `extra`
 *   alone provides the breathing room (~12 px default).
 *
 * The result is that iPhone and Samsung-gesture-nav phones get a visually
 * similar sticky-bar height, while Samsung-virtual-nav phones get the
 * extra clearance they need.
 */
export function useBottomSafePadding(extra: number = 12): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'ios') {
    // Half the inset, floored at 14 px so iPads / older iPhones with no
    // indicator still get a sensible gap.
    return Math.max(Math.round(insets.bottom / 2), 14);
  }
  return insets.bottom + extra;
}

/** Detect Android devices with on-screen virtual nav buttons (vs gesture nav). */
export function useHasVirtualNavBar(): boolean {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'android' && insets.bottom > 16;
}
