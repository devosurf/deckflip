# Fonts

## How a stack resolves

For every run, the computed `font-family` stack is resolved to the first family that is either **deck-provided** (a `@font-face` in the Deck with a local `url()`) or **installed** on the machine running the conversion. That family's name is written into the PPTX; the rest of the stack is discarded.

- Nothing resolves: `FONT_UNRESOLVED` (error). Chromium fell back to a platform default, so the layout is not reproducible.
- The first resolvable entry is a generic (`sans-serif`, `serif`, `monospace`, `system-ui`, `ui-*`, `cursive`, `fantasy`, `math`, `emoji`): `FONT_GENERIC_ONLY` (error). Put a concrete family before it.
- Unstyled text is `Arial` (the injected base stylesheet), so it is deterministic.
- Per-glyph fallback for scripts the family lacks (CJK, emoji) raises no entry: PowerPoint substitutes per script the same way.

## The safe set

Present on every supported PowerPoint on Windows and macOS, so no embedding is needed and no entry is raised:

Arial, Courier New, Georgia, Times New Roman, Trebuchet MS, Verdana, plus the Office-bundled families Aptos, Calibri, Cambria, Candara, Consolas, Constantia, Corbel, Franklin Gothic, Century Gothic. Segoe UI is Windows-only and not safe.

Choose Aptos or Calibri for a "PowerPoint look"; Arial or Georgia when the deck must also look identical in viewers without the Office fonts, such as LibreOffice (`deckflip render deck.pptx` without PowerPoint), which substitutes metric-compatible fonts for the Office-bundled ones (`RENDER_FONT_SUBSTITUTED`, info).

## Rules for the agent

1. Name a concrete family first; end every stack with a safe family; never rely on a generic alone. `font-family: Georgia, "Times New Roman", serif` is the pattern.
2. Prefer the safe set.
3. A local `@font-face { src: url("fonts/Brand.woff") }` makes a brand font available for authoring, not portable in the PPTX. It remains `FONT_NOT_SAFE` (warning): the viewer may substitute. Use a safe font or install the Resolved font on every viewing machine.
4. `FONT_EMBED_UNSUPPORTED` means embedding is not implemented. Remove the embedding request; a different font licence or source format cannot enable it.
5. `deckflip inspect deck.html` lists `fonts[]` with the resolved file and class (`safe`, `deck-provided`, `installed`).

## Embedding

Embedding is not implemented. Both `convert` and `validate` reject `--embed-fonts` and `--embed-fonts=Inter,Aptos` with `FONT_EMBED_UNSUPPORTED` (exit 2). The Conversion report remains available; conversion creates no output and leaves any existing destination unchanged.

An embedding request never suppresses `FONT_NOT_SAFE`, even when it names an unused fallback in the CSS stack. Only a successfully packaged selected face can satisfy portability once embedding is implemented; option intent and a clean report are not evidence of font payloads in the PPTX.
