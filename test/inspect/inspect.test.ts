import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { loadDeck } from '../../src/html/load.js';
import { measureDeck } from '../../src/html/measure.js';
import { inspectDeck } from '../../src/inspect/index.js';

const browserAvailable = await chromium.launch().then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

describe.skipIf(!browserAvailable)('inspectDeck', () => {
  it('marks rasterised pictures with their source and whether the author asked for them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-inspect-'));
    const file = join(dir, 'deck.html');
    await writeFile(file, `<!doctype html><html><head><title>Deck</title><style>
      .a, .b { position: absolute; top: 40px; width: 200px; height: 100px; background: #369 }
      .a { left: 40px; mix-blend-mode: multiply }
      .b { left: 400px }
    </style></head><body><section id="s1"><div class="a" id="a"></div><div class="b" id="b" data-raster></div><p id="p">text</p></section></body></html>`, 'utf8');
    const browser = await chromium.launch();
    try {
      const measured = await measureDeck(await loadDeck(file, {}), { browser });
      const json = inspectDeck(measured.deck);
      expect(json.slides[0]!.elements).toEqual([
        { kind: 'picture', source: 'raster', explicit: false, selector: '#a', box: { x: 40, y: 40, w: 200, h: 100 } },
        { kind: 'picture', source: 'raster', explicit: true, selector: '#b', box: { x: 400, y: 40, w: 200, h: 100 } },
        { kind: 'text', source: 'native', selector: '#p', box: expect.any(Object), text: 'text' },
      ]);
    } finally {
      await browser.close();
    }
  });
});
