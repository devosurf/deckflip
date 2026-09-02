# CLI surface and Conversion report

Decided in [#9](https://github.com/devosurf/deckflip/issues/9).

## Name
Binary and npm package: **`deckflip`** (`npx deckflip <command>`). Checked: free on npm, no competing project on GitHub. Repo renamed to `devosurf/deckflip` (old URLs redirect).

## Commands
- `deckflip convert <input> [-o <output>]` — direction inferred from the input (`.html` file or Deck directory -> `.pptx`; `.pptx` -> `.html` + asset directory), `--to pptx|html` overrides. Runs `validate` first; a validation error exits 2 with no output written. Default output: input basename with the other extension, next to the input.
- `deckflip validate <input>` — HTML: checks the Deck against the authoring subset (#10/#11) and reports what would be flattened/rasterised. PPTX: checks the package parses and reports what round-trip will preserve opaquely. Same report format as `convert`.
- `deckflip render <input> -o <dir>` — one PNG per Slide (`slide-001.png`). HTML input renders in Chromium; PPTX input renders with LibreOffice by default, `--renderer powerpoint` uses real PowerPoint where installed (macOS save-as-PDF path from the spike). `--dpi`, `--slides 1,3-5`. Missing renderer exits 1.
- `deckflip inspect <input>` — JSON dump of Deck structure: Canvas size, per-Slide elements (kind, bounds in CSS px, text preview, native/rasterised), fonts used, preserved opaque parts. Lets an agent check a PPTX without rendering it.
- `--help` per command and `--version`. Help text is the canonical CLI doc the skill (#16) quotes.

## Flags
Run-scoped settings are flags; Deck-intrinsic settings live in deck metadata. No config file in v1.
- `--size 16:9|4:3|<w>x<h>` overrides deck meta; the override is recorded as a report entry (`OVERRIDE_CANVAS_SIZE`).
- `--embed-fonts` embeds every non-safe font the Deck uses; `--embed-fonts=<name,...>` restricts to a list. Default off; non-safe fonts without embedding yield `FONT_NOT_SAFE`.
- `--raster-dpi <n>` default `192` (2x Canvas).
- `--report <path>` overrides the sidecar location; `--strict` (Strict mode); `--json`; `--quiet`; `--no-color`.
- Chromium: `--browser <path>` uses an existing Chromium/Chrome binary; otherwise the Playwright-managed build is used (download policy in [10-rendering-and-verification.md](10-rendering-and-verification.md)).

## Exit codes
`0` success (report entries allowed) · `1` no output produced (internal/renderer/Chromium failure, unreadable PPTX) · `2` validation failed, nothing converted · `3` bad invocation · `4` Strict mode: output and report written but the report is non-empty.

## Conversion report
Always written as a sidecar `<output>.report.json`; `--json` puts the same document on stdout; human summary on stderr (one line per Slide with counts, then one line per entry). Schema:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "deckflip", "version": "0.1.0" },
  "command": "convert",
  "input":  { "path": "deck.html", "kind": "html" },
  "output": { "path": "deck.pptx", "kind": "pptx" },
  "canvas": { "width": 1280, "height": 720, "source": "deck-meta" },
  "summary": { "slides": 12, "native": 140, "rasterised": 3, "flattened": 2, "substituted": 1, "dropped": 0, "overridden": 0, "errors": 0 },
  "entries": [
    {
      "code": "RASTER_CSS_FILTER",
      "kind": "rasterised",
      "severity": "warning",
      "slide": 3,
      "locator": { "selector": "section:nth-of-type(3) > div.hero > img" },
      "reason": "CSS filter blur(4px) has no DrawingML equivalent",
      "hint": "Remove the filter or pre-blur the image file"
    }
  ]
}
```
- `kind`: `rasterised | flattened | substituted | dropped | overridden | error`; `severity`: `error | warning | info`. `error` entries only come from `validate` (and exit 2).
- Locator: `{selector}` for HTML input, `{shapeId, name}` for PPTX input; `slide` is 1-based.
- Codes are an enumerated list, stable once published, grouped by family: `VALIDATE_*`, `RASTER_*`, `FLATTEN_*`, `SUBSTITUTE_*`, `FONT_*`, `PRESERVE_*`, `DROPPED_*`, `OVERRIDE_*`, `RENDER_*`. The complete list with hint templates is [08-report-codes.md](08-report-codes.md).
- `hint` is mandatory for every non-error entry: it is what makes the agent loop converge.

## Agent loop
`validate` -> fix -> `convert --strict --json` -> read `entries[].hint` -> `render` -> look at PNGs -> `inspect` to confirm structure. The skill documents exactly this sequence.

## Other decisions
- CLI is the only supported surface in v1; no library export (module boundary keeps it an additive later step).
- Output is deterministic: stable part ordering and serialization; `docProps` timestamps honour `SOURCE_DATE_EPOCH`, otherwise current time. Same input + same version = identical bytes apart from timestamps (the round-trip guarantee in [06-round-trip.md](06-round-trip.md) is stronger: untouched parts are byte-identical to the source).
- `inspect` output is specified in [09-inspect.md](09-inspect.md).
