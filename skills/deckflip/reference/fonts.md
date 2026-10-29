# Fonts

## How a stack resolves

For every run, the computed `font-family` stack selects the first available supplied or installed face. A family declared with `@font-face` matches only its rules, by their weight/style descriptors, never an installed face of the same name. The bundled default uses supplied faces, not an installed copy. Other families match installed faces by preferred or legacy name. The PPTX uses the selected face's legacy Office family and regular/bold/italic/bold-italic identity.

- Nothing resolves: `FONT_UNRESOLVED` (error). Chromium fell back to a platform default, so the layout is not reproducible.
- The first resolvable entry is a generic (`sans-serif`, `serif`, `monospace`, `system-ui`, `ui-*`, `cursive`, `fantasy`, `math`, `emoji`): `FONT_GENERIC_ONLY` (error). Put a concrete family before it.
- Unstyled text defaults to bundled **Liberation Sans 2.1.5** (static Regular, Bold, Italic and BoldItalic). A root declaration in the first anonymous cascade layer preserves authored root, body, Slide and text families, including author layers. There is no body default and no bundled fallback appended to explicit stacks: missing families and generics still fail.
- `FONT_IDENTITY_INVALID` (error, exit 2): missing or conflicting legacy names/style bits, an unsupported legacy subfamily, or a variable font whose Office instance identity is not supported. Choose a supported static face; do not edit font tables or remap CSS weights.
- Authored browser weights stay intact. Unmodified Heebo 500 becomes **Heebo Medium / regular**, 700 **Heebo / bold**, and 800 **Heebo ExtraBold / regular**. Office bold/italic comes from face metadata, not a numeric weight threshold.
- Per-glyph fallback and PowerPoint font selection are not proven by structural Verification; do not assume Chromium and PowerPoint substitute identically. `FONT_GLYPH_FALLBACK` (warning) names characters the selected face lacks and the fonts Chromium drew them with instead.

## Default is not safe

The bundled default needs no font installation or network for authoring. Its manifest-pinned bytes are the ones Chromium measures, but it remains `deck-provided` and raises `FONT_NOT_SAFE`: reproducible authoring does not embed fonts or make Liberation Sans available on the recipient's PowerPoint installation.

For a clean strict Deck, explicitly author a safe family. The supplied template already sets Arial on `body`; keep that declaration or choose another installed safe font. Bundling is not a reason to suppress portability entries or request embedding, which remains unimplemented.

## Webfonts

- `@font-face` works from inline `<style>`, linked and `@import`ed stylesheets, local or hosted (Google Fonts CSS included); `url()`s resolve against their stylesheet. TTF, OTF, WOFF and WOFF2 are accepted; WOFF/WOFF2 are decoded before measurement.
- Hosted stylesheets and fonts are downloaded on first use and pinned in `<name>.assets/fonts/`. Keep that directory with the Deck: later conversions use the pinned bytes, offline included. Delete an entry from `fonts/sources.json` to fetch it again.
- `local()` sources are ignored, so an installed font never replaces the supplied file. A rule with only `local()` is `FONT_ASSET_UNSUPPORTED`.
- A face that a Slide needs but cannot load stops the conversion: `VALIDATE_MISSING_ASSET` (missing local file), `FONT_ASSET_UNAVAILABLE` (no network and no pin), `FONT_ASSET_UNSUPPORTED` (not a supported font). Unused rules are never fetched or reported.
- A `unicode-range` subset covers only its range: text outside every subset of the family gets `FONT_GLYPH_FALLBACK`.
- `FONT_EMBED_RESTRICTED` (warning): the face's licence bits (`fsType`) rule out editable embedding; choose another font if the Deck must travel.

## The safe set

For installed faces with a supported Office identity, these families need no embedding and raise no portability entry:

Arial, Courier New, Georgia, Times New Roman, Trebuchet MS, Verdana, plus the Office-bundled families Aptos, Calibri, Cambria, Candara, Consolas, Constantia, Corbel, Franklin Gothic, Century Gothic. Segoe UI is Windows-only and not safe.

Safe membership uses the face's preferred or legacy metadata aliases, so a separate Office name such as Aptos SemiBold remains safe. An authored `@font-face` alias does not establish safety. Missing or conflicting Office identity still fails with `FONT_IDENTITY_INVALID`, including within a safe family.

Choose Aptos or Calibri for a "PowerPoint look"; Arial or Georgia when the deck must also look identical in viewers without the Office fonts, such as LibreOffice (`deckflip render deck.pptx` without PowerPoint), which substitutes metric-compatible fonts for the Office-bundled ones (`RENDER_FONT_SUBSTITUTED`, info).

## Rules for the agent

1. Name a concrete family first; end every stack with a safe family; never rely on a generic alone. `font-family: Georgia, "Times New Roman", serif` is the pattern.
2. Prefer the safe set for a clean strict Deck; the bundled default is not in it.
3. An `@font-face` font, local (`src: url("fonts/Brand.woff2")`) or hosted, makes a brand font available for authoring, not portable in the PPTX. It remains `FONT_NOT_SAFE` (warning): the viewer may substitute. Use a safe font or install the Resolved font on every viewing machine.
4. `FONT_EMBED_UNSUPPORTED` means embedding is not implemented. Remove the embedding request; a different font licence or source format cannot enable it.
5. `deckflip inspect deck.html` lists `fonts[]` with `cssFamily`, matching `aliases`, `asset` (SHA-256, collection face index, PostScript name, and `source`: `installed`, `file`, `remote` with its pinned copy, `data`, or `bundled`), `office` (family and RIBBI style), metrics, permission bits and class (`safe`, `deck-provided`, `installed`); `convert --json` reports the same list as `fonts`. Bundled provenance includes `kind: 'bundled'`, `family: 'Liberation Sans'`, `version: '2.1.5'`, `file` (basename), `format: 'ttf'` and `sha256` of the supplied bytes. These identify selected faces, not embedded or renderer-confirmed fonts.

## Embedding

Embedding is not implemented. Both `convert` and `validate` reject `--embed-fonts` and `--embed-fonts=Inter,Aptos` with `FONT_EMBED_UNSUPPORTED` (exit 2). The Conversion report remains available; conversion creates no output and leaves any existing destination unchanged.

An embedding request never suppresses `FONT_NOT_SAFE`, even when it names an unused fallback in the CSS stack. Only a successfully packaged selected face can satisfy portability once embedding is implemented; option intent and a clean report are not evidence of font payloads in the PPTX.
