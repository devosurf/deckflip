import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { convertHtmlToPptx, convertPptxToHtml } from '../../src/convert.js';
import { emitPptx } from '../../src/emit/index.js';
import { parsePptx } from '../../src/parse/index.js';
import { launchChromium } from '../../src/render/chromium.js';

/**
 * Two gates over the whole corpus (spec 10):
 * - PPTX -> IDM -> PPTX: the corpus deck converted once, read back with `parsePptx` and emitted again must
 *   reproduce every slide and media part byte for byte (the parser covers everything the emitter wrote).
 * - PPTX -> HTML -> PPTX untouched: the same PPTX written out as an HTML Deck and converted straight back must
 *   come out with every zip entry byte-identical, the manifest having found every Slide untouched.
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
  ['shapes', 'borders'],
  ['pictures', 'fit'],
  ['pictures', 'formats'],
  ['pictures', 'svg'],
  ['layout', 'offcanvas'],
  ['layout', 'overlap'],
  ['layout', 'flex-grid'],
  ['tables', 'content'],
  ['tables', 'borders'],
  ['tables', 'spans'],
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

async function allParts(pptx: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(pptx);
  const parts = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    if (!zip.files[name]!.dir) parts.set(name, await zip.file(name)!.async('base64'));
  }
  return parts;
}

describe.skipIf(!browserAvailable)('roundtrip corpus: PPTX -> HTML -> PPTX untouched part identity', () => {
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
      const workDir = await mkdtemp(join(tmpdir(), `deckflip-untouched-${name}-`));
      const convert = { embedFonts: false as const, rasterDpi: 192, strict: false, offline: true, browser };
      const firstPath = join(workDir, 'first.pptx');
      await convertHtmlToPptx(deckPath, { ...convert, output: firstPath });
      const { outputPath: htmlPath } = await convertPptxToHtml(firstPath, { output: join(workDir, 'first.html') });
      const backPath = join(workDir, 'back.pptx');
      const back = await convertHtmlToPptx(htmlPath, { ...convert, output: backPath });
      const unexpected = back.report.entries.filter((entry) => (entry.code.startsWith('PRESERVE_') && !entry.code.startsWith('PRESERVE_OPAQUE_')) || entry.code.startsWith('DROPPED_'));
      expect(unexpected, JSON.stringify(back.report.entries, null, 1)).toEqual([]);
      expect(await allParts(await readFile(backPath))).toEqual(await allParts(await readFile(firstPath)));
    });
  }
});
