# match-reference — agent instructions

Cross-agent instructions (Codex, Cursor, and any tool that reads `AGENTS.md`).
Claude Code reads `SKILL.md` instead; both describe the same workflow over the
same scripts in `scripts/` (plain Node ≥ 18; `npm install && npx playwright install chromium`).

## When to use this

The user wants to rebuild a frontend **(near) pixel-identical** to a visual
reference: a design mockup, a screenshot of another site/app, a photo of a UI, an
AI-generated concept, or an existing page to clone. Also usable for visual
regression (diffing two of the user's own pages). Not for functional testing or
backend work.

Don't judge the match by eye. Measure it and act on a per-region fix list.

## Input: the reference (recommended, not blocking)

Look for the reference first: an attached image, a path to a PNG/JPG, or a URL to
clone (screenshot it with `capture.mjs`). If missing, ask once. If the user has
none (visual regression), use one page as the golden reference and say the diff is
relative, not toward a design target.

## The loop

1. **Golden reference (immutable).** Save the target as a fixed PNG, e.g.
   `reference/target.png`. Never modify it.

2. **Screenshot your build, with the DOM map:**
   ```bash
   node scripts/capture.mjs <url> shots/mine.png --match reference/target.png --dom shots/mine.dom.json
   ```
   `--match` shoots at the reference's exact pixel size; `--dom` dumps every
   element's box + computed CSS so the analyzer can name what's wrong. It also
   pins viewport/scale/locale/timezone/light/reduced-motion and kills animations
   (add an `html.visual-test` CSS rule to zero animations/transitions/caret).

3. **Analyze — get the fix list:**
   ```bash
   node scripts/analyze.mjs reference/target.png shots/mine.png \
     --out out --regions shots/mine.dom.json --history out/history.json
   ```
   It prints a per-region fix list — each zone tagged **colour / spacing /
   missing / text**, with a perceptual colour delta (ΔE) + direction + target
   hex, the **DOM element + its computed CSS**, and a hypothesis of the cause —
   plus an overall diff % and SSIM, and a convergence verdict. It writes
   `out/analyze.json`, `out/diff.png`, and one `out/regions/rNN.png` strip
   (`reference | your build | diff`) per region.

4. **LOOK, then fix.** Open the region strips it lists (view the PNGs) — the
   picture shows what numbers can't. Fix the biggest region first, trusting the
   DOM element + CSS it points at.

5. **Re-capture, re-analyze against the same `--history` file.** The `CONVERGE`
   line says improved / regressed / stalled / CLOSE ENOUGH. Stop at CLOSE ENOUGH
   (or when the remaining regions are content you shouldn't copy).

## Different sizes, mobile, imprecise references

`analyze.mjs` needs both images at the **same pixel size**:
- **Exact size:** `capture.mjs ... --match reference/target.png`.
- **Can't re-shoot:** `resize.mjs <in> <out> <w> [h]` (retina @2x → give @1x width).
- **Mobile:** `capture.mjs ... --device "iPhone 13"` (any Playwright device).
- **Imprecise reference** (photo of a screen, lossy/skewed): add `--tolerant`,
  `--align 8` (finds+reports a small global shift), `--mask "x,y,w,h;..."` to
  ignore un-reproducible content. Treat the fix list as a guide, don't chase 0%.

## Primitives

`compare.mjs <ref> <cand> <diff.png>` (plain % + pink diff; `--engine odiff` fast
path for huge pages), `crop.mjs`, `resize.mjs` — for manual work.

## Golden rule: content beats pixels

Where the reference has mistakes or choices not to copy (wrong labels, extra
elements, fake data, an unreproducible photo), keep your version. The goal is the
look, not cloning the mockup's mistakes. `--mask` those zones or ignore them.
