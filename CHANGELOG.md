# Changelog

## Unreleased

### Fixed

- Accept embedded image data URIs throughout HTML-to-PPTX conversion with the same format policy as local images, bounded validation diagnostics, and no remote image fetching (#27).
- Preserve PPTX group scaling, nested child coordinate spaces, rotation and flips in HTML and edited round trips, while retaining Untouched source parts and native text/pictures (#25).
- Honor `--report` for PPTX-to-HTML conversion, including nested destinations and validation failures, without also writing the default sidecar (#28).
- Honor validation errors before Strict mode for both input kinds: exit 2 with a diagnostic report and no converted Deck or new Asset directory, preserving existing destinations. PPTX-to-HTML now honors Strict mode for nonfatal reports, retaining output and returning 4 (#26).
- Preserve visible inline text before and after block children as editable native text, in source order, with measured placement and run styling (#24).
- Exclude hidden descendants from native text runs and line metrics, including inside pure inline Text blocks.

## 0.1.1 - 2026-09-03

### Fixed

- Decks with speaker notes opened in PowerPoint with "found a problem with content" and lost their notes to the repair: the emitted notes master shared the slide master's theme part, and PowerPoint allows a theme part exactly one master. The notes master now gets a theme part of its own (`theme2.xml`, or the next free `themeN.xml` on a round trip).

## 0.1.0 - 2026-09-03

Initial release.

### Added

- Bidirectional HTML Deck and PowerPoint (`.pptx`) conversion through the `deckflip` CLI.
- Native PowerPoint text, shapes, pictures, lists, tables, and groups from measured HTML and CSS.
- PPTX parsing to editable HTML with source assets, a Manifest, and byte-preserving round trips for Untouched content.
- Preservation of opaque PowerPoint content including charts, SmartArt, OLE objects, connectors, ink, and unsupported picture formats.
- Speaker notes, Slide sections, layout names, placeholders, theme inheritance, internal links, font resolution, and media relationships in both conversion directions.
- Static and measured validation, Strict mode, deterministic Conversion reports, and structural inspection.
- LibreOffice and PowerPoint rendering for visual verification.
- Explicit rasterisation and deterministic PNG fallbacks for unsupported visual effects and SVG pictures.
- The bundled `deckflip` agent skill, authoring references, templates, and example layouts.

### Reliability

- Deterministic ZIP structure, OOXML identifiers, media part names, timestamps, browser captures, and repeated conversions.
- Corpus gates for visual output, OOXML round-trip identity, conversion idempotence, and Untouched source preservation.
