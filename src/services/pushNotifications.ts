import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '@/src/lib/api';

// Key under which we remember THIS device's Expo push token, so sign-out can
// detach exactly this device from the account (multi-device) without touching
// the account's other devices.
const EXPO_TOKEN_KEY = '@barakeat_expo_push_token';

// Expo Go does not support push notifications from SDK 53+ on Android.
// Importantly: we LAZY-LOAD `expo-notifications` inside each function below
// rather than at module scope. SDK 53 Expo Go on Android logs a noisy
// "Android Push notifications was removed from Expo Go" warning as soon as
// certain exports are touched, even just by an `import * as Notifications`.
// Keeping the require() behind the isExpoGo gate keeps that console quiet.
const isExpoGo = Constants.appOwnership === 'expo';

// The notification handler is set lazily on first use — see callers below.
// In Expo Go it never runs.
let handlerSet = false;
function ensureHandler(): void {
  if (isExpoGo || handlerSet) return;
  const Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      // Hold the foreground banner while the new-order animation / celebration is
      // on screen — the "order confirmed" push to the buyer's own device would
      // otherwise pop OVER it. The notification is still delivered to the tray +
      // bell, and the after-celebration order-confirmed popup shows the details.
      let busy = false;
      try {
        const { useCelebrationStore } = require('@/src/stores/celebrationStore');
        const s = useCelebrationStore.getState();
        busy = !!(s.pending || s.orderFlowActive);
      } catch {}
      // SDK 54 (expo-notifications 0.32+): `shouldShowAlert` is deprecated and
      // IGNORED — foreground presentation is now driven by `shouldShowBanner` +
      // `shouldShowList`. Returning only the old field meant any push that
      // landed while the app was in the FOREGROUND showed no OS banner at all
      // (e.g. the pickup-closing reminder, received while the user had the app
      // open, only appeared in-app). Keep `shouldShowAlert` for back-compat.
      return {
        shouldShowBanner: !busy,
        shouldShowList: !busy,
        shouldShowAlert: !busy,
        shouldPlaySound: !busy,
        shouldSetBadge: false,
      };
    },
  });
  handlerSet = true;
}

// Dedupe in-flight registration. The root layout effect that calls this has
// deps `[isAuthenticated, isRestoringSession, user?.id]` which can flip in
// quick succession on cold start (and React StrictMode mounts twice in dev),
// firing this twice within a few ms. The two parallel PUTs to /api/auth/
// push-token and /api/auth/fcm-token would then race each other into the
// backend's express-rate-limit window and both come back 429, with neither
// getting through — chat push notifications silently broken on Android until
// the next sign-in. Caching the promise collapses concurrent callers onto
// one HTTP round-trip; the cache clears the moment the promise settles so a
// later legitimate re-registration (post-permission-grant, etc.) still works.
let inFlightRegistration: Promise<string | null> | null = null;

export async function registerForPushNotifications(): Promise<string | null> {
  if (isExpoGo) {
    console.log('[Push] Skipping push registration in Expo Go');
    return null;
  }
  if (inFlightRegistration) return inFlightRegistration;
  inFlightRegistration = (async () => {
    try {
      return await doRegisterForPushNotifications();
    } finally {
      inFlightRegistration = null;
    }
  })();
  return inFlightRegistration;
}

async function doRegisterForPushNotifications(): Promise<string | null> {
  ensureHandler();
  const Notifications = require('expo-notifications');

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] Permission not granted');
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Barakeat',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: '9d8ccb2b-0876-491c-bdc4-eab409cb105a',
    });
    const token = tokenData.data;

    // Gather the native FCM token too (Android only) so we register BOTH tokens
    // for this device in ONE multi-device row. `.data` IS the FCM registration
    // token on Android; the reported `type` may be 'android' not 'fcm' depending
    // on SDK version, so don't gate on it.
    let fcmToken: string | null = null;
    try {
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      console.log('[Push] device push token type:', deviceToken?.type);
      if (Platform.OS === 'android' && typeof deviceToken?.data === 'string' && deviceToken.data) {
        fcmToken = deviceToken.data;
      }
    } catch (e) {
      console.log('[Push] Failed to get FCM device token:', (e as any)?.message);
    }

    // PRIMARY: register THIS device (expo + fcm + platform) so the account can
    // have several live devices that ALL receive pushes (multi-device).
    try {
      await apiClient.put('/api/auth/device-token', { expoToken: token, fcmToken, platform: Platform.OS });
    } catch {
      console.log('[Push] Failed to register device token');
    }
    // Remember this device's Expo token so sign-out detaches exactly this device.
    try { await AsyncStorage.setItem(EXPO_TOKEN_KEY, token); } catch {}

    // LEGACY fallback — keep the single-token columns in sync so an older backend
    // path (or a failed device-token call) still delivers. Harmless when the
    // device row exists: the server prefers device rows and ignores these.
    try { await apiClient.put('/api/auth/push-token', { pushToken: token }); } catch {}
    if (fcmToken) { try { await apiClient.put('/api/auth/fcm-token', { fcmToken }); } catch {} }

    return token;
  } catch (error) {
    console.log('[Push] Registration error:', error);
    return null;
  }
}

// Clears this device's Expo push token on the backend so the server stops
// delivering OS-level (phone) push notifications. Called when the user turns the
// push toggle OFF. In-app notifications are NOT affected — they are polled from
// the notifications feed and never depend on the push token.
export async function unregisterPushNotifications(): Promise<void> {
  // Detach ONLY this device's multi-device row (the account's other devices keep
  // receiving pushes), then clear the legacy single-token columns too.
  try {
    const token = await AsyncStorage.getItem(EXPO_TOKEN_KEY);
    if (token) {
      await apiClient.delete('/api/auth/device-token', { data: { expoToken: token } } as any);
    }
  } catch {}
  try {
    await apiClient.delete('/api/auth/push-token');
  } catch {
    console.log('[Push] Failed to clear token on backend');
  }
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  triggerSeconds: number,
): Promise<string | null> {
  if (isExpoGo) {
    console.log('[Push] Skipping local notification in Expo Go');
    return null;
  }
  ensureHandler();
  const Notifications = require('expo-notifications');

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: { seconds: triggerSeconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
    });
    return id;
  } catch (error) {
    console.log('[Push] Schedule error:', error);
    return null;
  }
}

export async function cancelAllScheduledNotifications(): Promise<void> {
  if (isExpoGo) return;
  const Notifications = require('expo-notifications');
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// Clears the OS app-icon badge, and OPTIONALLY dismisses delivered
// notifications from the tray.
//
// `dismissTray` defaults to FALSE: on an ordinary app foreground we only zero
// the numeric badge and LEAVE the tray intact, so delivered notifications
// persist (Messenger-style) instead of vanishing every time the user opens the
// app — previously `dismissAllNotificationsAsync()` ran on every foreground and
// wiped the whole tray, which is why a pickup/cancel notification appeared to
// "delete" the earlier ones (the QR scanner bounces the app inactive→active,
// firing the clear).
//
// `dismissTray: true` is passed only on login/logout/account-switch, where we
// DO want to clear the tray so a freshly-signed-in account never inherits the
// previous account's notifications.
//
// Note: on Android the launcher derives the icon dot from the notifications
// still in the tray, so with the tray preserved the dot may linger until the
// user opens the relevant thread — the accepted trade for not nuking notifs.
// No-ops in Expo Go.
export async function clearNotificationBadge(dismissTray: boolean = false): Promise<void> {
  if (isExpoGo) return;
  try {
    const Notifications = require('expo-notifications');
    await Notifications.setBadgeCountAsync(0);
    if (dismissTray) {
      await Notifications.dismissAllNotificationsAsync();
    }
  } catch {}
}
