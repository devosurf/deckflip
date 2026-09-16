import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertHtmlToPptx, validateHtml } from '../../src/convert.js';
import { parsePptx } from '../../src/parse/index.js';

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

  it('preserves mixed inline and block text as native text in source order under strict mode', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Mixed text</title>
      <style>* { box-sizing: border-box; margin: 0; padding: 0 } body { font-family: Arial }
      section { padding: 40px } p { font-size: 20px; line-height: 1.4 }</style></head><body>
      <section><div><span>INLINE_SENTINEL</span><p>BODY_SENTINEL</p></div></section>
      <section><div><p><span>INLINE_SENTINEL</span></p><p>BODY_SENTINEL</p></div></section>
      </body></html>`);
    const output = join(dir, 'mixed.pptx');
    const result = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries).toEqual([]);
    const zip = await JSZip.loadAsync(await readFile(output));
    for (const slide of [1, 2]) {
      const xml = await zip.file(`ppt/slides/slide${slide}.xml`)!.async('string');
      expect([...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((match) => match[1]).join(''))
        .toBe('INLINE_SENTINELBODY_SENTINEL');
    }
  });

  it('keeps direct text, styled spans, and nested mixed containers editable at their measured positions', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Mixed runs</title>
      <style>* { box-sizing: border-box; margin: 0; padding: 0 }
      body { font: 20px/28px Arial } section { padding: 40px }
      .paint { background: #eee; padding: 12px; width: 500px }
      p { margin: 8px 0 } b { color: #123456 }</style></head><body><section>
      <div class="paint">Leading <b>bold</b><p>Middle</p><i>after</i> trailing
      <div>Nested <span>start</span><p>Inner</p>Nested end</div>Final</div>
      </section></body></html>`);
    const output = join(dir, 'mixed.pptx');
    const result = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(result.report.entries).toEqual([]);
    expect(result.exitCode).toBe(0);
    const deck = await parsePptx(await readFile(output));
    const shapes = deck.slides[0]!.elements.filter((el) => el.kind === 'shape').filter((el) => el.text);
    const texts = shapes.map((el) => el.text!.paragraphs.flatMap((p) => p.runs).map((r) => r.kind === 'text' ? r.text : '\n').join(''));
    expect(texts).toEqual(['Leading bold', 'Middle', 'after trailing', 'Nested start', 'Inner', 'Nested end', 'Final']);
    expect(shapes[0]!.text!.paragraphs[0]!.runs).toContainEqual(expect.objectContaining({
      kind: 'text', text: 'bold', style: expect.objectContaining({ bold: true, color: { hex: '123456', alpha: 1 } }),
    }));
    expect(shapes[2]!.text!.paragraphs[0]!.runs[0]).toMatchObject({ text: 'after', style: { italic: true } });
    expect(shapes.map((el) => el.box.x)).toEqual([52, 52, 52, 52, 52, 52, 52]);
    expect(shapes.map((el) => el.box.y)).toEqual([52, 88, 124, 152, 188, 224, 252]);
    expect(shapes.map((el) => el.box.w)).toEqual([476, 476, 476, 476, 476, 476, 476]);
  });

  it('excludes hidden branches without losing pure inline or mixed text beside them', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Visibility</title>
      <style>body { font-family: Arial } .hidden { display: none } .invisible { visibility: hidden }</style></head><body><section>
      <div>Start<span class="hidden"><b>HIDDEN</b></span><span> visible</span>
        <p>Block <span class="invisible">INVISIBLE</span>end</p>Tail</div>
      <p>Pure <b>inline</b><span class="hidden">HIDDEN</span></p>
      <div class="hidden">HIDDEN<p>HIDDEN</p></div>
      </section></body></html>`);
    const output = join(dir, 'visibility.pptx');
    const result = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(result.report.entries).toEqual([]);
    const deck = await parsePptx(await readFile(output));
    const texts = deck.slides[0]!.elements.filter((el) => el.kind === 'shape')
      .flatMap((el) => el.text?.paragraphs ?? []).map((p) => p.runs.map((r) => r.kind === 'text' ? r.text : '\n').join(''));
    expect(texts).toEqual(['Start visible', 'Block end', 'Tail', 'Pure inline']);
  });

  it('keeps mixed text native when flattening an effect, and rasterises only explicit opt-in', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Effects</title>
      <style>body { font-family: Arial } #effect { filter: blur(1px) }</style></head><body><section>
      <div id="effect"><span id="inline-effect" style="filter: contrast(.5)">Before</span><p>Body</p>After</div>
      <div data-raster><span>Raster before</span><p>Raster body</p>Raster after</div>
      </section></body></html>`);
    const output = join(dir, 'effects.pptx');
    const result = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(result.exitCode).toBe(4);
    expect(result.report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FLATTEN_CSS_FILTER', slide: 1, locator: { selector: '#effect' }, reason: expect.stringContaining('filter: blur(1px)') }),
      expect.objectContaining({ code: 'FLATTEN_CSS_FILTER', slide: 1, locator: { selector: '#inline-effect' }, reason: expect.stringContaining('contrast(0.5)') }),
      expect.objectContaining({ code: 'RASTER_EXPLICIT', slide: 1 }),
    ]));
    const deck = await parsePptx(await readFile(output));
    const text = deck.slides[0]!.elements.filter((el) => el.kind === 'shape')
      .flatMap((el) => el.text?.paragraphs ?? []).flatMap((p) => p.runs).map((r) => r.kind === 'text' ? r.text : '').join('');
    expect(text).toBe('BeforeBodyAfter');
    expect(deck.slides[0]!.elements.filter((el) => el.kind === 'picture')).toHaveLength(1);
  });

  it('applies the container transform and reports opacity on its anonymous native text', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Transformed text</title>
      <style>* { margin: 0; padding: 0 } body { font: 20px/28px Arial }
      #mixed { position: absolute; left: 100px; top: 80px; width: 400px;
        transform: scale(1.5); transform-origin: 0 0; opacity: .5 }</style></head><body>
      <section><div id="mixed">Before<p>Body</p>After</div></section></body></html>`);
    const output = join(dir, 'transformed.pptx');
    const result = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(result.exitCode).toBe(4);
    expect(result.report.entries).toContainEqual(expect.objectContaining({ code: 'SUBSTITUTE_OPACITY', locator: { selector: '#mixed' } }));
    const deck = await parsePptx(await readFile(output));
    const shapes = deck.slides[0]!.elements.filter((el) => el.kind === 'shape');
    expect(shapes[0]!.box).toEqual({ x: 100, y: 80, w: 600, h: 42 });
    expect(shapes[2]!.box).toEqual({ x: 100, y: 164, w: 600, h: 42 });
    expect(shapes[0]!.text!.paragraphs[0]!.runs[0]).toMatchObject({
      text: 'Before', style: { size: 30, color: { alpha: .5 } },
    });
    expect(shapes[0]!.text!.paragraphs[0]!.lineHeight).toBe(42);
  });

  it('retains an inline SVG picture beside mixed native text', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Inline icon</title>
      <style>body { font: 20px/28px Arial }</style></head><body><section>
      <svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="red"/></svg>
      <div>Before<p>Body</p>After</div></section></body></html>`);
    const output = join(dir, 'icon.pptx');
    const result = await convertHtmlToPptx(file, { ...options, browser, strict: false, output });
    const deck = await parsePptx(await readFile(output));
    expect(deck.slides[0]!.elements.filter((el) => el.kind === 'picture')).toHaveLength(1);
    expect(result.report.entries).toContainEqual(expect.objectContaining({ code: 'SUBSTITUTE_SVG_PICTURE' }));
  });

  it('measures anonymous flex text without inserting extra layout items', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Flex text</title>
      <style>* { margin: 0; padding: 0 } body { font: 20px/28px Arial } section { padding: 40px }
      .mixed { display: flex; align-items: center; gap: 20px; height: 100px; width: 600px }</style>
      </head><body><section><div class="mixed">Before<p>Body</p>After</div></section></body></html>`);
    const output = join(dir, 'flex.pptx');
    const result = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(result.report.entries).toEqual([]);
    const deck = await parsePptx(await readFile(output));
    const shapes = deck.slides[0]!.elements.filter((el) => el.kind === 'shape');
    expect(shapes.map((shape) => shape.box.y)).toEqual([76, 76, 76]);
    expect(shapes.map((shape) => shape.box.h)).toEqual([28, 28, 28]);
    expect(shapes[0]!.box.x).toBe(40);
    // 40px inset + Arial advances for "Before" and "Body" + two 20px gaps.
    expect(shapes[2]!.box.x).toBeCloseTo(184.53125, 1);
  });

  it('keeps text after an out-of-flow block at its measured inline position', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Inline continuation</title>
      <style>* { margin: 0; padding: 0 } body { font: 20px/28px "Courier New" } section { padding: 40px }
      p { position: absolute; left: 200px; top: 120px }</style></head><body>
      <section><div>AA<p>Block</p>ZZ</div></section></body></html>`);
    const output = join(dir, 'continuation.pptx');
    const result = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(result.report.entries).toEqual([]);
    const deck = await parsePptx(await readFile(output));
    const shapes = deck.slides[0]!.elements.filter((el) => el.kind === 'shape');
    expect(shapes.map((shape) => shape.text!.paragraphs.flatMap((p) => p.runs).map((r) => r.kind === 'text' ? r.text : '').join('')))
      .toEqual(['AA', 'Block', 'ZZ']);
    const trailing = shapes[2]!;
    expect(trailing.box.y).toBe(40);
    expect(trailing.box.x + trailing.text!.paragraphs[0]!.indent).toBeCloseTo(64, 1);
  });

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
