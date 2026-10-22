# Font policy

Font selection originated in [#15](https://github.com/devosurf/deckflip/issues/15); Office identity is separated in [#32](https://github.com/devosurf/deckflip/issues/32) under the [#30 font cutover](https://github.com/devosurf/deckflip/issues/30).

## Resolution and Office identity

- For every run, the computed `font-family` stack selects the first available concrete family. Local `@font-face` declarations bind their CSS alias and weight/style descriptors to the source asset; they take precedence over installed faces. Preferred and legacy family names remain case-insensitive matching aliases.
- A **Resolved font** separates `cssFamily` and `aliases`, `asset` (`file`, SHA-256, zero-based collection `faceIndex`, PostScript name), and `office` (`family`, `style`). Metrics and `fsType` come from that selected face. Collection members sharing a file remain distinct.
- The Office family is legacy name ID 1, not preferred name ID 16. Legacy subfamily ID 2 and consistent `OS/2.fsSelection` / `head.macStyle` determine `regular`, `bold`, `italic` or `boldItalic`. Serialization writes this family to `a:latin`, `a:ea` and `a:cs`, and derives `b`/`i` from the Office style. This same family/style identifies the future embedding slot; it is not evidence of embedded payloads. See the [OpenType naming contract](https://learn.microsoft.com/en-us/typography/opentype/spec/name#name-ids).
- Authored browser weights and styles are not rewritten. Unmodified Heebo 500 emits **Heebo Medium / regular**, 700 emits **Heebo / bold**, and 800 emits **Heebo ExtraBold / regular**. No font tables are modified.
- Missing legacy family/subfamily or PostScript identity, conflicting style metadata, and unsupported legacy subfamilies produce `FONT_IDENTITY_INVALID` (error, exit 2). Variable fonts also fail explicitly: a supported exact-instance-to-Office mapping has not been established. Conversion does not silently choose the next fallback or create/replace output.
- Installed fonts are still enumerated by a pure-Node platform-directory scan with `fontkit`, cached per process. This is transitional: pinned assets and a redistributable default are later #30 milestones, not implemented by #32.
- Nothing resolves: `FONT_UNRESOLVED` (error). A generic reached before a concrete match: `FONT_GENERIC_ONLY` (error). The current injected `body { font-family: Arial }` supplies a base default without overriding authored inheritance.
- Per-glyph fallback is not proven to be identical in Chromium and PowerPoint. Structural Verification checks text and geometry, not selected glyph faces. Supported-PowerPoint evidence remains separate.

## Classification and warnings

| Class | Members | Entry |
| --- | --- | --- |
| **Safe** | Arial, Courier New, Georgia, Times New Roman, Trebuchet MS, Verdana (the researched Windows/macOS overlap) plus the Office-bundled families installed by every supported desktop PowerPoint on both platforms: Aptos (all faces), Calibri, Cambria, Candara, Consolas, Constantia, Corbel, Franklin Gothic, Century Gothic, Segoe UI is **not** in the set (Windows only) | none |
| **Deck-provided** | `@font-face` with local file | `FONT_NOT_SAFE` (warning); embedding is not implemented |
| **Other installed** | anything else | `FONT_NOT_SAFE` (warning); embedding is not implemented |

The Office-bundled families are safe for the viewer (PowerPoint) but not for a LibreOffice render: `render --renderer libreoffice` adds `RENDER_FONT_SUBSTITUTED` (info) for them, since LibreOffice substitutes the metric-compatible Carlito/Caladea for Calibri/Cambria where installed. CI no longer renders with LibreOffice ([ADR 0007](../adr/0007-verification-and-powerpoint-oracle.md)). [INFERENCE: the Office-bundled list is from product knowledge, not the #3 sources; the spec marks it "verify on a clean Office for Mac install" as a build-phase check.]

## Embedding

Embedding is not implemented. `--embed-fonts` and `--embed-fonts=<name,...>` are explicit requests, not evidence of embedded fonts. `convert` and `validate` reject them with `FONT_EMBED_UNSUPPORTED` (error, exit 2), even for a safe font or a Deck without text. The Conversion report is kept; no converted Deck is created or replaced. Earlier validation errors still stop conversion, and Verification failures after successful validation still exit 5 with output retained.

The Resolved font keeps its `FONT_NOT_SAFE` entry regardless of the request. Naming an unused fallback in the CSS stack cannot satisfy the selected face's portability requirement. Use a safe font, or install the Resolved font on every viewing machine.

### Planned embedding milestone (not implemented)

Only successful packaging of the selected face may satisfy portability. Integrate that result into the existing font policy, not a parallel policy based on option intent. Inspect the embedded-font list, relationships and payloads; a clean report is not proof.

The supported payload/permission/format matrix depends on the isolated PowerPoint compatibility experiment [#33](https://github.com/devosurf/deckflip/issues/33). Packaging [#34](https://github.com/devosurf/deckflip/issues/34) waits for that evidence, asset acquisition #35 waits for #34, and the portable-default cutover #36 waits for #31–#35. Earlier EOT/variable-font proposals are not an implemented or proven contract. Do not uninstall the developer's fonts to simulate a recipient.

## PPTX -> HTML

- Every `typeface` becomes `font-family: "<typeface>", <generic>` where the generic comes from the font's `OS/2` family class / panose when the file is available, else from the theme slot (`+mj-lt` -> major font of the theme). Theme fonts are resolved to their concrete names and also exposed as `--theme-major-font`/`--theme-minor-font`.
- Planned embedding milestone: unwrap source EOT fonts into `<name>.assets/fonts/`, declare them with `@font-face`, and package selected faces on the way back. This is not currently implemented; source-package preservation is not evidence of new embedding, and no `--embed-fonts` request is implied today.
- Fonts the authoring machine lacks and the source did not embed are `FONT_MISSING_FOR_LAYOUT` (warning): the HTML declares the original name (so the round-trip writes it back) but Chromium measured with the next entry in the stack; `render` of the HTML will differ from PowerPoint.

## What the skill tells the agent

1. Name a concrete family first; end every stack with a safe family; never rely on a generic alone.
2. Prefer the safe set. Use Aptos/Calibri when a "PowerPoint look" is wanted, Arial/Georgia when the deck must also look identical in viewers without Office fonts, such as LibreOffice.
3. A local `@font-face` makes a brand font available for authoring, not portable in the PPTX. It remains `FONT_NOT_SAFE`: choose a safe font or install the Resolved font on every viewing machine. Remove an explicit embedding request if `FONT_EMBED_UNSUPPORTED` is reported.
4. `inspect` lists each selected asset/face with its CSS aliases, Office family/style, metrics, permission bits and class; those fields are not evidence of embedding or renderer fidelity.
