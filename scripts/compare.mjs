#!/usr/bin/env node
// PIXEL DIFF between the golden reference and a candidate screenshot.
// Writes a diff PNG (differing zones in bright pink) and prints the measured gap.
//
// Usage:
//   node compare.mjs <reference.png> <candidate.png> <diff.png> [--threshold 0.12] [--aa] [--engine odiff]
//
//   --threshold  per-pixel sensitivity 0..1 (default 0.12; lower = stricter)
//   --aa         include anti-aliasing differences (default: ignored)
//   --engine     "pixelmatch" (default) or "odiff" (optional native fast path for
//                huge full-page images; needs the odiff-bin optional dependency).
//                NOTE: odiff's AA filter can hide subtle colour/weight changes —
//                prefer pixelmatch when chasing small style tweaks.
//
// If the two images have different dimensions, it says so and exits: re-shoot
// with the same viewport as the reference (capture.mjs --width/--height).
//
// Exit code 0 even with differences: this is a measurement tool, not a test
// that fails. Read the printed percentage.

import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const refPath = process.argv[2];
const candPath = process.argv[3];
const diffPath = process.argv[4];
if (!refPath || !candPath || !diffPath) {
  console.error('Usage: node compare.mjs <reference.png> <candidate.png> <diff.png> [--threshold 0.12] [--aa]');
  process.exit(1);
}

const threshold = parseFloat(arg('threshold', '0.12'));
const includeAA = arg('aa', false) === true;
const engine = String(arg('engine', 'pixelmatch'));

if (engine === 'odiff') {
  try {
    const { compare } = await import('odiff-bin');
    const res = await compare(refPath, candPath, diffPath, { threshold, antialiasing: !includeAA });
    if (res.match) console.log('Differing pixels: 0  (0.000%)  [odiff]');
    else console.log('Differing pixels: ' + (res.diffCount ?? '?') + '  (' +
      (res.diffPercentage != null ? res.diffPercentage.toFixed(3) : '?') + '%)  [odiff]');
    console.log('Diff saved:       ' + diffPath);
    process.exit(0);
  } catch (e) {
    console.error('odiff unavailable (' + e.message + '), falling back to pixelmatch.');
  }
}

const ref = PNG.sync.read(fs.readFileSync(refPath));
const cand = PNG.sync.read(fs.readFileSync(candPath));

if (ref.width !== cand.width || ref.height !== cand.height) {
  console.error('SIZE MISMATCH:');
  console.error('  reference: ' + ref.width + 'x' + ref.height);
  console.error('  candidate: ' + cand.width + 'x' + cand.height);
  console.error('Re-shoot with the same viewport as the reference.');
  process.exit(3);
}

const { width, height } = ref;
const diff = new PNG({ width, height });
const mismatched = pixelmatch(ref.data, cand.data, diff.data, width, height, {
  threshold,
  includeAA,
  diffColor: [255, 0, 80],   // bright pink = differing zones
  alpha: 0.3,
});
fs.writeFileSync(diffPath, PNG.sync.write(diff));

const total = width * height;
const pct = (mismatched / total) * 100;
console.log('Differing pixels: ' + mismatched + ' / ' + total + '  (' + pct.toFixed(3) + '%)');
console.log('Diff saved:       ' + diffPath);
