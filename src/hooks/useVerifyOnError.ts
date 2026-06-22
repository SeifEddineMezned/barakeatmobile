import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * "Verify before alarming" — the mutation-onError UX kill-switch for
 * the "save → timeout popup → but the change actually persisted"
 * pattern that hit basket save, location edit, team mgmt, and
 * business-profile mutations.
 *
 * Background: Railway's small Postgres instance occasionally takes
 * 30 s+ to respond to a write (server-side load, cellular round-trip
 * jitter, response packet dropped) while the underlying transaction
 * has ALREADY committed. The mobile-side axios hits its 30 s timeout
 * and surfaces "Network Error" — but a refetch of the resource shows
 * the change is live. From the user's perspective the popup is a
 * lie.
 *
 * This helper closes the gap. The mutation's onError calls
 * `verifyOrAlarm` with:
 *   - the error,
 *   - the queryKey of the resource that was just edited
 *     (e.g. ['my-baskets'] or ['org-details', orgId]),
 *   - a `verify(fresh)` predicate that returns true when the
 *     refetched data confirms the change reached the server,
 *   - `onConfirmed()` to fire the normal onSuccess UX,
 *   - `onUnconfirmed(err)` to fire the soft "refresh and retry"
 *     popup.
 *
 * Only TIMEOUT-SHAPED errors trigger the verify path:
 *   - no `err.status` / `err.response.status` at all (network died), OR
 *   - `502` / `503` / `504` (gateway / unavailable / timeout)
 * Real 4xx / non-gateway 5xx (e.g. 400 validation, 409 conflict)
 * bypass the check and go straight to onUnconfirmed because they're
 * deterministic — the server saw the request and explicitly rejected
 * it.
 */
export function isTransientError(err: any): boolean {
  if (!err) return false;
  const status = Number(err?.status ?? err?.response?.status ?? 0);
  if (!status) return true;
  return status === 502 || status === 503 || status === 504;
}

export interface VerifyOrAlarmArgs<TData = unknown> {
  error: unknown;
  queryClient: QueryClient;
  verifyKey: QueryKey;
  verify: (fresh: TData | undefined) => boolean;
  onConfirmed: () => void;
  onUnconfirmed: (err: unknown) => void;
}

export async function verifyOrAlarm<TData = unknown>({
  error,
  queryClient,
  verifyKey,
  verify,
  onConfirmed,
  onUnconfirmed,
}: VerifyOrAlarmArgs<TData>): Promise<void> {
  if (!isTransientError(error)) {
    onUnconfirmed(error);
    return;
  }
  try {
    // Force-refetch the resource: invalidate then read. Using
    // refetchQueries with `type: 'active'` so we only refetch if a
    // mounted observer exists; otherwise just invalidate so the next
    // mount fetches fresh. If no observer exists, we still need fresh
    // data — fall back to a one-shot invalidate that the next consumer
    // picks up.
    await queryClient.refetchQueries({ queryKey: verifyKey, type: 'active' });
    const fresh = queryClient.getQueryData<TData>(verifyKey);
    if (verify(fresh)) {
      onConfirmed();
      return;
    }
  } catch {
    // Refetch itself failed → treat as the original error.
  }
  onUnconfirmed(error);
}

// ─── Preset verify modes for the three most common mutation shapes ────────

// For CREATE mutations: "an entity with these properties was added to a
// list". Pre-mutation snapshot the list ids; post-error, check whether a
// new entity matching `match(entity)` is present that wasn't in the
// snapshot. Use when the new entity carries some uniquely-identifying
// payload (e.g. a customer name, a basket name).
export function createVerifyAppeared<TItem = any>(
  selectList: (cache: any) => TItem[] | undefined,
  preSnapshotIds: Set<string | number>,
  match: (item: TItem) => boolean,
): (fresh: any) => boolean {
  return (fresh) => {
    const list = selectList(fresh);
    if (!Array.isArray(list)) return false;
    return list.some((item: any) => {
      const id = item?.id ?? item?._id;
      const isNew = id != null && !preSnapshotIds.has(id);
      return isNew && match(item);
    });
  };
}

// For DELETE mutations: "the entity with id X is no longer in the
// list". Use when the mutation removes a known id.
export function createVerifyDisappeared<TItem = any>(
  selectList: (cache: any) => TItem[] | undefined,
  targetId: string | number,
): (fresh: any) => boolean {
  return (fresh) => {
    const list = selectList(fresh);
    if (!Array.isArray(list)) return true; // list itself gone → treat as success
    return !list.some((item: any) => String(item?.id) === String(targetId));
  };
}

// For UPDATE mutations: "the entity with id X now has these field
// values". Use when the mutation patches an existing entity. Skips
// undefined / null / object expected values so a partial-update
// payload doesn't false-fail on fields the user didn't touch.
export function createVerifyFields<TItem = any>(
  selectEntity: (cache: any) => TItem | undefined,
  expected: Record<string, any>,
): (fresh: any) => boolean {
  return (fresh) => {
    const entity = selectEntity(fresh);
    if (!entity) return false;
    for (const [k, v] of Object.entries(expected)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'object') continue;
      if (String((entity as any)[k] ?? '') !== String(v)) return false;
    }
    return true;
  };
}
