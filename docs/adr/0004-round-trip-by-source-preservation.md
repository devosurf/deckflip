# Round trip preserves the source package and splices untouched parts

PPTX -> HTML keeps the original `.pptx` verbatim inside the Deck's asset directory together with a manifest of per-element fingerprints; HTML -> PPTX re-emits from HTML only what the fingerprints show was touched and copies every untouched shape, Slide, master, chart, animation and extension byte-for-byte from the source. This is what makes "lossless" true for content HTML cannot represent (charts, SmartArt, VBA, timing, `extLst`) without inventing an HTML encoding for every OOXML feature. The alternatives (embedding XML blobs in `data-*` attributes, or a full HTML model of every feature) were rejected as unreadable for agents and unbounded in scope respectively.

## Consequences

- Deleting the asset directory turns a round trip into a from-scratch conversion (`PRESERVE_SOURCE_MISSING`).
- Opaque elements are editable only as a whole (move, resize, delete); content edits inside them are dropped with a warning.
- The output archive is part-identical, not byte-identical, to the source: JSZip does not guarantee byte-stable containers.
