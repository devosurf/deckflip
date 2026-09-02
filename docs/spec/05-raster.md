# Raster fallback

Decided in [#13](https://github.com/devosurf/deckflip/issues/13).

## Granularity: element-level, isolated capture

- The unit of rasterisation is one element's **subtree**: the element that triggered the fallback becomes one `p:pic` covering its measured border box (plus shadow/filter overflow, see below), and none of its descendants are emitted separately. Nested triggers inside an already-rasterised subtree add no further entries.
- Region-level merging is not done: two overlapping rasterised siblings stay two pictures in paint order. Simpler, and each picture keeps its own locator and hint.
- Capture is **isolated**: during the raster pass the tool sets `visibility: hidden` on `body` and `visibility: visible` on the target subtree only, so ancestors' backgrounds and overlapping siblings do not bleed into the picture, then screenshots the clip rectangle with `omitBackground: true`. Fonts and images are already loaded (measurement pass ran first); `animation`/`transition` are frozen with `animation-play-state: paused` after `load`.
- The clip rectangle is the border box expanded by the element's painted overflow (`box-shadow` extent, `filter: blur/drop-shadow` radius) and intersected with the Canvas. The picture is positioned at that rectangle. Elements fully outside the Canvas are not captured (`DROPPED_OFFCANVAS`).

## Quality

- Format: PNG with alpha, always. JPEG is never produced by the tool; photographic content arrives via `img`, which is copied through as a native picture in its source format (WebP/AVIF re-encoded to PNG, `SUBSTITUTE_IMAGE_FORMAT` info).
- Scale: `--raster-dpi` (#9), default `192` = 2x the Canvas (Chromium `deviceScaleFactor = dpi / 96`). Allowed 96-384. The picture's `a:ext` is the CSS box in EMU regardless of DPI; DPI only sets pixel density.
- Deduplication by content hash: identical captures share one media part (`media/raster-<hash>.png`); filenames are deterministic so repeated conversions are byte-stable.
- Alpha and `opacity` are baked into the pixels (no `alphaModFix` on rasters).

## Text inside a rasterised region

Not by the tool's choice: #11 makes any implicit raster text-free. The author can opt in with **`data-raster`** on any element, which rasterises that subtree text and all, entry `RASTER_EXPLICIT` (kind `rasterised`, severity `info`, so `--strict` does not fail on a deliberate choice). Use cases: an HTML-built chart, a diagram with effects, a logo lock-up. `inspect` marks such pictures `source: "raster"`, `explicit: true`.

`validate` refuses `data-raster` on a `section` (`VALIDATE_RASTER_SLIDE`, error): a fully rasterised Slide is a screenshot, which is what this tool exists to avoid; the hint points at `render` if a PNG is what the user wants.

## Report surfacing and the fix-it loop

Every raster produces one entry:

```json
{ "code": "RASTER_CSS_FILTER", "kind": "rasterised", "severity": "warning", "slide": 3,
  "locator": { "selector": "section#agenda > div.hero > div.badge" },
  "reason": "filter: blur(4px) has no DrawingML equivalent",
  "hint": "Move the blur to a background image, or accept the picture with data-raster to silence this entry" }
```

- `code` names the trigger; the complete list: `RASTER_CSS_FILTER`, `RASTER_BACKDROP_FILTER`, `RASTER_BLEND_MODE`, `RASTER_MASK`, `RASTER_CLIP_PATH`, `RASTER_GRADIENT` (conic/repeating/multi-layer), `RASTER_SHADOW` (spread/multiple), `RASTER_BORDER_STYLE`, `RASTER_BORDER_IMAGE`, `RASTER_TRANSFORM` (skew/matrix/3D), `RASTER_OUTLINE`, `RASTER_EXPLICIT`. Each `FLATTEN_*` twin (same suffix) exists for the text-bearing case.
- `reason` always quotes the offending declaration; `hint` is a fixed template per code, phrased as an edit to the HTML. `validate` produces exactly the same entries without converting, so the loop is validate -> edit -> validate until the entries the author does not accept are gone, then `convert --strict`.
- Silencing: `data-raster` converts a warning into the `RASTER_EXPLICIT` info entry; there is no global "ignore rasters" flag, because a silent screenshot is the failure mode.
- The `summary.rasterised` count and the per-Slide stderr line let a human see at a glance how much of a deck is not editable.
