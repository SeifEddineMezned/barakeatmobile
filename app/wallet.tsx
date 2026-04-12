import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Keyboard,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  Wallet,
  Gift,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Star,
  Tag,
  CheckCircle,
  XCircle,
} from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchWallet, redeemCode, type WalletTransaction } from '@/src/services/wallet';
import { StatusBar } from 'expo-status-bar';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { isApiError } from '@/src/lib/api';

// ─── Transaction type → display config ──────────────────────────────────────

const TYPE_CONFIG: Record<string, { icon: any; color: string; labelKey: string }> = {
  reward: { icon: Star, color: '#f59e0b', labelKey: 'wallet.reward' },
  referral: { icon: Users, color: '#8b5cf6', labelKey: 'wallet.referral' },
  refund: { icon: ArrowDownLeft, color: '#22c55e', labelKey: 'wallet.refund' },
  payment: { icon: ArrowUpRight, color: '#ef4444', labelKey: 'wallet.payment' },
  admin_credit: { icon: Gift, color: '#114b3c', labelKey: 'wallet.adminCredit' },
  code_redeem: { icon: Gift, color: '#22c55e', labelKey: 'wallet.codeRedeem' },
};

// ─── Redeem Box ──────────────────────────────────────────────────────────────

type RedeemStatus = 'idle' | 'loading' | 'success' | 'error';

function RedeemBox({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<RedeemStatus>('idle');
  const [message, setMessage] = useState('');
  const inputRef = useRef<TextInput>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const showFeedback = useCallback(
    (msg: string, s: RedeemStatus) => {
      setMessage(msg);
      setStatus(s);
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    },
    [fadeAnim],
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setStatus('loading');
    setMessage('');
    try {
      const result = await redeemCode(trimmed);
      setCode('');
      showFeedback(result.message || t('wallet.redeemSuccess'), 'success');
      onSuccess();
    } catch (err: unknown) {
      let msg = t('wallet.redeemErrorGeneric');
      if (isApiError(err)) {
        const serverMsg: string = (err.data as any)?.error || err.message || '';
        if (serverMsg.includes('invalide') || serverMsg.includes('invalid')) {
          msg = t('wallet.redeemErrorInvalid');
        } else if (serverMsg.includes('expiré') || serverMsg.includes('expired')) {
          msg = t('wallet.redeemErrorExpired');
        } else if (serverMsg.includes('déjà utilisé') || serverMsg.includes('already')) {
          msg = t('wallet.redeemErrorAlreadyUsed');
        } else if (serverMsg.includes('maximum')) {
          msg = t('wallet.redeemErrorMaxUses');
        } else if (serverMsg.length > 0) {
          msg = serverMsg;
        }
      }
      showFeedback(msg, 'error');
    }
  }, [code, onSuccess, showFeedback, t]);

  const isLoading = status === 'loading';
  const canSubmit = code.trim().length > 0 && !isLoading;

  return (
    <View
      style={[
        styles.redeemCard,
        { borderColor: theme.colors.divider },
      ]}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: '#114b3c18',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 10,
          }}
        >
          <Tag size={17} color="#114b3c" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '700' }}>
            {t('wallet.redeemTitle')}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 1 }}>
            {t('wallet.redeemSubtitle')}
          </Text>
        </View>
      </View>

      {/* Input + button */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(v) => {
            setCode(v);
            if (status !== 'idle') {
              setStatus('idle');
              setMessage('');
            }
          }}
          placeholder={t('wallet.redeemPlaceholder')}
          placeholderTextColor={theme.colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={canSubmit ? handleSubmit : undefined}
          editable={!isLoading}
          style={[
            styles.redeemInput,
            {
              flex: 1,
              backgroundColor: theme.colors.bg,
              borderColor:
                status === 'error'
                  ? '#ef4444'
                  : status === 'success'
                  ? '#22c55e'
                  : theme.colors.divider,
              color: theme.colors.textPrimary,
            },
          ]}
        />
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={[styles.redeemBtn, { backgroundColor: canSubmit ? '#114b3c' : theme.colors.divider }]}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text
              style={{
                color: canSubmit ? '#e3ff5c' : theme.colors.muted,
                fontSize: 13,
                fontWeight: '700',
              }}
            >
              {t('wallet.redeemButton')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Inline feedback banner */}
      {(status === 'success' || status === 'error') && message.length > 0 ? (
        <Animated.View
          style={[
            styles.redeemFeedback,
            {
              opacity: fadeAnim,
              backgroundColor: status === 'success' ? '#22c55e18' : '#ef444418',
              borderColor: status === 'success' ? '#22c55e40' : '#ef444440',
            },
          ]}
        >
          {status === 'success' ? (
            <CheckCircle size={14} color="#22c55e" />
          ) : (
            <XCircle size={14} color="#ef4444" />
          )}
          <Text
            style={{
              color: status === 'success' ? '#15803d' : '#b91c1c',
              fontSize: 12,
              fontWeight: '500',
              flex: 1,
              marginLeft: 6,
            }}
          >
            {message}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function WalletScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    staleTime: 30_000,
  });

  const balance = walletQuery.data?.balance ?? 0;
  const transactions = walletQuery.data?.transactions ?? [];

  const handleRedeemSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
  }, [queryClient]);

  const renderTransaction = ({ item }: { item: WalletTransaction }) => {
    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.admin_credit;
    const Icon = cfg.icon;
    const amountVal = Number(item.amount) || 0;
    const isPositive = amountVal > 0;

    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 20,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.divider,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: cfg.color + '15',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Icon size={18} color={cfg.color} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '500' }}>
            {t(cfg.labelKey)}
          </Text>
          {item.description ? (
            <Text
              style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}
              numberOfLines={1}
            >
              {item.description}
            </Text>
          ) : null}
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            {new Date(item.created_at).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </Text>
        </View>
        <Text
          style={{
            color: isPositive ? '#22c55e' : theme.colors.error,
            fontSize: 15,
            fontWeight: '700',
          }}
        >
          {isPositive ? '+' : ''}
          {amountVal.toFixed(0)} {t('wallet.credits', { defaultValue: 'crédits' })}
        </Text>
      </View>
    );
  };

  // Compose the scrollable header content as ListHeaderComponent so everything
  // scrolls together (balance + how-to-earn + redeem box + history label).
  const ListHeader = (
    <>
      {/* Balance card */}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 20,
          backgroundColor: '#114b3c',
          borderRadius: 20,
          padding: 28,
          alignItems: 'center',
        }}
      >
        <Wallet size={32} color="#e3ff5c" />
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 12 }}>
          {t('wallet.balance')}
        </Text>
        <Text
          style={{
            color: '#fff',
            fontSize: 36,
            fontWeight: '700',
            fontFamily: 'Poppins_700Bold',
            marginTop: 4,
          }}
        >
          {balance.toFixed(0)}
        </Text>
        <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '600', marginTop: 2 }}>
          {t('wallet.credits', { defaultValue: 'crédits' })}
        </Text>
      </View>

      {/* How to earn */}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 16,
          backgroundColor: (theme.colors.primary ?? '#114b3c') + '08',
          borderRadius: 14,
          padding: 16,
        }}
      >
        <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>
          {t('wallet.earnCredits')}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
          {t('wallet.earnDesc')}
        </Text>
      </View>

      {/* ── Redeem box ── placed between info and history ── */}
      <RedeemBox onSuccess={handleRedeemSuccess} />

      {/* History label */}
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: 15,
          fontWeight: '700',
          marginTop: 24,
          marginHorizontal: 20,
          marginBottom: 8,
        }}
      >
        {t('wallet.history')}
      </Text>
    </>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />

      {/* Header bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.divider,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text
          style={{
            color: theme.colors.textPrimary,
            ...theme.typography.h2,
            flex: 1,
            marginLeft: 12,
          }}
        >
          {t('wallet.title')}
        </Text>
      </View>

      {walletQuery.isLoading ? (
        <DelayedLoader />
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderTransaction}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <CreditCard size={36} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontSize: 14, marginTop: 12 }}>
                {t('wallet.noTransactions')}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  redeemCard: {
    marginHorizontal: 20,
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    backgroundColor: 'transparent',
  },
  redeemInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
  redeemBtn: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  redeemFeedback: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
});
