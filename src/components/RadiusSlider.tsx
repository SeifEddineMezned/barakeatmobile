import React, { useRef } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';

// Shared "drag a thumb on a track" radius slider. Extracted from the discover
// map (map-view.tsx) so leaderboard / future filter UIs use the exact same
// gesture model + visuals — replaces the +/- buttons that user-tested as
// slower and less satisfying for picking a radius.
const DEFAULT_MIN = 1;
const DEFAULT_MAX = 60;
const THUMB_SIZE = 24;
const THUMB_HALF = THUMB_SIZE / 2;
const _THUMB_HALF_ANIM = new Animated.Value(THUMB_HALF);

export function RadiusSlider({
  value,
  onChange,
  primaryColor,
  trackColor,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  labelColor,
}: {
  value: number;
  onChange: (km: number) => void;
  primaryColor: string;
  trackColor: string;
  min?: number;
  max?: number;
  // Optional override for the "{min} km" / "{max} km" bound labels. Defaults
  // to a darker grey than trackColor so the bounds stay readable while the
  // rail itself reads as a faint background line.
  labelColor?: string;
}) {
  const boundsColor = labelColor ?? '#6b7280';
  const trackWidth = useRef(0);
  const trackPageX = useRef(0);
  const isDragging = useRef(false);
  const lastKm = useRef(value);
  const thumbX = useRef(new Animated.Value(0)).current;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const kmToXFn = (km: number, width: number) =>
    ((km - min) / (max - min)) * width;

  const absToKmFn = (absX: number, width: number) => {
    const localX = absX - trackPageX.current;
    const clamped = Math.max(0, Math.min(width, localX));
    const raw = (clamped / width) * (max - min) + min;
    return Math.max(min, Math.min(max, Math.round(raw)));
  };

  const kmToXRef = useRef(kmToXFn);
  const absToKmRef = useRef(absToKmFn);
  kmToXRef.current = kmToXFn;
  absToKmRef.current = absToKmFn;

  const setThumbToKm = (km: number, width: number) => {
    thumbX.setValue(kmToXRef.current(km, width));
  };

  const syncFromProp = (km: number) => {
    if (!isDragging.current && trackWidth.current > 0) {
      setThumbToKm(km, trackWidth.current);
      lastKm.current = km;
    }
  };

  const valueRef = useRef(value);
  if (valueRef.current !== value) {
    valueRef.current = value;
    syncFromProp(value);
  }

  const sliderPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_, gs) => {
        isDragging.current = true;
        const w = trackWidth.current;
        if (w <= 0) return;
        const km = absToKmRef.current(gs.x0, w);
        thumbX.setValue(kmToXRef.current(km, w));
        if (km !== lastKm.current) { lastKm.current = km; onChangeRef.current(km); }
      },
      onPanResponderMove: (_, gs) => {
        const w = trackWidth.current;
        if (w <= 0) return;
        const km = absToKmRef.current(gs.moveX, w);
        const px = Math.max(0, Math.min(w, gs.moveX - trackPageX.current));
        thumbX.setValue(px);
        if (km !== lastKm.current) { lastKm.current = km; onChangeRef.current(km); }
      },
      onPanResponderRelease: (_, gs) => {
        const w = trackWidth.current;
        if (w <= 0) { isDragging.current = false; return; }
        const km = absToKmRef.current(gs.moveX, w);
        thumbX.setValue(kmToXRef.current(km, w));
        if (km !== lastKm.current) { lastKm.current = km; onChangeRef.current(km); }
        isDragging.current = false;
      },
    }),
  ).current;

  return (
    <View
      style={{ paddingVertical: 8, paddingHorizontal: 2 }}
      onLayout={(e) => {
        const { width } = e.nativeEvent.layout;
        trackWidth.current = width;
        if (!isDragging.current) setThumbToKm(lastKm.current, width);
      }}
      ref={(ref: any) => {
        if (ref && ref.measure) {
          ref.measure((_x: number, _y: number, _w: number, _h: number, px: number) => {
            if (px !== undefined && px !== null) trackPageX.current = px;
          });
        }
      }}
      {...sliderPan.panHandlers}
    >
      <View style={{ height: 5, borderRadius: 3, backgroundColor: trackColor, overflow: 'visible' }}>
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: thumbX, backgroundColor: primaryColor, borderRadius: 3 }} />
        <Animated.View
          style={{
            position: 'absolute', top: -(THUMB_HALF - 2),
            width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_HALF,
            backgroundColor: primaryColor, borderWidth: 3, borderColor: '#fff',
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 }, elevation: 5,
            transform: [{ translateX: Animated.subtract(thumbX, _THUMB_HALF_ANIM) }],
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
        <Text style={{ fontSize: 10, color: boundsColor, fontFamily: 'Poppins_500Medium' }}>{min} km</Text>
        <Text style={{ fontSize: 10, color: boundsColor, fontFamily: 'Poppins_500Medium' }}>{max} km</Text>
      </View>
    </View>
  );
}
