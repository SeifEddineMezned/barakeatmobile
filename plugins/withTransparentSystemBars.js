const { withAndroidStyles } = require('@expo/config-plugins');

/**
 * Config plugin that makes the Android system bars (status + navigation) fully
 * transparent under edge-to-edge.
 *
 * Two settings in the generated `android/app/src/main/res/values/styles.xml`
 * fight against edge-to-edge on light-themed apps and have to be overridden:
 *
 *  1. `android:enforceNavigationBarContrast` (default true on Android 10+):
 *     the system draws a translucent scrim behind the nav bar so its icons
 *     stay readable on light backgrounds. On Pixel 6 with our light theme
 *     this scrim shows up as a static white strip at the bottom of every
 *     screen — it does NOT fade with the walkthrough's dim overlay because
 *     it is drawn by the system, not by our app. Setting this to `false`
 *     tells Android to leave the nav-bar area fully transparent so our
 *     content / dim mask reaches the screen edge.
 *
 *  2. `android:statusBarColor = #ffffff`: hardcoded leftover from before
 *     edge-to-edge. On edge-to-edge devices this paints a solid white bar
 *     over the status-bar area which similarly never dims. We set it to
 *     transparent here so the app content shows through.
 *
 * Without a config plugin these values are reverted every time
 * `npx expo prebuild` regenerates the android folder.
 */
const withTransparentSystemBars = (config) => {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults?.resources?.style ?? [];
    const appTheme = styles.find((s) => s?.$?.name === 'AppTheme');
    if (!appTheme) return config;

    appTheme.item = appTheme.item ?? [];
    const upsert = (name, value, extraAttrs = {}) => {
      const existing = appTheme.item.find((i) => i?.$?.name === name);
      if (existing) {
        existing._ = value;
        for (const [k, v] of Object.entries(extraAttrs)) {
          existing.$[k] = v;
        }
      } else {
        appTheme.item.push({ $: { name, ...extraAttrs }, _: value });
      }
    };

    // Stop Android from painting the contrast scrim behind the nav bar.
    upsert('android:enforceNavigationBarContrast', 'false', {
      'tools:targetApi': '29',
    });
    // Stop Android from painting a solid status-bar background. Edge-to-edge
    // wants the app content to draw through here.
    upsert('android:statusBarColor', '@android:color/transparent');
    // Nav bar should be transparent too — explicit so we don't depend on
    // the Expo edge-to-edge plugin's defaults.
    upsert('android:navigationBarColor', '@android:color/transparent');

    return config;
  });
};

module.exports = withTransparentSystemBars;
