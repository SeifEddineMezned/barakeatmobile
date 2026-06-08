import { useCallback, useState } from 'react';
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
