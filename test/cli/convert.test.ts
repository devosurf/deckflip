import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertHtmlToPptx, validateHtml } from '../../src/convert.js';

const browserAvailable = await chromium.launch().then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

async function writeTempDeck(html: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-convert-'));
  const file = join(dir, 'deck.html');
  await writeFile(file, html, 'utf8');
  return { dir, file };
}

const RASTER_DECK = `<!doctype html><html><head><title>Deck</title><style>
  .badge { position: absolute; left: 100px; top: 50px; width: 200px; height: 100px; background: #00f; filter: blur(3px) }
  .hero { position: absolute; left: 100px; top: 300px; width: 400px; height: 100px; background: #eee; mix-blend-mode: multiply }
</style></head><body>
  <section><div class="badge"></div><div class="hero"><p>Editable</p></div></section>
  <section><div class="badge" data-raster></div></section>
</body></html>`;

describe.skipIf(!browserAvailable)('convert and validate', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  const options = { embedFonts: false as const, rasterDpi: 96, offline: true };

  it('validate reports exactly the entries convert would, without writing a PPTX', async () => {
    const { dir, file } = await writeTempDeck(RASTER_DECK);
    const validated = await validateHtml(file, { ...options, browser });
    const converted = await convertHtmlToPptx(file, { ...options, browser, strict: false, output: join(dir, 'out.pptx') });

    expect(validated.exitCode).toBe(0);
    expect(validated.report.entries.map((entry) => [entry.code, entry.slide])).toEqual([
      ['FLATTEN_BLEND_MODE', 1],
      ['RASTER_CSS_FILTER', 1],
      ['RASTER_EXPLICIT', 2],
    ]);
    expect(validated.report.summary).toEqual({ slides: 2, native: 3, rasterised: 2, flattened: 1, substituted: 0, dropped: 0, preserved: 0, overridden: 0, errors: 0 });
    expect(validated.report.command).toBe('validate');
    await expect(stat(join(dir, 'deck.pptx'))).rejects.toThrow();
    expect((await stat(join(dir, 'out.pptx'))).size).toBeGreaterThan(0);
  });

  it('strict mode still writes the PPTX and the report but exits 4 when the report is non-empty', async () => {
    const { dir, file } = await writeTempDeck(RASTER_DECK);
    const output = join(dir, 'strict.pptx');
    const converted = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(converted.exitCode).toBe(4);
    expect((await stat(output)).size).toBeGreaterThan(0);
    const sidecar = JSON.parse(await readFile(`${output}.report.json`, 'utf8')) as { entries: unknown[] };
    expect(sidecar.entries).toHaveLength(3);
  });

  it('a validation error exits 2 with the report written and no PPTX', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Deck</title></head><body><section><p style="hyphens:auto">x</p><iframe src="a.html"></iframe></section></body></html>`);
    const output = join(dir, 'bad.pptx');
    const converted = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(converted.exitCode).toBe(2);
    expect(converted.report.entries.map((entry) => entry.code)).toEqual(['VALIDATE_ELEMENT']);
    await expect(stat(output)).rejects.toThrow();
    expect((await stat(`${output}.report.json`)).size).toBeGreaterThan(0);
  });
});
