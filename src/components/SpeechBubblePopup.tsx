/**
 * SpeechBubblePopup — rectangular speech-bubble popup for chat / message
 * notifications. Drops down from the top of the screen so the user
 * always sees it appear at a predictable location, regardless of which
 * screen they were on. Earlier versions sprang from a chat-icon origin
 * that wasn't measured on every screen, which sometimes left the bubble
 * starting offscreen on customer-facing pages — switching to a fixed
 * top-of-screen drop fixes that.
 *
 * Interaction: the whole bubble is pressable — tapping anywhere on it
 * opens the conversation. No separate CTA button. The bubble also
 * auto-dismisses after AUTO_DISMISS_MS so it doesn't linger if the user
 * ignores it.
 *
 * Animation: slides down from above the screen (translateY −120 → 0)
 * paired with a quick opacity fade-in. Auto-dismiss slides back up.
 *
 * Used by InAppNotification.tsx for any notif whose type contains
 * 'message' or 'reply'.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, X as XIcon } from 'lucide-react-native';
import type { NotificationFromAPI } from '@/src/services/notifications';
import { orderIdToCode } from '@/src/utils/orderCode';

// How long the bubble stays on screen before auto-dismissing if the user
// neither taps it nor closes it. 5 s is long enough to read a short
// preview without feeling sticky on top of the underlying screen.
const AUTO_DISMISS_MS = 5000;

const { width: SCREEN_W } = Dimensions.get('window');

interface SpeechBubblePopupProps {
  notif: NotificationFromAPI;
  theme: any;
  t: any;
  isBusiness?: boolean;
  /** Legacy prop — origin point used to spring the popup from a chat
   *  icon. Ignored now that the popup drops from the top of the screen,
   *  but kept in the type so call-sites don't need to change. */
  origin?: { x: number; y: number };
  /** Pre-resolved "Org Name - Location Name" string from the parent. The
   *  parent owns the org / location React-Query lookups, so we just
   *  render the result here. */
  senderHeader?: string;
  onClose: () => void;
  onAction?: () => void;
}

const BUBBLE_W = Math.min(SCREEN_W - 32, 360);

export function SpeechBubblePopup({
  notif,
  theme,
  t,
  isBusiness,
  senderHeader,
  onClose,
  onAction,
}: SpeechBubblePopupProps) {
  const insets = useSafeAreaInsets();
  // Bubble parks just below the safe-area top with a small margin so it
  // clears the status bar / notch on every device.
  const bubbleTop = (insets.top || 0) + 8;

  // Slide-down + fade-in. translateY starts above the screen at −120 and
  // settles to 0 with a spring so the drop feels lively but never lands
  // past its resting spot.
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, friction: 8, tension: 70, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    // Auto-dismiss after AUTO_DISMISS_MS. Routes through handleCloseRef so
    // the slide-up exit animation runs first, then onClose fires. The ref
    // dance avoids re-creating the timer when handleClose's identity
    // changes between renders.
    const timer = setTimeout(() => {
      autoDismissRef.current?.();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [translateY, opacityAnim]);

  // Stable handle to the latest handleClose so the auto-dismiss timer can
  // call it without restarting on every render.
  const autoDismissRef = useRef<(() => void) | null>(null);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 180, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => onClose());
  };
  // Refresh the ref every render so the auto-dismiss timer always calls
  // the latest handleClose closure.
  autoDismissRef.current = handleClose;

  const handleAction = () => {
    // Fire onAction IMMEDIATELY rather than waiting for the animation
    // callback. The parent's handleAction calls clearPopups() which
    // unmounts this component synchronously — the Animated.timing
    // callback may never fire because the component is gone before
    // the 130 ms duration elapses, and that was leaving the popup on
    // screen on some platforms/timings. Run the visual exit in
    // parallel so the dismissal still feels animated to anyone whose
    // device is fast enough to render the intermediate frames.
    onAction?.();
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 130, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 130, useNativeDriver: true }),
    ]).start();
  };

  // Parse the message JSON to get the actual chat text and the order
  // reference. Same shape NotificationDetail uses for `isMessage`.
  let msgParams: Record<string, any> = {};
  try {
    const parsed = JSON.parse(notif.message);
    if (parsed?.params) msgParams = parsed.params;
  } catch {}
  const senderName = msgParams.senderName ?? msgParams.sender_name ?? null;
  const messageText = msgParams.messageText ?? msgParams.message_text ?? null;
  const refId = notif.reference_id
    ?? msgParams.reservation_id
    ?? msgParams.reservationId
    ?? msgParams.order_id
    ?? msgParams.orderId
    ?? null;
  const orderRef = refId != null ? orderIdToCode(refId) : null;

  // Header text fallback ladder. The parent passes a pre-resolved
  // senderHeader (the "Org — Location" pair); we fall back to the
  // sender name from msgParams, then to a generic label.
  const headerLine =
    senderHeader
    ?? (isBusiness ? senderName : senderName)
    ?? t('notifications.someone', { defaultValue: 'Quelqu\'un' });

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999 }}
    >
      {/* Soft tap-anywhere-to-dismiss backdrop. No dim overlay — the
          popup is non-modal so the underlying screen stays visible. */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={handleClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          top: bubbleTop,
          left: (SCREEN_W - BUBBLE_W) / 2,
          width: BUBBLE_W,
          opacity: opacityAnim,
          transform: [{ translateY }],
        }}
      >
        {/* Body — the entire bubble is the tap-target. Tapping anywhere on
            it opens the conversation; the small X in the header corner
            short-circuits to a plain close. Rectangular with a 1 px
            border so it reads as a hand-drawn speech bubble rather than
            a heavy iOS popup card. */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onAction ? handleAction : handleClose}
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: 14,
            paddingTop: 14,
            paddingBottom: 14,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.18,
            shadowRadius: 14,
            elevation: 8,
          }}
        >
          {/* Header row — chat glyph, sender label (Org — Location for
              customer, customer name for business), close X. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#114b3c', justifyContent: 'center', alignItems: 'center' }}>
              <MessageCircle size={15} color="#e3ff5c" />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: theme.colors.textPrimary, ...theme.typography.bodySm, fontWeight: '700' }}
                numberOfLines={1}
              >
                {headerLine}
              </Text>
              <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 1 }} numberOfLines={1}>
                {t('notifications.messageReceived', { defaultValue: 'vous a envoyé un message' })}
                {orderRef ? ` · ${orderRef}` : ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.bg, justifyContent: 'center', alignItems: 'center' }}
            >
              <XIcon size={14} color={theme.colors.muted} />
            </TouchableOpacity>
          </View>

          {/* Message text — capped at 3 lines so the whole bubble stays
              compact and obviously tappable. Long messages truncate with
              an ellipsis; the user opens the conversation to read more. */}
          {messageText ? (
            <Text
              numberOfLines={3}
              style={{ color: theme.colors.textPrimary, ...theme.typography.body, lineHeight: 20 }}
            >
              {messageText}
            </Text>
          ) : null}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}
