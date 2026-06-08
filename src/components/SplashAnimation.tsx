import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Splash animation — bag-tip → letters spill out → "Barakeat".
//
// Timeline:
//   1. Bag appears at the visual screen centre, upright.
//   2. Bag slides left to its final composition slot.
//   3. Bag tips 90° clockwise. The handles stay outlined throughout —
//      no fill swap, so the silhouette stays consistent.
//   4. As the bag is tipping, the letters of "arakeat" spill OUT of it
//      one by one. Each letter starts at the bag's centre with opacity 0,
//      then fades in while travelling in a slow arc to its final
//      position on the right of the bag — bouncing up and tumbling
//      through a full 360° flip on the way.
//   5. Overlay fades out.
//
// Every driver is transform/opacity only with useNativeDriver=true so
// the whole timeline runs on the UI thread — smooth on Android.

const FG_COLOR = '#e3ff5c';
const BG_COLOR = '#114b3c';
const SUFFIX = 'arakeat';
const LETTER_FONT_SIZE = 44;

// ── Bag SVG dimensions ───────────────────────────────────────────────────
// Pre-rot ≈ post-rot (close-to-square 60×62 ↔ 62×60) so the bag does not
// visually shrink across the tip.
const BAG_TOP_W = 56;
const BAG_BOT_W = 60;
const BAG_BODY_H = 32;
const HANDLE_H = 30;
const STROKE = 3;
const SVG_W = BAG_BOT_W;
const SVG_H = BAG_BODY_H + HANDLE_H;

// Bag geometry — handles ~24 px wide, 4 px middle gap → post-rot the
// two bumps read as one connected B.
const topLeftX = (BAG_BOT_W - BAG_TOP_W) / 2;
const topRightX = topLeftX + BAG_TOP_W;
const handle1L = topLeftX + 2;
const handle1R = topLeftX + 26;
const handle2L = topRightX - 26;
const handle2R = topRightX - 2;
const HANDLE_PEAK = 1;

// Horizontal offset that puts the bag at the visual screen centre at the
// start (before the slide-left phase).
const SHIFT_AMOUNT = 84;

// Letter spill geometry. Each letter is initially translated LEFT by
// `spawnX = -(LETTER_SPAWN_X_BASE + i * LETTER_SPAWN_X_STEP)` so its
// starting visual position coincides with the bag's centre. Tuned for
// the rendered width of "arakeat" at fontSize 44 / Poppins Bold.
const LETTER_SPAWN_X_BASE = 44;
const LETTER_SPAWN_X_STEP = 22;
// How high the letters arc above their final position mid-flight.
const LETTER_ARC_PEAK = 38;

// ── Timeline (ms) ────────────────────────────────────────────────────────
const HOLD_CENTER = 280;
const SHIFT_DURATION = 380;
const PAUSE_BEFORE_TIP = 100;
const TIP_DURATION = 700;
// Letters start spilling shortly after the tip begins — they ARE coming
// out of the bag as it tips, not after.
const LETTERS_DELAY_INTO_TIP = 100;
const LETTER_TRAVEL_DURATION = 1050;
const LETTER_STAGGER = 150;
const FINAL_HOLD = 420;
const FADE_DURATION = 360;

const SHIFT_START = HOLD_CENTER;
const SHIFT_END = SHIFT_START + SHIFT_DURATION;
const TIP_START = SHIFT_END + PAUSE_BEFORE_TIP;
const LETTERS_START = TIP_START + LETTERS_DELAY_INTO_TIP;
const LETTERS_END = LETTERS_START + (SUFFIX.length - 1) * LETTER_STAGGER + LETTER_TRAVEL_DURATION;
const FADE_START = LETTERS_END + FINAL_HOLD;

interface SplashAnimationProps {
  onFinish: () => void;
}

function BagSvg() {
  return (
    <Svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}>
      {/* Body — slightly wider at the base. */}
      <Path
        d={`M ${topLeftX} ${HANDLE_H} L ${topRightX} ${HANDLE_H} L ${BAG_BOT_W - 1} ${SVG_H - 1} L 1 ${SVG_H - 1} Z`}
        stroke={FG_COLOR}
        strokeWidth={STROKE}
        fill="none"
        strokeLinejoin="round"
      />
      {/* Rim-fold ticks at each top corner. */}
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
      {/* Outlined handles — kept outlined throughout the animation. */}
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
  // 0 → 1: bag slides from screen centre to its left composition slot.
  const positionProgress = useRef(new Animated.Value(0)).current;
  // 0 → 1: bag rotates 0° → 90° CW.
  const tipProgress = useRef(new Animated.Value(0)).current;
  // 0 → 1: per-letter spill progress (drives X / Y / rotate / opacity).
  const letterAnims = useRef(
    SUFFIX.split('').map(() => new Animated.Value(0))
  ).current;

  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const shiftAnim = Animated.timing(positionProgress, {
      toValue: 1,
      duration: SHIFT_DURATION,
      delay: SHIFT_START,
      useNativeDriver: true,
      easing: Easing.inOut(Easing.cubic),
    });

    const tipAnim = Animated.timing(tipProgress, {
      toValue: 1,
      duration: TIP_DURATION,
      delay: TIP_START,
      useNativeDriver: true,
      easing: Easing.inOut(Easing.cubic),
    });

    // One timing per letter — soft ease-out at the landing.
    const perLetter = letterAnims.map((anim, i) =>
      Animated.timing(anim, {
        toValue: 1,
        duration: LETTER_TRAVEL_DURATION,
        delay: LETTERS_START + i * LETTER_STAGGER,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      })
    );

    const fadeAnim = Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: FADE_DURATION,
      delay: FADE_START,
      useNativeDriver: true,
    });

    Animated.parallel([shiftAnim, tipAnim, ...perLetter, fadeAnim]).start(({ finished }) => {
      if (finished) onFinish();
    });
  }, []);

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
        {/* Bag wrapper — fixed dimensions match the POST-rotation bounding
            box so the row's flex layout doesn't reflow during the tip. */}
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
            const anim = letterAnims[i];
            const spawnX = -(LETTER_SPAWN_X_BASE + i * LETTER_SPAWN_X_STEP);
            return (
              <Animated.Text
                key={`splash-letter-${i}`}
                style={[
                  styles.letter,
                  {
                    // Fade in over the first 15 % of travel — letter
                    // appears as it leaves the bag silhouette.
                    opacity: anim.interpolate({
                      inputRange: [0, 0.15, 1],
                      outputRange: [0, 1, 1],
                    }),
                    transform: [
                      // Spill horizontally: spawn at the bag, slide to
                      // the letter's final layout slot.
                      {
                        translateX: anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [spawnX, 0],
                        }),
                      },
                      // Bounce in an arc — peak at mid-flight, settle
                      // gently at the end.
                      {
                        translateY: anim.interpolate({
                          inputRange: [0, 0.25, 0.5, 0.75, 1],
                          outputRange: [
                            0,
                            -LETTER_ARC_PEAK * 0.75,
                            -LETTER_ARC_PEAK,
                            -LETTER_ARC_PEAK * 0.55,
                            0,
                          ],
                        }),
                      },
                      // One full slow tumble while travelling.
                      {
                        rotate: anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
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
    // Align bottoms — the bag wrapper's bottom is the bottom edge of the
    // post-tip "B", and we want the letter glyph baselines to sit on that
    // same line. The translateY on lettersRow below pushes the line down
    // by the font's descender padding so the visible glyph bottom hits
    // the bag bottom precisely instead of sitting ~13 px above it.
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
    // ≈ lineHeight − Poppins baseline offset (46.2 − 33). Shifts the row
    // visually down so each letter's baseline lands on the bag bottom.
    transform: [{ translateY: 13 }],
  },
  letter: {
    fontSize: LETTER_FONT_SIZE,
    fontWeight: '700',
    color: FG_COLOR,
    fontFamily: 'Poppins_700Bold',
    lineHeight: LETTER_FONT_SIZE * 1.05,
    // Android adds extra clearance for diacritics inside the lineHeight
    // box, which on Android pushes the glyph baseline lower than iOS for
    // the same lineHeight value. Without this, the bag (whose position
    // doesn't depend on font metrics) appeared offset upwards relative
    // to the text on Android. Disabling fontPadding aligns Android glyph
    // metrics with iOS so the baseline-to-bag-bottom alignment is
    // consistent across platforms.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
