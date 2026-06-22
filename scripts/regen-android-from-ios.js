/**
 * Regenerate the ANDROID adaptive-icon foreground from the *current* iOS icon.
 *
 * NO cropping, NO recompositing. We take the whole hand-tuned
 * `barakeat_icon_ios.png` AS-IS, shrink the entire image, and centre it on a
 * green canvas so there's padding around it — because Android launchers crop
 * the outer ~third of the foreground and would otherwise clip the halo.
 *
 * The iOS image's own background is already the brand green (#114b3c), so the
 * padding we add is the exact same green — it blends in seamlessly.
 *
 * The iOS logo fills ~62% of the canvas height; we scale the whole picture to
 * SCALE so the logo lands at ~44% — comfortable inside the adaptive safe zone.
 *
 * Run:  node scripts/regen-android-from-ios.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DIR = path.join(__dirname, '..', 'assets', 'images');
const BG = [17, 75, 60]; // #114b3c
const CANVAS = 1024;
const SCALE = 0.64;      // shrink the whole iOS image: 60% logo-fill * 0.64 ≈ 38% (extra safe-zone padding)

function read(f) { return PNG.sync.read(fs.readFileSync(path.join(DIR, f))); }

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

const src = read('barakeat_icon_ios.png');
const dw = Math.round(CANVAS * SCALE), dh = Math.round(CANVAS * SCALE);
const small = resizeAll(src, dw, dh);

const out = new PNG({ width: CANVAS, height: CANVAS });
for (let i = 0; i < CANVAS * CANVAS; i++) {
  out.data[i * 4] = BG[0]; out.data[i * 4 + 1] = BG[1]; out.data[i * 4 + 2] = BG[2]; out.data[i * 4 + 3] = 255;
}
const ox = Math.round((CANVAS - dw) / 2), oy = Math.round((CANVAS - dh) / 2);
for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
  const di = ((oy + y) * CANVAS + (ox + x)) * 4, si = (y * dw + x) * 4;
  out.data[di] = small[si]; out.data[di + 1] = small[si + 1]; out.data[di + 2] = small[si + 2]; out.data[di + 3] = 255;
}
fs.writeFileSync(path.join(DIR, 'barakeat_icon_android.png'), PNG.sync.write(out));
console.log(`barakeat_icon_android.png: whole iOS image scaled ${SCALE} → ${dw}x${dh} centred on ${CANVAS}² green`);

// --- Device-accurate preview: simulate the launcher crop (central 70%) + squircle mask ---
const PREVIEW = 512;
const cropFrac = 0.70;
const start = Math.round(CANVAS * (1 - cropFrac) / 2);
const span = Math.round(CANVAS * cropFrac);
const prev = new PNG({ width: PREVIEW, height: PREVIEW });
const r = PREVIEW / 2, n = 4;
for (let y = 0; y < PREVIEW; y++) for (let x = 0; x < PREVIEW; x++) {
  const sx = start + Math.floor((x / PREVIEW) * span);
  const sy = start + Math.floor((y / PREVIEW) * span);
  const si = (sy * CANVAS + sx) * 4, di = (y * PREVIEW + x) * 4;
  const nx = Math.abs((x - r) / r), ny = Math.abs((y - r) / r);
  const inside = Math.pow(nx, n) + Math.pow(ny, n) <= 1;
  prev.data[di] = out.data[si]; prev.data[di + 1] = out.data[si + 1];
  prev.data[di + 2] = out.data[si + 2]; prev.data[di + 3] = inside ? 255 : 0;
}
fs.writeFileSync(path.join(DIR, 'android-device-preview.png'), PNG.sync.write(prev));
console.log('android-device-preview.png: launcher crop+squircle simulation written');
