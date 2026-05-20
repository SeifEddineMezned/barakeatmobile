/**
 * Shared notification detail card — used by both the notifications page modal
 * and the in-app popup overlay. Renders the exact same UI in both places.
 */
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Linking } from 'react-native';
import { ShoppingBag, Star, XCircle, Bell, CheckCircle, Clock, MapPin, Navigation, User, MessageCircle, Zap, X as XIcon } from 'lucide-react-native';
import type { NotificationFromAPI } from '@/src/services/notifications';

function resolveNotifText(
  raw: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
  fallback = ''
): string {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.key === 'string') {
      const params = { ...(parsed.params ?? {}) };
      // Ensure 'location' param is always present — old notifications used 'locationName' instead
      if (!params.location) {
        params.location = params.locationName ?? params.restaurant ?? params.restaurantName ?? '';
      }
      const i18nKey = `notifications.${parsed.key}`;
      const translated = t(i18nKey, params);
      return translated !== i18nKey ? translated : fallback;
    }
  } catch {}
  const i18nKey = `notifications.${raw}`;
  const translated = t(i18nKey, {});
  if (translated !== i18nKey) return translated;
  // Last-resort fallback: if the caller passed a pre-translated string (e.g.
  // the demo walkthrough's notification popup), don't render blank. Render
  // the raw text itself — it's better than an empty card.
  return raw || fallback;
}

function timeAgo(dateStr: string, t: any): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return t('timeAgo.seconds', { count: diff });
  if (diff < 3600) return t('timeAgo.minutes', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('timeAgo.hours', { count: Math.floor(diff / 3600) });
  const days = Math.floor(diff / 86400);
  if (days < 7) return t('timeAgo.days', { count: days });
  if (days < 30) return t('timeAgo.weeks', { count: Math.floor(days / 7) });
  return t('timeAgo.months', { count: Math.floor(days / 30) });
}

function getNotifIcon(type?: string | null, title?: string | null) {
  const key = type ?? title ?? '';
  if (key.includes('order_confirmed') || key.includes('new_reservation'))
    return { Icon: ShoppingBag, color: '#114b3c', bg: '#114b3c18' };
  if (key.includes('basket_picked_up'))
    return { Icon: CheckCircle, color: '#22c55e', bg: '#22c55e18' };
  if (key.includes('pickup_confirmed') || key.includes('collected'))
    return { Icon: CheckCircle, color: '#22c55e', bg: '#22c55e18' };
  if (key.includes('cancelled'))
    return { Icon: XCircle, color: '#ef4444', bg: '#ef444418' };
  if (key.includes('review'))
    return { Icon: Star, color: '#f59e0b', bg: '#f59e0b18' };
  if (key.includes('message') || key.includes('reply'))
    return { Icon: MessageCircle, color: '#3b82f6', bg: '#3b82f618' };
  if (key.includes('streak'))
    return { Icon: Zap, color: '#f97316', bg: '#f9731618' };
  return { Icon: Bell, color: '#6b7280', bg: '#6b728018' };
}

interface NotificationDetailProps {
  notif: NotificationFromAPI;
  theme: any;
  t: any;
  isBusiness?: boolean;
  onClose: () => void;
  onAction?: () => void;
  /** When true, the action button gets a yellow-green halo border so the
   *  demo walkthrough can point the user at it inside the in-app popup. */
  demoHighlightAction?: boolean;
}

export function NotificationDetail({ notif, theme, t, isBusiness, onClose, onAction, demoHighlightAction }: NotificationDetailProps) {
  const { Icon, color } = getNotifIcon(notif.type, notif.title);
  const notifType = notif.type ?? '';
  const isNewReservation = notifType.includes('new_reservation') || notifType.includes('order_confirmed');
  const isCancelled = notifType.includes('cancelled');
  const isReview = notifType.includes('review');
  const isPickupConfirmed = notifType.includes('pickup_confirmed') || notifType.includes('collected');
  const titleStr = notif.title ?? '';
  const isMessage = notifType.includes('message') || notifType.includes('reply') || titleStr.includes('message') || titleStr.includes('reply');

  let msgParams: Record<string, any> = {};
  try { const parsed = JSON.parse(notif.message); if (parsed?.params) msgParams = parsed.params; } catch {}

  const basketName = msgParams.basketName ?? msgParams.basket_name ?? null;
  const locationName = msgParams.location ?? msgParams.locationName ?? msgParams.restaurantName ?? msgParams.restaurant_name ?? null;
  const customerName = msgParams.customerName ?? msgParams.customer_name ?? null;
  const pickupStart = msgParams.pickupStart ?? msgParams.pickup_start ?? null;
  const pickupEnd = msgParams.pickupEnd ?? msgParams.pickup_end ?? null;
  const pickupTime = msgParams.time ?? ((pickupStart && pickupEnd) ? `${String(pickupStart).substring(0,5)} – ${String(pickupEnd).substring(0,5)}` : null);
  const qty = msgParams.quantity ?? msgParams.qty ?? msgParams.count ?? null;
  const rating = msgParams.rating ?? null;
  const comment = msgParams.comment ?? msgParams.review ?? null;
  const price = msgParams.price ?? msgParams.total ?? msgParams.amount ?? null;
  const pickupCode = msgParams.code ?? msgParams.pickupCode ?? msgParams.pickup_code ?? null;
  const locationImage = msgParams.locationImage ?? msgParams.location_image ?? null;
  const basketImage = msgParams.basketImage ?? msgParams.basket_image ?? null;
  const notifAddress = msgParams.address ?? msgParams.restaurant_address ?? null;
  const senderName = msgParams.senderName ?? msgParams.sender_name ?? null;
  const messageText = msgParams.messageText ?? msgParams.message_text ?? null;
  const ratingService = msgParams.rating_service ?? null;
  const ratingQuality = msgParams.rating_quality ?? null;
  const ratingQuantity = msgParams.rating_quantity ?? null;
  const ratingVariety = msgParams.rating_variety ?? null;

  const hasAction = isNewReservation || isReview || isPickupConfirmed || isMessage;

  return (
    <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, width: '100%', maxWidth: 420, overflow: 'hidden', ...theme.shadows.shadowLg }}>
      {/* Neutral header with a colored left accent strip. The accent color
          comes from getNotifIcon() so the type signal is preserved without
          the bold colored-bg header. */}
      <View style={{ paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: color }} />
        <Icon size={22} color={theme.colors.textSecondary} />
        <View style={{ flex: 1 }}>
          {notif.title ? (
            <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontFamily: 'Poppins_700Bold', fontWeight: '700', letterSpacing: -0.2 }}>
              {resolveNotifText(notif.title, t)}
            </Text>
          ) : null}
          <Text style={{ color: theme.colors.muted, fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 2 }}>
            {timeAgo(notif.created_at, t)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surfaceMuted, justifyContent: 'center', alignItems: 'center' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <XIcon size={18} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
        <ScrollView showsVerticalScrollIndicator={true} style={{ maxHeight: 280 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {/* Images */}
          {(locationImage || basketImage) ? (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16, justifyContent: 'center' }}>
              {locationImage ? <Image source={{ uri: locationImage }} style={{ width: 70, height: 70, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" /> : null}
              {basketImage && basketImage !== locationImage ? <Image source={{ uri: basketImage }} style={{ width: 70, height: 70, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.divider }} resizeMode="cover" /> : null}
            </View>
          ) : isNewReservation ? (
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <Image source={require('@/assets/images/barakeat_paper_bag.png')} style={{ width: 80, height: 80, borderRadius: 16 }} resizeMode="cover" />
            </View>
          ) : null}

          {/* Message */}
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, lineHeight: 22, marginBottom: 12 }}>
            {resolveNotifText(notif.message, t)}
          </Text>

          {/* Order confirmed details */}
          {(isNewReservation || notifType.includes('order_confirmed')) && (
            <>
              {basketName && (
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.h3, fontWeight: '700', marginBottom: 12 }}>
                  {basketName}{locationName ? ` — ${locationName}` : ''}
                </Text>
              )}
              <View style={{ backgroundColor: '#114b3c08', borderRadius: 14, padding: 14, marginBottom: 16, gap: 0 }}>
                {isBusiness && customerName ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <User size={13} color="#e3ff5c" />
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>{customerName}</Text>
                  </View>
                ) : null}
                {notifAddress ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: (isBusiness && customerName) ? 1 : 0, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <MapPin size={13} color="#e3ff5c" />
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }} numberOfLines={1}>{notifAddress}</Text>
                    <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(notifAddress)}`)} style={{ backgroundColor: '#114b3c', borderRadius: 10, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' }}>
                      <Navigation size={13} color="#e3ff5c" />
                    </TouchableOpacity>
                  </View>
                ) : null}
                {qty ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <ShoppingBag size={13} color="#e3ff5c" />
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                      {qty} {Number(qty) > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}
                    </Text>
                  </View>
                ) : null}
                {price && !isCancelled ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: '#e3ff5c', fontSize: 9, fontWeight: '700' }}>TND</Text>
                    </View>
                    <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', flex: 1 }}>
                      {Number(qty ?? 1) > 1 ? (Number(price) * Number(qty ?? 1)).toFixed(2) : price} TND
                    </Text>
                  </View>
                ) : null}
                {pickupTime ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
                      <Clock size={13} color="#e3ff5c" />
                    </View>
                    <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 1 }}>
                      {t('notifications.pickupAt', { defaultValue: 'Retrait' })} : {pickupTime}
                    </Text>
                  </View>
                ) : null}
              </View>
              {pickupCode ? (
                <View style={{ backgroundColor: '#114b3c', borderRadius: 16, padding: 18, marginBottom: 16, alignItems: 'center' }}>
                  <Text style={{ color: 'rgba(255,255,255,0.6)', ...theme.typography.caption, marginBottom: 6 }}>
                    {t('reserve.success.pickupCode', { defaultValue: 'Code de retrait' })}
                  </Text>
                  <Text style={{ color: '#e3ff5c', fontSize: 28, fontWeight: '700', letterSpacing: 6 }}>{pickupCode}</Text>
                </View>
              ) : null}
            </>
          )}

          {/* Cancelled */}
          {isCancelled && (
            <View style={{ backgroundColor: '#ef444410', borderRadius: 12, padding: 14, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <XCircle size={20} color="#ef4444" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#ef4444', ...theme.typography.bodySm, fontWeight: '700' }}>
                  {t('notifications.cancelledInfo', { defaultValue: 'Commande annulée' })}
                </Text>
                {customerName ? <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', marginTop: 2 }}>{customerName}</Text> : null}
                {qty ? <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>{qty} {Number(qty) > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}</Text> : null}
              </View>
            </View>
          )}

          {/* Pickup confirmed */}
          {isPickupConfirmed && !isBusiness && (
            <View style={{ backgroundColor: '#16a34a10', borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <CheckCircle size={18} color="#16a34a" />
                <Text style={{ color: '#16a34a', ...theme.typography.bodySm, fontWeight: '700' }}>
                  {t('notifications.pickupComplete', { defaultValue: 'Retrait effectué' })}
                </Text>
              </View>
              {(basketName || locationName) ? (
                <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, marginBottom: 4 }}>
                  {basketName ? <Text style={{ fontWeight: '700' }}>{basketName}</Text> : null}
                  {basketName && locationName ? ' — ' : ''}
                  {locationName ?? ''}
                </Text>
              ) : null}
              {(qty || price) ? (
                <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
                  {qty ? <><Text style={{ fontWeight: '700', color: theme.colors.textPrimary }}>{qty}</Text> {Number(qty) > 1 ? t('basket.baskets', { defaultValue: 'paniers' }) : t('basket.basket', { defaultValue: 'panier' })}</> : null}
                  {qty && price ? ' · ' : ''}
                  {price ? <Text style={{ fontWeight: '700', color: theme.colors.primary }}>{price} TND</Text> : null}
                </Text>
              ) : null}
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 8, fontStyle: 'italic' }}>
                {t('notifications.reviewPromptHint', { defaultValue: 'Partagez votre expérience en laissant un avis !' })}
              </Text>
            </View>
          )}

          {/* Review */}
          {isReview && (
            <View style={{ backgroundColor: '#f59e0b10', borderRadius: 14, padding: 16, marginBottom: 16 }}>
              {customerName ? <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700', marginBottom: 10 }}>{customerName}</Text> : null}
              {rating ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 }}>
                  {[1,2,3,4,5].map(s => <Star key={s} size={22} color="#f59e0b" fill={s <= Math.round(Number(rating)) ? '#f59e0b' : 'transparent'} />)}
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700', marginLeft: 8 }}>{Number(rating).toFixed(1)}</Text>
                </View>
              ) : null}
              {comment ? (
                <View style={{ borderTopWidth: 1, borderTopColor: '#f59e0b30', paddingTop: 10 }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontStyle: 'italic', lineHeight: 20 }}>« {comment} »</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Generic detail rows — for types not covered above */}
          {!isNewReservation && !isReview && !isMessage && !isPickupConfirmed && !isCancelled && (basketName || locationName || customerName || qty || price) ? (
            <View style={{ backgroundColor: theme.colors.bg, borderRadius: 14, padding: 16, marginBottom: 16, gap: 12 }}>
              {basketName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.basket', { defaultValue: 'Panier' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }} numberOfLines={1}>{basketName}</Text>
                </View>
              ) : null}
              {locationName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.location', { defaultValue: 'Commerce' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }} numberOfLines={1}>{locationName}</Text>
                </View>
              ) : null}
              {customerName ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.customer', { defaultValue: 'Client' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>{customerName}</Text>
                </View>
              ) : null}
              {qty ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.quantity', { defaultValue: 'Quantité' })}</Text>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '600', flex: 2, textAlign: 'right' }}>{qty}</Text>
                </View>
              ) : null}
              {price ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, flex: 1 }}>{t('notifications.price', { defaultValue: 'Prix' })}</Text>
                  <Text style={{ color: theme.colors.primary, ...theme.typography.body, fontWeight: '700', flex: 2, textAlign: 'right' }}>{price} TND</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Message */}
          {isMessage ? (
            <View style={{ backgroundColor: '#3b82f610', borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: messageText ? 12 : 0 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#3b82f620', justifyContent: 'center', alignItems: 'center' }}>
                  <MessageCircle size={18} color="#3b82f6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, fontWeight: '700' }}>
                    {senderName || t('notifications.someone', { defaultValue: 'Quelqu\'un' })}
                  </Text>
                  <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
                    {t('notifications.messageReceived', { defaultValue: 'vous a envoyé un message' })}
                  </Text>
                </View>
              </View>
              {messageText ? (
                <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#3b82f620' }}>
                  <Text style={{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 20 }}>
                    {messageText}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* Action button — close lives in the header X now */}
        {onAction ? (
          <View style={demoHighlightAction
            ? { marginTop: 20, borderRadius: 17, borderWidth: 3, borderColor: '#e3ff5c' }
            : { marginTop: 20 }}>
            <TouchableOpacity onPress={onAction} style={{ backgroundColor: theme.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
              <Text style={{ color: '#fff', ...theme.typography.body, fontWeight: '600' }}>
                {isMessage ? t('notifications.viewConversation', { defaultValue: 'Voir la conversation' })
                  : isPickupConfirmed && !isBusiness ? t('notifications.leaveReview', { defaultValue: 'Laisser un avis' })
                  : isReview ? t('notifications.viewDashboard', { defaultValue: 'Tableau de bord' })
                  : isCancelled ? t('notifications.viewOrder', { defaultValue: 'Voir les commandes' })
                  : t('notifications.viewOrder', { defaultValue: 'Voir la commande' })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}
