---
name: match-reference
description: Use when the user wants to replicate a frontend so it looks (near) identical to some visual reference — any reference works: a design mockup or export (Figma, Sketch, Photoshop), a screenshot of another website or app, a photo of a UI, an AI-generated concept, or an existing page to clone. Also usable for visual regression (diffing two of your own pages) when no target reference exists. Runs a measured loop (golden reference → deterministic Playwright screenshot → pixelmatch diff → per-region crop) instead of eyeballing "it looks close". Not for functional testing or backend work.
version: 1.0.0
user-invocable: true
argument-hint: "[reference-image] [url-or-page-to-build]"
license: MIT
allowed-tools:
  - Bash(node *)
  - Bash(npm *)
  - Bash(npx playwright *)
---

Reproduce a frontend **(near) pixel-identical** to a visual reference (a design mockup, a screenshot of another site/app, a photo of a UI, an existing page to clone). You **close** the gap by measuring it with a pixel diff, not by eye: "looks close" is not enough — the diff tells you exactly where the layout is off (a clipped column, wrong padding, a text wrap, an off color).

## Input: the reference (recommended, NOT blocking)

The skill's full purpose is to replicate a TARGET, so a reference is almost always needed. Before starting, look for the input:
- An **attached image** in the message, or a **path** to a PNG/JPG, or a **URL** of a page to clone (in that case screenshot it first with `capture.mjs` and use it as the golden reference).
- If it's missing, **ask for it once** ("can you attach/point me to the reference image?"): without a target the diff only measures the gap *between two of your own pages*, not *toward the mockup*.

If the user explicitly has no reference (e.g. they only want to compare two of their own versions for visual regression), **proceed anyway**: use one of the two pages as the golden reference, and note that the diff is relative, not "toward a design target". Never block on this.

## Setup (once per machine)

The scripts live in this skill's folder (`<skill-dir>/scripts/`). Dependencies: `playwright`, `pixelmatch`, `pngjs`. If `<skill-dir>/node_modules` is missing:

```bash
cd <skill-dir> && npm install && npx playwright install chromium
```

`<skill-dir>` = this skill's base directory (typically `~/.claude/skills/match-reference`). Run the scripts with Node ≥18. Keep the cwd on the user's project, not on the skill folder.

## Working folder

Create a sandbox (in the session scratchpad, or wherever the user wants):
```
pixel/
  reference/    # the golden reference, IMMUTABLE
  shots/        # screenshots of your frontend
  diff/         # difference PNGs
```

## The 3-part loop

### 1. Immutable golden reference
Save the target image as a fixed PNG (e.g. `reference/target.png`). **Never touch it**: it is the ruler.
- Note its dimensions — you need them to screenshot at the same viewport.
- If the reference is @2x (retina), either downscale it to @1x, or screenshot with `--scale 2`. The two images MUST match in size or the diff refuses.

### 2. Deterministic screenshot of your frontend
```bash
node <skill-dir>/scripts/capture.mjs <url> shots/mine.png --width <W> --height <H>
```
`capture.mjs` already pins: same viewport, `deviceScaleFactor:1`, `locale it-IT`, timezone `Europe/Rome`, `colorScheme light`, `reducedMotion reduce`, a `visual-test` class on `<html>` to kill animations, `await document.fonts.ready` + ~400ms wait. Without this block the screenshot "wobbles" and the diff is just noise.
- Add a CSS rule for `html.visual-test` in your frontend that zeroes animations/transitions/caret (example in the header comment of `capture.mjs`).
- `--selector ".summary"` shoots a single component; `--full` shoots the entire page.
- `--match reference/target.png` shoots at the reference's exact pixel size (no size mismatch); `--device "iPhone 13"` shoots a mobile viewport. See "Different sizes, mobile, imprecise references" below.
- Adjust the pinned locale/timezone in `capture.mjs` if your target renders for a different region.

### 3. Diff and calibration
```bash
node <skill-dir>/scripts/compare.mjs reference/target.png shots/mine.png diff/full.png
```
Prints the percentage of differing pixels and saves a PNG with the differing areas in **bright pink**. Open it, see where the red is.

Then **crop by REGION** — calibrate one zone at a time, not the whole image:
```bash
node <skill-dir>/scripts/crop.mjs reference/target.png reference/header.png 0 0 <W> 120
node <skill-dir>/scripts/crop.mjs shots/mine.png       shots/header.png     0 0 <W> 120
node <skill-dir>/scripts/compare.mjs reference/header.png shots/header.png diff/header.png
```
Repeat for header / table / summary / footer separately.

**Cycle:** look at the red → fix the CSS/HTML → re-shoot (`capture.mjs`) → re-diff (`compare.mjs`) → until the region matches. Then move to the next. Close the big regions first (layout, spacing), then the details (colors, borders).

Diff params: `--threshold 0.12` by default (lower = stricter); `--aa` includes anti-aliasing (normally ignored, it's noise).

## Different sizes, mobile, imprecise references

`compare.mjs` needs the two images to have the **same pixel dimensions** — and a real reference rarely matches your build out of the box (a phone screenshot, a mockup exported at some odd size, a compressed/scaled image). Handle it, don't give up:

- **Shoot at the reference's exact size.** The easiest fix: `capture.mjs <url> shots/mine.png --match reference/target.png` reads the reference's pixel size and screenshots at exactly that size. Now the diff just works.
- **Reference is a different size and you can't re-shoot to match.** Normalize with `resize.mjs`: scale one image to the other's size before diffing, e.g. `node <skill-dir>/scripts/resize.mjs reference/raw.png reference/target.png 900 520`. A retina @2x reference: `resize.mjs reference/raw@2x.png reference/target.png 900` (height auto).
- **Mobile / phone screenshot reference.** Use a device preset: `capture.mjs <url> shots/mine.png --device "iPhone 13"` (or `"Pixel 7"`, `"iPad Mini"`, any Playwright device). A phone's deviceScaleFactor (2–3×) makes the PNG that many times larger — combine with `--match` or `resize.mjs` if you need a specific pixel size.
- **Imprecise reference (a photo of a screen, a lossy or hand-cropped screenshot, slight skew).** Pixel-perfect 0% is impossible here and not the goal. Treat the diff as a **heat map of where you're structurally off**: raise `--threshold` (e.g. `0.2`–`0.3`), calibrate region by region, and trust layout / spacing / color over exact pixels. An imprecise reference is a guide, not ground truth — this is the content-beats-pixels rule again.

Whatever you do, once the two images are the same size the loop is identical.

## Golden rule: content beats pixels

Where the reference has mistakes or choices you should NOT copy (wrong field names, an extra flag, fake mockup data), **keep your version**. The goal is the look, not cloning the mockup's mistakes. The diff will flag those zones in red: that's expected, ignore it there.

## Practical notes
- ImageMagick / `magick` may not be installed: do crops with `crop.mjs` (pngjs), never with an ImageMagick CLI.
- Fonts: if the reference uses fonts your frontend doesn't have, the diff will be noisy everywhere there's text. Load the same fonts (or the closest ones) before chasing pixels.
- If `compare.mjs` exits with "SIZE MISMATCH", make the two images the same size: re-shoot with `--match reference/target.png` (or `--width/--height`), or normalize with `resize.mjs`. See the section above.
