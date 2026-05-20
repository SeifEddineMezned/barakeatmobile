import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'barakeat_reported_reservations';

// Local tracker for reservations the user has already reported (claimed).
// The backend should eventually return `has_claim` on reservations; until
// that field is reliable on the mobile side, this store keeps the Report/
// Review buttons from reappearing after the user already filed a claim.
interface OrdersState {
  reportedReservationIds: string[];
  markReservationReported: (reservationId: string) => void;
  isReservationReported: (reservationId: string) => boolean;
  hydrate: () => Promise<void>;
}

function persist(ids: string[]) {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids)).catch(() => {});
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  reportedReservationIds: [],
  markReservationReported: (reservationId: string) =>
    set((state) => {
      if (state.reportedReservationIds.includes(reservationId)) return state;
      const next = [...state.reportedReservationIds, reservationId];
      persist(next);
      return { reportedReservationIds: next };
    }),
  isReservationReported: (reservationId: string) =>
    get().reportedReservationIds.includes(reservationId),
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const ids: string[] = JSON.parse(raw);
        if (Array.isArray(ids)) set({ reportedReservationIds: ids });
      }
    } catch {}
  },
}));
