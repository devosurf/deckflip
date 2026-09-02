# Authoring subset

Four rules govern what the converter does with an element:

1. Chromium decides layout; PowerPoint receives boxes. Any CSS layout works; the output is the measured border box of every element with visual presence.
2. Text is never rasterised implicitly. A text-bearing element loses an unmappable effect (`FLATTEN_*`) and keeps native text. Only text-free elements become pictures, unless you write `data-raster`.
3. An element emits a shape only if it paints: it is a Text block, or has a visible `background`, `border`, `outline`, `box-shadow`, or is `img`/`svg`/`table`/`video`/`audio`/`hr`. Layout-only wrappers emit nothing. A painting container whose only text is exactly one Text block emits one shape with a text body.
4. Shapes are emitted flat, in paint order. `data-group` on a container wraps its painting descendants in a PowerPoint group (nesting allowed).

A **Text block** is the lowest block element whose rendered children are all inline (text, `span`, `br`, inline `img`), plus `ul`/`ol` and table cells. It becomes exactly one text box; consecutive blocks are never merged.

## Native (no entry)

Elements: `section`; block containers (`div`, `header`, `footer`, `main`, `article`, `nav`, `figure`, `figcaption`, `aside` other than `.notes`); Text blocks (`h1`-`h6`, `p`, `blockquote`, `pre`, `li`, `dt`, `dd`, `td`, `th`); inline (`span`, `strong`, `b`, `em`, `i`, `u`, `s`, `del`, `ins`, `code`, `kbd`, `mark`, `sup`, `sub`, `small`, `a`, `br`, `abbr`, `time`); `ul`, `ol`; `img` (PNG, JPEG, GIF first frame, WebP re-encoded, SVG file as vector picture with PNG fallback); `table` with `colspan`/`rowspan`; `hr`; inline `svg` (vector picture, `SUBSTITUTE_SVG_PICTURE` info).

| CSS | PowerPoint |
| --- | --- |
| `background-color` | solid fill with alpha |
| `linear-gradient(...)`, any angle and stops | linear gradient fill |
| `radial-gradient(...)` | path gradient, approximate (`SUBSTITUTE_GRADIENT_RADIAL` info) |
| `background-image: url()` with `background-size`, `background-position`, `background-repeat` | picture fill: stretched with a crop (`cover`, `contain`, `no-repeat`) or tiled; a `background-color` beneath it is not emitted, so a `contain` margin is transparent |
| uniform `border` (`solid`, `dashed`, `dotted`) | outline |
| per-side borders | one line per side (`SUBSTITUTE_BORDER_SIDES` info) |
| `border-radius` uniform / per-corner / elliptical | rounded rectangle / custom geometry |
| single outer `box-shadow` without spread; single `inset` shadow | outer / inner shadow |
| `opacity` | folded into fill, line and text alpha (`SUBSTITUTE_OPACITY` info) |
| `transform: rotate()`, `translate()`, `scale()` | rotation, position, size (scale folds into font size) |
| `object-fit`, `object-position`, `clip-path: inset()` on `img` | picture crop |
| `overflow: hidden` | no-op; children fully outside the Canvas are dropped (`DROPPED_OFFCANVAS` info), partly outside are clipped by PowerPoint (`FLATTEN_OFFCANVAS` warning) |
| `visibility: hidden`, `display: none` | not emitted |
| uniform `outline` without offset on a border-less box | outline |

## Rasterised on text-free elements (`RASTER_*` warning), flattened on text-bearing ones (`FLATTEN_*` warning)

`filter`; `backdrop-filter`; `mix-blend-mode`; `mask*`; `clip-path` other than `inset()` on `img`; `conic-gradient`, `repeating-*-gradient`, layered backgrounds; `box-shadow` with spread or multiple shadows; `border-style` `double`/`groove`/`ridge`/`inset`/`outset`; `border-image`; `transform` other than rotate/scale/translate; `outline` that is non-solid/dashed/dotted, offset, or doubles a border.

A rasterised element becomes one PNG covering its painted extent (shadow and blur included), captured in isolation at `--raster-dpi` (default 192 = 2x). Descendants are inside the picture; nested triggers add no entries. `data-raster` does the same on purpose (`RASTER_EXPLICIT`, info) and includes text.

## Text effects flattened (`FLATTEN_TEXT_*` warning)

`-webkit-text-stroke` (dropped), `background-clip: text` (dropped), non-solid `text-decoration-style` (rendered solid), `font-variant-*` other than small-caps (dropped), multiple `text-shadow` layers (first kept). `animation`/`transition`: first frame used (`FLATTEN_ANIMATION`, info). `video` without `poster`: grey box in PowerPoint (`FLATTEN_MEDIA_POSTER`).

## Rejected (`VALIDATE_*` error, exit 2)

`script`, `iframe`, `object`, `embed`, `canvas`, `input`, `button`, `select`, `textarea`, `details`, `summary`, `dialog`, `marquee` (`VALIDATE_ELEMENT`); `hyphens: auto`, `text-wrap: balance|pretty`, vertical `writing-mode`, `column-count`/`column-width`, `text-orientation`, `font-size-adjust`, `font-stretch` (`VALIDATE_TEXT_CSS`); `position: fixed|sticky`, `zoom`, `@page` (`VALIDATE_POSITION`); content outside sections; unknown `deckflip:*` meta; remote or missing assets; `li` with block content beyond one `p` and one nested list, or deeper than nine levels; table cells with block content beyond `p`/`ul`/`ol`; `data-raster` on a `section`; unresolvable or generic-only font stacks.

## Text box mapping in one page

- Box = the Text block's border box; a border deflates the shape by half its width so the stroke covers the CSS border. Insets = CSS padding, plus a baseline correction so PowerPoint's first baseline lands where Chromium's did. Autofit is off; PowerPoint wraps naturally and the converter guards wrap widths so breaks match.
- One paragraph per block, per `li`, per line of `pre`. Line spacing is exact points from the measured line box; paragraph spacing from measured gaps. `text-align` maps to `l`/`ctr`/`r`/`just`.
- Lists: bullet indent from the measured marker; `disc`/`circle`/`square`/`decimal`/`lower-alpha`/`upper-alpha`/`lower-roman`/`upper-roman` map to PowerPoint bullets and numbering; `ol[start]` honoured; other types become decimal (`SUBSTITUTE_LIST_STYLE` info).
- Runs: `font-size`, resolved `font-family`, weight >= 600 bold, italic, underline, strike, `color`, `letter-spacing`, `text-transform` (applied to the text), small-caps, `sup`/`sub`, `mark` highlight, single `text-shadow`, `a[href]` links (`#slide-id` jumps within the deck).
- Tables: columns from the first row's measured widths, rows from measured heights, spans, per-edge borders, cell fill (cell then row), cell padding, `vertical-align`. `caption` becomes a separate text box.
