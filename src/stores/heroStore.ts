import { create } from 'zustand';

export const useHeroStore = create<{
  heroVisible: boolean;
  setHeroVisible: (visible: boolean) => void;
  // One-shot signal set after a flow that re-enters the search feed at the top
  // (e.g. placing/cancelling an order). The home screen consumes it on focus
  // and snaps the shared scroll value back to 0 — otherwise the native list is
  // back at the top while `sharedScrollY` is stale-high, painting the hero all
  // white until the user scrolls. Set only on those flows, so it never fires on
  // ordinary tab switches.
  scrollResetPending: boolean;
  requestScrollReset: () => void;
  consumeScrollReset: () => boolean;
}>((set, get) => ({
  heroVisible: true,
  setHeroVisible: (visible) => set({ heroVisible: visible }),
  scrollResetPending: false,
  requestScrollReset: () => set({ scrollResetPending: true }),
  consumeScrollReset: () => {
    if (!get().scrollResetPending) return false;
    set({ scrollResetPending: false });
    return true;
  },
}));
