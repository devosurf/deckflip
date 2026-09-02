# Rendering, verification and environment

Consolidates the renderer research ([#5](https://github.com/devosurf/deckflip/issues/5)), the spike ([#8](https://github.com/devosurf/deckflip/issues/8)) and the environment questions the map carried as fog.

## Renderers

| Input | Renderer | Selection |
| --- | --- | --- |
| HTML | Chromium via `playwright-core`, `deviceScaleFactor = dpi / 96`, one full-page screenshot per section clipped to the Canvas | always |
| PPTX | LibreOffice: `soffice --headless --convert-to pdf:impress_pdf_Export`, then `pdfjs-dist` + `@napi-rs/canvas` rasterise each page at the requested DPI | default (`--renderer libreoffice`) |
| PPTX | Real PowerPoint: macOS AppleScript `save as PDF` (spike path, Desktop-only sandbox), Windows PowerShell COM `Presentation.ExportAsFixedFormat`; both need an interactive session | `--renderer powerpoint`; missing app exits 1 |

Discovery: `--soffice <path>`, else `DECKFLIP_SOFFICE`, else `soffice` on `PATH`, else the standard install locations per OS. Each LibreOffice run gets its own `-env:UserInstallation` temp profile so concurrent renders do not collide.

## Chromium policy

Layout must be reproducible across machines, so the tool pins a Chromium build: the Playwright-managed revision that `playwright-core` in the installed `deckflip` version expects.

Resolution order: `--browser <path>` > `DECKFLIP_BROWSER` > the managed build if present > download the managed build (`playwright install chromium`, run in-process on first use with a one-line stderr notice). `--offline` / `DECKFLIP_OFFLINE=1` / `CI=true` disable the download and exit 1 with the exact install command. A system Chrome/Edge is used only through `--browser`; the report records the browser version (`tool.browser`) so drift is visible.

## Comparator and gates

`odiff` (`odiff-bin`), `threshold 0.1`, `antialiasing: true`, per-fixture `ignoreRegions`. Gates are per Slide on `diffPercentage`:

| Comparison | Gate (initial, calibrated on the corpus) |
| --- | --- |
| Chromium screenshot of the HTML vs PowerPoint render of the converted PPTX (oracle, Mac, manual) | <= 0.5 % |
| Chromium screenshot vs LibreOffice render (CI) | <= 2.0 %, with `RENDER_FONT_SUBSTITUTED` fixtures excluded from the text gate |
| PPTX -> HTML -> PPTX (untouched) | every part byte-identical; no image gate needed |
| HTML -> PPTX -> HTML -> PPTX | second PPTX part-identical to the first (idempotence) |

The spike's numbers set expectations: 0.57-0.78 % differing pixels against real PowerPoint for a text-heavy slide, dominated by 1-2 px vertical residuals.

## Corpus

`fixtures/corpus/<name>/` with `deck.html` (+ assets) or `source.pptx`, and `expected/` holding `chromium/slide-NNN.png` (generated, not committed), `powerpoint/slide-NNN.png` (committed, produced on a Mac with PowerPoint by `npm run corpus:oracle`), and `report.json` (committed, the expected entries). Categories, each with 3-8 decks:

- `text`: wrapping at boundaries, mixed sizes in a line, lists (nested, numbered, `inside`/`outside`), alignment, `pre`, RTL, emoji.
- `shapes`: fills, gradients, borders (uniform, per-side, dashed), radius, shadows, opacity, rotation.
- `pictures`: formats, crop via `object-fit`, `clip-path: inset`, SVG file and inline SVG.
- `tables`: spans, per-edge borders, cell padding, header rows.
- `layout`: flex and grid compositions, overlapping, off-canvas.
- `raster`: one deck per `RASTER_*` trigger and its `FLATTEN_*` twin.
- `fonts`: safe, Office-bundled, deck-provided `@font-face`, embedding, generic-only (expected error).
- `roundtrip`: PowerPoint-authored decks with charts, SmartArt, notes, sections, animations, comments, groups, placeholders, embedded fonts, a `.pptm`.
- `templates`: the skill's `templates/` rendered as-is (the skill must pass its own tool with zero warnings).

Renewal: adding a fixture means adding `deck.html` and running `corpus:oracle` once on a Mac; CI regenerates the Chromium side and refuses fixtures without committed `powerpoint/` images or `report.json`. Oracle images are regenerated wholesale when the PowerPoint version on the oracle machine changes, in one reviewed commit.

## CI shape

GitHub Actions, three jobs:

- `ubuntu`: unit tests; LibreOffice + Liberation, Carlito, Caladea fonts; the corpus gates above; round-trip identity; idempotence; determinism (two runs, identical bytes with `SOURCE_DATE_EPOCH`).
- `windows`: unit tests; font scan on `%WINDIR%\Fonts` and the per-user directory; path handling; HTML -> PPTX for the `text` and `fonts` categories with `expected/report.json` comparison (no image gate: no LibreOffice on this job).
- `macos`: unit tests; font scan on CoreText directories. The PowerPoint oracle is never run in CI (Microsoft does not support unattended Office); it is a documented manual step on the maintainer's machine.

## Windows notes

Font directories as in [07-fonts.md](07-fonts.md); `\\?\` long-path prefix when a path exceeds 260 characters; asset URLs are resolved with `file:` URLs, never string-joined paths; `SOURCE_DATE_EPOCH` honoured the same way; PowerShell 5.1 is enough for the PowerPoint oracle. LibreOffice default location `C:\Program Files\LibreOffice\program\soffice.exe`.
