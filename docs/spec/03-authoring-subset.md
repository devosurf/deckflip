# Authoring subset

Decided in [#11](https://github.com/devosurf/deckflip/issues/11).

## Governing rules

1. **Chromium decides layout; DrawingML receives boxes.** Any CSS layout mechanism is allowed (flex, grid, float, absolute, tables-for-layout, `calc`, custom properties, media queries at Canvas width). The output is the measured border box of each element that has visual presence. Layout properties never cause fallback.
2. **Text is never rasterised implicitly.** A text-bearing element whose visual property has no DrawingML mapping loses that property (kind `flattened`, warning, hint) and keeps native text. Only a text-free element can be rasterised. The one exception is the author writing `data-raster` (#13).
3. **An element emits a shape only if it paints.** An element paints if it is a Text block, or has a non-transparent `background`, a visible `border`/`outline`, a `box-shadow`, or is an `img`/`svg`/`table`/`video`/`audio`/`hr`. Pure layout wrappers emit nothing. A painting container whose descendants are its only text (exactly one Text block, no other painting descendants) emits one shape with a text body; otherwise the container emits a text-free shape and each descendant emits its own.
4. **Flat shape tree.** Shapes are emitted in paint order as siblings of `p:spTree`. `data-group` on a container emits a `p:grpSp` for that container's painting descendants (nesting allowed).

## Text block

A **Text block** is the lowest block-level element whose rendered children are all inline content (text, inline elements, `br`, inline `img`), plus two structured cases: a `ul`/`ol` (each `li` a paragraph; `li` may contain inline content, a single `p`, and one nested `ul`/`ol`; anything else is `VALIDATE_LIST_CONTENT`, error) and a `table` cell. `pre` is a Text block with preserved whitespace. Mapping detail is #12.

## Native (permitted, no report entry)

**Elements.** `section`, block containers (`div`, `header`, `footer`, `main`, `article`, `nav`, `figure`, `figcaption`, `aside` other than `.notes`), Text blocks (`h1`-`h6`, `p`, `blockquote`, `pre`, `li`, `dt`, `dd`, `td`, `th`), inline (`span`, `strong`, `b`, `em`, `i`, `u`, `s`, `del`, `ins`, `code`, `kbd`, `mark`, `sup`, `sub`, `small`, `a`, `br`, `abbr`, `time`), `ul`, `ol`, `img` (PNG, JPEG, GIF first frame, WebP re-encoded to PNG, SVG file as `asvg:svgBlip` with PNG fallback), `table`/`thead`/`tbody`/`tfoot`/`tr`/`td`/`th` with `colspan`/`rowspan`, `hr` (line shape), `video`/`audio` (media, #14), inline `svg` (vector picture, `substituted` info entry `SUBSTITUTE_SVG_PICTURE`: editable as a PowerPoint picture, not as shapes).

**CSS with a direct mapping.**

| CSS | DrawingML |
| --- | --- |
| `background-color` | `a:solidFill` (+ `a:alpha`) |
| `background: linear-gradient(...)` any stops/angle | `a:gradFill/a:lin` |
| `background: radial-gradient(...)` | `a:gradFill/a:path path="circle"` (approximation; `substituted` info `SUBSTITUTE_GRADIENT_RADIAL`) |
| `background-image: url()` + `background-size cover/contain`, `background-position`, `background-repeat` | `a:blipFill` with `a:srcRect` crop or `a:tile` |
| `border` uniform (width, style solid/dashed/dotted, colour) | `a:ln` (+ `a:prstDash`) |
| `border` per-side different | one `a:cxnSp` line per side (`substituted` info `SUBSTITUTE_BORDER_SIDES`) |
| `border-radius` uniform | `prstGeom roundRect` with `adj` |
| `border-radius` per-corner / elliptical | `a:custGeom` path |
| `box-shadow` single, outer, no spread | `a:effectLst/a:outerShdw` (blur, offset, colour, alpha) |
| `box-shadow` single `inset`, no spread | `a:innerShdw` |
| `opacity` | multiplied into fill/line/text alpha; pictures via `a:alphaModFix` (`substituted` info `SUBSTITUTE_OPACITY`) |
| `transform: rotate(<angle>)` (alone, or with translate) | `a:xfrm/@rot`; translate folded into position |
| `transform: scale()` | folded into size (text: into font size) |
| `object-fit: cover/contain`, `object-position` | `a:srcRect` |
| `clip-path: inset(...)` on `img` | `a:srcRect` |
| `overflow: hidden` on a container | no-op (children outside are clipped by their own measured boxes; children fully outside are dropped with `DROPPED_OFFCANVAS` info) |
| `visibility: hidden`, `display: none` | element not emitted |
| Text properties | see #12 (`color`, `font-*`, `line-height`, `letter-spacing`, `text-align`, `text-decoration`, `text-transform`, `text-shadow`, `white-space`, `direction`, `list-style-type`, `padding`, `vertical-align`) |

## Permitted but rasterised (text-free elements only; `RASTER_*` warning, #13)

`filter`, `backdrop-filter`, `mix-blend-mode`, `mask*`, `clip-path` other than rectangular `inset()` on `img`, `conic-gradient`, `repeating-*-gradient`, multiple gradient layers, `box-shadow` with spread or multiple shadows, `border-style` `double`/`groove`/`ridge`/`inset`/`outset`, `border-image`, `transform` other than rotate/scale/translate (skew, matrix, 3D), `outline` (rendered as raster if non-uniform, else mapped to `a:ln`).

On a text-bearing element these same properties are **flattened** (`FLATTEN_*` warning with the same suffix) and the hint says how to split the effect onto a text-free sibling.

## Rejected by `validate` (error, exit 2)

- `script`, `iframe`, `object`, `embed`, `canvas`, form controls (`input`, `button`, `select`, `textarea`), `details`/`summary`, `dialog`, `marquee`: `VALIDATE_ELEMENT`. Scripts are not executed during measurement; rejecting them keeps output deterministic.
- Text properties PowerPoint cannot reproduce without changing line breaks: `hyphens: auto`, `text-wrap: balance|pretty`, `writing-mode` other than `horizontal-tb`, `column-count`/`column-width`, `text-orientation`, `font-size-adjust`, `font-stretch` other than normal (`VALIDATE_TEXT_CSS`).
- Layout that cannot be measured to one box: `position: fixed`/`sticky` (`VALIDATE_POSITION`), CSS `@page`, `zoom`.
- Slide structure faults from #10 (`VALIDATE_SLIDE_SIZE`, `VALIDATE_STRAY_CONTENT`, `VALIDATE_REMOTE_ASSET`, `VALIDATE_MISSING_ASSET`, `VALIDATE_UNKNOWN_META`, `VALIDATE_LIST_CONTENT`).
- Font faults from #15 (`FONT_UNRESOLVED`, `FONT_GENERIC_ONLY`).

Everything else in CSS is allowed and simply has no effect on the emitted OOXML beyond its influence on measured geometry; `render` diffs reveal any drift. Elements partly outside the Canvas are emitted as measured (PowerPoint clips), with `FLATTEN_OFFCANVAS` as a warning. Animations and transitions (`animation`, `transition`) are flattened to the state after `load` + `fonts.ready` (`FLATTEN_ANIMATION`, info).
