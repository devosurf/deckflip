# Editing an existing PPTX (round trip)

Availability: `deckflip convert deck.pptx` writes the HTML Deck and its Asset directory; `deckflip convert deck.html` splices the untouched parts back. `deckflip validate deck.pptx` lists what the round trip keeps opaque before you start.

## The flow

1. `deckflip convert deck.pptx` writes `deck.html` and `deck.assets/` (`source.pptx` verbatim, `media/`, `fonts/`, `previews/`, and the manifest `deckflip.json`).
2. Edit `deck.html` in place. Keep `deck.assets/` beside it: it is the blob store the way back reads from.
3. `deckflip convert deck.html` writes the PPTX again. Everything you did not touch is copied from `source.pptx` byte for byte; everything you touched is re-emitted from the HTML.

## What the HTML looks like

- One `<section id="slide-<n>" data-title data-layout>` per Slide; each shape a direct child with `style="position:absolute; left..; top..; width..; height.."` and `transform: rotate()` when rotated. Groups are `<div data-group>` with absolutely positioned children.
- Text bodies are `<div>` with `<p>` and `<span>` runs; lists `ul`/`ol`; pictures `img`; tables `table`; media `video`/`audio`; content HTML cannot show is an empty `div[data-preserve="<class>"]` box labelled by its `title`.
- Every element from a shape carries `data-shape-id`. Leave it alone: it is how the tool knows which shape you edited. Inventing or duplicating ids is ignored (`PRESERVE_UNKNOWN_ID`).
- Theme tokens are CSS custom properties (`--theme-accent1`, `--theme-major-font`, ...), run/paragraph styles are classes (`.t1`, `.t2`, ...). Geometry is never in the stylesheet.

## Opaque content (`data-preserve`)

Charts, SmartArt, OLE objects, connectors and metafile pictures (`data-preserve="chart|smartart|ole|vector"`), WordArt effects (`data-preserve="text-effects"` on an editable text box), masters/layouts/themes, animations, comments and VBA are **opaque**: shown as an empty positioned box labelled with the shape name. You may move, resize, rotate or delete the box; anything written inside it is ignored (`DROPPED_EDIT_OPAQUE`, warning). To change such content, recreate it as HTML and delete the opaque box.

- New Slides instantiate the layout named by `data-layout` on the preserved master, else `Blank`.
- Animations survive on untouched Slides, and on touched Slides as long as every shape they reference still exists (`DROPPED_ANIMATION` otherwise).
- Deleting `deck.assets/` or `source.pptx`, or editing `source.pptx`, makes everything "touched": the deck is re-emitted from scratch on the built-in master (`PRESERVE_SOURCE_MISSING`, warning).

## Entries to expect

`PRESERVE_OPAQUE_*` (info) per opaque element carried through; `PRESERVE_SOURCE_MISSING` (warning); `DROPPED_EDIT_OPAQUE`, `DROPPED_ANIMATION`, `DROPPED_TEXT_EFFECTS` (warning); `DROPPED_EXTENSION` (info); `FONT_MISSING_FOR_LAYOUT` (warning) when a source font is neither installed nor embedded.
