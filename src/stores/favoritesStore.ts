import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@/src/lib/api';

// Mirror favorites to the backend so the server-side "favorites updates"
// notification engine (PUT /api/auth/favorites + the favorites-notify cron)
// can push new-basket / almost-sold-out / weekly nudges even while the app is
// closed. Debounced + fire-and-forget — a failed sync never blocks the UI, and
// the next toggle (or sign-in hydrate) re-sends the full set anyway.
let _favSyncTimer: ReturnType<typeof setTimeout> | null = null;
// `starred` (saved-basket ids) are merged into `baskets` so the server-side
// low-stock notification — which queries the synced `baskets` set by basket id
// — actually sees them. Previously starred baskets were never synced, so the
// "almost sold out" alert had no data to work from.
function scheduleFavoritesSync(merchants: string[], baskets: string[], starred: string[] = []) {
  const allBaskets = [...new Set([...baskets, ...starred])];
  if (_favSyncTimer) clearTimeout(_favSyncTimer);
  _favSyncTimer = setTimeout(() => {
    void apiClient.put('/api/auth/favorites', { merchants, baskets: allBaskets, starred }).catch(() => {});
  }, 1500);
}

// Per-user storage key. The previous build used a single device-global key
// (`barakeat_favorites`), which leaked one account's favorites into the next
// account that logged in on the same device. We now scope by user id and
// reset the in-memory state when the active user changes.
const keyForUser = (userId: string) => `barakeat_favorites:${userId}`;
// One-shot cleanup target: the old unscoped key. We delete it the first time
// hydrateForUser runs so the leaked data doesn't linger in AsyncStorage.
const LEGACY_UNSCOPED_KEY = 'barakeat_favorites';

interface FavoritesData {
  favoriteBasketIds: string[];
  favoriteMerchantIds: string[];
  starredBasketTypeIds: string[];
}

interface FavoritesState extends FavoritesData {
  currentUserId: string | null;
  toggleBasketFavorite: (basketId: string) => void;
  toggleMerchantFavorite: (merchantId: string) => void;
  toggleStarredBasketType: (basketTypeId: string) => void;
  isBasketFavorite: (basketId: string) => boolean;
  isMerchantFavorite: (merchantId: string) => boolean;
  isBasketTypeStarred: (basketTypeId: string) => boolean;
  // Atomic bulk-replace + persist of all three buckets. Used by the demo-end
  // handler to restore the pre-demo favorites snapshot so anything the user
  // toggled inside the walkthrough doesn't leak into their real account.
  replaceAll: (data: FavoritesData) => void;
  // Load persisted favorites for the given user id. Call on sign-in / session
  // restore. No-op when the same user is already loaded.
  hydrateForUser: (userId: string) => Promise<void>;
  // Wipe the in-memory state on sign-out. The user's persisted favorites stay
  // in AsyncStorage so they reappear correctly on their next sign-in.
  resetForLogout: () => void;
}

function persistForUser(userId: string | null, data: FavoritesData) {
  if (!userId) return; // anonymous; nothing to persist
  void AsyncStorage.setItem(keyForUser(userId), JSON.stringify(data)).catch((err) =>
    console.log('[Favorites] Failed to persist:', err)
  );
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  currentUserId: null,
  favoriteBasketIds: [],
  favoriteMerchantIds: [],
  starredBasketTypeIds: [],

  toggleBasketFavorite: (basketId: string) =>
    set((state) => {
      const next = state.favoriteBasketIds.includes(basketId)
        ? state.favoriteBasketIds.filter((id) => id !== basketId)
        : [...state.favoriteBasketIds, basketId];
      persistForUser(state.currentUserId, {
        favoriteBasketIds: next,
        favoriteMerchantIds: state.favoriteMerchantIds,
        starredBasketTypeIds: state.starredBasketTypeIds,
      });
      scheduleFavoritesSync(state.favoriteMerchantIds, next, state.starredBasketTypeIds);
      return { favoriteBasketIds: next };
    }),

  toggleMerchantFavorite: (merchantId: string) =>
    set((state) => {
      const next = state.favoriteMerchantIds.includes(merchantId)
        ? state.favoriteMerchantIds.filter((id) => id !== merchantId)
        : [...state.favoriteMerchantIds, merchantId];
      persistForUser(state.currentUserId, {
        favoriteBasketIds: state.favoriteBasketIds,
        favoriteMerchantIds: next,
        starredBasketTypeIds: state.starredBasketTypeIds,
      });
      scheduleFavoritesSync(next, state.favoriteBasketIds, state.starredBasketTypeIds);
      return { favoriteMerchantIds: next };
    }),

  toggleStarredBasketType: (basketTypeId: string) =>
    set((state) => {
      const next = state.starredBasketTypeIds.includes(basketTypeId)
        ? state.starredBasketTypeIds.filter((id) => id !== basketTypeId)
        : [...state.starredBasketTypeIds, basketTypeId];
      persistForUser(state.currentUserId, {
        favoriteBasketIds: state.favoriteBasketIds,
        favoriteMerchantIds: state.favoriteMerchantIds,
        starredBasketTypeIds: next,
      });
      // Saved/starred baskets now sync too (merged into `baskets`) so the
      // low-stock "almost sold out" notification can actually fire for them.
      scheduleFavoritesSync(state.favoriteMerchantIds, state.favoriteBasketIds, next);
      return { starredBasketTypeIds: next };
    }),

  isBasketFavorite: (basketId: string) => get().favoriteBasketIds.includes(basketId),
  isMerchantFavorite: (merchantId: string) => get().favoriteMerchantIds.includes(merchantId),
  isBasketTypeStarred: (basketTypeId: string) => get().starredBasketTypeIds.includes(basketTypeId),

  replaceAll: (data: FavoritesData) => {
    const next: FavoritesData = {
      favoriteBasketIds: [...(data.favoriteBasketIds ?? [])],
      favoriteMerchantIds: [...(data.favoriteMerchantIds ?? [])],
      starredBasketTypeIds: [...(data.starredBasketTypeIds ?? [])],
    };
    persistForUser(get().currentUserId, next);
    scheduleFavoritesSync(next.favoriteMerchantIds, next.favoriteBasketIds, next.starredBasketTypeIds);
    set(next);
  },

  hydrateForUser: async (userId: string) => {
    if (!userId) return;
    const current = get().currentUserId;
    if (current === userId) return; // already loaded for this user
    // Switching users (or first load after sign-in). Reset first so the
    // previous account's data is gone before we await AsyncStorage.
    set({
      currentUserId: userId,
      favoriteBasketIds: [],
      favoriteMerchantIds: [],
      starredBasketTypeIds: [],
    });
    // Best-effort one-shot cleanup of the legacy unscoped key so the device's
    // leaked data doesn't reappear if a future bug ever re-reads it. Skipped
    // silently if it's already gone.
    void AsyncStorage.removeItem(LEGACY_UNSCOPED_KEY).catch(() => {});
    // 1) Local copy — instant + offline-friendly. NOTE: we deliberately do NOT
    // early-return when there's no local data; on a reinstall / new device
    // AsyncStorage is empty and the SERVER copy (step 2) is the only way to get
    // the user's favorites back. That empty-local case is exactly the "I lost
    // my favorites after logging back in" symptom.
    try {
      const raw = await AsyncStorage.getItem(keyForUser(userId));
      if (get().currentUserId !== userId) return; // user switched mid-await
      if (raw) {
        const data: FavoritesData = JSON.parse(raw);
        set({
          favoriteBasketIds: data.favoriteBasketIds ?? [],
          favoriteMerchantIds: data.favoriteMerchantIds ?? [],
          starredBasketTypeIds: data.starredBasketTypeIds ?? [],
        });
      }
    } catch (err) {
      console.log('[Favorites] Failed to hydrate (local):', err);
    }
    // 2) Server copy — restores favorites the device doesn't have locally.
    // UNION with whatever local gave us so neither side ever wipes the other
    // (the user's priority is "don't lose favorites"). Then push the merged set
    // back so the server + the favorites-notify cron stay current.
    try {
      const res = await apiClient.get<any>('/api/auth/favorites');
      if (get().currentUserId !== userId) return; // user switched mid-await
      const d = res.data || {};
      const toStr = (a: any): string[] => (Array.isArray(a) ? a.map((x) => String(x)) : []);
      const srvMerchants = toStr(d.merchants);
      const srvStarred = toStr(d.starred);
      // The server `baskets` field is the COMBINED set (basket favorites +
      // starred). Subtract starred to recover the plain favoriteBasketIds.
      const starredSet = new Set(srvStarred);
      const srvBaskets = toStr(d.baskets).filter((id) => !starredSet.has(id));
      const cur = get();
      const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
      const merged: FavoritesData = {
        favoriteMerchantIds: union(cur.favoriteMerchantIds, srvMerchants),
        favoriteBasketIds: union(cur.favoriteBasketIds, srvBaskets),
        starredBasketTypeIds: union(cur.starredBasketTypeIds, srvStarred),
      };
      // Union only grows, so a length delta is a reliable "something changed".
      const changed =
        merged.favoriteMerchantIds.length !== cur.favoriteMerchantIds.length ||
        merged.favoriteBasketIds.length !== cur.favoriteBasketIds.length ||
        merged.starredBasketTypeIds.length !== cur.starredBasketTypeIds.length;
      if (changed) {
        set(merged);
        persistForUser(userId, merged);
      }
      // Always re-sync once on login so the server has the freshest full set
      // (covers the case where local had favorites the server was missing).
      scheduleFavoritesSync(merged.favoriteMerchantIds, merged.favoriteBasketIds, merged.starredBasketTypeIds);
    } catch (err) {
      // Offline / server unreachable — keep whatever local gave us, and push
      // the local set so the server catches up when next reachable.
      const cur = get();
      scheduleFavoritesSync(cur.favoriteMerchantIds, cur.favoriteBasketIds, cur.starredBasketTypeIds);
    }
  },

  resetForLogout: () =>
    set({
      currentUserId: null,
      favoriteBasketIds: [],
      favoriteMerchantIds: [],
      starredBasketTypeIds: [],
    }),
}));
