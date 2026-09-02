# Round-trip preservation

Decided in [#14](https://github.com/devosurf/deckflip/issues/14).

## The three preservation modes

- **Represented**: the content is editable HTML; on the way back it is emitted from HTML when touched, from the original XML fragment when untouched.
- **Opaque**: the content appears in HTML as a positioned box marked `data-preserve` (with a preview where one can be obtained). Only its geometry (position, size, rotation) and its presence are editable; edits inside it are ignored (`DROPPED_EDIT_OPAQUE`, warning). Re-emitted from the source parts verbatim, geometry rewritten if moved.
- **Dropped**: not carried; one `DROPPED_*` entry says what and why.

## Matrix

| Feature class | Mode | HTML form | Notes |
| --- | --- | --- | --- |
| Slides, order | Represented | `section` order | new/deleted/reordered slides handled; `sldIdLst` rewritten |
| Text boxes and autoshapes with `rect`/`roundRect`/`ellipse`/`line` geometry | Represented | `div` (+ `p`/`span`), `hr` for lines | inherited placeholder/theme properties resolved into explicit inline CSS so Chromium renders them |
| Other preset and custom geometries (`prstGeom` others, `custGeom`), connectors, ink | Represented as vector | inline `<svg data-preserve>` rendered from the geometry | untouched -> original shape XML; touched -> `svgBlip` picture (`SUBSTITUTE_SVG_PICTURE`) |
| Pictures (incl. crop, SVG blips) | Represented | `img` with `object-fit`/`clip-path: inset()` for crops | media part copied verbatim (hash-named) |
| Tables | Represented | `table` | merged cells, per-edge borders, fills |
| Groups | Represented | `div[data-group]` nested | child coordinates in group space; `chOff/chExt` recomputed on touch |
| Hyperlinks, slide jumps | Represented | `a[href]` | `ppaction://` other than `hlinksldjump`/`hlinkshowjump` kept opaque on the run |
| Speaker notes | Represented | `aside.notes` | notes slide re-emitted verbatim when untouched; else regenerated on the preserved notes master |
| Sections | Represented | `data-section` on first Slide | `p14:sectionLst` regenerated |
| Placeholders | Represented | `data-placeholder="<type>[:idx]"` on the shape | untouched -> original XML; touched -> `p:ph` kept, properties written explicitly |
| Masters, layouts, themes, notes masters, handout master | Opaque (deck-level) | theme tokens as CSS custom properties; `data-layout` names the layout per Slide | copied verbatim; new Slides instantiate the named layout or `Blank`; editing masters is out of scope |
| Charts (classic), ChartEx | Opaque | `div[data-preserve]` with a LibreOffice-rendered preview `img` when LibreOffice is available, else an empty labelled box | chart parts, embedded workbook, style/colour parts copied |
| SmartArt | Opaque | `div[data-preserve]` containing a read-only shape tree rendered from `drawingN.xml` (the persisted layout cache) | data/layout/colours/style/drawing parts copied |
| OLE objects | Opaque | `div[data-preserve]` with the frame's fallback picture | embedding part copied |
| WordArt / text with 3D or `a:scene3d` | Represented text, opaque effects | text box; `data-preserve` on the shape marks the effect set | touched -> effects dropped (`DROPPED_TEXT_EFFECTS`, warning) |
| Audio / video | Represented | `video[src][poster]`, `audio[src]`; `loop`/`autoplay` attributes | embedded media copied; linked media kept as the link; HTML->PPTX needs `poster` for video (else grey box, `FLATTEN_MEDIA_POSTER`) |
| Animations (`p:timing`), transitions (`p:transition`) | Opaque per Slide | none (v1 flattens) | kept iff the Slide is untouched, or touched but every referenced `spid` still exists; else `DROPPED_ANIMATION` (warning) |
| Comments (classic and modern), comment authors | Opaque | none | always re-attached to their Slide; dropped only with the Slide |
| VBA project | Opaque | none | output is `.pptm` when present; macro actions become inert links in HTML |
| `extLst` on any element, custom XML parts, `docProps`, thumbnails | Opaque | none | unknown extensions on touched shapes are dropped (`DROPPED_EXTENSION`, info) |

## Attachment: the Asset directory and its manifest

PPTX -> HTML writes `<name>.html` and `<name>.assets/`:

- `source.pptx`: the input package, verbatim. This is the blob store; nothing is duplicated into data attributes.
- `media/`: extracted pictures and media (content-hash names) referenced by the HTML.
- `fonts/`: extracted embedded fonts (#15).
- `previews/`: chart/SmartArt/OLE preview PNGs.
- `deckflip.json`: the manifest: `{ schemaVersion, source: { sha256 }, slides: [{ id, partName, fingerprint, shapes: [{ shapeId, fingerprint, partRefs: [...] }] }] }`.

## Detecting "untouched"

- A **fingerprint** is the SHA-256 of an element's canonical serialisation: attributes sorted, `data-shape-id`/`data-preserve`/`data-placeholder` excluded, whitespace between block elements collapsed, inline `style` declarations sorted. Computed at emission time and stored in the manifest.
- On HTML -> PPTX with a manifest present: an element whose `data-shape-id` exists in the manifest and whose fingerprint matches is **untouched** and is re-emitted from `source.pptx` (its original XML fragment, its relationships remapped into the new part). A Slide is untouched if its own fingerprint matches, its shape set is identical and in the same order, and its `data-title`/`data-layout`/`data-section`/notes are unchanged; an untouched Slide's part, rels, notes, comments and timing are copied byte-for-byte. A Deck with every Slide untouched and no reorder yields a package whose parts are all byte-identical to the source.
- Missing manifest or `source.pptx` (agent deleted the directory), or a manifest whose `source.sha256` no longer matches: everything is treated as touched (`PRESERVE_SOURCE_MISSING`, warning, once); the deck is re-emitted from scratch on the tool's built-in master.
- `data-shape-id` values the author invents, or duplicates, are ignored with `PRESERVE_UNKNOWN_ID` (info).

## Foreign decks (fog: "import quality")

"Best effort" is defined as: every visible shape appears in the HTML at its measured place with resolved formatting; anything the matrix marks opaque is preserved and previewed where possible; nothing is silently dropped. `validate deck.pptx` lists the `PRESERVE_*` entries a round-trip would carry so the agent knows what it cannot edit before it starts.
