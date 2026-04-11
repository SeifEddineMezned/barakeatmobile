import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, MessageCircle, Store, User } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchConversations, type Conversation } from '@/src/services/messages';
import { StatusBar } from 'expo-status-bar';
import { DelayedLoader } from '@/src/components/DelayedLoader';

export default function MessagesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const isBusiness = user?.role === 'business';

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const conversations = conversationsQuery.data ?? [];

  const renderItem = ({ item }: { item: Conversation }) => {
    const otherName = isBusiness ? item.buyer_name : (item.org_name ?? item.business_name);
    const otherImage = item.org_image;
    const hasUnread = item.unread_count > 0;
    const isClosed = item.status === 'closed' || item.status === 'blocked';

    return (
      <TouchableOpacity
        onPress={() => router.push(`/message/${item.id}` as never)}
        style={{
          flexDirection: 'row', alignItems: 'center', padding: 16,
          borderBottomWidth: 1, borderBottomColor: theme.colors.divider,
          backgroundColor: hasUnread ? theme.colors.primary + '08' : 'transparent',
        }}
        activeOpacity={0.7}
      >
        {otherImage ? (
          <Image source={{ uri: otherImage }} style={{ width: 48, height: 48, borderRadius: 24 }} />
        ) : (
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.primary + '15', justifyContent: 'center', alignItems: 'center' }}>
            {isBusiness ? <User size={22} color={theme.colors.primary} /> : <Store size={22} color={theme.colors.primary} />}
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 15, fontWeight: hasUnread ? '700' : '500', flex: 1 }} numberOfLines={1}>
              {otherName ?? t('messages.unknownUser', { defaultValue: 'Utilisateur' })}
            </Text>
            {isClosed && (
              <View style={{ backgroundColor: theme.colors.muted + '20', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
                  {item.status === 'blocked' ? t('messages.blocked', { defaultValue: 'Bloqué' }) : t('messages.closed', { defaultValue: 'Fermé' })}
                </Text>
              </View>
            )}
          </View>
          <Text style={{ color: hasUnread ? theme.colors.textPrimary : theme.colors.textSecondary, fontSize: 13, marginTop: 3, fontWeight: hasUnread ? '600' : '400' }} numberOfLines={1}>
            {item.last_message ?? '...'}
          </Text>
        </View>
        {hasUnread && (
          <View style={{ backgroundColor: theme.colors.primary, borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6, marginLeft: 8 }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{item.unread_count}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h2, flex: 1, marginLeft: 12 }}>
          {t('messages.title', { defaultValue: 'Messages' })}
        </Text>
      </View>

      {conversationsQuery.isLoading ? (
        <DelayedLoader />
      ) : conversations.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <MessageCircle size={48} color={theme.colors.muted} />
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, textAlign: 'center', marginTop: 16 }}>
            {t('messages.empty', { defaultValue: 'Aucun message pour le moment.' })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
});
