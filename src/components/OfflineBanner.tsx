import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';

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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
  },
  text: {
    color: '#fff',
    fontWeight: '600',
  },
});
