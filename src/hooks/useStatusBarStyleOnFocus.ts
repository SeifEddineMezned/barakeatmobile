import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';

/**
 * Reassert the status bar icon colour every time the screen gains focus.
 *
 * Why this exists: the declarative `<StatusBar style="..."/>` component only
 * calls `setStatusBarStyle` inside a `useEffect` keyed on the style prop, which
 * runs ONCE on mount and only re-runs when the prop actually changes. Tab
 * screens in expo-router (React Navigation) are mounted on first visit and
 * STAY mounted thereafter for state preservation — so switching from a tab
 * with `style="dark"` to a tab with `style="light"` and back does NOT re-fire
 * the original tab's setStatusBarStyle call. The bar keeps whichever value
 * the most-recently-mounted-or-prop-changed `<StatusBar>` last set, which is
 * often the wrong colour for the now-focused tab (white icons on a white bg
 * was the symptom on customer Orders / Favorites / Profile and partner
 * Orders / Baskets / Profile).
 *
 * `useFocusEffect` fires the callback on every focus event AND re-runs it
 * whenever the callback's identity changes (i.e. when the `style` argument
 * changes), so it also covers screens whose status-bar choice depends on
 * scroll position or other internal state — pass the derived value here and
 * the bar updates the moment that state flips, no separate `<StatusBar>`
 * component needed.
 *
 * Drop this into every tab screen at the top of the component body:
 *
 *   useStatusBarStyleOnFocus('dark');   // static white-bg page
 *   useStatusBarStyleOnFocus(heroVisible ? 'light' : 'dark'); // dynamic
 */
export function useStatusBarStyleOnFocus(style: 'light' | 'dark'): void {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(style, true);
    }, [style]),
  );
}
