/**
 * (1) Clean the iOS icon's background to FLAT brand-green (#114b3c), removing
 *     the soft glow/vignette that haloed the B + ring, and
 * (2) regenerate a SMALLER Android adaptive foreground from the cleaned image.
 *
 * The far background is already ~#114b3c; only a luminous glow hugged the logo.
 * The logo is bright yellow (R≈224) while the glow/background is green (R<130),
 * so an R-channel alpha cleanly separates them: keep the bright logo, blend the
 * rest down to pure green. The logo's own anti-aliased edge survives as a thin
 * blend so nothing looks cut (no hard rectangle).
 *
 * Writes PREVIEW files first (originals untouched) so the result can be eyeballed
 * before committing:
 *   barakeat_icon_ios_clean.png   — cleaned, full-bleed (future iOS icon)
 *   android-foreground-clean.png  — cleaned + scaled 0.64 (future Android icon)
 *   android-device-preview.png    — launcher crop+squircle simulation
 *
 * Run:  node scripts/clean-and-regen-icons.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DIR = path.join(__dirname, '..', 'assets', 'images');
const BG = [17, 75, 60];   // #114b3c
const CANVAS = 1024;
const ANDROID_SCALE = 0.64; // smaller than the previous 0.71 (logo ~40% fill)
// R-channel band that separates the bright yellow logo from the green glow.
// R below LO → pure green; above HI → original logo; between → smooth edge.
const R_LO = 120;
const R_HI = 195;

function read(f) { return PNG.sync.read(fs.readFileSync(path.join(DIR, f))); }

// Flatten the glow: every pixel becomes blend(pureGreen, original, alpha),
// alpha rising with the red channel (logo-ness).
function cleanBackground(src) {
  const { width: W, height: H } = src;
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    const r = src.data[i * 4], g = src.data[i * 4 + 1], b = src.data[i * 4 + 2];
    let a = (r - R_LO) / (R_HI - R_LO);
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    a = a * a * (3 - 2 * a); // smoothstep for a gentle edge
    out.data[i * 4]     = Math.round(BG[0] * (1 - a) + r * a);
    out.data[i * 4 + 1] = Math.round(BG[1] * (1 - a) + g * a);
    out.data[i * 4 + 2] = Math.round(BG[2] * (1 - a) + b * a);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

// Bilinear-downscale the WHOLE src image into a dw×dh RGBA buffer.
function resizeAll(src, dw, dh) {
  const { width: sw, height: sh } = src;
  const out = Buffer.alloc(dw * dh * 4);
  const at = (xx, yy, c) => src.data[(yy * sw + xx) * 4 + c];
  for (let y = 0; y < dh; y++) {
    const fy = (y / dh) * sh;
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = (x / dw) * sw;
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const top = at(x0, y0, c) * (1 - wx) + at(x1, y0, c) * wx;
        const bot = at(x0, y1, c) * (1 - wx) + at(x1, y1, c) * wx;
        out[(y * dw + x) * 4 + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }
  return out;
}

// 1) Clean the iOS master.
const cleaned = cleanBackground(read('barakeat_icon_ios.png'));
fs.writeFileSync(path.join(DIR, 'barakeat_icon_ios_clean.png'), PNG.sync.write(cleaned));
console.log('barakeat_icon_ios_clean.png written (flat #114b3c background)');

// 2) Android foreground: whole cleaned image scaled down, centred on flat green.
const dw = Math.round(CANVAS * ANDROID_SCALE), dh = dw;
const small = resizeAll(cleaned, dw, dh);
const android = new PNG({ width: CANVAS, height: CANVAS });
for (let i = 0; i < CANVAS * CANVAS; i++) {
  android.data[i * 4] = BG[0]; android.data[i * 4 + 1] = BG[1]; android.data[i * 4 + 2] = BG[2]; android.data[i * 4 + 3] = 255;
}
const ox = Math.round((CANVAS - dw) / 2), oy = Math.round((CANVAS - dh) / 2);
for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
  const di = ((oy + y) * CANVAS + (ox + x)) * 4, si = (y * dw + x) * 4;
  android.data[di] = small[si]; android.data[di + 1] = small[si + 1]; android.data[di + 2] = small[si + 2]; android.data[di + 3] = 255;
}
fs.writeFileSync(path.join(DIR, 'android-foreground-clean.png'), PNG.sync.write(android));
console.log(`android-foreground-clean.png written (scale ${ANDROID_SCALE})`);

// 3) Device-accurate preview: launcher crop (central 70%) + squircle mask.
const PREVIEW = 512, cropFrac = 0.70;
const start = Math.round(CANVAS * (1 - cropFrac) / 2), span = Math.round(CANVAS * cropFrac);
const prev = new PNG({ width: PREVIEW, height: PREVIEW });
const r = PREVIEW / 2, n = 4;
for (let y = 0; y < PREVIEW; y++) for (let x = 0; x < PREVIEW; x++) {
  const sx = start + Math.floor((x / PREVIEW) * span);
  const sy = start + Math.floor((y / PREVIEW) * span);
  const si = (sy * CANVAS + sx) * 4, di = (y * PREVIEW + x) * 4;
  const nx = Math.abs((x - r) / r), ny = Math.abs((y - r) / r);
  const inside = Math.pow(nx, n) + Math.pow(ny, n) <= 1;
  prev.data[di] = android.data[si]; prev.data[di + 1] = android.data[si + 1];
  prev.data[di + 2] = android.data[si + 2]; prev.data[di + 3] = inside ? 255 : 0;
}
fs.writeFileSync(path.join(DIR, 'android-device-preview.png'), PNG.sync.write(prev));
console.log('android-device-preview.png written');
