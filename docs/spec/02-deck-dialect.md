# HTML Deck dialect

Decided in [#10](https://github.com/devosurf/deckflip/issues/10).

## Deck file

An HTML Deck is one HTML document. `deckflip convert` also accepts a directory: it uses `deck.html` if present, else `index.html`, else every `*.html` in the directory in byte-order filename sort, each file being one Slide (per-file form, default meta).

Deck-level declarations live in `<head>`:

| Declaration | Form | Default |
| --- | --- | --- |
| Deck title | `<title>` | input basename |
| Canvas size | `<meta name="deckflip:canvas" content="16:9 \| 4:3 \| <w>x<h>">` (CSS px; same grammar as `--size`) | `16:9` = `1280x720` |
| Language | `<html lang>` | `en` |
| Sections (PowerPoint sections) | `data-section="<name>"` on the first Slide of each section | none |

The `deckflip:` meta-name prefix and the `data-*` names in this ticket are reserved; unknown `deckflip:*` names are a `VALIDATE_UNKNOWN_META` error.

## Slides

Every `<section>` that is a direct child of `<body>` is a Slide, in document order. Nothing else in `<body>` is rendered (a stray element outside a section is `VALIDATE_STRAY_CONTENT`, error).

Per-Slide declarations, all on the `<section>`:

| Declaration | Form | Fallback |
| --- | --- | --- |
| Stable id | `id` | `slide-<n>` assigned by the tool (PPTX->HTML always emits one) |
| Slide name (`p:cSld/@name`, outline) | `data-title` | text of the first `h1`-`h3`, else `Slide <n>` |
| Layout to instantiate on a preserved master | `data-layout="<layout name>"` | `Blank` (round-trip detail in #14) |
| Speaker notes | `<aside class="notes">` inside the section; rich text allowed (`p`, `ul/ol`, `strong/em`, `a`) | none |

Internal hyperlinks are ordinary anchors: `<a href="#<slide id>">` becomes `ppaction://hlinksldjump`; `<a href="https://...">` stays external.

## Per-file form

A Slide may live in its own file: `<section data-src="slides/01-intro.html"></section>` in the Deck file. The referenced file is a complete HTML document rendered on its own Canvas: its own `<head>` styles and `<link rel="stylesheet">`, its `<title>` as the Slide name, its `<body>` as the Slide content, an `<aside class="notes">` inside its body for notes. Nothing leaks between files, which is what makes the form safe: shared CSS is shared by each file linking the same stylesheet, not by inheritance. Inline `<section>` and `data-src` sections mix freely. A directory without a Deck file is the same thing with implicit ordering.

## Assets

`img[src]`, `video[src|poster]`, `audio[src]`, `source[src]`, CSS `url()` (backgrounds, `@font-face`) and `link[href]` resolve relative to the file that references them (the Deck file, or the per-file Slide document). `data:` URIs are allowed. `http(s)` and any other scheme is `VALIDATE_REMOTE_ASSET` (error; hint: save the file into the Deck's asset directory). A missing local file is `VALIDATE_MISSING_ASSET` (error).

## Injected base stylesheet

Before author CSS, the tool injects, into every rendered document:

```css
html, body { margin: 0; padding: 0; background: #fff; }
body > section { position: relative; box-sizing: border-box; overflow: hidden; width: <W>px; height: <H>px; }
aside.notes { display: none !important; }
```

Authors need no boilerplate; they may override. After layout, every Slide's border box must equal the Canvas (`VALIDATE_SLIDE_SIZE`, error) and its offset is irrelevant (the tool measures relative to the section). This is a deliberate trade: a Deck opened directly in a browser shows the Slides stacked vertically at Canvas size, which is good enough for a glance; `deckflip render` is the real preview.

## Absolute-positioned form (PPTX -> HTML)

Same dialect, canonical single-file form, deterministic:

- `<head>`: `<title>`, `deckflip:canvas`, one `<style>` holding the base rules plus theme tokens as custom properties (`--theme-accent1`, `--theme-major-font`, ...) and one class per distinct run/paragraph style set (`.t1`, `.t2`, ...). Geometry is never in the stylesheet.
- One `<section id="slide-<n>" data-title data-layout>` per Slide. Each shape is a direct child of the section in z-order (backmost first), `style="position:absolute; left:..px; top:..px; width:..px; height:..px"` plus `transform: rotate(..deg)` when rotated. Groups are `<div data-group>` containers with their own absolute box and absolutely positioned children (relative to the group).
- Text bodies are `<div>` with one `<p>` per paragraph and `<span>` runs; `ul`/`ol` for bulleted/numbered paragraphs; `<br>` for line breaks. Pictures are `<img>`, tables `<table>`, media `<video>`/`<audio>`, vector shapes that HTML cannot express are inline `<svg>`.
- Every element that came from a shape carries `data-shape-id="<slide number>-<spid>"` (stable locator for the report and `inspect`); opaque preserved content is an empty `div[data-preserve="<class>"]` with the shape name in `title` (#14).
- Assets go to `<name>.assets/` next to the HTML: `media/` (pictures, media, raster PNGs), `fonts/` (extracted embedded fonts), and the round-trip manifest (#14). Filenames are deterministic (`image-001.png`, content-hash deduplicated).

## Reserved names (complete list)

`meta[name^="deckflip:"]`; on `section`: `id`, `data-title`, `data-layout`, `data-section`, `data-src`; anywhere: `aside.notes`, `data-shape-id`, `data-preserve`, `data-group` (#11), `data-raster` (#13), `data-placeholder` (#14). No class names are reserved except `notes` on `aside`.
