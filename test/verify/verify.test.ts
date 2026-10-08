import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertHtmlToPptx, convertPptxToHtml, verifyConversion } from '../../src/convert.js';
import { launchChromium } from '../../src/render/chromium.js';
import { buildPptx } from '../render/pptx-fixture.js';

const browserAvailable = await launchChromium({ offline: true }).then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

const DECK = `<!doctype html><html><head><title>Verify</title><style>
  * { box-sizing: border-box; margin: 0; padding: 0 } body { font-family: Arial }
  section { padding: 40px } p { font-size: 20px; line-height: 28px; width: 600px }
</style></head><body>
  <section><p id="first">ALPHA_SENTINEL stays</p><p id="second">BRAVO_SENTINEL goes</p></section>
</body></html>`;

describe.skipIf(!browserAvailable)('Verification of an HTML Deck against its PPTX', () => {
  let browser: Browser;
  const directories: string[] = [];
  beforeAll(async () => { browser = await launchChromium({ offline: true }); });
  afterAll(async () => {
    await browser.close();
    await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function converted(html: string): Promise<{ deck: string; pptx: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-verify-'));
    directories.push(dir);
    const deck = join(dir, 'deck.html');
    await writeFile(deck, html, 'utf8');
    const pptx = join(dir, 'deck.pptx');
    await convertHtmlToPptx(deck, { output: pptx, embedFonts: false, rasterDpi: 96, strict: false, offline: true, browser });
    return { deck, pptx };
  }

  async function editSlide(pptx: string, edit: (xml: string) => string): Promise<Buffer> {
    const zip = await JSZip.loadAsync(await readFile(pptx));
    const part = 'ppt/slides/slide1.xml';
    zip.file(part, edit(await zip.file(part)!.async('string')));
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(pptx, bytes);
    return bytes;
  }

  it('reports Visible text the PPTX lost, at the source Text block, with exit 5 and the output untouched', async () => {
    const { deck, pptx } = await converted(DECK);
    const edited = await editSlide(pptx, (xml) => xml.replace('BRAVO_SENTINEL', ''));

    const result = await verifyConversion(deck, pptx, { offline: true, browser });

    expect(result.exitCode).toBe(5);
    expect(result.report.command).toBe('verify');
    expect(result.report.entries).toEqual([
      expect.objectContaining({ code: 'VERIFY_TEXT_MISSING', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#second' }, reason: expect.stringContaining('BRAVO_SENTINEL') }),
    ]);
    expect(await readFile(pptx)).toEqual(edited);
  });

  it('finds nothing to report for a faithful conversion of split words, breaks, lists, tables, transforms and notes', async () => {
    const { deck, pptx } = await converted(`<!doctype html><html><head><title>Clean</title><style>
      * { box-sizing: border-box; margin: 0; padding: 0 } body { font: 20px/28px Arial } section { padding: 40px }
      .caps { text-transform: uppercase } .hidden { display: none } .ghost { visibility: hidden } td { border: 1px solid #000 }
    </style></head><body><section>
      <p>Hel<b>lo</b> wor<i>ld</i> soft\u00ADhyphen</p>
      <p>first line<br>second line</p>
      <p class="caps">shouted words</p>
      <p>shown <span class="hidden">HIDDEN_SENTINEL</span><span class="ghost">GHOST_SENTINEL</span></p>
      <div>Leading <p>Middle</p>trailing</div>
      <ul><li>one item</li><li>two item<ul><li>nested item</li></ul></li></ul>
      <table><tr><td>cell a</td><td>cell b</td></tr></table>
      <aside class="notes"><p>Note <strong>one</strong></p><ul><li>note two</li></ul></aside>
    </section></body></html>`);

    const result = await verifyConversion(deck, pptx, { offline: true, browser });

    expect(result.report.entries).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('reports text the PPTX shows that the source does not, and speaker notes the PPTX lost', async () => {
    const { deck, pptx } = await converted(DECK.replace('</section>', '<aside class="notes"><p>NOTES_SENTINEL</p></aside></section>'));
    await editSlide(pptx, (xml) => xml.replace('ALPHA_SENTINEL', 'ALPHA_SENTINEL INTRUDER_SENTINEL'));
    const zip = await JSZip.loadAsync(await readFile(pptx));
    const notesPart = Object.keys(zip.files).find((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))!;
    zip.file(notesPart, (await zip.file(notesPart)!.async('string')).replace('NOTES_SENTINEL', ''));
    await writeFile(pptx, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await verifyConversion(deck, pptx, { offline: true, browser });

    expect(result.exitCode).toBe(5);
    expect(result.report.entries).toEqual([
      expect.objectContaining({ code: 'VERIFY_TEXT_EXTRA', slide: 1, reason: expect.stringContaining('INTRUDER_SENTINEL') }),
      expect.objectContaining({ code: 'VERIFY_TEXT_MISSING', slide: 1, locator: { selector: 'aside.notes' }, reason: expect.stringContaining('NOTES_SENTINEL') }),
    ]);
  });

  it('reports a Painting element the PPTX misplaced, at its source element', async () => {
    const { deck, pptx } = await converted(DECK);
    await editSlide(pptx, (xml) => xml.replace(/(name="p#second"[\s\S]*?<a:off x=")(\d+)/, (_match, head: string, x: string) => `${head}${Number(x) + 20 * 9525}`));

    const result = await verifyConversion(deck, pptx, { offline: true, browser });

    expect(result.exitCode).toBe(5);
    expect(result.report.entries).toEqual([
      expect.objectContaining({ code: 'VERIFY_GEOMETRY', slide: 1, locator: { selector: '#second' }, reason: expect.stringContaining('20') }),
    ]);
  });

  it('reports an element the PPTX stacks below another one that Chromium paints over it', async () => {
    const { deck, pptx } = await converted(`<!doctype html><html><head><title>Stack</title><style>
      * { box-sizing: border-box; margin: 0; padding: 0 } body { font: 20px/28px Arial }
      #card { position: absolute; left: 40px; top: 40px; width: 400px; height: 200px; background: #036 }
      #over { position: absolute; left: 80px; top: 80px; width: 300px; color: #fff }
    </style></head><body><section><div id="card"></div><p id="over">STACK_SENTINEL</p></section></body></html>`);
    await editSlide(pptx, (xml) => {
      const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g)!;
      const card = shapes.find((shape) => shape.includes('name="div#card"'))!;
      const over = shapes.find((shape) => shape.includes('name="p#over"'))!;
      return xml.replace(card, '\u0000').replace(over, card).replace('\u0000', over);
    });

    const result = await verifyConversion(deck, pptx, { offline: true, browser });

    expect(result.exitCode).toBe(5);
    expect(result.report.entries).toEqual([
      expect.objectContaining({ code: 'VERIFY_STACKING', slide: 1, locator: { selector: '#over' }, reason: expect.stringContaining('div#card') }),
    ]);
  });
});

/** A scaled group (the DF-02 shape): `chExt` is half `ext` horizontally and double it vertically. */
function scaledGroupPptx(): Promise<Buffer> {
  const xfrm = (x: number, y: number, w: number, h: number, child?: [number, number, number, number]) =>
    `<a:xfrm><a:off x="${x * 9525}" y="${y * 9525}"/><a:ext cx="${w * 9525}" cy="${h * 9525}"/>${child ? `<a:chOff x="${child[0] * 9525}" y="${child[1] * 9525}"/><a:chExt cx="${child[2] * 9525}" cy="${child[3] * 9525}"/>` : ''}</a:xfrm>`;
  const text = (id: number, words: string, box: [number, number, number, number]) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(...box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"/><a:p><a:r><a:rPr sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>${words}</a:t></a:r></a:p></p:txBody></p:sp>`;
  return buildPptx({ slides: [{ shapes: `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Group 2"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(100, 100, 400, 100, [0, 0, 200, 200])}</p:grpSpPr>${text(3, 'GROUP_SENTINEL', [20, 40, 100, 40])}</p:grpSp>${text(4, 'LOOSE_SENTINEL', [600, 400, 200, 40])}` }] });
}

describe.skipIf(!browserAvailable)('Verification of a PPTX against its HTML Deck', () => {
  let browser: Browser;
  const directories: string[] = [];
  beforeAll(async () => { browser = await launchChromium({ offline: true }); });
  afterAll(async () => {
    await browser.close();
    await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function converted(): Promise<{ pptx: string; html: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-verify-pptx-'));
    directories.push(dir);
    const pptx = join(dir, 'deck.pptx');
    await writeFile(pptx, await scaledGroupPptx());
    const { outputPath } = await convertPptxToHtml(pptx, { offline: true, browser });
    return { pptx, html: outputPath };
  }

  it('finds a scaled group and its text where the PPTX puts them', async () => {
    const { pptx, html } = await converted();

    const result = await verifyConversion(pptx, html, { offline: true, browser });

    expect(result.report.entries).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('reports a shape the HTML misplaced and text it lost, at the PPTX shape', async () => {
    const { pptx, html } = await converted();
    const original = await readFile(html, 'utf8');
    const edited = original
      .replace(/(data-shape-id="1-4"[^>]*?left:\s*)(-?[\d.]+)px/, (_match, head: string, left: string) => `${head}${Number(left) + 20}px`)
      .replace('GROUP_SENTINEL', '');
    expect(edited).not.toBe(original);
    await writeFile(html, edited);

    const result = await verifyConversion(pptx, html, { offline: true, browser });

    expect(result.exitCode).toBe(5);
    expect(result.report.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VERIFY_TEXT_MISSING', slide: 1, locator: { shapeId: '1-3', name: 'Text 3' }, reason: expect.stringContaining('GROUP_SENTINEL') }),
      expect.objectContaining({ code: 'VERIFY_GEOMETRY', slide: 1, locator: { shapeId: '1-4', name: 'Text 4' }, reason: expect.stringContaining('20 px') }),
    ]));
    expect(result.report.entries).toHaveLength(2);
  });

  it('keeps the children of a bordered section where the PPTX puts them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-verify-border-'));
    directories.push(dir);
    const deck = join(dir, 'deck.html');
    await writeFile(deck, `<!doctype html><html><head><title>Border</title><style>
      * { box-sizing: border-box; margin: 0; padding: 0 } body { font: 20px/28px Arial }
      section { background: #fdfcfa; border-top: 6px solid #d6342a; border-left: 4px solid #d6342a }
      p { position: absolute; left: 40px; top: 40px; width: 400px }
    </style></head><body><section><p>BORDER_SENTINEL</p></section></body></html>`);
    const pptx = join(dir, 'deck.pptx');
    expect((await convertHtmlToPptx(deck, { output: pptx, embedFonts: false, rasterDpi: 96, strict: false, offline: true, browser })).exitCode).toBe(0);

    const result = await convertPptxToHtml(pptx, { output: join(dir, 'back.html'), offline: true, browser });

    expect(result.report.entries.filter((entry) => entry.code.startsWith('VERIFY_'))).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
