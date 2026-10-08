# Changelog

## Unreleased

### Added

- Verification: every conversion compares what its source shows with what its output contains (Visible text, speaker notes, element geometry, stacking) and reports a mismatch as `VERIFY_TEXT_MISSING`, `VERIFY_TEXT_EXTRA`, `VERIFY_GEOMETRY` or `VERIFY_STACKING` with the new exit code 5, keeping the output. PPTX-to-HTML conversion now lays the written Deck out in Chromium to verify it.
- `deckflip verify <source> <output>` re-checks an earlier conversion; it writes a report only where `--report` says, and exits 2 only when an HTML source fails validation (an HTML output that does is a Verification failure, 5).
- Layout flags, a new entry kind `flagged` with a `summary.flagged` count: `LAYOUT_TEXT_OVERFLOW`, `LAYOUT_TEXT_OVERLAP`, `LAYOUT_TEXT_ILLEGIBLE` and `LAYOUT_WRAP_RISK`, from `validate` and `convert`.
- `FLATTEN_OVERFLOW_CLIP` for text an `overflow: hidden` ancestor hides (PowerPoint shows it whole), and `DROPPED_GENERATED_CONTENT` for `::before`/`::after` content, both previously silent.

### Changed

- The wrap-width guard is calibrated against PowerPoint for Mac: wrap width moves by up to a pixel plus 0.12 px per em of line instead of a fixed 1 px, keeping PowerPoint's line breaks on Chromium's in every calibration case; a painted box still widens by at most 1 px, and a block that needs more is flagged. The new `text/wrap-guard` corpus fixture checks PowerPoint's line ends against Chromium's.
- Corpus gates compare Chromium with the committed PowerPoint renders, bound to the emitted package by `expected/oracle.json`; the LibreOffice comparison is opt-in (`DECKFLIP_LIBREOFFICE_GATE=1`) and CI no longer installs LibreOffice.
- The skill's agent loop no longer renders the PPTX; the section divider template's lede is legible on its gradient.

### Fixed

- PPTX-to-HTML placed every element of a Slide whose background shape has a border inside that border, offset by its width.

## 0.1.2 - 2026-09-17

### Changed

- Limit supported CLI hosts and CI to macOS for now, retaining the full rendering, determinism, build and packaging checks on the macOS job.

### Fixed

- Allow prepublish checks to run with a persistent `.npmrc` `allow-scripts` policy despite npm's lifecycle configuration-export bug, without changing the policy.
- Accept embedded image data URIs throughout HTML-to-PPTX conversion with the same format policy as local images, bounded validation Report entries, and no remote image fetching (#27).
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
