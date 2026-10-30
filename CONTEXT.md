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
The record of everything a conversion flattened, rasterised, substituted or dropped, and why; also its Layout flags, Verification errors and the Resolved fonts it selected.
_Avoid_: Log, warnings, diagnostics

**Report entry**:
One item in the Conversion report: a stable code, what happened (rasterised, flattened, substituted, dropped, overridden, flagged, error), where on which Slide, why, and a hint for making it native.
_Avoid_: Warning, issue, finding

**Layout flag**:
A Report entry (kind `flagged`) for something converted faithfully that an author rarely intends: text spilling out of its box, text over text, illegible text, a line PowerPoint may break elsewhere.
_Avoid_: Lint, layout warning, smell

**Verification**:
The comparison, after a conversion writes its output, of what the source shows with what the output contains: Visible text, speaker notes, element geometry and stacking. A mismatch is a deckflip defect, never an authoring choice.
_Avoid_: Validation (that is the authoring check before conversion), self-test, check

**Visible text**:
The text Chromium lays out on a Slide, read independently of the measurement walk; hidden subtrees, speaker notes, Rasterised elements, Opaque elements, generated content and text wholly off the Canvas excluded.
_Avoid_: Rendered text, DOM text, content

**Census**:
Chromium's own read of a rendered Slide for Verification: its Visible text, its speaker notes and how it stacks overlapping Painting elements, taken by a walk independent of the measurement so that one cannot hide what the other lost.
_Avoid_: Snapshot, scan, inventory

**PowerPoint oracle**:
The committed PowerPoint renders of a corpus fixture, with the Oracle record of the package they were rendered from; what the corpus gates compare Chromium against.
_Avoid_: Reference images, golden PNGs

**Oracle record**:
The `expected/oracle.json` of a corpus fixture: the digest of the emitted package and the PowerPoint version behind its PowerPoint oracle. Output whose digest differs needs a new PowerPoint run.
_Avoid_: Golden hash, snapshot

**Strict mode**:
A conversion or validation run that treats Report entries at or above a selected severity as a failure (`info`, `warning` or `error`; bare Strict mode selects `info`, meaning any entry). All entries remain in the Conversion report, and successful conversion output remains available for nonfatal entries. Validation errors prevent conversion regardless of threshold, and Verification errors fail the conversion (exit 5) regardless of threshold.
_Avoid_: Fail-on-warning, pedantic mode

**Deck file**:
The HTML document that declares a Deck: its meta and its Slides, inline or by reference.
_Avoid_: Index, entry point, manifest

**Slide document**:
A self-contained HTML document holding exactly one Slide, referenced from a Deck file in the per-file form.
_Avoid_: Slide file, fragment, partial

**Asset directory**:
The `<name>.assets/` directory next to a Deck file holding its media, fonts, Pinned font sources, previews, Manifest and, after PPTX->HTML, the source package.
_Avoid_: Output folder, resources, attachments

**Pinned font source**:
A downloaded stylesheet or font file a Deck's CSS refers to, frozen in its Asset directory so every later conversion measures the same bytes without the network.
_Avoid_: Cache, lock file, vendored font

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
The selected font asset and face for a text run, together with its CSS match, Office font identity and where the asset's bytes came from. A Resolved font identifies a face, not proof of embedding, glyph fallback or fidelity.
_Avoid_: Effective font, fallback font, used font

**CSS font alias**:
A family name used to match authored text to a selected face; it may be a declared webfont name, a preferred family or a legacy family. It need not be the name written into the PPTX.
_Avoid_: Export family

**Selected font face**:
The exact font asset and member face selected for a text run, distinct from its CSS font aliases and Office font identity.
_Avoid_: Font name

**Office font identity**:
The legacy family and regular, bold, italic or bold-italic style-linking position that PowerPoint uses to address a selected face.
_Avoid_: CSS weight, preferred family

**Bundled default**:
A font supplied with deckflip for text that inherits no authored family. Its exact faces make authoring independent of installed fonts and are embedded by default for portable, editable output.
_Avoid_: Safe default, platform default, fallback font
