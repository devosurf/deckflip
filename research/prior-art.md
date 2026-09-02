# Question

Even with our own emitter/parser, which low-level pieces are worth reusing (zip, XML, OPC package handling, EMU math), and what do existing html2pptx approaches (including Anthropic's pptx skill) and pptxgenjs get right or wrong about HTML->PPTX mapping?

# Findings

## 1) Low-level Node reuse candidates

### ZIP / package container

- **JSZip is the best default container builder for an in-memory OOXML package.** It gives a folder-tree API, async generation, Node streams, and explicit `streamFiles` support, and its docs show it is meant for composing/reading/editing zip archives in JS. It is already used this way by `docx` and `exceljs` for OOXML packaging. Caveat: JSZip can load ZIP64 only within JavaScript's safe-integer limits, its own limitations doc says output is not byte-stable, and the generator source only emits classic 32-bit EOCD fields, so it cannot write ZIP64 archives. Sources: [JSZip README](https://raw.githubusercontent.com/Stuk/jszip/main/README.markdown), [limitations](https://raw.githubusercontent.com/Stuk/jszip/main/documentation/limitations.md), [generateAsync docs](https://raw.githubusercontent.com/Stuk/jszip/main/documentation/api_jszip/generate_async.md), [ZipFileWorker source](https://raw.githubusercontent.com/Stuk/jszip/main/lib/generate/ZipFileWorker.js), [docx packer](https://github.com/dolanmiu/docx/blob/master/src/export/packer/packer.ts), [exceljs xlsx.js](https://github.com/exceljs/exceljs/blob/master/lib/xlsx/xlsx.js).

- **fflate is the lightest reusable codec if we want a tiny, tree-shakeable zip/deflate primitive.** It is pure JS, supports synchronous and asynchronous compression, streaming ZIP classes, and the README advertises ZIP support plus 4GB-file support. The source shows ZIP64 read support, but the write path does not emit ZIP64 EOCD / extra fields, so write-side ZIP64 is still a ceiling. This makes it a good low-level codec, but not a full OPC solution. Sources: [fflate README](https://raw.githubusercontent.com/101arrowz/fflate/master/README.md), [fflate src/index.ts](https://raw.githubusercontent.com/101arrowz/fflate/master/src/index.ts).

- **yauzl is the best unzip/read primitive when correctness and zip-slip defense matter.** Its README explicitly prioritizes spec-following central-directory reads, bounded memory, async APIs, and filename validation against `..`/absolute-path attacks. The implementation uses Node's native `zlib.createInflateRaw()`. It is read-only, so it is a good inspection/recovery primitive, not a writer. Sources: [yauzl README](https://raw.githubusercontent.com/thejoshwolfe/yauzl/master/README.md), [yauzl source](https://raw.githubusercontent.com/thejoshwolfe/yauzl/master/index.js).

- **yazl is the one surveyed writer with real ZIP64 write support.** It is the companion writer to yauzl, streams output, uses Node's native zlib deflate path, and documents `forceZip64Format` / automatic ZIP64 support where needed. Trade-off: it is low-level and manual, so all OOXML part bookkeeping is still our job. Source: [yazl README](https://raw.githubusercontent.com/thejoshwolfe/yazl/master/README.md), [yazl source](https://raw.githubusercontent.com/thejoshwolfe/yazl/master/index.js).

### OPC package handling

- **No mature generic Node OPC package library emerged as a clear dependency choice.** The only dedicated package found was `@tumblerjs/opc`, which is explicitly "extremely early alpha," browser-first, and depends on `saxes` + `fflate`. That makes it interesting as a design reference, but not as a safe runtime dependency. Sources: [npm registry metadata](https://registry.npmjs.org/@tumblerjs/opc/latest), [Microsoft OPC overview](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/opc/open-packaging-conventions-overview).

- **`@office-kit/pptx` is useful prior art, but it is much higher level than the low-level seam we want.** Its README shows a full PPTX authoring/editing library that mirrors PresentationML, preserves out-of-scope content, and covers templates, charts, notes, and animations. That is great evidence that a native OOXML model can be built in JS, but it is not a small OPC helper to drop into our stack. Source: [@office-kit/pptx README](https://raw.githubusercontent.com/office-kit/pptx/main/README.md).

### XML parsing / building

- **saxes is the strongest parser candidate for round-tripping OOXML.** It is a strict, evented SAX parser for XML 1.0/1.1 and namespaces, explicitly rejects malformed HTML/pseudo-XML, has no Stream API, and is designed to continue reporting errors after the first malformed construct. That makes it a good fit for parsing existing slide XML, theme XML, and unknown parts while preserving self-closing tags and order at the event level. Sources: [saxes README](https://raw.githubusercontent.com/lddubeau/saxes/master/README.md), [saxes source](https://raw.githubusercontent.com/lddubeau/saxes/master/src/saxes.ts).

- **fast-xml-parser is convenient for small JSON-shaped OOXML parts, but it is not the long-term core I would pick.** Its README advertises XML validation, parse/build round-tripping, preserved order, entities, and big-file support. The builder is in the middle of being split out into `fast-xml-builder`, which is a real dependency-stability risk. It is useful for `[Content_Types].xml`, `.rels`, or core/app properties, but it is a generic object mapper rather than an infoset-aware OOXML model. Sources: [fast-xml-parser README](https://raw.githubusercontent.com/NaturalIntelligence/fast-xml-parser/master/README.md), [XMLBuilder migration note](https://raw.githubusercontent.com/NaturalIntelligence/fast-xml-parser/master/docs/v4%2C%20v5/3.XMLBuilder.md), [fast-xml-builder docs](https://raw.githubusercontent.com/NaturalIntelligence/fast-xml-builder/main/docs/Builder_v1.md), [parse options](https://raw.githubusercontent.com/NaturalIntelligence/fast-xml-parser/master/docs/v4%2C%20v5/2.XMLparseOptions.md).

- **xmlbuilder2 is pleasant for authoring in-memory XML trees, but it is heavier than the fixed OOXML hot path probably needs.** Its API is a DOM4-style chainable builder with JS-object conversion and namespace support. That can be handy if we want a structured in-memory tree per part, but it is still a full tree builder, not a thin serializer. Source: [xmlbuilder2 README](https://raw.githubusercontent.com/oozcitak/xmlbuilder2/master/README.md), [namespace docs](https://oozcitak.github.io/xmlbuilder2/namespaces.html).

### EMU math

- **EMU math should stay inline, not become a dependency.** Existing OOXML emitters inline the constants rather than import a package; PptxGenJS defines the EMU constants directly in source. For this project, a tiny local constants module is the right answer. Source: [PptxGenJS core-enums.ts](https://raw.githubusercontent.com/gitbrent/PptxGenJS/master/src/core-enums.ts).

## 2) What PptxGenJS gets right and wrong

- **Right: it proves a handwritten OOXML emitter is viable.** Its internals build every package part as template strings, write them into JSZip by hand, and use a flat run-list text model rather than a general DOM. That is strong evidence that we do not need a generic XML builder to ship a correct PPTX writer. Sources: [PptxGenJS src/pptxgen.ts](https://github.com/gitbrent/PptxGenJS/blob/master/src/pptxgen.ts), [gen-xml.ts](https://github.com/gitbrent/PptxGenJS/blob/master/src/gen-xml.ts), [gen-utils.ts](https://github.com/gitbrent/PptxGenJS/blob/master/src/gen-utils.ts).

- **Right: its flat run model is directly relevant to HTML inline/block flattening.** The library models text as paragraph/run structures with options such as bullets, break lines, alignment, and hyperlinks, which is close to what an HTML-to-PPTX mapper needs once it flattens a DOM subtree into paragraph runs. Source: [gen-objects.ts](https://github.com/gitbrent/PptxGenJS/blob/master/src/gen-objects.ts), [gen-xml.ts](https://github.com/gitbrent/PptxGenJS/blob/master/src/gen-xml.ts).

- **Wrong for our stack if used directly: PptxGenJS is intentionally opinionated and incomplete for PowerPoint features.** Anthropic's current skill documents several footguns and gaps: colors must be bare 6-digit hex, letterSpacing is ignored, gradient fills are unsupported, shadow offsets must be non-negative, and some chart combinations can corrupt files. That is fine for a pragmatic generation library, but it is not the right abstraction boundary for our own emitter/parser. Source: [Anthropic pptx skill README](https://raw.githubusercontent.com/anthropics/skills/main/skills/pptx/SKILL.md).

- **Wrong for our use case: the old html2pptx route was too narrow and got retired.** Anthropic's PR 135 added an image-based workflow specifically because the existing html2pptx converter struggled with complex SVG diagrams, CSS gradients, and intricate flex/grid layouts. PR 947 later removed the legacy `html2pptx.tgz` dependency. Sources: [Anthropic PR 135](https://github.com/anthropics/skills/pull/135), [Anthropic PR 947](https://github.com/anthropics/skills/pull/947), [issue #531](https://github.com/anthropics/skills/issues/531).

## 3) html2pptx / HTML-to-PPTX prior art lessons

- **Anthropic's historical path showed the core trade-off clearly: browser-measurement + native objects vs. image fidelity.** The current skill has moved to PptxGenJS for new decks and direct OOXML editing for existing decks, while the PR history shows an explicit image-based fallback for the cases html2pptx could not faithfully model. Lesson: do not force everything through one mapping strategy; you need a native/editable path and a raster fallback path. Sources: [Anthropic pptx skill README](https://raw.githubusercontent.com/anthropics/skills/main/skills/pptx/SKILL.md), [PR 135](https://github.com/anthropics/skills/pull/135).

- **GX-Alex/html2pptx is a useful vector-fidelity reference, especially for SVG/charts.** Its README says it converts browser-rendered HTML/WebDeck into editable PPTX, using Chromium DOM/CSS/SVG extraction and an SVG-to-DrawingML converter. It keeps text editable, preserves rounded CSS boxes, rebuilds ECharts as SVG where possible, and inlines Font Awesome icons as SVG paths. Its limitations also show where the mapping still breaks: fixed 1280×720 single-viewport slides, complex layouts, and some CSS/background cases. Sources: [GX-Alex README](https://raw.githubusercontent.com/GX-Alex/html2pptx/main/README.md), [DOM extractor source](https://raw.githubusercontent.com/GX-Alex/html2pptx/main/skills/html2pptx/scripts/html_dom_to_editable_svg.js).

- **Design-Arena/html-to-pptx shows the more complete browser-measurement pattern.** It measures every DOM element in Playwright, maps text to editable textboxes, supports exact line-height/padding, converts linear gradients into native OOXML gradient fills, and explicitly documents what it cannot do (for example, external images, background-image URLs, animations, and some complex layouts). That is the clearest prior-art example of a browser-driven editable pipeline with a detailed feature matrix. Source: [html-to-pptx README](https://raw.githubusercontent.com/Design-Arena/html-to-pptx/main/README.md).

- **SlideSmith shows a pragmatic Node pipeline: browser layout + DOM traversal + PptxGenJS, with screenshots as the escape hatch.** It uses a local HTTP server, Playwright, a DOM-to-PPTX mapper, and PptxGenJS for output. It is explicit that editable conversion is the default and screenshots are the fallback for exotic CSS. Lesson: a hybrid output mode is not a compromise, it is a practical requirement if fidelity and editability both matter. Source: [SlideSmith README](https://raw.githubusercontent.com/AliceLJY/slidesmith/main/README.md).

## Recommendation

- **Default container stack:** use **JSZip** as the in-memory OPC container builder/editor.
- **Parsing existing OOXML / unknown parts:** use **saxes**.
- **Simple XML convenience for small parts only:** `fast-xml-parser` / `fast-xml-builder` is acceptable, but not as the core model.
- **Do not add a generic OPC dependency:** hand-roll the thin `[Content_Types].xml` + `.rels` bookkeeping.
- **Avoid a generic XML DOM builder for the hot path:** a handwritten serializer or a very thin tree-to-XML layer is a better fit for fixed OOXML.
- **Keep EMU math local:** 914400 EMU/in, 12700 EMU/pt, 9525 EMU/px at 96 dpi.
- **For HTML->PPTX mapping, keep two lanes:** a native/editable lane for text/shapes and a raster fallback lane for cases like complex SVG, gradients, and grid/flex layouts that prior art repeatedly fails to express faithfully.

## Open questions

- Do we need to support giant media assets or extremely large packages that would force genuine ZIP64 write support? If yes, the `yazl` path becomes important.
- Is byte-stable regeneration of an unchanged `.pptx` a requirement, or is "valid and functionally equivalent" enough?
- Do we want gradients to remain native/editable in the final deck? If yes, we will need direct OOXML `<a:gradFill>` emission rather than relying on PptxGenJS-style fill APIs or image fallbacks.
- Should group-shape preservation become a first-class mapping goal? None of the surveyed HTML-to-PPTX tools preserve DOM hierarchy as PowerPoint groups today.
