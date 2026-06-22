import React, { useState } from 'react';
import { View, Text, Modal, Animated, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Flame, Trophy, Zap } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useCelebrationStore } from '@/src/stores/celebrationStore';

/**
 * Globally-mounted post-reservation celebration modal.
 *
 * Lives in app/_layout.tsx (not (tabs)/_layout.tsx) so the modal stays on
 * screen across the reserve.tsx → /(tabs)/orders navigation transition.
 * Otherwise the celebration modal would only mount AFTER the tabs layout
 * mounts, and the user would see a brief white/black flash while the
 * reserve.tsx confirmation modal unmounts and (tabs) layout takes over.
 *
 * On dismiss, hands the order-confirmation payload to the tabs layout via
 * celebrationStore.pendingOrderConfirm — the tabs layout watches that field
 * and surfaces its own "Votre commande est confirmée !" detail popup once
 * the user is actually on /(tabs)/orders.
 */
export default function PostReservationCelebration() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const celebrationPending = useCelebrationStore((s) => s.pending);
  const clearCelebration = useCelebrationStore((s) => s.clearPending);
  const setPendingOrderConfirm = useCelebrationStore((s) => s.setPendingOrderConfirm);

  const [showCelebration, setShowCelebration] = useState(false);
  const [showLevelUpBanner, setShowLevelUpBanner] = useState(false);
  const flameScale = React.useRef(new Animated.Value(6)).current;
  const celebrationOpacity = React.useRef(new Animated.Value(0)).current;
  const statsOpacity = React.useRef(new Animated.Value(0)).current;
  const xpBarWidth = React.useRef(new Animated.Value(0)).current;
  const levelUpScale = React.useRef(new Animated.Value(0)).current;
  // Same guards as the original (tabs)/_layout implementation — see comments
  // there for the Samsung double-fire / Continue double-tap rationale.
  const celebrationTimersRef = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const celebrationLastRunRef = React.useRef<typeof celebrationPending | null>(null);
  const celebrationDismissingRef = React.useRef(false);

  React.useEffect(() => {
    if (!celebrationPending) {
      celebrationLastRunRef.current = null;
      return;
    }
    if (celebrationLastRunRef.current === celebrationPending) return;
    celebrationLastRunRef.current = celebrationPending;
    celebrationDismissingRef.current = false;

    celebrationTimersRef.current.forEach((id) => clearTimeout(id));
    celebrationTimersRef.current = [];
    flameScale.stopAnimation();
    statsOpacity.stopAnimation();
    xpBarWidth.stopAnimation();
    levelUpScale.stopAnimation();

    setShowCelebration(true);
    setShowLevelUpBanner(false);
    flameScale.setValue(celebrationPending.streakChanged ? 9 : 4);
    celebrationOpacity.setValue(1);
    statsOpacity.setValue(0);
    const startProgress = celebrationPending.xpProgressBefore ?? 0;
    xpBarWidth.setValue(startProgress);

    Animated.spring(flameScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
      tension: 40,
    }).start();

    const phase2Timer = setTimeout(() => {
      const isLevelUp = celebrationPending.levelAfter > celebrationPending.levelBefore;
      Animated.parallel([
        Animated.timing(statsOpacity, { toValue: 1, duration: 400, useNativeDriver: false }),
        isLevelUp
          ? Animated.timing(xpBarWidth, { toValue: 1, duration: 600, useNativeDriver: false })
          : Animated.timing(xpBarWidth, { toValue: celebrationPending.xpProgress, duration: 900, useNativeDriver: false }),
      ]).start(() => {
        if (isLevelUp) {
          setShowLevelUpBanner(true);
          levelUpScale.setValue(0);
          Animated.spring(levelUpScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
          const phase3Timer = setTimeout(() => {
            xpBarWidth.setValue(0);
            Animated.timing(xpBarWidth, { toValue: celebrationPending.xpProgress, duration: 700, useNativeDriver: false }).start();
          }, 400);
          celebrationTimersRef.current.push(phase3Timer);
        }
      });
    }, 700);
    celebrationTimersRef.current.push(phase2Timer);

    return () => {
      celebrationTimersRef.current.forEach((id) => clearTimeout(id));
      celebrationTimersRef.current = [];
      flameScale.stopAnimation();
      statsOpacity.stopAnimation();
      xpBarWidth.stopAnimation();
      levelUpScale.stopAnimation();
    };
  }, [celebrationPending]);

  const dismissCelebration = React.useCallback(() => {
    if (celebrationDismissingRef.current) return;
    celebrationDismissingRef.current = true;
    const confirmData = celebrationPending?.confirmData;
    Animated.timing(celebrationOpacity, { toValue: 0, duration: 250, useNativeDriver: false }).start(() => {
      setShowCelebration(false);
      setShowLevelUpBanner(false);
      Promise.resolve().then(() => {
        clearCelebration();
        void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      });
      // Hand the confirm payload to the tabs layout, which renders the
      // order-confirmed detail popup once the user is on /(tabs)/orders.
      if (confirmData) {
        setTimeout(() => {
          setPendingOrderConfirm(confirmData);
        }, 300);
      }
    });
  }, [celebrationOpacity, clearCelebration, queryClient, celebrationPending, setPendingOrderConfirm]);

  return (
    <Modal visible={showCelebration && celebrationPending != null} transparent animationType="none" onRequestClose={dismissCelebration}>
      <StatusBar style="light" />
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(17,75,60,0.97)', justifyContent: 'center', alignItems: 'center', padding: 28, opacity: celebrationOpacity }}>
        {celebrationPending?.streakChanged ? (
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
            {t('impact.level', { level: String(showLevelUpBanner ? celebrationPending?.levelAfter : celebrationPending?.levelBefore ?? celebrationPending?.levelAfter ?? 1) })}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(227,255,92,0.15)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginTop: 16 }}>
            <Zap size={16} color="#e3ff5c" />
            <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              +{celebrationPending?.xpGained ?? 0} XP
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
            {celebrationPending?.xpInLevel ?? 0}/{celebrationPending?.xpBandSize ?? 50} XP
          </Text>

          {showLevelUpBanner && (
            <Animated.View style={{ transform: [{ scale: levelUpScale }], backgroundColor: 'rgba(227,255,92,0.18)', borderRadius: 16, paddingHorizontal: 24, paddingVertical: 14, marginTop: 16, alignItems: 'center' }}>
              <Text style={{ color: '#e3ff5c', fontSize: 20, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center' }}>
                {t('reserve.congratsLevelUp', { defaultValue: 'Félicitations !' })}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 4, textAlign: 'center' }}>
                {t('reserve.youReachedLevel', { level: String(celebrationPending?.levelAfter ?? 1), defaultValue: `Vous avez atteint le niveau ${celebrationPending?.levelAfter ?? 1}` })}
              </Text>
            </Animated.View>
          )}

          {celebrationPending?.streakChanged && (celebrationPending?.newStreak ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,107,53,0.18)', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10, marginTop: 16 }}>
              <Flame size={18} color="#FF6B35" fill="#FF6B35" />
              <Text style={{ color: '#FF6B35', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                {celebrationPending.newStreak} {t('streak.days', { count: celebrationPending.newStreak, defaultValue: 'jours' })}
              </Text>
              <Text style={{ color: 'rgba(255,107,53,0.8)', fontSize: 13, fontFamily: 'Poppins_400Regular' }}>
                {t('streak.inARow', { defaultValue: 'de suite' })}
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={dismissCelebration}
            style={{ backgroundColor: '#e3ff5c', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 48, marginTop: 28 }}
          >
            <Text style={{ color: '#114b3c', fontSize: 16, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
              {t('common.continue', { defaultValue: 'Continuer' })}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
