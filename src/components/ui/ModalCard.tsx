/**
 * ModalCard — centered modal scaffold on the warm-paper surface.
 *
 * Bundles the parts every centered modal in the app re-implemented by hand:
 *   • <Modal> + dimmed overlay + outside-tap dismiss
 *   • the top-right round X close button (lifted from the About/Support modals)
 *   • KeyboardAvoidingView + a bounded ScrollView so tall content / open
 *     keyboards stay usable on small screens
 *
 * Two header modes:
 *   • `title` set     → header row [ title …… X ] (forms: change password, role)
 *   • no `title`      → X floats top-right, children own the layout (icon
 *                       modals: about, support, confirmations)
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { X } from 'lucide-react-native';
import { tokens } from '@/src/theme/tokens';
import { PaperSurface } from './PaperSurface';

interface ModalCardProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** When set, renders a pinned header row with this title + the X button. */
  title?: string;
  maxWidth?: number;
  /** Show the round X close button. Default true. */
  showClose?: boolean;
  /** Tap on the dimmed backdrop closes. Default true. */
  dismissOnBackdrop?: boolean;
  /** Thin brand-green accent strip on the card's left edge. */
  accent?: boolean;
  radius?: number;
  /** contentContainerStyle for the inner ScrollView. */
  contentStyle?: StyleProp<ViewStyle>;
}

function CloseButton({ onClose, floating }: { onClose: () => void; floating?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onClose}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel="Fermer"
      accessibilityRole="button"
      style={
        floating
          ? {
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 2,
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: tokens.colors.surfaceMuted,
              justifyContent: 'center',
              alignItems: 'center',
            }
          : { width: 32, height: 32, borderRadius: 16, backgroundColor: tokens.colors.surfaceMuted, justifyContent: 'center', alignItems: 'center' }
      }
    >
      <X size={18} color={tokens.colors.textSecondary} />
    </TouchableOpacity>
  );
}

export function ModalCard({
  visible,
  onClose,
  children,
  title,
  maxWidth = 360,
  showClose = true,
  dismissOnBackdrop = true,
  accent = false,
  radius = tokens.radii.r24,
  contentStyle,
}: ModalCardProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      {/* Paint the dim backdrop on the KeyboardAvoidingView itself, not just
          on the inner TouchableOpacity. Without this, when the keyboard
          pushes content up — iOS via behavior=padding adding a bottom band,
          Android via the system resizing the modal window — the freed
          region paints with the underlying window's default background
          (white) instead of the dim overlay, producing the "white strip
          behind the keyboard" the user reported. */}
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={dismissOnBackdrop ? onClose : undefined}
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}
        >
          <View style={{ width: '100%', maxWidth, maxHeight: '88%' }} onStartShouldSetResponder={() => true}>
            <PaperSurface radius={radius} accent={accent} style={{ padding: 24, flexShrink: 1 }}>
              {title ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
                  <Text style={{ color: tokens.colors.textPrimary, ...tokens.typography.h3, flex: 1 }}>{title}</Text>
                  {showClose ? <CloseButton onClose={onClose} /> : null}
                </View>
              ) : showClose ? (
                <CloseButton onClose={onClose} floating />
              ) : null}
              <ScrollView
                style={{ flexShrink: 1 }}
                contentContainerStyle={contentStyle}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            </PaperSurface>
          </View>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}
