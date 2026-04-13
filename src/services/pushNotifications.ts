import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiClient } from '@/src/lib/api';

// Expo Go does not support push notifications from SDK 53+
const isExpoGo = Constants.appOwnership === 'expo';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
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
      if (token) {
        await apiClient.put('/api/users/push-token', { pushToken: token });
      }
    } catch {
      console.log('[Push] Failed to save token to backend');
    }

    return token;
  } catch (error) {
    console.log('[Push] Registration error:', error);
    return null;
  }
}

export async function unregisterPushToken(): Promise<void> {
  try {
    await apiClient.delete('/api/users/push-token');
  } catch {
    console.log('[Push] Failed to remove token from backend');
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
  await Notifications.cancelAllScheduledNotificationsAsync();
}
