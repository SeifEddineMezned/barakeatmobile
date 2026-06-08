import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiClient } from '@/src/lib/api';

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
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  handlerSet = true;
}

export async function registerForPushNotifications(): Promise<string | null> {
  if (isExpoGo) {
    console.log('[Push] Skipping push registration in Expo Go');
    return null;
  }
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
      projectId: 'd3b5c7d2-49f2-4de1-bfe8-f6146c2576e8',
    });
    const token = tokenData.data;

    // Send token to backend
    try {
      await apiClient.put('/api/auth/push-token', { pushToken: token });
    } catch {
      console.log('[Push] Failed to save token to backend');
    }

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
