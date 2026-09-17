import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import JSZip from 'jszip';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { convertHtmlToPptx, convertPptxToHtml } from '../../src/convert.js';
import { launchChromium } from '../../src/render/chromium.js';
import { parsePptx } from '../../src/parse/index.js';
import { buildPptx } from '../render/pptx-fixture.js';

type Rectangle = [number, number, number, number];

function transform(box: Rectangle, childBox?: Rectangle, attributes = ''): string {
  const [x, y, w, h] = box.map((value) => value * 9525);
  const child = childBox?.map((value) => value * 9525);
  return `<a:xfrm ${attributes}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/>${child ? `<a:chOff x="${child[0]}" y="${child[1]}"/><a:chExt cx="${child[2]}" cy="${child[3]}"/>` : ''}</a:xfrm>`;
}

function group(id: number, box: Rectangle, childBox: Rectangle, children: string, attributes = ''): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${transform(box, childBox, attributes)}</p:grpSpPr>${children}</p:grpSp>`;
}

function text(id: number, box: Rectangle): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${transform(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"/><a:p><a:r><a:rPr sz="1000"><a:latin typeface="Arial"/></a:rPr><a:t>GROUP_SENTINEL</a:t></a:r></a:p></p:txBody></p:sp>`;
}

const browserAvailable = await launchChromium({ offline: true }).then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

describe.skipIf(!browserAvailable)('group coordinate spaces', () => {
  let browser: Browser;
  const directories: string[] = [];
  beforeAll(async () => { browser = await launchChromium({ offline: true }); });
  afterAll(async () => {
    await browser.close();
    await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function fixture(shapes: string, picture?: Uint8Array): Promise<{ dir: string; pptx: Buffer; html: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-groups-'));
    directories.push(dir);
    const pptx = await buildPptx({
      slides: [{ shapes, rels: picture ? [['rId2', 'image', '../media/picture.png']] : [] }],
      ...(picture ? { parts: { 'ppt/media/picture.png': picture }, contentTypes: { defaults: { png: 'image/png' } } } : {}),
    });
    const source = join(dir, 'deck.pptx');
    await writeFile(source, pptx);
    const { outputPath: html } = await convertPptxToHtml(source);
    return { dir, pptx, html };
  }

  async function rectangle(html: string, id: number): Promise<Rectangle> {
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(html).href);
      return await page.locator(`[data-shape-id="1-${id}"]`).evaluate((el) => {
        const canvas = document.querySelector('section')!.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return [box.x - canvas.x, box.y - canvas.y, box.width, box.height];
      });
    } finally {
      await page.close();
    }
  }

  // Corner probes distinguish reflection from rotation even when their bounding rectangles coincide.
  async function corners(html: string, id: number): Promise<number[]> {
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(html).href);
      return await page.locator(`[data-shape-id="1-${id}"]`).evaluate((el) => {
        const canvas = document.querySelector('section')!.getBoundingClientRect();
        return ['left:0;top:0', 'right:0;top:0', 'right:0;bottom:0', 'left:0;bottom:0'].flatMap((position) => {
          const probe = document.createElement('span');
          probe.style.cssText = `position:absolute;width:0;height:0;${position}`;
          el.append(probe);
          const point = probe.getBoundingClientRect();
          probe.remove();
          return [point.x - canvas.x, point.y - canvas.y];
        });
      });
    } finally {
      await page.close();
    }
  }

  function expectRectangle(actual: Rectangle, expected: Rectangle): void {
    for (let i = 0; i < 4; i += 1) expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(0.02);
  }

  it('renders the supplied child at its scaled Canvas-relative rectangle', async () => {
    const { html } = await fixture(group(2, [100, 100, 400, 100], [0, 0, 200, 200], text(3, [20, 40, 100, 40])));
    expectRectangle(await rectangle(html, 3), [140, 120, 200, 20]);
  });

  it('keeps nested nonuniform scales and nonzero child origins after editing one child', async () => {
    const nested = group(4, [30, 60, 80, 120], [5, 15, 40, 60], text(5, [15, 25, 20, 10]));
    const { dir, html } = await fixture(group(2, [100, 100, 400, 100], [10, 20, 200, 200], nested + text(3, [60, 80, 20, 40])));
    expectRectangle(await rectangle(html, 5), [180, 130, 80, 10]);
    expectRectangle(await rectangle(html, 3), [200, 130, 40, 20]);
    await writeFile(html, (await readFile(html, 'utf8')).replace('GROUP_SENTINEL', 'EDITED_CHILD'));
    const result = await convertHtmlToPptx(html, {
      browser, output: join(dir, 'back.pptx'), embedFonts: false, rasterDpi: 96, strict: false, offline: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries.filter((entry) => /^(RASTER|FLATTEN)_/.test(entry.code))).toEqual([]);
    const { outputPath } = await convertPptxToHtml(join(dir, 'back.pptx'), { output: join(dir, 'back.html') });
    expect(await readFile(outputPath, 'utf8')).toContain('EDITED_CHILD');
    expectRectangle(await rectangle(outputPath, 5), [180, 130, 80, 10]);
    expectRectangle(await rectangle(outputPath, 3), [200, 130, 40, 20]);
  });

  it.each([
    { attributes: 'rot="5400000" flipH="1"', expected: [310, 310, 20, 200] },
    { attributes: 'rot="5400000" flipV="true"', expected: [270, 190, 20, 200] },
    { attributes: 'rot="5400000" flipH="true" flipV="1"', expected: [270, 310, 20, 200] },
    { attributes: 'rot="1800000"', expected: [166.435935, 244.019238, 183.205081, 117.320508] },
  ] satisfies Array<{ attributes: string; expected: Rectangle }>)('retains scale and orientation through an edited round trip: $attributes', async ({ attributes, expected }) => {
    const { dir, html } = await fixture(group(2, [100, 300, 400, 100], [0, 0, 200, 200], text(3, [20, 40, 100, 40]), attributes));
    expectRectangle(await rectangle(html, 3), expected);
    const before = await corners(html, 3);
    await writeFile(html, (await readFile(html, 'utf8')).replace('GROUP_SENTINEL', 'EDITED_CHILD'));
    const result = await convertHtmlToPptx(html, {
      browser, output: join(dir, 'back.pptx'), embedFonts: false, rasterDpi: 96, strict: false, offline: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries.filter((entry) => /^(RASTER|FLATTEN)_/.test(entry.code))).toEqual([]);
    const { outputPath } = await convertPptxToHtml(join(dir, 'back.pptx'), { output: join(dir, 'back.html') });
    expectRectangle(await rectangle(outputPath, 3), expected);
    const after = await corners(outputPath, 3);
    for (let i = 0; i < before.length; i += 1) expect(Math.abs(after[i]! - before[i]!)).toBeLessThanOrEqual(0.02);
  });

  it('keeps visible descendants whose rotated group uses child coordinates outside the Canvas', async () => {
    const nested = group(4, [2030, 3060, 80, 120], [2005, 3015, 40, 60], text(5, [2010, 3025, 10, 10]), 'rot="5400000" flipH="1"');
    const { dir, html } = await fixture(group(2, [100, 100, 400, 100], [2010, 3020, 200, 200], nested));
    expectRectangle(await rectangle(html, 5), [260, 155, 40, 10]);
    await writeFile(html, (await readFile(html, 'utf8')).replace('GROUP_SENTINEL', 'EDITED_CHILD'));
    const result = await convertHtmlToPptx(html, {
      browser, output: join(dir, 'back.pptx'), embedFonts: false, rasterDpi: 96, strict: false, offline: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries.filter((entry) => /OFFCANVAS|^(RASTER|FLATTEN)_/.test(entry.code))).toEqual([]);
    const { outputPath } = await convertPptxToHtml(join(dir, 'back.pptx'), { output: join(dir, 'back.html') });
    expectRectangle(await rectangle(outputPath, 5), [260, 155, 40, 10]);
  });

  it.each([2000, -2000])('captures rasterised children at child origin %i without baking in nested group transforms', async (origin) => {
    const nested = group(4, [origin + 30, 3060, 80, 120], [origin + 5, 3015, 40, 60], text(5, [origin + 10, 3025, 10, 10]), 'rot="5400000" flipH="1"');
    const { dir, html } = await fixture(group(2, [100, 100, 400, 100], [origin + 10, 3020, 200, 200], nested));
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(html).href);
      await page.locator('[data-shape-id="1-5"]').evaluate((el) => {
        el.setAttribute('data-raster', '');
        el.setAttribute('style', `${el.getAttribute('style')}; background: linear-gradient(to right, red 50%, blue 50%)`);
        el.replaceChildren();
      });
      await writeFile(html, await page.content());
    } finally {
      await page.close();
    }
    const output = join(dir, 'raster.pptx');
    const result = await convertHtmlToPptx(html, {
      browser, output, embedFonts: false, rasterDpi: 96, strict: false, offline: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries.filter((entry) => /OFFCANVAS|^RASTER_/.test(entry.code)).map((entry) => entry.code)).toEqual(['RASTER_EXPLICIT']);
    const deck = await parsePptx(await readFile(output));
    const outer = deck.slides[0]!.elements[0]!;
    if (outer.kind !== 'group') throw new Error('Expected outer group');
    const inner = outer.children[0]!;
    if (inner.kind !== 'group') throw new Error('Expected inner group');
    const picture = inner.children[0]!;
    if (picture.kind !== 'picture') throw new Error('Expected rasterised child');
    const image = await loadImage(Buffer.from(picture.media.data));
    // At 96 DPI the 40px-wide result needs at least 40 samples despite its 10px child-space width.
    expect(image.width).toBeGreaterThanOrEqual(40);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    expect(Array.from(ctx.getImageData(image.width / 4, image.height / 2, 1, 1).data)).toEqual([255, 0, 0, 255]);
    expect(Array.from(ctx.getImageData(image.width * 3 / 4, image.height / 2, 1, 1).data)).toEqual([0, 0, 255, 255]);
    const { outputPath } = await convertPptxToHtml(output, { output: join(dir, 'raster.html') });
    expectRectangle(await rectangle(outputPath, 5), [260, 155, 40, 10]);
  });

  it('preserves Untouched source parts and keeps edited grouped text and pictures native', async () => {
    const canvas = createCanvas(2, 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(0, 0, 2, 2);
    const image = canvas.toBuffer('image/png');
    const picture = `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform([150, 80, 40, 60])}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    const { dir, pptx, html } = await fixture(group(2, [100, 100, 400, 100], [10, 20, 200, 200], text(3, [20, 40, 100, 40]) + picture), image);
    const options = { browser, embedFonts: false as const, rasterDpi: 96, strict: false, offline: true };
    const untouched = join(dir, 'untouched.pptx');
    expect((await convertHtmlToPptx(html, { ...options, output: untouched })).exitCode).toBe(0);
    const before = await JSZip.loadAsync(pptx);
    const after = await JSZip.loadAsync(await readFile(untouched));
    const files = (zip: JSZip): string[] => Object.keys(zip.files).filter((name) => !zip.files[name]!.dir).sort();
    expect(files(after)).toEqual(files(before));
    for (const name of files(before)) expect(await after.file(name)!.async('uint8array'), name).toEqual(await before.file(name)!.async('uint8array'));

    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(html).href);
      await page.locator('[data-shape-id="1-3"] span').evaluate((el) => { el.textContent = 'EDITED_CHILD'; });
      await page.locator('[data-shape-id="1-4"]').evaluate((el) => {
        if (!(el instanceof HTMLImageElement)) throw new Error('The picture must remain an img');
        el.style.left = `${parseFloat(el.style.left) + 10}px`;
        el.style.width = `${parseFloat(el.style.width) + 20}px`;
      });
      await writeFile(html, await page.content());
    } finally {
      await page.close();
    }
    const output = join(dir, 'edited.pptx');
    const result = await convertHtmlToPptx(html, { ...options, output });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries.filter((entry) => /^(RASTER|FLATTEN)_/.test(entry.code))).toEqual([]);
    const deck = await parsePptx(await readFile(output));
    const editedGroup = deck.slides[0]!.elements[0]!;
    expect(editedGroup.kind).toBe('group');
    if (editedGroup.kind !== 'group') throw new Error('Expected a native group');
    const editedText = editedGroup.children.find((element) => element.kind === 'shape');
    expect(editedText?.text?.paragraphs.flatMap((paragraph) => paragraph.runs).filter((run) => run.kind === 'text').map((run) => run.text).join('')).toBe('EDITED_CHILD');
    const editedPicture = editedGroup.children.find((element) => element.kind === 'picture');
    expect(editedPicture?.media.data).toEqual(new Uint8Array(image));
    const { outputPath } = await convertPptxToHtml(output, { output: join(dir, 'edited.html') });
    expectRectangle(await rectangle(outputPath, 3), [120, 110, 200, 20]);
    expectRectangle(await rectangle(outputPath, 4), [400, 130, 120, 30]);
  });
});
