import { create } from 'zustand';

export interface CelebrationData {
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  /** 0-1 progress within the new level */
  xpProgress: number;
  xpInLevel: number;
  xpBandSize: number;
  streakChanged: boolean;
  newStreak: number;
}

interface CelebrationStore {
  pending: CelebrationData | null;
  setPending: (data: CelebrationData) => void;
  clearPending: () => void;
}

export const useCelebrationStore = create<CelebrationStore>((set) => ({
  pending: null,
  setPending: (data) => set({ pending: data }),
  clearPending: () => set({ pending: null }),
}));
