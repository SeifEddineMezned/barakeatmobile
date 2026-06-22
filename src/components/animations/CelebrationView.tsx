import React, { useState } from 'react';
import { View, Text, Animated, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Flame, Trophy, Zap } from 'lucide-react-native';
import type { CelebrationData } from '@/src/stores/celebrationStore';

interface CelebrationViewProps {
  /** The XP / streak / level numbers the panel displays. */
  data: CelebrationData;
  /** Tap of the "Continuer" button. Parent is responsible for any teardown
   *  (closing a modal, navigating, surfacing the follow-up confirmation
   *  popup) — this component is purely presentational. */
  onContinue: () => void;
}

/**
 * Pure-presentation post-reservation "Bien joué !" celebration panel.
 *
 * Lives separately from <PostReservationCelebration/> (which wraps this in a
 * top-level <Modal/>) so the same UI can be rendered INLINE inside another
 * modal — specifically the reserve.tsx confirmation modal, which used to
 * hand off to PostReservationCelebration via setCelebration() but produced a
 * brief black frame on Android during the Modal→Modal swap (different RN
 * native windows being torn down / committed asynchronously). Rendering this
 * as a phase inside the SAME Modal eliminates that handoff entirely.
 *
 * Animations are identical to the original (flame spring, stats fade-in, XP
 * bar progress, optional level-up banner spring, optional streak row).
 */
export default function CelebrationView({ data, onContinue }: CelebrationViewProps) {
  const { t } = useTranslation();
  const [showLevelUpBanner, setShowLevelUpBanner] = useState(false);
  const flameScale = React.useRef(new Animated.Value(data.streakChanged ? 9 : 4)).current;
  const statsOpacity = React.useRef(new Animated.Value(0)).current;
  const xpBarWidth = React.useRef(new Animated.Value(data.xpProgressBefore ?? 0)).current;
  const levelUpScale = React.useRef(new Animated.Value(0)).current;
  const timersRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    // Guard against React StrictMode's double-invocation in dev — without
    // this, the flame spring + level-up phase 3 fire twice and the banner
    // briefly flips into its post-reset position.
    if (ranRef.current) return;
    ranRef.current = true;

    // Phase 1 — flame springs from huge to normal.
    Animated.spring(flameScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
      tension: 40,
    }).start();

    // Phase 2 (700 ms in) — stats fade in, XP bar animates from previous
    // progress to either the new in-level progress (no level-up) or 100 %
    // (level-up, before the phase-3 reset+refill below).
    const isLevelUp = data.levelAfter > data.levelBefore;
    const phase2 = setTimeout(() => {
      Animated.parallel([
        Animated.timing(statsOpacity, { toValue: 1, duration: 400, useNativeDriver: false }),
        isLevelUp
          ? Animated.timing(xpBarWidth, { toValue: 1, duration: 600, useNativeDriver: false })
          : Animated.timing(xpBarWidth, { toValue: data.xpProgress, duration: 900, useNativeDriver: false }),
      ]).start(() => {
        if (isLevelUp) {
          // Phase 3 — level-up banner springs in, XP bar resets to 0 and
          // refills to the new in-level progress.
          setShowLevelUpBanner(true);
          levelUpScale.setValue(0);
          Animated.spring(levelUpScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
          const phase3 = setTimeout(() => {
            xpBarWidth.setValue(0);
            Animated.timing(xpBarWidth, { toValue: data.xpProgress, duration: 700, useNativeDriver: false }).start();
          }, 400);
          timersRef.current.push(phase3);
        }
      });
    }, 700);
    timersRef.current.push(phase2);

    return () => {
      timersRef.current.forEach((id) => clearTimeout(id));
      timersRef.current = [];
      flameScale.stopAnimation();
      statsOpacity.stopAnimation();
      xpBarWidth.stopAnimation();
      levelUpScale.stopAnimation();
    };
  }, []);

  return (
    <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,75,60,0.97)', justifyContent: 'center', alignItems: 'center', padding: 28 }}>
      {data.streakChanged ? (
        <Animated.View style={{ transform: [{ scale: flameScale }], marginBottom: 12 }}>
          <Flame size={56} color="#FF6B35" fill="#FF6B35" />
        </Animated.View>
      ) : (
        <Animated.View style={{ transform: [{ scale: flameScale }], marginBottom: 12 }}>
          <Trophy size={56} color="#e3ff5c" />
        </Animated.View>
      )}

      <Animated.View style={{ opacity: statsOpacity, width: '100%', alignItems: 'center' }}>
        <Text style={{ color: '#e3ff5c', fontSize: 28, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
          {t('reserve.goodJob', { defaultValue: 'Bien joué !' })}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, fontFamily: 'Poppins_400Regular', marginTop: 4, textAlign: 'center' }}>
          {t('impact.level', { level: String(showLevelUpBanner ? data.levelAfter : data.levelBefore ?? data.levelAfter ?? 1) })}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(227,255,92,0.15)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginTop: 16 }}>
          <Zap size={16} color="#e3ff5c" />
          <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
            +{data.xpGained ?? 0} XP
          </Text>
        </View>

        <View style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, height: 14, overflow: 'hidden', marginTop: 20 }}>
          <Animated.View style={{
            height: '100%',
            backgroundColor: '#e3ff5c',
            borderRadius: 8,
            width: xpBarWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }} />
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 6, alignSelf: 'flex-end' }}>
          {data.xpInLevel ?? 0}/{data.xpBandSize ?? 50} XP
        </Text>

        {showLevelUpBanner && (
          <Animated.View style={{ transform: [{ scale: levelUpScale }], backgroundColor: 'rgba(227,255,92,0.18)', borderRadius: 16, paddingHorizontal: 24, paddingVertical: 14, marginTop: 16, alignItems: 'center' }}>
            <Text style={{ color: '#e3ff5c', fontSize: 20, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
              {t('reserve.congratsLevelUp', { defaultValue: 'Félicitations !' })}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 4, textAlign: 'center' }}>
              {t('reserve.youReachedLevel', { level: String(data.levelAfter ?? 1), defaultValue: `Vous avez atteint le niveau ${data.levelAfter ?? 1}` })}
            </Text>
          </Animated.View>
        )}

        {data.streakChanged && (data.newStreak ?? 0) > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,107,53,0.18)', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10, marginTop: 16 }}>
            <Flame size={18} color="#FF6B35" fill="#FF6B35" />
            <Text style={{ color: '#FF6B35', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              {data.newStreak} {t('streak.days', { count: data.newStreak, defaultValue: 'jours' })}
            </Text>
            <Text style={{ color: 'rgba(255,107,53,0.8)', fontSize: 13, fontFamily: 'Poppins_400Regular' }}>
              {t('streak.current', { defaultValue: 'de suite' })}
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={onContinue}
          style={{ backgroundColor: '#e3ff5c', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 48, marginTop: 28 }}
        >
          <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
            {t('common.continue', { defaultValue: 'Continuer' })}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}
