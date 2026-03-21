import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const WELCOME_DISMISSED_KEY = 'barakeat_welcome_dismissed';

export const useSplashStore = create<{
  showSplash: boolean;
  wasLoginSplash: boolean;
  triggerSplash: (isLogin?: boolean) => void;
  dismissSplash: () => void;
  resetWelcomeDismissed: () => Promise<void>;
}>((set) => ({
  showSplash: false,
  wasLoginSplash: false,
  triggerSplash: (isLogin = true) => {
    if (isLogin) {
      void AsyncStorage.removeItem(WELCOME_DISMISSED_KEY);
    }
    set({ showSplash: true, wasLoginSplash: isLogin });
  },
  dismissSplash: () => set({ showSplash: false }),
  resetWelcomeDismissed: async () => {
    await AsyncStorage.removeItem(WELCOME_DISMISSED_KEY);
  },
}));
