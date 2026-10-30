# Changelog

## Unreleased

### Added

- Pin Deck font assets (#34): every stylesheet and `@font-face` source a Slide loads, local or `http(s)`, linked, `@import`ed or nested in `@media`/`@supports`/`@layer`, is resolved against its stylesheet's final redirect URL and answered by deckflip before Chromium measures. Downloads and redirect bases are frozen in `<name>.assets/fonts/` (`sources.json` maps each URL by hash) and reused, offline included; a pin is never refreshed, including earlier failed sources when a later source loads. Unrequested imports produce explicit entries. WOFF and WOFF2 are decoded to sfnt, which identifies both installed and Deck-provided assets and is what Chromium measures.
- `local()` sources are ignored, so installed fonts never replace supplied bytes; a declared family matches only its own `@font-face` rules, by CSS stretch/style/weight matching. Installed width matching uses `OS/2.usWidthClass`. `unicode-range` subsets are selected by the characters a run uses.
- New report codes: `FONT_ASSET_UNAVAILABLE` and `FONT_ASSET_UNSUPPORTED` (errors) for faces a Slide needs that cannot be downloaded/pinned or decoded, and `FONT_GLYPH_FALLBACK` (warning), a font audit comparing each drawn text node's selected face and character coverage with the platform fonts Chromium actually used. Missing local stylesheets and font files are `VALIDATE_MISSING_ASSET`. `FONT_EMBED_RESTRICTED` now reports Deck-provided faces whose `fsType` rules out editable embedding.
- The Conversion report lists each selected face as `fonts`, the same Resolved fonts `inspect` prints, with `asset.source` (`installed`, `file`, `remote` with its pinned copy, or `data`), acquired format and hashes. URLs never include credentials or query values.
- Severity thresholds for Strict mode on `convert` and `validate` in both directions: `--strict=info|warning|error`. Bare `--strict` retains any-entry failure; warning-level strictness is recommended for the authoring loop. Invalid thresholds exit 3; validation (2) and Verification (5) retain precedence, and threshold-only failures (4) keep conversion output and the report (#40).
- Bundle Liberation Sans 2.1.5 static Regular, Bold, Italic and BoldItalic faces as the default for unauthored text (#35). The manifest's SHA-256 hashes are checked through the same font-source session that serves Chromium; Resolved fonts record `source.kind: "bundled"`, family, version, file basename, format and acquired-byte hash.

### Changed

- `asset.file` in Resolved fonts moved to `asset.source`; `asset.sha256` is the decoded face's hash. Installed-face weight matching follows CSS Fonts 4 (a 400 request prefers 500 over 300).
- `render` of an HTML Deck loads the same pinned faces as measurement.
- The `text/emoji` corpus report now records the CJK and emoji glyphs Verdana lacks as `FONT_GLYPH_FALLBACK`; its package digest is unchanged.
- Human Conversion report summaries group repeated entries by severity and code, most important first, with occurrence counts, three representative locations plus remaining counts, and distinct hints once per group. JSON and report sidecars retain all occurrences; `--quiet` still suppresses only the human summary (#40).
- Replace the transitional body Arial default with a root Liberation Sans declaration in the first anonymous cascade layer. Authored root, body, Slide and text families retain precedence; the bundled family is never appended to explicit stacks. Missing families and generics still fail explicitly.
- The bundled default is reproducible for authoring, not a safe PowerPoint font: it remains `deck-provided` with `FONT_NOT_SAFE` until embedding is implemented. The strict template already authors Arial on `body` and remains unchanged. PPTX-to-HTML output keeps explicit source families and emits no bundled default; no PowerPoint Oracle evidence is implied.

### Fixed

- `@font-face` rules in linked local stylesheets were invisible to font resolution (Chromium blocks their CSSOM), so the selected face could differ from the measured one; remote and imported rules were ignored the same way.
- Resolve the Chromium installer from the installed Playwright dependency instead of the current directory, with shell-quoted absolute recovery commands that work for packed/global installs and paths containing spaces (#39).
- Give HTML `inspect` the same `--browser` / `--offline` options and explicit flag > `DECKFLIP_BROWSER` > managed-browser precedence as other Chromium commands. PPTX inspection remains browser-independent. Help now documents browser environment variables and offline/CI download policy (#39).

## 0.3.0 - 2026-10-29

### Fixed

- Keep font portability reports truthful: `convert` and `validate` now reject explicit `--embed-fonts` requests with `FONT_EMBED_UNSUPPORTED` (exit 2), retaining the report without creating or replacing the converted Deck. Non-safe Resolved fonts keep `FONT_NOT_SAFE`, including when a request names only an unused CSS fallback. Help and font references now state that embedding is not implemented (#31).
- Separate CSS font aliases, exact selected asset/collection face, and metadata-derived Office family/RIBBI identity. Unmodified Heebo 500/700/800 serializes as Heebo Medium regular / Heebo bold / Heebo ExtraBold regular without changing browser weights. Local `@font-face` aliases retain their asset bindings. Invalid or unsupported identity fails with `FONT_IDENTITY_INVALID`, rather than inventing a family/style (#32).
- Normalize local `@font-face` weight keywords (`normal`/`bold`) and oblique styles, including angle-qualified descriptors, before matching faces. Regular/upright text no longer selects a later bold/slanted face because its descriptor was discarded. CLI/PPTX regressions cover all four Office styles; the accepted font fixture's Oracle package digest is unchanged (#32).
- Keep installed safe-family variants safe through their preferred and legacy metadata aliases, even when Office addresses them under a separate family such as Aptos SemiBold or Calibri Light. Deck-provided CSS aliases still raise portability warnings; safe-family membership never bypasses Office-identity validation (#32).
- Keep fresh PPTX application metadata conformant: omit the optional `AppVersion`, whose `XX.YYYY` format cannot hold SemVer, and retain the full producer version in `Application`. PowerPoint for Mac 16.114.2 rejected packages containing `AppVersion=0.2.0`; the compiled CLI output now opens there. Preserved source metadata is unchanged.

### Changed

- `inspect` font records now expose `cssFamily`, `aliases`, `asset` (file, SHA-256, face index, PostScript name), and `office` (legacy family and RIBBI style), replacing the ambiguous flat family/file fields. Collection members are no longer collapsed by filename.
- Remove the unused `SUBSTITUTE_FONT_WEIGHT` report code and references to the retired regular/bold weight-remapping policy.

### Acceptance

- #32 passed exact-font acceptance on an isolated QA Mac running PowerPoint 16.114.2: all seven native text objects edited/saved/reopened with unchanged Office families/RIBBI, and both PDF exports used the seven pinned faces without substitution or wrapping. The font-only Oracle and visual gate are enabled (0.56% difference, below the unchanged 1.25% limit). `fixtures/corpus/fonts/office-identity/expected/editability.json` retains the earlier blocked attempts and the accepted evidence. Developer fonts and existing corpus Oracle records are unchanged.

## 0.2.0 - 2026-10-08

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
