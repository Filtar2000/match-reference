#!/usr/bin/env node
// DETERMINISTIC screenshot of a page, aligned to the golden reference.
// Without these settings the screenshot "wobbles" and the diff becomes noise.
//
// Usage:
//   node capture.mjs <url> <out.png> [--width N] [--height N] [--full]
//                     [--wait MS] [--selector "css"] [--scale N]
//
// Examples:
//   node capture.mjs http://localhost:5000/ shots/mine.png --width 1536 --height 1024
//   node capture.mjs http://localhost:5000/ shots/mine.png --full          (full page)
//   node capture.mjs http://localhost:5000/ shots/card.png --selector ".summary"
//
// The "visual-test" class is added to <html>: use it in your CSS to kill
// animations/transitions/caret during the shot.
//   html.visual-test *, html.visual-test *::before, html.visual-test *::after {
//     animation: none !important; transition: none !important;
//     caret-color: transparent !important;
//   }

import { chromium } from 'playwright';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const url = process.argv[2];
const out = process.argv[3];
if (!url || !out) {
  console.error('Usage: node capture.mjs <url> <out.png> [--width N --height N --full --wait MS --selector css --scale N]');
  process.exit(1);
}

const width = parseInt(arg('width', '1536'), 10);
const height = parseInt(arg('height', '1024'), 10);
const fullPage = arg('full', false) === true;
const waitMs = parseInt(arg('wait', '400'), 10);
const selector = arg('selector', null);
const scale = parseFloat(arg('scale', '1'));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: scale,      // reference is usually @1x
  locale: 'it-IT',               // change to match your target's region
  timezoneId: 'Europe/Rome',     // change to match your target's region
  colorScheme: 'light',
  reducedMotion: 'reduce',
});
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
  if (!el) { console.error('Selector not found: ' + selector); process.exit(2); }
  await el.screenshot({ path: out });
} else {
  await page.screenshot({ path: out, fullPage });
}

await browser.close();
console.log('OK ' + out + ' (' + width + 'x' + height + (fullPage ? ' full' : '') + ')');
