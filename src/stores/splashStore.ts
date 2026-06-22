import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WELCOME_DISMISSED_KEY = 'barakeat_welcome_dismissed';

export const useSplashStore = create<{
  showSplash: boolean;
  wasLoginSplash: boolean;
  splashDone: boolean;
  // True once the CURRENT splash's halo animation has finished. Lives in the
  // store (not React local state) so `triggerSplash` can reset it to false
  // SYNCHRONOUSLY: on login, signIn() flips isAuthenticated and triggerSplash()
  // resets animDone in the same handler, so the root layout's routing guard —
  // which reads animDone here — sees "animation not done yet" on its very first
  // post-login run and defers navigation UNDER the splash. With local state the
  // reset landed a render too late and the guard navigated into the app first,
  // mounting the heavy tabs tree concurrently (the "app shows then the splash
  // fires / the halo freezes" bug).
  animDone: boolean;
  // A one-shot callback run when the CURRENT splash's halo animation finishes,
  // BEFORE animDone flips. Login uses this to defer the heavy auth-state flip
  // (signIn → isAuthenticated → root re-render cascade + downstream queries)
  // out of the animation window, so the JS-thread-driven rAF loop animates on a
  // free thread. Running it alongside the animation was starving the rAF and
  // freezing the halo mid-cycle (white "B" shine stuck on, then a late jump
  // straight to the tilt) — and only on login, because cold launch has no
  // sign-in screen competing for the thread.
  pendingAnimFinish: (() => void | Promise<void>) | null;
  setPendingAnimFinish: (cb: (() => void | Promise<void>) | null) => void;
  triggerSplash: (isLogin?: boolean) => void;
  dismissSplash: () => void;
  markSplashDone: () => void;
  markAnimDone: () => void;
  resetWelcomeDismissed: () => Promise<void>;
}>((set) => ({
  showSplash: false,
  wasLoginSplash: false,
  splashDone: false,
  animDone: false,
  pendingAnimFinish: null,
  setPendingAnimFinish: (cb) => set({ pendingAnimFinish: cb }),
  triggerSplash: (isLogin = true) => {
    if (isLogin) {
      void AsyncStorage.removeItem(WELCOME_DISMISSED_KEY);
    }
    // Clear any stale pending callback when a fresh splash starts.
    set({ showSplash: true, wasLoginSplash: isLogin, splashDone: false, animDone: false, pendingAnimFinish: null });
  },
  dismissSplash: () => set({ showSplash: false }),
  markSplashDone: () => set({ splashDone: true }),
  markAnimDone: () => set({ animDone: true }),
  resetWelcomeDismissed: async () => {
    await AsyncStorage.removeItem(WELCOME_DISMISSED_KEY);
  },
}));
