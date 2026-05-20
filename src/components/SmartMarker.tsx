import React, { useState, useEffect } from 'react';
import { Platform } from 'react-native';

interface SmartMarkerProps {
  MarkerComponent: React.ComponentType<any>;
  children: React.ReactNode;
  /**
   * Change this value whenever the marker's visual content should be re-captured
   * (e.g. when a radius change flips the pin between "nearby" and "far" styles).
   * The wrapper briefly re-enables tracksViewChanges so Android re-snapshots
   * the custom view into its marker bitmap, then disables it again for perf.
   */
  bustKey?: string | number;
  [key: string]: any;
}

/**
 * Wrapper around react-native-maps Marker that handles Samsung rendering issues.
 * Samsung devices need tracksViewChanges={true} initially to capture the custom
 * marker view bitmap, then switch to false for performance.
 *
 * When `bustKey` changes we re-capture the bitmap so visual changes driven by
 * prop updates (e.g. the nearby/far pin swap when radius changes) actually
 * appear on Android — without this, markers looked frozen and clipped when
 * the radius slider moved over them.
 */
export function SmartMarker({ MarkerComponent, children, bustKey, ...props }: SmartMarkerProps) {
  const [tracksViewChanges, setTracksViewChanges] = useState(Platform.OS === 'android');

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    setTracksViewChanges(true);
    const timer = setTimeout(() => setTracksViewChanges(false), 500);
    return () => clearTimeout(timer);
  }, [bustKey]);

  return (
    <MarkerComponent {...props} tracksViewChanges={tracksViewChanges}>
      {children}
    </MarkerComponent>
  );
}
