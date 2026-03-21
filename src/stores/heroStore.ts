import { create } from 'zustand';

export const useHeroStore = create<{
  heroVisible: boolean;
  setHeroVisible: (visible: boolean) => void;
}>((set) => ({
  heroVisible: true,
  setHeroVisible: (visible) => set({ heroVisible: visible }),
}));
