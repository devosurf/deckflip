# Characterise PowerPoint text layout vs Chromium

## Question

How does PowerPoint break lines and space text (line spacing model, paragraph spacing, box insets, autofit modes, font metric source, wrap rules) and where does it diverge from Chromium for the same font/size/width? What box sizing tolerance keeps wrapping identical in practice?

## Findings

### 1) PowerPoint text is a text body inside `a:bodyPr`, not a CSS block box

- `p:txBody` always starts with `a:bodyPr`; that body-level element carries the text-box layout knobs: wrapping, vertical anchor, internal margins/insets, and the autofit choice. The Open XML SDK reference for `BodyProperties` lists `wrap`, `anchor`, `lIns`, `rIns`, `tIns`, `bIns`, and the three autofit children `noAutofit`, `normAutofit`, and `spAutoFit`. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties?view=openxml-3.0.1>
- Wrap is body-level. `wrap="square"` is the implied default and means wrap within the bounding text box; `wrap="none"` disables automatic wrapping. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.wrap?view=openxml-3.0.1>
- Insets are internal margins, not external margins. `lIns`/`rIns` default to `91440` EMU (`0.1in`) when omitted; `tIns`/`bIns` default to `45720` EMU (`0.05in`) when omitted. PowerPoint’s support docs describe these as the distance between the shape border and the text. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.leftinset?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.topinset?view=openxml-3.0.1> <https://support.microsoft.com/en-au/office/set-text-direction-and-position-in-a-shape-or-text-box-in-powerpoint-64d887b8-91b2-4293-8104-9d4a92a10fc8>
- Two body-level flags are worth keeping in mind even though they are not the main mapping target here: `compatLnSpc` (`CompatibleLineSpacing`) says line spacing is decided in a simplistic manner using the font scene, and `spcFirstLastPara` (`UseParagraphSpacing`) controls whether the first and last paragraphs respect before/after spacing at the text-body edges. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.compatiblelinespacing?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.useparagraphspacing?view=openxml-3.0.1>

### 2) PowerPoint line spacing lives on the paragraph, not the box

- `a:lnSpc` in paragraph properties (`a:pPr`) chooses one of two representations: `a:spcPct` or `a:spcPts`. If `lnSpc` is omitted, the spacing between two lines is determined by the point size of the largest piece of text within the line. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.linespacing?view=openxml-3.0.1>
- `a:spcPct` is percentage-based spacing. The Open XML SDK page describes it as spacing percent; the underlying OOXML value is thousandths of a percent, so `100000` = 100%, `120000` = 120%, etc. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.textspacingtype.spacingpercent?view=openxml-3.0.1>
- `a:spcPts` is absolute spacing in hundredths of a point. The SDK docs give `1200 = 12pt`, `1250 = 12.5pt`, `1400 = 14pt`. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.spacingpoints?view=openxml-3.0.1>
- Paragraph before/after spacing uses the same `spcPct` / `spcPts` value model via `a:spcBef` and `a:spcAft`. PowerPoint’s UI exposes these separately from line spacing, and the support doc explicitly distinguishes “Before”/“After” from line spacing. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.spacebefore?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.spaceafter?view=openxml-3.0.1> <https://support.microsoft.com/en-us/powerpoint/change-text-alignment-indentation-and-spacing-in-powerpoint>
- `spcFirstLastPara="0"` suppresses the paragraph-spacing effect on the edges of the text body; that is a PowerPoint-specific edge rule you do not get from a generic CSS box model. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.useparagraphspacing?view=openxml-3.0.1>

### 3) PowerPoint autofit is a body-level mode switch, not a CSS overflow rule

- The three body-level autofit modes are mutually exclusive: `noAutofit`, `normAutofit`, and `spAutoFit`. The class docs show all three as valid `bodyPr` children. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties?view=openxml-3.0.1>
- `noAutofit` means the text keeps its nominal size even if it exceeds the shape. In the UI this corresponds to “Do not AutoFit”. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.noautofit?view=openxml-3.0.1> <https://support.microsoft.com/en-us/office/graphics-visuals/format-object-text-box-pane>
- `normAutofit` scales every run via `fontScale`, and may also reduce percentage-based line spacing via `lnSpcReduction`. The important edge case: `lnSpcReduction` applies only when line spacing is percentage-based; it does not apply to `spcPts`. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.normalautofit?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.normalautofit.fontscale?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.normalautofit.linespacereduction?view=openxml-3.0.1>
- `spAutoFit` resizes the shape to fit the text. In the UI this is “Resize shape to fit text”. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.shapeautofit?view=openxml-3.0.1> <https://support.microsoft.com/en-us/office/graphics-visuals/format-object-text-box-pane>
- PowerPoint’s own support docs confirm the practical UI split: “Shrink text on overflow” reduces font size, “Resize shape to fit text” grows the shape, and placeholder AutoFit may reduce both line spacing and font size to force items to fit. <https://support.microsoft.com/en-us/powerpoint/change-text-alignment-indentation-and-spacing-in-powerpoint> <https://support.microsoft.com/en-us/office/graphics-visuals/format-object-text-box-pane>

### 4) PowerPoint stores font names, not font metrics

- DrawingML run properties (`a:rPr`) and font slots such as `a:latin` store the font family/typeface and other selection hints. They do not store ascent, descent, line gap, or glyph-bounding metrics. `RunProperties` and `LatinFont` are just the XML wrappers around those names. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.runproperties?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.latinfont?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/e6784cb7-1547-4ee5-addc-730cac8b4d00>
- Microsoft’s Open Specification note for `latin` says Office uses the font’s `typeface` attribute when available and falls back to substitution when it is not. That is enough to identify the face, but not enough to derive layout metrics from OOXML alone. <https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/e6784cb7-1547-4ee5-addc-730cac8b4d00>
- The actual metric source is the font file plus the platform text engine. Microsoft’s DirectWrite docs define `DWRITE_FONT_METRICS` as the metrics applicable to all glyphs in the font face, and define recommended baseline-to-baseline spacing as `ascent + descent + lineGap`. OpenType’s `OS/2` table exposes the typographic metrics (`sTypoAscender`, `sTypoDescender`, `sTypoLineGap`) that CSS recommends for line-height calculations. <https://learn.microsoft.com/en-us/windows/win32/api/dwrite/ns-dwrite-dwrite_font_metrics> <https://learn.microsoft.com/en-us/typography/opentype/spec/os2>

### 5) Chromium uses the CSS line box model, which is not PowerPoint’s text-box model

- CSS `line-height` controls line-box height. CSS2.1 says a block container’s `line-height` sets the minimal height of line boxes, and the line box height is the distance between the uppermost box top and lowermost box bottom. CSS2.1 also says the strut uses the element’s first available font, and that OpenType/TrueType implementations should use OS/2 `sTypoAscender`/`sTypoDescender` and fall back to HHEA ascent/descent. <https://www.w3.org/TR/CSS2/visudet.html#line-height>
- Chromium’s Blink code follows that model directly. `font_height.h` literally comments that it is implementing CSS2 line-height/leading, with `LineHeight() = ascent + descent`, and `font_metrics.h` keeps per-font ascent, descent, line gap, cap height, x-height, etc. <https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/fonts/font_height.h> <https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/fonts/font_metrics.h>
- Blink also resolves fonts through OS-specific backends (`font_cache_mac.mm`, `font_cache_linux.cc`, `font_cache_skia.cc`, etc.), so the actual glyph metrics vary by platform even though the layout math is shared. That is a real source of divergence against PowerPoint’s own renderer. <https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/fonts/README.md>
- CSS width/height use the box model: content width is separate from padding/border/margin, and `line-height` affects vertical line-box size rather than wrapping width. The CSS2.1 width algorithm subtracts padding/border/margins from the containing block, and the line-height section makes clear that padding/border/margins on inline boxes do not change the line box height calculation. <https://www.w3.org/TR/CSS2/visudet.html>
- For wrapping, Chromium follows CSS text layout and Unicode line-breaking opportunities. Long unbreakable strings only break when CSS permits it (`overflow-wrap`, `word-break`, `white-space`, etc.); line-height itself does not change where wrap opportunities occur. <https://www.w3.org/TR/css-text-3/> <https://www.unicode.org/reports/tr14/>

### 6) The practical divergence points are box edges and metric sources

- PowerPoint’s text box is the outer shape minus the body insets. Chromium’s text area is the content box minus padding and border. Those are close in spirit, but not the same model; PowerPoint has no separate CSS border/margin layers, and the insets are fixed internal margins attached to `bodyPr`. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.leftinset?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.bodyproperties.topinset?view=openxml-3.0.1> <https://www.w3.org/TR/CSS2/box.html>
- PowerPoint paragraph spacing is explicit OOXML paragraph state. Chromium line-height is inline layout state. That means “same font size and same nominal width” is not enough to guarantee identical line breaks if one side subtracts insets/leading differently or picks different font metrics. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.linespacing?view=openxml-3.0.1> <https://www.w3.org/TR/CSS2/visudet.html#line-height>
- The OOXML spec is explicit about units and defaults, but it does not define a single universal font-metric algorithm for turning a font name into a line box. That is why the same deck can wrap differently in PowerPoint and Chromium even with byte-identical XML and the same typeface name. <https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.runproperties?view=openxml-3.0.1> <https://learn.microsoft.com/en-us/windows/win32/api/dwrite/ns-dwrite-dwrite_font_metrics> <https://www.w3.org/TR/CSS2/visudet.html#line-height>

### 7) Empirical Chromium wrap sensitivity

- Local headless Chromium measurement on this machine, using `24px Arial` and the sentence `The quick brown fox jumps over the lazy dog to test wrap sensitivity.`, showed wrap flips at very small width deltas:
  - 5 lines at `196.0px`, then 4 lines at `196.1px`.
  - 4 lines at `253.4px`, then 3 lines at `253.5px`.
- That means a subpixel change in available inline width can change the break result. For wrap preservation, width tolerance must therefore be much smaller than a line-break step, not a generic “close enough” box-size slack.

## Recommendation

- Treat the PowerPoint text body as a fixed outer shape with internal insets, not as a generic CSS block.
- Map CSS `padding` to `a:bodyPr` insets (`lIns`/`rIns`/`tIns`/`bIns`) using the project’s EMU conversion (`1 CSS px = 9525 EMU`), and compute wrap width from the outer shape minus those insets.
- Map CSS `line-height` to OOXML paragraph spacing like this:
  - unitless number or percentage → `a:spcPct` (`val = round(lineHeight * 100000)`; e.g. `1.2` → `120000`).
  - absolute length → `a:spcPts` (`val = round(usedPoints * 100)`; if the input is CSS px, convert with `1px = 0.75pt`, so `val = round(px * 75)`).
- For `line-height: normal`, do not invent a fake fixed multiplier. Either omit `lnSpc` and let PowerPoint use its own font-driven default, or measure the actual Chromium line box and serialize that measured result explicitly if the goal is exact visual parity.
- Use `noAutofit` for faithful fixed-size text boxes; use `spAutoFit` only when the shape is supposed to grow; avoid `normAutofit` unless you intentionally want PowerPoint to mutate the typography to make text fit.
- For wrap comparisons, use a practical tolerance of about `±0.5 CSS px` on the available inline width, which is about `±4763 EMU`. That is small enough to avoid changing break results in the measured Chromium cases above, while still being realistic about fractional layout and screenshot rounding.

## Open questions

- Which font metrics PowerPoint uses on each platform when it computes its default line spacing is not publicly specified in Microsoft’s docs. The spec and docs tell us the inputs and units, but not the exact line-box algorithm.
- Whether `compatLnSpc` should ever be emitted to mimic a specific PowerPoint legacy mode is unresolved. It is documented as a simplistic font-scene line-spacing mode, but the project has not yet chosen whether to use it.
- Whether `spcFirstLastPara` should be enabled for all generated shapes, or only for specific paragraph corpora that need edge spacing suppression, remains a policy choice.
- The empirical `±0.5px` tolerance should be rechecked against the actual slide corpus used for regression, because wrap thresholds are font- and text-dependent.
