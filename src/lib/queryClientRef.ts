// Module-level singleton reference to the app's QueryClient so non-React
// callers (the api.ts response interceptor, in particular) can invalidate
// queries without going through a hook. The app's root layout registers the
// instance on mount via setGlobalQueryClient(qc); any earlier call to
// getGlobalQueryClient() returns null and the caller should no-op.
//
// We DON'T just `new QueryClient()` here and re-export it because that would
// create a different instance from the one provided to the React tree — a
// React component using useQueryClient() would see one client and the
// interceptor another, and invalidations from outside React would not
// trigger re-renders.
import type { QueryClient } from '@tanstack/react-query';

let _ref: QueryClient | null = null;

export function setGlobalQueryClient(qc: QueryClient): void {
  _ref = qc;
}

export function getGlobalQueryClient(): QueryClient | null {
  return _ref;
}
