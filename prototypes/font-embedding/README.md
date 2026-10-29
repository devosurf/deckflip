# Font embedding in PowerPoint for Mac (#33)

Observed compatibility of embedded fonts in a supported PowerPoint for Mac with
the source fonts unavailable. Machine-readable evidence:
[`results/observations.json`](results/observations.json); generated-case
inventory: [`results/cases.json`](results/cases.json).

## Host

| Item | Value |
| --- | --- |
| PowerPoint | Microsoft PowerPoint for Mac 16.114.2 (16.114.26102345), Microsoft 365 |
| macOS | 26.7 (25G229), arm64, separate QA Mac |
| Driving | CuaDriver 0.37.0 (GUI typing, dialogs) and AppleScript (open, save, PDF) |
| Chromium | 151.0.7922.34 via playwright-core 1.62.1 |
| Fonts | unmodified pinned Heebo 3.100 and Source Sans 3 3.052R ([manifest](../../fixtures/corpus/fonts/_assets/manifest.json)); extra inputs pinned in [`sources.json`](sources.json) |

### Isolation

The seven pinned faces, installed on the QA user for #32, were moved out of every
font directory and restored afterwards with verified SHA-256. `NSFontManager`
reported no Heebo or Source Sans face during the run.

Office cloud fonts are a second font source. The catalog on this host lists
Heebo (not Source Sans 3). With local fonts removed, PowerPoint downloaded cloud
Heebo even with `OfficeExperiencesDownloadingContentPreference=FALSE`. Isolation
needed both `com.microsoft.office ConnectedOfficeExperiencesPreference=FALSE` and
a read-only `~/Library/Group Containers/UBF8T346G9.Office/FontCache/4/CloudFonts`.
A control Deck without embedded fonts rendered every box in Calibri before and
after all cases. PowerPoint was relaunched between cases and between save and
reopen. All QA settings were restored afterwards.

### Procedure per case

1. Open a probe copy; screenshot; export PDF (AppleScript).
2. Open a fresh work copy; type characters absent from the Slide at the end of
   every box (`0123456789 QWZ ÅÄÖ éñ€ß` plus Hebrew for Heebo, Greek/Cyrillic
   for Source Sans 3) with real keystrokes; save in place.
3. Quit, relaunch, reopen the saved copy; screenshot; export PDF.
4. Inspect the saved package (`inspect-pptx.mjs`) and identify every PDF font
   by glyph outlines (`pdf-face-match.py`).

PowerPoint names fonts rendered from embedded payloads `1`, `2`, … in its PDFs, so
BaseFont names prove nothing. `pdf-face-match.py` compares each PDF subset's
glyph outlines with candidate files; a match below means 100% of subset outlines
equal one file and at most 18% equal any other candidate.

## Compatibility matrix

| Case | Payload / source | Open | Edit with absent characters | Save → reopen |
| --- | --- | --- | --- | --- |
| A | EOT 2.2, flags 0, unmodified TTF (7 faces, RIBBI slots) | ✅ exact faces; line text = fonts-installed baseline | ✅ same embedded faces | ✅ payloads preserved byte-for-byte |
| minimal | A with one face, `p:font typeface` only | ✅ | ✅ | ✅ |
| D | EOT 2.2, flags 0, CFF OTF (Source Sans 3 3.052R) | ✅ exact OTF outlines, same breaks as TTF | ✅ | ✅ |
| E | WOFF2 → sfnt (google/woff2 via `wawoff2`), WOFF 1.0 → sfnt (zlib), then EOT | ✅ outlines = pinned TTF | ✅ | ✅ |
| B | raw sfnt in `.fntdata`, no EOT header | ❌ silent Calibri fallback | — | parts kept, still unused |
| C | PowerPoint-written MTX EOT (flags 0x4), copied verbatim | ✅ exact faces, despite PowerPoint's non-RIBBI slots | ✅ | ✅ (see AppleScript caveat) |
| C2 | PowerPoint-written subset MTX EOT (flags 0x5), copied verbatim | ✅ subset glyphs | ⚠️ characters outside the subset fall back to Cambria / Times New Roman | ⚠️ same |
| F | `fsType` 0x0000 installable | ✅ | ✅ | ✅ |
| F | `fsType` 0x0008 editable | ✅ | ✅ | ✅ |
| F | `fsType` 0x0100 no subsetting | ✅ | ✅ | ✅ |
| F | `fsType` 0x0002 restricted | ❌ silent Calibri fallback | — | part kept |
| F | `fsType` 0x0004 preview & print | ⚠️ blocking dialog: "cannot be edited … read-only embedded (restricted) fonts" → Open Read-only / Remove Restricted Fonts | ❌ read-only | — |
| F | `fsType` 0x0200 bitmap only | rendered outlines anyway | ✅ | ✅ (licence still forbids) |
| G | variable `Heebo[wght]` as-is | ⚠️ renders **wght 100 (Thin)**: neither default 400 nor CSS 500 | — | — |
| G | fontTools static `wght=500` instance, unique name | ✅ | ✅ | ✅ |
| H | Google Fonts `latin` unicode-range WOFF2 subset as the whole face | ✅ Latin text | ⚠️ typed Hebrew falls back to Times New Roman | ⚠️ same |

Screenshots: [baseline](results/screenshots/baseline-fonts-installed.png),
[isolated fallback](results/screenshots/control-isolated-fallback.png),
[A after edit/save/reopen](results/screenshots/a-embedded-edited-saved-reopened.png),
[preview/print dialog](results/screenshots/f-preview-print-dialog.png),
[variable Thin vs instance](results/screenshots/g-variable-thin-vs-instance.png),
[subset fallback](results/screenshots/h-unicode-range-subset-typed-fallback.png),
[PowerPoint subset fallback](results/screenshots/c2-subset-typed-fallback.png).

### Save-path caveat

PowerPoint loads `embedTrueTypeFonts="1"` into the document's *Embed fonts in the
file* setting. AppleScript `save … in … as save as PDF` (and `save as Open XML
presentation`) clears that setting. A later save then silently drops
`p:embeddedFontLst`, every font part and `embedTrueTypeFonts`, and the reopened
Deck falls back. GUI **File › Export › PDF** leaves the setting on. In-place saves
without an AppleScript export kept the payloads byte-for-byte. PowerPoint
rewrote `p:font` attributes and sometimes added a synthesized MTX slot, such as
`Heebo ExtraBold` bold with internal family name `3`. The reopened file still
rendered the original faces.

### Office cloud fonts and precedence

| Condition (case A package, cloud fonts enabled) | Heebo rendered from |
| --- | --- |
| cloud Heebo already cached | **Office cloud copy** (459 glyphs vs pinned 591; first line 401.6 pt vs 400.0 pt) |
| empty cloud cache | embedded payload; no download during that open |
| writable cache, connected experiences off, after a save/reopen cycle | cloud copy downloaded and used on reopen (trigger not isolated) |

A same-named cached cloud font beats the embedded face. Source Sans 3 is absent
from the catalog and always used its embedded payload.

## Chromium

Width of the same 140-character line at 200 px, recorded in
`results/observations.json` (`chromium`) by [`chromium-measure.mjs`](chromium-measure.mjs):

| Source | Width (px) |
| --- | --- |
| Heebo Medium TTF / WOFF2 / WOFF2-decoded TTF | 13391.796875 (all three) |
| Source Sans 3 TTF / WOFF / WOFF-decoded TTF / OTF | 12366.8125 (all four) |
| `Heebo[wght]` at CSS weight 500 | 13392.000000 |
| fontTools static `wght=500` instance | 13391.796875 |
| `Heebo[wght]` at weight 100 | 12905.578125 |

Decoded WOFF/WOFF2 faces equal the pinned TTFs in outlines, `hmtx` and `cmap`;
only `head` (checksum) and, for WOFF2, the reconstructed `glyf` bytes differ.
The variable font at weight 500 measures 0.2 px wider than its static instance,
so measuring the variable font and embedding an instance is not exact. The
instance's outlines equal Google Fonts' static Heebo 500 and differ from the
upstream static `Heebo-Medium.ttf` (18% shared).

## Contract for the blocked tasks

### Embedding package (#36)

- **Part**: `/ppt/fonts/fontN.fntdata`, `<Default Extension="fntdata" ContentType="application/x-fontdata"/>`.
  `src/ooxml/opc.ts` currently registers `application/vnd.openxmlformats-officedocument.obfuscatedFont`;
  that type was not tested and PowerPoint never writes it.
- **Relationship** from `ppt/_rels/presentation.xml.rels`: `http://schemas.openxmlformats.org/officeDocument/2006/relationships/font`.
- **Presentation**: `embedTrueTypeFonts="1"`, no `saveSubsetFonts`; `p:embeddedFontLst` after `p:notesSz`;
  one `p:embeddedFont` per Office legacy family (#32 identity), slots `p:regular|p:bold|p:italic|p:boldItalic` from the face's Office style.
  `p:font typeface` alone is sufficient; `pitchFamily`, `charset` and `panose` are optional.
- **Payload**: EOT version `0x00020002`, flags `0` (no subsetting, no MTX, no XOR). FontData holds the unmodified
  sfnt bytes. Header fields come from that face: OS/2 PANOSE, weight, italic, fsType, Unicode/code-page ranges,
  `head.checkSumAdjustment`, names 1/2/5/4, empty RootString, RootStringCheckSum `0x50475342`
  ([`lib/eot.mjs`](lib/eot.mjs)). MTX is not required. Raw sfnt is not accepted.
- **Coverage**: embed the complete face; characters typed later then render in the embedded face.
- **Permissions** (`OS/2.fsType`), for editable output:
  accept usage bits `0x0000` (installable) or `0x0008` (editable), with or without `0x0100` (no subsetting; tested as `0x0100`);
  reject `0x0002` (restricted, silently unused), `0x0004` (preview & print, Deck becomes read-only) and any face with
  `0x0200` (bitmap only; PowerPoint ignores it, the licence does not). fsType is necessary, not sufficient:
  licence notices and reserved names still apply.
- **Preservation** (PPTX → HTML → PPTX): PowerPoint-written MTX parts copied verbatim render correctly. Subset parts
  (EOT flag `0x1`) cover only their glyphs, so report them as subset and limited-edit, never as full embedding.
- **Verification/oracle**: never save a Deck after an AppleScript PDF export; identify PDF faces by outlines, not
  BaseFont names (relevant to #41).

### Asset resolution (#34)

- **Formats**: TTF and CFF OTF are embedded as-is. WOFF 1.0 (zlib) and WOFF2 (google/woff2, the library Chromium uses,
  e.g. `wawoff2`) are decoded to sfnt before both Chromium measurement and EOT wrapping. Pin the decoded face's
  SHA-256 as the asset identity; the source WOFF hash identifies acquisition only.
- **Remote vs local**: changes acquisition, not payload. Google Fonts serves unicode-range WOFF2 subsets to a browser
  User-Agent and one complete TTF otherwise. Its Heebo v28 build differs from the GitHub 3.100 files
  (outlines 18% shared), so the same family name from different sources is a different asset.
- **Variable fonts**: never embed a variable font; PowerPoint for Mac rendered the wght 100 (Thin) instance although
  the default is 400 and CSS asked for 500. The only supported route is a static instance at the exact axis coordinates, created
  before measurement; Chromium then measures that instance's bytes and the same bytes are embedded. The instance is a
  derived font: it needs its own legacy family/style naming and licence check (Source Sans reserves "Source"). Until
  that naming policy is chosen, keep `FONT_IDENTITY_INVALID` for variable faces.
- **unicode-range subsets**: one Office slot holds one face. Several subset files cannot become one editable face
  without merging, which is a font modification and was not tested. Coverage is the embedded face's `cmap`.
  Fail the portable requirement when Slide text uses characters outside it, listing them; when every used character is
  covered, embed the face but report it as a web subset with its covered ranges, never as the complete family.

## Unknowns

- Windows PowerPoint and PowerPoint for the web were not tested. Keep RIBBI-correct slots: Mac rendered case C's
  ExtraBold face from a `p:bold` slot for a non-bold run, which says nothing about Windows slot handling.
- The cloud-font download trigger, and whether a same-named **locally installed** face also beats the embedded
  payload (cached cloud fonts do).
- `application/vnd.openxmlformats-officedocument.obfuscatedFont` for `.fntdata`, EOT XOR obfuscation, and OS/2
  version 0–2 fonts with several permission bits set.
- Naming policy for derived variable instances; merging unicode-range subsets.

## Reproduce

```sh
npm install
python3 -m pip install -r requirements.txt   # fonttools (instancer) + pypdf (matcher)
npm run sources      # downloads and verifies sources.json inputs, creates the static instance
npm run build        # writes out/cases/*.pptx and out/cases/manifest.json (deterministic)
npm run measure      # Chromium widths → out/chromium-measure.json
node inspect-pptx.mjs out/cases/a-eot-uncompressed-ttf.pptx
node pdf-fonts.mjs export.pdf
python3 pdf-face-match.py export.pdf ../../fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf --pptx deck.pptx
```

`fixtures/minimal-heebo-medium.pptx` (51 471 bytes) is the smallest tested
reproduction: one unmodified OFL face whose name table carries its copyright and
licence. `ref/powerpoint-embed-*.pptx` are the packages PowerPoint itself wrote
with the fonts installed; cases C and C2 are built from them.
