import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { User } from '@/src/types';
import { getToken, getUser, clearSession, saveUser } from '@/src/lib/session';
import { saveToken } from '@/src/lib/session';

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
        // Persist user + token so session restore has the correct role
        void saveUser(user);
        void saveToken(token);
        set({ user, token, isAuthenticated: true });
      },

      signOut: async () => {
        console.log('[AuthStore] signOut');
        await clearSession();
        set({ user: null, token: null, isAuthenticated: false });
      },

      completeOnboarding: async () => {
        set({ hasCompletedOnboarding: true });
        try {
          const AsyncStorage = require('@react-native-async-storage/async-storage').default;
          await AsyncStorage.setItem('barakeat_onboarding_completed', 'true');
        } catch {}
      },

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

          // Restore onboarding state
          try {
            const AsyncStorage = require('@react-native-async-storage/async-storage').default;
            const onboardingDone = await AsyncStorage.getItem('barakeat_onboarding_completed');
            if (onboardingDone === 'true') {
              set({ hasCompletedOnboarding: true });
            }
          } catch {}

          if (token && user) {
            // Ensure role is set — older stored sessions may only have `type` from backend
            if (!user.role && (user as any).type) {
              const backendType = (user as any).type;
              user.role = (backendType === 'restaurant' || backendType === 'business') ? 'business' : 'customer';
              console.log('[AuthStore] Derived role from type:', backendType, '->', user.role);
              void saveUser(user); // persist the fix
            }
            console.log('[AuthStore] Session restored for:', user.name, '| role:', user.role);
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
