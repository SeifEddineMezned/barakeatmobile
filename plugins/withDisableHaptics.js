const { withAndroidStyles } = require('@expo/config-plugins');

/**
 * Config plugin that silences Android system tap-haptics across the entire
 * app. No JS code in the project triggers haptics — the vibration users feel
 * on every Pressable / TouchableOpacity comes from Android's default
 * "Touch feedback" setting, which fires `View.performHapticFeedback` from
 * the system View attribute `android:hapticFeedbackEnabled`.
 *
 * Setting that attribute to `false` on the activity's AppTheme cascades to
 * every clickable View in the tree, so taps stop vibrating regardless of
 * the user's device-level haptic setting. Notification vibration is
 * controlled separately by `NotificationChannel.vibrationPattern` in
 * `src/services/pushNotifications.ts` and is unaffected.
 *
 * Without a config plugin this value would be reverted every time
 * `npx expo prebuild` regenerates the android folder.
 */
const withDisableHaptics = (config) => {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults?.resources?.style ?? [];
    const appTheme = styles.find((s) => s?.$?.name === 'AppTheme');
    if (!appTheme) return config;

    appTheme.item = appTheme.item ?? [];
    const existing = appTheme.item.find(
      (i) => i?.$?.name === 'android:hapticFeedbackEnabled'
    );
    if (existing) {
      existing._ = 'false';
    } else {
      appTheme.item.push({
        $: { name: 'android:hapticFeedbackEnabled' },
        _: 'false',
      });
    }

    return config;
  });
};

module.exports = withDisableHaptics;
