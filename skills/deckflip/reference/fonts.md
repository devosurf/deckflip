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

Choose Aptos or Calibri for a "PowerPoint look"; Arial or Georgia when the deck must also render identically in LibreOffice (CI, `deckflip render` without PowerPoint), which substitutes metric-compatible fonts for the Office-bundled ones (`RENDER_FONT_SUBSTITUTED`, info).

## Rules for the agent

1. Name a concrete family first; end every stack with a safe family; never rely on a generic alone. `font-family: Georgia, "Times New Roman", serif` is the pattern.
2. Prefer the safe set.
3. A brand font is fine when its file sits next to the deck, declared with `@font-face { src: url("fonts/Brand.woff") }`, and the conversion runs with `--embed-fonts`. Without embedding it is `FONT_NOT_SAFE` (warning): the viewer may substitute.
4. Read the `FONT_*` entries: `FONT_EMBED_RESTRICTED` means the licence forbids embedding (switch fonts); `FONT_EMBED_FORMAT` means WOFF2/TTC cannot be embedded (provide TTF, OTF or WOFF).
5. `deckflip inspect deck.html` lists `fonts[]` with the resolved file and class (`safe`, `deck-provided`, `installed`).

## Embedding

`--embed-fonts` embeds every resolved font outside the safe set; `--embed-fonts=Inter,Aptos` embeds exactly the named families. Default off. Embedding requires the font's permission bits to allow installable or editable embedding and a TTF/OTF/WOFF source; the whole file is embedded, no subsetting.
