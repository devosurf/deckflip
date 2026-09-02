# Spike: one HTML slide -> PPTX via Playwright measurement (wayfinder #8)

Throwaway. Answers: does `1 CSS px = 9525 EMU` plus Chromium-measured block boxes put text and shapes where the HTML put them, in real PowerPoint?

```
npm i
node spike.mjs        # measure slide.html in headless Chromium, hand-write out/spike.pptx, out/chromium.png
./render.sh           # macOS: open in Microsoft PowerPoint, save as PDF, rasterise to out/powerpoint.png
node compare.mjs      # per-shape ink-row comparison + out/diff.png
```

`MODE=spcPct|spcPts|corrected node spike.mjs` selects the line-height mapping (see below).

## Result (PowerPoint for Mac 16.x, Arial, 1280x720 Canvas)

Shape geometry, fills, horizontal text extents and every line break matched pixel-for-pixel in all three rounds
(dL/dR 0 to 1 px). Everything that drifted was vertical, inside the text box:

| line-height mapping | body pitch (CSS 33.6px) | first-line drift | pixels differing |
| --- | --- | --- | --- |
| round 1: unitless -> `spcPct`, px -> `spcPts` | 40 px (+6/line, +25 by line 4) | +6 to +7 px | 2.41% |
| round 2: always `spcPts` = measured line box | 33 px | 0 to +6 px (footer, 16px font in 40px line) | 0.57% |
| round 3: round 2 + baseline correction in `tIns` | 33 px | -2 to +1 px | 0.78% |

- `spcPct` is a percentage of the font's *natural* line height (PowerPoint's own metric, ~1.15-1.25em for Arial), not of
  font-size, so CSS unitless line-height cannot be expressed with it. `spcPts` from the Chromium-computed line box gives
  the exact pitch.
- With fixed spacing PowerPoint puts the baseline at `L * asc/(asc+desc)`; CSS puts it at `(L - (asc+desc)*f)/2 + asc*f`.
  The difference `((asc-desc)/2) * (L/(asc+desc) - f)` is folded into `tIns` (Arial hhea metrics hard-coded here; the real
  emitter reads them from the font). Residual after correction is ~1-2 px, likely Chromium integer-rounding ascent/descent.
- `save ... as save as PNG` in PowerPoint's AppleScript silently writes nothing; `save as PDF` works (Desktop only, sandbox),
  and CoreGraphics rasterises it exactly (960x540pt page -> 1280x720px). This gives an AFK real-PowerPoint render on macOS.
