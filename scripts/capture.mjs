#!/usr/bin/env node
// DETERMINISTIC screenshot of a page, aligned to the golden reference.
// Without these settings the screenshot "wobbles" and the diff becomes noise.
//
// Usage:
//   node capture.mjs <url> <out.png> [--width N] [--height N] [--full]
//                     [--wait MS] [--selector "css"] [--scale N]
//                     [--device "iPhone 13"] [--match <reference.png>]
//
// Examples:
//   node capture.mjs http://localhost:5000/ shots/mine.png --width 1536 --height 1024
//   node capture.mjs http://localhost:5000/ shots/mine.png --full          (full page)
//   node capture.mjs http://localhost:5000/ shots/card.png --selector ".summary"
//   node capture.mjs http://localhost:5000/ shots/mine.png --device "iPhone 13"   (mobile)
//   node capture.mjs http://localhost:5000/ shots/mine.png --match reference/target.png
//
//   --match <ref.png>  read the reference's pixel size and shoot at exactly that
//                      size (viewport = ref W×H, scale 1), so compare.mjs won't
//                      complain about a size mismatch. Overridden by explicit
//                      --width/--height if you pass them too.
//   --device <name>    use a Playwright device preset (mobile viewport, scale,
//                      user agent). List: any key of playwright's `devices`,
//                      e.g. "iPhone 13", "Pixel 7", "iPad Mini". A device's
//                      deviceScaleFactor (often 2-3) makes the PNG that many
//                      times larger than the CSS viewport — resize.mjs or a @1x
//                      reference if you need to match a specific pixel size.
//
// The "visual-test" class is added to <html>: use it in your CSS to kill
// animations/transitions/caret during the shot.
//   html.visual-test *, html.visual-test *::before, html.visual-test *::after {
//     animation: none !important; transition: none !important;
//     caret-color: transparent !important;
//   }

import fs from 'fs';
import pw from 'playwright';
import { PNG } from 'pngjs';
const { chromium, devices } = pw;

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const url = process.argv[2];
const out = process.argv[3];
if (!url || !out) {
  console.error('Usage: node capture.mjs <url> <out.png> [--width N --height N --full --wait MS --selector css --scale N --device "iPhone 13" --match ref.png]');
  process.exit(1);
}

const fullPage = arg('full', false) === true;
const waitMs = parseInt(arg('wait', '400'), 10);
const selector = arg('selector', null);
const deviceName = arg('device', null);

// Base context options. A device preset seeds viewport/scale/userAgent.
let ctxOpts = {
  locale: 'it-IT',            // change to match your target's region
  timezoneId: 'Europe/Rome',  // change to match your target's region
  colorScheme: 'light',
  reducedMotion: 'reduce',
};
if (deviceName) {
  const d = devices[deviceName];
  if (!d) {
    console.error('Unknown --device "' + deviceName + '". See Playwright device names (e.g. "iPhone 13", "Pixel 7", "iPad Mini").');
    process.exit(2);
  }
  ctxOpts = { ...ctxOpts, ...d };
}

// --match: shoot at the reference's exact pixel size.
let width = arg('width', null);
let height = arg('height', null);
const matchPath = arg('match', null);
if (matchPath && (width === null || height === null)) {
  const ref = PNG.sync.read(fs.readFileSync(matchPath));
  if (width === null) width = ref.width;
  if (height === null) height = ref.height;
  if (arg('scale', null) === null && !deviceName) ctxOpts.deviceScaleFactor = 1;
}

// Explicit flags win over device/defaults.
width = width === null ? (ctxOpts.viewport ? ctxOpts.viewport.width : 1536) : parseInt(width, 10);
height = height === null ? (ctxOpts.viewport ? ctxOpts.viewport.height : 1024) : parseInt(height, 10);
ctxOpts.viewport = { width, height };
const scaleFlag = arg('scale', null);
if (scaleFlag !== null) ctxOpts.deviceScaleFactor = parseFloat(scaleFlag);
else if (ctxOpts.deviceScaleFactor === undefined) ctxOpts.deviceScaleFactor = 1;

const browser = await chromium.launch();
const context = await browser.newContext(ctxOpts);
const page = await context.newPage();

await page.goto(url, { waitUntil: 'networkidle' });
await page.addStyleTag({
  content: `html.visual-test *,html.visual-test *::before,html.visual-test *::after{
    animation:none!important;transition:none!important;
    animation-duration:0s!important;transition-duration:0s!important;
    caret-color:transparent!important;scroll-behavior:auto!important}`,
});
await page.evaluate(() => document.documentElement.classList.add('visual-test'));
await page.evaluate(() => document.fonts && document.fonts.ready);
await page.waitForTimeout(waitMs);

if (selector) {
  const el = await page.$(selector);
  if (!el) { console.error('Selector not found: ' + selector); process.exit(3); }
  await el.screenshot({ path: out });
} else {
  await page.screenshot({ path: out, fullPage });
}

await browser.close();
const tag = (deviceName ? deviceName + ' ' : '') + width + 'x' + height +
  '@' + ctxOpts.deviceScaleFactor + (fullPage ? ' full' : '');
console.log('OK ' + out + ' (' + tag + ')');
