import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Zap, X } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { cancelReservation } from '@/src/services/reservations';
import { getErrorMessage } from '@/src/lib/api';
import { StatusBar } from 'expo-status-bar';

const CANCEL_REASONS = [
  { key: 'changed_mind', label: 'J\'ai changé d\'avis' },
  { key: 'cant_make_it', label: 'Je ne peux pas me déplacer' },
  { key: 'ordered_mistake', label: 'Commandé par erreur' },
  { key: 'emergency', label: 'Urgence' },
  { key: 'other', label: 'Autre' },
];

export default function CancelReservationScreen() {
  const params = useLocalSearchParams<{
    reservationId?: string;
    quantity?: string;
    locationId?: string;
    merchantName?: string;
    xpLoss?: string;
    levelBefore?: string;
    levelAfter?: string;
  }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const reservationId = params.reservationId ?? '';
  const quantity = Number(params.quantity ?? 0);
  const locationId = params.locationId ?? '';
  const xpLoss = Number(params.xpLoss ?? 0);
  const levelBefore = Number(params.levelBefore ?? 0);
  const levelAfter = Number(params.levelAfter ?? 0);

  const [reason, setReason] = useState('');
  const [otherText, setOtherText] = useState('');
  const [done, setDone] = useState(false);
  const xpLossAnim = useRef(new Animated.Value(0)).current;

  const mutation = useMutation({
    mutationFn: (r: string) => cancelReservation(reservationId, r),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gamification-stats'] });
      if (locationId) {
        void queryClient.invalidateQueries({ queryKey: ['location', locationId] });
        void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', locationId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      // Favorites tab reads a flat ['baskets'] list, and cancelling a credits-paid order
      // refunds the wallet — invalidate both so the basket count and balance refresh immediately.
      void queryClient.invalidateQueries({ queryKey: ['baskets'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      setDone(true);
      xpLossAnim.setValue(0);
      Animated.spring(xpLossAnim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
    },
  });

  useEffect(() => {
    if (done) {
      const to = setTimeout(() => router.back(), 2400);
      return () => clearTimeout(to);
    }
  }, [done, router]);

  const handleConfirm = () => {
    if (!reason || mutation.isPending) return;
    const finalReason = reason === 'Autre' ? (otherText.trim() || 'Other') : reason;
    mutation.mutate(finalReason);
  };

  if (!reservationId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: theme.colors.textSecondary }}>Reservation introuvable</Text>
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <StatusBar style="dark" />
        <Animated.View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 32,
            transform: [{ scale: xpLossAnim }],
            opacity: xpLossAnim,
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: theme.colors.error + '15',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <X size={32} color={theme.colors.error} />
          </View>
          <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700' as const, textAlign: 'center' }}>
            {t('orders.orderCancelled', { defaultValue: 'Commande annulée' })}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <Zap size={16} color={theme.colors.error} />
            <Text style={{ color: theme.colors.error, ...theme.typography.body, fontWeight: '700' as const }}>
              −{xpLoss} XP
            </Text>
            {levelAfter < levelBefore && (
              <>
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body }}>·</Text>
                <Text style={{ color: theme.colors.error, ...theme.typography.bodySm, fontWeight: '600' as const }}>
                  Level {levelBefore} → {levelAfter}
                </Text>
              </>
            )}
          </View>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 8, textAlign: 'center' }}>
            {t('orders.cancelBasketReturned', { defaultValue: 'Le panier a été rendu au commerce' })}
          </Text>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <StatusBar style="dark" />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {t('orders.cancelReasonTitle', { defaultValue: 'Pourquoi annulez-vous ?' })}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 300 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {CANCEL_REASONS.map((r) => (
            <TouchableOpacity
              key={r.key}
              onPress={() => setReason(r.label)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingVertical: 14, paddingHorizontal: 16,
                borderRadius: 12, marginBottom: 8,
                backgroundColor: reason === r.label ? theme.colors.primary + '12' : theme.colors.surface,
                borderWidth: 1.5,
                borderColor: reason === r.label ? theme.colors.primary : theme.colors.divider,
              }}
            >
              <View style={{
                width: 20, height: 20, borderRadius: 10, borderWidth: 2,
                borderColor: reason === r.label ? theme.colors.primary : theme.colors.divider,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {reason === r.label && (
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }} />
                )}
              </View>
              <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, flex: 1 }}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}

          {reason === 'Autre' && (
            <TextInput
              value={otherText}
              onChangeText={setOtherText}
              multiline
              maxLength={200}
              placeholder={t('orders.cancelReasonPlaceholder', { defaultValue: 'Dites-nous en plus...' })}
              placeholderTextColor={theme.colors.muted}
              style={{
                borderWidth: 1, borderColor: theme.colors.divider,
                borderRadius: 12, padding: 14,
                color: theme.colors.textPrimary,
                backgroundColor: theme.colors.surface,
                fontSize: 14, lineHeight: 20,
                minHeight: 100, textAlignVertical: 'top',
                marginTop: 8, marginBottom: 8,
              }}
            />
          )}

          {mutation.isError ? (
            <Text style={{ color: theme.colors.error, ...theme.typography.caption, marginTop: 8 }}>
              {getErrorMessage(mutation.error)}
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={handleConfirm}
            disabled={!reason || mutation.isPending}
            style={{
              backgroundColor: !reason ? theme.colors.muted : theme.colors.error,
              borderRadius: 14, paddingVertical: 14, alignItems: 'center',
              opacity: !reason ? 0.45 : 1, marginTop: 16,
            }}
          >
            {mutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: '#fff', ...theme.typography.button }}>
                {t('orders.confirmCancellation', { defaultValue: 'Confirmer l\'annulation' })}
              </Text>
            )}
          </TouchableOpacity>

          <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 12, textAlign: 'center' }}>
            −{xpLoss} XP
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
