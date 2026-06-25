import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/src/theme/ThemeProvider';

interface DelayedLoaderProps {
  /** Delay in ms before showing the animation (default 400ms) */
  delay?: number;
  /** Font size of each letter in the bouncing word */
  size?: number;
  /**
   * Wall-clock cap for the bounce. If the parent query hasn't unmounted us
   * by this point, we stop the wave and surface a "taking longer than
   * expected" message — so the user is never trapped watching the
   * animation indefinitely. Default 15 s; pass 0 to disable.
   */
  timeoutMs?: number;
  /**
   * Optional retry handler. When provided, the timeout screen shows a
   * "Réessayer" button that fires it. Without this prop the screen just
   * shows the message and the user can pull-to-refresh / navigate away.
   */
  onRetry?: () => void;
  /**
   * Force the timeout view to appear immediately, bypassing the `timeoutMs`
   * wall-clock wait. The parent passes `true` when it KNOWS the underlying
   * request has failed (e.g., React Query's `isError` flipped) — without
   * this, the user would stare at the bouncing wave for the full timeout
   * (15 s) before being told something's wrong. Pairing this with `onRetry`
   * gives the user the retry affordance the moment the failure is known.
   * Flipping back to false does NOT reset the timeout view (user has to
   * tap Réessayer to retry); typically the parent unmounts the loader on
   * success instead.
   */
  forceTimedOut?: boolean;
}

/**
 * Shows the Barakeat wordmark bouncing character-by-character (same wave
 * pattern as the reservation-confirmation modal in reserve.tsx), but only
 * after a delay. If the content loads before the delay, nothing is shown.
 *
 * After `timeoutMs` of continuous bouncing, the wave stops and a friendly
 * "taking longer than expected" message replaces it — every consumer
 * (my-baskets, dashboard, orders, business-layout, etc.) inherits the
 * escape without needing per-page changes. Optional retry button surfaces
 * if the parent passes `onRetry`.
 *
 * Color choices:
 *   • Letters render in `theme.colors.primary` (#114b3c, brand dark green)
 *     on the parent's bg (white on every current consumer). This is the
 *     opposite color scheme from reserve.tsx's confirmation modal, which
 *     uses neon lime on dark green for the same wave — the loading-screen
 *     palette needed to stay light + on-brand, not the celebratory neon.
 */
const BARAKEAT = 'Barakeat'.split('');

export function DelayedLoader({ delay = 400, size = 36, timeoutMs = 15000, onRetry, forceTimedOut = false }: DelayedLoaderProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // One Animated.Value per character so each letter can bounce on its own
  // staggered timeline. Re-uses the same shape reserve.tsx's confirmation
  // wave uses (single source of truth for "the Barakeat wave"), so future
  // tweaks to bounce height / cadence stay consistent across both.
  const letterAnims = useRef(BARAKEAT.map(() => new Animated.Value(0))).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Animation control — separate refs so we can cleanly stop both the
  // running stagger AND any pending setTimeout that would re-launch the
  // wave. runningRef gates the recursive runWave so a stale callback
  // can't restart after we've stopped (the timeout fires on the original
  // animation's completion, not on the next tick — without the gate,
  // unmount/timeout could race with a pending re-launch).
  const staggerRef = useRef<Animated.CompositeAnimation | null>(null);
  const reloopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const runWave = () => {
    if (!runningRef.current) return;
    letterAnims.forEach((a) => a.setValue(0));
    const stagger = Animated.stagger(
      80,
      letterAnims.map((anim) =>
        Animated.sequence([
          Animated.timing(anim, { toValue: -15, duration: 160, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }),
        ])
      )
    );
    staggerRef.current = stagger;
    stagger.start(({ finished }) => {
      if (!finished || !runningRef.current) return;
      // 600 ms pause between waves matches reserve.tsx so the cadence
      // reads as the same animation across the app.
      reloopTimerRef.current = setTimeout(runWave, 600);
    });
  };

  const stopWave = () => {
    runningRef.current = false;
    staggerRef.current?.stop();
    staggerRef.current = null;
    if (reloopTimerRef.current) {
      clearTimeout(reloopTimerRef.current);
      reloopTimerRef.current = null;
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      runningRef.current = true;
      runWave();
    }, delay);
    return () => {
      clearTimeout(timer);
      stopWave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  // Wall-clock escape. Once we've bounced for `timeoutMs` without being
  // unmounted by the parent (which would normally happen the instant the
  // query resolves), stop the wave and flip into the timeout view. This
  // arms only after the bounce becomes visible so the timer measures
  // "bounce time" rather than "mount time" — a fast query that resolves
  // within `delay` never starts the bounce and so never starts the timer.
  useEffect(() => {
    if (!visible || !timeoutMs) return;
    const t = setTimeout(() => {
      stopWave();
      setTimedOut(true);
    }, timeoutMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, timeoutMs]);

  // Force-timeout escape — when the parent KNOWS the request has failed
  // (e.g., React Query's `isError` flipped), surface the timeout view
  // immediately so the user gets the "Chargement plus long que prévu" +
  // Réessayer affordance without waiting out the wall-clock `timeoutMs`.
  // Skips the initial delay AND the fade-in to be maximally responsive —
  // the user already knows something's wrong by the time we get here, so
  // any further hold reads as the app being slow rather than as polish.
  useEffect(() => {
    if (!forceTimedOut) return;
    stopWave();
    setVisible(true);
    fadeAnim.setValue(1);
    setTimedOut(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceTimedOut]);

  if (!visible) return null;

  if (timedOut) {
    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim, paddingHorizontal: 32 }]}>
        {/* Static Barakeat wordmark at reduced opacity — matches the
            "this is the same app, just paused" cue the dimmed B+. used to
            give. No bounce here; the user has explicitly hit the timeout
            and a still wordmark reads as "stopped, not in progress". */}
        <View style={[styles.row, { marginBottom: 16, opacity: 0.4 }]}>
          {BARAKEAT.map((letter, i) => (
            <Text
              key={i}
              style={[styles.letter, { fontSize: size, color: theme.colors.primary }]}
            >
              {letter}
            </Text>
          ))}
        </View>
        <Text style={[styles.timeoutTitle, { color: theme.colors.textPrimary }]}>
          {t('common.loadingSlowTitle', { defaultValue: 'Chargement plus long que prévu' })}
        </Text>
        <Text style={[styles.timeoutBody, { color: theme.colors.textSecondary }]}>
          {t('common.loadingSlowBody', { defaultValue: "L'application met plus de temps que d'habitude à charger ces informations. Vérifiez votre connexion et réessayez." })}
        </Text>
        {onRetry ? (
          <TouchableOpacity
            onPress={() => {
              // Re-arm: hide the timeout view, restart the wave, and let
              // the parent re-fire its query via onRetry. If the retry
              // succeeds, the parent unmounts us; if it fails again, we'll
              // hit the same timeout and offer to retry once more.
              setTimedOut(false);
              runningRef.current = true;
              runWave();
              onRetry();
            }}
            style={{
              backgroundColor: theme.colors.primary,
              borderRadius: 14,
              paddingVertical: 12,
              paddingHorizontal: 24,
              marginTop: 18,
            }}
            accessibilityRole="button"
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontFamily: 'Poppins_700Bold', fontSize: 14 }}>
              {t('common.retry', { defaultValue: 'Réessayer' })}
            </Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <View style={styles.row}>
        {BARAKEAT.map((letter, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.letter,
              {
                fontSize: size,
                color: theme.colors.primary,
                transform: [{ translateY: letterAnims[i] }],
              },
            ]}
          >
            {letter}
          </Animated.Text>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Absolute-fill the parent (instead of `flex: 1`) so the wave's
    // centering math IGNORES any siblings — most consumers render this
    // loader alongside a header (a `<Text>{t('orders.title')}</Text>`
    // row above), and with flex:1 the loader only got the REMAINING
    // vertical space below that header. justifyContent:'center' then
    // centered within the post-header region, which read as "wave below
    // screen center" because the header had eaten the top quarter.
    //
    // Absolute fill bypasses the parent's flex chain: the loader covers
    // the entire parent (header zone included), so the wave + any
    // timeout text/retry button sit at the TRUE vertical center of
    // whatever the parent's bounds are (typically the SafeAreaView ≈
    // screen). The header text underneath still renders normally —
    // it's a sibling, not a child of this overlay, and the loader's
    // transparent background lets it show through. Wave/text are small
    // enough that they don't visually collide with a top-of-screen
    // header.
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  letter: {
    fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
  },
  timeoutTitle: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  timeoutBody: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
});
