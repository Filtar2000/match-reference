#!/usr/bin/env node
// Resize a PNG to given pixel dimensions (bilinear), using pngjs.
// Works without ImageMagick.
//
// Why you need it: compare.mjs requires the two images to have the SAME pixel
// dimensions. A real reference (a phone screenshot, a mockup exported at some
// arbitrary size, a compressed image) rarely matches your build's viewport out
// of the box. Normalize one of them to the other's size before diffing.
//
// Usage:
//   node resize.mjs <in.png> <out.png> <width> [height]
//
//   - if <height> is omitted, it is derived from <width> keeping aspect ratio.
//
// Examples:
//   # bring the reference down to your build's exact size:
//   node resize.mjs reference/raw.png reference/target.png 900 520
//   # scale keeping aspect (e.g. a retina @2x reference down to @1x width):
//   node resize.mjs reference/raw@2x.png reference/target.png 900
//
// NOTE: any resize blurs slightly. After a resize, don't chase a 0% diff —
// raise compare.mjs --threshold (e.g. 0.2-0.3) and judge structure per region.

import fs from 'fs';
import { PNG } from 'pngjs';

const [inPath, outPath, ws, hs] = process.argv.slice(2);
if (!inPath || !outPath || !ws) {
  console.error('Usage: node resize.mjs <in.png> <out.png> <width> [height]');
  process.exit(1);
}

const src = PNG.sync.read(fs.readFileSync(inPath));
const dw = parseInt(ws, 10);
const dh = hs ? parseInt(hs, 10) : Math.max(1, Math.round(dw * src.height / src.width));
const dst = new PNG({ width: dw, height: dh });

const at = (img, x, y, c) => img.data[(img.width * y + x) * 4 + c];

for (let y = 0; y < dh; y++) {
  const sy = ((y + 0.5) * src.height) / dh - 0.5;
  const y0 = Math.max(0, Math.floor(sy));
  const y1 = Math.min(src.height - 1, y0 + 1);
  const fy = Math.min(1, Math.max(0, sy - y0));
  for (let x = 0; x < dw; x++) {
    const sx = ((x + 0.5) * src.width) / dw - 0.5;
    const x0 = Math.max(0, Math.floor(sx));
    const x1 = Math.min(src.width - 1, x0 + 1);
    const fx = Math.min(1, Math.max(0, sx - x0));
    const o = (dw * y + x) * 4;
    for (let c = 0; c < 4; c++) {
      const top = at(src, x0, y0, c) * (1 - fx) + at(src, x1, y0, c) * fx;
      const bot = at(src, x0, y1, c) * (1 - fx) + at(src, x1, y1, c) * fx;
      dst.data[o + c] = Math.round(top * (1 - fy) + bot * fy);
    }
  }
}

fs.writeFileSync(outPath, PNG.sync.write(dst));
console.log('OK ' + outPath + ' (' + src.width + 'x' + src.height + ' -> ' + dw + 'x' + dh + ')');
