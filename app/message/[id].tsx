import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Send, Lock, MoreVertical } from 'lucide-react-native';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchMessages, sendMessage, updateConversationStatus, createConversation, getConversationByReservation, type Message } from '@/src/services/messages';
import { StatusBar } from 'expo-status-bar';
import { DelayedLoader } from '@/src/components/DelayedLoader';
import { useCustomAlert } from '@/src/components/CustomAlert';

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string; reservationId?: string; buyerId?: string; locationId?: string }>();
  const rawId = params.id ?? '';
  const isReservationBased = rawId.startsWith('res-');
  const reservationId = isReservationBased ? rawId.replace('res-', '') : params.reservationId;
  const [resolvedConvId, setResolvedConvId] = useState<number | null>(isReservationBased ? null : Number(rawId) || null);
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const alert = useCustomAlert();
  const flatListRef = useRef<FlatList>(null);
  const [text, setText] = useState('');
  const [showMenu, setShowMenu] = useState(false);

  // Resolve conversation from reservation ID if needed
  const convLookupQuery = useQuery({
    queryKey: ['conversation-by-reservation', reservationId],
    queryFn: () => getConversationByReservation(Number(reservationId)),
    enabled: isReservationBased && !resolvedConvId,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    if (convLookupQuery.data?.id && !resolvedConvId) {
      setResolvedConvId(convLookupQuery.data.id);
    }
  }, [convLookupQuery.data]);

  const conversationId = resolvedConvId;

  const messagesQuery = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => fetchMessages(conversationId!),
    enabled: !!conversationId,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const conversation = messagesQuery.data?.conversation;
  const messages = messagesQuery.data?.messages ?? [];
  const isBusiness = user?.role === 'business';
  const isMyBusiness = conversation?.business_user_id === Number(user?.id);
  const canReply = !conversationId || conversation?.status === 'open' || (conversation?.status === 'blocked' && isMyBusiness);
  const isClosed = conversation?.status === 'closed';
  const isBlocked = conversation?.status === 'blocked';
  const otherName = isBusiness ? conversation?.buyer_name : (conversation?.org_name ?? conversation?.business_name);

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      if (conversationId) {
        const result = await sendMessage(conversationId, msg);
        return { message: result, conversationId, isNew: false };
      }
      // No conversation yet — create one (for buyer initiating first message)
      const buyerId = Number(params.buyerId || user?.id || 0);
      const result = await createConversation({
        buyer_id: buyerId,
        reservation_id: reservationId ? Number(reservationId) : undefined,
        location_id: params.locationId ? Number(params.locationId) : undefined,
        message: msg,
      });
      return { 
        message: result.message, 
        conversationId: result.conversation.id,
        conversation: result.conversation,
        isNew: true 
      };
    },
    onSuccess: (data) => {
      setText('');
      
      if (data.isNew && data.conversation) {
        setResolvedConvId(data.conversationId);
        // Pre-populate cache so the first message appears immediately
        queryClient.setQueryData(['messages', data.conversationId], {
          conversation: data.conversation,
          messages: [data.message]
        });
      }

      void queryClient.invalidateQueries({ queryKey: ['messages', data.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (reservationId) {
        void queryClient.invalidateQueries({ queryKey: ['conversation-by-reservation', reservationId] });
      }
    },
  });

  const handleSend = () => {
    if (!text.trim() || sendMutation.isPending) return;
    sendMutation.mutate(text.trim());
  };

  const handleStatusChange = async (status: 'open' | 'closed' | 'blocked') => {
    try {
      await updateConversationStatus(conversationId, status);
      void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setShowMenu(false);
      alert.showAlert(t('common.success'), status === 'closed'
        ? t('messages.conversationClosed', { defaultValue: 'Conversation fermée.' })
        : status === 'blocked'
        ? t('messages.buyerBlocked', { defaultValue: 'Le client ne peut plus répondre.' })
        : t('messages.conversationReopened', { defaultValue: 'Conversation rouverte.' }));
    } catch {
      alert.showAlert(t('common.error'), t('common.errorOccurred'));
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);
    }
  }, [messages.length]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === Number(user?.id);
    return (
      <View style={{
        alignSelf: isMe ? 'flex-end' : 'flex-start',
        maxWidth: '78%',
        marginVertical: 4,
        marginHorizontal: 12,
      }}>
        <View style={{
          backgroundColor: isMe ? '#114b3c' : theme.colors.surface,
          borderRadius: 18,
          borderBottomRightRadius: isMe ? 4 : 18,
          borderBottomLeftRadius: isMe ? 18 : 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
          ...(isMe ? {} : { borderWidth: 1, borderColor: theme.colors.divider }),
        }}>
          <Text style={{ color: isMe ? '#fff' : theme.colors.textPrimary, fontSize: 14, lineHeight: 20 }}>
            {item.text}
          </Text>
        </View>
        <Text style={{
          color: theme.colors.muted,
          fontSize: 10,
          marginTop: 3,
          alignSelf: isMe ? 'flex-end' : 'flex-start',
          marginHorizontal: 4,
        }}>
          {new Date(item.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  };

  if ((isReservationBased && convLookupQuery.isLoading) || (conversationId && messagesQuery.isLoading && !messagesQuery.data)) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
        <DelayedLoader />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={24} color={theme.colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
            {otherName ?? t('messages.title', { defaultValue: 'Messages' })}
          </Text>
          {(isClosed || isBlocked) && (
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
              {isBlocked ? t('messages.blocked', { defaultValue: 'Bloqué' }) : t('messages.closed', { defaultValue: 'Fermé' })}
            </Text>
          )}
        </View>
        {isMyBusiness && (
          <TouchableOpacity onPress={() => setShowMenu(!showMenu)} style={{ padding: 8 }}>
            <MoreVertical size={20} color={theme.colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Business menu dropdown */}
      {showMenu && isMyBusiness && (
        <View style={{ position: 'absolute', top: 60, right: 16, zIndex: 100, backgroundColor: theme.colors.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, overflow: 'hidden', elevation: 5 }}>
          {conversation?.status === 'open' && (
            <>
              <TouchableOpacity onPress={() => handleStatusChange('closed')} style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
                <Text style={{ color: theme.colors.textPrimary, fontSize: 14 }}>{t('messages.closeConversation', { defaultValue: 'Fermer la conversation' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleStatusChange('blocked')} style={{ padding: 14 }}>
                <Text style={{ color: theme.colors.error, fontSize: 14 }}>{t('messages.blockBuyer', { defaultValue: 'Bloquer le client' })}</Text>
              </TouchableOpacity>
            </>
          )}
          {(conversation?.status === 'closed' || conversation?.status === 'blocked') && (
            <TouchableOpacity onPress={() => handleStatusChange('open')} style={{ padding: 14 }}>
              <Text style={{ color: theme.colors.primary, fontSize: 14 }}>{t('messages.reopenConversation', { defaultValue: 'Rouvrir la conversation' })}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMessage}
          contentContainerStyle={{ paddingVertical: 12 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 14 }}>{t('messages.noMessages', { defaultValue: 'Aucun message.' })}</Text>
            </View>
          }
        />

        {/* Input bar */}
        {canReply ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider, backgroundColor: theme.colors.bg }}>
            <TextInput
              style={{
                flex: 1, backgroundColor: theme.colors.surface, borderRadius: 20,
                paddingHorizontal: 16, paddingVertical: 10, fontSize: 14,
                color: theme.colors.textPrimary, maxHeight: 100,
                borderWidth: 1, borderColor: theme.colors.divider,
              }}
              value={text}
              onChangeText={setText}
              placeholder={t('messages.inputPlaceholder', { defaultValue: 'Écrire un message...' })}
              placeholderTextColor={theme.colors.muted}
              multiline
              returnKeyType="default"
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!text.trim() || sendMutation.isPending}
              style={{
                backgroundColor: text.trim() ? '#114b3c' : theme.colors.divider,
                width: 42, height: 42, borderRadius: 21,
                justifyContent: 'center', alignItems: 'center', marginLeft: 8,
              }}
            >
              <Send size={18} color={text.trim() ? '#e3ff5c' : theme.colors.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: theme.colors.divider, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            <Lock size={14} color={theme.colors.muted} />
            <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
              {isClosed
                ? t('messages.conversationClosedInfo', { defaultValue: 'Cette conversation est fermée.' })
                : t('messages.blockedInfo', { defaultValue: 'Vous ne pouvez plus répondre.' })}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
