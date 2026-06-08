import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persisted cache of the search-tab review-aggregate map
// (location_id → {avg, count}). Hydrated at app boot from AsyncStorage so the
// search tab paints ratings INSTANTLY on first frame — no "N/A → loads later"
// flash. Live data from `useQuery(['review-map-all'])` overrides this whenever
// it resolves; that query is also prefetched at app boot so the network fetch
// is in-flight before the user reaches the search tab.
//
// This whole store becomes dead-code the moment the backend ships
// avg_rating + review_count on the /api/locations list response
// (see services/restaurants.ts TODO).

const STORAGE_KEY = 'barakeat_review_map_v1';

export type ReviewSummary = { avg: number; count: number };
export type ReviewMap = Record<string, ReviewSummary>;

interface ReviewMapState {
  map: ReviewMap;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setMap: (next: ReviewMap) => void;
}

export const useReviewMapStore = create<ReviewMapState>((set) => ({
  map: {},
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') {
          set({ map: parsed as ReviewMap, hydrated: true });
          return;
        }
      }
      set({ hydrated: true });
    } catch (err) {
      console.log('[ReviewMap] hydrate failed:', err);
      set({ hydrated: true });
    }
  },
  setMap: (next) => {
    set({ map: next });
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((err) =>
      console.log('[ReviewMap] persist failed:', err),
    );
  },
}));
