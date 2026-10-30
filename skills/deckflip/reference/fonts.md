# Fonts

## Resolution and exact identity

For every run, the computed `font-family` stack selects the first available supplied or installed concrete face. A family declared with `@font-face` matches only its own rules by CSS stretch/style/weight, never an installed face of the same name. Other families match installed faces by preferred or legacy name. The PPTX addresses the selected face's legacy Office family and regular/bold/italic/bold-italic slot.

- Unstyled text inherits bundled **Liberation Sans 2.1.5**, static Regular, Bold, Italic and BoldItalic. The first anonymous cascade layer supplies a root default; authored root, body, Slide and text families, including Tailwind-style layers, win. There is no body default or family appended to explicit stacks.
- `FONT_UNRESOLVED` (error): no family resolves. Install or supply the concrete family; the default does not mask an authored missing family.
- `FONT_GENERIC_ONLY` (error): a generic (`sans-serif`, `serif`, `monospace`, `system-ui`, `ui-*`, `cursive`, `fantasy`, `math`, `emoji`) was reached before a concrete match. Put a concrete family first.
- `FONT_IDENTITY_INVALID` (error): missing/conflicting legacy names or style bits, unsupported subfamily, or variable face. Supply a supported static face; keep font tables and CSS weights intact. Unmodified Heebo 500 becomes **Heebo Medium / regular**, 700 **Heebo / bold**, and 800 **Heebo ExtraBold / regular**. Office slots follow face metadata, not a numeric bold threshold.

## Portable editable output is the default

Conversion embeds every used face, including installed and bundled faces, using the exact decoded sfnt bytes Chromium measured. New parts wrap the complete available face in EOT 2.2 with flags 0; they are not subsets of current Slide characters. Shared faces reuse parts. There is no family-name safety whitelist: Arial and Office-bundled fonts follow the same requirement.

Successful packaging is `fonts[].embedding.status: "embedded"` with a package `part`, not an informational Report entry. Validation instead reports `eligible`; it has not written a PPTX. Successful embedding alone creates no Strict-mode entry, so the bundled default and the template's explicit Arial can both be clean.

Fix default portable-policy errors before converting:

| Code | Action |
| --- | --- |
| `FONT_EMBED_RESTRICTED` | Supply a face permitted for editable embedding. Accepted `OS/2.fsType` values are 0, 0x8, 0x100 and 0x108; restricted, preview-and-print, bitmap-only and unsupported combinations fail, including installed fonts. |
| `FONT_EMBED_FORMAT` | Supply a complete standalone static TTF/OTF, or WOFF/WOFF2 encoding. Collections (TTC/dfont members) cannot be extracted for embedding. |
| `FONT_EMBED_COVERAGE` | Supply the complete font covering the listed characters and the required Office family/style slot. Subset files are not merged. |
| `FONT_GLYPH_FALLBACK` | Use a face covering all text and resolve any font Chromium drew instead of the selected face. Structural Verification does not prove glyph identity. |

`fsType` is the only licence signal deckflip checks, not legal clearance. The author remains responsible for embedding rights, required licence notices and reserved names. The report retains source provenance and permission bits.

## Webfonts and subsets

- `@font-face` works in inline, linked and imported stylesheets, local or hosted, including nested `@layer` rules. URLs resolve against their stylesheet's final redirect URL. TTF, OTF, WOFF and WOFF2 are accepted; WOFF/WOFF2 decode to sfnt before both measurement and packaging.
- Hosted stylesheets and fonts are pinned on first use in `<name>.assets/fonts/`. Keep that directory with the Deck for repeatable offline conversion. Delete an entry from `fonts/sources.json` to fetch it again.
- `local()` sources are ignored: installed fonts cannot replace supplied bytes. A rule with only `local()` is `FONT_ASSET_UNSUPPORTED`.
- A needed face that cannot load stops conversion: `VALIDATE_MISSING_ASSET` for a local file, `FONT_ASSET_UNAVAILABLE` for unavailable or damaged pins, `FONT_ASSET_UNSUPPORTED` for unsupported bytes. Unused face rules are not fetched or reported.
- A downloaded `unicode-range` subset is not a complete family. If it covers current Slide text, it can be embedded, but `FONT_EMBED_SUBSET` warns about limited editing and reports its declared covered ranges. One Office family/style slot holds one asset: competing subsets that leave characters uncovered fail coverage. Supply the complete file rather than remapping weights or merging subsets.

## Intentional machine-dependent output

`--no-embed-fonts` is the sole opt-out for new HTML -> PPTX embedding; the old opt-in/name-list option is removed. Each used face without a preserved source embedding gets `FONT_NOT_EMBEDDED` (warning): recipients need that exact face installed. Font-format, permission and coverage failures and glyph fallback become warnings, while identity, asset and other authoring validation errors remain errors. Use the opt-out only when machine-dependent delivery is intentional; changing the Strict-mode threshold does not make such output portable. Source embedded fonts are always preserved, including with `embedFonts: false`.

## Inspecting and editing existing Decks

`deckflip inspect deck.html` lists `fonts[]` with `cssFamily`, normalized `aliases`, `asset` (decoded sfnt SHA-256, collection face index, PostScript name and `source`), `office` (family/RIBBI slot), metrics and `fsType`. Provenance distinguishes `installed`, `file`, `remote` with pinned copy, `data`, `bundled`, and source-PPTX `embedded` (`part`); bundled sources name family/version/file basename and supplied-byte hash. Selection-only inspection is not proof of packaging or renderer fidelity. `convert --json` adds actual embedding status; HTML `validate` reports eligibility only.

Supported round trips always retain source font payloads, rights and Office slots verbatim. `embeddedFonts[]` describes preserved EOT parts separately from decoded selected `fonts[]`, with family/slot, part, relationship ID, `kind` (`complete`, `subset`, `mtx`, `xor`), optional decoded sfnt `sha256`, permission and subset/compression metadata. The digest identifies decoded sfnt, not its EOT wrapper; opaque MTX has no decoded identity. HTML preview decoding limitations report `FONT_EMBED_FORMAT` (warning). Preserved subsets remain limited-edit (`FONT_EMBED_SUBSET`): added characters may fall back, and opaque MTX coverage of edited text is unknown and warns rather than blocking preservation. PPTX-input `convert`/`validate` do not apply new-embedding eligibility or `FONT_NOT_EMBEDDED`; existing source rights/format limits warn without blocking. Explicit CLI `--no-embed-fonts` with PPTX input exits 3; disabling new HTML embedding never removes source parts.

A package-only assertion does not prove PowerPoint used an embedded face. Release acceptance needs an isolated supported PowerPoint host, source fonts unavailable, additional-character edits and save/reopen evidence bound to the package. Same-named cached Office cloud fonts can override embeddings, and AppleScript PDF export can clear the embed setting before a later save. Keep isolation work on the QA host, not the developer's fonts or Office cache.
