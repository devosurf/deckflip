import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { convertHtmlToPptx } from '../../src/convert.js';
import { emitPptx } from '../../src/emit/index.js';
import { parsePptx } from '../../src/parse/index.js';
import { launchChromium } from '../../src/render/chromium.js';

/**
 * Idempotence at the IDM seam (spec 10, "HTML -> PPTX -> HTML -> PPTX"): the corpus deck converted once, read
 * back with `parsePptx` and emitted again must reproduce every slide and media part byte for byte. Until
 * `htmlout` exists this is the PPTX -> IDM -> PPTX half of that gate. Fixtures join the list once the parser
 * covers everything the emitter wrote for them; `shapes/borders` (per-side `p:cxnSp` lines), `layout/overlap`
 * and `layout/flex-grid` (`p:grpSp`) and the `tables` category (`a:tbl`) wait on those readers.
 */
const FIXTURES: ReadonlyArray<[category: string, name: string]> = [
  ['text', 'spike'],
  ['text', 'wrapping'],
  ['text', 'mixed-sizes'],
  ['text', 'alignment'],
  ['text', 'lists'],
  ['text', 'rtl'],
  ['text', 'emoji'],
  ['shapes', 'fills'],
  ['shapes', 'effects'],
  ['pictures', 'fit'],
  ['pictures', 'formats'],
  ['pictures', 'svg'],
  ['layout', 'offcanvas'],
  ['raster', 'css-filter'],
  ['raster', 'backdrop-filter'],
  ['raster', 'blend-mode'],
  ['raster', 'mask'],
  ['raster', 'clip-path'],
  ['raster', 'gradient'],
  ['raster', 'shadow'],
  ['raster', 'border-style'],
  ['raster', 'border-image'],
  ['raster', 'transform'],
  ['raster', 'outline'],
  ['raster', 'explicit'],
  ['templates', 'deck'],
];

const created = new Date('2024-01-02T03:04:05.000Z');

async function slideAndMediaParts(pptx: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(pptx);
  const parts = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    if (name.startsWith('ppt/slides/') || name.startsWith('ppt/media/')) {
      parts.set(name, await zip.file(name)!.async('base64'));
    }
  }
  return parts;
}

const browserAvailable = await launchChromium({ offline: true }).then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

describe.skipIf(!browserAvailable)('roundtrip corpus: PPTX -> IDM -> PPTX part identity', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchChromium({ offline: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  for (const [category, name] of FIXTURES) {
    it(`${category}/${name}`, async () => {
      const deckPath = join('fixtures', 'corpus', category, name, 'deck.html');
      const workDir = await mkdtemp(join(tmpdir(), `deckflip-roundtrip-${name}-`));
      const firstPath = join(workDir, 'first.pptx');
      await convertHtmlToPptx(deckPath, { output: firstPath, embedFonts: false, rasterDpi: 192, strict: false, offline: true, browser });
      const first = await readFile(firstPath);

      const deck = await parsePptx(first);
      const second = await emitPptx(deck, { created, appVersion: '0.0.0' });

      const before = await slideAndMediaParts(first);
      const after = await slideAndMediaParts(second);
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [part, content] of before) {
        expect(after.get(part), part).toBe(content);
      }
    });
  }
});
