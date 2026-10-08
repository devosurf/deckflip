# deckflip

Bidirectional conversion between HTML slides and PowerPoint (`.pptx`), built for coding agents. HTML-authored Decks become editable PowerPoint shapes, text, pictures, tables, lists, and groups. Existing PowerPoint Decks can be converted to HTML, edited, and converted back while Untouched content is preserved from the source package.

## Requirements

- macOS; Windows and Linux hosts are unsupported for now
- Node.js 20.16 or newer
- Chromium, installed automatically on first use unless `--offline` is set
- Optional: LibreOffice or PowerPoint (`--renderer powerpoint`), only to render a PPTX with `render`; conversion and its checks do not need either

## Quick start

Run without a global installation:

```sh
npx deckflip@latest --help
```

Validate an HTML Deck, convert it (the conversion verifies its own output), and inspect its structure:

```sh
npx deckflip@latest validate deck.html --json
npx deckflip@latest convert deck.html --strict --json -o deck.pptx
npx deckflip@latest inspect deck.html
```

Look at the design in Chromium with `npx deckflip@latest render deck.html -o rendered/`; re-check an earlier conversion with `npx deckflip@latest verify deck.html deck.pptx`.

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

The skill documents the `validate -> convert --strict -> inspect` loop, the supported HTML/CSS subset, Conversion report codes, font handling, and round-trip editing. Its source is in [`skills/deckflip`](skills/deckflip).

## Conversion behavior

- Text, shapes, pictures, lists, tables, and groups are emitted as native PowerPoint elements when representable.
- Unsupported visual effects on text-free elements are rasterised; unsupported effects on text are flattened so the text remains editable.
- Every rasterised, flattened, substituted, dropped, preserved, or overridden construct is recorded in a machine-readable Conversion report, as are Layout flags: text spilling out of its box, text over text, illegible text, and lines PowerPoint may break elsewhere.
- Every conversion verifies its output against its source: Visible text, speaker notes, element geometry and stacking. A mismatch is a deckflip defect, reported as `VERIFY_*` errors with exit 5; the output is kept.
- Validation errors return exit 2 with a diagnostic report, without creating or replacing the converted Deck or its Asset directory.
- Otherwise, Strict mode returns exit 4 when the report is non-empty while retaining the output; successful non-strict operations return 0.
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

`npm run prepublishOnly` runs the production dependency audit, typecheck, and tests.
The audit command removes npm's lifecycle-exported `npm_config_allow_scripts` variable
to work around [npm/cli#9913](https://github.com/npm/cli/pull/9913); npm still reads the
persistent script policy from `.npmrc`.

## License

MIT
