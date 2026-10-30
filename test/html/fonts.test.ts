import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { FontCatalog, resolveDeckFonts } from '../../src/fonts/index.js';
import { loadDeck } from '../../src/html/load.js';
import { measureDeck } from '../../src/html/measure.js';
import { textBodiesOf, type Deck } from '../../src/model/index.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

function runs(deck: Deck) {
  return deck.slides.flatMap((slide) => slide.elements.flatMap((element) =>
    [...textBodiesOf(element)].flatMap(({ body }) => body.paragraphs.flatMap((paragraph) =>
      paragraph.runs.filter((run) => run.kind === 'text')))));
}

it('keeps authored browser weights when Office regular names a Medium or ExtraBold face', async () => {
  const { deck, fonts } = await measureDeck(await loadDeck('fixtures/corpus/fonts/office-identity/deck.html', {}), { browser });
  const catalog = await FontCatalog.scan({ declared: fonts.declared, system: false });
  expect(runs(deck).map((run) => [run.text, run.style.weight])).toEqual([
    ['Heebo Medium editable', 500], ['Heebo Bold editable', 700], ['Heebo ExtraBold editable', 800],
    ['Source Sans Regular editable', 400], ['Source Sans Bold editable', 700],
    ['Source Sans Italic editable', 400], ['Source Sans Bold Italic editable', 700],
  ]);
  resolveDeckFonts(deck, catalog, { embedFonts: false });
  expect(runs(deck).slice(0, 3).map((run) => [run.style.weight, run.style.font?.office])).toEqual([
    [500, { family: 'Heebo Medium', style: 'regular' }],
    [700, { family: 'Heebo', style: 'bold' }],
    [800, { family: 'Heebo ExtraBold', style: 'regular' }],
  ]);
});

it('uses the base default only for unstyled text and preserves authored inheritance without host fonts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-default-font-'));
  const regular = pathToFileURL(resolve('fixtures/corpus/fonts/_assets/source-sans-3/SourceSans3-Regular.ttf')).href;
  const medium = pathToFileURL(resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf')).href;
  try {
    const input = join(dir, 'deck.html');
    await writeFile(input, `<!doctype html><html><head><style>
      @font-face { font-family: Arial; src: url('${regular}'); }
      @font-face { font-family: Heebo; font-weight: 500; src: url('${medium}'); }
      </style></head><body><section><p>Default</p>
      <div style="font-family: Heebo; font-weight: 500"><span>Inherited</span></div></section></body></html>`);
    const { deck, fonts } = await measureDeck(await loadDeck(input, {}), { browser });
    const catalog = await FontCatalog.scan({ declared: fonts.declared, system: false });
    const entries = resolveDeckFonts(deck, catalog, { embedFonts: false });
    expect(entries.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(runs(deck).map((run) => [run.text, run.style.fontStack, run.style.weight, run.style.font?.office])).toEqual([
      ['Default', ['Arial'], 400, { family: 'Source Sans 3', style: 'regular' }],
      ['Inherited', ['Heebo'], 500, { family: 'Heebo Medium', style: 'regular' }],
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
