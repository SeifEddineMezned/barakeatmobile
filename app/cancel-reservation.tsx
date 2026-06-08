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
import { ChevronLeft, Zap, X, Check } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { cancelReservation, fetchMyReservations } from '@/src/services/reservations';
import { getErrorMessage } from '@/src/lib/api';
import { useOrdersStore } from '@/src/stores/ordersStore';
import { useHeroStore } from '@/src/stores/heroStore';
import { StatusBar } from 'expo-status-bar';

// Each entry's `key` is what we ship to the backend so the notification can
// be re-translated client-side in the recipient's locale (the previous code
// shipped the French label verbatim — a business user on the English app
// would see "Autre" rather than "Other"). The fallback default label is the
// French copy so the picker degrades gracefully if a translation is missing.
const CANCEL_REASONS = [
  { key: 'changed_mind', defaultLabel: "J'ai changé d'avis" },
  { key: 'cant_make_it', defaultLabel: 'Je ne peux pas me déplacer' },
  { key: 'ordered_mistake', defaultLabel: 'Commandé par erreur' },
  { key: 'emergency', defaultLabel: 'Urgence' },
  { key: 'other', defaultLabel: 'Autre' },
];

// Business-side presets. Keys mirror `business.orders.cancelReasons.*` so the
// buyer's notification and the business "issues" card can both re-translate
// the chosen reason into the reader's locale (see formatMotif / NotificationDetail).
const BUSINESS_CANCEL_REASONS = [
  { key: 'out_of_stock', defaultLabel: 'Rupture de stock' },
  { key: 'closing_early', defaultLabel: 'Fermeture imprévue' },
  { key: 'pricing_error', defaultLabel: 'Erreur de prix' },
  { key: 'cannot_prepare', defaultLabel: 'Impossible de préparer le panier' },
  { key: 'other', defaultLabel: 'Autre' },
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
    /** 'business' switches the screen to the partner-cancellation variant:
     *  business reason presets, no XP penalty, business-side cache refresh. */
    mode?: string;
  }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const isBusiness = params.mode === 'business';
  const REASONS = isBusiness ? BUSINESS_CANCEL_REASONS : CANCEL_REASONS;
  const reasonNs = isBusiness ? 'business.orders.cancelReasons' : 'orders.cancelReasons';

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

  // Shared "the cancellation is committed" path — runs on a normal success AND
  // on the recovery path when a network/timeout error turns out to have gone
  // through server-side. Idempotent: safe to run once.
  const finishAsCancelled = () => {
    if (locationId) {
      void queryClient.invalidateQueries({ queryKey: ['location', locationId] });
      void queryClient.invalidateQueries({ queryKey: ['baskets-by-location', locationId] });
    }
    void queryClient.invalidateQueries({ queryKey: ['locations'] });
    void queryClient.invalidateQueries({ queryKey: ['baskets'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    if (isBusiness) {
      // Business surfaces: refresh the incoming/past order lists and stats so
      // the cancelled row disappears and dashboards re-total immediately.
      void queryClient.invalidateQueries({ queryKey: ['today-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['location-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['business-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['business-analytics'] });
    } else {
      // Customer surfaces: gamification (XP penalty) + the buyer's orders list.
      void queryClient.invalidateQueries({ queryKey: ['gamification-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      // Tell the orders tab to reset its scroll when it regains focus (the
      // removed card otherwise leaves a stale offset that snaps on first touch).
      useOrdersStore.getState().requestScrollReset();
      // Same for the search feed's hero (stale collapsed scroll → white hero).
      useHeroStore.getState().requestScrollReset();
    }
    setDone(true);
    xpLossAnim.setValue(0);
    Animated.spring(xpLossAnim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }).start();
  };

  const mutation = useMutation({
    mutationFn: (r: string) => cancelReservation(reservationId, r),
    onSuccess: () => finishAsCancelled(),
    onError: async (err: any) => {
      // The cancel DELETE does inline notification fan-out; a slow network can
      // time out / drop the connection AFTER the server already cancelled the
      // row. Showing "pas de connexion" then is wrong — the order IS cancelled.
      // Before surfacing the error, verify: if the reservation is now gone or
      // marked cancelled, treat it as the success it actually was.
      const raw = String(err?.message ?? '').toLowerCase();
      const status = err?.response?.status ?? err?.status;
      const looksNetworkOrTimeout =
        status == null
        || raw.includes('network')
        || raw.includes('timeout')
        || raw.includes('connexion')
        || raw.includes('failed to fetch');
      // The ghost-cancellation recovery verifies via the buyer-only
      // /my/reservations endpoint, which 403s for business users — skip it in
      // business mode and surface the error directly.
      if (looksNetworkOrTimeout && !isBusiness) {
        try {
          const list = await fetchMyReservations();
          const target = list.find((r: any) => String(r.id) === String(reservationId));
          const st = String((target as any)?.status ?? '').toLowerCase();
          const isCancelled = !target || st === 'cancelled' || st === 'canceled';
          if (isCancelled) {
            console.log('[Cancel] Recovered ghost-cancellation:', reservationId);
            finishAsCancelled();
            return;
          }
        } catch (verifyErr) {
          console.log('[Cancel] Recovery verify failed:', verifyErr);
        }
      }
      // Genuine failure — react-query keeps mutation.isError, the form shows it.
    },
  });

  useEffect(() => {
    if (done) {
      const to = setTimeout(() => router.back(), 2400);
      return () => clearTimeout(to);
    }
  }, [done, router]);

  // 'other' requires the user to type a description — falling back to the
  // bare key would leave the business with no context. The disable state on
  // the button below mirrors this so the user gets visual feedback before
  // they try to submit.
  const otherRequiresText = reason === 'other' && otherText.trim().length === 0;

  const handleConfirm = () => {
    if (!reason || mutation.isPending) return;
    if (otherRequiresText) return;
    // Ship a serialised payload so the backend can store both the canonical
    // key (used by the front-end to re-translate the label in any locale)
    // and the user's free-text description (only meaningful for 'other').
    // The cancel endpoint still treats this as an opaque string, so it
    // round-trips through the notifications.message JSON unchanged.
    const payload = reason === 'other'
      ? JSON.stringify({ key: 'other', note: otherText.trim() })
      : JSON.stringify({ key: reason });
    mutation.mutate(payload);
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
          {/* XP penalty is a customer-only mechanic — the business pays no XP. */}
          {!isBusiness && (
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
          )}
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 8, textAlign: 'center' }}>
            {isBusiness
              ? t('business.orders.cancelCustomerNotified', { defaultValue: 'Le client a été notifié et remboursé si nécessaire.' })
              : t('orders.cancelBasketReturned', { defaultValue: 'Le panier a été rendu au commerce' })}
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
          {isBusiness
            ? t('business.orders.cancelReasonTitle', { defaultValue: 'Pourquoi annulez-vous cette commande ?' })
            : t('orders.cancelReasonTitle', { defaultValue: 'Pourquoi annulez-vous ?' })}
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
          {/* Reason chips — label on the left, a filled check pill on the
              right when selected (no leading radio dot). The whole row tints
              and its border turns primary on selection, so it reads as a
              modern selectable card rather than a stock radio list. */}
          {REASONS.map((r) => {
            const label = t(`${reasonNs}.${r.key}`, { defaultValue: r.defaultLabel });
            const selected = reason === r.key;
            return (
              <TouchableOpacity
                key={r.key}
                onPress={() => setReason(r.key)}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 16, paddingHorizontal: 16,
                  borderRadius: 16, marginBottom: 10,
                  backgroundColor: selected ? theme.colors.primary + '0F' : theme.colors.surface,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.primary : theme.colors.divider,
                }}
              >
                <Text style={{
                  color: theme.colors.textPrimary,
                  ...theme.typography.bodySm,
                  fontFamily: selected ? 'Poppins_600SemiBold' : 'Poppins_400Regular',
                  flex: 1,
                }}>
                  {label}
                </Text>
                {selected ? (
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Check size={14} color="#fff" strokeWidth={3} />
                  </View>
                ) : (
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: theme.colors.divider }} />
                )}
              </TouchableOpacity>
            );
          })}

          {reason === 'other' && (
            <>
              <TextInput
                value={otherText}
                onChangeText={setOtherText}
                multiline
                maxLength={200}
                placeholder={isBusiness
                  ? t('business.orders.cancelReasonPlaceholder', { defaultValue: 'Décrivez le motif…' })
                  : t('orders.cancelReasonPlaceholder', { defaultValue: 'Dites-nous en plus...' })}
                placeholderTextColor={theme.colors.muted}
                style={{
                  borderWidth: 1.5,
                  // Red outline when the user has selected 'Autre' but left the
                  // description blank, matching the inline required-field
                  // pattern used elsewhere in the app.
                  borderColor: otherRequiresText ? theme.colors.error : theme.colors.divider,
                  borderRadius: 12, padding: 14,
                  color: theme.colors.textPrimary,
                  backgroundColor: theme.colors.surface,
                  fontSize: 14, lineHeight: 20,
                  minHeight: 100, textAlignVertical: 'top',
                  marginTop: 8, marginBottom: 8,
                }}
              />
              {otherRequiresText ? (
                <Text style={{ color: theme.colors.error, ...theme.typography.caption, marginTop: -4, marginBottom: 8 }}>
                  {t('orders.cancelReasonOtherRequired', { defaultValue: 'Veuillez préciser la raison.' })}
                </Text>
              ) : null}
            </>
          )}

          {mutation.isError ? (
            <Text style={{ color: theme.colors.error, ...theme.typography.caption, marginTop: 8 }}>
              {getErrorMessage(mutation.error)}
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={handleConfirm}
            disabled={!reason || otherRequiresText || mutation.isPending}
            style={{
              backgroundColor: (!reason || otherRequiresText) ? theme.colors.muted : theme.colors.error,
              borderRadius: 14, paddingVertical: 14, alignItems: 'center',
              opacity: (!reason || otherRequiresText) ? 0.45 : 1, marginTop: 16,
            }}
          >
            {mutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: '#fff', ...theme.typography.button }}>
                {isBusiness
                  ? t('business.orders.confirmCancel', { defaultValue: 'Annuler la commande' })
                  : t('orders.confirmCancellation', { defaultValue: 'Confirmer l\'annulation' })}
              </Text>
            )}
          </TouchableOpacity>

          {/* XP penalty footnote — customer only. */}
          {!isBusiness && (
            <Text style={{ color: theme.colors.muted, ...theme.typography.caption, marginTop: 12, textAlign: 'center' }}>
              −{xpLoss} XP
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
