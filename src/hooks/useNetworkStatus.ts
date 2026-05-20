import { useEffect, useRef, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

// NetInfo emits transient null/false values during launch and on flaky
// networks (captive portals, slow reachability probes). The previous version
// of this hook returned `state.isConnected` verbatim, which made the offline
// banner flash on every cold start and stick around falsely when the
// reachability test failed even though the device had real connectivity.
//
// New behaviour:
//  - Prefer `isInternetReachable` when known; fall back to `isConnected`.
//  - Treat `null` / `undefined` as connected ("we don't know yet" must not
//    paint a red banner).
//  - Only flip the returned value to `false` after the offline signal has
//    persisted for OFFLINE_DEBOUNCE_MS. A brief blip never reaches the UI.
//  - Recovery is immediate (no debounce on coming back online).
const OFFLINE_DEBOUNCE_MS = 2000;

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearPendingFlip = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const raw = state.isInternetReachable ?? state.isConnected;
      const treatedAsConnected = raw !== false;

      if (treatedAsConnected) {
        clearPendingFlip();
        setIsConnected(true);
        return;
      }

      // raw === false: schedule a flip to offline iff one isn't already pending.
      if (debounceTimerRef.current) return;
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        setIsConnected(false);
      }, OFFLINE_DEBOUNCE_MS);
    });

    return () => {
      clearPendingFlip();
      unsubscribe();
    };
  }, []);

  return isConnected;
}
