import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { XCircle, CheckCircle2, AlertTriangle, Info } from 'lucide-react-native';

type AlertType = 'success' | 'error' | 'warning' | 'info';

interface AlertAction {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertState {
  visible: boolean;
  type: AlertType;
  title: string;
  message: string;
  actions: AlertAction[];
}

interface AlertContextType {
  showAlert: (title: string, message?: string, actions?: AlertAction[]) => void;
  showSuccess: (title: string, message?: string, onDismiss?: () => void) => void;
  showError: (title: string, message?: string) => void;
}

const AlertContext = createContext<AlertContextType>({
  showAlert: () => {},
  showSuccess: () => {},
  showError: () => {},
});

export const useCustomAlert = () => useContext(AlertContext);

function getType(title: string): AlertType {
  const lower = title.toLowerCase();
  if (lower.includes('succès') || lower.includes('success') || lower.includes('bravo')) return 'success';
  if (lower.includes('erreur') || lower.includes('error')) return 'error';
  if (lower.includes('attention') || lower.includes('warning') || lower.includes('supprimer') || lower.includes('delete')) return 'warning';
  return 'info';
}

const ICON_MAP = {
  success: { Icon: CheckCircle2, color: '#114b3c', bg: '#114b3c18' },
  error: { Icon: XCircle, color: '#ef4444', bg: '#ef444418' },
  warning: { Icon: AlertTriangle, color: '#f59e0b', bg: '#f59e0b18' },
  info: { Icon: Info, color: '#114b3c', bg: '#114b3c18' },
};

export function CustomAlertProvider({ children }: { children: React.ReactNode }) {
  const [alert, setAlert] = useState<AlertState>({ visible: false, type: 'info', title: '', message: '', actions: [] });

  const dismiss = useCallback(() => setAlert(prev => ({ ...prev, visible: false })), []);

  const showAlert = useCallback((title: string, message?: string, actions?: AlertAction[]) => {
    setAlert({
      visible: true,
      type: getType(title),
      title,
      message: message ?? '',
      actions: actions ?? [{ text: 'OK' }],
    });
  }, []);

  const showSuccess = useCallback((title: string, message?: string, onDismiss?: () => void) => {
    setAlert({
      visible: true,
      type: 'success',
      title,
      message: message ?? '',
      actions: [{ text: 'OK', onPress: onDismiss }],
    });
  }, []);

  const showError = useCallback((title: string, message?: string) => {
    setAlert({
      visible: true,
      type: 'error',
      title,
      message: message ?? '',
      actions: [{ text: 'OK' }],
    });
  }, []);

  const { Icon, color, bg } = ICON_MAP[alert.type];
  const hasDestructive = alert.actions.some(a => a.style === 'destructive');

  return (
    <AlertContext.Provider value={{ showAlert, showSuccess, showError }}>
      {children}
      <Modal visible={alert.visible} transparent animationType="fade" onRequestClose={dismiss}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 28, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ backgroundColor: bg, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Icon size={28} color={color} />
            </View>
            <Text style={{ color: '#1a1a1a', fontSize: 18, fontWeight: '700', fontFamily: 'Poppins_700Bold', textAlign: 'center', marginBottom: 10 }}>
              {alert.title}
            </Text>
            {alert.message ? (
              <Text style={{ color: '#666', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
                {alert.message}
              </Text>
            ) : <View style={{ height: 14 }} />}
            {alert.actions.length === 1 ? (
              <TouchableOpacity
                onPress={() => { dismiss(); alert.actions[0].onPress?.(); }}
                style={{ backgroundColor: '#114b3c', borderRadius: 14, paddingVertical: 14, width: '100%', alignItems: 'center' }}
              >
                <Text style={{ color: '#e3ff5c', fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold' }}>
                  {alert.actions[0].text}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                {alert.actions.map((action, i) => {
                  const isDestructive = action.style === 'destructive';
                  const isCancel = action.style === 'cancel';
                  return (
                    <TouchableOpacity
                      key={i}
                      onPress={() => { dismiss(); action.onPress?.(); }}
                      style={{
                        flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
                        backgroundColor: isDestructive ? '#ef4444' : isCancel ? '#f3f4f6' : '#114b3c',
                      }}
                    >
                      <Text style={{
                        fontSize: 15, fontWeight: '700', fontFamily: 'Poppins_700Bold',
                        color: isDestructive ? '#fff' : isCancel ? '#666' : '#e3ff5c',
                      }}>
                        {action.text}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}
