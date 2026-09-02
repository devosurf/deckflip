import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FontCatalog, resolveDeckFonts } from '../../src/fonts/index.js';
import type { Deck, DeckFontFace, RunStyle, ShapeElement } from '../../src/model/index.js';
import type { Entry } from '../../src/report/types.js';

const arialPath = '/System/Library/Fonts/Supplemental/Arial.ttf';
const arialBoldPath = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const georgiaPath = '/System/Library/Fonts/Supplemental/Georgia.ttf';

const hasLocalFonts = [arialPath, arialBoldPath, georgiaPath].every((file) => existsSync(file));
let catalog: FontCatalog | undefined;

describe.skipIf(!hasLocalFonts)('fonts', () => {
  beforeAll(async () => {
    catalog = await FontCatalog.scan({ extraFiles: [arialPath, arialBoldPath, georgiaPath], system: false });
  });

  it('resolves Arial metrics and weight selection', () => {
    const arial = catalog!.find('Arial', 400, false);
    expect(arial).toBeDefined();
    expect(arial?.family).toBe('Arial');
    expect(arial?.file).toBe(arialPath);
    expect(arial?.weight).toBe(400);
    expect(arial?.italic).toBe(false);
    expect(arial?.metrics.ascender).toBe(1854 / 2048);
    expect(arial?.metrics.descender).toBe(434 / 2048);

    const arialBold = catalog!.find('Arial', 700, false);
    expect(arialBold).toBeDefined();
    expect(arialBold?.file).toBe(arialBoldPath);
    expect(arialBold?.weight).toBe(700);
  });

  it('resolves concrete fonts, generics and unresolved stacks as expected', () => {
    const concrete = resolveForStack(catalog!, ['Foo', 'Arial']);
    expect(concrete.entries).toHaveLength(0);
    expect(concrete.run.font).toMatchObject({ family: 'Arial', class: 'safe' });

    const genericOnly = resolveForStack(catalog!, ['sans-serif', 'Arial']);
    expect(genericOnly.entries).toHaveLength(1);
    expect(genericOnly.entries[0]?.code).toBe('FONT_GENERIC_ONLY');
    expect(genericOnly.entries[0]?.hint).toBe('Put a concrete family before sans-serif');
    expect(genericOnly.run.font).toBeUndefined();

    // A generic reached before any concrete match is always GENERIC_ONLY: Chromium resolves it, we cannot.
    const genericFallback = resolveForStack(catalog!, ['Nope', 'sans-serif']);
    expect(genericFallback.entries[0]?.code).toBe('FONT_GENERIC_ONLY');
    expect(genericFallback.entries[0]?.hint).toBe('Put a concrete family before sans-serif');

    const unresolved = resolveForStack(catalog!, ['Nope', 'Other Nope']);
    expect(unresolved.entries).toHaveLength(1);
    expect(unresolved.entries[0]?.code).toBe('FONT_UNRESOLVED');
    expect(unresolved.entries[0]?.hint).toBe('Install Nope or add a safe family such as Arial to the stack');
    expect(unresolved.run.font).toBeUndefined();
  });

  it('treats a deck-provided face as deck-provided', () => {
    const deckProvided = resolveForStack(catalog!, ['Georgia'], [
      {
        family: 'Georgia',
        file: georgiaPath,
      },
    ]);

    expect(deckProvided.run.font).toMatchObject({ family: 'Georgia', file: georgiaPath, class: 'deck-provided' });
    expect(deckProvided.entries).toHaveLength(1);
    expect(deckProvided.entries[0]).toMatchObject({ code: 'FONT_NOT_SAFE', severity: 'warning', kind: 'substituted' });
  });

  it.skipIf(process.env.CI)('scan() finds Arial and Helvetica on this machine', async () => {
    const systemCatalog = await FontCatalog.scan();
    expect(systemCatalog.find('Arial', 400, false)).toBeDefined();
    expect(systemCatalog.find('Helvetica', 400, false)).toBeDefined();
  });

  function resolveForStack(fontCatalog: FontCatalog, stack: string[], fontFaces: DeckFontFace[] = []): ResolvedFixture {
    const run = makeRunStyle(stack);
    const deck = {
      title: 'font test',
      lang: 'en',
      canvas: { width: 1280, height: 720, source: 'default' as const },
      fontFaces,
      slides: [
        {
          index: 1,
          id: 'slide-1',
          name: 'Slide 1',
          layout: 'Blank',
          elements: [makeShape(run)],
        },
      ],
    } satisfies Deck;
    const entries = resolveDeckFonts(deck, fontCatalog, { embedFonts: false });
    return { deck, run, entries };
  }

  function makeShape(run: RunStyle): ShapeElement {
    return {
      kind: 'shape',
      selector: 'section[data-slide="1"] > div',
      name: 'div#font-test',
      box: { x: 0, y: 0, w: 100, h: 100 },
      rotation: 0,
      geometry: { preset: 'rect' },
      text: {
        padding: { l: 0, t: 0, r: 0, b: 0 },
        firstParagraphGap: 0,
        lastParagraphGap: 0,
        wrap: true,
        rtl: false,
        trailingGuard: 0,
        paragraphs: [
          {
            align: 'l',
            lineHeight: 16,
            spaceBefore: 0,
            spaceAfter: 0,
            indent: 0,
            level: 0,
            runs: [
              {
                kind: 'text',
                text: 'Font test',
                style: run,
              },
            ],
          },
        ],
      },
    };
  }

  function makeRunStyle(stack: string[]): RunStyle {
    return {
      fontStack: stack,
      weight: 400,
      size: 16,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      color: { hex: '000000', alpha: 1 },
      letterSpacing: 0,
      caps: 'none',
      baseline: 0,
    };
  }
});


interface ResolvedFixture {
  deck: Deck;
  run: RunStyle;
  entries: Entry[];
}
