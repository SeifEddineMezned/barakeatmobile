import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Returns the supplied poll interval (ms) while the current screen is the
// focused one in the navigator stack, and `false` while it isn't. Spread
// the result straight into a React Query `refetchInterval`:
//
//   const refetchInterval = usePollWhenFocused(20_000);
//   useQuery({ queryKey: [...], refetchInterval, ... });
//
// When the user navigates to another tab / screen, `refetchInterval`
// flips to `false` and React Query stops the timer — no more background
// requests piling onto the rate-limit budget. The query auto-resumes
// when the screen is focused again.
export function usePollWhenFocused(ms: number): number | false {
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, [])
  );
  return isFocused ? ms : false;
}

// Variant for ALWAYS-MOUNTED layout-level queries (e.g. badge counters
// in (business)/_layout.tsx or dashboard.tsx) that should keep polling
// across screen navigations but pause when the app is backgrounded.
// `useFocusEffect` can't be used there because it would un-focus every
// time the user navigates between siblings; AppState is the right
// signal — it flips to 'background' / 'inactive' when the user goes to
// home screen or switches apps, and back to 'active' when they return.
//
// Net effect: a foregrounded session polls every `ms`; a backgrounded
// session stops polling entirely. Removes the "30 s wake hits to
// /conversations from a backgrounded app" load that was contributing
// to Railway-side slowness and bouncing legitimate writes against the
// 30 s axios timeout.
export function usePollWhenForegrounded(ms: number): number | false {
  const [isActive, setIsActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setIsActive(state === 'active');
    });
    return () => sub.remove();
  }, []);
  return isActive ? ms : false;
}
