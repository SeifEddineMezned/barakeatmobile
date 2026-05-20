import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Store, ShoppingBag, Banknote, Leaf } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations } from '@/src/services/reservations';
import { calcCO2Saved } from '@/src/lib/impactCalculations';
import { StatusBar } from 'expo-status-bar';

export default function StatDetailScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const reservationsQuery = useQuery({
    queryKey: ['reservations'],
    queryFn: fetchMyReservations,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  const completed = useMemo(() =>
    (reservationsQuery.data ?? []).filter((r) => {
      const s = (r.status ?? '').toLowerCase();
      return s === 'collected' || s === 'completed' || s === 'picked_up';
    }),
  [reservationsQuery.data]);

  const title =
    type === 'money' ? t('profile.moneySaved')
    : type === 'co2' ? t('profile.co2Saved')
    : type === 'baskets' ? t('profile.basketsBought')
    : t('profile.businessesTried', { defaultValue: 'Commerces essayés' });

  // Build data depending on type
  const listData = useMemo(() => {
    if (type === 'spots') {
      const spotMap = new Map<string, { name: string; count: number }>();
      completed.forEach((r: any) => {
        const name = r.restaurant_name ?? r.restaurant?.name ?? r.basket?.merchantName ?? '';
        if (!name) return;
        const existing = spotMap.get(name);
        if (existing) { existing.count += 1; } else { spotMap.set(name, { name, count: 1 }); }
      });
      return Array.from(spotMap.values()).sort((a, b) => b.count - a.count).map((s, i) => ({ id: String(i), ...s }));
    }

    // For baskets, money, co2: each completed order is a row
    return completed.map((r: any, i: number) => {
      const basketName = r.basket_name ?? r.basket_type_name ?? r.basket?.name ?? '';
      const restaurantName = r.restaurant_name ?? r.restaurant?.name ?? r.basket?.merchantName ?? '';
      const date = new Date(r.created_at ?? r.createdAt ?? '').toLocaleDateString('fr-FR');
      const qty = r.quantity ?? 1;
      const original = Number(r.original_price ?? r.basket?.original_price ?? r.basket?.originalPrice ?? 0);
      const paid = Number(r.price_tier ?? r.total_price ?? r.total ?? r.basket?.price_tier ?? 0);
      const saved = Math.max(0, (original - paid) * (r.quantity ?? 1));
      const co2 = calcCO2Saved(qty);
      return { id: String(r.id ?? i), basketName, restaurantName, date, qty, saved, co2 };
    });
  }, [completed, type]);

  const renderSpotItem = ({ item }: { item: any }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
        <Store size={16} color={theme.colors.primary} />
      </View>
      <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', flex: 1, marginLeft: 12 }} numberOfLines={1}>{item.name}</Text>
      <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm }}>{t('profile.orderCount', { count: item.count, defaultValue: '{{count}} commande(s)' })}</Text>
    </View>
  );

  const renderOrderItem = ({ item }: { item: any }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: type === 'money' ? theme.colors.primary + '15' : type === 'co2' ? '#22c55e15' : theme.colors.secondary + '20', justifyContent: 'center', alignItems: 'center' }}>
        {type === 'money' ? <Banknote size={16} color={theme.colors.primary} /> : type === 'co2' ? <Leaf size={16} color="#22c55e" /> : <ShoppingBag size={16} color={theme.colors.primaryDark} />}
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600' }} numberOfLines={1}>
          {item.basketName || item.restaurantName}
        </Text>
        <Text style={{ color: theme.colors.muted, ...theme.typography.caption }}>
          {item.restaurantName && item.basketName ? `${item.restaurantName} · ` : ''}{item.date}
        </Text>
      </View>
      <Text style={{ color: type === 'money' ? '#22c55e' : type === 'co2' ? '#22c55e' : theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' }}>
        {type === 'money' ? (item.saved > 0 ? `-${item.saved.toFixed(0)} TND` : '-')
          : type === 'co2' ? `${item.co2.toFixed(1)} kg`
          : `x${item.qty}`}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {title}
        </Text>
        <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm }}>
          {listData.length} {type === 'spots' ? t('profile.places', { defaultValue: 'commerces' }) : t('profile.entries', { defaultValue: 'entrées' })}
        </Text>
      </View>
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        renderItem={type === 'spots' ? renderSpotItem : renderOrderItem}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ color: theme.colors.muted, ...theme.typography.body }}>{t('common.noData', { defaultValue: 'Aucune donnée' })}</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}
