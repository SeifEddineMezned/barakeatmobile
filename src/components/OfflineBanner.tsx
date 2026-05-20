import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';

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

  if (isConnected !== false) return null;

  return (
    <View
      style={[styles.container, { backgroundColor: '#e53e3e' }]}
      accessibilityRole="alert"
      accessibilityLabel={t('offline.title')}
      pointerEvents="none"
    >
      <WifiOff size={16} color="#fff" />
      <Text style={[styles.text, { ...theme.typography.bodySm }]}>
        {t('offline.title')}
      </Text>
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
  },
});
