import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

interface BarakeatErrorIconProps {
  size?: number;
  color?: string;
}

/**
 * Barakeat-branded error icon: a small paper bag with a sad face.
 *
 * Replaces lucide's generic XCircle in the error variant of CustomAlert so the
 * error popup reads as "something went wrong with your Barakeat bag" instead of
 * a stock cross-in-a-circle. The bag silhouette mirrors the splash animation's
 * paper-bag SVG (same trapezoidal body + arched handles) for visual continuity.
 */
export function BarakeatErrorIcon({ size = 24, color = '#d94f4f' }: BarakeatErrorIconProps) {
  const strokeWidth = 1.6;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Left handle — arches up from the rim, mirrored on the right. */}
      <Path
        d="M7.4 8.2 V6.6 a2.4 2.4 0 0 1 2.4 -2.4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M16.6 8.2 V6.6 a2.4 2.4 0 0 0 -2.4 -2.4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
      {/* Bag body — trapezoidal, slightly wider at the base. */}
      <Path
        d="M5 8.2 H19 L20 21 a1 1 0 0 1 -1 1 H5 a1 1 0 0 1 -1 -1 Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        fill="none"
      />
      {/* Rim crease across the front — subtle paper detail. */}
      <Path
        d="M5 10.4 H19"
        stroke={color}
        strokeWidth={strokeWidth * 0.7}
        strokeLinecap="round"
        opacity={0.5}
      />
      {/* Eyes — small dots */}
      <Circle cx={9.5} cy={14.5} r={0.95} fill={color} />
      <Circle cx={14.5} cy={14.5} r={0.95} fill={color} />
      {/* Frown — sad mouth curve */}
      <Path
        d="M9.6 19.2 Q12 17 14.4 19.2"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
