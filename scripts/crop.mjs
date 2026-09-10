#!/usr/bin/env node
// Crop a REGION out of a PNG (header, table, summary, ...).
// Lets you calibrate one zone at a time instead of the whole image.
// Uses pngjs, so it works even when ImageMagick is not installed.
//
// Usage:
//   node crop.mjs <in.png> <out.png> <x> <y> <w> <h>
//
// Example (crop a 120px-tall header across the full 1536 width):
//   node crop.mjs shots/mine.png shots/mine-header.png 0 0 1536 120
//   node crop.mjs reference/target.png reference/target-header.png 0 0 1536 120
// then:
//   node compare.mjs reference/target-header.png shots/mine-header.png diff/header.png

import fs from 'fs';
import { PNG } from 'pngjs';

const [inPath, outPath, xs, ys, ws, hs] = process.argv.slice(2);
if (!inPath || !outPath || xs === undefined) {
  console.error('Usage: node crop.mjs <in.png> <out.png> <x> <y> <w> <h>');
  process.exit(1);
}
const x = parseInt(xs, 10), y = parseInt(ys, 10);
const w = parseInt(ws, 10), h = parseInt(hs, 10);

const src = PNG.sync.read(fs.readFileSync(inPath));
if (x < 0 || y < 0 || x + w > src.width || y + h > src.height) {
  console.error('Region out of bounds. Image is ' + src.width + 'x' + src.height);
  process.exit(2);
}
const dst = new PNG({ width: w, height: h });
PNG.bitblt(src, dst, x, y, w, h, 0, 0);
fs.writeFileSync(outPath, PNG.sync.write(dst));
console.log('OK ' + outPath + ' (' + w + 'x' + h + ' from ' + x + ',' + y + ')');
