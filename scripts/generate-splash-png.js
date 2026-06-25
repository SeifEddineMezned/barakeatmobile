/*
 * One-shot generator for the native splash image. Produces a PNG that
 * matches the JS splash (BarakeatHaloSplash) initial-pose frame
 * pixel-for-pixel, so the native-splash → animated-splash handoff has
 * nothing to mismatch.
 *
 * Re-run after ANY geometry change in
 * src/components/animations/BarakeatHaloSplash.tsx CONFIG block — the
 * CONFIG values below must stay in sync with that file.
 *
 * Install deps once (devDeps):
 *   npm install --save-dev opentype.js @resvg/resvg-js
 *
 * Run:
 *   node scripts/generate-splash-png.js
 *
 * Output:
 *   assets/images/barakeat_splash.png  (1500 × 3246, aspect-matches phones)
 *
 * After running, point app.json's splash.image at the new file and
 * rebuild (EAS build / expo prebuild → expo run:ios/android).
 */

const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');
const { Resvg } = require('@resvg/resvg-js');

// ── Keep in lockstep with src/components/animations/BarakeatHaloSplash.tsx
//    CONFIG. The whole point of this script is to render the same geometry
//    a different way (rasterised PNG vs. live SVG) — drift between the two
//    re-introduces the jump we're trying to kill.
const CONFIG = {
  bg: '#114b3c',
  lime: '#DCF94F',
  ringGlow: '#E9FF79',
  scale: 0.65,
  centerY: 422,
  tiltDeg: -10,
  aboveFactor: 0.72,
};

const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Chillax-Bold.ttf');
const OUT_PATH = path.join(__dirname, '..', 'assets', 'images', 'barakeat_splash.png');
const VIEWBOX_W = 390;
const VIEWBOX_H = 844;
const OUT_W = 1500;
const OUT_H = Math.round((VIEWBOX_H / VIEWBOX_W) * OUT_W);

(async () => {
  if (!fs.existsSync(FONT_PATH)) {
    console.error(`[splash-png] Chillax-Bold.ttf not found at ${FONT_PATH}`);
    process.exit(1);
  }

  // opentype.load(path) is deprecated in current opentype.js — use parse(buffer).
  // Slice into an ArrayBuffer view so the parser doesn't choke on shared buffers.
  const fontBuf = fs.readFileSync(FONT_PATH);
  const fontAb = fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength);
  const font = opentype.parse(fontAb);

  const S = CONFIG.scale;
  const CX = 195;
  const CY = CONFIG.centerY;
  const H_ELLIPSE = 238 * S;
  const halfW = (200 * S) / 2;
  const rx = 1.23 * halfW;
  const ry = rx * 0.126;
  const ABOVE = CONFIG.aboveFactor * H_ELLIPSE;
  const f = S / 0.84;
  const B_FONT_SIZE = 340 * S;
  const initialCy = CY - ABOVE;

  // Tiny per-renderer nudge — MUST stay in lockstep with B_NUDGE_X/Y in
  // src/components/animations/BarakeatHaloSplash.tsx. Pushes the rendered
  // B right-and-up by these viewBox units so the static PNG B lands at the
  // same visual pixels as the live SVG B in the loading animation. Without
  // this, the splash B sat very slightly left-and-down of the animation B
  // — a 2-px misalignment visible at the native→JS handoff and reported
  // as "the splash B isn't quite centered with the animation B".
  const B_NUDGE_X = 2;
  const B_NUDGE_Y = -2;

  // Centre the B's bounding box at (CX + nudge, CY + nudge). opentype.js
  // draws from the baseline-left; SvgText with textAnchor="middle" +
  // alignmentBaseline="central" centres by glyph bbox. Match that by
  // measuring first, then re-drawing with a translation that puts the
  // bbox centre on the nudged target.
  const probe = font.getPath('B', 0, 0, B_FONT_SIZE);
  const bbox = probe.getBoundingBox();
  const bCx = (bbox.x1 + bbox.x2) / 2;
  const bCy = (bbox.y1 + bbox.y2) / 2;
  const tx = (CX + B_NUDGE_X) - bCx;
  const ty = (CY + B_NUDGE_Y) - bCy;
  const bPath = font.getPath('B', tx, ty, B_FONT_SIZE);
  const bPathData = bPath.toPathData();

  // Halo layer stack — same five ellipses as the live SVG component, same
  // strokes and opacities. Rendered inside two <g> wrappers below, each
  // with a clipPath that exposes the top half (back) or bottom half (front)
  // of the rotated ring so the B can sit between them.
  const haloLayers = `
    <ellipse rx="${rx * 1.08}" ry="${ry * 1.5}" fill="none" stroke="${CONFIG.ringGlow}" stroke-width="${24 * f}" stroke-opacity="0.05"/>
    <ellipse rx="${rx * 1.03}" ry="${ry * 1.18}" fill="none" stroke="${CONFIG.ringGlow}" stroke-width="${16 * f}" stroke-opacity="0.14"/>
    <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="${CONFIG.ringGlow}" stroke-width="${18 * f}" stroke-opacity="0.34"/>
    <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="url(#ringGradient)" stroke-width="${14 * f}"/>
    <ellipse rx="${rx}" ry="${ry}" fill="none" stroke="#FFFFFF" stroke-width="${2.4 * f}" stroke-opacity="0.85" stroke-dasharray="${rx * 1.4} ${rx * 10}" stroke-dashoffset="${rx * 0.6}" stroke-linecap="round"/>
  `;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWBOX_W}" height="${VIEWBOX_H}" viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_H}">
  <defs>
    <linearGradient id="bGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#EBFF85"/>
      <stop offset="0.55" stop-color="${CONFIG.lime}"/>
      <stop offset="1" stop-color="#B5D62A"/>
    </linearGradient>
    <linearGradient id="ringGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#EEFF8C"/>
      <stop offset="0.5" stop-color="${CONFIG.lime}"/>
      <stop offset="1" stop-color="#9DC520"/>
    </linearGradient>
    <clipPath id="haloBack">
      <rect x="${-rx * 1.5}" y="${-rx}" width="${rx * 3}" height="${rx}"/>
    </clipPath>
    <clipPath id="haloFront">
      <rect x="${-rx * 1.5}" y="0" width="${rx * 3}" height="${rx}"/>
    </clipPath>
  </defs>
  <rect width="${VIEWBOX_W}" height="${VIEWBOX_H}" fill="${CONFIG.bg}"/>
  <g transform="translate(${CX} ${initialCy}) rotate(${CONFIG.tiltDeg})" clip-path="url(#haloBack)">
    ${haloLayers}
  </g>
  <path d="${bPathData}" fill="url(#bGradient)"/>
  <g transform="translate(${CX} ${initialCy}) rotate(${CONFIG.tiltDeg})" clip-path="url(#haloFront)">
    ${haloLayers}
  </g>
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: OUT_W },
    background: CONFIG.bg,
  });
  const pngData = resvg.render();
  const pngBuf = pngData.asPng();
  fs.writeFileSync(OUT_PATH, pngBuf);
  console.log(`[splash-png] wrote ${OUT_PATH} — ${OUT_W}×${OUT_H}, ${(pngBuf.length / 1024).toFixed(1)} KB`);
})().catch((err) => {
  console.error('[splash-png] failed:', err);
  process.exit(1);
});
