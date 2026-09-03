import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { convertHtmlToPptx, convertPptxToHtml, validateHtml } from '../../src/convert.js';
import { launchChromium } from '../../src/render/chromium.js';
import { buildPptx } from '../render/pptx-fixture.js';

const text = (id: number, name: string, x: number, body: string): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="914400"/><a:ext cx="2743200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>`;
const box = (id: number, name: string, x: number): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="2743200"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></p:spPr></p:sp>`;
const chart = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Chart 4"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="5486400" y="2743200"/><a:ext cx="1828800" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>';
const timing = (spid: number): string =>
  `<p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

async function parts(pptx: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(pptx);
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    if (!zip.files[name]!.dir) out.set(name, await zip.file(name)!.async('base64'));
  }
  return out;
}

const browserAvailable = await launchChromium({ offline: true }).then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

describe.skipIf(!browserAvailable)('PPTX -> HTML -> PPTX round trip', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchChromium({ offline: true });
  });
  afterAll(async () => {
    await browser.close();
  });

  const options = { embedFonts: false as const, rasterDpi: 96, strict: false, offline: true };

  async function fixture(): Promise<{ dir: string; pptx: Buffer; html: string }> {
    const pptx = await buildPptx({
      slides: [
        { name: 'One', shapes: `${text(2, 'Title', 914400, 'Hello there')}${box(3, 'Box', 914400)}`, tail: timing(3) },
        { name: 'Two', shapes: `${box(4, 'Lone', 914400)}${chart}`, rels: [['rId2', 'chart', '../charts/chart1.xml']] },
      ],
      parts: { 'ppt/charts/chart1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>' },
      contentTypes: { overrides: { '/ppt/charts/chart1.xml': 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml' } },
    });
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-roundtrip-'));
    await writeFile(join(dir, 'deck.pptx'), pptx);
    const { outputPath } = await convertPptxToHtml(join(dir, 'deck.pptx'));
    return { dir, pptx, html: outputPath };
  }

  it('reproduces every part byte for byte when the HTML is untouched', async () => {
    const { dir, pptx, html } = await fixture();
    const output = join(dir, 'back.pptx');
    const result = await convertHtmlToPptx(html, { ...options, browser, output });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries.map((entry) => [entry.code, entry.slide])).toEqual([['PRESERVE_OPAQUE_ANIMATION', 1], ['PRESERVE_OPAQUE_CHART', 2], ['PRESERVE_OPAQUE_MASTER', undefined]]);
    expect(await parts(await readFile(output))).toEqual(await parts(pptx));
  });

  it('re-emits only the edited shape, keeps the chart it cannot represent, and drops the animation of a deleted target', async () => {
    const { dir, pptx, html } = await fixture();
    const before = await parts(pptx);
    const edited = (await readFile(html, 'utf8')).replace('Hello there', 'Hello again').replace(/<div data-shape-id="1-3"[^>]*><\/div>\n/, '');
    expect(edited).not.toBe(await readFile(html, 'utf8'));
    await writeFile(html, edited);
    const output = join(dir, 'back.pptx');
    const validated = await validateHtml(html, { ...options, browser });
    const result = await convertHtmlToPptx(html, { ...options, browser, output });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries.map((entry) => [entry.code, entry.slide])).toEqual([['DROPPED_ANIMATION', 1], ['PRESERVE_OPAQUE_CHART', 2], ['PRESERVE_OPAQUE_MASTER', undefined]]);
    expect(validated.report.entries).toEqual(result.report.entries);

    const after = await parts(await readFile(output));
    for (const part of ['ppt/slides/slide2.xml', 'ppt/slides/_rels/slide2.xml.rels', 'ppt/charts/chart1.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/theme/theme1.xml', 'ppt/presentation.xml', 'docProps/core.xml']) {
      expect(after.get(part), part).toBe(before.get(part));
    }
    const slide1 = Buffer.from(after.get('ppt/slides/slide1.xml')!, 'base64').toString('utf8');
    expect(slide1).toContain('>Hello again</a:t>');
    expect(slide1).toContain('<p:cNvPr id="2" name="div"');
    expect(slide1).not.toContain('name="Box"');
    expect(slide1).not.toContain('<p:timing>');
  });

  it('warns once and re-emits everything on the built-in master when the Asset directory is gone', async () => {
    const { dir, html } = await fixture();
    await rm(join(dir, 'deck.assets'), { recursive: true });
    const output = join(dir, 'back.pptx');
    const result = await convertHtmlToPptx(html, { ...options, browser, output });
    expect(result.exitCode).toBe(0);
    expect(result.report.entries.map((entry) => [entry.code, entry.severity])).toEqual([['PRESERVE_SOURCE_MISSING', 'warning']]);
    expect(result.report.entries[0]!.hint).toContain('deck.assets');
    const after = await parts(await readFile(output));
    expect(after.has('ppt/charts/chart1.xml')).toBe(false);
    expect(after.has('ppt/slides/slide2.xml')).toBe(true);
  });
});
