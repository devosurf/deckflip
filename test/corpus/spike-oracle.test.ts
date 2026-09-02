import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { comparePng } from '../../src/render/compare.js';
import { launchChromium, renderHtml } from '../../src/render/chromium.js';
import { renderPptxPowerPoint } from '../../src/render/powerpoint.js';
import { loadDeck } from '../../src/html/load.js';
import { convertHtmlToPptx } from '../../src/convert.js';

const shouldRunOracle = process.platform === 'darwin' && existsSync('/Applications/Microsoft PowerPoint.app') && Boolean(process.env.DECKFLIP_ORACLE);

describe.skipIf(!shouldRunOracle)('spike oracle', () => {
  let browser: Browser | undefined;

  beforeAll(async () => {
    browser = await launchChromium({ offline: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('keeps the spike slide within the oracle gate', async () => {
    const fixtureDir = join('fixtures', 'corpus', 'text', 'spike');
    const deckPath = join(fixtureDir, 'deck.html');
    const loaded = await loadDeck(deckPath, {});
    const workDir = await mkdtemp(join(tmpdir(), 'deckflip-spike-oracle-'));
    const pptxPath = join(workDir, 'spike.pptx');
    await convertHtmlToPptx(deckPath, {
      output: pptxPath,
      embedFonts: false,
      rasterDpi: 192,
      strict: false,
      offline: true,
      browser: browser!,
    });

    const chromiumPages = await renderHtml(loaded, { browser: browser!, dpi: 96 });
    const pptxPages = await renderPptxPowerPoint(pptxPath, { dpi: 96 });
    const expectedPath = join(workDir, 'chromium-slide-001.png');
    const actualPath = join(workDir, 'powerpoint-slide-001.png');
    await writeFile(expectedPath, chromiumPages.get(1)!);
    await writeFile(actualPath, pptxPages.get(1)!);
    const diff = await comparePng(expectedPath, actualPath, {});
    console.table([{ slide: 1, diffPercentage: diff.diffPercentage.toFixed(3) }]);
    expect(diff.diffPercentage).toBeLessThanOrEqual(0.8);
  });
});
