# `inspect` output

`deckflip inspect <input>` prints one JSON document: the Intermediate Deck Model (see [11-architecture.md](11-architecture.md)) serialised, for either input kind. For HTML input it is a dry run of `convert` (measurement pass included, no PPTX written); for PPTX input it is the parse result. Identical shape both ways, so an agent can compare "what I wrote" against "what came out".

## Browser options

`deckflip inspect <input> [--browser <path>] [--offline]` uses the shared Chromium launcher for HTML input: explicit `--browser` > `DECKFLIP_BROWSER` > Playwright-managed browser. An invalid override fails rather than falling back. `--offline`, `DECKFLIP_OFFLINE=1`, or `CI=true` prevents automatic downloads; an existing browser still works. If the managed browser is missing, exit 1 prints `Chromium is not installed. Run <install command>.` without downloading. `PLAYWRIGHT_BROWSERS_PATH` selects the managed cache; use the same value when running the printed recovery command. See [the CLI browser environment contract](01-cli.md#browser-environment).

PPTX input is parsed directly: it never launches or requires Chromium, even with a missing managed browser or invalid `--browser` / `DECKFLIP_BROWSER` paths.

## JSON output

```json
{
  "schemaVersion": 1,
  "tool": { "name": "deckflip", "version": "0.1.0" },
  "input": { "path": "deck.pptx", "kind": "pptx" },
  "canvas": { "width": 1280, "height": 720, "aspect": "16:9" },
  "deck": {
    "title": "Q3 review",
    "language": "en",
    "master": { "source": "preserved", "layouts": ["Title Slide", "Title and Content", "Blank"] },
    "sections": [{ "name": "Intro", "slides": ["slide-1", "slide-2"] }],
    "vba": false
  },
  "fonts": [
    {
      "cssFamily": "Heebo",
      "aliases": ["heebo", "heebo medium"],
      "asset": {
        "sha256": "cba4ce1a4c8ebaf36d0ac34d1941bc4d8a0117e343fac28c46a01635a08a92f1",
        "faceIndex": 0,
        "postscriptName": "Heebo-Medium",
        "source": { "kind": "file", "file": "/deck/fonts/Heebo-Medium.ttf", "format": "ttf", "sha256": "cba4ce1a4c8ebaf36d0ac34d1941bc4d8a0117e343fac28c46a01635a08a92f1" }
      },
      "office": { "family": "Heebo Medium", "style": "regular" },
      "metrics": { "ascender": 1.0478515625, "descender": 0.4208984375 },
      "fsType": 0
    }
  ],
  "slides": [
    {
      "index": 1,
      "id": "slide-1",
      "title": "Agenda",
      "layout": "Title and Content",
      "notes": "Keep this under a minute.",
      "preserved": ["animation", "comments"],
      "elements": [
        {
          "id": "1-4",
          "kind": "text",
          "source": "native",
          "bounds": { "x": 80, "y": 60, "width": 1120, "height": 72, "rotation": 0 },
          "locator": { "shapeId": 4, "name": "Title 1" },
          "text": "Agenda",
          "paragraphs": 1,
          "placeholder": "title"
        },
        {
          "id": "1-7",
          "kind": "picture",
          "source": "raster",
          "explicit": false,
          "bounds": { "x": 900, "y": 400, "width": 300, "height": 200, "rotation": 0 },
          "locator": { "selector": "section#slide-1 > div.badge" },
          "picture": { "media": "media/raster-3f9a.png", "format": "png", "pixels": [600, 400] },
          "entries": ["RASTER_CSS_FILTER"]
        }
      ]
    }
  ]
}
```

Element fields:

| Field | Meaning |
| --- | --- |
| `id` | `<slide index>-<shape id>`; for HTML input the id `convert` would assign |
| `kind` | `text`, `shape` (filled/stroked box without text), `picture`, `table`, `group`, `media`, `vector` (inline SVG or preserved geometry), `opaque` |
| `source` | `native`, `raster`, `preserved` |
| `bounds` | CSS px relative to the Slide (or to the parent group), `rotation` in degrees |
| `locator` | same object as the report's `locator` |
| `text` | first 120 characters of the text body; `paragraphs` count |
| `placeholder` | `p:ph` type, when the shape is a placeholder |
| `children` | for `group`: nested elements |
| `picture` | media path inside the asset directory (PPTX input) or the raster/media name `convert` would write; `format`; `pixels` |
| `opaque` | `{ "class": "chart" \| "smartart" \| "ole" \| "vector" \| "text-effects", "parts": ["ppt/charts/chart1.xml", ...] }` |
| `entries` | codes of report entries attached to this element |

`fonts[]` contains one Resolved font per asset digest/member face, not one per filename or preferred family. `cssFamily` is the matched CSS stack entry; `aliases` contains normalized matching aliases; `office.family` and `office.style` are the legacy Office address. `asset.faceIndex` distinguishes collection members; `asset.sha256` binds the identity to the face's sfnt bytes, decoded when the source is WOFF/WOFF2. `asset.source` records `installed` (`file`), `file`, `remote` (display `url` and `pinned` copy), `data`, `bundled` (`family`, `version`, and file basename), or `embedded` (source PPTX `part`), with acquired `format` and `sha256` where available ([07](07-fonts.md#deck-font-assets)). URL credentials and query values are omitted. `unicodeRange` marks a declared web subset. Source provenance replaces family-name safety classifications; actual embedding outcomes belong in conversion reports. `deck.master.source` is `built-in` or `preserved`.

`inspect` omits `embedding` from both `fonts[]` and `embeddedFonts[]`: inspection describes selected faces and existing payloads, not a conversion's eligibility, packaging or preservation outcome. Conversion and validation reports carry those statuses instead ([07](07-fonts.md#opt-out-validation-and-reporting)). Selection and payload metadata do not prove which face a renderer used.

Optional top-level `embeddedFonts[]` describes source EOT parts separately from selected decoded `fonts[]`: `family`, `slot`, `part`, `relationshipId`, `kind` (`complete`, `subset`, `mtx` or `xor`), optional `sha256` of the **decoded sfnt**, `version`, `flags`, `fsType`, `subset`, `compressed`, `familyName`, and `styleName`. `kind` prioritizes MTX over XOR over subset when flags overlap; original flags remain available. The digest is not an EOT payload hash and is absent when no decoded sfnt is available, including opaque MTX. sfnt bytes are excluded from JSON. Actual used decoded source faces also appear in `fonts[]` with `asset.source: { kind: "embedded", part }` and the same decoded digest. Source parts do not pretend to be newly embedded faces, and disabling new embedding never removes them.

The document is deterministic for a given input and tool version. Text is the only free-form content; everything else is enumerated, so agents can `jq` it safely.
