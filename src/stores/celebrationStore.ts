import { create } from 'zustand';

export interface CelebrationData {
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  /** 0-1 progress within the previous level (before this reservation) */
  xpProgressBefore: number;
  /** 0-1 progress within the new level */
  xpProgress: number;
  xpInLevel: number;
  xpBandSize: number;
  streakChanged: boolean;
  newStreak: number;
  /** Order confirmation data — shown as notification popup after XP animation */
  confirmData?: {
    pickupCode: string;
    pickupStart: string;
    pickupEnd: string;
    address: string;
    locationName?: string;
    basketName?: string;
    basketImage?: string;
    quantity?: number;
    price?: number;
    qrCodeUrl?: string;
  };
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
