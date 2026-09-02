# `inspect` output

`deckflip inspect <input>` prints one JSON document: the Intermediate Deck Model (see [11-architecture.md](11-architecture.md)) serialised, for either input kind. For HTML input it is a dry run of `convert` (measurement pass included, no PPTX written); for PPTX input it is the parse result. Identical shape both ways, so an agent can compare "what I wrote" against "what came out".

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
    { "family": "Aptos", "class": "safe", "file": "/Library/Fonts/Microsoft/Aptos.ttf", "faces": ["regular", "bold"], "embedded": false }
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

`fonts[].class` is `safe`, `deck-provided`, `installed`, or `missing` (PPTX input only). `deck.master.source` is `built-in` or `preserved`.

The document is deterministic for a given input and tool version. Text is the only free-form content; everything else is enumerated, so agents can `jq` it safely.
