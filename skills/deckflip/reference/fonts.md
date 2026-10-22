# Fonts

## How a stack resolves

For every run, the computed `font-family` stack selects the first available deck-provided or installed face. A local `@font-face` binds its CSS alias and weight/style descriptors to an asset. Preferred and legacy names remain matching aliases, but the PPTX uses the selected face's legacy Office family and regular/bold/italic/bold-italic identity.

- Nothing resolves: `FONT_UNRESOLVED` (error). Chromium fell back to a platform default, so the layout is not reproducible.
- The first resolvable entry is a generic (`sans-serif`, `serif`, `monospace`, `system-ui`, `ui-*`, `cursive`, `fantasy`, `math`, `emoji`): `FONT_GENERIC_ONLY` (error). Put a concrete family before it.
- Unstyled text currently defaults to `Arial`; authored inheritance is preserved.
- `FONT_IDENTITY_INVALID` (error, exit 2): missing or conflicting legacy names/style bits, an unsupported legacy subfamily, or a variable font whose Office instance identity is not supported. Choose a supported static face; do not edit font tables or remap CSS weights.
- Authored browser weights stay intact. Unmodified Heebo 500 becomes **Heebo Medium / regular**, 700 **Heebo / bold**, and 800 **Heebo ExtraBold / regular**. Office bold/italic comes from face metadata, not a numeric weight threshold.
- Per-glyph fallback and PowerPoint font selection are not proven by structural Verification; do not assume Chromium and PowerPoint substitute identically.

## The safe set

Present on every supported PowerPoint on Windows and macOS, so no embedding is needed and no entry is raised:

Arial, Courier New, Georgia, Times New Roman, Trebuchet MS, Verdana, plus the Office-bundled families Aptos, Calibri, Cambria, Candara, Consolas, Constantia, Corbel, Franklin Gothic, Century Gothic. Segoe UI is Windows-only and not safe.

Choose Aptos or Calibri for a "PowerPoint look"; Arial or Georgia when the deck must also look identical in viewers without the Office fonts, such as LibreOffice (`deckflip render deck.pptx` without PowerPoint), which substitutes metric-compatible fonts for the Office-bundled ones (`RENDER_FONT_SUBSTITUTED`, info).

## Rules for the agent

1. Name a concrete family first; end every stack with a safe family; never rely on a generic alone. `font-family: Georgia, "Times New Roman", serif` is the pattern.
2. Prefer the safe set.
3. A local `@font-face { src: url("fonts/Brand.woff") }` makes a brand font available for authoring, not portable in the PPTX. It remains `FONT_NOT_SAFE` (warning): the viewer may substitute. Use a safe font or install the Resolved font on every viewing machine.
4. `FONT_EMBED_UNSUPPORTED` means embedding is not implemented. Remove the embedding request; a different font licence or source format cannot enable it.
5. `deckflip inspect deck.html` lists `fonts[]` with `cssFamily`, matching `aliases`, `asset` (file, SHA-256, collection face index, PostScript name), `office` (family and RIBBI style), metrics, permission bits and class (`safe`, `deck-provided`, `installed`). These identify selected faces, not embedded or renderer-confirmed fonts.

## Embedding

Embedding is not implemented. Both `convert` and `validate` reject `--embed-fonts` and `--embed-fonts=Inter,Aptos` with `FONT_EMBED_UNSUPPORTED` (exit 2). The Conversion report remains available; conversion creates no output and leaves any existing destination unchanged.

An embedding request never suppresses `FONT_NOT_SAFE`, even when it names an unused fallback in the CSS stack. Only a successfully packaged selected face can satisfy portability once embedding is implemented; option intent and a clean report are not evidence of font payloads in the PPTX.
