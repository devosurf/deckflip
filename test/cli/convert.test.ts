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
    expect(validated.report.summary).toEqual({ slides: 2, native: 3, rasterised: 2, flattened: 1, substituted: 0, dropped: 0, preserved: 0, overridden: 0, flagged: 0, errors: 0 });
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

  it('writes the PPTX and its report but exits 5, strict or not, when Verification finds text the PPTX lost', async () => {
    // A visible child of a visibility:hidden container is painted by Chromium but skipped by the measurement walk.
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Lost</title>
      <style>body { font: 20px/28px Arial } .ghost { visibility: hidden } #shown { visibility: visible }</style></head><body>
      <section><p>Kept text</p><div class="ghost"><p id="shown">LOST_SENTINEL</p></div></section></body></html>`);
    for (const strict of [false, true]) {
      const output = join(dir, `lost-${strict}.pptx`);
      const converted = await convertHtmlToPptx(file, { ...options, browser, strict, output });
      expect(converted.exitCode).toBe(5);
      expect(converted.report.entries).toEqual([
        expect.objectContaining({ code: 'VERIFY_TEXT_MISSING', severity: 'error', slide: 1, locator: { selector: '#shown' }, reason: expect.stringContaining('LOST_SENTINEL') }),
      ]);
      expect(converted.report.summary.errors).toBe(1);
      expect((await stat(output)).size).toBeGreaterThan(0);
      expect(JSON.parse(await readFile(`${output}.report.json`, 'utf8'))).toEqual(converted.report);
    }
  });

  it('keeps text an overflow:hidden ancestor clips native and complete, and reports the clip', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Clip</title><style>
      * { margin: 0; padding: 0 } body { font: 16px/24px Arial }
      .clip { position: absolute; left: 40px; top: 40px; width: 300px; height: 24px; overflow: hidden; background: #eee }
      .fits { position: absolute; left: 400px; top: 40px; width: 300px; height: 48px; overflow: hidden }
    </style></head><body><section>
      <div class="clip"><p id="clipped">CLIP_ONE visible, then CLIP_TWO and CLIP_THREE are clipped away by the parent</p></div>
      <div class="fits"><p>Short enough</p></div>
    </section></body></html>`);
    const output = join(dir, 'clip.pptx');
    const converted = await convertHtmlToPptx(file, { ...options, browser, strict: true, output });
    expect(converted.report.entries).toEqual([
      expect.objectContaining({ code: 'FLATTEN_OVERFLOW_CLIP', kind: 'flattened', severity: 'warning', slide: 1, locator: { selector: '#clipped' }, reason: expect.stringContaining('overflow: hidden') }),
    ]);
    expect(converted.exitCode).toBe(4);
    const deck = await parsePptx(await readFile(output));
    const texts = deck.slides[0]!.elements.flatMap((el) => (el.kind === 'shape' && el.text ? [el.text.paragraphs.flatMap((p) => p.runs).map((r) => (r.kind === 'text' ? r.text : '')).join('')] : []));
    expect(texts).toContain('CLIP_ONE visible, then CLIP_TWO and CLIP_THREE are clipped away by the parent');
  });

  it('reports ::before and ::after content it cannot convert, text and painted boxes alike', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Generated</title><style>
      * { margin: 0; padding: 0 } body { font: 16px/24px Arial } section { padding: 40px }
      ul { list-style: none } li { padding-left: 20px; position: relative }
      li::before { content: '\\2014'; position: absolute; left: 0; color: #c00 }
      #tag::after { content: ''; display: block; width: 80px; height: 6px; background: #c00 }
      #plain::after { content: '' }
    </style></head><body><section>
      <ul><li id="item">ITEM_ONE</li></ul><p id="tag">TAG_TEXT</p><p id="plain">PLAIN_TEXT</p>
    </section></body></html>`);
    const validated = await validateHtml(file, { ...options, browser });
    expect(validated.report.entries).toEqual([
      expect.objectContaining({ code: 'DROPPED_GENERATED_CONTENT', kind: 'dropped', severity: 'warning', slide: 1, locator: { selector: '#item' }, reason: expect.stringContaining('::before') }),
      expect.objectContaining({ code: 'DROPPED_GENERATED_CONTENT', kind: 'dropped', severity: 'warning', slide: 1, locator: { selector: '#tag' }, reason: expect.stringContaining('::after') }),
    ]);
  });

  it('flags text spilling out of its painted box, but not text that fits or misses by under a pixel', async () => {
    const { file } = await writeTempDeck(`<!doctype html><html><head><title>Overflow</title><style>
      * { margin: 0; padding: 0 } body { font: 16px/24px Arial }
      .card { position: absolute; top: 40px; width: 300px; height: 24px; background: #fde }
      #spill { left: 40px } #fits { left: 400px; height: 48px } #inner-card { left: 800px; height: 30px }
      #tight { left: 400px; top: 200px; height: 23.5px }
    </style></head><body><section>
      <p id="spill" class="card">SPILL_ONE and then SPILL_TWO SPILL_THREE SPILL_FOUR spill below the pink box</p>
      <p id="fits" class="card">Fits inside</p><p id="tight" class="card">Half a pixel short</p>
      <div id="inner-card" class="card"><p id="inner">INNER_ONE and then INNER_TWO INNER_THREE spill below the card</p></div>
    </section></body></html>`);
    const validated = await validateHtml(file, { ...options, browser });
    expect(validated.report.entries).toEqual([
      expect.objectContaining({ code: 'LAYOUT_TEXT_OVERFLOW', kind: 'flagged', severity: 'warning', slide: 1, locator: { selector: '#spill' } }),
      expect.objectContaining({ code: 'LAYOUT_TEXT_OVERFLOW', kind: 'flagged', severity: 'warning', slide: 1, locator: { selector: '#inner' }, reason: expect.stringContaining('div#inner-card') }),
    ]);
    expect(validated.report.summary).toMatchObject({ flagged: 2, errors: 0 });
  });

  it('flags Text blocks whose lines overlap, once per pair, but not lines that only touch', async () => {
    const { file } = await writeTempDeck(`<!doctype html><html><head><title>Overlap</title><style>
      * { margin: 0; padding: 0 } body { font: 28px/32px Arial } p { position: absolute; width: 500px }
      #first { left: 40px; top: 200px } #second { left: 60px; top: 210px; color: #c00 }
      #above { left: 40px; top: 400px } #below { left: 40px; top: 432px }
    </style></head><body><section>
      <p id="first">OVERLAP_FIRST heading</p><p id="second">OVERLAP_SECOND heading</p>
      <p id="above">Touching above</p><p id="below">Touching below</p>
    </section></body></html>`);
    const validated = await validateHtml(file, { ...options, browser });
    expect(validated.report.entries).toEqual([
      expect.objectContaining({ code: 'LAYOUT_TEXT_OVERLAP', kind: 'flagged', slide: 1, locator: { selector: '#second' }, reason: expect.stringContaining('p#first') }),
    ]);
  });

  it('flags nearly invisible text, not muted grey or text over a picture, and strict mode exits 4 on flags alone', async () => {
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Contrast</title><style>
      * { margin: 0; padding: 0 } body { font: 16px/24px Arial } p { position: absolute; left: 40px; width: 400px }
      #faint { top: 40px; color: #f4f4f4 } #muted { top: 80px; color: #999 }
      .dark { position: absolute; left: 600px; top: 40px; width: 300px; height: 100px; background: #036 }
      #light { left: 20px; top: 20px; color: #fff } #lost { left: 20px; top: 50px; color: #024 }
      img { position: absolute; left: 40px; top: 200px; width: 300px; height: 100px }
      #over-image { top: 240px; color: #fafafa }
    </style></head><body><section>
      <p id="faint">FAINT_SENTINEL</p><p id="muted">Muted grey</p>
      <div class="dark"><p id="light">White on navy</p><p id="lost">Navy on navy</p></div>
      <img src="pixel.png"><p id="over-image">Over the picture</p>
    </section></body></html>`);
    await writeFile(join(dir, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const converted = await convertHtmlToPptx(file, { ...options, browser, strict: true, output: join(dir, 'contrast.pptx') });
    expect(converted.report.entries).toEqual([
      expect.objectContaining({ code: 'LAYOUT_TEXT_ILLEGIBLE', kind: 'flagged', slide: 1, locator: { selector: '#faint' }, reason: expect.stringContaining('f4f4f4') }),
      expect.objectContaining({ code: 'LAYOUT_TEXT_ILLEGIBLE', kind: 'flagged', slide: 1, locator: { selector: '#lost' } }),
    ]);
    expect(converted.exitCode).toBe(4);
  });

  it('flags a paragraph whose first line nearly fills its width while the next word nearly fits, and not one with room', async () => {
    // Widths come from Chromium itself: the risky paragraph leaves half of " a" either side of its break, far
    // inside PowerPoint's calibrated line-width tolerance at 12 px; the roomy one leaves 20 px before a long word.
    const page = await browser.newPage();
    const width = (text: string) => page.evaluate((content) => {
      const span = document.createElement('span');
      span.style.cssText = 'font: 12px Arial; white-space: pre; position: absolute';
      span.textContent = content;
      document.body.append(span);
      return span.getBoundingClientRect().width;
    }, text);
    const first = 'Quarterly revenue grew faster than planned across every region in the third quarter of the year';
    const risky = (await width(first)) + (await width(' a')) / 2;
    const roomy = (await width(first)) + 20;
    await page.close();
    const { file } = await writeTempDeck(`<!doctype html><html><head><title>Wrap risk</title><style>
      * { margin: 0; padding: 0 } p { position: absolute; left: 40px; font: 12px/18px Arial }
    </style></head><body><section>
      <p id="risky" style="top: 40px; width: ${risky}px">${first} a closing clause</p>
      <p id="roomy" style="top: 120px; width: ${roomy}px">${first} afterwards closing</p>
    </section></body></html>`);
    const validated = await validateHtml(file, { ...options, browser });
    expect(validated.report.entries).toEqual([
      expect.objectContaining({ code: 'LAYOUT_WRAP_RISK', kind: 'flagged', severity: 'warning', slide: 1, locator: { selector: '#risky' } }),
    ]);
  });

  it('widens a painted box by at most 1 px for the wrap guard, and flags the block when that leaves PowerPoint too little room', async () => {
    const page = await browser.newPage();
    const width = await page.evaluate(() => {
      const span = document.createElement('span');
      span.style.cssText = 'font: 16px Arial; white-space: pre; position: absolute';
      span.textContent = 'A filled label without padding';
      document.body.append(span);
      return span.getBoundingClientRect().width;
    });
    await page.close();
    const { dir, file } = await writeTempDeck(`<!doctype html><html><head><title>Painted guard</title><style>
      * { margin: 0; padding: 0 } p { position: absolute; left: 40px; font: 16px/24px Arial; background: #fde }
    </style></head><body><section>
      <p id="tight" style="top: 40px; width: ${width}px">A filled label without padding</p>
    </section></body></html>`);
    const output = join(dir, 'painted.pptx');
    const converted = await convertHtmlToPptx(file, { ...options, browser, strict: false, output });
    expect(converted.report.entries).toEqual([
      expect.objectContaining({ code: 'LAYOUT_WRAP_RISK', slide: 1, locator: { selector: '#tight' } }),
    ]);
    const shape = (await parsePptx(await readFile(output))).slides[0]!.elements[0]!;
    expect(shape.box.w - width).toBeGreaterThan(0);
    expect(shape.box.w - width).toBeLessThan(1.001); // 1 px, to EMU rounding
  });
});
