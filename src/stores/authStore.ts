import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { User } from '@/src/types';
import { getToken, getUser, clearSession, saveUser } from '@/src/lib/session';

export const useAuthStore = create(
  combine(
    {
      user: null as User | null,
      token: null as string | null,
      isAuthenticated: false,
      hasCompletedOnboarding: false,
      isRestoringSession: true,
    },
    (set) => ({
      signIn: (user: User, token: string) => {
        console.log('[AuthStore] signIn:', user.name, user.role);
        set({ user, token, isAuthenticated: true });
      },

      signOut: async () => {
        console.log('[AuthStore] signOut');
        await clearSession();
        set({ user: null, token: null, isAuthenticated: false });
      },

      completeOnboarding: () => set({ hasCompletedOnboarding: true }),

      setUser: (user: User) => {
        console.log('[AuthStore] setUser:', user.name);
        void saveUser(user);
        set({ user });
      },

      restoreSession: async () => {
        console.log('[AuthStore] Restoring session...');
        try {
          const token = await getToken();
          const user = await getUser<User>();
          if (token && user) {
            console.log('[AuthStore] Session restored for:', user.name);
            set({ user, token, isAuthenticated: true, isRestoringSession: false });
          } else {
            console.log('[AuthStore] No session found');
            set({ isRestoringSession: false });
          }
        } catch (err) {
          console.log('[AuthStore] Session restore failed:', err);
          set({ isRestoringSession: false });
        }
      },
    })
  )
);
