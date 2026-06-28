/**
 * Custom photo-library picker + in-app cropper.
 *
 * Exposed via useImageCropper():
 *   pickPhoto({ base64? }) -> { uri, dataUrl? } | null
 *   pickAndCrop({ aspect, quality }) -> croppedUri | null
 *
 * WHY A CUSTOM PICKER:
 * The iOS/Android *system* picker (expo-image-picker) always shows the user's
 * ENTIRE library and ignores iOS "Limited Access" — so a user who limited the
 * app to a few photos could still browse (and pick) everything. Instagram /
 * TikTok / Facebook avoid this by building their own grid on top of PhotoKit.
 * We do the same here with expo-media-library: `getAssetsAsync` returns ONLY
 * the photos the user allowed when access is Limited, so the grid shows just
 * those, with a "Manage" button (`presentPermissionsPickerAsync`) to add more.
 *
 * pickAndCrop runs the chosen image through the pan-based CropModal on BOTH
 * platforms (we no longer use the native editing picker, since we no longer
 * use the native picker at all).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Linking,
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
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image as ExpoImage } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { X } from 'lucide-react-native';
import i18n from '@/src/i18n';
import { showGlobalAlert } from '@/src/components/CustomAlert';
import { ensureLibraryAccess } from '@/src/lib/photoPermission';

export interface CropOptions {
  /** Crop frame aspect ratio as [width, height]. e.g. [4,3], [1,1], [16,5]. */
  aspect: [number, number];
  /** JPEG quality 0..1. Default 0.8. */
  quality?: number;
}

export interface PickResult {
  /** Local file URI of the chosen image. */
  uri: string;
  /** Present only when `pickPhoto({ base64: true })` — a ready-to-POST data URL. */
  dataUrl?: string;
}

type CropResolver = (uri: string | null) => void;
type GridResolver = (uri: string | null) => void;

interface PendingCrop {
  uri: string;
  aspect: [number, number];
  quality: number;
  resolver: CropResolver;
}

interface CropperContextValue {
  pickAndCrop: (opts: CropOptions) => Promise<string | null>;
  pickPhoto: (opts?: { base64?: boolean }) => Promise<PickResult | null>;
  /**
   * Open the photo grid in MANAGE mode (no picking): shows the photos Barakeat
   * can currently see and lets the user select more, switch to full access, or
   * remove access. Used by the Settings "photo access" row when the user is on
   * iOS Limited access.
   */
  manageLibraryAccess: () => Promise<void>;
}

const CropperContext = createContext<CropperContextValue | null>(null);

export function useImageCropper(): CropperContextValue {
  const ctx = useContext(CropperContext);
  if (!ctx) {
    throw new Error('useImageCropper must be used inside <ImageCropperProvider>.');
  }
  return ctx;
}

// Request photo-library access. On denial, show the branded "go to Settings"
// popup (via the global alert bridge so it works from this provider) and return
// false. Limited access counts as granted — the grid then shows only the
// allowed subset.
// 'ok'          → media-library granted, show the custom grid.
// 'denied'      → granted-but-denied; we showed the Settings popup, give up.
// 'unavailable' → the native module rejected the call (Expo Go blocks
//                 media-library for full library access) → caller falls back
//                 to the system picker so the feature still works.
type MediaAccess = 'ok' | 'denied' | 'unavailable';

async function ensureMediaAccess(): Promise<MediaAccess> {
  const t = i18n.t.bind(i18n);
  let perm: MediaLibrary.PermissionResponse;
  try {
    // Request PHOTO access only. The default requests photo+video+AUDIO, and on
    // Android the AUDIO request is rejected unless READ_MEDIA_AUDIO is declared
    // ("You have requested the AUDIO permission..."). The granular list is
    // ignored on iOS, so this is safe cross-platform.
    perm = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  } catch (e: any) {
    // Expo Go blocks expo-media-library ("create a development build"), and an
    // app compiled before the dependency was added won't have the native
    // module either. Either way we can't show the custom grid — signal the
    // caller to fall back to the system picker.
    console.warn('[PhotoPicker] media-library unavailable, falling back to system picker:', e?.message ?? String(e));
    return 'unavailable';
  }
  if (perm.status === 'granted') return 'ok';
  showGlobalAlert(
    t('permissions.photosTitle', { defaultValue: 'Accès aux photos requis' }),
    t('permissions.photosBody', {
      defaultValue:
        "Barakeat n’a pas l’autorisation d’accéder à vos photos. Activez-la dans les Réglages pour choisir une image.",
    }),
    [
      { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
      {
        text: t('permissions.openSettings', { defaultValue: 'Ouvrir les Réglages' }),
        onPress: () => { void Linking.openSettings(); },
      },
    ],
  );
  return 'denied';
}

// Convert a local file URI to a JPEG data URL (for the base64 call sites).
async function toDataUrl(uri: string): Promise<string | null> {
  try {
    const r = await ImageManipulator.manipulateAsync(uri, [], {
      base64: true,
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return r.base64 ? `data:image/jpeg;base64,${r.base64}` : null;
  } catch {
    return null;
  }
}

export function ImageCropperProvider({ children }: { children: React.ReactNode }) {
  const [gridVisible, setGridVisible] = useState(false);
  const gridResolverRef = useRef<GridResolver | null>(null);
  const [pending, setPending] = useState<PendingCrop | null>(null);
  // Manage mode is a SEPARATE instance of the grid that shows the accessible
  // photos without resolving a pick — opened from Settings to manage access.
  const [manageVisible, setManageVisible] = useState(false);

  // Resolve with the chosen file URI (or null if cancelled / permission
  // denied). Uses the custom limited-access grid when media-library is
  // available, otherwise falls back to the system picker (Expo Go). Shared by
  // pickPhoto and pickAndCrop.
  const openGrid = useCallback(async (): Promise<string | null> => {
    // ── ANDROID: system Photo Picker, NO media permission ──────────────────
    // Google's Photo & Video Permissions policy requires the photo picker for
    // this infrequent "upload a photo" use case, so the Android app declares no
    // READ_MEDIA_IMAGES/VIDEO (stripped via withRemovePermissions). The Android
    // Photo Picker (launchImageLibraryAsync) grants access to ONLY the picked
    // image with no permission prompt. We deliberately skip ensureMediaAccess /
    // ensureLibraryAccess on Android — those request the permissions we removed.
    // allowsEditing:false returns a raw image so pickAndCrop's CropModal crops it.
    if (Platform.OS === 'android') {
      try {
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: false, quality: 1 });
        if (res.canceled || !res.assets?.[0]) return null;
        return res.assets[0].uri;
      } catch (e: any) {
        console.warn('[PhotoPicker] android photo picker failed:', e?.message ?? String(e));
        return null;
      }
    }
    // ── iOS: custom grid that honors "Limited Access" ──────────────────────
    const access = await ensureMediaAccess();
    if (access === 'ok') {
      return new Promise<string | null>((resolve) => {
        gridResolverRef.current = resolve;
        setGridVisible(true);
      });
    }
    if (access === 'denied') return null;
    // 'unavailable' (Expo Go / module not compiled in) → system picker. No
    // limited-access grid here, but the feature still works. allowsEditing:false
    // returns a raw image so pickAndCrop's CropModal can do the cropping.
    const lib = await ensureLibraryAccess();
    if (!lib.granted) return null;
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: false, quality: 1 });
      if (res.canceled || !res.assets?.[0]) return null;
      return res.assets[0].uri;
    } catch (e: any) {
      console.warn('[PhotoPicker] system-picker fallback failed:', e?.message ?? String(e));
      return null;
    }
  }, []);

  const settleGrid = useCallback((uri: string | null) => {
    setGridVisible(false);
    const resolve = gridResolverRef.current;
    gridResolverRef.current = null;
    resolve?.(uri);
  }, []);

  const pickPhoto = useCallback(async (opts?: { base64?: boolean }): Promise<PickResult | null> => {
    const uri = await openGrid();
    if (!uri) return null;
    if (opts?.base64) {
      const dataUrl = await toDataUrl(uri);
      return { uri, dataUrl: dataUrl ?? undefined };
    }
    return { uri };
  }, [openGrid]);

  const pickAndCrop = useCallback(async (opts: CropOptions): Promise<string | null> => {
    const uri = await openGrid();
    if (!uri) return null;
    return new Promise<string | null>((resolve) => {
      setPending({ uri, aspect: opts.aspect, quality: opts.quality ?? 0.8, resolver: resolve });
    });
  }, [openGrid]);

  const handleCropClose = useCallback((croppedUri: string | null) => {
    setPending((curr) => {
      if (curr) curr.resolver(croppedUri);
      return null;
    });
  }, []);

  // Open the grid in MANAGE mode. The caller (Settings) only invokes this when
  // the user already has LIMITED photo access, so we just open the grid — the
  // grid reads the limited selection itself via getAssetsAsync.
  // We deliberately do NOT request here (requesting re-fires the system popup)
  // and do NOT gate on a re-read of the status: an earlier version checked
  // `perm.status === 'granted'` and, when expo reported the limited grant with a
  // slightly different status shape, wrongly bounced to OS Settings instead of
  // showing the grid (the "iOS limited never opens the grid" bug). We only fall
  // back to Settings when the media-library native module is genuinely
  // unavailable (Expo Go), detected by the call throwing.
  const manageLibraryAccess = useCallback(async () => {
    const hasAccess = (p: any) =>
      p?.status === 'granted' || p?.accessPrivileges === 'limited' || p?.granted === true;
    try {
      // The grid reads photos via MediaLibrary.getAssetsAsync, which needs the
      // media-library permission. On iOS that's the SAME PHPhotoLibrary grant as
      // image-picker, so a "limited" user already has it → we open the grid with
      // NO prompt. On Android the two permissions are SEPARATE, so a limited
      // image-picker user may not have media-library access yet — without it the
      // grid can only error ("Media Library permission is required"). In that
      // case we request it ONCE (the same permission the in-app photo picker
      // uses); no prompt is shown when access is already granted/limited.
      let perm: any = await MediaLibrary.getPermissionsAsync(false, ['photo']);
      if (!hasAccess(perm) && perm?.canAskAgain !== false) {
        perm = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      }
      if (hasAccess(perm)) { setManageVisible(true); return; }
    } catch {
      // media-library native module unavailable (Expo Go)
    }
    void Linking.openSettings();
  }, []);

  const value = useMemo<CropperContextValue>(() => ({ pickAndCrop, pickPhoto, manageLibraryAccess }), [pickAndCrop, pickPhoto, manageLibraryAccess]);

  return (
    <CropperContext.Provider value={value}>
      {children}
      {gridVisible && (
        <PhotoGridModal onPick={(uri) => settleGrid(uri)} onClose={() => settleGrid(null)} />
      )}
      {manageVisible && (
        <PhotoGridModal mode="manage" onPick={() => {}} onClose={() => setManageVisible(false)} />
      )}
      {pending && (
        <CropModal
          key={pending.uri}
          sourceUri={pending.uri}
          aspect={pending.aspect}
          quality={pending.quality}
          onClose={handleCropClose}
        />
      )}
    </CropperContext.Provider>
  );
}

// ── Photo-library grid (PhotoKit / MediaLibrary) ───────────────────────────

interface PhotoGridModalProps {
  onPick: (uri: string) => void;
  onClose: () => void;
  /** 'pick' (default) resolves on tap; 'manage' is view-only access management. */
  mode?: 'pick' | 'manage';
}

function PhotoGridModal({ onPick, onClose, mode = 'pick' }: PhotoGridModalProps) {
  const isManage = mode === 'manage';
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const COLS = 3;
  const GAP = 2;
  const cell = Math.floor((width - GAP * (COLS - 1)) / COLS);

  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [limited, setLimited] = useState(false);
  const [resolving, setResolving] = useState(false);
  const loadingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const hasNextRef = useRef(true);

  const loadPage = useCallback(async (reset: boolean) => {
    if (loadingRef.current) return;
    if (!reset && !hasNextRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: 90,
        after: reset ? undefined : cursorRef.current,
        mediaType: [MediaLibrary.MediaType.photo],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      cursorRef.current = page.endCursor;
      hasNextRef.current = page.hasNextPage;
      setEndCursor(page.endCursor);
      setHasNext(page.hasNextPage);
      setAssets((prev) => (reset ? page.assets : [...prev, ...page.assets]));
    } catch (e: any) {
      console.warn('[PhotoPicker] getAssetsAsync failed:', e?.message ?? String(e));
      // Stop paginating on error (e.g. missing media-library permission) so the
      // FlatList's onEndReached doesn't retry it over and over. The empty state
      // + the manage buttons still let the user change their access.
      hasNextRef.current = false;
      setHasNext(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const refreshLimitedFlag = useCallback(async () => {
    try {
      const p = await MediaLibrary.getPermissionsAsync(false, ['photo']);
      setLimited((p as any).accessPrivileges === 'limited');
    } catch {}
  }, []);

  useEffect(() => {
    void refreshLimitedFlag();
    void loadPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh when the photo library changes. iOS's
  // presentPermissionsPickerAsync (the "Gérer" button) resolves as soon as the
  // picker is PRESENTED — not when the user finishes choosing — so the reload
  // inside `manage()` ran against the OLD selection and the freshly-added
  // photos only appeared after re-opening. This observer fires once the
  // selection actually changes, so the grid updates on its own.
  useEffect(() => {
    const sub = MediaLibrary.addListener(() => {
      void refreshLimitedFlag();
      void loadPage(true);
    });
    return () => sub.remove();
  }, [loadPage, refreshLimitedFlag]);

  const pick = useCallback(async (asset: MediaLibrary.Asset) => {
    // Manage mode is view-only — the thumbnails just show what Barakeat can
    // see; the access actions live in the footer below.
    if (isManage || resolving) return;
    setResolving(true);
    try {
      // ph:// (iOS) / content:// (Android) asset URIs aren't always usable by
      // upload/manipulation — resolve to a real localUri first.
      const info = await MediaLibrary.getAssetInfoAsync(asset);
      onPick((info as any).localUri || asset.uri);
    } catch (e: any) {
      console.warn('[PhotoPicker] getAssetInfoAsync failed, using raw uri:', e?.message ?? String(e));
      onPick(asset.uri);
    } finally {
      setResolving(false);
    }
  }, [onPick, resolving, isManage]);

  const manage = useCallback(async () => {
    try {
      await MediaLibrary.presentPermissionsPickerAsync();
      await refreshLimitedFlag();
      cursorRef.current = undefined;
      hasNextRef.current = true;
      setAssets([]);
      await loadPage(true);
    } catch {}
  }, [loadPage, refreshLimitedFlag]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <StatusBar style="light" />
      <View style={[gridStyles.root, { paddingTop: insets.top }]}>
        <View style={gridStyles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={gridStyles.headerSide}>
            <Text style={gridStyles.cancel}>{t('common.cancel', { defaultValue: 'Annuler' })}</Text>
          </TouchableOpacity>
          <Text style={gridStyles.title}>
            {isManage
              ? t('photoPicker.manageTitle', { defaultValue: 'Gérer l’accès aux photos' })
              : t('photoPicker.title', { defaultValue: 'Choisir une photo' })}
          </Text>
          <View style={gridStyles.headerSide} />
        </View>

        {limited && (
          <View style={gridStyles.banner}>
            <Text style={gridStyles.bannerText} numberOfLines={2}>
              {t('photoPicker.limitedNote', { defaultValue: 'Vous avez autorisé l’accès à certaines photos seulement.' })}
            </Text>
            <TouchableOpacity onPress={manage} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={gridStyles.manage}>{t('photoPicker.manage', { defaultValue: 'Gérer' })}</Text>
            </TouchableOpacity>
          </View>
        )}

        <FlatList
          data={assets}
          keyExtractor={(a) => a.id}
          numColumns={COLS}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => pick(item)}
              style={{ width: cell, height: cell, marginRight: index % COLS === COLS - 1 ? 0 : GAP, marginBottom: GAP }}
            >
              {/* expo-image renders ph:// (iOS) and content:// (Android) asset
                  URIs directly — RN's <Image> shows them as grey blanks. */}
              <ExpoImage source={{ uri: item.uri }} style={gridStyles.thumb} contentFit="cover" transition={120} recyclingKey={item.id} />
            </TouchableOpacity>
          )}
          onEndReachedThreshold={0.6}
          onEndReached={() => loadPage(false)}
          ListEmptyComponent={!loading ? (
            <View style={gridStyles.empty}>
              <Text style={gridStyles.emptyText}>{t('photoPicker.empty', { defaultValue: 'Aucune photo disponible.' })}</Text>
              {limited && (
                <TouchableOpacity onPress={manage} style={{ marginTop: 12 }}>
                  <Text style={gridStyles.manage}>{t('photoPicker.allowMore', { defaultValue: 'Autoriser plus de photos' })}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}
          ListFooterComponent={loading && assets.length > 0 ? <ActivityIndicator color="#114b3c" style={{ marginVertical: 16 }} /> : null}
        />

        {isManage && (
          <View style={[gridStyles.manageFooter, { paddingBottom: (insets.bottom || 0) + 14 }]}>
            {/* Adding / removing photos from the allowed subset is the "Gérer"
                button in the banner above. iOS doesn't let an app switch to full
                access or revoke from inside the app — those happen in OS Settings. */}
            <TouchableOpacity onPress={() => { void Linking.openSettings(); }} style={gridStyles.manageAction}>
              <Text style={gridStyles.manageActionText}>
                {t('photoPicker.allowFull', { defaultValue: 'Autoriser toutes les photos' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { void Linking.openSettings(); }} style={gridStyles.manageAction}>
              <Text style={[gridStyles.manageActionText, { color: '#ff6b6b' }]}>
                {t('photoPicker.removeAccess', { defaultValue: 'Retirer l’accès aux photos' })}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {resolving && (
          <View style={gridStyles.resolveOverlay} pointerEvents="auto">
            <ActivityIndicator color="#fff" size="large" />
          </View>
        )}
      </View>
    </Modal>
  );
}

const gridStyles = StyleSheet.create({
  // Dark palette to match the native iOS photo selector.
  root: { flex: 1, backgroundColor: '#0d0d0d' },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ffffff1a',
  },
  headerSide: { minWidth: 72 },
  cancel: { color: '#fff', fontSize: 15, fontFamily: 'Poppins_500Medium' },
  title: { color: '#fff', fontSize: 16, fontFamily: 'Poppins_700Bold' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff12',
  },
  bannerText: { flex: 1, color: '#cfcfcf', fontSize: 12, fontFamily: 'Poppins_400Regular', lineHeight: 16 },
  manage: { color: '#e3ff5c', fontSize: 13, fontFamily: 'Poppins_700Bold' },
  thumb: { width: '100%', height: '100%', backgroundColor: '#222' },
  manageFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ffffff1a',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    backgroundColor: '#111',
  },
  manageActionPrimary: {
    backgroundColor: '#e3ff5c',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  manageActionPrimaryText: { color: '#114b3c', fontSize: 14, fontFamily: 'Poppins_700Bold' },
  manageAction: {
    backgroundColor: '#ffffff12',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  manageActionText: { color: '#fff', fontSize: 14, fontFamily: 'Poppins_600SemiBold' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyText: { color: '#999', fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center' },
  resolveOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// ── The crop modal ─────────────────────────────────────────────────────────

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
                : t('common.confirm', { defaultValue: 'Confirmer' })}
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
