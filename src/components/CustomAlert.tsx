import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, Animated, StyleSheet, PanResponder, TouchableWithoutFeedback, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { XCircle, CheckCircle2, AlertTriangle, Info } from 'lucide-react-native';
import { tokens } from '@/src/theme/tokens';
import { PaperSurface } from './ui/PaperSurface';

type AlertType = 'success' | 'error' | 'warning' | 'info';
type AlertLayout = 'center' | 'sheet';

interface AlertAction {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertOptions {
  type?: AlertType;
  /**
   * - `center` (default): centered modal with icon circle. Reserve for truly
   *   irreversible actions (delete account) and transient success/error toasts.
   * - `sheet`: slide-up bottom sheet. Preferred for contextual confirmations
   *   (cash warning, cancel order) — matches the modern Uber Eats / Deliveroo
   *   pattern and avoids the AI-generated centered-popup look.
   */
  layout?: AlertLayout;
}

interface AlertState {
  visible: boolean;
  type: AlertType;
  layout: AlertLayout;
  title: string;
  message: string;
  actions: AlertAction[];
}

interface AlertContextType {
  showAlert: (title: string, message?: string, actions?: AlertAction[], options?: AlertOptions | AlertType) => void;
  showSuccess: (title: string, message?: string, onDismiss?: () => void) => void;
  showError: (title: string, message?: string) => void;
}

const AlertContext = createContext<AlertContextType>({
  showAlert: () => {},
  showSuccess: () => {},
  showError: () => {},
});

// Module-level bridge so NON-React code (the react-query global error handler,
// axios interceptors, etc.) can surface a translated Barakeat popup instead of
// letting an uncaught error reach the red Expo error screen. The provider
// registers its live `showAlert` on mount.
let _globalShowAlert: AlertContextType['showAlert'] | null = null;
export function showGlobalAlert(title: string, message?: string) {
  _globalShowAlert?.(title, message);
}

export const useCustomAlert = () => useContext(AlertContext);

function getType(title: string): AlertType {
  const lower = title.toLowerCase();
  if (lower.includes('succès') || lower.includes('success') || lower.includes('bravo')) return 'success';
  if (lower.includes('erreur') || lower.includes('error')) return 'error';
  if (lower.includes('attention') || lower.includes('warning') || lower.includes('supprimer') || lower.includes('delete')) return 'warning';
  return 'info';
}

const ICON_MAP = {
  success: { Icon: CheckCircle2, color: '#2d8a6e' },
  error: { Icon: XCircle, color: '#d94f4f' },
  warning: { Icon: AlertTriangle, color: '#e8a838' },
  info: { Icon: Info, color: '#114b3c' },
};

export function CustomAlertProvider({ children }: { children: React.ReactNode }) {
  const [alert, setAlert] = useState<AlertState>({ visible: false, type: 'info', layout: 'center', title: '', message: '', actions: [] });
  const insets = useSafeAreaInsets();
  const sheetY = useRef(new Animated.Value(400)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  const dismiss = useCallback(() => setAlert(prev => ({ ...prev, visible: false })), []);

  const showAlert = useCallback((title: string, message?: string, actions?: AlertAction[], options?: AlertOptions | AlertType) => {
    // Back-compat: older callers pass just the AlertType string as the 4th arg.
    const opts: AlertOptions = typeof options === 'string' ? { type: options } : (options ?? {});
    setAlert({
      visible: true,
      type: opts.type ?? getType(title),
      layout: opts.layout ?? 'center',
      title,
      message: message ?? '',
      actions: actions ?? [{ text: 'OK' }],
    });
  }, []);

  const showSuccess = useCallback((title: string, message?: string, onDismiss?: () => void) => {
    setAlert({
      visible: true,
      type: 'success',
      layout: 'center',
      title,
      message: message ?? '',
      actions: [{ text: 'OK', onPress: onDismiss }],
    });
  }, []);

  const showError = useCallback((title: string, message?: string) => {
    setAlert({
      visible: true,
      type: 'error',
      layout: 'center',
      title,
      message: message ?? '',
      actions: [{ text: 'OK' }],
    });
  }, []);

  // Register the live showAlert on the module bridge so non-React callers
  // (react-query global onError) can trigger a translated popup.
  useEffect(() => {
    _globalShowAlert = showAlert;
    return () => { _globalShowAlert = null; };
  }, [showAlert]);

  // Drive the sheet animation alongside alert.visible for sheet layout.
  useEffect(() => {
    if (alert.layout !== 'sheet') return;
    if (alert.visible) {
      Animated.parallel([
        Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, friction: 14, tension: 90 }),
        Animated.timing(backdrop, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(sheetY, { toValue: 400, duration: 180, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [alert.visible, alert.layout, sheetY, backdrop]);

  // Velocity-projected, follow-finger dismiss. Same model as the
  // shared useSwipeToDismiss hook — inlined here because the sheet
  // has its own slide-in animation tied to `sheetY` we want to share.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (g.dy >= 0) sheetY.setValue(g.dy);
        else sheetY.setValue(g.dy / 3);
      },
      onPanResponderRelease: (_, g) => {
        const projection = g.dy + g.vy * 60;
        if (projection > 80 || g.vy > 0.6) {
          const duration = Math.max(120, Math.min(280, 220 - g.vy * 50));
          Animated.timing(sheetY, { toValue: 800, duration, useNativeDriver: true }).start(({ finished }) => {
            if (finished) dismissRef.current();
          });
        } else {
          Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, friction: 10, tension: 80 }).start();
        }
      },
      onPanResponderTerminate: () => sheetY.setValue(0),
    })
  ).current;

  const { Icon, color } = ICON_MAP[alert.type];

  const renderActions = (fullWidth: boolean) => {
    if (alert.actions.length === 1) {
      return (
        <TouchableOpacity
          onPress={() => { dismiss(); alert.actions[0].onPress?.(); }}
          style={{ backgroundColor: '#114b3c', borderRadius: 12, paddingVertical: 14, width: '100%', alignItems: 'center' }}
        >
          <Text style={{ color: '#e3ff5c', fontSize: 15, fontFamily: 'Poppins_700Bold', fontWeight: '700' }}>
            {alert.actions[0].text}
          </Text>
        </TouchableOpacity>
      );
    }
    // 3+ actions stack vertically as full-width rows (classic iOS action-
    // sheet pattern). With each button getting the full sheet width the
    // longest French label like "Choisir depuis la galerie" fits cleanly
    // on a single line at the normal 15 px size, so every button shares
    // identical padding + font without needing adjustsFontSizeToFit. 2-
    // button confirm dialogs (Annuler / Confirmer, Annuler / Supprimer)
    // stay side-by-side — they read better as a left/right pair.
    const stackVertical = alert.actions.length >= 3;
    return (
      <View style={{ flexDirection: stackVertical ? 'column' : 'row', gap: 10, width: '100%' }}>
        {alert.actions.map((action, i) => {
          const isDestructive = action.style === 'destructive';
          const isCancel = action.style === 'cancel';
          return (
            <TouchableOpacity
              key={i}
              onPress={() => { dismiss(); action.onPress?.(); }}
              style={{
                // Same width treatment for every button in the same group:
                // either full-width (stacked) or equally-split (side-by-side).
                ...(stackVertical ? { width: '100%' } : { flex: 1 }),
                borderRadius: 12,
                // Identical padding across destructive / cancel / primary so
                // the rows read as one cluster.
                paddingVertical: 16,
                paddingHorizontal: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isDestructive ? '#d94f4f' : isCancel ? '#f5f5f1' : '#114b3c',
                borderWidth: isCancel ? 1 : 0,
                borderColor: '#e8e8e3',
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 15,
                  fontFamily: isCancel ? 'Poppins_600SemiBold' : 'Poppins_700Bold',
                  fontWeight: isCancel ? '600' : '700',
                  textAlign: 'center',
                  color: isDestructive ? '#fff' : isCancel ? '#1a1a1a' : '#fff',
                }}
              >
                {action.text}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const isSheet = alert.layout === 'sheet';
  // For the sheet layout, extend behind the Android virtual nav bar so the
  // popup's bg reaches the screen edge (no gap above the system buttons).
  // Gated to virtual-nav devices only — gesture-nav and iOS are unchanged.
  const sheetExtendsUnderNavBar = isSheet && Platform.OS === 'android' && insets.bottom > 16;

  return (
    <AlertContext.Provider value={{ showAlert, showSuccess, showError }}>
      {children}
      <Modal
        visible={alert.visible}
        transparent
        animationType={isSheet ? 'none' : 'fade'}
        onRequestClose={dismiss}
        statusBarTranslucent={Platform.OS === 'android'}
        navigationBarTranslucent={sheetExtendsUnderNavBar}
      >
        {isSheet ? (
          // Sheet layout — slide-up, drag to dismiss, left-aligned content.
          // The icon sits inline with the title (no tinted circle backdrop)
          // because bottom-sheets read as "here's some context" not "alert!".
          <View style={StyleSheet.absoluteFill}>
            <TouchableWithoutFeedback onPress={dismiss}>
              <Animated.View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdrop }} />
            </TouchableWithoutFeedback>
            <Animated.View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: '#fff',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                borderTopWidth: 1,
                borderColor: tokens.colors.border,
                paddingHorizontal: 24,
                paddingBottom: insets.bottom + 24,
                transform: [{ translateY: sheetY }],
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.14,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              {/* Warm-paper gradient wash behind the sheet content (sits first
                  so it paints behind the handle + text). */}
              <LinearGradient
                colors={tokens.gradients.paper}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={{ ...StyleSheet.absoluteFillObject, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
              />
              {/* Swipe zone — top strip hosts the handle pill + the
                  PanResponder so any inner content (action buttons,
                  message text) keeps normal tap behaviour. */}
              <View
                {...panResponder.panHandlers}
                style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 14, marginHorizontal: -20 }}
              >
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: '#e8e8e3' }} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Icon size={22} color={color} />
                <Text style={{ flex: 1, color: '#1a1a1a', fontSize: 17, fontFamily: 'Poppins_700Bold', fontWeight: '700', letterSpacing: -0.2 }}>
                  {alert.title}
                </Text>
              </View>
              {alert.message ? (
                <Text style={{ color: '#6b6b6b', fontSize: 14, fontFamily: 'Poppins_400Regular', lineHeight: 20, marginBottom: 20 }}>
                  {alert.message}
                </Text>
              ) : <View style={{ height: 8 }} />}
              {renderActions(true)}
            </Animated.View>
          </View>
        ) : (
          // Centered layout — kept for irreversible alerts only. Icon circle
          // backdrop is still used but with the muted surface tint (not the
          // color-opacity hex trick) so it feels consistent with the rest of
          // the app's refreshed neutrals.
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <PaperSurface radius={20} style={{ padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' }}>
              <View style={{ backgroundColor: '#f5f5f1', width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
                <Icon size={26} color={color} />
              </View>
              <Text style={{ color: '#1a1a1a', fontSize: 17, fontFamily: 'Poppins_700Bold', fontWeight: '700', textAlign: 'center', marginBottom: 8, letterSpacing: -0.2 }}>
                {alert.title}
              </Text>
              {alert.message ? (
                <Text style={{ color: '#6b6b6b', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 20, marginBottom: 20 }}>
                  {alert.message}
                </Text>
              ) : <View style={{ height: 12 }} />}
              {renderActions(false)}
            </PaperSurface>
          </View>
        )}
      </Modal>
    </AlertContext.Provider>
  );
}
