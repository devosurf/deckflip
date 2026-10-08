# Report codes

The complete, stable list of Report entry codes. Codes are never renamed once published; new ones may be added. Every non-error entry carries a `hint`; the templates below are the hints, with `{decl}` replaced by the offending CSS declaration and `{el}` by the element name.

Kinds (extends [01-cli.md](01-cli.md) with `preserved` and `flagged`; `summary` gains a count for each): `error | rasterised | flattened | substituted | dropped | preserved | overridden | flagged`.

Three rules hold across families:

- `VALIDATE_*` and the two `FONT_*` errors are the `severity: error` codes that come from `validate` (and from `convert`, which runs it first) and stop conversion with exit 2.
- `VERIFY_*` are the other `severity: error` codes: Verification found the written output differs from what the source shows, a deckflip defect. They come from `convert` (after the output is written, which it keeps) and from `verify`, and exit 5 whatever Strict mode says.
- Every `RASTER_<X>` has a `FLATTEN_<X>` twin with the same trigger, used when the element bears text (the effect is dropped, the text stays native).

## VALIDATE_* (kind `error`, severity `error`)

| Code | Trigger | Hint |
| --- | --- | --- |
| `VALIDATE_UNKNOWN_META` | `meta[name^="deckflip:"]` not in the dialect | Remove it or check the spelling; known names: `deckflip:canvas` |
| `VALIDATE_STRAY_CONTENT` | element in `body` outside any `section` | Move it into a `<section>`; only sections are Slides |
| `VALIDATE_SLIDE_SIZE` | a section's border box is not the Canvas | Do not set width/height on sections, or match `{W}x{H}` exactly |
| `VALIDATE_REMOTE_ASSET` | `http(s):` or other non-local URL | Save the file into the Deck's asset directory and reference it relatively |
| `VALIDATE_MISSING_ASSET` | local asset not found | Check the path relative to `{file}` |
| `VALIDATE_IMAGE_ASSET` | invalid embedded image data, unsupported image format, or image decoding failure | Use a valid PNG, JPEG, GIF, WebP or SVG image; check the data URI encoding for embedded images |
| `VALIDATE_ELEMENT` | `script`, `iframe`, `object`, `embed`, `canvas`, form controls, `details`, `dialog`, `marquee` | Replace `{el}` with static HTML; scripts are never run |
| `VALIDATE_TEXT_CSS` | `hyphens: auto`, `text-wrap: balance\|pretty`, vertical `writing-mode`, `column-*`, `text-orientation`, `font-size-adjust`, `font-stretch` | Remove `{decl}`: PowerPoint cannot reproduce its line breaks |
| `VALIDATE_POSITION` | `position: fixed\|sticky`, `zoom`, `@page` | Use `absolute` or flow layout inside the section |
| `VALIDATE_LIST_CONTENT` | `li` with block content other than one `p` and one nested list, or nesting deeper than 9 | Keep list items to inline text plus one nested list |
| `VALIDATE_TABLE_CONTENT` | table cell with block content other than `p`/`ul`/`ol` | Keep cell content to text, paragraphs and lists |
| `VALIDATE_RASTER_SLIDE` | `data-raster` on a `section` | Rasterise parts, not the Slide; use `deckflip render` for PNGs |
| `VALIDATE_LINK_TARGET` | `a[href^="#"]` whose target is not a Slide id | Point `{href}` at a section id; Slides: `{slides}` |

## FONT_* (errors, then warnings; kind `substituted` for warnings)

| Code | Severity | Trigger | Hint |
| --- | --- | --- | --- |
| `FONT_UNRESOLVED` | error | no family in the stack is deck-provided or installed | Install `{family}` or add a safe family such as Arial to the stack |
| `FONT_GENERIC_ONLY` | error | the first resolvable entry is a generic family | Put a concrete family before `{generic}` |
| `FONT_NOT_SAFE` | warning | Resolved font outside the safe set and not embedded | Use a safe font, or pass `--embed-fonts` |
| `FONT_EMBED_RESTRICTED` | warning | `fsType` forbids editable embedding | The licence of `{family}` forbids embedding; choose another font |
| `FONT_EMBED_FORMAT` | warning | WOFF2 or TTC source cannot be embedded | Provide `{family}` as TTF, OTF or WOFF |
| `FONT_MISSING_FOR_LAYOUT` | warning | PPTX->HTML: source font not installed, not embedded | Install `{family}` before editing to keep layout faithful |

## RASTER_* (kind `rasterised`, severity `warning`; `RASTER_EXPLICIT` is `info`)

| Code | Trigger | Hint |
| --- | --- | --- |
| `RASTER_CSS_FILTER` | `filter` | Move `{decl}` onto a background image, or accept the picture with `data-raster` |
| `RASTER_BACKDROP_FILTER` | `backdrop-filter` | Remove `{decl}`; PowerPoint has no backdrop effects |
| `RASTER_BLEND_MODE` | `mix-blend-mode` | Remove `{decl}` or pre-compose the image |
| `RASTER_MASK` | `mask*` | Apply the mask to the image file instead |
| `RASTER_CLIP_PATH` | `clip-path` other than `inset()` on `img` | Use `border-radius`, `overflow: hidden` with a rectangle, or pre-crop the image |
| `RASTER_GRADIENT` | conic, repeating, or layered gradients | Use a single `linear-gradient` or `radial-gradient` |
| `RASTER_SHADOW` | `box-shadow` with spread or multiple shadows | Use one outer shadow without spread |
| `RASTER_BORDER_STYLE` | `double`, `groove`, `ridge`, `inset`, `outset` | Use `solid`, `dashed` or `dotted` |
| `RASTER_BORDER_IMAGE` | `border-image` | Use a plain border or an `img` |
| `RASTER_TRANSFORM` | skew, matrix, 3D, or perspective transforms | Only `rotate`, `scale` and `translate` are native |
| `RASTER_OUTLINE` | non-uniform `outline` | Use `border` |
| `RASTER_EXPLICIT` | `data-raster` | (info) Remove `data-raster` to get editable objects |

## FLATTEN_* (kind `flattened`)

| Code | Severity | Trigger | Hint |
| --- | --- | --- | --- |
| `FLATTEN_CSS_FILTER` ... `FLATTEN_OUTLINE` | warning | the `RASTER_*` trigger on a text-bearing element | `{decl}` was dropped to keep the text editable; put the effect on a text-free sibling behind the text |
| `FLATTEN_TEXT_STROKE` | warning | `-webkit-text-stroke` | Dropped; use a bold weight or colour instead |
| `FLATTEN_TEXT_BACKGROUND_CLIP` | warning | `background-clip: text` | Dropped; use a solid `color` |
| `FLATTEN_TEXT_DECORATION_STYLE` | warning | non-solid decoration styles | Rendered as solid |
| `FLATTEN_TEXT_FONT_VARIANT` | warning | `font-variant-*` other than small-caps | Dropped |
| `FLATTEN_TEXT_SHADOW_MULTI` | warning | multiple `text-shadow` layers | First shadow kept |
| `FLATTEN_ANIMATION` | info | `animation`/`transition` present | Final state after load was used |
| `FLATTEN_OFFCANVAS` | warning | element partly outside the Canvas | PowerPoint clips at the slide edge; move `{el}` inside `{W}x{H}` |
| `FLATTEN_OVERFLOW_CLIP` | warning | `overflow` other than `visible` on a Text block or an ancestor below the section hides part of its text (a line counts once more than a quarter of it is outside the padding box) | PowerPoint cannot clip text: size `{el}` to fit its text, or remove the lines `{decl}` hides |
| `FLATTEN_MEDIA_POSTER` | warning | `video` without `poster` | Add `poster` so PowerPoint shows a frame |

## SUBSTITUTE_* (kind `substituted`, severity `info`)

| Code | Trigger | Hint |
| --- | --- | --- |
| `SUBSTITUTE_SVG_PICTURE` | inline `svg` | Emitted as a vector picture; use HTML boxes for editable shapes |
| `SUBSTITUTE_GRADIENT_RADIAL` | `radial-gradient` | Emitted as a path gradient; check `render` |
| `SUBSTITUTE_BORDER_SIDES` | per-side borders | Emitted as separate lines |
| `SUBSTITUTE_OPACITY` | `opacity` | Folded into fill/line/text alpha |
| `SUBSTITUTE_IMAGE_FORMAT` | WebP/AVIF source | Re-encoded to PNG |
| `SUBSTITUTE_LIST_STYLE` | unsupported `list-style-type` or `reversed` | Emitted as decimal numbering |
| `SUBSTITUTE_FONT_WEIGHT` | weight without a matching face | Nearest of regular/bold used |

## PRESERVE_* (kind `preserved`)

| Code | Severity | Trigger | Hint |
| --- | --- | --- | --- |
| `PRESERVE_OPAQUE_CHART`, `_SMARTART`, `_OLE`, `_VECTOR`, `_TEXT_EFFECTS`, `_ANIMATION`, `_COMMENTS`, `_VBA`, `_MASTER` | info | opaque content carried through | Editable only as a whole (move/resize/delete) |
| `PRESERVE_SOURCE_MISSING` | warning | manifest or `source.pptx` absent or hash mismatch | Everything was re-emitted from HTML; restore `{dir}` to keep the original parts |
| `PRESERVE_UNKNOWN_ID` | info | `data-shape-id` not in the manifest | Ignored |

## DROPPED_* (kind `dropped`)

| Code | Severity | Trigger | Hint |
| --- | --- | --- | --- |
| `DROPPED_EDIT_OPAQUE` | warning | content edit inside `data-preserve` | Only geometry of opaque elements is editable; recreate it as HTML to change content |
| `DROPPED_ANIMATION` | warning | timing references a deleted shape | Restore the shape or accept the loss |
| `DROPPED_TEXT_EFFECTS` | warning | WordArt/3D shape edited | Effects cannot be re-emitted from HTML |
| `DROPPED_EXTENSION` | info | unknown `extLst` on an edited shape | none needed |
| `DROPPED_OFFCANVAS` | info | element fully outside the Canvas | Delete it or move it inside |
| `DROPPED_GENERATED_CONTENT` | warning | `::before`/`::after` with text, a counter or an image, or an empty string that paints a box; not inside `data-raster` or opaque content | Put the text or box into the HTML: `{decl}` content is not converted |

## LAYOUT_* (kind `flagged`, severity `warning`)

Layout flags: the conversion is faithful, but the Slide shows something an author rarely intends. Read from what Chromium paints; HTML input only, from `validate` and `convert`. Strict mode counts them like any entry; accepting one is exiting 4 with only entries you meant.

| Code | Trigger | Hint |
| --- | --- | --- |
| `LAYOUT_TEXT_OVERFLOW` | a line runs past the border box of the Text block when it paints, else of its nearest painting ancestor below the section: more than 1 px sideways or a quarter of the line vertically; clipped text is `FLATTEN_OVERFLOW_CLIP` instead | Give `{el}` room for its text or shorten the text; accept it only if the spill is intended |
| `LAYOUT_TEXT_OVERLAP` | lines of two Text blocks intersect by more than 2 px both ways; once per pair, at the later block | Move `{el}` clear of the text it covers; accept it only if the layering is intended |
| `LAYOUT_TEXT_ILLEGIBLE` | WCAG 2 contrast below 2:1 between the text colour (opacity applied) and the colours painted beneath it, composited over white, the worst gradient stop counting; no flag over a picture, an image fill or a blending effect | Raise the contrast between the text colour of `{el}` and what is painted behind it |
| `LAYOUT_WRAP_RISK` | no wrap width keeps the widest line `t` from its edge and the first wrapped word `t` from fitting, with `t` PowerPoint's calibrated line-width tolerance ([04](04-text-mapping.md)); the midpoint is emitted | Reword `{el}` or change its width by a few px so no line ends right at its wrap width; PowerPoint may break it elsewhere |

## VERIFY_* (kind `error`, severity `error`)

Verification ([10-rendering-and-verification.md](10-rendering-and-verification.md#verification)): the output written by `convert`, or named to `verify`, differs from what the source shows. The output is kept; the exit code is 5. The hint is the same for all: report the defect with the report file.

| Code | Trigger |
| --- | --- |
| `VERIFY_TEXT_MISSING` | Visible text (or speaker-notes text) of the source is absent from the output, by word, per Slide |
| `VERIFY_TEXT_EXTRA` | the output holds text the source does not show |
| `VERIFY_GEOMETRY` | an element sits more than 0.5 px (plus the wrap-width guard) or 0.1° from where the source shows it, or has no counterpart on the other side |
| `VERIFY_STACKING` | two overlapping elements are stacked in the output in the other order than Chromium paints them |

## OVERRIDE_* and RENDER_*

| Code | Kind | Severity | Trigger |
| --- | --- | --- | --- |
| `OVERRIDE_CANVAS_SIZE` | overridden | info | `--size` differs from deck meta |
| `RENDER_FONT_SUBSTITUTED` | substituted | info | LibreOffice rendered with a substitute for an Office-bundled font |
