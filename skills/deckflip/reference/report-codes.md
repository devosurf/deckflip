# Report codes

Every entry carries `code`, `kind`, `severity`, `slide`, `locator`, `reason` and (except errors) `hint`. `{decl}` in a hint is the offending CSS declaration, `{el}` the element name. Two rules: `VALIDATE_*` and the two `FONT_*` errors are the only `severity: error` codes and stop the conversion (exit 2); every `RASTER_<X>` has a `FLATTEN_<X>` twin with the same trigger for text-bearing elements.

## VALIDATE_* (kind `error`)

| Code | Trigger | Fix |
| --- | --- | --- |
| `VALIDATE_UNKNOWN_META` | `meta[name^="deckflip:"]` not in the dialect | Remove it; known names: `deckflip:canvas` |
| `VALIDATE_STRAY_CONTENT` | element in `body` outside any `section` | Move it into a `<section>` |
| `VALIDATE_SLIDE_SIZE` | a section's border box is not the Canvas | Set no width/height on sections |
| `VALIDATE_REMOTE_ASSET` | `http(s):` or other non-local URL | Save the file next to the deck and reference it relatively |
| `VALIDATE_MISSING_ASSET` | local asset not found | Check the path relative to the deck file |
| `VALIDATE_ELEMENT` | `script`, `iframe`, `object`, `embed`, `canvas`, form controls, `details`, `dialog`, `marquee` | Replace with static HTML |
| `VALIDATE_TEXT_CSS` | `hyphens: auto`, `text-wrap: balance\|pretty`, vertical `writing-mode`, `column-*`, `text-orientation`, `font-size-adjust`, `font-stretch` | Remove the declaration |
| `VALIDATE_POSITION` | `position: fixed\|sticky`, `zoom`, `@page` | Use `absolute` or flow layout inside the section |
| `VALIDATE_LIST_CONTENT` | `li` with block content beyond one `p` and one nested list, or nesting deeper than 9 | Keep list items to inline text plus one nested list |
| `VALIDATE_TABLE_CONTENT` | table cell with block content other than `p`/`ul`/`ol` | Keep cells to text, paragraphs and lists |
| `VALIDATE_RASTER_SLIDE` | `data-raster` on a `section` | Rasterise parts, not the Slide; use `deckflip render` for PNGs |

## FONT_*

| Code | Severity | Trigger | Fix |
| --- | --- | --- | --- |
| `FONT_UNRESOLVED` | error | no family in the stack is deck-provided or installed | Install the family or add a safe family such as Arial to the stack |
| `FONT_GENERIC_ONLY` | error | the first resolvable entry is a generic family | Put a concrete family before the generic |
| `FONT_NOT_SAFE` | warning | resolved font outside the safe set and not embedded | Use a safe font, or pass `--embed-fonts` |
| `FONT_EMBED_RESTRICTED` | warning | the font's licence bits forbid editable embedding | Choose another font |
| `FONT_EMBED_FORMAT` | warning | WOFF2 or TTC source cannot be embedded | Provide the family as TTF, OTF or WOFF |
| `FONT_MISSING_FOR_LAYOUT` | warning | PPTX -> HTML: source font not installed, not embedded | Install it before editing to keep layout faithful |

## RASTER_* (kind `rasterised`, warning; `RASTER_EXPLICIT` is info)

| Code | Trigger | Fix |
| --- | --- | --- |
| `RASTER_CSS_FILTER` | `filter` | Move it onto a background image, or accept the picture with `data-raster` |
| `RASTER_BACKDROP_FILTER` | `backdrop-filter` | Remove it; PowerPoint has no backdrop effects |
| `RASTER_BLEND_MODE` | `mix-blend-mode` | Remove it or pre-compose the image |
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

| Code | Severity | Trigger | Fix |
| --- | --- | --- | --- |
| `FLATTEN_CSS_FILTER`, `FLATTEN_BACKDROP_FILTER`, `FLATTEN_BLEND_MODE`, `FLATTEN_MASK`, `FLATTEN_CLIP_PATH`, `FLATTEN_GRADIENT`, `FLATTEN_SHADOW`, `FLATTEN_BORDER_STYLE`, `FLATTEN_BORDER_IMAGE`, `FLATTEN_TRANSFORM`, `FLATTEN_OUTLINE` | warning | the `RASTER_*` trigger on a text-bearing element | The effect was dropped to keep the text editable; put it on a text-free sibling behind the text |
| `FLATTEN_TEXT_STROKE` | warning | `-webkit-text-stroke` | Use a bold weight or colour instead |
| `FLATTEN_TEXT_BACKGROUND_CLIP` | warning | `background-clip: text` | Use a solid `color` |
| `FLATTEN_TEXT_DECORATION_STYLE` | warning | non-solid decoration styles | Rendered as solid |
| `FLATTEN_TEXT_FONT_VARIANT` | warning | `font-variant-*` other than small-caps | Dropped |
| `FLATTEN_TEXT_SHADOW_MULTI` | warning | multiple `text-shadow` layers | First shadow kept |
| `FLATTEN_ANIMATION` | info | `animation`/`transition` present | First frame used |
| `FLATTEN_OFFCANVAS` | warning | element partly outside the Canvas | Move it inside the Canvas |
| `FLATTEN_MEDIA_POSTER` | warning | `video` without `poster` | Add `poster` so PowerPoint shows a frame |

## SUBSTITUTE_* (kind `substituted`, info)

| Code | Trigger | Meaning |
| --- | --- | --- |
| `SUBSTITUTE_SVG_PICTURE` | inline `svg` | Emitted as a vector picture; use HTML boxes for editable shapes |
| `SUBSTITUTE_GRADIENT_RADIAL` | `radial-gradient` | Emitted as a path gradient; check `render` |
| `SUBSTITUTE_BORDER_SIDES` | per-side borders | Emitted as separate lines |
| `SUBSTITUTE_OPACITY` | `opacity` | Folded into fill/line/text alpha |
| `SUBSTITUTE_IMAGE_FORMAT` | WebP/GIF source | Re-encoded to PNG |
| `SUBSTITUTE_LIST_STYLE` | unsupported `list-style-type` or `reversed` | Emitted as decimal numbering |
| `SUBSTITUTE_FONT_WEIGHT` | weight without a matching face | Nearest of regular/bold used |

## PRESERVE_* and DROPPED_* (round trips), OVERRIDE_*, RENDER_*

| Code | Kind | Severity | Trigger |
| --- | --- | --- | --- |
| `PRESERVE_OPAQUE_CHART`, `PRESERVE_OPAQUE_SMARTART`, `PRESERVE_OPAQUE_OLE`, `PRESERVE_OPAQUE_VECTOR`, `PRESERVE_OPAQUE_TEXT_EFFECTS`, `PRESERVE_OPAQUE_ANIMATION`, `PRESERVE_OPAQUE_COMMENTS`, `PRESERVE_OPAQUE_VBA`, `PRESERVE_OPAQUE_MASTER` | preserved | info | opaque content carried through; editable only as a whole |
| `PRESERVE_SOURCE_MISSING` | preserved | warning | manifest or `source.pptx` absent or changed; everything re-emitted from HTML |
| `PRESERVE_UNKNOWN_ID` | preserved | info | `data-shape-id` not in the manifest; ignored |
| `DROPPED_EDIT_OPAQUE` | dropped | warning | content edit inside `data-preserve`; only geometry is editable |
| `DROPPED_ANIMATION` | dropped | warning | timing references a deleted shape |
| `DROPPED_TEXT_EFFECTS` | dropped | warning | WordArt/3D shape edited; effects cannot be re-emitted |
| `DROPPED_EXTENSION` | dropped | info | unknown `extLst` on an edited shape |
| `DROPPED_OFFCANVAS` | dropped | info | element fully outside the Canvas; delete it or move it inside |
| `OVERRIDE_CANVAS_SIZE` | overridden | info | `--size` differs from deck meta |
| `RENDER_FONT_SUBSTITUTED` | substituted | info | LibreOffice rendered with a substitute for an Office-bundled font |
