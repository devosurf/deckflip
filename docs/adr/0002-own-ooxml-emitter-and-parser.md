# deckflip owns its OOXML emitter and parser

PresentationML/DrawingML is written and read by deckflip's own code over a thin container (JSZip) and a strict SAX parser (saxes); PptxGenJS, python-pptx and other generators are not used. Round-trip preservation needs part-level control (splicing untouched source XML back into a new package) and native fidelity needs direct access to `bodyPr`, `spcPts`, `custGeom`, `gradFill`, embedded fonts and extension lists that generator libraries hide or get wrong. The cost is owning the serializer, `[Content_Types].xml` and `.rels` bookkeeping, and the inheritance resolution on the parse side.

## Considered options

- PptxGenJS: proven emitter, but no parser, no gradient fills, ignores letter spacing, cannot preserve foreign parts.
- `@office-kit/pptx`: high-level model, alpha maturity, would put a third-party object model between the IDM and the XML.
