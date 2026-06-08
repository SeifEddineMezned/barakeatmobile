/**
 * Icon8 — the icons8 asset icons used inside the 3-dot action menus, replacing
 * the generic lucide glyphs that read as "AI-ish".
 *
 *   EditIcon8       → icons8-edit-96.png    (edit / modifier)
 *   RoleIcon8       → icons8-job-100.png    (change role / changer le rôle)
 *   PermissionIcon8 → icons8-approval-100.png (permissions)
 *   PlayIcon8       → icons8-play-90.png    (resume basket / reprendre)
 *   PauseIcon8      → icons8-pause-90.png   (pause basket / mettre en pause)
 *   FlagIcon8       → icons8-flag-100.png   (signaler on past-order card)
 *   DeleteIcon8     → icons8-delete.svg, tinted red (delete / supprimer)
 *
 * The PNGs render via <Image>. The delete glyph is a single monochrome path,
 * so it's inlined as XML and rendered through react-native-svg's SvgXml with
 * `fill="currentColor"` + a `color` prop — no svg-transformer dependency needed.
 */
import React from 'react';
import { Image } from 'react-native';
import { SvgXml } from 'react-native-svg';

const editPng = require('@/assets/images/icons8-edit-96.png');
const rolePng = require('@/assets/images/icons8-job-100.png');
const approvalPng = require('@/assets/images/icons8-approval-100.png');
const playPng = require('@/assets/images/icons8-play-90.png');
const pausePng = require('@/assets/images/icons8-pause-90.png');
const flagPng = require('@/assets/images/icons8-flag-100.png');

// icons8-delete.svg inlined, with fill set to currentColor so the `color`
// prop drives the tint (defaults to the app's destructive red).
const DELETE_XML =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="30" height="30">' +
  '<path fill="currentColor" d="M 14.984375 2.4863281 A 1.0001 1.0001 0 0 0 14 3.5 L 14 4 L 8.5 4 A 1.0001 1.0001 0 0 0 7.4863281 5 L 6 5 A 1.0001 1.0001 0 1 0 6 7 L 24 7 A 1.0001 1.0001 0 1 0 24 5 L 22.513672 5 A 1.0001 1.0001 0 0 0 21.5 4 L 16 4 L 16 3.5 A 1.0001 1.0001 0 0 0 14.984375 2.4863281 z M 6 9 L 7.7929688 24.234375 C 7.9109687 25.241375 8.7633438 26 9.7773438 26 L 20.222656 26 C 21.236656 26 22.088031 25.241375 22.207031 24.234375 L 24 9 L 6 9 z"/>' +
  '</svg>';

type PngIconProps = { size?: number; tintColor?: string };

export function EditIcon8({ size = 18, tintColor }: PngIconProps) {
  return <Image source={editPng} style={{ width: size, height: size, ...(tintColor ? { tintColor } : null) }} resizeMode="contain" />;
}

export function RoleIcon8({ size = 18, tintColor }: PngIconProps) {
  return <Image source={rolePng} style={{ width: size, height: size, ...(tintColor ? { tintColor } : null) }} resizeMode="contain" />;
}

export function PermissionIcon8({ size = 18, tintColor }: PngIconProps) {
  return <Image source={approvalPng} style={{ width: size, height: size, ...(tintColor ? { tintColor } : null) }} resizeMode="contain" />;
}

export function PlayIcon8({ size = 18, tintColor }: PngIconProps) {
  return <Image source={playPng} style={{ width: size, height: size, ...(tintColor ? { tintColor } : null) }} resizeMode="contain" />;
}

export function PauseIcon8({ size = 18, tintColor }: PngIconProps) {
  return <Image source={pausePng} style={{ width: size, height: size, ...(tintColor ? { tintColor } : null) }} resizeMode="contain" />;
}

export function FlagIcon8({ size = 18, tintColor }: PngIconProps) {
  return <Image source={flagPng} style={{ width: size, height: size, ...(tintColor ? { tintColor } : null) }} resizeMode="contain" />;
}

export function DeleteIcon8({ size = 18, color = '#b94545' }: { size?: number; color?: string }) {
  return <SvgXml xml={DELETE_XML} width={size} height={size} color={color} />;
}
