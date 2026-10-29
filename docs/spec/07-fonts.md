# Font policy

Font selection originated in [#15](https://github.com/devosurf/deckflip/issues/15); Office identity is separated in [#32](https://github.com/devosurf/deckflip/issues/32) and Deck font assets are pinned in [#34](https://github.com/devosurf/deckflip/issues/34), under the [#30 font cutover](https://github.com/devosurf/deckflip/issues/30).

## Resolution and Office identity

- For every run, the computed `font-family` stack selects the first available concrete family. A family the Slide's document declares with `@font-face` matches only those rules, by their `font-weight`/`font-style` descriptors as CSS matching does, never an installed face of the same name (see [Deck font assets](#deck-font-assets)). Any other family matches installed faces by their preferred and legacy family names, case-insensitively, with the same CSS weight/style matching.
- A **Resolved font** separates `cssFamily` and `aliases`, `asset` (SHA-256 of the face's sfnt bytes, zero-based collection `faceIndex`, PostScript name, `source`), and `office` (`family`, `style`). `source` says where the bytes came from: `installed` (`file`), `file` (a local font file the Deck references), `remote` (a downloaded URL in display form and its `pinned` copy) or `data` (a `data:` URI), with the acquired `format` and the acquired bytes' SHA-256. A Deck-provided subset face also carries its declared `unicodeRange`. Metrics and `fsType` come from that selected face. Collection members sharing a file remain distinct.
- The Office family is legacy name ID 1, not preferred name ID 16. Legacy subfamily ID 2 and consistent `OS/2.fsSelection` / `head.macStyle` determine `regular`, `bold`, `italic` or `boldItalic`. Serialization writes this family to `a:latin`, `a:ea` and `a:cs`, and derives `b`/`i` from the Office style. This same family/style identifies the future embedding slot; it is not evidence of embedded payloads. See the [OpenType naming contract](https://learn.microsoft.com/en-us/typography/opentype/spec/name#name-ids).
- Authored browser weights and styles are not rewritten. Unmodified Heebo 500 emits **Heebo Medium / regular**, 700 emits **Heebo / bold**, and 800 emits **Heebo ExtraBold / regular**. No font tables are modified.
- Missing legacy family/subfamily or PostScript identity, conflicting style metadata, and unsupported legacy subfamilies produce `FONT_IDENTITY_INVALID` (error, exit 2). Variable fonts also fail explicitly: a supported exact-instance-to-Office mapping has not been established. Conversion does not silently choose the next fallback or create/replace output.
- Installed fonts, for families no `@font-face` declares, are still enumerated by a pure-Node platform-directory scan with `fontkit`, cached per process. This is transitional until the redistributable default (#35) and portable embedding (#36).
- Nothing resolves: `FONT_UNRESOLVED` (error). A generic reached before a concrete match: `FONT_GENERIC_ONLY` (error). The current injected `body { font-family: Arial }` supplies a base default without overriding authored inheritance.
- Per-glyph fallback is not proven to be identical in Chromium and PowerPoint. Structural Verification checks text and geometry, not selected glyph faces; the font audit below reports fallback, it does not make it portable. Supported-PowerPoint evidence remains separate.

## Deck font assets

Every stylesheet and `@font-face` source a Slide document loads goes through deckflip before Chromium sees it, so measurement and emission use one selected face.

- **Declarations.** `@font-face` rules are read from inline `<style>`, linked and `@import`ed stylesheets, local or `http(s)`, at any nesting depth (`@media`, `@supports`, `@layer`, ...). URLs resolve against the stylesheet that contains them. A stylesheet Chromium lists but never requested, such as a URL with credentials, is `FONT_ASSET_UNAVAILABLE`; a `data:` stylesheet declaring `@font-face` is `FONT_ASSET_UNSUPPORTED`: its rules cannot be controlled.
- **Sources.** `local()` entries are dropped, so an installed face never stands in for the supplied bytes, whatever the machine has installed. `url()` entries keep their order; an entry whose `format()` hint Chromium does not load (`embedded-opentype`, `svg`) is skipped, as Chromium skips it. A rule with only `local()` sources is `FONT_ASSET_UNSUPPORTED`.
- **Formats.** The bytes' signature decides the format, not the extension or hint. TTF, OTF and collections (face 0) are used unchanged; WOFF 1.0 and WOFF2 (google/woff2, as in Chromium) are decoded to sfnt, and Chromium is served the decoded bytes. The decoded face's SHA-256 is the asset identity; `source.sha256` records what was acquired. Anything else is `FONT_ASSET_UNSUPPORTED`. These are the formats the [#33 PowerPoint proof](https://github.com/devosurf/deckflip/issues/33) accepted once decoded.
- **Pinning.** Downloaded stylesheets and fonts are frozen into the Asset directory, `<name>.assets/fonts/<sha256>.<ext>`, and `fonts/sources.json` maps each URL, by the SHA-256 of the full URL, to its copy. A pin is never refreshed: later conversions, `validate`, `inspect` and `render` read it without the network. Delete the entry to download again; a pinned copy that is missing or was modified is `FONT_ASSET_UNAVAILABLE`. Stylesheets are requested as Chromium requests them (its User-Agent: Google Fonts serves unicode-range WOFF2 subsets to it). The per-file directory form has no Asset directory: its downloads stay in memory for one run. `--offline` still concerns only the Chromium download.
- **Failures.** A source fails only when Chromium needs the face for some text: a missing local file is `VALIDATE_MISSING_ASSET`, an unreachable or unpinned download `FONT_ASSET_UNAVAILABLE`, undecodable bytes `FONT_ASSET_UNSUPPORTED` (all errors, exit 2). A later source in the rule that loads replaces a failed one, as in Chromium. A run whose declared face did not load is not resolved to the next family in its stack. A missing local stylesheet is `VALIDATE_MISSING_ASSET`.
- **Coverage.** A face covers the code points in both its `cmap` and its declared `unicode-range`. Of the faces whose descriptors match best, the one covering most of a run's characters is selected (the later rule on a tie); a family covering none of them yields to the next family, as CSS per-character fallback does. Several subset files are never merged into one face.
- **Font audit.** After measurement, every Visible text node is resolved again and compared with Chromium's record of the platform fonts it drew the node with (`CSS.getPlatformFontsForNode`, matched by PostScript name and web-font origin). Characters the selected face lacks, or glyphs Chromium drew with any other font, are `FONT_GLYPH_FALLBACK` (warning) once per owner and face, listing the characters and Chromium's fonts. This applies to installed faces too. The record names fonts, not files: it is evidence of fallback, not an asset identity.
- **Permissions.** A selected Deck-provided face whose `OS/2.fsType` rules out editable embedding is `FONT_EMBED_RESTRICTED` (warning): restricted (`0x0002`), preview & print (`0x0004`) without editable (`0x0008`), or any bitmap-only (`0x0200`). Installable (`0`), editable and no-subsetting (`0x0100`) faces pass. `fsType` is necessary, not sufficient: licences still apply.
- **Variable fonts** remain `FONT_IDENTITY_INVALID`; static instances are not created until an instance naming and licence policy exists.
- **Provenance.** `inspect` `fonts[]` and the Conversion report's `fonts` list each selected face once with its `asset.source`. URLs keep scheme, host and path; userinfo, query values and fragments never appear in reports, entries or pins, and the query shows as `?…`.

## Classification and warnings

| Class | Members | Entry |
| --- | --- | --- |
| **Safe** | Arial, Courier New, Georgia, Times New Roman, Trebuchet MS, Verdana (the researched Windows/macOS overlap) plus the Office-bundled families installed by every supported desktop PowerPoint on both platforms: Aptos (all faces), Calibri, Cambria, Candara, Consolas, Constantia, Corbel, Franklin Gothic, Century Gothic, Segoe UI is **not** in the set (Windows only) | none |
| **Deck-provided** | an `@font-face` source: local file, download or `data:` URI | `FONT_NOT_SAFE` (warning); embedding is not implemented |
| **Other installed** | anything else | `FONT_NOT_SAFE` (warning); embedding is not implemented |

Safe-family classification for an installed face uses its preferred or legacy metadata aliases, not only its Office family: for example, Aptos SemiBold remains part of the safe Aptos family. A Deck-provided CSS alias never makes an asset safe. The safe set describes availability, not supported identity: every selected face still passes the Office-identity checks above, and conflicting metadata produces `FONT_IDENTITY_INVALID` even for a safe family.

The Office-bundled families are safe for the viewer (PowerPoint) but not for a LibreOffice render: `render --renderer libreoffice` adds `RENDER_FONT_SUBSTITUTED` (info) for them, since LibreOffice substitutes the metric-compatible Carlito/Caladea for Calibri/Cambria where installed. CI no longer renders with LibreOffice ([ADR 0007](../adr/0007-verification-and-powerpoint-oracle.md)). [INFERENCE: the Office-bundled list is from product knowledge, not the #3 sources; the spec marks it "verify on a clean Office for Mac install" as a build-phase check.]

## Embedding

Embedding is not implemented. `--embed-fonts` and `--embed-fonts=<name,...>` are explicit requests, not evidence of embedded fonts. `convert` and `validate` reject them with `FONT_EMBED_UNSUPPORTED` (error, exit 2), even for a safe font or a Deck without text. The Conversion report is kept; no converted Deck is created or replaced. Earlier validation errors still stop conversion, and Verification failures after successful validation still exit 5 with output retained.

The Resolved font keeps its `FONT_NOT_SAFE` entry regardless of the request. Naming an unused fallback in the CSS stack cannot satisfy the selected face's portability requirement. Use a safe font, or install the Resolved font on every viewing machine.

### Planned embedding milestone (not implemented)

Only successful packaging of the selected face may satisfy portability. Integrate that result into the existing font policy, not a parallel policy based on option intent. Inspect the embedded-font list, relationships and payloads; a clean report is not proof.

The supported payload/permission/format matrix comes from the isolated PowerPoint compatibility experiment [#33](https://github.com/devosurf/deckflip/issues/33). Deck font assets ([#34](https://github.com/devosurf/deckflip/issues/34), above) supply the decoded faces; the pinned redistributable default (#35) and the packaging and portable-default cutover (#36) follow. Earlier EOT/variable-font proposals are not an implemented or proven contract. Do not uninstall the developer's fonts to simulate a recipient.

## PPTX -> HTML

- Every `typeface` becomes `font-family: "<typeface>", <generic>` where the generic comes from the font's `OS/2` family class / panose when the file is available, else from the theme slot (`+mj-lt` -> major font of the theme). Theme fonts are resolved to their concrete names and also exposed as `--theme-major-font`/`--theme-minor-font`.
- Planned embedding milestone: unwrap source EOT fonts into `<name>.assets/fonts/`, declare them with `@font-face`, and package selected faces on the way back. This is not currently implemented; source-package preservation is not evidence of new embedding, and no `--embed-fonts` request is implied today.
- Fonts the authoring machine lacks and the source did not embed are `FONT_MISSING_FOR_LAYOUT` (warning): the HTML declares the original name (so the round-trip writes it back) but Chromium measured with the next entry in the stack; `render` of the HTML will differ from PowerPoint.

## What the skill tells the agent

1. Name a concrete family first; end every stack with a safe family; never rely on a generic alone.
2. Prefer the safe set. Use Aptos/Calibri when a "PowerPoint look" is wanted, Arial/Georgia when the deck must also look identical in viewers without Office fonts, such as LibreOffice.
3. An `@font-face` font, local or hosted (Google Fonts included), makes a brand font available for authoring, not portable in the PPTX. It remains `FONT_NOT_SAFE`: choose a safe font or install the Resolved font on every viewing machine. Remove an explicit embedding request if `FONT_EMBED_UNSUPPORTED` is reported.
4. Hosted stylesheets and fonts are pinned in `<name>.assets/fonts/` on first conversion; keep that directory with the Deck so later conversions work offline and measure the same faces. `local()` sources are ignored. `FONT_GLYPH_FALLBACK` means the selected face lacks characters the text uses: pick a face that covers them or remove them.
5. `inspect` lists each selected asset/face with its CSS aliases, Office family/style, metrics, permission bits, class and `asset.source`; those fields are not evidence of embedding or renderer fidelity.
