# Text box mapping

Decided in [#12](https://github.com/devosurf/deckflip/issues/12).

## Box

- Shape `a:xfrm` = the Text block's **border box** as measured by Chromium (`getBoundingClientRect` on the untransformed box; rotation goes to `@rot`). Fractional CSS px are converted exactly (`px * 9525`) and rounded to integer EMU; no tolerance is applied to position or size.
- If the element has a border of width `w`, the shape rectangle is deflated by `w/2` on each side so the DrawingML stroke (centred on the edge) covers exactly the CSS border area; insets below compensate.
- `a:bodyPr`: `wrap="square"` (`wrap="none"` for `white-space: nowrap|pre`), `anchor="t"` always (vertical position is already in the measured box), `a:noAutofit` always, `rtl="1"` when `direction: rtl`, `vert="horz"`.
- Insets: `lIns/rIns/tIns/bIns` = CSS `padding` on that side `+ w/2` `+` the first/last-paragraph margin fold (below); `tIns` additionally carries the **baseline correction** from the spike: `((asc - desc) / 2) * (L / (asc + desc) - f)` where `L` is the first line's measured line-box height, `f` the font size, `asc`/`desc` the first run's font `hhea` ascender/descender in em units, read from the resolved font file (#15). Emitted with the sign that moves the first baseline to where Chromium put it.
- Wrap-width guard (the +/-0.5 px tolerance from #4): for each measured line, if `available width - line ink width < 0.5 px`, the box is widened by 1 px on the trailing side (0.5 px each side for centred text) with insets unchanged. The visual shift is at most 0.5 px; the guard removes the case where sub-pixel glyph-advance differences would produce a different break in PowerPoint.
- Line breaks are **natural** (PowerPoint wraps). No `a:br` is emitted for soft wraps; editability outranks pixel identity and the spike shows breaks match anyway. `br` elements and newlines in `pre` become `a:br`.

## Paragraphs

- One `a:p` per paragraph: the Text block itself, or each `li`, or each line-group in `pre`. Consecutive Text blocks are never merged (settled: one text box per HTML block).
- `a:lnSpc` = `a:spcPts` from the measured line-box height of that paragraph (`round(px * 75)`), always; never `spcPct` (the spike measured a +6 px/line error with it). Mixed sizes inside a line are already inside the measured line box.
- `a:spcBef`/`a:spcAft` = `spcPts` from the measured gap between consecutive paragraphs in the same text body (li margins). The first paragraph's top gap and the last paragraph's bottom gap are folded into `tIns`/`bIns` instead, so `spcFirstLastPara` is never needed and PowerPoint's edge rule cannot bite.
- `algn` from `text-align` (`l`, `ctr`, `r`, `just`; `start`/`end` resolved by direction). `indent` from `text-indent`.
- Tabs are not mapped (a literal tab is emitted as a tab character; PowerPoint uses default stops).

## Lists

- `ul`/`ol` -> paragraphs with `lvl` = nesting depth (0-8; deeper is `VALIDATE_LIST_CONTENT`).
- `marL` = measured distance from the text body's inner left edge to the `li` content-box left edge. `indent` = `-(marker advance)`, where marker advance is the measured width of the marker string (`"• "` etc.) in the `li`'s font, so the bullet sits where CSS `list-style-position: outside` paints it. `list-style-position: inside` puts the marker in the first line: `indent = -(text start - li content left)`, measured.
- `list-style-type`: `disc`->`a:buChar "•"`, `circle`->`"◦"`, `square`->`"▪"`, `none`->`a:buNone`, `decimal`->`a:buAutoNum arabicPeriod`, `lower-alpha`->`alphaLcPeriod`, `upper-alpha`->`alphaUcPeriod`, `lower-roman`->`romanLcPeriod`, `upper-roman`->`romanUcPeriod`; `ol[start]`->`startAt`; `ol[reversed]` and other types -> `decimal` with `SUBSTITUTE_LIST_STYLE` info. Marker colour/size follow the `::marker` computed `color`/`font-size` (`a:buClr`, `a:buSzPct`); marker font is the run font (`a:buFontTx`).
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

Any text-affecting CSS not in the table is flattened with a `FLATTEN_TEXT_*` warning (`-webkit-text-stroke`, `background-clip: text`, `text-decoration-style` other than solid, `font-variant-*` other than small-caps, `text-shadow` with multiple shadows -> first kept).

## Tables

`table` -> `a:tbl` in a `p:graphicFrame`: columns from measured cell widths of the first row (`a:gridCol`), rows from measured heights, `gridSpan`/`rowSpan`/`vMerge`/`hMerge` from `colspan`/`rowspan`, per-cell `lnL/lnR/lnT/lnB` from cell borders (collapsed model measured per edge), cell fill from cell then row background, cell insets from cell padding, `anchor` from `vertical-align`. Cell content follows the run rules above; a cell containing block elements other than `p`/`ul`/`ol` is `VALIDATE_TABLE_CONTENT` (error). `caption` is emitted as a separate text box.

## When a Text block is not native

Never implicitly. `data-raster` on it or an ancestor rasterises it (#13); the rejected properties in #11 stop conversion before this point.

## Known residuals (documented in the spec, not decisions)

- PowerPoint on Windows may read `OS/2` win metrics rather than `hhea` for the natural line; the correction uses `hhea` (matched on Mac in the spike). Calibration against the corpus on Windows is a build-phase acceptance check.
- Justified text distributes space differently; breaks are unaffected.
