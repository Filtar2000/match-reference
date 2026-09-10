# match-reference

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-3c873a.svg)
![Claude Code · Codex · Cursor](https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor-6b5bd6.svg)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

A coding-agent skill — for [Claude Code](https://claude.com/claude-code), [Codex](https://openai.com/codex/), Cursor, or any tool that reads `AGENTS.md` — plus standalone Node scripts, that rebuilds a frontend to look **(near) pixel-identical** to a visual reference: a design mockup, a screenshot of another site or app, a photo of a UI, or an existing page you want to clone.

Most visual tools stop at *"here's a red overlay, good luck."* This one **measures the gap and hands the agent a fix list it can execute** — for each wrong zone: what kind of mistake it is, how far off the colour is and in which direction, the exact element and CSS behind it, and a plain-language hypothesis of the cause — then iterates until it converges.

![match-reference loop in action](docs/example/loop.gif)

## What makes it different

| | Free OSS diff tools | Paid "Visual AI" (Applitools, Percy…) | **match-reference** |
|---|:---:|:---:|:---:|
| Runs locally, no SaaS | ✅ | ❌ | ✅ |
| Perceptual colour (ΔE), not raw pixels | ⚠️ some | ✅ | ✅ |
| Output an agent can **act on** (per-element fix list) | ❌ | ⚠️ (regression-focused) | ✅ |
| Rebuild from a **foreign** mockup/screenshot/photo | ❌ (needs your own baseline) | ❌ | ✅ |
| Convergence verdict across iterations | ❌ | ⚠️ | ✅ |

The empty quadrant — *local + perceptual + made for an LLM to rebuild-until-identical from an arbitrary image* — is exactly where this sits.

## Example

The reference vs. an in-progress build with three mistakes — a lighter button blue, a greyed-out condition label, and tighter card padding:

| Reference | Your build | Diff (`3.72%`) |
|---|---|---|
| ![reference](docs/example/reference.png) | ![your build](docs/example/mine.png) | ![diff](docs/example/diff.png) |

`analyze.mjs` turns that into an executable fix list:

```text
OVERALL  3.718% pixels differ  ·  SSIM 0.9705 (1.0 = identical)  ·  several regions off
CONVERGE first pass

#1  [text]   box 264,360 372x48  → button.btn
    colour is off (ΔE 10.8): make it bluer, toward ~#2f7bed
    (computed background rgb(110,163,242)).            look: out/regions/r01.png
#2  [spacing/alignment]  box 240,420 420x12  → div.card
    thin band near the bottom edge — padding off by ~12px (padding 18px 28px).
#3  [text]   box 264,240 96x12  → div.cond
    colour is off (ΔE 24.1): make it warmer (less blue), toward ~#f39c12.
```

…and writes one `reference | your build | diff` strip per region for the agent to **look at** (models fix faster from the picture than from numbers):

![region strip: reference | your build | diff](docs/example/region-strip.png)

## How it works — the loop

1. **Golden reference (immutable).** Save the target as a fixed PNG. It's the ruler.
2. **Screenshot your build deterministically, with the DOM map** — fixed viewport, scale, locale, timezone, light scheme, animations off, fonts loaded; `--dom` also dumps every element's box + computed CSS.
3. **Analyze** → the per-region fix list (category, ΔE + direction + target colour, the element + CSS, a hypothesis), an overall diff % + SSIM score, and image strips.
4. **Look at the strips, fix one region at a time**, biggest first, trusting the element it points at.
5. **Re-capture, re-analyze** against the same history file → it tells you *improved / regressed / stalled / close enough*. Stop at close enough.

```
reference.png ─┐
               ├─▶ analyze.mjs ─▶ fix list + strips + SSIM + converge verdict
your build ─▶ capture.mjs ──┘          │
   ▲   (--dom: element + CSS map)      ▼
   └──────── fix the named element ◀───┘   (repeat until CLOSE ENOUGH)
```

## Install

Every path needs [Node.js](https://nodejs.org) ≥ 18. The one-time install:

```bash
npm install
npx playwright install chromium   # downloads a ~180 MB headless Chromium
```

### Claude Code

```bash
git clone https://github.com/Filtar2000/match-reference ~/.claude/skills/match-reference
cd ~/.claude/skills/match-reference
npm install && npx playwright install chromium
```
Then invoke it with `/match-reference`, or just describe wanting to match a reference image — the `SKILL.md` description lets Claude pick it up.

### Codex (and Cursor, or any agent that reads `AGENTS.md`)

These tools read an `AGENTS.md` from the working directory. Simplest — clone it into the project:

```bash
cd your-project
git clone https://github.com/Filtar2000/match-reference tools/match-reference
cd tools/match-reference && npm install && npx playwright install chromium
```
The agent picks up `tools/match-reference/AGENTS.md`. (Or clone anywhere and append its `AGENTS.md` to your global `~/.codex/AGENTS.md`, adjusting the script paths.)

### Standalone (no agent)

```bash
git clone https://github.com/Filtar2000/match-reference
cd match-reference && npm install && npx playwright install chromium
```

## Usage

```bash
# 1. Screenshot your build at the reference's exact size, with the element map
node scripts/capture.mjs http://localhost:5000/ shots/mine.png \
     --match reference/target.png --dom shots/mine.dom.json

# 2. Analyze -> per-region fix list + strips + SSIM + convergence
node scripts/analyze.mjs reference/target.png shots/mine.png \
     --out out --regions shots/mine.dom.json --history out/history.json

# 3. Look at out/regions/*.png, fix the named elements, then repeat 1–2.
```

Suggested layout:

```
pixel/
  reference/   # the golden reference(s), immutable
  shots/       # screenshots of your build (+ .dom.json element maps)
  out/         # analyze.json, diff.png, regions/*.png, history.json
```

### Scripts

| Script | What it does | Key flags |
|---|---|---|
| `capture.mjs <url> <out.png>` | Deterministic Playwright screenshot | `--match <ref.png>` `--dom <json>` `--device "iPhone 13"` `--width` `--height` `--full` `--selector` `--scale` `--wait` |
| `analyze.mjs <ref.png> <cand.png>` | **The brain.** Per-region fix list (category, ΔE + direction, element + CSS, hypothesis), SSIM, convergence, image strips | `--out` `--regions <dom.json>` `--history <json>` `--threshold` `--tolerant` `--align N` `--mask "x,y,w,h;…"` `--cell` `--min` |
| `compare.mjs <ref> <cand> <diff.png>` | Plain pixel diff (% + pink PNG) | `--threshold` `--aa` `--engine odiff` |
| `crop.mjs <in> <out> <x> <y> <w> <h>` | Crop a region (pngjs; no ImageMagick) | — |
| `resize.mjs <in> <out> <w> [h]` | Resize a PNG to normalize sizes before diffing | height auto if omitted |

## Different sizes, mobile, imprecise references

`analyze.mjs` needs both images at the **same pixel size**.

- **Shoot at the reference's size:** `capture.mjs ... --match reference/target.png`.
- **Can't re-shoot?** Normalize: `node scripts/resize.mjs reference/raw@2x.png reference/target.png 900` (retina @2x → @1x width).
- **Mobile / phone reference:** `capture.mjs ... --device "iPhone 13"` (any Playwright device: "Pixel 7", "iPad Mini", …). Combine with `--match`/`resize.mjs` for a specific pixel size.
- **Imprecise reference** (a photo of a screen, a lossy or hand-cropped image, slight skew): a 0% diff is impossible and isn't the goal. Add `--tolerant` (looser diff), `--align 8` (finds and reports a small global pixel shift), and `--mask "x,y,w,h; ..."` to ignore un-reproducible content (a logo, a photo, live data). Then treat the fix list as a guide — fix structure and colour region by region.

## Golden rule: content beats pixels

Where the reference has mistakes or choices you should **not** copy (wrong labels, an extra element, fake placeholder data, a photo you can't reproduce), keep your version. The goal is the *look*, not cloning the mockup's mistakes — `--mask` those zones or ignore them in the fix list.

## Under the hood

Deterministic capture (Playwright, bundled Chromium) · pixel diff ([pixelmatch](https://github.com/mapbox/pixelmatch), YIQ + anti-aliasing aware) · perceptual colour ([CIEDE2000](https://en.wikipedia.org/wiki/Color_difference#CIEDE2000)) · structural similarity ([ssim.js](https://github.com/obartra/ssim)) · region clustering + DOM element mapping · optional [odiff](https://github.com/dmtrKovalenko/odiff) fast path. No ImageMagick required.

## License

MIT — see [LICENSE](LICENSE).
