import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';

interface MapFallbackProps {
  markers?: Array<{ id: string; name: string; lat: number; lng: number }>;
  radius?: number;
  style?: any;
}

export function MapFallback({ markers = [], radius, style }: MapFallbackProps) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: '#e8efe8', borderRadius: 16 }, style]}>
      <View style={styles.grid}>
        {Array.from({ length: 6 }).map((_, row) => (
          <View key={row} style={styles.gridRow}>
            {Array.from({ length: 8 }).map((_, col) => (
              <View
                key={col}
                style={[styles.gridDot, { backgroundColor: theme.colors.primary + '15' }]}
              />
            ))}
          </View>
        ))}
      </View>

      <View style={[styles.radiusCircle, {
        borderColor: theme.colors.primary + '40',
        width: radius ? Math.min(radius * 30, 200) : 120,
        height: radius ? Math.min(radius * 30, 200) : 120,
        borderRadius: radius ? Math.min(radius * 15, 100) : 60,
      }]}>
        <View style={[styles.centerDot, { backgroundColor: theme.colors.primary }]} />
      </View>

      {markers.slice(0, 8).map((marker, i) => {
        const angle = (i / Math.max(markers.length, 1)) * Math.PI * 2;
        const r = 40 + (i % 3) * 20;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        return (
          <View
            key={marker.id}
            style={[styles.marker, {
              transform: [{ translateX: x }, { translateY: y }],
              backgroundColor: theme.colors.primary,
            }]}
          >
            <MapPin size={10} color="#fff" />
          </View>
        );
      })}

      {radius != null && (
        <View style={[styles.radiusBadge, { backgroundColor: theme.colors.primary }]}>
          <Text style={[styles.radiusText, { color: '#fff', fontFamily: 'Poppins_600SemiBold' }]}>
            {radius} km
          </Text>
        </View>
      )}

      <Text style={[styles.hint, { color: theme.colors.textSecondary, fontFamily: 'Poppins_400Regular' }]}>
        Carte disponible sur mobile
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  grid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-evenly',
    padding: 16,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  gridDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  radiusCircle: {
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  marker: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radiusBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  radiusText: {
    fontSize: 11,
  },
  hint: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    fontSize: 10,
  },
});
