---
name: match-reference
description: Use when the user wants to replicate a frontend so it looks (near) identical to some visual reference — any reference works: a design mockup or export (Figma, Sketch, Photoshop), a screenshot of another website or app, a photo of a UI, an AI-generated concept, or an existing page to clone. Also usable for visual regression (diffing two of your own pages). Instead of eyeballing "looks close", it measures the gap and returns an ACTIONABLE, per-region fix list — each wrong zone tagged by category (colour / spacing / missing / text), a perceptual colour delta with direction, the DOM element + its CSS, and a plain-language hypothesis of what to change — plus reference|build|diff image strips to look at, an overall similarity score, and a converge/regress verdict across iterations. Not for functional testing or backend work.
version: 2.0.0
user-invocable: true
argument-hint: "[reference-image] [url-or-page-to-build]"
license: MIT
allowed-tools:
  - Bash(node *)
  - Bash(npm *)
  - Bash(npx playwright *)
---

Reproduce a frontend **(near) pixel-identical** to a visual reference (a design mockup, a screenshot of another site/app, a photo of a UI, an existing page to clone). You don't judge the match by eye — you **measure** it and let the tool tell you, region by region, exactly what is wrong and how to fix it, then iterate until it converges.

What makes this different from a plain screenshot-diff: `analyze.mjs` turns "3.7% of pixels differ" into a **fix list an agent can execute** — per wrong zone: a category (colour / spacing / missing / text), a perceptual colour delta (CIEDE2000) with direction ("make it bluer, toward #2f7bed"), the **DOM element it maps to and its computed CSS**, and a hypothesis of the cause. It also writes a **`reference | your build | diff` strip per region for you to LOOK AT** (models fix faster from the picture than from numbers), an overall **SSIM** score, and a **convergence verdict** (improved / regressed / close enough) across iterations.

## Input: the reference (recommended, NOT blocking)

Look for the input first: an **attached image**, a **path** to a PNG/JPG, or a **URL** of a page to clone (screenshot it with `capture.mjs` and use it as the golden reference). If it's missing, **ask once**. If the user genuinely has none (visual regression between two of their own pages), proceed using one page as the golden reference and note the diff is relative, not toward a design target. Never block on this.

## Setup (once per machine)

Scripts live in `<skill-dir>/scripts/` (`<skill-dir>` = this skill's base directory, typically `~/.claude/skills/match-reference`). Node ≥ 18. If `<skill-dir>/node_modules` is missing:

```bash
cd <skill-dir> && npm install && npx playwright install chromium
```

Keep the cwd on the user's project, not the skill folder.

## Working folder

```
pixel/
  reference/   # the golden reference, IMMUTABLE
  shots/       # screenshots of your build (+ .dom.json element maps)
  out/         # analyze output: analyze.json, diff.png, regions/*.png, history.json
```

## The loop

### 1. Immutable golden reference
Save the target as a fixed PNG, e.g. `reference/target.png`. **Never touch it** — it's the ruler. Note its size (see "Different sizes, mobile, imprecise references" if it doesn't match your build's viewport).

### 2. Deterministic screenshot of your build — with the DOM map
```bash
node <skill-dir>/scripts/capture.mjs <url> shots/mine.png --match reference/target.png --dom shots/mine.dom.json
```
- `--match reference/target.png` shoots at the reference's exact pixel size (no size mismatch).
- `--dom shots/mine.dom.json` dumps every visible element's box + computed CSS, so the analyzer can name the element behind each wrong zone and guess which property is off. Always pass it — it's what makes the fix list precise.
- `capture.mjs` also pins viewport/scale/locale/timezone/light/reduced-motion, adds a `visual-test` class on `<html>` to kill animations, waits for `document.fonts.ready`. Add a `html.visual-test` CSS rule in the frontend to zero animations/transitions/caret.

### 3. Analyze — get the fix list
```bash
node <skill-dir>/scripts/analyze.mjs reference/target.png shots/mine.png \
  --out out --regions shots/mine.dom.json --history out/history.json
```
It prints something like:
```
OVERALL  3.718% pixels differ  ·  SSIM 0.9705  ·  several regions off
CONVERGE first pass

#1  [colour]  box 264,360 372x48  → button.btn
    colour is off (ΔE 12.6): make it darker, bluer, toward ~#2f7bed (computed background rgb(110,163,242)).
    look: out/regions/r01.png
#2  [spacing/alignment]  box 240,420 420x12  → div.card
    thin band near the edge — likely padding/margin off by ~12px (padding 18px 28px).
    look: out/regions/r02.png
```
and writes `out/analyze.json` (the full structured report), `out/diff.png`, and one `out/regions/rNN.png` strip per region.

### 4. LOOK, then fix one region at a time
**Read the region strips it lists** (`out/regions/r01.png`, …) — each is `reference | your build | diff`. The picture shows what the numbers can't (a wrap, a subtle shade, a shift). Then apply the fixes it names, biggest region first (they're sorted by size). Trust the DOM element + CSS it points at.

### 5. Re-capture, re-analyze, repeat
Re-run steps 2–3 against the **same `--history` file**. The `CONVERGE` line now says `improved — keep going`, `REGRESSED — last edit made it worse`, `stalled — try a different fix`, or `CLOSE ENOUGH — near pixel-match`. **Stop at CLOSE ENOUGH** (or when the remaining regions are content you shouldn't copy — see the golden rule).

## The fix-list categories

`analyze.mjs` tags each region so you know what kind of edit it needs:
- **colour** — right shape, wrong colour. Gives ΔE (how far, perceptually) + direction + a target hex, and the element's computed `color`/`background`.
- **spacing/alignment** — a thin band at an edge; padding / margin / alignment off by ~N px.
- **missing/extra** — content present on one side but not the other (add / remove / restyle).
- **text** — a text element differs (wording, size, weight, or colour); read the strip for the exact wording.
- **mixed** — several things at once; compare the strip.

## Different sizes, mobile, imprecise references

`analyze.mjs` needs both images the **same pixel size**. Getting there:
- **Shoot at the reference's size:** `capture.mjs ... --match reference/target.png` (shown above).
- **Can't re-shoot to match:** normalize with `node <skill-dir>/scripts/resize.mjs reference/raw.png reference/target.png 900 520` (height auto if omitted). Retina @2x → give the @1x width.
- **Mobile / phone reference:** `capture.mjs ... --device "iPhone 13"` (or "Pixel 7", "iPad Mini", any Playwright device). A phone's 2–3× density enlarges the PNG — combine with `--match`/`resize.mjs`.
- **Imprecise reference** (a photo of a screen, a lossy or hand-cropped image, slight skew): 0% is impossible and not the goal. Pass `--tolerant` (looser diff), `--align 8` (searches a small global pixel shift and reports it — good for photos), and `--mask "x,y,w,h; ..."` to ignore un-reproducible content (a logo, a photo, live data). Then treat the fix list as a guide: fix structure and colour region by region, don't chase 0%.

## Primitives (for manual work)

The loop above is the recommended path, but the individual scripts are there when you want them:
- `compare.mjs <ref> <cand> <diff.png> [--threshold 0.12] [--aa] [--engine odiff]` — a plain pixel diff (% + pink PNG). `--engine odiff` is an optional native fast path for huge full-page images (needs the `odiff-bin` optional dep; its AA filter can hide subtle colour tweaks, so prefer pixelmatch for small style changes).
- `crop.mjs <in> <out> <x> <y> <w> <h>` — crop a region by hand.
- `resize.mjs <in> <out> <w> [h]` — normalize sizes.

## Golden rule: content beats pixels

Where the reference has mistakes or choices you should NOT copy (wrong labels, an extra element, fake placeholder data, a photo you can't reproduce), **keep your version**. The goal is the look, not cloning the mockup's mistakes. Those zones stay red in the diff and in the fix list — expected; `--mask` them or ignore them there.

## Practical notes
- Fonts: if the reference uses fonts your build lacks, every text region reads as "off". Load the same (or closest) fonts before chasing the fix list.
- ImageMagick isn't required anywhere — crops/resizes use pngjs.
- If `analyze.mjs`/`compare.mjs` say "SIZE MISMATCH", make the two images equal first (`--match`, or `resize.mjs`).
