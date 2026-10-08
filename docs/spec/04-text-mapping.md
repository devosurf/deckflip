# Text box mapping

Decided in [#12](https://github.com/devosurf/deckflip/issues/12).

## Box

- Shape `a:xfrm` = the Text block's **border box** as measured by Chromium (`getBoundingClientRect` on the untransformed box; rotation goes to `@rot`). Fractional CSS px are converted exactly (`px * 9525`) and rounded to integer EMU; no tolerance is applied to position or size.
- If the element has a border of width `w`, the shape rectangle is deflated by `w/2` on each side so the DrawingML stroke (centred on the edge) covers exactly the CSS border area; insets below compensate.
- `a:bodyPr`: `wrap="square"` (`wrap="none"` for `white-space: nowrap|pre`), `anchor="t"` always (vertical position is already in the measured box), `a:noAutofit` always, `rtl="1"` when `direction: rtl`, `vert="horz"`.
- Insets: `lIns/rIns/tIns/bIns` = CSS `padding` on that side `+ w/2` `+` the first/last-paragraph margin fold (below); `tIns` additionally carries the **baseline correction**: `tIns -= B_pp - B_css`, where `B_css = (L - (A + D)) / 2 + A` is Chromium's first baseline below the line-box top (`A`/`D` = the first run's font `hhea` ascender/descender times the font size `f`, each rounded to whole px as Chromium does) and `B_pp = 0.7276 * L + 0.0539 * f + 0.87` px is where PowerPoint puts it under exact spacing. `B_pp` is a least-squares fit over 35 `(f, L)` pairs for each of Arial, Georgia, Times New Roman and Verdana against PowerPoint for Mac 16 (rms 1.07 px); it does not depend on the font's metrics. The spike's `L * asc / (asc + desc)` model (#8) was superseded by this calibration in milestone 1: it left 2.9 px rms.
- Wrap-width guard, both directions, calibrated against PowerPoint for Mac 16.115: PowerPoint's line widths stray from Chromium's by a pixel plus up to 0.12 px per em of line length either way (kerning is not the cause: PowerPoint kerns runs without a `kern` attribute, as Chromium does; the gap is per-glyph rounding, consistent in sign per font and size, so it grows with the line: measured over Arial, Courier New, Georgia, Times New Roman, Trebuchet MS and Verdana at 10-32 px). With tolerance `t = 1 + 0.12 * available width / font size` px, the guard is a change `g` of wrap width that leaves the widest line `t` of room (`g >= t - line slack`) while keeping the first word Chromium wraps `t` short of fitting (`g <= next fit - t`, the next fit found by re-laying the block out wider, to 1/64 of the search span); `0` when both hold already. `g` overshoots the bound it moves from by 0.5 px but never past the middle of the two, and is rounded away from zero to 1/32 px: the HTML a PPTX converts back to then measures as already guarded, on Chromium's layout grid, so a round trip emits the same insets. Insets absorb `g` on the trailing side (half each side when centred) when they can, else the shape widens (and shifts, so the text does not move); a shape that paints (fill, border, shadow) widens by at most 1 px, its guard capped there. When no `g` satisfies both bounds, or the cap cuts it, the block is flagged `LAYOUT_WRAP_RISK` (and the middle, or the cap, is emitted). Over 672 single- and two-line paragraphs in Arial, Georgia, Verdana and Times New Roman at 12-32 px with 0.25-3 px of slack either way, and 240 multi-line paragraphs at 14-24 px (9 flagged), PowerPoint broke every line where Chromium did; the previous fixed +/-1 px guard missed 33 of 336. The corpus fixture `text/wrap-guard` keeps that evidence against PowerPoint (spec 10). Text-bearing `roundRect`/`ellipse` shapes are emitted as a `custGeom` with a full text rectangle: the presets inset their text rectangle by the corner, which would change the wrap width.
- Line breaks are **natural** (PowerPoint wraps). No `a:br` is emitted for soft wraps; editability outranks pixel identity and the spike shows breaks match anyway. `br` elements and newlines in `pre` become `a:br`.

## Paragraphs

- One `a:p` per paragraph: the Text block itself, or each `li`, or each line-group in `pre`. Consecutive Text blocks are never merged (settled: one text box per HTML block).
- Mixed-content containers give each consecutive inline sequence before, between, or after block children its own native text body. Chromium measures its line-box top/bottom and available width without inserting layout wrappers; block children retain their own text bodies. Anonymous flex/grid items use their text extents and an out-of-flow font-metric probe, not additional layout items. Inline continuations retain their measured first-line offset. These text bodies do not duplicate the container's fill, border, or source identity. Source-identified multi-paragraph wrappers keep their existing single-shape mapping.
- `a:lnSpc` = `a:spcPts` from the measured line-box height of that paragraph (`round(px * 75)`), always; never `spcPct` (the spike measured a +6 px/line error with it). Mixed sizes inside a line are already inside the measured line box.
- `a:spcBef`/`a:spcAft` = `spcPts` from the measured gap between consecutive paragraphs in the same text body (li margins), always, `0` included. The first paragraph's top gap and the last paragraph's bottom gap are folded into `tIns`/`bIns` instead, so `spcFirstLastPara` is never needed and PowerPoint's edge rule cannot bite.
- `algn` from `text-align` (`l`, `ctr`, `r`, `just`; `start`/`end` resolved by direction). `indent` from `text-indent`.
- Tabs are not mapped (a literal tab is emitted as a tab character; PowerPoint uses default stops).
- Every paragraph states its marker: one the HTML paints none for writes `a:buNone`. Nothing measured is left for DrawingML to inherit, so a `p:ph` (spec 06 "Placeholders"), `p:bodyStyle`, `p:otherStyle` or `p:defaultTextStyle` can add neither a bullet nor a gap. On the way back, `a:buNone` reads as a plain paragraph, which is what it paints.

## Lists

- `ul`/`ol` -> paragraphs with `lvl` = nesting depth (0-8; deeper is `VALIDATE_LIST_CONTENT`).
- `marL` = measured distance from the text body's inner left edge to the `li` content-box left edge. `indent` = `-(marker advance)`, where marker advance is the measured width of the marker string (`"• "` etc.) in the `li`'s font, so the bullet sits where CSS `list-style-position: outside` paints it. The list's own left padding is part of `marL`, not `lIns`, so `marL + indent` never goes negative (PowerPoint clamps a bullet left of the inset). `list-style-position: inside` puts the marker in the first line, which a hanging indent cannot express: `marL` = measured text start, `indent = -(text start - li content left)`, so bullet and first line match Chromium and only wrapped lines shift right by the marker width.
- `list-style-type`: `disc`->`a:buChar "•"`, `circle`->`"◦"`, `square`->`"▪"`, `none`->`a:buNone`, `decimal`->`a:buAutoNum arabicPeriod`, `lower-alpha`->`alphaLcPeriod`, `upper-alpha`->`alphaUcPeriod`, `lower-roman`->`romanLcPeriod`, `upper-roman`->`romanUcPeriod`; `ol[start]`->`startAt` on every item of that list (PowerPoint continues a sequence only across paragraphs with the same `startAt`; the attribute is omitted when 1); `ol[reversed]` and other types -> `decimal` with `SUBSTITUTE_LIST_STYLE` info. Marker colour/size follow the `::marker` computed `color`/`font-size` (`a:buClr`, `a:buSzPct`); marker font is the run font (`a:buFontTx`).
- A `p` inside `li` contributes its inline content to that `li`'s paragraph; `li` margins give `spcBef/spcAft`.

## Runs

Inline elements flatten to `a:r` runs with `a:rPr` from computed style:

| CSS / element | rPr |
| --- | --- |
| `font-size` | `sz = round(px * 75)` (hundredths of pt) |
| `font-family` | `a:latin typeface` = the **resolved family** (#15); `a:ea`/`a:cs` same |
| `font-weight >= 600` / `b`, `strong` | `b="1"` (no intermediate weights: `SUBSTITUTE_FONT_WEIGHT` info when the weight is not 400/700 and the family has no matching face) |
| `font-style: italic|oblique` | `i="1"` |
| `text-decoration: underline` / `u` | `u="sng"` |
| `text-decoration: line-through` / `s`, `del` | `strike="sngStrike"` |
| `color` | `a:solidFill` with `a:alpha` |
| `letter-spacing` | `spc = round(px * 75)` |
| `text-transform: uppercase` | text is upper-cased in the run (PowerPoint `cap="all"` is not used: it renders differently across versions) |
| `text-transform: capitalize|lowercase` | applied to the text |
| `font-variant: small-caps` | `cap="small"` |
| `sup` / `sub` / `vertical-align: super|sub` | `baseline="30000"` / `"-25000"` |
| `mark` / inline `background-color` | `a:highlight` |
| `text-shadow` single | `a:effectLst/a:outerShdw` on the run |
| `a[href]` | `a:hlinkClick` (external rel or `hlinksldjump`) |
| `code`, `kbd` | only the font family they compute to |

Text content is the rendered text: whitespace collapsed per `white-space`, soft hyphens removed, `&nbsp;` preserved as U+00A0, `xml:space="preserve"` on every `a:t`. Emoji and non-Latin scripts are passed through; the font slot is the resolved family, PowerPoint substitutes per script.
Hidden subtrees (`display: none`, `visibility: hidden`, and speaker notes) contribute no Slide text runs or line metrics, including inside otherwise visible Text blocks.

Any text-affecting CSS not in the table is flattened with a `FLATTEN_TEXT_*` warning (`-webkit-text-stroke`, `background-clip: text`, `text-decoration-style` other than solid, `font-variant-*` other than small-caps, `text-shadow` with multiple shadows -> first kept).

## Tables

`table` -> `a:tbl` in a `p:graphicFrame`: columns from measured cell widths of the first row (`a:gridCol`), rows from measured heights, `gridSpan`/`rowSpan`/`vMerge`/`hMerge` from `colspan`/`rowspan`, per-cell `lnL/lnR/lnT/lnB` from cell borders (collapsed model measured per edge), cell fill from cell then row background, cell insets from cell padding, `anchor` from `vertical-align`. Cell content follows the run rules above; a cell containing block elements other than `p`/`ul`/`ol` is `VALIDATE_TABLE_CONTENT` (error). `caption` is emitted as a separate text box.

## When a Text block is not native

Never implicitly. `data-raster` on it or an ancestor rasterises it (#13); the rejected properties in #11 stop conversion before this point.

## Known residuals (documented in the spec, not decisions)

- PowerPoint on Windows may place the exact-spacing baseline and lay line widths out differently from the Mac calibrations above. Windows recalibration (the same `(f, L)` grid and the wrap grid, `scripts/`-style ink-row comparison) is deferred until Windows support resumes under the [supported-host policy](10-rendering-and-verification.md#supported-host); it is not a current build-phase acceptance check.
- Justified text distributes space differently; breaks are unaffected.
- LibreOffice restarts an `a:buAutoNum` sequence on every paragraph that carries an explicit `startAt`, so an `ol[start]` list renders as `3. 3. 3.` there while PowerPoint renders `3. 4. 5.`; LibreOffice is no longer a gate ([ADR 0007](../adr/0007-verification-and-powerpoint-oracle.md)).
