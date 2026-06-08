/**
 * ImageCropper
 *
 * In-app crop UI used in place of `ImagePicker`'s `allowsEditing: true` on
 * Android. The system Android crop UI has no explicit "Choisir" button — the
 * user only gets a checkmark icon, which has been a recurring source of "it
 * works but doesn't make sense" complaints. iOS keeps using the native picker
 * crop since its UX is already familiar.
 *
 * Usage:
 *   1. Wrap the app root with <ImageCropperProvider>.
 *   2. In a component, call:
 *        const { pickAndCrop } = useImageCropper();
 *        const uri = await pickAndCrop({ aspect: [4, 3], quality: 0.8 });
 *      `uri` is the cropped local file URI, or `null` if the user cancelled.
 *
 * On iOS, `pickAndCrop` short-circuits to expo-image-picker with its native
 * `allowsEditing` crop — same visual flow as before. On Android it picks
 * without editing then opens this component's pan-based crop modal.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { X } from 'lucide-react-native';

export interface CropOptions {
  /** Crop frame aspect ratio as [width, height]. e.g. [4,3], [1,1], [16,5]. */
  aspect: [number, number];
  /** JPEG quality 0..1 passed to expo-image-picker. Default 0.8. */
  quality?: number;
}

type Resolver = (uri: string | null) => void;

interface PendingCrop {
  uri: string;
  aspect: [number, number];
  quality: number;
  resolver: Resolver;
}

interface CropperContextValue {
  pickAndCrop: (opts: CropOptions) => Promise<string | null>;
}

const CropperContext = createContext<CropperContextValue | null>(null);

export function useImageCropper(): CropperContextValue {
  const ctx = useContext(CropperContext);
  if (!ctx) {
    throw new Error('useImageCropper must be used inside <ImageCropperProvider>.');
  }
  return ctx;
}

export function ImageCropperProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingCrop | null>(null);

  const pickAndCrop = useCallback(async (opts: CropOptions): Promise<string | null> => {
    const quality = opts.quality ?? 0.8;

    // Permission check — same as the original per-callsite checks. Surfacing
    // a denial here means the caller doesn't need to repeat it.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') return null;

    // iOS: keep using the native cropper. Its "Choose" button is already
    // explicit and the UX is familiar; replacing it with our JS cropper would
    // be a regression.
    if (Platform.OS === 'ios') {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: opts.aspect,
        quality,
      });
      if (res.canceled || !res.assets?.length) return null;
      return res.assets[0].uri;
    }

    // Android: pick without editing, then open our crop modal.
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality,
    });
    if (res.canceled || !res.assets?.length) return null;
    const sourceUri = res.assets[0].uri;

    return new Promise<string | null>((resolve) => {
      setPending({ uri: sourceUri, aspect: opts.aspect, quality, resolver: resolve });
    });
  }, []);

  const handleClose = useCallback((croppedUri: string | null) => {
    setPending((curr) => {
      if (curr) curr.resolver(croppedUri);
      return null;
    });
  }, []);

  const value = useMemo<CropperContextValue>(() => ({ pickAndCrop }), [pickAndCrop]);

  return (
    <CropperContext.Provider value={value}>
      {children}
      {pending && (
        <CropModal
          key={pending.uri}
          sourceUri={pending.uri}
          aspect={pending.aspect}
          quality={pending.quality}
          onClose={handleClose}
        />
      )}
    </CropperContext.Provider>
  );
}

// ── The modal itself ──────────────────────────────────────────────────────

interface CropModalProps {
  sourceUri: string;
  aspect: [number, number];
  quality: number;
  onClose: (croppedUri: string | null) => void;
}

function CropModal({ sourceUri, aspect, quality, onClose }: CropModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: WIN_W, height: WIN_H } = useWindowDimensions();

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Read the picked image's natural dimensions so we know how to scale it
  // inside the crop frame.
  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      sourceUri,
      (w, h) => { if (!cancelled) setNatural({ w, h }); },
      () => { if (!cancelled) onClose(null); },
    );
    return () => { cancelled = true; };
  }, [sourceUri, onClose]);

  // Crop frame: 88% of the window width, height set by aspect. The frame is
  // visually centred in the workspace. Clamp to leave room for the header
  // (top) + the action bar (bottom).
  const HEADER_H = 48 + (insets.top || 0);
  const ACTIONS_H = 84 + (insets.bottom || 0);
  const workspaceH = WIN_H - HEADER_H - ACTIONS_H;
  const maxFrameW = WIN_W - 32;
  const maxFrameH = workspaceH - 32;
  let frameW = maxFrameW;
  let frameH = frameW * (aspect[1] / aspect[0]);
  if (frameH > maxFrameH) {
    frameH = maxFrameH;
    frameW = frameH * (aspect[0] / aspect[1]);
  }
  const frameX = (WIN_W - frameW) / 2;
  const frameY = HEADER_H + (workspaceH - frameH) / 2;

  // Scale the source image so it fully covers the crop frame at baseline.
  // The user pans within bounds — the image never reveals an empty edge.
  const baseScale = natural
    ? Math.max(frameW / natural.w, frameH / natural.h)
    : 1;
  const imgW = natural ? natural.w * baseScale : 0;
  const imgH = natural ? natural.h * baseScale : 0;

  // Pan state. translation is the offset of the image's centre from the
  // frame's centre. Clamp so the frame stays fully covered.
  const maxTx = Math.max(0, (imgW - frameW) / 2);
  const maxTy = Math.max(0, (imgH - frameH) / 2);
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const txValRef = useRef(0);
  const tyValRef = useRef(0);
  useEffect(() => {
    const idX = tx.addListener(({ value }) => { txValRef.current = value; });
    const idY = ty.addListener(({ value }) => { tyValRef.current = value; });
    return () => { tx.removeListener(idX); ty.removeListener(idY); };
  }, [tx, ty]);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);

  const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
    onPanResponderGrant: () => {
      offsetXRef.current = txValRef.current;
      offsetYRef.current = tyValRef.current;
    },
    onPanResponderMove: (_, g) => {
      tx.setValue(clamp(offsetXRef.current + g.dx, maxTx));
      ty.setValue(clamp(offsetYRef.current + g.dy, maxTy));
    },
  }), [maxTx, maxTy, tx, ty]);

  // The image rendered at (centre - imgW/2 + tx, centre - imgH/2 + ty).
  // Centre of the workspace is the frame centre.
  const frameCenterX = frameX + frameW / 2;
  const frameCenterY = frameY + frameH / 2;

  const handleConfirm = useCallback(async () => {
    if (!natural || busy) return;
    setBusy(true);
    try {
      // Translate the frame's top-left into source-image pixel coords.
      // At translation (tx, ty) the image's top-left in window space is:
      //   imgLeft = frameCenterX - imgW/2 + tx
      //   imgTop  = frameCenterY - imgH/2 + ty
      // The crop region in window space is (frameX, frameY, frameW, frameH).
      // Its position inside the image (in display pixels):
      //   cropDispX = frameX - imgLeft
      //   cropDispY = frameY - imgTop
      // Convert back to natural pixels by dividing by baseScale.
      const imgLeft = frameCenterX - imgW / 2 + txValRef.current;
      const imgTop = frameCenterY - imgH / 2 + tyValRef.current;
      const cropX = (frameX - imgLeft) / baseScale;
      const cropY = (frameY - imgTop) / baseScale;
      const cropW = frameW / baseScale;
      const cropH = frameH / baseScale;
      // Clamp to natural bounds (defensive against float drift).
      const safeX = Math.max(0, Math.min(natural.w - 1, cropX));
      const safeY = Math.max(0, Math.min(natural.h - 1, cropY));
      const safeW = Math.max(1, Math.min(natural.w - safeX, cropW));
      const safeH = Math.max(1, Math.min(natural.h - safeY, cropH));

      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ crop: { originX: safeX, originY: safeY, width: safeW, height: safeH } }],
        { compress: quality, format: ImageManipulator.SaveFormat.JPEG },
      );
      onClose(result.uri);
    } catch {
      // Surface as cancel — the caller already handles null gracefully.
      onClose(null);
    } finally {
      setBusy(false);
    }
  }, [natural, busy, baseScale, frameCenterX, frameCenterY, imgW, imgH, frameX, frameY, frameW, frameH, sourceUri, quality, onClose]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onClose(null)}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => onClose(null)} hitSlop={12} style={styles.headerBtn}>
            <X size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {t('common.crop', { defaultValue: 'Recadrer' })}
          </Text>
          <View style={styles.headerBtn} />
        </View>

        {/* Workspace */}
        <View style={styles.workspace} {...pan.panHandlers}>
          {natural && (
            <Animated.Image
              source={{ uri: sourceUri }}
              style={{
                position: 'absolute',
                width: imgW,
                height: imgH,
                left: frameCenterX - imgW / 2,
                top: frameCenterY - imgH / 2,
                transform: [{ translateX: tx }, { translateY: ty }],
              }}
              resizeMode="cover"
            />
          )}

          {/* Dim outside the crop frame */}
          <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: 0, height: frameY }]} />
          <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: frameY + frameH, bottom: 0 }]} />
          <View pointerEvents="none" style={[styles.dim, { left: 0, width: frameX, top: frameY, height: frameH }]} />
          <View pointerEvents="none" style={[styles.dim, { right: 0, width: frameX, top: frameY, height: frameH }]} />

          {/* Crop frame outline */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: frameX,
              top: frameY,
              width: frameW,
              height: frameH,
              borderWidth: 2,
              borderColor: '#e3ff5c',
            }}
          />
        </View>

        {/* Actions */}
        <View style={[styles.actions, { paddingBottom: insets.bottom > 0 ? 12 : 20 }]}>
          <TouchableOpacity onPress={() => onClose(null)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleConfirm}
            disabled={!natural || busy}
            style={[styles.confirmBtn, (!natural || busy) && { opacity: 0.5 }]}
          >
            <Text style={styles.confirmText}>
              {busy
                ? t('common.loading', { defaultValue: 'Chargement...' })
                : t('common.choose', { defaultValue: 'Choisir' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 16, fontFamily: 'Poppins_700Bold' },
  workspace: { flex: 1, overflow: 'hidden' },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 20 },
  cancelText: { color: '#fff', fontSize: 15, fontFamily: 'Poppins_500Medium' },
  confirmBtn: {
    backgroundColor: '#e3ff5c',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  confirmText: { color: '#114b3c', fontSize: 15, fontFamily: 'Poppins_700Bold' },
});
