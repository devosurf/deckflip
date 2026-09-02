# deckflip specification

Build-ready spec for `deckflip`: a bidirectional HTML <-> PPTX CLI and agent skill. Assembled from the wayfinder map [Map: HTML <-> PowerPoint CLI and agent skill](https://github.com/devosurf/deckflip/issues/1); each section names the ticket that decided it. Vocabulary is in [`CONTEXT.md`](../../CONTEXT.md); irreversible calls are in [`docs/adr/`](../adr/).

## Sections

| # | Section | Decides |
| --- | --- | --- |
| 01 | [CLI surface and Conversion report](01-cli.md) | commands, flags, exit codes, report schema |
| 02 | [HTML Deck dialect](02-deck-dialect.md) | Deck file, Slides, notes, assets, per-file form, emitted form, reserved names |
| 03 | [Authoring subset](03-authoring-subset.md) | what is native, rasterised, rejected; Text block; painting elements; groups |
| 04 | [Text box mapping](04-text-mapping.md) | box, insets, baseline correction, line spacing, lists, runs, tables |
| 05 | [Raster fallback](05-raster.md) | granularity, capture, DPI, `data-raster`, fix-it loop |
| 06 | [Round-trip preservation](06-round-trip.md) | preservation matrix, asset directory, manifest, untouched detection |
| 07 | [Font policy](07-fonts.md) | resolution, safe set, warnings, embedding, PPTX -> HTML fonts |
| 08 | [Report codes](08-report-codes.md) | every code with kind, severity, trigger and hint |
| 09 | [`inspect` output](09-inspect.md) | the JSON shape |
| 10 | [Rendering, verification and environment](10-rendering-and-verification.md) | renderers, Chromium policy, comparator gates, corpus, CI, Windows |
| 11 | [Architecture and build plan](11-architecture.md) | dependencies, modules, IDM seam, pipelines, determinism, milestones |
| 12 | [Agent skill](12-skill.md) | skill scope, format, distribution, SKILL.md outline |

## Fixed constants

Canvas `1280x720` CSS px = `960x540` pt = `12192000x6858000` EMU; `1 px = 0.75 pt = 9525 EMU`; default raster `192` dpi; `--strict` exit `4`; report `schemaVersion 1`; `inspect` `schemaVersion 1`; manifest `schemaVersion 1`.

## Settled outside tickets (during charting)

Node/TypeScript on npm; Playwright-measured layout; own OOXML emitter and parser; native first, raster only where OOXML cannot express the construct, editability over pixel identity; both directions first class; validated authoring subset rather than a component vocabulary; v1 flattens animations; fonts referenced by name, embedding behind a flag; one text box per HTML block with autofit off; 16:9 default with 4:3 and custom via meta, no scaling; single-file `<section>` Deck canonical; LibreOffice diffs in CI with PowerPoint as oracle; Claude Code first via a harness-neutral skill.

## Not in this spec (out of scope for v1)

GUI or hosted service; Google Slides / Keynote; presenter mode and PDF export as product features (`render` produces PNGs only); editing masters/layouts/themes beyond preservation; mapping CSS animations/transitions to PowerPoint effects (a later effort; v1 flattens).

## What a build session must not have to guess

Every question below is answered in the linked section; if a builder finds one that is not, it is a spec bug, not a design freedom.

- Which element becomes which OOXML object, in which order: 03, 04.
- Exact numbers: EMU conversion, insets, `spcPts`, wrap guard, DPI, gates: 04, 05, 10.
- Every report code, its severity and hint text: 08.
- What happens with an existing PPTX, byte for byte: 06.
- Which font name is written and when conversion refuses: 07.
- Where Chromium and LibreOffice come from, and what CI runs: 10.
- Module boundaries, dependency list, milestone order and acceptance tests: 11.
