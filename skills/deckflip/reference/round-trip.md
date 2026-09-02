# Editing an existing PPTX (round trip)

Availability: PPTX -> HTML ships after this version; `deckflip convert deck.pptx` and `--to html` currently exit 3. The rules below describe the round trip as specified, so decks authored now stay compatible.

## The flow

1. `deckflip convert deck.pptx` writes `deck.html` and `deck.assets/` (`source.pptx` verbatim, `media/`, `fonts/`, `previews/`, and the manifest `deckflip.json`).
2. Edit `deck.html` in place. Keep `deck.assets/` beside it: it is the blob store the way back reads from.
3. `deckflip convert deck.html` writes the PPTX again. Everything you did not touch is copied from `source.pptx` byte for byte; everything you touched is re-emitted from the HTML.

## What the HTML looks like

- One `<section id="slide-<n>" data-title data-layout>` per Slide; each shape a direct child with `style="position:absolute; left..; top..; width..; height.."` and `transform: rotate()` when rotated. Groups are `<div data-group>` with absolutely positioned children.
- Text bodies are `<div>` with `<p>` and `<span>` runs; lists `ul`/`ol`; pictures `img`; tables `table`; media `video`/`audio`; geometries HTML cannot express are inline `<svg data-preserve>`.
- Every element from a shape carries `data-shape-id`. Leave it alone: it is how the tool knows which shape you edited. Inventing or duplicating ids is ignored (`PRESERVE_UNKNOWN_ID`).
- Theme tokens are CSS custom properties (`--theme-accent1`, `--theme-major-font`, ...), run/paragraph styles are classes (`.t1`, `.t2`, ...). Geometry is never in the stylesheet.

## Opaque content (`data-preserve`)

Charts, SmartArt, OLE objects, WordArt effects, masters/layouts/themes, animations, comments and VBA are **opaque**: shown as a positioned box (with a preview image where one exists). You may move, resize, rotate or delete the box; edits inside it are ignored (`DROPPED_EDIT_OPAQUE`, warning). To change such content, recreate it as HTML and delete the opaque box.

- New Slides instantiate the layout named by `data-layout` on the preserved master, else `Blank`.
- Animations survive on untouched Slides, and on touched Slides as long as every shape they reference still exists (`DROPPED_ANIMATION` otherwise).
- Deleting `deck.assets/` or `source.pptx`, or editing `source.pptx`, makes everything "touched": the deck is re-emitted from scratch on the built-in master (`PRESERVE_SOURCE_MISSING`, warning).

## Entries to expect

`PRESERVE_OPAQUE_*` (info) per opaque element carried through; `PRESERVE_SOURCE_MISSING` (warning); `DROPPED_EDIT_OPAQUE`, `DROPPED_ANIMATION`, `DROPPED_TEXT_EFFECTS` (warning); `DROPPED_EXTENSION` (info); `FONT_MISSING_FOR_LAYOUT` (warning) when a source font is neither installed nor embedded.
