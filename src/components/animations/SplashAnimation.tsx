import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Splash animation — bag-tip → letters spill out → "Barakeat".
//
// Reliability note (why this is rewritten as one master timeline):
//
// The previous implementation drove ten separate Animated.timing instances in
// Animated.parallel, each with its own `delay`. With useNativeDriver=true,
// every child timing is dispatched independently across the JS→native bridge.
// On cold start the JS thread is heavily loaded (font loading, store
// hydration, navigation init, query cache rehydration) and individual
// dispatches can land at varying real times — so the user could see the
// timeline desync, half-play, stall, or "catch up" in a flash before the app
// loaded. Wrapping start in InteractionManager.runAfterInteractions only
// shifted the symptom (sometimes never resolved, sometimes resolved mid-
// boot), it did not fix the underlying multi-dispatch race.
//
// New design: a SINGLE Animated.Value master goes 0→1 linearly over the full
// timeline. EVERY visible element (bag slide, bag tip, each letter's
// opacity / X / Y / rotation, overlay fade) is derived from that one master
// via .interpolate(). One Animated.timing → one native dispatch → one
// timeline → bulletproof. Per-segment easing is preserved by sampling the
// original Easing.inOut(cubic) / Easing.out(cubic) curves into multi-point
// waypoints inside each interpolation.
//
// A wall-clock safety timer also calls onFinish at TOTAL_DURATION + 1 s as a
// hard floor — covers iOS suspending the animation when the app backgrounds
// mid-splash, or any future regression in the native driver. The user is
// guaranteed to either watch the full animation or, in pathological cases,
// be released after the same amount of wall time.

const FG_COLOR = '#e3ff5c';
const BG_COLOR = '#114b3c';
const SUFFIX = 'arakeat';
const LETTER_FONT_SIZE = 44;

// ── Bag SVG dimensions ───────────────────────────────────────────────────
const BAG_TOP_W = 56;
const BAG_BOT_W = 60;
const BAG_BODY_H = 32;
const HANDLE_H = 30;
const STROKE = 3;
const SVG_W = BAG_BOT_W;
const SVG_H = BAG_BODY_H + HANDLE_H;

const topLeftX = (BAG_BOT_W - BAG_TOP_W) / 2;
const topRightX = topLeftX + BAG_TOP_W;
const handle1L = topLeftX + 2;
const handle1R = topLeftX + 26;
const handle2L = topRightX - 26;
const handle2R = topRightX - 2;
const HANDLE_PEAK = 1;

const SHIFT_AMOUNT = 84;

const LETTER_SPAWN_X_BASE = 44;
const LETTER_SPAWN_X_STEP = 22;

// ── Timeline (ms) ────────────────────────────────────────────────────────
const HOLD_CENTER = 280;
const SHIFT_DURATION = 380;
const PAUSE_BEFORE_TIP = 100;
const TIP_DURATION = 700;
const LETTERS_DELAY_INTO_TIP = 100;
const LETTER_STAGGER = 220;

interface LetterPersonality {
  arcPeak: number;        // px above the resting line at the apex
  arcPeakAt: number;      // 0..1 — where along the travel the apex falls
  rotation: number;       // total rotation, degrees (all CW)
  delayOffset: number;    // ms relative to i * LETTER_STAGGER
  duration: number;       // travel duration in ms
}
const LETTER_PERSONALITIES: ReadonlyArray<LetterPersonality> = [
  // a  r  a  k  e  a  t
  { arcPeak: 42, arcPeakAt: 0.48, rotation: 360, delayOffset:   0, duration: 1230 },
  { arcPeak: 36, arcPeakAt: 0.44, rotation: 720, delayOffset:  30, duration: 1290 },
  { arcPeak: 48, arcPeakAt: 0.52, rotation: 360, delayOffset: -20, duration: 1210 },
  { arcPeak: 32, arcPeakAt: 0.42, rotation: 720, delayOffset:  40, duration: 1270 },
  { arcPeak: 44, arcPeakAt: 0.50, rotation: 360, delayOffset:   0, duration: 1240 },
  { arcPeak: 38, arcPeakAt: 0.46, rotation: 720, delayOffset:  25, duration: 1260 },
  { arcPeak: 40, arcPeakAt: 0.54, rotation: 360, delayOffset: -15, duration: 1300 },
];

const LETTERS_BASELINE_TRANSLATE_Y = Platform.select({
  ios: 13,
  android: 5,
  default: 13,
}) as number;
// Tail timings — the fade kicks off the moment the bag is fully tipped AND
// every letter has landed. The previous 420 ms hold was just dead time after
// the visible animation completed before the fade began, which read as
// "loading lag" before the app appeared. Down to 60 ms so the eye registers
// the finished composition for a fraction of a beat before the fade carries
// it off, and the total tail (60 + 280 = 340 ms after the last letter lands)
// hands off to the app almost immediately.
const FINAL_HOLD = 60;
const FADE_DURATION = 280;

const SHIFT_START = HOLD_CENTER;
const SHIFT_END = SHIFT_START + SHIFT_DURATION;
const TIP_START = SHIFT_END + PAUSE_BEFORE_TIP;
const LETTERS_START = TIP_START + LETTERS_DELAY_INTO_TIP;
// The actual last letter to land — not LETTERS_START + (n-1)*STAGGER +
// LETTER_TRAVEL_DURATION (that ignored per-letter delayOffset/duration).
const LAST_LETTER_END = LETTER_PERSONALITIES.reduce((max, p, i) => {
  const end = LETTERS_START + i * LETTER_STAGGER + p.delayOffset + p.duration;
  return Math.max(max, end);
}, 0);
const FADE_START = LAST_LETTER_END + FINAL_HOLD;
const TOTAL_DURATION = FADE_START + FADE_DURATION;

// ── Easing samples (preserve original per-segment feel) ───────────────────
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Build a clamped 0→1 interpolation that starts at `startMs`, ends at
// `endMs`, applies `easing` between them, and stays at 0 before / 1 after.
// Used to derive every per-element progress from the single master value.
function buildSlot(
  master: Animated.Value,
  startMs: number,
  endMs: number,
  easing: (t: number) => number,
  samples = 10,
) {
  const startN = startMs / TOTAL_DURATION;
  const endN = endMs / TOTAL_DURATION;
  // inputRange must be strictly increasing. We force a tiny gap if the
  // segment is right at the start (startN === 0) so the [0, startN] flat
  // section is still monotonic.
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  if (startN > 0) {
    inputRange.push(0);
    outputRange.push(0);
  }
  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    inputRange.push(startN + t * (endN - startN));
    outputRange.push(easing(t));
  }
  return master.interpolate({
    inputRange,
    outputRange,
    extrapolate: 'clamp',
  });
}

interface SplashAnimationProps {
  onFinish: () => void;
}

function BagSvg() {
  return (
    <Svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}>
      <Path
        d={`M ${topLeftX} ${HANDLE_H} L ${topRightX} ${HANDLE_H} L ${BAG_BOT_W - 1} ${SVG_H - 1} L 1 ${SVG_H - 1} Z`}
        stroke={FG_COLOR}
        strokeWidth={STROKE}
        fill="none"
        strokeLinejoin="round"
      />
      <Path
        d={`M ${topLeftX - 1.5} ${HANDLE_H} L ${topLeftX + 3} ${HANDLE_H + 3}`}
        stroke={FG_COLOR}
        strokeWidth={STROKE - 1}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d={`M ${topRightX + 1.5} ${HANDLE_H} L ${topRightX - 3} ${HANDLE_H + 3}`}
        stroke={FG_COLOR}
        strokeWidth={STROKE - 1}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d={`M ${handle1L} ${HANDLE_H} Q ${handle1L} ${HANDLE_PEAK}, ${(handle1L + handle1R) / 2} ${HANDLE_PEAK} Q ${handle1R} ${HANDLE_PEAK}, ${handle1R} ${HANDLE_H}`}
        stroke={FG_COLOR}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d={`M ${handle2L} ${HANDLE_H} Q ${handle2L} ${HANDLE_PEAK}, ${(handle2L + handle2R) / 2} ${HANDLE_PEAK} Q ${handle2R} ${HANDLE_PEAK}, ${handle2R} ${HANDLE_H}`}
        stroke={FG_COLOR}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function SplashAnimation({ onFinish }: SplashAnimationProps) {
  // ONE master that everything else derives from. 0 → 1 over TOTAL_DURATION.
  const master = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let finished = false;
    const fire = () => {
      if (finished) return;
      finished = true;
      onFinish();
    };

    const animation = Animated.timing(master, {
      toValue: 1,
      duration: TOTAL_DURATION,
      useNativeDriver: true,
      easing: Easing.linear,
    });
    animation.start(({ finished: ok }) => {
      // ok === true when the animation reached toValue naturally. We only
      // need to fire on natural completion; the safety timer below catches
      // the case where the native driver pauses (backgrounding, view
      // detachment) and never reports completion.
      if (ok) fire();
    });

    // Wall-clock safety. Guarantees the splash dismisses no later than
    // TOTAL_DURATION + 1 s after mount, even if the native animation
    // stalls or the .start() callback never resolves. The user always
    // proceeds at the same point — no infinite splash.
    const safety = setTimeout(fire, TOTAL_DURATION + 1000);

    return () => {
      clearTimeout(safety);
      animation.stop();
    };
  }, []);

  // ── Derived per-element progress (all natively-driven via master) ──────
  const positionProgress = buildSlot(master, SHIFT_START, SHIFT_END, easeInOutCubic);
  const tipProgress = buildSlot(master, TIP_START, TIP_START + TIP_DURATION, easeInOutCubic);
  const overlayOpacity = master.interpolate({
    inputRange: [0, FADE_START / TOTAL_DURATION, 1],
    outputRange: [1, 1, 0],
    extrapolate: 'clamp',
  });

  const letterProgress = LETTER_PERSONALITIES.map((p, i) => {
    const start = LETTERS_START + i * LETTER_STAGGER + p.delayOffset;
    return buildSlot(master, start, start + p.duration, easeOutCubic);
  });

  const bagTranslateX = positionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [SHIFT_AMOUNT, 0],
  });
  const bagRotation = tipProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  });

  return (
    <Animated.View style={[styles.container, { opacity: overlayOpacity }]}>
      <View style={styles.row}>
        <View style={[styles.bagWrapper, { width: SVG_H, height: SVG_W }]}>
          <Animated.View
            style={{
              transform: [
                { translateX: bagTranslateX },
                { rotate: bagRotation },
              ],
            }}
          >
            <BagSvg />
          </Animated.View>
        </View>
        <View style={styles.lettersRow}>
          {SUFFIX.split('').map((letter, i) => {
            const anim = letterProgress[i];
            const p = LETTER_PERSONALITIES[i];
            const spawnX = -(LETTER_SPAWN_X_BASE + i * LETTER_SPAWN_X_STEP);
            const apex = p.arcPeakAt;
            const ascendMid = apex * 0.5;
            const descendMid = apex + (1 - apex) * 0.55;
            return (
              <Animated.Text
                key={`splash-letter-${i}`}
                style={[
                  styles.letter,
                  {
                    opacity: anim.interpolate({
                      inputRange: [0, 0.15, 1],
                      outputRange: [0, 1, 1],
                    }),
                    transform: [
                      {
                        translateX: anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [spawnX, 0],
                        }),
                      },
                      {
                        translateY: anim.interpolate({
                          inputRange: [0, ascendMid, apex, descendMid, 1],
                          outputRange: [
                            0,
                            -p.arcPeak * 0.72,
                            -p.arcPeak,
                            -p.arcPeak * 0.42,
                            0,
                          ],
                        }),
                      },
                      {
                        rotate: anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', `${p.rotation}deg`],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {letter}
              </Animated.Text>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bagWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lettersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 2,
    transform: [{ translateY: LETTERS_BASELINE_TRANSLATE_Y }],
  },
  letter: {
    fontSize: LETTER_FONT_SIZE,
    fontWeight: '700',
    color: FG_COLOR,
    fontFamily: 'Poppins_700Bold',
    lineHeight: LETTER_FONT_SIZE * 1.05,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
