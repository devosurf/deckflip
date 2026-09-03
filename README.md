# deckflip

Bidirectional conversion between HTML slides and PowerPoint (`.pptx`), built for coding agents. HTML-authored Decks become editable PowerPoint shapes, text, pictures, tables, lists, and groups. Existing PowerPoint Decks can be converted to HTML, edited, and converted back while Untouched content is preserved from the source package.

## Requirements

- Node.js 20 or newer
- Chromium, installed automatically on first use unless `--offline` is set
- LibreOffice for the default `render` command, or PowerPoint with `--renderer powerpoint`

## Quick start

Run without a global installation:

```sh
npx deckflip@latest --help
```

Validate an HTML Deck, convert it, render the result, and inspect its structure:

```sh
npx deckflip@latest validate deck.html --json
npx deckflip@latest convert deck.html --strict --json -o deck.pptx
npx deckflip@latest render deck.pptx -o rendered/
npx deckflip@latest inspect deck.html
```

Convert an existing PowerPoint Deck to HTML:

```sh
npx deckflip@latest convert deck.pptx
```

This writes `deck.html` and `deck.assets/`. Keep the Asset directory beside the Deck file when converting the edited HTML back to PPTX; its Manifest and source package are what let deckflip preserve Untouched PowerPoint content byte for byte.

## Agent skill

Install the bundled authoring skill and templates for supported coding agents:

```sh
npx skills add devosurf/deckflip
```

The skill documents the `validate -> convert --strict -> render -> inspect` loop, the supported HTML/CSS subset, Conversion report codes, font handling, and round-trip editing. Its source is in [`skills/deckflip`](skills/deckflip).

## Conversion behavior

- Text, shapes, pictures, lists, tables, and groups are emitted as native PowerPoint elements when representable.
- Unsupported visual effects on text-free elements are rasterised; unsupported effects on text are flattened so the text remains editable.
- Every rasterised, flattened, substituted, dropped, preserved, or overridden construct is recorded in a machine-readable Conversion report.
- Strict mode returns a non-zero exit code when the report is non-empty while still writing the output.
- Part ordering, relationship IDs, media names, timestamps, and capture paths are deterministic.

See [`skills/deckflip/SKILL.md`](skills/deckflip/SKILL.md) for authoring guidance and [`docs/spec`](docs/spec) for the format and architecture specifications.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The distributable CLI is written to `dist/cli.js`.

## License

MIT
