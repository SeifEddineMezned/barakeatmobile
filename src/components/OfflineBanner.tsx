import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Constants from 'expo-constants';
import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { BarakeatErrorIcon } from '@/src/components/ui/BarakeatErrorIcon';

// Absolute-positioned overlay. Previously this was a plain View in the layout
// flow, mounted as a sibling above the root navigator — when it appeared it
// physically pushed every screen down. Positioning it absolutely with a high
// zIndex keeps it visually on top of the status-bar area without disturbing
// any layout below. `Constants.statusBarHeight` substitutes for safe-area
// insets (no SafeAreaProvider lives at the root that mounts this component).
export function OfflineBanner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isConnected = useNetworkStatus();
  // Local dismiss flag — when the user taps the X, hide the banner for the
  // duration of THIS outage. Reset back to false the next time the device
  // reports a fresh connection drop, so the banner re-appears for the next
  // outage instead of staying silenced forever.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (isConnected !== false) setDismissed(false);
  }, [isConnected]);

  if (isConnected !== false) return null;
  if (dismissed) return null;

  return (
    <View
      style={[styles.container, { backgroundColor: '#111111' }]}
      accessibilityRole="alert"
      accessibilityLabel={t('offline.title')}
    >
      <BarakeatErrorIcon size={16} color="#fff" />
      <Text style={[styles.text, { ...theme.typography.bodySm }]}>
        {t('offline.title')}
      </Text>
      <TouchableOpacity
        onPress={() => setDismissed(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={t('common.dismiss', { defaultValue: 'Ignorer' })}
        style={styles.dismissBtn}
      >
        <X size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: (Constants.statusBarHeight ?? 0) + 8,
    paddingBottom: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    zIndex: 9999,
    elevation: 9999,
  },
  text: {
    color: '#fff',
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  // Pin the dismiss button at the far right while the icon + text stay
  // centered. Absolute positioning keeps the layout balanced — the centered
  // pair doesn't shift when we add the button on the right.
  dismissBtn: {
    position: 'absolute',
    right: 12,
    top: (Constants.statusBarHeight ?? 0) + 4,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
  },
});
