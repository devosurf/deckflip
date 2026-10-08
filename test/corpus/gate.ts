import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'playwright-core';
import { comparePng, type IgnoreRegion } from '../../src/render/compare.js';
import { findSoffice, renderPptxLibreOffice } from '../../src/render/libreoffice.js';
import { launchChromium, renderHtml } from '../../src/render/chromium.js';
import { loadDeck } from '../../src/html/load.js';
import { convertHtmlToPptx } from '../../src/convert.js';
import { ORACLE_RECORD, packageDigest, type OracleRecord } from './oracle-record.js';

/**
 * Optional `expected/ignore.json`: `{ "<slide>": [{ x1, y1, x2, y2 }] }` in CSS px, for regions the fixture
 * deliberately renders differently (a flattened effect the spec says is dropped). Keep them small and named in
 * the fixture's deck.html, so the gate still covers everything the converter is meant to reproduce.
 */
async function ignoreRegions(fixtureDir: string, slide: number): Promise<IgnoreRegion[]> {
  const path = join(fixtureDir, 'expected', 'ignore.json');
  const json = await readFile(path, 'utf8').catch(() => undefined);
  if (json === undefined) {
    return [];
  }
  const regions = JSON.parse(json) as Record<string, IgnoreRegion[]>;
  return regions[String(slide)] ?? [];
}

/**
 * Chromium screenshot vs the committed PowerPoint render of the converted deck (spec 10), per Slide: calibrated on
 * the 41 corpus Slides against PowerPoint for Mac 16.115 (median 0.42 %, ceiling 1.14 % on text/alignment).
 */
export const POWERPOINT_GATE_PERCENT = 1.25;
/** Chromium screenshot vs LibreOffice, an opt-in local comparison (`DECKFLIP_LIBREOFFICE_GATE=1`), not a CI gate. */
export const LIBREOFFICE_GATE_PERCENT = 2.6;
const LIBREOFFICE_GATE = Boolean(process.env.DECKFLIP_LIBREOFFICE_GATE);

function normaliseEntries(entries: readonly unknown[]): string[] {
  return [...entries].map((entry) => JSON.stringify(entry)).sort();
}

export function corpusGate(category: string, fixtures: readonly string[]): void {
  describe(`${category} corpus`, () => {
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

        const reoracle = `run \`npm run corpus:oracle ${category}/${name}\` on a Mac with PowerPoint and review the renders`;
        const recordText = await readFile(join(fixtureDir, 'expected', ORACLE_RECORD), 'utf8').catch(() => undefined);
        expect(recordText, `${category}/${name} has no ${ORACLE_RECORD}: ${reoracle}`).toBeDefined();
        const record = JSON.parse(recordText!) as OracleRecord;
        expect(await packageDigest(await readFile(pptxPath)), `${category}/${name} emits another package than PowerPoint rendered: ${reoracle}`).toBe(record.digest);

        const chromiumDir = join(fixtureDir, 'expected', 'chromium');
        await mkdir(chromiumDir, { recursive: true });
        const chromiumPages = await renderHtml(loaded, { browser: browser!, dpi: 96 });
        const libreOfficePages = LIBREOFFICE_GATE && findSoffice() ? await renderPptxLibreOffice(pptxPath, { dpi: 96 }) : undefined;
        const rows: Array<{ slide: number; powerpoint: string; libreoffice?: string }> = [];
        for (const [index, png] of chromiumPages) {
          const file = `slide-${String(index).padStart(3, '0')}.png`;
          const chromiumPath = join(chromiumDir, file);
          await writeFile(chromiumPath, png);
          const regions = await ignoreRegions(fixtureDir, index);
          const powerpoint = await comparePng(chromiumPath, join(fixtureDir, 'expected', 'powerpoint', file), { ignoreRegions: regions });
          const row: (typeof rows)[number] = { slide: index, powerpoint: powerpoint.diffPercentage.toFixed(3) };
          expect(powerpoint.diffPercentage, `${category}/${name} slide ${index} against PowerPoint`).toBeLessThanOrEqual(POWERPOINT_GATE_PERCENT);
          const libreOfficePng = libreOfficePages?.get(index);
          if (libreOfficePng) {
            const libreOfficePath = join(workDir, file);
            await writeFile(libreOfficePath, libreOfficePng);
            const libreoffice = await comparePng(chromiumPath, libreOfficePath, { ignoreRegions: regions });
            row.libreoffice = libreoffice.diffPercentage.toFixed(3);
            expect(libreoffice.diffPercentage, `${category}/${name} slide ${index} against LibreOffice`).toBeLessThanOrEqual(LIBREOFFICE_GATE_PERCENT);
          }
          rows.push(row);
        }
        console.table(rows);
      });
    }
  });
}
