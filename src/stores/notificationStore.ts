import { create } from 'zustand';
import { combine } from 'zustand/middleware';

export const useNotificationStore = create(
  combine(
    {
      unreadCount: 0,
    },
    (set) => ({
      setUnreadCount: (count: number) => set({ unreadCount: count }),
      decrementUnread: () => set((state) => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),
      clearUnread: () => set({ unreadCount: 0 }),
    })
  )
);
