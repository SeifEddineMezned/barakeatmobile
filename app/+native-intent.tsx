export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  // The pre-login welcome screen has been removed; system-launched paths
  // that don't match a registered route now land on the sign-in screen,
  // which itself routes the user onward based on auth state.
  return '/auth/sign-in';
}