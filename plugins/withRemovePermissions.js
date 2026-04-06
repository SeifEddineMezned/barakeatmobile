const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Config plugin that removes unwanted Android permissions injected by third-party libraries.
 * expo-camera declares RECORD_AUDIO in its own AndroidManifest.xml (for video recording),
 * which gets merged in by the Android manifest merger AFTER config plugins run.
 *
 * The correct fix is to add a `tools:node="remove"` override entry, which instructs
 * the Android manifest merger to strip the permission even when a library declares it.
 */
const PERMISSIONS_TO_REMOVE = [
  'android.permission.RECORD_AUDIO',
];

const withRemovePermissions = (config) => {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // Ensure the tools namespace is declared on the <manifest> element
    manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const permissions = manifest.manifest['uses-permission'] || [];

    // Remove any existing entries for these permissions (added by our own app.json or previous runs)
    manifest.manifest['uses-permission'] = permissions.filter((p) => {
      return !PERMISSIONS_TO_REMOVE.includes(p.$?.['android:name']);
    });

    // Add tools:node="remove" override entries so the Android merger strips library-added permissions
    for (const permission of PERMISSIONS_TO_REMOVE) {
      manifest.manifest['uses-permission'].push({
        $: {
          'android:name': permission,
          'tools:node': 'remove',
        },
      });
    }

    return config;
  });
};

module.exports = withRemovePermissions;
