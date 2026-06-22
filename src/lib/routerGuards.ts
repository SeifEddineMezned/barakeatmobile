import { router } from 'expo-router';

/**
 * One-time global guard around the expo-router singleton.
 *
 * Two problems we're solving:
 *
 *   1. Rapid double-taps. Every Pressable / TouchableOpacity in the app fires
 *      its onPress once per tap. If the user taps twice in quick succession,
 *      navigation handlers like `() => router.push('/wallet')` run twice and
 *      the destination screen ends up on the stack TWICE — going back from it
 *      then peels off two identical entries one at a time, which reads as a
 *      stuck "back doesn't work" UX. The same problem affects router.replace
 *      / router.navigate.
 *
 *   2. router.back() at the root of the stack. React Navigation logs
 *      "The action 'GO_BACK' was not handled by any navigator." whenever
 *      router.back() is dispatched with nothing on the back stack — a
 *      common case when a sub-screen's back button is tapped while the
 *      user is somehow already at the root (e.g. deep-linked, demo
 *      handoff). The action is a no-op functionally but the ERROR log
 *      worries users.
 *
 * Both are fixed by monkey-patching the router methods exactly once at
 * module load. The expo-router singleton is the same object useRouter()
 * returns, so this patch applies app-wide with zero call-site changes.
 *
 * The dedup window (450 ms) is short enough that an intentional second
 * tap after a brief pause still navigates, but long enough to swallow a
 * genuine double-tap.
 */
export function installRouterGuards(): void {
  const r = router as any;
  if (r.__barakeatGuardsInstalled) return;
  r.__barakeatGuardsInstalled = true;

  const DEDUP_MS = 450;
  let lastCallAt = 0;
  let lastKey: string | null = null;

  const keyOf = (href: unknown): string => {
    if (typeof href === 'string') return href;
    try { return JSON.stringify(href); } catch { return String(href); }
  };

  const isDuplicate = (href: unknown): boolean => {
    const now = Date.now();
    const key = keyOf(href);
    if (key === lastKey && now - lastCallAt < DEDUP_MS) return true;
    lastCallAt = now;
    lastKey = key;
    return false;
  };

  const wrap = (name: 'push' | 'replace' | 'navigate') => {
    const orig = r[name];
    if (typeof orig !== 'function') return;
    const bound = orig.bind(r);
    r[name] = (href: unknown, ...rest: unknown[]) => {
      if (isDuplicate(href)) return undefined;
      return bound(href, ...rest);
    };
  };

  wrap('push');
  wrap('replace');
  wrap('navigate');

  // router.back() — swallow silently when there's nothing to go back to.
  // canGoBack might not exist on older expo-router versions; fall back to
  // calling back() raw when we can't check (preserves prior behaviour).
  const origBack = typeof r.back === 'function' ? r.back.bind(r) : null;
  if (origBack) {
    r.back = () => {
      const canGoBack = typeof r.canGoBack === 'function' ? r.canGoBack : null;
      if (canGoBack && !canGoBack.call(r)) return undefined;
      // Also dedup back() so a double-tap on a back button doesn't pop
      // two screens off the stack in one user gesture.
      if (isDuplicate('__back__')) return undefined;
      return origBack();
    };
  }
}
