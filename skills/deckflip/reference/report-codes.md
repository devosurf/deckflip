# Report codes

Every entry carries `code`, `kind`, `severity`, `reason` and `hint`; element-level entries also have `slide` and `locator`. `{decl}` in a hint is the offending CSS declaration, `{el}` the element name. Three rules: `VALIDATE_*` and `FONT_*` errors stop the conversion (exit 2); `VERIFY_*` errors mean deckflip wrote output that differs from your source, a deckflip defect (exit 5, output kept): report it, do not work around it; every `RASTER_<X>` has a `FLATTEN_<X>` twin with the same trigger for text-bearing elements.

Use `--strict=warning` in the authoring loop: warnings fail, info entries remain in the report without failing. Bare `--strict` means any entry (`info`); `--strict=error` only fails on errors. Validation (2) and Verification (5) cannot be downgraded. Stderr groups by severity/code with counts, three representative locations and distinct hints; JSON and sidecars retain every occurrence.

## VALIDATE_* (kind `error`)

| Code | Trigger | Fix |
| --- | --- | --- |
| `VALIDATE_UNKNOWN_META` | `meta[name^="deckflip:"]` not in the dialect | Remove it; known names: `deckflip:canvas` |
| `VALIDATE_STRAY_CONTENT` | element in `body` outside any `section` | Move it into a `<section>` |
| `VALIDATE_SLIDE_SIZE` | a section's border box is not the Canvas | Set no width/height on sections |
| `VALIDATE_REMOTE_ASSET` | `http(s):` or other non-local URL, except stylesheets and `@font-face` sources (pinned instead) | Save the file next to the deck and reference it relatively |
| `VALIDATE_MISSING_ASSET` | local asset not found, including a stylesheet or a needed `@font-face` file | Check the path relative to the referencing file |
| `VALIDATE_IMAGE_ASSET` | invalid embedded data, unsupported image format, or decoding failure | Use a valid PNG, JPEG, GIF, WebP or SVG image; check embedded data URI encoding |
| `VALIDATE_ELEMENT` | `script`, `iframe`, `object`, `embed`, `canvas`, form controls, `details`, `dialog`, `marquee` | Replace with static HTML |
| `VALIDATE_TEXT_CSS` | `hyphens: auto`, `text-wrap: balance\|pretty`, vertical `writing-mode`, `column-*`, `text-orientation`, `font-size-adjust`, `font-stretch` | Remove the declaration |
| `VALIDATE_POSITION` | `position: fixed\|sticky`, `zoom`, `@page` | Use `absolute` or flow layout inside the section |
| `VALIDATE_LIST_CONTENT` | `li` with block content beyond one `p` and one nested list, or nesting deeper than 9 | Keep list items to inline text plus one nested list |
| `VALIDATE_TABLE_CONTENT` | table cell with block content other than `p`/`ul`/`ol` | Keep cells to text, paragraphs and lists |
| `VALIDATE_RASTER_SLIDE` | `data-raster` on a `section` | Rasterise parts, not the Slide; use `deckflip render` for PNGs |
| `VALIDATE_LINK_TARGET` | `a[href^="#"]` whose target is not a Slide id | Point `{href}` at a section id; the hint lists the Slides |

## FONT_*

`src/report/codes.ts` is the source of truth for default hint templates; the font fixes below reproduce them exactly. Source-preservation overrides from `src/roundtrip/entries.ts` are listed separately below. New-embedding errors apply to HTML input; existing source rights, format and coverage limits warn without blocking preservation.

| Code | Severity | Trigger | Fix |
| --- | --- | --- | --- |
| `FONT_UNRESOLVED` | error | no family in the explicit stack resolves; the bundled default is not appended | Install {family} or supply a concrete font file through @font-face |
| `FONT_GENERIC_ONLY` | error | the first resolvable entry is a generic family | Put a concrete family before {generic} |
| `FONT_IDENTITY_INVALID` | error | insufficient/conflicting Office identity metadata, unsupported legacy subfamily or variable instance | Choose a font face with consistent legacy family, subfamily and RIBBI metadata; do not rewrite font tables or remap CSS weights |
| `FONT_ASSET_UNAVAILABLE` | error | a needed hosted stylesheet or font is unavailable or its pin changed; a bundled default is missing or fails its manifest hash check | Convert once with network access so deckflip pins it in the Asset directory, or save the file next to the Deck and reference it relatively |
| `FONT_ASSET_UNSUPPORTED` | error | a needed `@font-face` has only `local()` sources, no loadable format, or bytes that are no TTF/OTF/WOFF/WOFF2 font | Supply the face as a TTF, OTF, WOFF or WOFF2 file through url(); deckflip never measures local() faces |
| `FONT_NOT_EMBEDDED` | warning (`flagged`) | explicit HTML-input opt-out: each used face without a preserved source embedding needs that exact face installed; never emitted for PPTX-input conversion/validation | Install {family} on every recipient machine, or remove --no-embed-fonts to produce portable editable output |
| `FONT_GLYPH_FALLBACK` | error by default; warning with opt-out | the selected face lacks characters or Chromium drew glyphs with another font | Supply the complete font file for {family} covering every character; unaccounted Chromium glyph fallback cannot be reproduced by embedding the selected face |
| `FONT_EMBED_RESTRICTED` | error by default; warning with opt-out or preserved source | any selected face, installed included, has permission bits other than 0, 0x8, 0x100 or 0x108; existing source rights never block preservation | Supply a face of {family} whose licence and fsType permit editable embedding, or use --no-embed-fonts for machine-dependent output |
| `FONT_EMBED_FORMAT` | error by default; warning with opt-out or opaque source preview | a collection member/unsupported sfnt cannot be embedded, or a preserved MTX/XOR part cannot be decoded for HTML preview | Supply {family} as a standalone static TTF, OTF, WOFF or WOFF2 file; collection members are not supported for embedding |
| `FONT_EMBED_COVERAGE` | error by default; warning with opt-out | current text is not covered by the single asset for an Office family/style slot | Supply the complete font file for {family} covering every listed character; web subsets cannot be merged into one Office family/style slot |
| `FONT_EMBED_SUBSET` | warning | web `unicode-range` or preserved EOT subset permits only limited editing; edited text using a preserved subset or opaque MTX has unverifiable coverage and new characters may fall back | Supply the complete font file for {family} for unrestricted editing; additional characters outside the embedded subset may fall back |
| `FONT_MISSING_FOR_LAYOUT` | warning | PPTX -> HTML: source font not installed, not embedded | Install {family} before editing to keep layout faithful |

Source-preservation warnings use these context-specific hints, not the new-embedding opt-out:

- `FONT_EMBED_RESTRICTED`: Preservation retains the original permission bits and grants no new embedding rights; check the font licence and obtain the rights needed for editing and redistribution
- `FONT_EMBED_FORMAT`, malformed source EOT: Keep source.pptx and deckflip.json together; supply the complete original font for a readable preview without replacing the preserved source payload
- `FONT_EMBED_FORMAT`, opaque MTX preview: Keep source.pptx and deckflip.json together; supply the complete original font for a faithful HTML preview

Successful embedding is `fonts[].embedding`, not an informational Report entry. Validation reports `eligible`, not emitted parts; `embeddedFonts[]` distinguishes copied source parts from new embeddings. Family-name safety and unimplemented-embedding codes are retired.

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
| `FLATTEN_OVERFLOW_CLIP` | warning | `overflow: hidden` (or `clip`, `auto`, `scroll`) hides part of a Text block's text | PowerPoint cannot clip text: size the box to fit its text, or remove the hidden lines |
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
| `DROPPED_GENERATED_CONTENT` | dropped | warning | `::before`/`::after` text or a painted box; put it into the HTML as an element |
| `OVERRIDE_CANVAS_SIZE` | overridden | info | `--size` differs from deck meta |
| `RENDER_FONT_SUBSTITUTED` | substituted | info | LibreOffice rendered with a substitute for an Office-bundled font |

## LAYOUT_* (kind `flagged`, warning)

The PPTX matches the HTML, but the HTML shows something you rarely intend. Fix the HTML, or accept the entry when it is deliberate (Strict mode then exits 4 with only accepted entries).

| Code | Trigger | Fix |
| --- | --- | --- |
| `LAYOUT_TEXT_OVERFLOW` | text runs past the box painted behind it (its own fill/border, or its nearest painting ancestor's) | Give the box room for the text, or shorten the text |
| `LAYOUT_TEXT_OVERLAP` | lines of two Text blocks cross | Move one clear of the other |
| `LAYOUT_TEXT_ILLEGIBLE` | text contrast below 2:1 against what is painted behind it (not judged over pictures) | Change the text colour or the background |
| `LAYOUT_WRAP_RISK` | a line ends so close to its wrap width, with the next word so close to fitting, that no wrap width keeps PowerPoint's breaks on Chromium's | Reword, or change the box width by a few px |

## VERIFY_* (kind `error`): deckflip defects

Verification compares what your source shows with what the written output contains. Any entry here means deckflip got it wrong; the output is written anyway and the exit code is 5. Report it with the report file.

| Code | Meaning |
| --- | --- |
| `VERIFY_TEXT_MISSING` | text the source shows (Slide or speaker notes) is not in the output |
| `VERIFY_TEXT_EXTRA` | the output holds text the source does not show |
| `VERIFY_GEOMETRY` | an element is misplaced, missized, rotated, missing or unexpected in the output |
| `VERIFY_STACKING` | overlapping elements are stacked in another order than the source paints them |
