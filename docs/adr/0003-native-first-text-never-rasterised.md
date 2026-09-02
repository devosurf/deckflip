# Native first; text is never rasterised implicitly

Every construct with a DrawingML equivalent is emitted as an editable object, and a construct without one is rasterised only when the element carries no text: on a text-bearing element the unmappable effect is dropped (reported with a hint) and the text stays native. Authors opt into rasterised text explicitly with `data-raster`, never on a whole Slide. The trade is deliberate: pixel identity loses to editability, because the deliverable is a deck a human will keep editing in PowerPoint, and a screenshot-slide is the failure mode this tool exists to avoid.

## Consequences

- Every fallback and approximation is a Report entry with a hint; `--strict` turns any of them into exit 4.
- Some HTML renders differently in PowerPoint than in Chromium by design (dropped filters, radial-gradient approximation); `render` makes the difference visible.
