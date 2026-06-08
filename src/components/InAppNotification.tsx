/**
 * In-app notification popup — renders the SAME NotificationDetail component
 * used by the notifications page, overlaid on whatever screen the user is on.
 * Carousel of up to 3 unread notifications with "see all" navigation.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { ChevronRight, ChevronLeft as ChevronLeftIcon, Bell } from 'lucide-react-native';
import { useNotificationStore } from '@/src/stores/notificationStore';
import { NotificationDetail } from '@/src/components/NotificationDetail';
import { PaperSurface } from '@/src/components/ui/PaperSurface';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useWalkthroughStore } from '@/src/stores/walkthroughStore';
import { Hand } from 'lucide-react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;

export function InAppNotification() {
  const { t } = useTranslation();
  const theme = useTheme();
  const popupQueue = useNotificationStore((s) => s.popupQueue);
  const clearPopups = useNotificationStore((s) => s.clearPopups);
  const acknowledgePopup = useNotificationStore((s) => s.acknowledgePopup);

  // Consume every currently-queued popup: mark each as read on the server and
  // bump lastSeenNotifId so the same set doesn't re-appear on the next poll.
  // Called from every exit path (dismiss / action / see-all / backdrop tap).
  const consumeAllQueued = () => {
    const ids = popupQueue.map((n) => n.id);
    for (const id of ids) acknowledgePopup(id);
  };
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isBusiness = user?.role === 'business';
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [currentIdx, setCurrentIdx] = useState(0);

  const hasPopups = popupQueue.length > 0;

  useEffect(() => {
    if (hasPopups) {
      setCurrentIdx(0);
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 8, tension: 80, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      // No auto-dismiss: popups remain until the user explicitly closes them
      // (X button, backdrop tap, or the action button).
    } else {
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
    }
  }, [hasPopups, popupQueue.length]);

  const handleDismiss = () => {
    consumeAllQueued();
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.85, duration: 150, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => clearPopups());
  };

  const currentNotif = popupQueue[currentIdx];

  // Demo detection: the orders walkthrough pushes a synthetic notif via
  // pushDemoPopup with a negative id (-Date.now()). When the popup belongs
  // to the demo, we replace the carousel chrome with a single-line
  // instruction banner above the card and halo the action button so the
  // user knows to tap "Voir la commande". Tapping the action also advances
  // the walkthrough.
  const demoOrderActive = useWalkthroughStore((s) => s.demoOrderActive);
  const isDemoNotif = demoOrderActive && currentNotif && (currentNotif as any).id < 0;

  const handleAction = () => {
    if (isDemoNotif) {
      // Advance the walkthrough past the orders-tab step on the same tap
      // that dismisses the popup. Without this the user would have to tap
      // Suivant on the underlying tooltip after dismissing the popup.
      useWalkthroughStore.getState().nextStep(999);
      consumeAllQueued();
      clearPopups();
      // STOP HERE. The business demo user is ALREADY on incoming-orders, where
      // the demo order card is injected + measured. Falling through to the
      // router.push('/(business)/incoming-orders') below would push a duplicate
      // screen, remount/re-measure the card, and jank the walkthrough so it
      // appears to "stop". The demo's own steps own all navigation from here.
      return;
    }
    consumeAllQueued();
    clearPopups();
    const notifType = currentNotif?.type ?? '';
    if (notifType.includes('message') || notifType.includes('reply')) {
      const convId = currentNotif?.reference_id;
      if (convId) {
        router.push({ pathname: '/message/[id]', params: { id: String(convId) } } as never);
      } else {
        router.push('/messages' as never);
      }
    } else if (notifType.includes('new_reservation') || notifType.includes('order_confirmed') || notifType.includes('cancelled')) {
      const refId = currentNotif?.reference_id;
      if (isBusiness && refId) {
        useBusinessStore.getState().setTargetOrder(String(refId), null);
      }
      router.push(isBusiness ? '/(business)/incoming-orders' : '/(tabs)/orders');
    } else if (isBusiness && (notifType.includes('basket_picked_up') || notifType.includes('picked_up') || notifType.includes('collected'))) {
      // Business "panier récupéré" popup → land on the exact completed
      // order. The incoming-orders screen reads `targetOrderId` + the
      // status of the row and auto-switches to the "Completed" tab and
      // scrolls/expands the target, so the user sees the specific order
      // instead of a generic landing page.
      const refId = currentNotif?.reference_id;
      let msgP: any = {};
      try { const p = JSON.parse(currentNotif?.message ?? ''); if (p?.params) msgP = p.params; } catch {}
      const locId = msgP.location_id ?? msgP.locationId ?? null;
      if (refId) {
        useBusinessStore.getState().setTargetOrder(String(refId), locId);
      }
      router.push('/(business)/incoming-orders' as never);
    } else if (!isBusiness && (notifType.includes('pickup_confirmed') || notifType.includes('collected') || notifType.includes('basket_picked_up'))) {
      // Customer post-pickup: route to /review with full reservation context
      // pulled from the notification's message params. Mirrors the param shape
      // the deleted standalone review-prompt modal used to pass.
      const refId = currentNotif?.reference_id;
      let msgP: any = {};
      try { const p = JSON.parse(currentNotif?.message ?? ''); if (p?.params) msgP = p.params; } catch {}
      router.push({ pathname: '/review', params: {
        reservationId: String(refId ?? ''),
        locationId: String(msgP.location_id ?? msgP.locationId ?? ''),
        locationName: msgP.locationName ?? msgP.location ?? '',
        locationLogo: msgP.locationImage ?? msgP.location_image ?? '',
        basketImage: msgP.basketImage ?? msgP.basket_image ?? '',
        basketName: msgP.basketName ?? msgP.basket_name ?? '',
        quantity: String(msgP.quantity ?? msgP.qty ?? 1),
        total: String(msgP.price ?? msgP.total ?? 0),
      } } as never);
    } else if (notifType.includes('streak')) {
      // Streak about to expire → "Order Now" takes the customer to the home
      // feed to place an order and keep the streak alive.
      router.push('/(tabs)' as never);
    } else if (notifType.includes('review')) {
      // Only business users should ever enter the business flow.
      if (isBusiness) {
        router.push('/(business)/dashboard');
      } else {
        router.push('/notifications' as never);
      }
    } else {
      router.push('/notifications' as never);
    }
  };

  const goToNotif = (id: number | string) => {
    consumeAllQueued();
    clearPopups();
    router.push({ pathname: '/notifications', params: { openId: String(id) } } as never);
  };

  if (!hasPopups || !currentNotif) return null;

  return (
    <Animated.View
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 99999, justifyContent: 'center', alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.45)', opacity: opacityAnim,
      }}
    >
      {/* Tap backdrop to dismiss */}
      <TouchableOpacity activeOpacity={1} onPress={handleDismiss} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

      <Animated.View style={{ transform: [{ scale: scaleAnim }], width: SCREEN_WIDTH - 40, maxWidth: 420 }}>
        {/* Demo instruction banner — replaces the carousel chrome for the
            demo notif. Tells the user the order has just come in and to
            tap Voir la commande. */}
        {isDemoNotif && (
          <PaperSurface radius={16} style={{ paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#114b3c14', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
              <Hand size={18} color="#114b3c" />
            </View>
            <Text style={{ color: '#114b3c', fontSize: 13, fontWeight: '700', fontFamily: 'Poppins_700Bold', flex: 1, lineHeight: 18 }}>
              {t('walkthrough.biz.notifPopup.desc', { defaultValue: 'Une nouvelle commande vient d\'arriver. Appuyez sur « Voir la commande » pour la consulter.' })}
            </Text>
          </PaperSurface>
        )}

        {/* Carousel indicator if multiple (suppressed during the demo). The
            bell sits at the right end on the same horizontal level as the
            "1 / N" index so the user can jump straight to the notifications
            page (opening the current notif) without scrolling through the
            stack. */}
        {!isDemoNotif && popupQueue.length > 1 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ flex: 1 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={() => setCurrentIdx(Math.max(0, currentIdx - 1))} disabled={currentIdx === 0} style={{ opacity: currentIdx === 0 ? 0.3 : 1 }}>
                <ChevronLeftIcon size={20} color="#fff" />
              </TouchableOpacity>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                {currentIdx + 1} / {popupQueue.length}
              </Text>
              <TouchableOpacity onPress={() => setCurrentIdx(Math.min(popupQueue.length - 1, currentIdx + 1))} disabled={currentIdx === popupQueue.length - 1} style={{ opacity: currentIdx === popupQueue.length - 1 ? 0.3 : 1 }}>
                <ChevronRight size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <TouchableOpacity
                onPress={() => goToNotif(currentNotif.id)}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Bell size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* The exact same NotificationDetail component used in the notifications
            page. In single-popup mode (no carousel) we also pass a bell into
            the card header so the shortcut is still reachable. The bell sits
            to the left of the existing X close button. Hidden during the demo
            to keep focus on the haloed "Voir la commande" action. */}
        <View onStartShouldSetResponder={() => true}>
          <NotificationDetail
            notif={currentNotif}
            theme={theme}
            t={t}
            isBusiness={isBusiness}
            onClose={handleDismiss}
            onAction={handleAction}
            demoHighlightAction={!!isDemoNotif}
            topRightAction={
              !isDemoNotif && popupQueue.length === 1 ? (
                <TouchableOpacity
                  onPress={() => goToNotif(currentNotif.id)}
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surfaceMuted, justifyContent: 'center', alignItems: 'center' }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Bell size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              ) : null
            }
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}
