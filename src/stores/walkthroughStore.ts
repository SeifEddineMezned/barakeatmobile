import { create } from 'zustand';

interface WalkthroughState {
  step: number | null;
  startWalkthrough: () => void;
  nextStep: (totalSteps: number) => void;
  skipWalkthrough: () => void;
}

export const useWalkthroughStore = create<WalkthroughState>((set) => ({
  step: null,
  startWalkthrough: () => set({ step: 0 }),
  nextStep: (totalSteps: number) =>
    set((state) => {
      if (state.step === null) return state;
      const next = state.step + 1;
      return { step: next >= totalSteps ? null : next };
    }),
  skipWalkthrough: () => set({ step: null }),
}));
