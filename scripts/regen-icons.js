/**
 * One-off icon regenerator (item 0a).
 *
 * The shipped icons had the "B + halo" biased left/up and, on Android, sitting
 * too large inside the adaptive safe zone. Both icons are a solid brand-green
 * (#114b3c) square with the logo drawn on top, so we can: detect the logo's
 * bounding box (pixels that differ from the green), then re-composite that crop
 * CENTERED on a fresh green canvas at a calmer fill ratio. Because the source
 * and the new canvas share the exact same green, the crop's margins blend in
 * seamlessly — no transparency/matting needed.
 *
 * Outputs new files (originals are left untouched for comparison):
 *   assets/images/barakeat_icon_ios.png      — recentred, ~64% fill
 *   assets/images/barakeat_icon_android.png  — recentred, ~46% fill (more padding)
 *
 * Run:  node scripts/regen-icons.js   (needs pngjs:  npm i pngjs --no-save)
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const DIR = path.join(__dirname, '..', 'assets', 'images');
const BG = [17, 75, 60]; // #114b3c
const CANVAS = 1024;

function read(f) { return PNG.sync.read(fs.readFileSync(path.join(DIR, f))); }

function logoBBox(p) {
  const { width: W, height: H, data } = p;
  const dist = (x, y) => {
    const i = (y * W + x) * 4;
    return Math.abs(data[i] - BG[0]) + Math.abs(data[i + 1] - BG[1]) + Math.abs(data[i + 2] - BG[2]);
  };
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (dist(x, y) > 60) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Bilinear-resize a crop (sx,sy,sw,sh) of src into a dw×dh RGBA buffer.
function resizeCrop(src, sx, sy, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const at = (xx, yy, c) => src.data[(yy * src.width + xx) * 4 + c];
  for (let y = 0; y < dh; y++) {
    const fy = sy + (y / dh) * sh;
    const y0 = Math.floor(fy), y1 = Math.min(sy + sh - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = sx + (x / dw) * sw;
      const x0 = Math.floor(fx), x1 = Math.min(sx + sw - 1, x0 + 1), wx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const top = at(x0, y0, c) * (1 - wx) + at(x1, y0, c) * wx;
        const bot = at(x0, y1, c) * (1 - wx) + at(x1, y1, c) * wx;
        out[(y * dw + x) * 4 + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }
  return out;
}

function generate(srcFile, outFile, fillH) {
  const src = read(srcFile);
  const bb = logoBBox(src);
  const aspect = bb.w / bb.h;
  const dh = Math.round(fillH * CANVAS);
  const dw = Math.round(dh * aspect);
  const crop = resizeCrop(src, bb.minX, bb.minY, bb.w, bb.h, dw, dh);

  const out = new PNG({ width: CANVAS, height: CANVAS });
  for (let i = 0; i < CANVAS * CANVAS; i++) {
    out.data[i * 4] = BG[0]; out.data[i * 4 + 1] = BG[1]; out.data[i * 4 + 2] = BG[2]; out.data[i * 4 + 3] = 255;
  }
  const ox = Math.round((CANVAS - dw) / 2), oy = Math.round((CANVAS - dh) / 2);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const di = ((oy + y) * CANVAS + (ox + x)) * 4, si = (y * dw + x) * 4;
    out.data[di] = crop[si]; out.data[di + 1] = crop[si + 1]; out.data[di + 2] = crop[si + 2]; out.data[di + 3] = 255;
  }
  fs.writeFileSync(path.join(DIR, outFile), PNG.sync.write(out));
  console.log(`${outFile}: logo ${bb.w}x${bb.h} → ${dw}x${dh} centred on ${CANVAS}² (fillH=${fillH})`);
}

// iOS source has the highest-resolution logo → use it as the master for both.
generate('barakeat_halo_logo_ios.png', 'barakeat_icon_ios.png', 0.64);
generate('barakeat_halo_logo_ios.png', 'barakeat_icon_android.png', 0.46);
