// Auth-boundary navigation helper.
//
// expo-router's `router.replace()` only swaps the TOP route of the stack; every
// screen beneath it stays in history. Across a logout→login cycle that means
// the PREVIOUS session's screens ((tabs)/(business) home + anything pushed)
// linger underneath the new session. Pressing the Android/Samsung system Back
// button then pops into one of those stale screens — but the session token and
// the react-query cache were cleared on logout, so it mounts blank and the app
// freezes until a full restart. (Reported as: "after login→logout→login, Back
// goes blank until I refresh the app.")
//
// resetStackTo() replaces the destination AND clears the back stack so the
// target becomes the sole history entry. Use it at every auth boundary
// (login→home, logout→sign-in): after either transition, Back should exit the
// app or do nothing — never reach the other session.

type RouterLike = {
  canDismiss?: () => boolean;
  dismissAll?: () => void;
  replace: (href: never) => void;
};

export function resetStackTo(router: RouterLike, href: string): void {
  try {
    // dismissAll() pops the root Stack back to its first screen; the following
    // replace() then swaps that lone screen for the destination → a one-entry
    // stack with no stale history. Guarded by canDismiss() so it's a safe
    // no-op on a cold-start stack that has nothing to pop.
    if (router.canDismiss?.()) router.dismissAll?.();
  } catch {
    // Navigator not ready / nothing to dismiss — the replace below still lands.
  }
  router.replace(href as never);
}
