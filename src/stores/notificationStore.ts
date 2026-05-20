import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NotificationFromAPI } from '@/src/services/notifications';

// Popup-tracking state is per-user. Multiple members of the same business can log in
// on different devices; each must track their own "already popped" IDs so a teammate
// consuming popups doesn't hide them from this user.
const lastSeenKey = (userId: string) => `@barakeat_last_seen_notif_id_${userId}`;
const shownPopupIdsKey = (userId: string) => `@barakeat_shown_popup_ids_${userId}`;

export const useNotificationStore = create(
  combine(
    {
      unreadCount: 0,
      popupQueue: [] as NotificationFromAPI[],
      lastSeenNotifId: 0,
      // IDs of notifications that have already been shown as popups — persisted per user
      shownPopupIds: new Set<number>(),
      // True once AsyncStorage restore has completed for the current user — polling must wait
      hydrated: false,
      // The user ID currently owning this state. Used to scope AsyncStorage keys.
      currentUserId: null as string | null,
    },
    (set, get) => ({
      setUnreadCount: (count: number) => set({ unreadCount: count }),
      decrementUnread: () => set((state) => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),
      clearUnread: () => set({ unreadCount: 0 }),
      pushPopups: (notifs: NotificationFromAPI[]) => set((state) => {
        const queueIds = new Set(state.popupQueue.map(n => n.id));
        const fresh = notifs.filter(n =>
          !queueIds.has(n.id) &&
          !state.shownPopupIds.has(n.id)
        );
        if (fresh.length === 0) return state;
        // Mark these as shown
        const newShown = new Set(state.shownPopupIds);
        fresh.forEach(n => newShown.add(n.id));
        // Persist shown IDs (keep last 200 to avoid unbounded growth)
        const shownArr = [...newShown].slice(-200);
        if (state.currentUserId) {
          AsyncStorage.setItem(shownPopupIdsKey(state.currentUserId), JSON.stringify(shownArr)).catch(() => {});
        }
        return { popupQueue: [...state.popupQueue, ...fresh].slice(-3), shownPopupIds: newShown };
      }),
      clearPopups: () => set({ popupQueue: [] }),
      setLastSeenNotifId: (id: number) => {
        const { currentUserId } = get();
        set({ lastSeenNotifId: id });
        if (currentUserId) {
          AsyncStorage.setItem(lastSeenKey(currentUserId), String(id)).catch(() => {});
        }
      },
      // Called when an in-app popup is actually dismissed by the user — this is
      // the point at which we "consume" the notification for popup-carousel
      // purposes. Splitting this from pushPopups means a popup that never
      // reached the screen (e.g. app backgrounded) stays eligible on next open.
      acknowledgePopup: (id: number) => {
        const { currentUserId, lastSeenNotifId } = get();
        if (id > lastSeenNotifId) {
          set({ lastSeenNotifId: id });
          if (currentUserId) {
            AsyncStorage.setItem(lastSeenKey(currentUserId), String(id)).catch(() => {});
          }
        }
        // Mark read on the server so it disappears from the bell list too.
        try {
          // Dynamic require avoids a circular import at module init.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { markNotificationRead } = require('@/src/services/notifications');
          markNotificationRead(id).catch(() => {});
        } catch {}
      },
      // Load persisted state for the given user. Call on login / session restore.
      // If the userId differs from the currently-loaded one, state is reset before loading.
      hydrateForUser: async (userId: string) => {
        if (!userId) return;
        const current = get().currentUserId;
        if (current === userId && get().hydrated) return;
        // Switching users (or first load) — reset first so we don't leak another user's state
        set({
          lastSeenNotifId: 0,
          shownPopupIds: new Set<number>(),
          popupQueue: [],
          hydrated: false,
          currentUserId: userId,
        });
        try {
          const [storedId, storedShown] = await Promise.all([
            AsyncStorage.getItem(lastSeenKey(userId)),
            AsyncStorage.getItem(shownPopupIdsKey(userId)),
          ]);
          const lastSeen = storedId ? parseInt(storedId) || 0 : 0;
          const shownIds = storedShown ? (JSON.parse(storedShown) as number[]) : [];
          // Only apply if we're still on the same user (in case of fast switches)
          if (get().currentUserId !== userId) return;
          set({
            lastSeenNotifId: lastSeen,
            shownPopupIds: new Set(shownIds),
            hydrated: true,
          });
        } catch {
          if (get().currentUserId === userId) {
            set({ hydrated: true });
          }
        }
      },
      // Clear in-memory state on logout. Persisted AsyncStorage entries are kept so the
      // user sees the correct "already popped" history when they log back in.
      resetForLogout: () => {
        set({
          unreadCount: 0,
          popupQueue: [],
          lastSeenNotifId: 0,
          shownPopupIds: new Set<number>(),
          hydrated: false,
          currentUserId: null,
        });
      },
    })
  )
);
