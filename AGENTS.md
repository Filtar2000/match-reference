# match-reference — agent instructions

Cross-agent instructions (Codex, Cursor, and any tool that reads `AGENTS.md`).
Claude Code reads `SKILL.md` instead; both describe the same workflow over the
same scripts in `scripts/`. The scripts are plain Node ≥ 18 and depend on
`playwright`, `pixelmatch`, `pngjs` (`npm install && npx playwright install chromium`).

## When to use this

The user wants to rebuild a frontend so it looks **(near) pixel-identical** to a
visual reference: a design mockup, a screenshot of another site/app, a photo of a
UI, an AI-generated concept, or an existing page to clone. Also usable for visual
regression (diffing two of the user's own pages). Not for functional testing or
backend work.

Don't judge the match by eye. Measure it with a pixel diff and close the gap
region by region.

## Input: the reference (recommended, not blocking)

Look for the reference first: an attached image, a path to a PNG/JPG, or a URL of
a page to clone (screenshot it with `capture.mjs` and use it as the golden
reference). If it's missing, ask for it once. If the user genuinely has none
(e.g. visual regression between two of their own versions), proceed using one page
as the golden reference and note that the diff is relative, not toward a design
target.

## The 3-part loop

1. **Golden reference (immutable).** Save the target as a fixed PNG, e.g.
   `reference/target.png`. Never modify it — it's the ruler. Note its dimensions;
   if it's retina (@2x) either downscale to @1x or shoot with `--scale 2`. The two
   images must match in size or the diff refuses.

2. **Deterministic screenshot** of the frontend:
   ```bash
   node scripts/capture.mjs <url> shots/mine.png --width <W> --height <H>
   ```
   It pins viewport, scale, locale, timezone, light color scheme, reduced motion,
   a `visual-test` class on `<html>` to kill animations, `fonts.ready` + a short
   wait. Add a `html.visual-test` CSS rule in the frontend to zero
   animations/transitions/caret. `--selector "css"` shoots one component;
   `--full` shoots the whole page. The pinned locale/timezone default to Italy —
   edit them in `capture.mjs` for another region.

3. **Diff and calibrate:**
   ```bash
   node scripts/compare.mjs reference/target.png shots/mine.png diff/full.png
   ```
   Prints the % of differing pixels and writes a diff PNG with differences in
   bright pink. Then crop by region and calibrate one zone at a time:
   ```bash
   node scripts/crop.mjs reference/target.png reference/header.png 0 0 <W> 120
   node scripts/crop.mjs shots/mine.png       shots/header.png     0 0 <W> 120
   node scripts/compare.mjs reference/header.png shots/header.png diff/header.png
   ```
   Cycle: look at the red → fix CSS/HTML → re-shoot → re-diff → until the region
   matches. Big regions (layout, spacing) first, then details (color, borders).
   `compare.mjs --threshold 0.12` (lower = stricter); `--aa` includes
   anti-aliasing (normally ignored noise).

## Different sizes, mobile, imprecise references

`compare.mjs` needs both images at the **same pixel size**, and a real reference rarely matches out of the box:
- **Shoot at the reference's exact size:** `capture.mjs <url> shots/mine.png --match reference/target.png`.
- **Can't re-shoot to match:** normalize with `resize.mjs <in> <out> <w> [h]` (e.g. downscale a retina @2x reference to @1x). A resize blurs slightly, so raise `--threshold` afterward.
- **Mobile / phone screenshot:** `capture.mjs <url> shots/mine.png --device "iPhone 13"` (or "Pixel 7", "iPad Mini", any Playwright device); combine with `--match`/`resize.mjs` for a specific pixel size.
- **Imprecise reference (photo of a screen, lossy or hand-cropped image, slight skew):** 0% is impossible and not the goal. Treat the diff as a heat map of where you're structurally off, raise `--threshold` to ~0.2–0.3, calibrate region by region, and trust layout/spacing/color over exact pixels.

Once the two images are the same size, the loop is identical.

## Golden rule: content beats pixels

Where the reference has mistakes or choices not to copy (wrong labels, an extra
element, fake data), keep your version. The goal is the look, not cloning the
mockup's mistakes. Those zones will show red in the diff — expected, ignore there.
