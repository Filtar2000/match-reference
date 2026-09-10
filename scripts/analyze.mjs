#!/usr/bin/env node
// analyze.mjs — the brain of the loop.
//
// Turns "3.2% of pixels differ" into an ACTIONABLE, per-region fix list an LLM
// can execute: for each wrong zone it reports a category (colour / spacing /
// missing / text / mixed), a perceptual colour delta (CIEDE2000) with direction,
// the DOM element it maps to (with its computed CSS, if a regions file is given),
// and a plain-language hypothesis of what to change. It also writes one
// side-by-side "reference | your build | diff" strip per region for the agent to
// LOOK AT (models fix faster from the image than from numbers), an overall
// similarity score (SSIM "thermometer"), and a convergence verdict vs. the
// previous iteration (improved / regressed / close enough).
//
// Usage:
//   node analyze.mjs <reference.png> <candidate.png> [--out <dir>]
//        [--regions <dom.json>]     map regions to real elements (from capture --dom)
//        [--threshold 0.12]         per-pixel sensitivity (lower = stricter)
//        [--cell 12] [--min 60]     clustering cell size / min changed px per region
//        [--history <file.json>]    track score across iterations (convergence)
//        [--align 0]                search a global pixel shift up to N (for photos)
//        [--tolerant]               looser diff for imperfect refs (photos/JPEG)
//        [--mask "x,y,w,h; ..."]    ignore these boxes (logos, photos, dynamic data)
//
// Reads two PNGs of the SAME size (use capture.mjs --match or resize.mjs first).
// Writes <out>/analyze.json + <out>/regions/*.png. Exit 0 even with differences.

import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/* ---------- args ---------- */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const refPath = process.argv[2], candPath = process.argv[3];
if (!refPath || !candPath) {
  console.error('Usage: node analyze.mjs <reference.png> <candidate.png> [--out dir --regions dom.json --history h.json --align N --tolerant --mask "x,y,w,h;..."]');
  process.exit(1);
}
const outDir = String(arg('out', 'analyze-out'));
const tolerant = arg('tolerant', false) === true;
const threshold = parseFloat(arg('threshold', tolerant ? 0.2 : 0.12));
const cell = parseInt(arg('cell', '12'), 10);
const minPx = parseInt(arg('min', '60'), 10);
const align = parseInt(arg('align', '0'), 10);
const regionsPath = arg('regions', null);
const historyPath = arg('history', null);
const maskArg = arg('mask', null);

/* ---------- load ---------- */
const ref = PNG.sync.read(fs.readFileSync(refPath));
let cand = PNG.sync.read(fs.readFileSync(candPath));
if (ref.width !== cand.width || ref.height !== cand.height) {
  console.error('SIZE MISMATCH: reference ' + ref.width + 'x' + ref.height +
    ' vs candidate ' + cand.width + 'x' + cand.height +
    '. Use capture.mjs --match, or resize.mjs, to make them equal first.');
  process.exit(3);
}
const W = ref.width, H = ref.height;
fs.mkdirSync(path.join(outDir, 'regions'), { recursive: true });

const masks = [];
if (maskArg && typeof maskArg === 'string') {
  for (const b of maskArg.split(';')) {
    const [x, y, w, h] = b.split(',').map(n => parseInt(n.trim(), 10));
    if ([x, y, w, h].every(Number.isFinite)) masks.push({ x, y, w, h });
  }
}
const inMask = (x, y) => masks.some(m => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);

/* ---------- CIEDE2000 (perceptual color difference) ---------- */
function rgb2lab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? ((R + 0.055) / 1.055) ** 2.4 : R / 12.92;
  G = G > 0.04045 ? ((G + 0.055) / 1.055) ** 2.4 : G / 12.92;
  B = B > 0.04045 ? ((B + 0.055) / 1.055) ** 2.4 : B / 12.92;
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
function ciede2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const avgLp = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(avgC ** 7 / (avgC ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;
  let h1p = Math.atan2(b1, a1p) * 180 / Math.PI; if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * 180 / Math.PI; if (h2p < 0) h2p += 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
  let avghp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) avghp += (avghp < 360 ? 360 : -360);
    avghp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((avghp - 30) * Math.PI / 180)
    + 0.24 * Math.cos(2 * avghp * Math.PI / 180)
    + 0.32 * Math.cos((3 * avghp + 6) * Math.PI / 180)
    - 0.20 * Math.cos((4 * avghp - 63) * Math.PI / 180);
  const Sl = 1 + (0.015 * (avgLp - 50) ** 2) / Math.sqrt(20 + (avgLp - 50) ** 2);
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const dTheta = 30 * Math.exp(-(((avghp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(avgCp ** 7 / (avgCp ** 7 + 25 ** 7));
  const Rt = -Rc * Math.sin(2 * dTheta * Math.PI / 180);
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2
    + Rt * (dCp / Sc) * (dHp / Sh));
}

/* ---------- optional coarse global alignment (helps photo/skew refs) ---------- */
let offset = { dx: 0, dy: 0 };
if (align > 0) {
  const s = Math.max(1, Math.round(Math.max(W, H) / 200));   // downscale for speed
  const sw = Math.floor(W / s), sh = Math.floor(H / s);
  const gray = (img, x, y) => {
    const i = (img.width * (y * s) + x * s) * 4;
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  };
  const rg = []; for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) rg.push(gray(ref, x, y));
  const cg = []; for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) cg.push(gray(cand, x, y));
  const A = Math.max(1, Math.round(align / s));
  let best = Infinity, bdx = 0, bdy = 0;
  for (let dy = -A; dy <= A; dy++) for (let dx = -A; dx <= A; dx++) {
    let sum = 0, n = 0;
    for (let y = A; y < sh - A; y++) for (let x = A; x < sw - A; x++) {
      const d = rg[y * sw + x] - cg[(y + dy) * sw + (x + dx)];
      sum += d * d; n++;
    }
    const e = sum / n;
    if (e < best) { best = e; bdx = dx; bdy = dy; }
  }
  offset = { dx: bdx * s, dy: bdy * s };
  if (offset.dx || offset.dy) {                                // shift candidate
    const shifted = new PNG({ width: W, height: H });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = x + offset.dx, sy = y + offset.dy;
      const o = (W * y + x) * 4;
      if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
        const j = (W * sy + sx) * 4;
        shifted.data[o] = cand.data[j]; shifted.data[o + 1] = cand.data[j + 1];
        shifted.data[o + 2] = cand.data[j + 2]; shifted.data[o + 3] = cand.data[j + 3];
      } else { shifted.data[o + 3] = 255; shifted.data[o] = shifted.data[o + 1] = shifted.data[o + 2] = 255; }
    }
    cand = shifted;
  }
}

/* ---------- pixel diff + changed mask ---------- */
const diff = new PNG({ width: W, height: H });
const total = pixelmatch(ref.data, cand.data, diff.data, W, H,
  { threshold, includeAA: tolerant, diffColor: [255, 0, 80], diffMask: true });
// build a colored overlay diff (nicer to look at than a bare mask)
const overlay = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) {
  const o = i * 4, changed = diff.data[o + 3] > 0;
  if (changed) { overlay.data[o] = 255; overlay.data[o + 1] = 0; overlay.data[o + 2] = 80; overlay.data[o + 3] = 255; }
  else {
    overlay.data[o] = 235 + (ref.data[o] - 235) * 0.25;
    overlay.data[o + 1] = 238 + (ref.data[o + 1] - 238) * 0.25;
    overlay.data[o + 2] = 242 + (ref.data[o + 2] - 242) * 0.25;
    overlay.data[o + 3] = 255;
  }
}
fs.writeFileSync(path.join(outDir, 'diff.png'), PNG.sync.write(overlay));

/* ---------- cluster changed pixels into regions (cell grid + flood fill) ---------- */
const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
const cellChanged = new Uint8Array(gw * gh);
const cellCount = new Int32Array(gw * gh);
let masked = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (diff.data[(W * y + x) * 4 + 3] > 0) {
    if (inMask(x, y)) { masked++; continue; }
    cellCount[Math.floor(y / cell) * gw + Math.floor(x / cell)]++;
  }
}
const need = Math.max(3, Math.floor(cell * cell * 0.06));
for (let i = 0; i < cellChanged.length; i++) cellChanged[i] = cellCount[i] >= need ? 1 : 0;

const seen = new Uint8Array(gw * gh);
const clusters = [];
for (let c = 0; c < gw * gh; c++) {
  if (!cellChanged[c] || seen[c]) continue;
  const stack = [c]; seen[c] = 1;
  let minX = gw, minY = gh, maxX = 0, maxY = 0, pix = 0;
  while (stack.length) {
    const k = stack.pop(), cx = k % gw, cy = (k / gw) | 0;
    pix += cellCount[k];
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const nk = ny * gw + nx;
      if (cellChanged[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
    }
  }
  if (pix < minPx) continue;
  clusters.push({
    x: minX * cell, y: minY * cell,
    w: Math.min(W, (maxX + 1) * cell) - minX * cell,
    h: Math.min(H, (maxY + 1) * cell) - minY * cell,
    pix,
  });
}
clusters.sort((a, b) => b.pix - a.pix);

/* ---------- DOM elements (optional) ---------- */
let elements = [];
if (regionsPath) {
  try { elements = JSON.parse(fs.readFileSync(regionsPath, 'utf8')).elements || []; }
  catch { elements = []; }
}
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (!inter) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
};

/* ---------- per-region analysis ---------- */
function meanColor(img, r) {
  let R = 0, G = 0, B = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y += 3) for (let x = r.x; x < r.x + r.w; x += 3) {
    const i = (W * y + x) * 4; R += img.data[i]; G += img.data[i + 1]; B += img.data[i + 2]; n++;
  }
  return n ? [R / n, G / n, B / n] : [0, 0, 0];
}
function variance(img, r) {
  let s = 0, s2 = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y += 3) for (let x = r.x; x < r.x + r.w; x += 3) {
    const i = (W * y + x) * 4, g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    s += g; s2 += g * g; n++;
  }
  return n ? Math.max(0, s2 / n - (s / n) ** 2) : 0;
}
// Most common colour in a region (quantized). For a filled block this returns
// its fill, ignoring surrounding whitespace/text — a cleaner target than a mean.
function dominantColor(img, r) {
  const bins = new Map();
  for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) {
    const i = (W * y + x) * 4;
    const k = (img.data[i] >> 4) << 8 | (img.data[i + 1] >> 4) << 4 | (img.data[i + 2] >> 4);
    const e = bins.get(k) || [0, 0, 0, 0];
    e[0] += img.data[i]; e[1] += img.data[i + 1]; e[2] += img.data[i + 2]; e[3]++;
    bins.set(k, e);
  }
  let best = null, bc = 0;
  for (const e of bins.values()) if (e[3] > bc) { bc = e[3]; best = e; }
  return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : [0, 0, 0];
}
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
function colorDir(a, b) {                     // ref a vs cand b: how to move cand toward ref
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  const words = [];
  const lum = 0.299 * dr + 0.587 * dg + 0.114 * db;
  if (lum > 12) words.push('lighter'); else if (lum < -12) words.push('darker');
  // pick the single strongest hue shift, not several contradictory ones
  const hues = [
    ['bluer', db - (dr + dg) / 2], ['warmer (less blue)', (dr + dg) / 2 - db],
    ['redder', dr - Math.max(dg, db)], ['greener', dg - Math.max(dr, db)],
  ].filter(h => h[1] > 14).sort((x, y) => y[1] - x[1]);
  if (hues.length) words.push(hues[0][0]);
  return words.length ? words.join(', ') : 'a slightly different shade';
}
function cropStrip(r, id) {                    // ref | mine | diff strip for the agent to view
  const gap = 8, sw = r.w * 3 + gap * 2;
  const strip = new PNG({ width: sw, height: r.h });
  for (let i = 0; i < strip.data.length; i += 4) { strip.data[i] = strip.data[i + 1] = strip.data[i + 2] = 245; strip.data[i + 3] = 255; }
  const blit = (src, ox) => { const sub = new PNG({ width: r.w, height: r.h }); PNG.bitblt(src, sub, r.x, r.y, r.w, r.h, 0, 0); PNG.bitblt(sub, strip, 0, 0, r.w, r.h, ox, 0); };
  blit(ref, 0); blit(cand, r.w + gap); blit(overlay, (r.w + gap) * 2);
  const p = path.join(outDir, 'regions', 'r' + String(id).padStart(2, '0') + '.png');
  fs.writeFileSync(p, PNG.sync.write(strip));
  return p;
}

const regions = clusters.slice(0, 12).map((r, idx) => {
  const id = idx + 1;
  const vRef = variance(ref, r), vCand = variance(cand, r);
  // DOM element with best overlap
  let el = null, bestIou = 0;
  for (const e of elements) { const s = iou(r, e.box); if (s > bestIou) { bestIou = s; el = e; } }
  // a filled block = element with a real (non-transparent) background. Its diff
  // is a fill-colour problem, NOT a text problem, even if it holds a label.
  const bg = el && el.style && el.style.background;
  const filled = !!(bg && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/i.test(bg));
  // for a filled block compare its dominant fill; else the region mean
  const cRef = filled ? dominantColor(ref, r) : meanColor(ref, r);
  const cCand = filled ? dominantColor(cand, r) : meanColor(cand, r);
  const dE = ciede2000(rgb2lab(...cRef), rgb2lab(...cCand));
  // category
  let category = 'mixed';
  const thin = r.h <= cell * 2 || r.w <= cell * 2;
  const oneFlat = (vRef < 60) !== (vCand < 60);
  const hasText = !!(el && el.text);
  if (oneFlat) category = 'missing/extra';
  else if (filled && dE > 4 && !thin) category = 'colour';
  else if (hasText && dE > 4) category = 'text';
  else if (dE > 6 && !thin) category = 'colour';
  else if (thin) category = 'spacing/alignment';
  else if (hasText) category = 'text';
  // hypothesis
  let hypothesis;
  const tgt = hex(cRef);
  if (category === 'colour') {
    hypothesis = (el ? el.selector + ' ' : 'this area ') + 'colour is off (ΔE ' + dE.toFixed(1) +
      '): make it ' + colorDir(cRef, cCand) + ', toward ~' + tgt +
      (el ? ' (its computed colour is ' + el.style.color + ', background ' + el.style.background + ')' : '') + '.';
  } else if (category === 'spacing/alignment') {
    const edge = r.y <= cell ? 'top' : (r.y + r.h >= H - cell ? 'bottom' : (r.x <= cell ? 'left' : 'right'));
    hypothesis = 'thin band near the ' + edge + ' edge — likely padding/margin/alignment off by ~' +
      Math.max(r.w <= r.h ? r.w : r.h, cell) + 'px' + (el ? ' on ' + el.selector + ' (padding ' + el.style.padding + ', margin ' + el.style.margin + ')' : '') + '.';
  } else if (category === 'missing/extra') {
    hypothesis = 'content appears in ' + (vRef > vCand ? 'the REFERENCE but is missing/blank in your build' : 'YOUR build but not the reference') +
      (el ? ' near ' + el.selector : '') + ' — add/remove or restyle it. Look at the strip.';
  } else if (category === 'text') {
    hypothesis = 'text region' + (el && el.text ? ' ("' + el.text + '")' : '') +
      ' differs' + (dE > 6 ? ' — colour is off (ΔE ' + dE.toFixed(1) + '): make it ' + colorDir(cRef, cCand) + ', toward ~' + tgt : '') +
      '; also check wording / size / weight against the reference (look at the strip)' +
      (el ? '. Computed colour ' + el.style.color + ', font ' + el.style.fontSize + '/' + el.style.fontWeight : '') + '.';
  } else {
    hypothesis = 'mixed differences (ΔE ' + dE.toFixed(1) + ')' + (el ? ' around ' + el.selector : '') + ' — compare the strip and adjust colour, position and text as needed.';
  }
  return {
    id, box: r, changedPixels: r.pix, category,
    deltaE: +dE.toFixed(1),
    refColor: tgt, yourColor: hex(cCand),
    element: el ? { selector: el.selector, text: el.text, style: el.style, overlap: +bestIou.toFixed(2) } : null,
    hypothesis,
    strip: cropStrip(r, id),
  };
});

/* ---------- overall similarity (SSIM thermometer) ---------- */
let ssimScore = null;
try {
  const mod = await import('ssim.js');
  const ssim = mod.ssim || (mod.default && mod.default.ssim) || mod.default;
  const toImg = p => ({ data: new Uint8ClampedArray(p.data), width: p.width, height: p.height });
  const { mssim } = ssim(toImg(ref), toImg(cand), { downsample: 'fast' });
  ssimScore = +mssim.toFixed(4);
} catch { /* ssim optional */ }

const diffPct = +(total / (W * H) * 100).toFixed(3);

/* ---------- convergence vs previous iteration ---------- */
let convergence = { iteration: 1, verdict: 'first pass' };
if (historyPath) {
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(historyPath, 'utf8')); } catch { hist = []; }
  const prev = hist[hist.length - 1];
  const s = 1 - diffPct / 100;
  if (prev) {
    const s0 = 1 - prev.diffPct / 100;
    const ris = s0 < 1 ? (s - s0) / (1 - s0) : 0;   // relative improvement
    convergence = {
      iteration: hist.length + 1,
      previousDiffPct: prev.diffPct, diffPct,
      relativeImprovement: +ris.toFixed(3),
      verdict: diffPct <= 0.4 ? 'CLOSE ENOUGH — near pixel-match'
        : ris > 0.02 ? 'improved — keep going'
        : ris < -0.02 ? 'REGRESSED — last edit made it worse, reconsider'
        : 'stalled — try a different fix',
    };
  } else convergence = { iteration: 1, diffPct, verdict: diffPct <= 0.4 ? 'CLOSE ENOUGH' : 'first pass' };
  hist.push({ diffPct, ssim: ssimScore, at: new Date().toISOString() });
  fs.writeFileSync(historyPath, JSON.stringify(hist, null, 2));
}

/* ---------- output ---------- */
const report = {
  overall: {
    diffPct, ssim: ssimScore,
    changedRegions: regions.length,
    maskedBoxes: masks.length, maskedPixels: masked,
    alignmentOffset: offset,
    verdict: diffPct <= 0.4 ? 'near match' : diffPct <= 2 ? 'close, a few regions off' : 'several regions off',
  },
  convergence,
  regions,
};
fs.writeFileSync(path.join(outDir, 'analyze.json'), JSON.stringify(report, null, 2));

/* ---------- human summary ---------- */
console.log('OVERALL  ' + diffPct + '% pixels differ' +
  (ssimScore !== null ? '  ·  SSIM ' + ssimScore + ' (1.0 = identical)' : '') +
  '  ·  ' + report.overall.verdict);
if (offset.dx || offset.dy) console.log('ALIGN    global shift detected: dx ' + offset.dx + ', dy ' + offset.dy + 'px');
console.log('CONVERGE ' + convergence.verdict +
  (convergence.previousDiffPct !== undefined ? '  (was ' + convergence.previousDiffPct + '%)' : ''));
console.log('');
if (!regions.length) console.log('No significant regions — you are matched (or raise sensitivity with --threshold).');
for (const r of regions) {
  console.log('#' + r.id + '  [' + r.category + ']  box ' + r.box.x + ',' + r.box.y + ' ' + r.box.w + 'x' + r.box.h +
    (r.element ? '  → ' + r.element.selector : ''));
  console.log('    ' + r.hypothesis);
  console.log('    look: ' + r.strip);
}
console.log('');
console.log('Full report: ' + path.join(outDir, 'analyze.json'));
console.log('VIEW the strips above (reference | your build | diff) before editing — the picture shows what words cannot.');
