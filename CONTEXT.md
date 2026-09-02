# ppt-html-cli

Bidirectional converter between HTML slides and PowerPoint (PPTX), operated primarily by coding agents through a CLI and a skill, so agents can author decks in HTML and deliver editable, faithful PowerPoint files.

## Language

**Deck**:
A whole presentation, on either side of the conversion: one PPTX file, or one set of HTML slides.
_Avoid_: Presentation, document, file

**Slide**:
One page of a Deck. On the HTML side, one Slide occupies exactly one Canvas.
_Avoid_: Page, screen, section

**Canvas**:
The fixed-size, fixed-aspect authoring viewport an HTML Slide is laid out in, matching a PowerPoint slide size (16:9 by default).
_Avoid_: Viewport, frame, artboard

**Native element**:
A Slide element emitted as a real, editable PowerPoint object (text box, shape, picture, table).
_Avoid_: Editable object, vector element

**Rasterised element**:
A Slide element emitted as a picture because PowerPoint cannot express it faithfully. Not editable.
_Avoid_: Screenshot, image fallback, bitmap

**Flatten**:
Replacing an animation, transition, or unsupported construct with a static equivalent on the Slide.
_Avoid_: Degrade, strip, simplify

**Conversion report**:
The record of everything a conversion flattened or rasterised, and why.
_Avoid_: Log, warnings, diagnostics
