# Font policy

Decided in [#15](https://github.com/devosurf/deckflip/issues/15).

## Resolution (authoring machine)

- For every run, the computed `font-family` stack is resolved to the first family that is either **deck-provided** (declared by a `@font-face` in the Deck with a local `url()`; Chromium loads exactly that file) or **installed** on the authoring machine. That family is the **Resolved font**; its name goes into `a:latin/@typeface` (and `ea`/`cs`). The rest of the stack is discarded.
- Installed fonts are enumerated by a pure-Node scan of the platform font directories (`get-system-fonts`-style walk; macOS `/System/Library/Fonts`, `/Library/Fonts`, `~/Library/Fonts`; Windows `%WINDIR%\Fonts` + per-user `LocalAppData\Microsoft\Windows\Fonts`; Linux `fc-list --format` when available, else `/usr/share/fonts`, `~/.fonts`, `~/.local/share/fonts`) with `fontkit` parsing `name`, `OS/2`, `hhea`. No native addon. The scan is cached per run. The same file supplies the metrics for the baseline correction (#12) and the `fsType` bits for embedding.
- If nothing in the stack resolves, Chromium fell back to a platform default and the layout is not reproducible: `FONT_UNRESOLVED` (error, `validate` exit 2; hint names the safe set).
- If the first resolvable entry is a generic family (`sans-serif`, `serif`, `monospace`, `system-ui`, `ui-*`, `cursive`, `fantasy`, `math`, `emoji`): `FONT_GENERIC_ONLY` (error). Generics resolve differently per machine; the hint says to put a concrete family before the generic. The injected base stylesheet sets `body { font-family: Arial }` so unstyled text is deterministic.
- If Chromium's actually-used font (per-glyph fallback for scripts the family lacks, e.g. CJK or emoji) differs from the Resolved font, no entry: PowerPoint performs the same per-script substitution.

## Classification and warnings

| Class | Members | Entry |
| --- | --- | --- |
| **Safe** | Arial, Courier New, Georgia, Times New Roman, Trebuchet MS, Verdana (the researched Windows/macOS overlap) plus the Office-bundled families installed by every supported desktop PowerPoint on both platforms: Aptos (all faces), Calibri, Cambria, Candara, Consolas, Constantia, Corbel, Franklin Gothic, Century Gothic, Segoe UI is **not** in the set (Windows only) | none |
| **Deck-provided** | `@font-face` with local file | `FONT_NOT_SAFE` (warning) unless embedded |
| **Other installed** | anything else | `FONT_NOT_SAFE` (warning) unless embedded |

The Office-bundled families are safe for the viewer (PowerPoint) but not for the LibreOffice render oracle: `render --renderer libreoffice` adds `RENDER_FONT_SUBSTITUTED` (info) for them, and CI installs the metric-compatible Carlito/Caladea for Calibri/Cambria. [INFERENCE: the Office-bundled list is from product knowledge, not the #3 sources; the spec marks it "verify on a clean Office for Mac install" as a build-phase check.]

## Embedding

- `--embed-fonts` embeds every Resolved font of class deck-provided or other-installed; `--embed-fonts=<name,...>` embeds exactly the named families (safe ones included, for pixel parity on machines without Office). Default off.
- Permission: embed only when `OS/2.fsType` is `0` (installable) or `8` (editable). `4` (preview/print) and `2` (restricted) are not embedded: `FONT_EMBED_RESTRICTED` (warning) and the font stays a `FONT_NOT_SAFE` warning. No read-only downgrade: editability outranks fidelity.
- Payload: `p:embeddedFontLst/p:embeddedFont` with `regular`/`bold`/`italic`/`boldItalic` entries for each face actually used, each a part `ppt/fonts/font<n>.fntdata` of content type `application/x-fontdata`, containing the face wrapped as **uncompressed EOT** (EOT header + sfnt, no MTX, no XOR). No subsetting in v1 ("embed all characters"). Accepted source formats: TTF, OTF, WOFF (inflated to sfnt); WOFF2 and TTC faces are `FONT_EMBED_FORMAT` (warning, not embedded). Variable fonts embed the whole file (PowerPoint picks the default instance; `SUBSTITUTE_FONT_WEIGHT` info when a non-default weight was used).
- Verification: the EOT-wrapped payload opening in PowerPoint for Windows and Mac is the first acceptance test of the embedding milestone; the flag is off by default so nothing else depends on it.

## PPTX -> HTML

- Every `typeface` becomes `font-family: "<typeface>", <generic>` where the generic comes from the font's `OS/2` family class / panose when the file is available, else from the theme slot (`+mj-lt` -> major font of the theme). Theme fonts are resolved to their concrete names and also exposed as `--theme-major-font`/`--theme-minor-font`.
- Embedded fonts in the source are unwrapped from EOT, written to `<name>.assets/fonts/`, declared with `@font-face` so Chromium measures with them, and re-embedded on the way back (`--embed-fonts` implied for those families).
- Fonts the authoring machine lacks and the source did not embed are `FONT_MISSING_FOR_LAYOUT` (warning): the HTML declares the original name (so the round-trip writes it back) but Chromium measured with the next entry in the stack; `render` of the HTML will differ from PowerPoint.

## What the skill tells the agent

1. Name a concrete family first; end every stack with a safe family; never rely on a generic alone.
2. Prefer the safe set. Use Aptos/Calibri when a "PowerPoint look" is wanted, Arial/Georgia when the deck must also render identically in LibreOffice/CI.
3. A brand font is fine if its file is in the Deck (`@font-face`) and `--embed-fonts` is passed; read `FONT_*` entries: `FONT_EMBED_RESTRICTED` means the licence forbids it, switch fonts.
4. `inspect` lists `fonts[]` with class, resolved file and whether it will be embedded.
