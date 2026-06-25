import { useEffect } from 'react';
import { AppState, InteractionManager, Keyboard, Platform } from 'react-native';
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
    // expo-navigation-bar exposes setVisibilityAsync (there is no setHidden in
    // the 5.x line either). setBehaviorAsync('overlay-swipe') is intentionally
    // NOT called. With app.json's `edgeToEdgeEnabled: true`, edge-to-edge
    // already overlays the nav bar transparently and Android's NavigationBar
    // API throws `setBehaviorAsync is not supported with edge-to-edge enabled`
    // every single time the hook fires. The behavior we wanted from
    // 'overlay-swipe' — bar overlays content, auto-hides on swipe-down — is the
    // default in edge-to-edge mode, and crucially it does NOT change window
    // insets, so a transient reveal never reflows app content.
    await NavigationBar.setVisibilityAsync('hidden');
  } catch (e) {
    console.warn('[useImmersiveNavBar] Failed to hide Android navigation bar:', e);
  }
}

// A re-hide that is SAFE to run around a screen transition or right after the
// user has summoned the (hidden) bar to press the system Back button.
//
// On Samsung 3-button navigation the Back button physically lives on the hidden
// nav bar, so pressing it first makes Android animate the bar in. The previous
// implementation then called setVisibilityAsync('hidden') SYNCHRONOUSLY on the
// resulting `pathname` change — landing in the middle of that reveal animation
// AND the back-pop screen transition. Two animations fighting the same window
// insets controller is what produced the Samsung "flicker / flip-out" (and on a
// root screen the same press simply exits the app, which is normal Android).
//
// This version:
//   1. waits for in-flight interactions/animations to settle (so it never
//      collides with the back-pop transition), then
//   2. only issues the hide if the bar is ACTUALLY still visible — Android's
//      own transient auto-hide has usually already hidden it by then, so this
//      becomes a no-op and nothing animates at all.
// Net effect: the bar stays hidden exactly as before, but the re-hide can no
// longer stutter on top of the back gesture.
async function reassertHiddenWhenIdle(): Promise<() => void> {
  if (Platform.OS !== 'android') return () => {};
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const task = InteractionManager.runAfterInteractions(() => {
    // Small extra delay past the interaction barrier so the bar's own
    // reveal→auto-hide animation can win the race and make us a no-op.
    timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        const visibility = await NavigationBar.getVisibilityAsync();
        if (!cancelled && visibility === 'visible') {
          await NavigationBar.setVisibilityAsync('hidden');
        }
      } catch (e) {
        console.warn('[useImmersiveNavBar] deferred re-hide failed:', e);
      }
    }, 350);
  });

  return () => {
    cancelled = true;
    task.cancel?.();
    if (timer) clearTimeout(timer);
  };
}

export function useImmersiveNavBar(): void {
  const pathname = usePathname();

  // Fires on mount (initial pathname) and again on every screen navigation.
  // The navigation re-assert is cheap insurance: it re-hides the bar after the
  // user returns from a native picker/camera/dialog that forced it back. It is
  // DEFERRED + conditional (see reassertHiddenWhenIdle) so it never collides
  // with the back-pop transition — that collision was the Samsung flicker.
  // No-op on iOS. The cleanup cancels a still-pending deferred hide if the user
  // navigates again before it fires.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let disposed = false;
    void reassertHiddenWhenIdle().then((d) => {
      if (disposed) d();
      else dispose = d;
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [pathname]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // Returning from background re-shows the bar on most devices. This fires
    // OUTSIDE any screen transition, so an immediate hide is safe (nothing to
    // collide with) and covers the camera/image-picker return path too.
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
