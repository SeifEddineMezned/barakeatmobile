/**
 * PaperSurface — the single source of the app's "warm paper" popup texture.
 *
 * Wraps content in a subtle vertical gradient wash (#FFFFFF → #fcfcfa) with a
 * 1px warm hairline border and a soft layered shadow, so cards read as a
 * crafted surface rather than a flat white rectangle. Every popup card (menus,
 * modals, confirmations, notifications) is built on this.
 *
 * `style` carries layout (width / maxWidth / position / padding) AND is where
 * any padding lands — it applies to the gradient box directly so inner content
 * is padded normally. Shadow is rendered without `overflow: hidden` (which
 * would drop the iOS shadow); the optional accent strip rounds its own left
 * corners to match instead of relying on clipping.
 */
import React from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { tokens } from '@/src/theme/tokens';

const SHADOW = {
  sm: tokens.shadows.shadowSm,
  md: tokens.shadows.shadowMd,
  lg: tokens.shadows.shadowLg,
  none: undefined,
} as const;

interface PaperSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius for the card. Default 20. */
  radius?: number;
  /** Render a thin vertical brand accent strip on the left edge. */
  accent?: boolean;
  /** Override the accent strip color (defaults to brand green). */
  accentColor?: string;
  /** Elevation depth. Default 'lg' for floating popups; 'none' to drop it. */
  shadow?: keyof typeof SHADOW;
}

export function PaperSurface({
  children,
  style,
  radius = 20,
  accent = false,
  accentColor,
  shadow = 'lg',
}: PaperSurfaceProps) {
  return (
    <LinearGradient
      colors={tokens.gradients.paper}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={[
        { borderRadius: radius, borderWidth: 1, borderColor: tokens.colors.border },
        SHADOW[shadow],
        style,
      ]}
    >
      {accent ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            backgroundColor: accentColor ?? tokens.colors.primary,
            borderTopLeftRadius: radius,
            borderBottomLeftRadius: radius,
          }}
        />
      ) : null}
      {children}
    </LinearGradient>
  );
}
