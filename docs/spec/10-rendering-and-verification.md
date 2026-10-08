# Rendering, verification and environment

Consolidates the renderer research ([#5](https://github.com/devosurf/deckflip/issues/5)), the spike ([#8](https://github.com/devosurf/deckflip/issues/8)) and the environment questions the map carried as fog.

## Supported host

macOS is the only supported CLI host for now. Windows and Linux implementation paths are retained but are not supported or CI-gated. Cross-platform notes elsewhere in the specs describe retained implementation details or future work, not current release acceptance criteria. This does not change the PPTX format or Safe font policy.

## Verification

Every `convert`, once its output is written, and every `verify <source> <output>` compares what the source shows with what the output contains ([ADR 0007](../adr/0007-verification-and-powerpoint-oracle.md)). A mismatch is a `VERIFY_*` error (exit 5, output kept): a deckflip defect, never an authoring choice.

- **The two sides.** The HTML side is the measured Deck plus a census Chromium takes of each Slide by a walk of its own, so a defect in the measurement walk cannot hide what it lost. The PPTX side is the package read back by the parser. HTML -> PPTX verifies the emitted bytes; PPTX -> HTML lays the written Deck out in the same Chromium and compares it with the parsed source.
- **Visible text** (`VERIFY_TEXT_MISSING`, `VERIFY_TEXT_EXTRA`): every laid-out, shown text node of the Slide, `text-transform` applied and soft hyphens removed, grouped by owner (the element carrying its `data-shape-id`, else its nearest block) and cut at line breaks and blocks. Hidden subtrees, speaker notes, `data-raster` and opaque subtrees, generated content and owners wholly off the Canvas are left out. Per Slide, the multiset of whitespace-separated words must match the words of every text body in the PPTX; missing words are reported at their source owner, extra words at their output owner. Speaker notes are compared the same way.
- **Geometry** (`VERIFY_GEOMETRY`): elements are paired by `shapeId` when both sides carry one (round trips), then by the longest common subsequence of kind and name, then remaining same-named leftovers. Paired elements must agree on their Canvas bounds (group transforms composed; groups themselves compare through their children) within 0.5 px per edge plus the wrap-width guard, and on rotation within 0.1°. An unpaired element that paints is reported; a picture's `<name> border` shape counts as part of the picture; opaque content missing after an HTML -> PPTX round trip is the round trip's to report (`PRESERVE_*`).
- **Stacking** (`VERIFY_STACKING`): for every pair of Painting elements whose measured boxes overlap by 2 px both ways, Chromium hit-tests the middle of the overlap with pointer events forced on; the PPTX must stack their counterparts in the same order. Anonymous text and elements sharing a selector cannot be told apart in the hit list and are skipped.

Cost: HTML -> PPTX reuses the measurement's pages and parses the emitted bytes in-process; PPTX -> HTML launches Chromium once to lay the written Deck out.

## Renderers

`render` is a diagnostic: neither the agent loop nor CI needs a PPTX render.

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

| Comparison | Gate |
| --- | --- |
| Oracle record: digest of the converted fixture vs `expected/oracle.json` (CI) | equal; otherwise the PowerPoint renders show another package and `corpus:oracle` must run again |
| Chromium screenshot of the HTML vs the committed PowerPoint render (CI) | <= 1.25 %, calibrated on the 41 corpus Slides against PowerPoint for Mac 16.115: median 0.42 %, ceiling 1.14 % (text/alignment, then tables/borders 1.10 %, raster/shadow 1.07 %) |
| Chromium screenshot vs LibreOffice render (opt-in, `DECKFLIP_LIBREOFFICE_GATE=1`, not CI) | <= 2.6 %, the former CI gate |
| PPTX -> HTML -> PPTX (untouched) | every part byte-identical; no image gate needed |
| HTML -> PPTX -> HTML -> PPTX | second PPTX part-identical to the first (idempotence) |

The spike's numbers set expectations: 0.57-0.78 % differing pixels against real PowerPoint for a text-heavy slide, dominated by 1-2 px vertical residuals; the spike slide measures 0.78 % against the current oracle.

The digest is SHA-256 over the package parts by name, leaving out `docProps/` (timestamps, app version) and `ppt/media/` (rasters are Chromium's own paint, already the other side of the image gate), with media targets in relationship parts reduced to their extension.

## Corpus

`fixtures/corpus/<category>/<name>/` with `deck.html` (+ assets; a category may keep shared assets in `fixtures/corpus/<category>/_assets/`, which the oracle script skips) or `source.pptx`, and `expected/` holding `chromium/slide-NNN.png` (generated, not committed), `powerpoint/slide-NNN.png` and `oracle.json` (committed, the PowerPoint oracle and its Oracle record, produced on a Mac with PowerPoint by `npm run corpus:oracle [category[/name] ...]`), `report.json` (committed, the expected entries, never a `VERIFY_*`), and optionally `ignore.json` (`{ "<slide>": [{ "x1", "y1", "x2", "y2" }] }` in CSS px: the comparator's `ignoreRegions` for areas the fixture deliberately renders differently, such as a flattened effect). Categories, each with 3-8 decks:

- `text`: wrapping at boundaries, the wrap-width guard (`wrap-guard`: every first line 0.5 px from its break in four safe fonts at 12 and 20 px; `wrap-guard.test.ts` requires PowerPoint's oracle to end every line where Chromium does), mixed sizes in a line, lists (nested, numbered, `inside`/`outside`), alignment, `pre`, RTL, emoji.
- `shapes`: fills, gradients, borders (uniform, per-side, dashed), radius, shadows, opacity, rotation.
- `pictures`: formats, crop via `object-fit`, `clip-path: inset`, SVG file and inline SVG.
- `tables`: spans, per-edge borders, cell padding, header rows.
- `layout`: flex and grid compositions, overlapping, off-canvas.
- `raster`: one deck per `RASTER_*` trigger and its `FLATTEN_*` twin.
- `fonts`: safe, Office-bundled, deck-provided `@font-face`, embedding, generic-only (expected error).
- `roundtrip`: PowerPoint-authored decks with charts, SmartArt, notes, sections, animations, comments, groups, placeholders, embedded fonts, a `.pptm`.
- `templates`: the skill's `templates/` rendered as-is (the skill must pass its own tool with zero warnings).

Renewal: adding a fixture, or changing what a fixture emits, means running `corpus:oracle` for it on a Mac with PowerPoint; the script refuses fixtures that fail Verification. CI regenerates the Chromium side and refuses fixtures without committed `powerpoint/` images, `oracle.json` or `report.json`. Oracle images are regenerated wholesale when the PowerPoint version on the oracle machine changes, in one reviewed commit.

## CI shape

GitHub Actions has one required job, `macos`:

- Install the pinned managed Chromium. No LibreOffice: the corpus gates compare with the committed PowerPoint oracle.
- Audit production dependencies, typecheck, and run the full test suite, including the PowerPoint-oracle corpus gates, Verification of every fixture, font scan, round-trip identity and idempotence.
- Check determinism with two byte-identical conversions under `SOURCE_DATE_EPOCH`, then build and verify the npm package contents.

The PowerPoint oracle is never run in CI (Microsoft does not support unattended Office); it remains a manual step on the maintainer's Mac. Windows and Ubuntu jobs are deferred until those hosts are supported.

## Windows notes (unsupported host)

Font directories as in [07-fonts.md](07-fonts.md); `\\?\` long-path prefix when a path exceeds 260 characters; asset URLs are resolved with `file:` URLs, never string-joined paths; `SOURCE_DATE_EPOCH` honoured the same way; PowerShell 5.1 is enough for the PowerPoint oracle. LibreOffice default location `C:\Program Files\LibreOffice\program\soffice.exe`.
