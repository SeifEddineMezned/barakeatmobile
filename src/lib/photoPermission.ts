/**
 * Centralised photo-library / camera permission gating for every image picker
 * in the app.
 *
 * Two problems this solves:
 *
 *  1. Silent no-ops. The old per-callsite checks did `if (status !== 'granted')
 *     return;` (or showed a tiny toast), so a user who had denied access just
 *     tapped a "choose photo" button and nothing happened. These helpers show a
 *     branded Barakeat popup that explains the problem and offers a one-tap
 *     jump to the OS Settings.
 *
 *  2. iOS "Limited Access". `ensureLibraryAccess` returns `granted: true` for
 *     BOTH full and limited access — we never block a limited user. To make the
 *     picker actually RESPECT the limited selection (show only the photos the
 *     user allowed, not the whole library), the picker must run through iOS's
 *     legacy UIImagePickerController, which honors limited access. In
 *     expo-image-picker that path is selected by `allowsEditing: true`
 *     (PHPicker — used when allowsEditing is false — always shows the entire
 *     library and ignores the limited set). So every library pick on iOS passes
 *     `allowsEditing: true`. See ImagePickerModule.swift (`if !allowsEditing
 *     && sourceType != .camera { <PHPicker> }`).
 *
 * The branded popup is shown via the global alert bridge (showGlobalAlert) so
 * these helpers work from anywhere — screens AND non-screen providers like the
 * ImageCropper — without threading a `showAlert` callback through every caller.
 */
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';
import i18n from '@/src/i18n';
import { showGlobalAlert } from '@/src/components/CustomAlert';

export interface LibraryAccess {
  /** True for full OR limited access — a limited user is never blocked. */
  granted: boolean;
  /** iOS only: the user granted access to a restricted subset of photos. */
  limited: boolean;
}

function denialAlert(kind: 'photos' | 'camera') {
  const t = i18n.t.bind(i18n);
  const title =
    kind === 'camera'
      ? t('permissions.cameraTitle', { defaultValue: 'Accès à l’appareil photo requis' })
      : t('permissions.photosTitle', { defaultValue: 'Accès aux photos requis' });
  const body =
    kind === 'camera'
      ? t('permissions.cameraBody', {
          defaultValue:
            "Barakeat n’a pas l’autorisation d’utiliser votre appareil photo. Activez-la dans les Réglages pour prendre une photo.",
        })
      : t('permissions.photosBody', {
          defaultValue:
            "Barakeat n’a pas l’autorisation d’accéder à vos photos. Activez-la dans les Réglages pour choisir une image.",
        });
  showGlobalAlert(title, body, [
    { text: t('common.cancel', { defaultValue: 'Annuler' }), style: 'cancel' },
    {
      text: t('permissions.openSettings', { defaultValue: 'Ouvrir les Réglages' }),
      onPress: () => { void Linking.openSettings(); },
    },
  ]);
}

/**
 * Request photo-library read access. On denial, shows the branded "go to
 * Settings" popup and returns `granted: false`. Limited access counts as
 * granted (callers must use `allowsEditing: true` on the subsequent pick so the
 * limited set is honored — see the module header).
 */
export async function ensureLibraryAccess(): Promise<LibraryAccess> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  const granted = perm.status === 'granted';
  const limited = (perm as any).accessPrivileges === 'limited';
  if (!granted) denialAlert('photos');
  return { granted, limited };
}

/**
 * Request camera access. On denial, shows the branded popup and returns false.
 */
export async function ensureCameraAccess(): Promise<boolean> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  const granted = perm.status === 'granted';
  if (!granted) denialAlert('camera');
  return granted;
}
