# Round-trip preservation

Decided in [#14](https://github.com/devosurf/deckflip/issues/14).

## The three preservation modes

- **Represented**: the content is editable HTML; on the way back it is emitted from HTML when touched, from the original XML fragment when untouched.
- **Opaque**: the content appears in HTML as an empty positioned box marked `data-preserve="<class>"` (`chart`, `smartart`, `ole`, `vector`) with the shape name in `title`; the tool's stylesheet labels it. Only its geometry (position, size, rotation) and its presence are editable; anything written inside it is ignored (`DROPPED_EDIT_OPAQUE`, warning). Re-emitted from the source parts verbatim, its first transform rewritten if moved.
- **Dropped**: not carried; one `DROPPED_*` entry says what and why.

## Matrix

| Feature class | Mode | HTML form | Notes |
| --- | --- | --- | --- |
| Slides, order | Represented | `section` order | new/deleted/reordered slides handled; `sldIdLst` rewritten |
| Text boxes and autoshapes with `rect`/`roundRect`/`ellipse`/`line` geometry | Represented | `div` (+ `p`/`span`), `hr` for lines | inherited placeholder/theme properties resolved into explicit inline CSS so Chromium renders them; the nearest level declaring any of `a:buNone`/`a:buChar`/`a:buAutoNum`/`a:buBlip` decides the marker, and a picture bullet, which HTML cannot paint, comes back as `•` |
| Other preset and custom geometries (`prstGeom` others, `custGeom`) | Represented | `div` at the box, rectangular | untouched -> original shape XML; touched -> re-emitted as the rectangle HTML shows (rendering the geometry to `<svg data-preserve>` is a later slice) |
| Connectors, ink, metafile pictures, `mc:AlternateContent` | Opaque (`vector`) | `div[data-preserve="vector"]` | untouched or moved -> original XML |
| Pictures (incl. crop, SVG blips) | Represented | `img` with `object-fit`/`clip-path: inset()` for crops | media part copied verbatim (hash-named) |
| Tables | Represented | `table` | merged cells, per-edge borders, fills |
| Groups | Represented | `div[data-group]` nested | child coordinates in group space; `chOff/chExt` recomputed on touch |
| Hyperlinks, slide jumps | Represented | `a[href]` | `ppaction://` other than `hlinksldjump`/`hlinkshowjump` kept opaque on the run |
| Speaker notes | Represented | `aside.notes` | notes slide re-emitted verbatim when untouched; else regenerated on the preserved notes master (its own, on a theme part of its own, if the deck has none: PowerPoint repairs a deck whose masters share a theme part). Notes are never measured, so the regenerated body carries text, emphasis, links, alignment and list levels, and the notes master governs typeface, size, colour and spacing |
| Sections | Represented | `data-section` on first Slide | `p14:sectionLst` regenerated from the Deck: each `data-section` opens a section holding every Slide up to the next, a section keeps the GUID of the source section of the same name (or failing that of the one its first Slide sat in), Slides ahead of the first `data-section` fall in `Default Section` as they would in PowerPoint, and a Deck spelling out no section at all has no list |
| Placeholders | Represented | `data-placeholder="<type>[:idx]"` on the shape, picture or table | untouched -> original XML; touched -> `p:ph` kept, properties written explicitly |
| Masters, layouts, themes, notes masters, handout master | Opaque (deck-level) | theme tokens as CSS custom properties; `data-layout` names the layout per Slide | copied verbatim; new Slides instantiate the named layout or `Blank`; editing masters is out of scope |
| Charts (classic), ChartEx | Opaque | `div[data-preserve="chart"]`, an empty labelled box (a LibreOffice-rendered preview `img` when LibreOffice is available is a later slice) | chart parts, embedded workbook, style/colour parts copied |
| SmartArt | Opaque | `div[data-preserve="smartart"]`, an empty labelled box (a read-only shape tree rendered from `drawingN.xml` is a later slice) | data/layout/colours/style/drawing parts copied |
| OLE objects | Opaque | `div[data-preserve="ole"]`, an empty labelled box (the frame's fallback picture is a later slice) | embedding part copied |
| WordArt / text with 3D or `a:scene3d` | Represented text, opaque effects | text box; `data-preserve="text-effects"` on the shape marks the effect set | touched -> effects dropped (`DROPPED_TEXT_EFFECTS`, warning) |
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
- `deckflip.json`: the manifest: `{ schemaVersion, source: { sha256 }, slides: [{ id, partName, fingerprint, spids, shapes: [{ shapeId, fingerprint, spids, partRefs, nested? }] }] }`. `spids` are the `p:cNvPr` ids an element stands for in z-order (a picture and its border shape, a table and its caption, the section and its background shape); `nested` marks shapes inside a group.

## Detecting "untouched"

- A **fingerprint** is the SHA-256 of an element's canonical serialisation: attributes sorted, `data-shape-id`/`data-preserve`/`data-placeholder` excluded, whitespace collapsed as CSS renders it (dropped against block edges, kept between inline runs and inside `pre`), inline `style` declarations sorted. Computed at emission time and stored in the manifest; the way back computes it from the DOM Chromium built.
- On HTML -> PPTX with a manifest present: an element whose `data-shape-id` exists in the manifest and whose fingerprint matches is **untouched** and is re-emitted from `source.pptx` (its original XML fragment, its relationships remapped into the new part). A touched element keeps its `p:cNvPr` id when it stays on its Slide, so animations targeting it survive. A Slide's own fingerprint covers its shell: the section's attributes but `id`, and its notes. A Slide is untouched if that fingerprint matches, its direct children are the manifest's top-level shapes in the same order, all untouched; an untouched Slide's part, rels, notes, comments and timing are copied byte-for-byte. A touched Slide whose shell is untouched keeps `p:bg`, its colour map, transition, extensions, notes and comments; its timing stays while every `spid` it targets still exists. A Deck with every Slide untouched and no reorder yields the source package as it is.
- Missing manifest or `source.pptx` (agent deleted the directory), or a manifest whose `source.sha256` no longer matches: everything is treated as touched (`PRESERVE_SOURCE_MISSING`, warning, once); the deck is re-emitted from scratch on the tool's built-in master.
- `data-shape-id` values the author invents, or duplicates, are ignored with `PRESERVE_UNKNOWN_ID` (info).
- The unit is the shape, never the paragraph: a shape whose body needs several HTML blocks carries `data-shape-id`/`data-placeholder` on the element those blocks hang under, and the measurer reads that element as one shape whose text body they are the paragraphs of (so it keeps its `p:ph` and its manifest key). Editing one of those paragraphs therefore re-emits the whole body; the unedited siblings are not spliced on their own, because PowerPoint has no identity below the shape.

## Foreign decks (fog: "import quality")

"Best effort" is defined as: every visible shape appears in the HTML at its measured place with resolved formatting; anything the matrix marks opaque is preserved and previewed where possible; nothing is silently dropped. `validate deck.pptx` lists the `PRESERVE_*` entries a round-trip would carry so the agent knows what it cannot edit before it starts.
