import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'playwright-core';
import { comparePng } from '../../src/render/compare.js';
import { findSoffice, renderPptxLibreOffice } from '../../src/render/libreoffice.js';
import { launchChromium, renderHtml } from '../../src/render/chromium.js';
import { loadDeck } from '../../src/html/load.js';
import { convertHtmlToPptx } from '../../src/convert.js';

/** Chromium screenshot vs LibreOffice render of the converted deck (spec 10), plus the expected report entries. */
export const LIBREOFFICE_GATE_PERCENT = 2.0;

function normaliseEntries(entries: readonly unknown[]): string[] {
  return [...entries].map((entry) => JSON.stringify(entry)).sort();
}

export function corpusGate(category: string, fixtures: readonly string[]): void {
  describe.skipIf(!findSoffice())(`${category} corpus`, () => {
    let browser: Browser | undefined;

    beforeAll(async () => {
      browser = await launchChromium({ offline: true });
    });

    afterAll(async () => {
      await browser?.close();
    });

    for (const name of fixtures) {
      it(name, async () => {
        const fixtureDir = join('fixtures', 'corpus', category, name);
        const deckPath = join(fixtureDir, 'deck.html');
        const loaded = await loadDeck(deckPath, {});
        const workDir = await mkdtemp(join(tmpdir(), `deckflip-corpus-${name}-`));
        const pptxPath = join(workDir, `${name}.pptx`);
        const { report } = await convertHtmlToPptx(deckPath, {
          output: pptxPath,
          embedFonts: false,
          rasterDpi: 192,
          strict: false,
          offline: true,
          browser: browser!,
        });

        const expectedEntries = JSON.parse(await readFile(join(fixtureDir, 'expected', 'report.json'), 'utf8')) as unknown[];
        expect(normaliseEntries(report.entries)).toEqual(normaliseEntries(expectedEntries));

        const chromiumDir = join(fixtureDir, 'expected', 'chromium');
        await mkdir(chromiumDir, { recursive: true });
        const chromiumPages = await renderHtml(loaded, { browser: browser!, dpi: 96 });
        for (const [index, png] of chromiumPages) {
          await writeFile(join(chromiumDir, `slide-${String(index).padStart(3, '0')}.png`), png);
        }

        const libreOfficePages = await renderPptxLibreOffice(pptxPath, { dpi: 96 });
        const rows: Array<{ slide: number; diffPercentage: string }> = [];
        for (const [index, expectedPng] of chromiumPages) {
          const actualPng = libreOfficePages.get(index);
          expect(actualPng).toBeDefined();
          const expectedPath = join(chromiumDir, `slide-${String(index).padStart(3, '0')}.png`);
          const actualPath = join(workDir, `slide-${String(index).padStart(3, '0')}.png`);
          await writeFile(actualPath, actualPng!);
          const diff = await comparePng(expectedPath, actualPath, {});
          rows.push({ slide: index, diffPercentage: diff.diffPercentage.toFixed(3) });
          expect(diff.diffPercentage).toBeLessThanOrEqual(LIBREOFFICE_GATE_PERCENT);
        }
        console.table(rows);
      });
    }
  });
}
