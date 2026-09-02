# Layout is measured in headless Chromium, never computed by the tool

deckflip is a Node/TypeScript CLI that does not implement any CSS layout: every box, line box and marker width comes from a pinned Chromium build driven by Playwright, and the emitter only converts measured CSS px to EMU. This lets authors use any CSS layout (flex, grid, floats) and keeps text wrapping identical to what the author saw, at the cost of a ~150 MB browser dependency and a hard requirement that the authoring machine can run it. The alternatives (a custom layout engine, or a component vocabulary with tool-owned layout) were rejected because they cap what agents can express and would never match Chromium's line breaking.

## Consequences

- The Chromium revision is pinned per deckflip version and recorded in the report; system browsers are used only via `--browser`.
- Layout-dependent tests need the browser; unit tests cover only the px -> EMU and mapping math.
