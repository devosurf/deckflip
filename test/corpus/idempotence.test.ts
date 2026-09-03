import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { convertHtmlToPptx, convertPptxToHtml } from '../../src/convert.js';
import { launchChromium } from '../../src/render/chromium.js';

/**
 * Idempotence gate (spec 10, "HTML -> PPTX -> HTML -> PPTX"): the corpus deck converted to PPTX, back to an
 * HTML Deck with `htmlout`, and converted again must reproduce every slide and media part byte for byte.
 *
 * `KNOWN_FAILURES` name fixtures the round trip cannot reproduce yet, with the reason; they run as `it.fails`
 * so the gate stays complete and flips when the cause is fixed:
 * - `text/lists`: the measurer reads an outside marker's hanging indent as the marker string's text advance
 *   but an inside marker's as Chromium's marker box (`measure.test.ts` pins both); the IDM carries no marker
 *   position, so an inside list comes back outside with the other indent.
 * - `raster/transform`: a skewed element's capture box is not on the 1/64 px layout grid and its capture is
 *   re-sampled when re-captured at that fractional position, so the media bytes differ.
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

const KNOWN_FAILURES = new Set(['text/lists', 'raster/transform']);

async function slideAndMediaParts(pptx: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(pptx);
  const parts = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    if (name.startsWith('ppt/slides/') || name.startsWith('ppt/media/')) {
      parts.set(name, await zip.file(name)!.async(name.startsWith('ppt/media/') ? 'base64' : 'text'));
    }
  }
  return parts;
}

const browserAvailable = await launchChromium({ offline: true }).then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

describe.skipIf(!browserAvailable)('idempotence corpus: HTML -> PPTX -> HTML -> PPTX part identity', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchChromium({ offline: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  for (const [category, name] of FIXTURES) {
    const test = KNOWN_FAILURES.has(`${category}/${name}`) ? it.fails : it;
    test(`${category}/${name}`, async () => {
      const deckPath = join('fixtures', 'corpus', category, name, 'deck.html');
      const workDir = await mkdtemp(join(tmpdir(), `deckflip-idempotence-${name}-`));
      const convert = { embedFonts: false as const, rasterDpi: 192, strict: false, offline: true, browser };
      const firstPath = join(workDir, 'first.pptx');
      await convertHtmlToPptx(deckPath, { ...convert, output: firstPath });
      const { outputPath: htmlPath } = await convertPptxToHtml(firstPath, { output: join(workDir, 'first.html') });
      const secondPath = join(workDir, 'second.pptx');
      const second = await convertHtmlToPptx(htmlPath, { ...convert, output: secondPath });
      expect(second.exitCode, JSON.stringify(second.report.entries, null, 1)).toBe(0);

      const before = await slideAndMediaParts(await readFile(firstPath));
      const after = await slideAndMediaParts(await readFile(secondPath));
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [part, content] of before) {
        expect(after.get(part), part).toBe(content);
      }
    });
  }
});
