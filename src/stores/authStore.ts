import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { User } from '@/src/types';
import { getToken, getUser, clearSession, saveUser, purgeStaleKeychainSession } from '@/src/lib/session';
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
      signIn: async (user: User, token: string): Promise<void> => {
        console.log('[AuthStore] signIn:', user.name, user.role);
        // Persist user + token BEFORE updating in-memory state, so callers
        // that immediately navigate (sign-in screen → router.replace into
        // tabs/dashboard) can `await` this and know the SecureStore writes
        // committed. The previous fire-and-forget version raced the very
        // first reload after sign-in — if SecureStore's write hadn't landed
        // yet (or the keystore threw silently — see session.ts) the user
        // would re-launch into the sign-in screen and assume the session
        // had been wiped.
        try {
          await saveUser(user);
          await saveToken(token);
        } catch (err) {
          // saveToken/saveUser now throw on failure. Surface a console error
          // so it's visible in the logs the next time this happens, but
          // still flip the in-memory state so the current session works
          // until the user reloads.
          console.error('[AuthStore] signIn: SecureStore persistence FAILED — session will not survive reload:', err);
        }
        set({ user, token, isAuthenticated: true });
      },

      signOut: async () => {
        console.log('[AuthStore] signOut');
        // Detach this device's push token on the backend BEFORE wiping the
        // local session (the DELETE needs the JWT). Covers sign-out paths that
        // call the store directly rather than services/auth.logout(). Otherwise
        // the server keeps pushing this account's notifications to the phone
        // after sign-out. Best-effort + idempotent — a no-op if logout() already
        // cleared it (the token is gone, the DELETE just fails silently).
        try {
          const { unregisterPushNotifications } = require('@/src/services/pushNotifications');
          await unregisterPushNotifications();
        } catch {}
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
          // Guard: on iOS the Keychain survives an app uninstall, so a
          // reinstall can silently restore a stale session. If the token only
          // exists in SecureStore (and not in its AsyncStorage mirror), treat
          // it as a fresh install and purge it. Migration-safe — see session.ts.
          await purgeStaleKeychainSession();

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
