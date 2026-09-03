# Changelog

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
