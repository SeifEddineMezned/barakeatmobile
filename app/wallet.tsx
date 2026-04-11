import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Wallet, Gift, Users, ArrowDownLeft, ArrowUpRight, CreditCard, Star } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { fetchWallet, type WalletTransaction } from '@/src/services/wallet';
import { StatusBar } from 'expo-status-bar';
import { DelayedLoader } from '@/src/components/DelayedLoader';

const TYPE_CONFIG: Record<string, { icon: any; color: string; labelKey: string }> = {
  reward: { icon: Star, color: '#f59e0b', labelKey: 'wallet.reward' },
  referral: { icon: Users, color: '#8b5cf6', labelKey: 'wallet.referral' },
  refund: { icon: ArrowDownLeft, color: '#22c55e', labelKey: 'wallet.refund' },
  payment: { icon: ArrowUpRight, color: '#ef4444', labelKey: 'wallet.payment' },
  admin_credit: { icon: Gift, color: '#114b3c', labelKey: 'wallet.adminCredit' },
};

export default function WalletScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: fetchWallet,
    staleTime: 30_000,
  });

  const balance = walletQuery.data?.balance ?? 0;
  const transactions = walletQuery.data?.transactions ?? [];

  const renderTransaction = ({ item }: { item: WalletTransaction }) => {
    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.admin_credit;
    const Icon = cfg.icon;
    const isPositive = item.amount > 0;

    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: cfg.color + '15', justifyContent: 'center', alignItems: 'center' }}>
          <Icon size={18} color={cfg.color} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 14, fontWeight: '500' }}>
            {t(cfg.labelKey)}
          </Text>
          {item.description && (
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {item.description}
            </Text>
          )}
          <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 2 }}>
            {new Date(item.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </Text>
        </View>
        <Text style={{ color: isPositive ? '#22c55e' : theme.colors.error, fontSize: 15, fontWeight: '700' }}>
          {isPositive ? '+' : ''}{item.amount.toFixed(0)} {t('wallet.credits', { defaultValue: 'crédits' })}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {t('wallet.title')}
        </Text>
      </View>

      {walletQuery.isLoading ? (
        <DelayedLoader />
      ) : (
        <>
          {/* Balance card */}
          <View style={{ marginHorizontal: 20, marginTop: 20, backgroundColor: '#114b3c', borderRadius: 20, padding: 28, alignItems: 'center' }}>
            <Wallet size={32} color="#e3ff5c" />
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 12 }}>
              {t('wallet.balance')}
            </Text>
            <Text style={{ color: '#fff', fontSize: 36, fontWeight: '700', fontFamily: 'Poppins_700Bold', marginTop: 4 }}>
              {balance.toFixed(0)}
            </Text>
            <Text style={{ color: '#e3ff5c', fontSize: 14, fontWeight: '600', marginTop: 2 }}>{t('wallet.credits', { defaultValue: 'crédits' })}</Text>
          </View>

          {/* How to earn */}
          <View style={{ marginHorizontal: 20, marginTop: 16, backgroundColor: theme.colors.primary + '08', borderRadius: 14, padding: 16 }}>
            <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>
              {t('wallet.earnCredits')}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 }}>
              {t('wallet.earnDesc')}
            </Text>
          </View>

          {/* Transactions */}
          <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 24, marginHorizontal: 20, marginBottom: 8 }}>
            {t('wallet.history')}
          </Text>
          <FlatList
            data={transactions}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderTransaction}
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
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
