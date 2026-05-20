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
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Hand } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useWalkthroughStore, type MeasuredKey } from '@/src/stores/walkthroughStore';
import { DemoTapHintToast } from '@/src/components/DemoTapHintToast';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;

// Conservative tooltip-content estimate. Real tooltip height varies with the
// length of the descKey copy + whether the tap-hint pill renders, but every
// rendered tooltip we have today is below this. Used purely to decide
// whether the preferred placement clears the visible viewport — so being
// slightly generous is safe (we'll just flip placements when borderline).
const ESTIMATED_TOOLTIP_HEIGHT = 220;

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
  const currentStep = useWalkthroughStore((s) => s.currentStep);
  const measuredRects = useWalkthroughStore((s) => s.measuredRects);
  const nextStep = useWalkthroughStore((s) => s.nextStep);
  const skipWalkthrough = useWalkthroughStore((s) => s.skipWalkthrough);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

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
  // use a shorter beat for first-onLayout / data-load shifts.
  const [haloReady, setHaloReady] = React.useState(false);
  const activeMeasureKey = shouldRender ? currentStep?.measureKey : null;
  React.useEffect(() => {
    if (!activeMeasureKey) { setHaloReady(false); return; }
    const isTeamScroll = activeMeasureKey === 'teamOrgCard'
      || activeMeasureKey === 'teamLocationsSection'
      || activeMeasureKey === 'teamAddLocationBtn'
      || activeMeasureKey === 'teamAddMemberBtn'
      || activeMeasureKey === 'teamMembersSection';
    const delay = isTeamScroll ? 520 : 260;
    setHaloReady(false);
    const t = setTimeout(() => setHaloReady(true), delay);
    return () => clearTimeout(t);
  }, [activeMeasureKey]);

  if (!shouldRender || !currentStep) return null;
  const rect = measuredRects[currentStep.measureKey];
  // While the host screen is still settling (push animation, auto-scroll,
  // keyboard, etc.) the rect may not yet be published. Render the dim mask
  // anyway — the user must SEE the walkthrough overlay on the create-basket
  // form, even before the halo lands. Returning null here used to make the
  // entire overlay vanish until the user backed out of the form, which is
  // the opposite of what we want.
  if (!rect || !haloReady) {
    // Render the dim mask only — either the host screen hasn't published
    // the rect yet, OR the post-step-change settling window hasn't elapsed
    // and any pending scroll/remeasure could still shift the rect. Either
    // way, drawing the halo now would jitter once the final rect lands.
    return (
      <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
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
  const safeTop = insets.top + 12;
  const safeBottom = insets.bottom + 12;
  const elementTop = rectY;
  const elementBottom = rectY + rectH;
  const fitsBelow = elementBottom + 20 + ESTIMATED_TOOLTIP_HEIGHT <= SH - safeBottom;
  const fitsAbove = elementTop - 20 - ESTIMATED_TOOLTIP_HEIGHT >= safeTop;
  let tooltipBelow = currentStep.tooltipPosition
    ? currentStep.tooltipPosition === 'bottom'
    : cy < SH / 2;
  if (tooltipBelow && !fitsBelow && fitsAbove) tooltipBelow = false;
  else if (!tooltipBelow && !fitsAbove && fitsBelow) tooltipBelow = true;
  const tooltipLeft = Math.max(16, Math.min(cx - 140, SW - 296));
  const tooltipStyle: any = tooltipBelow
    ? { position: 'absolute', top: elementBottom + 20, left: tooltipLeft, width: 280 }
    : { position: 'absolute', bottom: SH - elementTop + 20, left: tooltipLeft, width: 280 };

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
    <Animated.View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, zIndex: 9999, opacity: fadeAnim }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <Svg width={SW} height={SH} style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Path d={cutoutPath} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
        </Svg>
      </View>
      <View {...absorb} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: cY }} />
      <View {...absorb} style={{ position: 'absolute', left: 0, right: 0, top: cY + cH, bottom: 0 }} />
      <View {...absorb} style={{ position: 'absolute', top: cY, height: cH, left: 0, width: cX }} />
      <View {...absorb} style={{ position: 'absolute', top: cY, height: cH, left: cX + cW, right: 0 }} />
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: rectX, top: rectY, width: rectW, height: rectH, borderRadius: rectRadius, borderWidth: 3, borderColor: '#e3ff5c' }}
      />
      <View style={{
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
              {t('walkthrough.tapToContinue', { defaultValue: 'Appuyez sur le bouton entouré pour continuer.' })}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TouchableOpacity onPress={skipWalkthrough}>
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
      <DemoTapHintToast />
    </Animated.View>
  );
}
