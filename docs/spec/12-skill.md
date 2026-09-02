# Agent skill

Decided in [#16](https://github.com/devosurf/deckflip/issues/16).

## Split of responsibilities

"Ask an agent for a PowerPoint and it just works" needs two guarantees, each owned by one side:

- **CLI**: given HTML in the subset, the PPTX is faithful and editable, and every deviation is in the report with a hint. The CLI never needs the skill.
- **Skill**: the agent writes HTML that is in the subset the first time (so the loop converges in one or two passes), knows the loop, and starts from a template that already looks like a slide deck. The skill never restates rules the CLI enforces beyond the cheat-sheet level; `deckflip <cmd> --help` and the report are the source of truth at run time.

## Format and distribution

- Agent Skills format: a directory `skills/deckflip/` with `SKILL.md` whose frontmatter is `name: deckflip` and a one-paragraph `description` (when to use: creating, converting, editing PowerPoint decks; HTML slides to PPTX and back). No harness-specific fields; instructions say "run in a shell". Claude Code reads this directly; Codex/Cursor/others via the same standard.
- Lives in the `deckflip` repo and is installed with `npx skills add devosurf/deckflip` (the `skills` CLI targets every major harness); the npm package bundles the same directory and `deckflip --help` prints the install line. One source, no separate `skill install` subcommand.
- Version coupling: SKILL.md pins nothing; it tells the agent to run `npx deckflip@latest` and to trust `--help` and the report schema's `tool.version` over the skill text if they disagree.
- Size budget: `SKILL.md` <= 250 lines; detail in `reference/` files loaded on demand (progressive disclosure).

## Directory

```
skills/deckflip/
  SKILL.md
  reference/
    authoring-subset.md    # native / raster / rejected lists (#11), text mapping summary (#12)
    report-codes.md        # every code with meaning and the fix it wants (#9, #11, #13, #14, #15)
    round-trip.md          # editing an existing PPTX: assets dir, data-preserve, untouched rules (#14)
    fonts.md               # safe set, resolution rule, embedding (#15)
  templates/
    deck.html              # canonical single-file Deck: head meta, base classes, 6 example Slides
    slides.css             # base stylesheet: Canvas-safe typography scale, layout classes
    layouts/               # one <section> each: title, section-divider, bullets, two-column,
                           # image-with-caption, big-number, closing
```

## What SKILL.md teaches (section order)

1. **When to use**: any request for a `.pptx`, editing an existing deck, or "slides" where PowerPoint is the deliverable.
2. **The loop** (verbatim from #9): write HTML -> `deckflip validate deck.html` -> fix every `error`, decide on each `warning` -> `deckflip convert deck.html --strict --json` -> read `entries[].hint` -> `deckflip render deck.pptx -o out/` and look at every PNG -> `deckflip inspect deck.pptx` to confirm structure. Exit codes and when to stop.
3. **Canvas rules**: 1280x720 CSS px, one `<section>` per Slide, `aside.notes`, `deckflip:canvas` meta, assets next to the deck (no remote URLs), fonts by concrete name.
4. **Authoring rules that avoid entries** (the cheat sheet, ten lines): text is only ever native; effects go on text-free elements; use `linear-gradient`, single `box-shadow`, uniform borders; no `filter`/`clip-path`/`mix-blend-mode` on text; `img` for photos, inline `svg` for icons (becomes a picture); lists as `ul`/`ol`; tables as `table`; `data-raster` when a picture is acceptable; `data-group` when the user should move things together.
5. **Starting from a template**: copy `templates/deck.html` + `slides.css`, compose Slides from `layouts/`, keep the typography scale (it is tuned to wrap safely at Canvas size). The templates are the only design opinion in the skill: sane defaults, no palette or imagery rules.
6. **Editing an existing PPTX**: `deckflip convert deck.pptx` -> edit the HTML in place (keep `<name>.assets/`) -> `deckflip convert deck.html`. What `data-preserve` means, that geometry edits are fine and content edits inside are ignored, what `PRESERVE_*` entries mean.
7. **Reading the report**: families, severities, `--strict`, and the rule "a warning you did not intend is a bug in your HTML, not in the tool".
8. **Pointers**: `reference/*.md` by topic; `deckflip <cmd> --help`.

## Claude Code first

Nothing Claude-specific is required: the skill is a directory of Markdown, installed into `.claude/skills/` by the `skills` CLI. The only concession is tone: imperative, short, with the loop as a numbered list, since that is what Claude Code follows most reliably.
