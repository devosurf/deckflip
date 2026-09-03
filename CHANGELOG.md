# Changelog

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
