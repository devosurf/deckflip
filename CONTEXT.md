# deckflip

Bidirectional converter between HTML slides and PowerPoint (PPTX), operated primarily by coding agents through a CLI (`deckflip`) and a skill, so agents can author decks in HTML and deliver editable, faithful PowerPoint files.

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

**Report entry**:
One item in the Conversion report: a stable code, what happened (rasterised, flattened, substituted, dropped, overridden, error), where on which Slide, why, and a hint for making it native.
_Avoid_: Warning, issue, finding

**Strict mode**:
A conversion run that treats any Report entry as a failure while still producing the output and the report.
_Avoid_: Fail-on-warning, pedantic mode

**Deck file**:
The HTML document that declares a Deck: its meta and its Slides, inline or by reference.
_Avoid_: Index, entry point, manifest

**Slide document**:
A self-contained HTML document holding exactly one Slide, referenced from a Deck file in the per-file form.
_Avoid_: Slide file, fragment, partial

**Asset directory**:
The `<name>.assets/` directory next to a Deck file holding its media, fonts, previews, Manifest and, after PPTX->HTML, the source package.
_Avoid_: Output folder, resources, attachments

**Text block**:
The lowest block-level element whose rendered content is inline, or a list or table cell; the unit that becomes one text body.
_Avoid_: Text box (that is the PowerPoint side), paragraph container

**Painting element**:
An element that emits a shape because it has visible fill, border, shadow, image or text; layout-only wrappers are not Painting elements.
_Avoid_: Visible element, shape element

**Opaque element**:
PPTX content shown in HTML as a positioned box whose geometry, but not content, may be edited; re-emitted from the source package.
_Avoid_: Blob, placeholder box, locked element

**Manifest**:
The `deckflip.json` record in the Asset directory that ties HTML elements to their source parts by Fingerprint.
_Avoid_: Sidecar, index, mapping file

**Fingerprint**:
The hash of an element's canonical serialisation, used to decide whether it is Untouched.
_Avoid_: Hash, checksum, digest

**Untouched**:
An element or Slide whose Fingerprint still matches the Manifest, so its original OOXML is re-emitted verbatim.
_Avoid_: Unchanged, pristine, clean

**Resolved font**:
The first family in a `font-family` stack that Chromium could actually use on the authoring machine; the name written into the PPTX.
_Avoid_: Effective font, fallback font, used font

**Safe font**:
A family present on every supported PowerPoint installation on Windows and macOS, so it needs no embedding.
_Avoid_: Web-safe font, system font, standard font
