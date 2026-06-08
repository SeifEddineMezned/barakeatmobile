import React, { useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Store } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMyReservations } from '@/src/services/reservations';
import { StatusBar } from 'expo-status-bar';

// Stat-detail now only handles the "commerces essayés" list. The CO2 /
// money / baskets variants were removed when Yassine asked us to lighten
// the profile UX: their detail modals now show a short encouragement
// message in-place (see profile.tsx impact.copy.*) and per-order CO2 /
// money facts live on each OrderCard. Anything that arrives here with
// type !== 'spots' is a stale deep link — we render the spots list
// regardless so the user lands somewhere sensible instead of an empty page.
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

  const title = t('profile.businessesTried', { defaultValue: 'Commerces essayés' });

  // Distinct restaurants ranked by order count.
  const listData = useMemo(() => {
    const spotMap = new Map<string, { name: string; count: number }>();
    completed.forEach((r: any) => {
      const name = r.restaurant_name ?? r.restaurant?.name ?? r.basket?.merchantName ?? '';
      if (!name) return;
      const existing = spotMap.get(name);
      if (existing) { existing.count += 1; } else { spotMap.set(name, { name, count: 1 }); }
    });
    return Array.from(spotMap.values()).sort((a, b) => b.count - a.count).map((s, i) => ({ id: String(i), ...s }));
  }, [completed]);

  const heroValue = String(listData.length);

  // Discreet log so we can spot any place still routing here with a
  // stale type — should be empty once the prior callers settle.
  React.useEffect(() => {
    if (type && type !== 'spots') {
      console.log('[StatDetail] received legacy type:', type, '— rendering spots list instead');
    }
  }, [type]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style="dark" />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {title}
        </Text>
        <Text style={{ color: theme.colors.muted, ...theme.typography.bodySm }}>
          {listData.length} {t('profile.places', { defaultValue: 'commerces' })}
        </Text>
      </View>
      <View style={{
        backgroundColor: '#114b3c',
        borderRadius: 16,
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
      }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#e3ff5c20', justifyContent: 'center', alignItems: 'center' }}>
          <Store size={22} color="#e3ff5c" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: 11,
            fontFamily: 'Poppins_600SemiBold',
            fontWeight: '600',
            letterSpacing: 0.6,
            textTransform: 'none',
            marginBottom: 4,
          }}>
            {title}
          </Text>
          <Text style={{ color: '#fff', ...theme.typography.h1 }}>
            {heroValue}
          </Text>
        </View>
      </View>
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
              <Store size={14} color="#e3ff5c" />
            </View>
            <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '600', flex: 1, marginLeft: 12 }} numberOfLines={1}>{item.name}</Text>
            <Text style={{ color: theme.colors.primary, ...theme.typography.bodySm, fontWeight: '700' }}>
              {t('profile.orderCount', { count: item.count, defaultValue: '{{count}} commande(s)' })}
            </Text>
          </View>
        )}
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
