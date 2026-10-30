# CLI surface and Conversion report

Decided in [#9](https://github.com/devosurf/deckflip/issues/9).

## Name
Binary and npm package: **`deckflip`** (`npx deckflip <command>`). Checked: free on npm, no competing project on GitHub. Repo renamed to `devosurf/deckflip` (old URLs redirect).

## Commands
- `deckflip convert <input> [-o <output>]` — direction inferred from the input (`.html` file or Deck directory -> `.pptx`; `.pptx` -> `.html` + asset directory), `--to pptx|html` overrides. Runs `validate` first; a validation error exits 2 with no output written. Default output: input basename with the other extension, next to the input. Once written, the output is verified against the input (Verification, [10](10-rendering-and-verification.md#verification)); PPTX -> HTML therefore also needs Chromium.
- `deckflip validate <input>` — HTML: checks the Deck against the authoring subset (#10/#11), new font embedding eligibility, what would be flattened/rasterised, and Layout flags. Eligibility is not completed packaging; the same default portable policy and `--no-embed-fonts` opt-out apply. PPTX: checks the package parses and reports what round-trip will preserve opaquely; existing source font permission/format limits are warnings, not new-embedding eligibility failures, and never produce `FONT_NOT_EMBEDDED`. Same report format as `convert`.
- `deckflip verify <source> <output>` — Verification of a conversion done earlier: one HTML Deck and one PPTX, the source's kind deciding the direction. The HTML side is measured afresh. The report holds `VERIFY_*` entries only and is printed (`--json`) or written where `--report` says; no default sidecar, so the conversion's own survives. `--browser`, `--offline`, `--quiet`, `--no-color` as for `convert`.
- `deckflip render <input> -o <dir>` — one PNG per Slide (`slide-001.png`). HTML input renders in Chromium; PPTX input renders with LibreOffice by default, `--renderer powerpoint` uses real PowerPoint where installed (macOS save-as-PDF path from the spike). `--dpi`, `--slides 1,3-5`. Missing renderer exits 1. A diagnostic, not a step of the agent loop.
- `deckflip inspect <input> [--browser <path>] [--offline]` — JSON dump of Deck structure: Canvas size, per-Slide elements (kind, bounds in CSS px, text preview, native/rasterised), fonts used, preserved opaque parts. HTML input needs Chromium; PPTX input never launches or requires it, regardless of browser options or environment variables.
- `--help` per command and `--version`. Help text is the canonical CLI doc the skill (#16) quotes.

## Flags
Run-scoped settings are flags; Deck-intrinsic settings live in deck metadata. No config file in v1.
- `--size 16:9|4:3|<w>x<h>` overrides deck meta; the override is recorded as a report entry (`OVERRIDE_CANVAS_SIZE`).
- `--no-embed-fonts` on HTML-input `convert` and `validate` explicitly chooses machine-dependent **new** embedding. Default HTML conversion embeds every used face's exact measured bytes for portable, editable text; validation reports eligibility, not completed embedding. Under the opt-out, each used face without a preserved source embedding gets `FONT_NOT_EMBEDDED` (warning): recipients need that exact face installed. Portability-only format, permission, coverage and glyph-fallback failures become warnings; authoring validation errors still fail. Source embedded parts always remain preserved, including with the library option `embedFonts: false`. Explicit `--no-embed-fonts` with PPTX input is an invocation error (3). The former opt-in `--embed-fonts [names]` option is removed, not an alias.
- `--raster-dpi <n>` default `192` (2x Canvas).
- `--report <path>` overrides the sidecar location; `--strict[=info|warning|error]` (Strict mode); `--json`; `--quiet`; `--no-color`.
- Strict mode applies to `convert` and `validate` for both input kinds. Bare `--strict` is `--strict=info` (any Report entry); `--strict=warning` fails on warnings and errors, and `--strict=error` only on errors. Lower-severity entries stay in JSON and the sidecar. Unknown or empty thresholds are invocation errors (3). A threshold requires `=`: `--strict warning` means bare `--strict` followed by the positional `warning`, never a threshold. With an input already supplied, that extra positional is an invocation error; before the input, bare `--strict` does not consume the input.
- Chromium (`convert`, HTML `validate`/`render`/`inspect`, and `verify`): `--browser <path>` uses an existing Chromium/Chrome binary, overriding `DECKFLIP_BROWSER`; otherwise the Playwright-managed build is used. `--offline` prevents automatic downloads, not use of an existing browser.

## Browser environment

- Browser precedence: `--browser <path>` > `DECKFLIP_BROWSER` > Playwright-managed build. An invalid explicit or environment path fails rather than falling back.
- `DECKFLIP_OFFLINE=1` or `CI=true` disables automatic Chromium downloads, as does `--offline`. With no selected/managed browser available, exit 1 prints `Chromium is not installed. Run <install command>.`; no download is attempted.
- `PLAYWRIGHT_BROWSERS_PATH` selects Playwright's managed browser cache for both installation and launch.
- Otherwise, a missing managed browser is installed on first use with a stderr notice. Installation resolves the Playwright CLI from the installed dependency, independently of the current directory. The printed install/recovery command uses absolute, shell-quoted Node and installer paths, including for global installations under paths containing spaces. Run it with the same `PLAYWRIGHT_BROWSERS_PATH` if one was set.

The complete Chromium policy is in [10-rendering-and-verification.md](10-rendering-and-verification.md#chromium-policy).

## Exit codes
`0` success (entries below the selected threshold allowed) · `1` no output produced (internal/renderer/Chromium failure, unreadable PPTX) · `2` validation failed, nothing converted · `3` bad invocation · `4` Strict mode: the severity threshold was reached; conversion output and report remain available · `5` output and report written, but Verification found the output differs from the source.

Precedence: `3` > `1` > `2` > `5` > `4` > `0`. Validation errors take precedence over Strict mode for both input kinds and both `convert` and `validate`: exit 2, with a diagnostic report available. Failed conversion does not create a converted Deck or Asset directory and leaves any existing destination Deck/assets unchanged. Downloads an HTML source needs are pinned in that source's own Asset directory (`<name>.assets/fonts/`, [07](07-fonts.md#deck-font-assets)) whatever the outcome, so a repeat run measures the same bytes. Verification errors exit 5 at every threshold, keeping the output. Otherwise, entries at or above the selected Strict-mode severity return 4; entries below it, or any nonfatal entries without Strict mode, return 0. Successful conversion output remains available, and validation still writes only its report. Clean operations return 0 in either mode. `verify` returns 0 or 5; 2 when its HTML source fails validation, while an HTML output that fails validation is a deckflip defect like any Verification error (5).

## Conversion report
Always written as a sidecar `<output>.report.json` unless `--report <path>` selects another destination. Both conversion directions honor the selected destination on success, Strict-mode failure, and validation failure, creating missing parent directories. An override does not also write the default sidecar or remove pre-existing unrelated files. `--json` puts the same complete per-occurrence document on stdout and does not suppress the human summary on stderr; `--quiet` suppresses only that summary (combine `--json --quiet` for JSON alone). The summary shows per-Slide counts, then one line per severity/code group, ordered error, warning, info and alphabetically by code within each severity. Each group includes its occurrence count, the first three Slide/selector or shape locators (deck-level locations where applicable), `+N more` for remaining occurrences, the first occurrence's reason, and each distinct hint once. JSON and sidecars retain every reason, hint and location individually. Schema:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "deckflip", "version": "0.1.0" },
  "command": "convert",
  "input":  { "path": "deck.html", "kind": "html" },
  "output": { "path": "deck.pptx", "kind": "pptx" },
  "canvas": { "width": 1280, "height": 720, "source": "deck-meta" },
  "fonts": [
    {
      "cssFamily": "Brand", "aliases": ["heebo", "heebo medium"],
      "asset": {
        "sha256": "<sha256 of the decoded sfnt>", "faceIndex": 0, "postscriptName": "Heebo-Medium",
        "source": { "kind": "remote", "url": "https://fonts.example.com/s/heebo.woff2", "format": "woff2", "sha256": "<sha256 of the download>", "pinned": "/deck/deck.assets/fonts/<sha256>.woff2" }
      },
      "office": { "family": "Heebo Medium", "style": "regular" },
      "metrics": { "ascender": 1.0478515625, "descender": 0.4208984375 },
      "fsType": 0,
      "embedding": { "status": "embedded", "part": "ppt/fonts/font1.fntdata" }
    }
  ],
  "summary": { "slides": 12, "native": 140, "rasterised": 3, "flattened": 2, "substituted": 1, "dropped": 0, "preserved": 0, "overridden": 0, "flagged": 0, "errors": 0 },
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
- `kind`: `rasterised | flattened | substituted | dropped | preserved | overridden | flagged | error`; `severity`: `error | warning | info`. `error` entries come from validation (exit 2) or from Verification (`VERIFY_*`, exit 5); `flagged` entries are Layout flags.
- Locator: `{selector}` for HTML input, `{shapeId, name}` for PPTX input; `slide` is 1-based. Verification locates an output-only finding by its paired source element where it has one.
- `fonts` (`convert` and `validate`): each selected face once, the Resolved font `inspect` also lists ([07](07-fonts.md#resolution-and-office-identity)). Provenance and `embedding` status (`embedded`, `eligible`, `not-embedded`, `preserved`, with optional part/subset/compression metadata) are not Report entries and never affect Strict mode. `embedded` means successful packaging; validation uses `eligible`, not a claim of emitted parts.
- `embeddedFonts` records existing source EOT parts separately from decoded selected `fonts`, including family/Office slot, part and relationship ID, `kind` (`complete`, `subset`, `mtx`, `xor`), optional decoded sfnt SHA-256, rights, subset/compression flags and preserved status. An MTX source part may be preserved without decoded sfnt identity. Opting out of new embedding never removes these source parts.
- Codes are an enumerated list, stable once published, grouped by family: `VALIDATE_*`, `RASTER_*`, `FLATTEN_*`, `SUBSTITUTE_*`, `FONT_*`, `PRESERVE_*`, `DROPPED_*`, `OVERRIDE_*`, `RENDER_*`, `LAYOUT_*`, `VERIFY_*`. The complete list with hint templates is [08-report-codes.md](08-report-codes.md).
- `hint` is mandatory for every non-error entry: it is what makes the agent loop converge.

## Agent loop
`validate` -> fix (errors, then warnings and Layout flags) -> `convert --strict=warning --json` -> read `entries[].hint`; exit 5 is a deckflip defect to report -> optionally `render` the HTML to judge the design -> `inspect` to confirm structure. Warning-level strictness permits informational substitutions without hiding them from the Conversion report. The skill documents exactly this sequence. No PPTX render is needed: Verification and the corpus's PowerPoint oracle carry that evidence ([ADR 0007](../adr/0007-verification-and-powerpoint-oracle.md)).

## Other decisions
- CLI is the only supported surface in v1; no library export (module boundary keeps it an additive later step).
- Output is deterministic: stable part ordering and serialization; `docProps` timestamps honour `SOURCE_DATE_EPOCH`, otherwise current time. Same input + same version = identical bytes apart from timestamps (the round-trip guarantee in [06-round-trip.md](06-round-trip.md) is stronger: untouched parts are byte-identical to the source).
- `inspect` output is specified in [09-inspect.md](09-inspect.md).
