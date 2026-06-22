import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Ellipse, G, Text as SvgText, Defs, ClipPath, Rect, LinearGradient, Stop } from 'react-native-svg';

/**
 * Écran de chargement Barakeat.
 * Une auréole (halo) flotte autour d'un B lime centré, rendu en Chillax
 * Bold. Mouvement : un sweep PUREMENT VERTICAL (descendant puis remontant)
 * pendant lequel le halo n'est PAS incliné. Au moment où il revient au
 * repos au-dessus du B, il s'incline légèrement (-10°) — exactement la
 * pose du logo. Aux instants où le halo passe à proximité du B, ce
 * dernier capte un léger éclat blanc, à peine perceptible.
 */

// Tuned so the animated B + halo overlay the native splash icon
// (assets/images/barakeat_icon_ios.png) pixel-for-pixel — when the native
// splash hands off to this component, the user sees no visible jump:
//   - `bg` matches app.json's splash.backgroundColor exactly so the area
//     outside the contained icon doesn't shift hue at the handoff.
//   - `scale` was 0.38 (B + halo ~1.7× smaller than the icon's). Bumped to
//     0.65 so both the B's glyph width and the halo's ring width line up
//     with the icon at full-bleed. Stroke widths scale via `f = S / 0.84`
//     so the ring stays the same relative chunkiness.
//   - `centerY` stays at 422 — the viewBox's exact vertical midline on a
//     390×844 frame — so the B is centered on screen. (The icon's PNG has
//     the B drawn slightly below its own canvas center, but on screen the
//     user reads it as "B should be centered", which 422 delivers.)
//   - `aboveFactor` 0.75 → 0.72 (was 0.80 when centerY was lower) so the
//     halo's SETTLED y (CY − ABOVE) lands ~24 px above the B's top edge —
//     the same compact gap the icon shows.
//   - `tiltDeg` -10: matches the icon's halo tilt direction so the
//     static-icon → animated-splash handoff doesn't snap.
const CONFIG = {
  bg: '#114b3c',
  lime: '#DCF94F',
  ringGlow: '#E9FF79',
  scale: 0.65,
  centerY: 422,
  tiltDeg: -10,
  cycleMs: 2600,
  settleMs: 140,
  tiltStartFraction: 0.85,
  tiltMs: 520,
  aboveFactor: 0.72,
  belowFactor: 0.72,
  shineMax: 0.42,
  shineSigmaFactor: 0.55,
};

// Unified font name across platforms. This works because two things are now
// true together:
//   - The TTF's name table was repaired (scripts/patch-chillax-name-table.js)
//     so iOS resolves the PostScript name "Chillax-Bold" via CoreText.
//   - The font is bundled as a NATIVE asset on Android via the expo-font
//     plugin config in app.json. Android's Typeface system finds it by file
//     name (`assets/fonts/Chillax-Bold.ttf` → fontFamily "Chillax-Bold")
//     instead of having to fall back to internal-family-name lookup.
const B_FONT_FAMILY = 'Chillax-Bold';

function primaryProgress(p: number) { return (1 - Math.cos(p * 2 * Math.PI)) / 2; }
function smoothstep(t: number) { return t * t * (3 - 2 * t); }

interface BarakeatHaloSplashProps {
  onFinish?: () => void;
  durationMs?: number;
  /** Fires once the splash has painted at least one frame on screen. The
   *  parent uses this to defer expo-splash-screen.hideAsync() until the JS
   *  splash is actually visible — without this, on Android the native splash
   *  hides BEFORE the SVG halo has finished its first-frame layout, exposing
   *  the underlying Stack interface for a few frames ("I saw the dashboard
   *  before the loading screen started"). */
  onMounted?: () => void;
}

export function BarakeatHaloSplash({ onFinish, durationMs = CONFIG.cycleMs + CONFIG.settleMs, onMounted }: BarakeatHaloSplashProps) {
  const S = CONFIG.scale;
  const CX = 195, CY = CONFIG.centerY;
  const W = 200 * S, H = 238 * S;
  const halfW = W / 2;
  const rx = 1.23 * halfW, ry = rx * 0.126;
  const ABOVE = CONFIG.aboveFactor * H;
  const BELOW = CONFIG.belowFactor * H;
  const f = S / 0.84;
  const B_FONT_SIZE = 340 * S;
  const SHINE_SIGMA = CONFIG.shineSigmaFactor * H;
  // Tiny per-renderer nudge applied ONLY to the B in the live SVG. The
  // native splash PNG (generate-splash-png.js) centers the B by
  // measured bounding box via opentype.js → the bbox sits exactly on
  // (CX, CY). react-native-svg's `textAnchor="middle"` +
  // `alignmentBaseline="central"` does font-metric centering instead,
  // which lands the visual centre of "B" a hair down-and-left of the
  // bbox centre — visible as a small jump at the native→JS handoff.
  // These two values push the live B up-and-right by the same amount
  // so the two renderers agree. Halo / shine layers are unaffected;
  // only the lime + shine B glyphs use these offsets.
  const B_NUDGE_X = 2;
  const B_NUDGE_Y = -2;
  const BX = CX + B_NUDGE_X;
  const BY = CY + B_NUDGE_Y;

  const initialCy = CY - ABOVE;

  const gBackRef = useRef<any>(null);
  const gFrontRef = useRef<any>(null);
  const shineRef = useRef<any>(null);
  const raf = useRef<number | null>(null);

  const TILT_START_MS = CONFIG.cycleMs * CONFIG.tiltStartFraction;

  const onFinishRef = useRef(onFinish);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);

  // Notify parent that we've laid out AND painted at least one frame. Two
  // signals are required, in order:
  //   1. onLayout fires on the outer View → native side has measured and
  //      positioned us. Layout is final.
  //   2. After that, three RAF ticks → the renderer has had multiple
  //      chances to flush the SVG halo + clipPaths + Chillax glyph to the
  //      framebuffer. SVG on Android is rasterised on the UI thread and
  //      can lag layout by more than one frame, especially during launch
  //      when the JS/UI threads are still saturated.
  // Only then do we tell the parent it's safe to hide the native splash —
  // before that, hideAsync would expose the underlying app interface for
  // 1-3 frames, which is the "I see the app then the splash plays" bug
  // the user keeps hitting.
  const mountedReportedRef = useRef(false);
  const fireMountedSignal = React.useCallback(() => {
    if (mountedReportedRef.current) return;
    mountedReportedRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          onMounted?.();
        });
      });
    });
    // onMounted intentionally not in deps — captured once, fires once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const start = Date.now();
    const loop = () => {
      const now = Date.now() - start;
      const p = Math.min(now / CONFIG.cycleMs, 1);
      const along = -ABOVE + primaryProgress(p) * (ABOVE + BELOW);
      const cy = CY + along;
      // Tilt has THREE phases now (was: hold-at-0 then ramp-to-tiltDeg).
      //   1. Intro (0 → tiltMs): tilt fades FROM tiltDeg TO 0 — the halo
      //      "unsticks" from its settled icon pose as it begins to lift.
      //   2. Mid (tiltMs → TILT_START_MS): halo is in motion, no tilt.
      //   3. Outro (TILT_START_MS → cycleMs): tilt fades back FROM 0 TO
      //      tiltDeg as the halo settles into the icon pose again.
      // Both the first and last animation frames sit at tiltDeg, so the
      // native-splash → animated-splash handoff (and animation loop end →
      // loop start) are both seamless.
      let currentTilt: number;
      if (now < CONFIG.tiltMs) {
        const introT = now / CONFIG.tiltMs;
        currentTilt = (1 - smoothstep(introT)) * CONFIG.tiltDeg;
      } else if (now < TILT_START_MS) {
        currentTilt = 0;
      } else {
        const outroT = Math.min((now - TILT_START_MS) / CONFIG.tiltMs, 1);
        currentTilt = smoothstep(outroT) * CONFIG.tiltDeg;
      }
      const shineOpacity = CONFIG.shineMax * Math.exp(-(along * along) / (2 * SHINE_SIGMA * SHINE_SIGMA));
      gBackRef.current?.setNativeProps?.({ x: CX, y: cy, rotation: currentTilt });
      gFrontRef.current?.setNativeProps?.({ x: CX, y: cy, rotation: currentTilt });
      shineRef.current?.setNativeProps?.({ opacity: shineOpacity });
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    let fired = false;
    const dismiss = setTimeout(() => {
      if (fired) return;
      fired = true;
      onFinishRef.current?.();
    }, durationMs);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      clearTimeout(dismiss);
    };
  }, [durationMs]);

  const HaloLayers = () => (
    <>
      {/* Stroke widths bumped to match the icon (assets/images/barakeat_icon_ios.png),
          whose lime ring reads as chunky — ~50% of the ring's minor axis vs
          the splash's prior ~29%. The main lime stroke roughly doubled
          (7.5 → 14); the inner glow had to scale up in lockstep (11.5 → 18)
          so it remains visible outside the now-thicker lime ring rather than
          getting swallowed. The two outer atmospheric glows keep their
          existing thickness — they're below the lime opacity threshold so
          they read as ambient falloff regardless of the ring chunk. */}
      <Ellipse rx={rx * 1.08} ry={ry * 1.5} fill="none" stroke={CONFIG.ringGlow} strokeWidth={24 * f} strokeOpacity={0.05} />
      <Ellipse rx={rx * 1.03} ry={ry * 1.18} fill="none" stroke={CONFIG.ringGlow} strokeWidth={16 * f} strokeOpacity={0.14} />
      <Ellipse rx={rx} ry={ry} fill="none" stroke={CONFIG.ringGlow} strokeWidth={18 * f} strokeOpacity={0.34} />
      <Ellipse rx={rx} ry={ry} fill="none" stroke="url(#ringGradient)" strokeWidth={14 * f} />
      <Ellipse
        rx={rx}
        ry={ry}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2.4 * f}
        strokeOpacity={0.85}
        strokeDasharray={[rx * 1.4, rx * 10]}
        strokeDashoffset={rx * 0.6}
        strokeLinecap="round"
      />
    </>
  );

  return (
    <View
      style={[styles.fill, { backgroundColor: CONFIG.bg }]}
      onLayout={fireMountedSignal}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <Defs>
          {/* Vertical depth gradient for the B. Top edge a touch brighter
              than the base lime, bottom edge noticeably darker — mimics the
              top-down shading the icon's B carries without going to full
              3D-extrusion territory. Stops chosen so the midband still
              reads as the canonical lime; only the very top and very
              bottom 20% deviate enough to be perceptible. */}
          <LinearGradient id="bGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#EBFF85" />
            <Stop offset="0.55" stopColor={CONFIG.lime} />
            <Stop offset="1" stopColor="#B5D62A" />
          </LinearGradient>
          {/* Halo ring gradient. The icon's ring looks 3D because light
              catches the top arc and the underside falls into shadow. A
              vertical top-bright → bottom-dark gradient on the ring's
              stroke reproduces this without needing two separate halves
              (which would also need their own clip masks for the
              back/front split, defeating the existing clipPath trick). */}
          <LinearGradient id="ringGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#EEFF8C" />
            <Stop offset="0.5" stopColor={CONFIG.lime} />
            <Stop offset="1" stopColor="#9DC520" />
          </LinearGradient>
          {/* Directional shine. The halo always passes over the B from
              above, so the spilled light should brighten the top edge and
              fade toward the bottom — a uniform white overlay reads as a
              flash, not as halo glow. White is fully opaque at the top
              (where the halo hovers), fades through ~30% by mid-glyph,
              and drops to 0 well before the bottom of the B. The whole
              gradient is then multiplied by the rAF-driven `shineRef`
              opacity for the pulse-on-proximity effect. */}
          <LinearGradient id="shineGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity={0.35} />
            <Stop offset="0.85" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
          <ClipPath id="haloBack">
            <Rect x={-rx * 1.5} y={-rx} width={rx * 3} height={rx} />
          </ClipPath>
          <ClipPath id="haloFront">
            <Rect x={-rx * 1.5} y={0} width={rx * 3} height={rx} />
          </ClipPath>
        </Defs>

        <G ref={gBackRef} x={CX} y={initialCy} rotation={CONFIG.tiltDeg} originX={0} originY={0} clipPath="url(#haloBack)">
          <HaloLayers />
        </G>

        {/* NO fontWeight prop. The TTF file IS already Chillax-Bold; passing
            fontWeight="700" caused Android's ReactFontManager to look for
            `fonts/Chillax-Bold_bold.ttf` (its convention for adding the bold
            style on top of a family), find nothing, and fall back to
            Typeface.create("Chillax-Bold", BOLD) which has no match in the
            system → fallback to Roboto Bold. Roboto Bold looks superficially
            close to Chillax Bold so the splash B looked "almost right but
            different from iOS". Dropping fontWeight makes the lookup
            `fonts/Chillax-Bold.ttf` with NORMAL style — finds the bundled
            file directly. iOS doesn't care either way (CoreText resolves by
            PostScript name and ignores the synthesized weight for an already-
            bold face). */}
        <SvgText
          x={BX}
          y={BY}
          fontFamily={B_FONT_FAMILY}
          fontSize={B_FONT_SIZE}
          fill="url(#bGradient)"
          textAnchor="middle"
          alignmentBaseline="central"
        >
          B
        </SvgText>

        {/* Shine layer wrapped in a <G> rather than driven via setNativeProps
            on the SvgText directly. When SvgText.fill switched from a hex
            string to a url(#…) gradient ref, Android occasionally re-laid
            out the element a frame late and painted a brief ghost glyph at
            the SVG origin (top-left of the canvas) before snapping to
            (CX, CY) — the "shadow B at top-left" the user saw. Anchoring
            the position on a <G> (whose layout is rock-solid on both
            platforms) and putting the text at the group's local origin
            removes that race entirely. */}
        <G ref={shineRef} x={BX} y={BY} opacity={0}>
          <SvgText
            fontFamily={B_FONT_FAMILY}
            fontSize={B_FONT_SIZE}
            fill="url(#shineGradient)"
            textAnchor="middle"
            alignmentBaseline="central"
          >
            B
          </SvgText>
        </G>

        <G ref={gFrontRef} x={CX} y={initialCy} rotation={CONFIG.tiltDeg} originX={0} originY={0} clipPath="url(#haloFront)">
          <HaloLayers />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
