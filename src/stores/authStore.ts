import { create } from 'zustand';
import { User } from '@/src/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  hasCompletedOnboarding: boolean;
  signIn: (user: User) => void;
  signOut: () => void;
  completeOnboarding: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  hasCompletedOnboarding: false,
  signIn: (user: User) => set({ user, isAuthenticated: true }),
  signOut: () => set({ user: null, isAuthenticated: false }),
  completeOnboarding: () => set({ hasCompletedOnboarding: true }),
}));
