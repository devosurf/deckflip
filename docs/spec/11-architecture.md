# Architecture and build plan

## Runtime and dependencies

Node >= 20.16, TypeScript strict, ESM, single npm package `deckflip` with a `bin`. Build with `tsup`, test with `vitest`.

| Dependency | Role | Why this one (from [#7](https://github.com/devosurf/deckflip/issues/7), [#3](https://github.com/devosurf/deckflip/issues/3), [#5](https://github.com/devosurf/deckflip/issues/5)) |
| --- | --- | --- |
| `playwright-core` | Chromium measurement, screenshots, raster capture | pinned browser revision; no bundled download at install time |
| `jszip` | OPC container read/write | folder API, used by `docx`/`exceljs`; ZIP64 write not needed (media stays under 4 GB) |
| `saxes` | XML parsing of existing parts | strict, namespace-aware, event-based: preserves everything we do not model |
| `fontkit` | font file parsing (`name`, `OS/2`, `hhea`, `fsType`) | pure JS, TTF/OTF/WOFF |
| `commander` | CLI parsing | boring |
| `pdfjs-dist` + `@napi-rs/canvas` | rasterising LibreOffice PDFs | no poppler dependency |
| `odiff-bin` (dev) | corpus comparator | SIMD, `diffPercentage`, ignore regions |

Hand-rolled: `[Content_Types].xml` and `.rels` bookkeeping, the XML serializer (fixed attribute order, `xml:space`, escaping), EMU/pt/px math (`1 px = 9525 EMU = 0.75 pt`), EOT wrapping/unwrapping, the platform font-directory scan.

## Modules

```
src/
  cli/          commander wiring, exit ladder, stderr summary
  model/        Intermediate Deck Model (IDM): Deck, Slide, Element union, TextBody, Style; units are CSS px and pt
  html/
    load.ts     Deck file / directory / per-file Slide documents, asset resolution
    validate.ts static checks (elements, meta, assets) + measured checks (slide size, fonts)
    measure.ts  Playwright session: computed styles, boxes, line boxes, marker widths -> IDM
    raster.ts   isolated captures
  fonts/        scan, resolve, classify, metrics, embed (EOT)
  ooxml/
    opc.ts      package read/write over jszip, part naming, rels
    xml.ts      serializer + saxes-based reader into a small typed tree
    emu.ts
  emit/         IDM -> PresentationML/DrawingML parts (text, shapes, pictures, tables, groups, media, notes, sections, fonts)
  parse/        PPTX -> IDM (+ opaque records, inheritance resolution from layout/master/theme)
  htmlout/      IDM -> HTML Deck + asset directory + manifest
  roundtrip/    fingerprints, manifest, untouched detection, source-part splicing
  report/       entry construction, codes table (single source for docs/spec/08 and the skill's reference)
  render/       chromium, libreoffice, powerpoint drivers; pdf rasteriser
  inspect/      IDM -> inspect JSON
```

The **IDM** is the seam: both directions produce it, `inspect` serialises it, tests assert on it. Nothing in `emit/` reads the DOM; nothing in `html/` knows OOXML.

## Pipelines

HTML -> PPTX: `load` -> `validate` (static) -> `measure` (one Chromium page per Slide document; `load` + `document.fonts.ready`; animations paused) -> `validate` (measured) -> fonts resolve/classify -> `raster` pass -> `roundtrip` (splice untouched source parts when a manifest exists) -> `emit` -> report. A validation error stops before `measure` writes anything.

PPTX -> HTML: `opc` read -> `parse` (with inheritance resolved to explicit values) -> `htmlout` (HTML, assets, previews via LibreOffice when present, manifest) -> report.

## Determinism

Part names and rel ids are assigned in emission order; media are content-hash named; XML attributes are written in a fixed order; `docProps` timestamps come from `SOURCE_DATE_EPOCH`; the font scan and the Chromium build are pinned per version. `convert` twice = identical bytes (timestamps aside).

## Milestones (build order, each with its acceptance test)

1. **Emitter core + text**: `opc`, `xml`, `emit` for text boxes; `measure` for boxes and line boxes; fonts resolve + metrics. Accept: the spike slide reproduces at <= 0.8 % pixel diff against the PowerPoint oracle; `text` corpus passes the LibreOffice gate.
2. **Shapes, pictures, tables, lists, groups**: full native table from [03](03-authoring-subset.md) and [04](04-text-mapping.md). Accept: `shapes`, `pictures`, `tables`, `layout` corpus gates.
3. **validate, report, raster, skill**: complete code list, isolated raster capture, `--strict`, `skills/deckflip/` with templates passing at zero warnings. Accept: `raster` and `templates` corpus; an agent session producing a deck from the skill alone.
4. **Parser, PPTX -> HTML, round trip**: `parse`, `htmlout`, manifest, fingerprints, opaque handling. Accept: `roundtrip` corpus part-identity and idempotence gates; foreign decks list every opaque element.
5. **Fonts embedding, render, inspect polish**: EOT embedding verified in PowerPoint for Windows and Mac; LibreOffice/PowerPoint renderers; `inspect` schema frozen. Accept: `fonts` corpus; embedded font opens on both platforms.

The initial `0.1.0` release includes milestones 1-4: bidirectional conversion and round-trip preservation. Publish `1.0.0` after milestone 5 and the report schema is declared stable.
