import { useEffect } from 'react';
import { AppState, Keyboard, Platform } from 'react-native';
import { usePathname } from 'expo-router';
import * as NavigationBar from 'expo-navigation-bar';

// Hides the Android on-screen navigation bar (the Samsung/virtual
// back-home-recent buttons) so it never blocks app content. The bar only
// reappears when the user deliberately swipes up from the bottom edge, then
// auto-hides again.
//
// Why a hook that re-applies (and not a one-shot on mount): Android's
// immersive-hidden state is TRANSIENT. The system forces the bar back — and it
// then stays — whenever the app returns from background, the soft keyboard
// opens, or a native surface (image picker, camera, date picker, OS dialog)
// takes over. So we re-assert the hidden state on each of those events.
//
// Navigation-bar visibility is a global window property, so calling this once
// from the always-mounted root layout governs every screen.
export async function applyImmersiveNavBar(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    // expo-navigation-bar@4.0.x exposes setVisibilityAsync (there is no
    // setHidden in this version). When this package is upgraded past 4.x,
    // switch to NavigationBar.setHidden(true), the future-proof method.
    await NavigationBar.setVisibilityAsync('hidden');
    // setBehaviorAsync('overlay-swipe') is intentionally NOT called. With
    // app.json's `edgeToEdgeEnabled: true`, edge-to-edge already overlays
    // the nav bar transparently and Android's NavigationBar API throws
    // `setBehaviorAsync is not supported with edge-to-edge enabled` every
    // single time the hook fires (each route change). The behavior we
    // wanted from 'overlay-swipe' — bar overlays content, auto-hides on
    // swipe-down — is the default in edge-to-edge mode.
  } catch (e) {
    console.warn('[useImmersiveNavBar] Failed to hide Android navigation bar:', e);
  }
}

export function useImmersiveNavBar(): void {
  const pathname = usePathname();

  // Fires on mount (initial pathname) and again on every screen navigation.
  // The navigation re-assert is cheap insurance: it re-hides the bar after the
  // user returns from a native picker/camera/dialog that forced it back.
  // No-op on iOS (applyImmersiveNavBar early-returns).
  useEffect(() => {
    void applyImmersiveNavBar();
  }, [pathname]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // Returning from background re-shows the bar on most devices.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void applyImmersiveNavBar();
    });

    // The soft keyboard forces the bar back; re-hide once it closes. We do NOT
    // re-apply on keyboardDidShow, to avoid fighting the keyboard / flicker.
    const keyboardSub = Keyboard.addListener('keyboardDidHide', () => {
      void applyImmersiveNavBar();
    });

    return () => {
      appStateSub.remove();
      keyboardSub.remove();
    };
  }, []);
}

export default useImmersiveNavBar;
