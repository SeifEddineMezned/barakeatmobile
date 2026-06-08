/**
 * SubScreenWalkthroughOverlay
 *
 * Rendered on pushed Stack screens (e.g. /map-view, /business/create-basket)
 * so that walkthrough highlights appear above those screens — the layout-level
 * overlays (in (tabs)/_layout.tsx and (business)/_layout.tsx) sit underneath
 * any pushed Stack screen, so element highlights that target UI on those
 * pushed screens would otherwise be invisible.
 *
 * The host screen passes the list of measure-keys it owns. The overlay only
 * renders when the active step's measureKey is in that list. Auto-advance
 * + step transitions still happen in the layout-level overlays; this component
 * only paints the highlight + tooltip.
 */
import React from 'react';
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Hand } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useWalkthroughStore, type MeasuredKey } from '@/src/stores/walkthroughStore';
import { DemoTapHintToast } from '@/src/components/DemoTapHintToast';
import { useOverlayOriginOffset } from '@/src/components/useOverlayOriginOffset';

// Module-level values are intentionally NOT used for layout — the live
// dimensions come from `useWindowDimensions()` inside the component, so
// the overlay covers the actual window even on Pixel-6-class devices
// where the window grows after edge-to-edge initialisation.

// Initial tooltip-content estimate, used only on the very first render
// before the live onLayout measurement lands. After that, the actual
// measured height drives the placement clamp — so even tooltips with
// long FR copy + tap-hint pills stay fully inside the visible viewport
// instead of bleeding under the system nav bar.
const ESTIMATED_TOOLTIP_HEIGHT = 280;
// Minimum visible padding between the tooltip edge and the safe-area
// edge. The safe-area inset alone (insets.bottom / insets.top) just
// covers system chrome; this extra margin gives the popup visible
// breathing room from the nav bar / home indicator / status bar.
const TOOLTIP_EDGE_PADDING = 24;

function buildCutoutPath(sw: number, sh: number, x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  if (w <= 0 || h <= 0) return `M0 0 H${sw} V${sh} H0 Z`;
  const x2 = x + w;
  const y2 = y + h;
  return [
    `M0 0 H${sw} V${sh} H0 Z`,
    `M${x + radius} ${y}`,
    `H${x2 - radius}`,
    `A${radius} ${radius} 0 0 1 ${x2} ${y + radius}`,
    `V${y2 - radius}`,
    `A${radius} ${radius} 0 0 1 ${x2 - radius} ${y2}`,
    `H${x + radius}`,
    `A${radius} ${radius} 0 0 1 ${x} ${y2 - radius}`,
    `V${y + radius}`,
    `A${radius} ${radius} 0 0 1 ${x + radius} ${y}`,
    'Z',
  ].join(' ');
}

interface Props {
  /** Measure-keys this overlay handles. Renders only when current step matches. */
  keys: readonly MeasuredKey[];
}

export function SubScreenWalkthroughOverlay({ keys }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: SW, height: SH } = useWindowDimensions();
  // Self-measure the overlay's window origin so we can render in absolute
  // window coordinates. Pushed Stack screens often wrap content in
  // <SafeAreaView edges={['top']}>, which would otherwise leave halos
  // shifted by `insets.top` from the real measured rect.
  const { originRef, originX, originY, remeasure: remeasureOrigin } = useOverlayOriginOffset();
  const router = useRouter();
  const currentStep = useWalkthroughStore((s) => s.currentStep);
  const measuredRects = useWalkthroughStore((s) => s.measuredRects);
  const nextStep = useWalkthroughStore((s) => s.nextStep);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  // Quit-demo handler: clears all walkthrough state (skipWalkthrough also
  // calls `clearDemoState`, wiping demoCustomerActive/demoOrderActive flags
  // so the injected demo basket on Discover and the demo order on the
  // orders tab both disappear), THEN pops back to the Discover tab. From a
  // pushed Stack screen (/restaurant/demo, /basket/demo-basket, /reserve)
  // skipping alone leaves the user stranded on the demo page — the demo
  // data is gone but the URL still points at it.
  const handleQuit = React.useCallback(() => {
    skipWalkthrough();
    try { router.replace('/(tabs)/' as never); } catch {}
  }, [router, skipWalkthrough]);

  const shouldRender = !!currentStep && keys.includes(currentStep.measureKey);

  // Fade in once when the overlay starts handling a step, then stay at 1
  // across step-to-step transitions on the same host screen (e.g.
  // formPickupTime → formDailyReset → formConfirmBtn). Resetting to 0
  // between adjacent steps caused a visible flash that read as jitter.
  const fadedInRef = React.useRef(false);
  React.useEffect(() => {
    if (shouldRender) {
      if (!fadedInRef.current) {
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
        fadedInRef.current = true;
      }
    } else {
      fadedInRef.current = false;
    }
  }, [shouldRender]);

  // Halo settling — keyed off the measureKey changing on this host screen.
  // Hides the halo + tooltip for a short window after a step change so the
  // host's scrollTo + measureInWindow can land before we paint. Otherwise
  // the cached previous-rect briefly paints, then snaps to the freshly
  // measured position. Team sub-screen uses 520 ms to cover the explicit
  // scroll-then-remeasure cycle (60 ms + 350–450 ms); other host screens
  // use a 320 ms beat so the host's standard 280 ms clear-then-remeasure
  // cycle (see map-view's per-step effects) has fully landed before we
  // paint — this prevents the halo from briefly appearing at the previous
  // step's fallback position and then snapping when the new rect arrives.
  const [haloReady, setHaloReady] = React.useState(false);
  const activeMeasureKey = shouldRender ? currentStep?.measureKey : null;
  React.useEffect(() => {
    if (!activeMeasureKey) { setHaloReady(false); return; }
    setHaloReady(false);
    const isTeamScroll = activeMeasureKey === 'teamOrgCard'
      || activeMeasureKey === 'teamLocationsSection'
      || activeMeasureKey === 'teamAddLocationBtn'
      || activeMeasureKey === 'teamAddMemberBtn'
      || activeMeasureKey === 'teamMembersSection';
    // Defer the fast-path by 1 frame so the host screen's clear-on-step-change
    // effect (e.g. map-view's per-step setMeasuredRect(key, null)) has a
    // chance to run first. Without this, a stale rect from a previous render
    // would trip the fast-path and paint the halo at the old position for
    // one frame before the host clears + re-measures.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const haveRect = !!useWalkthroughStore.getState().measuredRects[activeMeasureKey];
      if (haveRect) { setHaloReady(true); return; }
      const delay = isTeamScroll ? 520 : 320;
      timer = setTimeout(() => { if (!cancelled) setHaloReady(true); }, delay);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (timer) clearTimeout(timer);
    };
  }, [activeMeasureKey]);

  // Measure the actual rendered tooltip height so the clamp/widen math
  // below uses the REAL size rather than a fixed estimate. Reset per
  // step so each step measures fresh.
  const [tooltipH, setTooltipH] = React.useState<number>(ESTIMATED_TOOLTIP_HEIGHT);
  React.useEffect(() => { setTooltipH(ESTIMATED_TOOLTIP_HEIGHT); }, [currentStep?.measureKey, currentStep?.titleKey]);

  // Per-step content fade — the halo ring + tooltip fade in once the rect has
  // settled (haloReady) so step-to-step transitions glide instead of popping.
  const contentAnim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => { contentAnim.setValue(0); }, [currentStep?.measureKey, contentAnim]);
  React.useEffect(() => {
    if (haloReady && shouldRender) {
      Animated.timing(contentAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    }
  }, [haloReady, shouldRender, contentAnim]);

  if (!shouldRender || !currentStep) return null;
  const measured = measuredRects[currentStep.measureKey];
  // Resolve the rect from EITHER the host's measured-rect publication OR the
  // step's `target` fallback. Without a fallback, screens whose
  // `setMeasuredRect` is racing the first paint would render just a dim mask
  // with no tooltip — the user would see "nothing happened" after tapping
  // the previous step's element (exactly the symptom users hit on the
  // /restaurant/demo screen).
  const t2 = currentStep.target;
  // Only build a fallback rect when the target actually carries a POSITION.
  // Team steps pass `target: { radius: 16 }` (no top/left/width/height) — they
  // rely entirely on the host's measured rect. Without this guard the old
  // fallback defaulted to a 44×44 box at (16,16), so the halo flashed in the
  // top-left corner while the team screen scrolled + re-measured. With no
  // positional target we return null → the overlay shows dim-only until the
  // real rect lands, then fades the halo in at the correct spot.
  const hasTargetPosition = !!t2 && (t2.top != null || t2.bottom != null || t2.left != null || t2.right != null || t2.width != null || t2.height != null);
  const fallbackRect = !measured && hasTargetPosition
    ? {
        x: t2!.right != null ? Math.max(0, SW - t2!.right - (t2!.width ?? 44)) : (t2!.left ?? 16),
        y: t2!.bottom != null ? Math.max(0, SH - t2!.bottom - (t2!.height ?? 44)) : (t2!.top ?? 16),
        w: t2!.width ?? 44,
        h: t2!.height ?? 44,
      }
    : null;
  const rect = measured ?? fallbackRect;

  // While the host screen is still settling (push animation, auto-scroll,
  // keyboard, etc.) and we have NO fallback target either, render the dim
  // mask anyway so the user knows the walkthrough is active.
  if (!rect || !haloReady) {
    return (
      <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }} onLayout={remeasureOrigin}>
        <View ref={originRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
        {/* Dim extends past the window edges by the safe-area insets so the
            status bar / nav bar area on Samsung edge-to-edge doesn't show
            through un-dimmed. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: -insets.top - 100, left: 0, right: 0, bottom: -insets.bottom - 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
      </Animated.View>
    );
  }

  // No breathing room — the halo sits flush with the measured element.
  // Previously we added 3-6px around the rect, but the user repeatedly
  // reported "extra padding under the button" on the create-basket confirm
  // CTA: even the 3px gap between the button and the halo's bottom border
  // read as unwanted padding. React Native's border is inset, so with zero
  // expansion the halo's 3px green-yellow border lands on the outer 3px of
  // the element itself — a tight outline rather than a frame around it.
  const rectX = rect.x;
  const rectY = rect.y;
  const rectW = rect.w;
  const rectH = rect.h;
  // Match the element's own corner radius. Falls back to 12 for steps that
  // don't declare a radius. Pill-shaped buttons (target.radius = 28) get a
  // pill cutout; rounded-rect cards (radius = 16) get matching corners.
  const rectRadius = currentStep.radius ?? 12;
  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;
  // Pick a placement, then verify it actually fits inside the visible
  // viewport. If not, flip to the other side. The previous logic blindly
  // honoured the step's preferred position, which was how the formConfirm
  // tooltip ended up rendered below the visible screen edge.
  // Safe-area edges include both the system inset (status bar / nav bar
  // / home indicator) AND a visible padding so the tooltip doesn't sit
  // flush against the screen edge.
  const safeTop = insets.top + TOOLTIP_EDGE_PADDING;
  const safeBottom = insets.bottom + TOOLTIP_EDGE_PADDING;
  const elementTop = rectY;
  const elementBottom = rectY + rectH;
  const tHeight = tooltipH;
  // Adaptive width — if the natural placement (below/above the element)
  // doesn't have room for a 280-wide tooltip, WIDEN it so it gets
  // shorter (text re-wraps to use the extra horizontal space). The
  // previous fix clamped the tooltip upward into the highlighted
  // element when room was tight — user complained because the tooltip
  // ended up covering the very content it was supposed to point at.
  // Wider-and-shorter is the right answer.
  const spaceBelow = (SH - safeBottom) - (elementBottom + 20);
  const spaceAbove = (elementTop - 20) - safeTop;
  const naturalSpace = Math.max(spaceBelow, spaceAbove);
  // IMPORTANT: base the widen decision on the FIXED estimate, not the live
  // measured `tHeight`. Using the measured height created a feedback loop —
  // widening reflowed the text shorter, which flipped `needsWiden` back to
  // false, which narrowed it taller, … — visible as the tooltip rapidly
  // jittering between two positions (notably on large iPad screens where the
  // 280↔360 width swing changes height the most). The estimate is constant,
  // so the width is stable; the measured height still drives the clamp below.
  const needsWiden = ESTIMATED_TOOLTIP_HEIGHT > naturalSpace;
  const tooltipWidth = Math.min(needsWiden ? 360 : 280, SW - 32);
  const GAP = 16;
  const fitsBelow = tHeight <= spaceBelow - GAP;
  const fitsAbove = tHeight <= spaceAbove - GAP;
  let tooltipBelow = currentStep.tooltipPosition
    ? currentStep.tooltipPosition === 'bottom'
    : cy < SH / 2;
  if (tooltipBelow && !fitsBelow && fitsAbove) tooltipBelow = false;
  else if (!tooltipBelow && !fitsAbove && fitsBelow) tooltipBelow = true;
  else if (!fitsBelow && !fitsAbove) tooltipBelow = spaceBelow >= spaceAbove; // neither fits → roomier side
  const tooltipLeft = Math.max(16, Math.min(cx - tooltipWidth / 2, SW - tooltipWidth - 16));
  // SHRINK, don't cover. If the tooltip is taller than the room beside the
  // element, scale it down to fit that room instead of clamping it ON TOP of
  // the highlighted card. Center-origin scale → offset layoutTop so the VISUAL
  // box sits in the gap next to the element (never overlapping it).
  const available = (tooltipBelow ? spaceBelow : spaceAbove) - GAP;
  const ttScale = tHeight > available ? Math.max(0.7, available / tHeight) : 1;
  const scaledH = tHeight * ttScale;
  const layoutTop = tooltipBelow
    ? (elementBottom + GAP) - (tHeight - scaledH) / 2
    : (elementTop - GAP) - (tHeight + scaledH) / 2;
  const tooltipStyle: any = {
    position: 'absolute',
    top: layoutTop,
    left: tooltipLeft,
    width: tooltipWidth,
    ...(ttScale < 1 ? { transform: [{ scale: ttScale }] } : null),
  };

  const cutoutPath = buildCutoutPath(SW, SH, rectX, rectY, rectW, rectH, rectRadius);
  const showNextButton = !currentStep.requireTap;
  const showTapHint = currentStep.requireTap;

  // Clamp the cutout rect so the four absorber frames around it never get
  // negative widths / heights when the highlight is near a screen edge.
  const cX = Math.max(0, rectX);
  const cY = Math.max(0, rectY);
  const cW = Math.max(0, Math.min(rectW, SW - cX));
  const cH = Math.max(0, Math.min(rectH, SH - cY));
  // Four absorber frames around the cutout — block taps on everything that
  // isn't the highlighted element (back button, photo camera, location-card
  // menus, etc.) so the user can't accidentally navigate away mid-demo.
  // The cutout area itself has no absorber → taps fall through to the real
  // element beneath. Each frame uses the responder API to consume the touch
  // (TouchableWithoutFeedback isn't enough — we want to absorb, not advance).
  const absorb = {
    onStartShouldSetResponder: () => true,
    onResponderRelease: () => { /* absorb silently — see CutoutMask. */ },
  } as const;

  return (
    <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }} onLayout={remeasureOrigin}>
      <View ref={originRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} />
      {/* Window-coords canvas — see useOverlayOriginOffset for the rationale.
          The wrapper is translated so its (0,0) matches window (0,0), and it
          is sized to the live window so `bottom:` positioning anchors to the
          actual window bottom rather than the parent's. */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: -originY, left: -originX, width: SW, height: SH }}>
      {/* Edge-to-edge dim extensions — cover the status bar (above the
          window) and the system nav bar (below the window) on Samsung
          edge-to-edge devices where useWindowDimensions() returns less
          than the full screen height. Matches the same rgba as the
          cutout SVG so the seams are invisible. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -insets.top - 100, left: 0, right: 0, height: insets.top + 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -insets.bottom - 100, left: 0, right: 0, height: insets.bottom + 100, backgroundColor: 'rgba(0,0,0,0.55)' }} />
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <Svg width={SW} height={SH} style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Path d={cutoutPath} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
        </Svg>
      </View>
      <View {...absorb} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: cY }} />
      <View {...absorb} style={{ position: 'absolute', left: 0, right: 0, top: cY + cH, bottom: 0 }} />
      <View {...absorb} style={{ position: 'absolute', top: cY, height: cH, left: 0, width: cX }} />
      <View {...absorb} style={{ position: 'absolute', top: cY, height: cH, left: cX + cW, right: 0 }} />
      {/* Halo ring + tooltip fade in together once the layout has settled. */}
      <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, opacity: contentAnim }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: rectX, top: rectY, width: rectW, height: rectH, borderRadius: rectRadius, borderWidth: 3, borderColor: '#e3ff5c' }}
      />
      <View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && Math.abs(h - tooltipH) > 2) setTooltipH(h);
        }}
        style={{
        ...tooltipStyle,
        backgroundColor: '#fff', borderRadius: 20, padding: 20,
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
      }}>
        <Text style={{ color: theme.colors.muted, fontSize: 12, fontFamily: 'Poppins_500Medium', marginBottom: 10 }}>
          {currentStep.stepIndex + 1}/{currentStep.totalSteps}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#114b3c12', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
            <Hand size={22} color="#114b3c" />
          </View>
          <Text style={{ color: '#114b3c', fontSize: 17, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1 }}>
            {t(currentStep.titleKey)}
          </Text>
        </View>
        <Text style={{ color: '#666', fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, marginBottom: showTapHint ? 10 : 16 }}>
          {t(currentStep.descKey)}
        </Text>
        {showTapHint && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, backgroundColor: '#114b3c0f', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 }}>
            <Hand size={14} color="#114b3c" />
            <Text style={{ color: '#114b3c', fontSize: 12, fontFamily: 'Poppins_600SemiBold', marginLeft: 6, flex: 1 }}>
              {currentStep.tapTarget === 'card'
                ? t('walkthrough.tapCardToContinue', { defaultValue: 'Appuyez sur la carte entourée pour continuer.' })
                : t('walkthrough.tapToContinue', { defaultValue: 'Appuyez sur le bouton entouré pour continuer.' })}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={handleQuit}>
            <Text style={{ color: theme.colors.muted, fontSize: 13, fontFamily: 'Poppins_500Medium' }}>
              {t('walkthrough.exitDemo', { defaultValue: 'Quitter la démo' })}
            </Text>
          </TouchableOpacity>
          {showNextButton && (
            <TouchableOpacity
              onPress={() => nextStep(currentStep.totalSteps)}
              style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 }}
            >
              <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {currentStep.isLast ? t('walkthrough.done', { defaultValue: "C'est parti !" }) : t('walkthrough.next', { defaultValue: 'Suivant' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      </Animated.View>
      <DemoTapHintToast />
      </View>
    </Animated.View>
  );
}
