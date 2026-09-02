---
name: deckflip
description: Create, convert, or edit PowerPoint decks by writing HTML slides and running the deckflip CLI. Use when the deliverable is a .pptx, when the user says "slides", "deck", or "presentation" and PowerPoint is the target, or when an existing .pptx must be edited.
---

# deckflip

Author slides as HTML, convert with `npx deckflip@latest`, and let the Conversion report drive the fix-it loop. The CLI is the source of truth: when this file and `deckflip <cmd> --help` or the report's `tool.version` disagree, trust the CLI. Run every command in a shell.

Vocabulary: a **Deck** is one HTML file (or a directory of them); a **Slide** is one `<section>` laid out on a fixed **Canvas**; a **native** element is a real, editable PowerPoint object; a **rasterised** element is a picture; a **flattened** effect was dropped to keep text editable; a **Report entry** records each of those with a stable code, where, why, and a `hint` that is an edit to the HTML.

## The loop

1. Start from `templates/deck.html` + `templates/slides.css` (copy both next to your deck). Compose Slides from `templates/layouts/`. Keep the typography scale: it is tuned to wrap safely at Canvas size.
2. `npx deckflip@latest validate deck.html --json`. Fix every `severity: error` (the conversion refuses to run on them). For each `warning`, decide: edit the HTML as the `hint` says, or accept the deviation. Repeat until only accepted entries remain.
3. `npx deckflip@latest convert deck.html --strict --json -o deck.pptx`. Exit `0` = clean; exit `4` = the PPTX and `deck.pptx.report.json` were written but entries remain; read `entries[].hint` and go back to 2. Exit `2` = validation error, nothing written.
4. `npx deckflip@latest render deck.pptx -o out/` and look at every `out/slide-NNN.png` (LibreOffice by default; `--renderer powerpoint` where PowerPoint is installed). Overflowing text, clipped boxes and wrong stacking are visible here and nowhere else.
5. `npx deckflip@latest inspect deck.html` to confirm structure: every element's kind, bounds, `source` (`native` or `raster`) and the fonts used.

Stop when `convert --strict` exits 0, or exits 4 with only entries you deliberately accepted (`RASTER_EXPLICIT` info entries from `data-raster` are the usual case), and the rendered PNGs look right.

Exit codes: `0` ok · `1` no output (Chromium or renderer failure) · `2` validation failed · `3` bad invocation · `4` strict mode with a non-empty report.

## Canvas rules

- The Canvas is `1280x720` CSS px (16:9). `<meta name="deckflip:canvas" content="4:3">` or `content="<w>x<h>"` changes it for the whole Deck. Sections are sized to the Canvas by the tool; set no width/height on them.
- One `<section>` directly under `<body>` per Slide, in order. Nothing else in `<body>`.
- Per-Slide attributes on the section: `id` (stable anchor, `<a href="#id">` jumps to it), `data-title` (slide name in PowerPoint's outline), `data-section="Name"` on the first Slide of a PowerPoint section.
- Speaker notes: `<aside class="notes">` inside the section; `p`, `ul`/`ol`, `strong`/`em`, `a` allowed.
- Assets live next to the deck and are referenced relatively (`img src="assets/x.png"`). Remote URLs are an error. `data:` URIs are fine.
- Fonts: name a concrete family first and end the stack with a safe one (`font-family: Georgia, "Times New Roman", serif`). Safe families need no embedding; details in `reference/fonts.md`.
- Layout is free: flex, grid, absolute, `calc()`, custom properties. Chromium lays the slide out; PowerPoint receives the measured boxes.

## Authoring rules that avoid entries

1. Text is only ever native. Put text in `h1`-`h6`, `p`, `li`, `td`/`th`, `blockquote`, `pre`; style runs with `span`, `strong`, `em`, `u`, `s`, `code`, `mark`, `sup`, `sub`, `a`.
2. Effects go on text-free elements. A `filter`, `clip-path`, `mix-blend-mode`, `mask`, `backdrop-filter` or skew on a text-bearing element is flattened (dropped); on a text-free sibling behind the text it becomes a picture.
3. Backgrounds: solid colours and a single `linear-gradient` are native; `radial-gradient` is an approximation (info entry); conic, repeating and layered gradients rasterise.
4. Shadows: one outer `box-shadow` without spread is native (`inset` too). Spread or multiple shadows rasterise.
5. Borders: uniform `solid`/`dashed`/`dotted` are native, per-side differences become separate lines (info). `double`, `groove`, `ridge`, `inset`, `outset` and `border-image` rasterise.
6. Transforms: `rotate`, `scale`, `translate` are native. Skew, matrix, 3D and perspective rasterise.
7. `img` for photos (PNG/JPEG as they are, WebP/GIF re-encoded); `object-fit`, `object-position` and `clip-path: inset()` crop natively. Inline `<svg>` for icons and logos: it becomes a vector picture, editable as a picture, not as shapes.
8. Lists as `ul`/`ol` (`li` content: inline text, optionally one `p`, plus one nested list, nine levels max). Tables as `table` (cell content: text, `p`, `ul`/`ol`). Both are native.
9. `data-raster` on an element when a picture is acceptable (an HTML-built chart, a diagram with effects, a logo lock-up): the whole subtree, text included, becomes one PNG with an info entry instead of a warning. Never on a `section`.
10. `data-group` on a container when the user should move its children together: emits a PowerPoint group.

Rejected outright (`VALIDATE_*` errors, exit 2): `script`, `iframe`, `object`, `embed`, `canvas`, form controls, `details`, `dialog`, `marquee`; `position: fixed|sticky`, `zoom`, `@page`; `hyphens: auto`, `text-wrap: balance|pretty`, vertical `writing-mode`, `column-*`, `text-orientation`, `font-size-adjust`, `font-stretch`; elements outside sections; missing or remote assets; `data-raster` on a section. Animations and transitions are flattened to their first frame (info).

Everything else in CSS is allowed and only influences the measured geometry. Full native / rasterised / rejected lists: `reference/authoring-subset.md`.

## Starting from a template

`templates/deck.html` is a complete seven-Slide Deck (title, section divider, bullets, two columns, image with caption, big number, closing) that converts with zero entries; `templates/slides.css` is its stylesheet; `templates/layouts/*.html` holds each Slide as a standalone `<section>` to paste into a Deck. The templates are the only design opinion here: sane defaults, no palette or imagery rules. Change colours through the custom properties at the top of `slides.css`; keep the type scale and the `.slide` padding.

## Editing an existing PPTX

`deckflip convert deck.pptx` (PPTX -> HTML) is not available in this version; `convert --to html` exits 3. When it is: convert, edit `deck.html` in place keeping `deck.assets/` beside it, then `deckflip convert deck.html` back. Elements marked `data-preserve` are opaque (charts, SmartArt, OLE, masters): move, resize or delete them, but content edits inside are ignored (`DROPPED_EDIT_OPAQUE`). `PRESERVE_*` entries list what came through untouched. Details: `reference/round-trip.md`.

## Reading the report

- `entries[]` each carry `code`, `kind` (`error | rasterised | flattened | substituted | dropped | preserved | overridden`), `severity` (`error | warning | info`), `slide` (1-based), `locator.selector`, `reason` (quotes the offending declaration) and `hint` (the edit that makes it native).
- Families: `VALIDATE_*` and two `FONT_*` errors stop the conversion; `RASTER_*` means a picture was emitted; `FLATTEN_*` means an effect was dropped and the text kept; `SUBSTITUTE_*` is an approximation you can usually accept; `FONT_*` warnings mean the viewer may substitute the font; `DROPPED_*`/`PRESERVE_*` concern round trips; `OVERRIDE_CANVAS_SIZE` records `--size`.
- `--strict` turns any entry into exit 4 while still writing everything. There is no flag to silence rasters: `data-raster` is the way to say "this picture is intended".
- A warning you did not intend is a bug in your HTML, not in the tool: follow the hint.
- Sidecar `<output>.report.json` is always written; `--json` prints the same document; the stderr summary lists one line per Slide and one per entry.

Every code with its trigger and hint: `reference/report-codes.md`.

## Pointers

- `reference/authoring-subset.md`: what is native, rasterised, rejected; the text box mapping in one page.
- `reference/report-codes.md`: every code, meaning, and the fix it wants.
- `reference/fonts.md`: the safe set, how a `font-family` stack resolves, embedding.
- `reference/round-trip.md`: editing an existing PPTX once PPTX -> HTML ships.
- `npx deckflip@latest <convert|validate|render|inspect> --help`: flags and defaults.
