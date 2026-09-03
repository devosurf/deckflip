import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertPptxToHtml } from '../../src/convert.js';
import { fingerprint, parseHtml, type HtmlNode } from '../../src/roundtrip/fingerprint.js';
import { buildPptx } from '../render/pptx-fixture.js';

const HEX64 = /^[0-9a-f]{64}$/;

const box = (id: number, name: string, x: number) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></p:spPr></p:sp>`;
const picture = '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="3657600" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
// 1x1 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function findAll(node: HtmlNode, predicate: (node: HtmlNode) => boolean, out: HtmlNode[] = []): HtmlNode[] {
  if (predicate(node)) out.push(node);
  for (const child of node.children) {
    if (typeof child !== 'string') findAll(child, predicate, out);
  }
  return out;
}

describe('convertPptxToHtml round-trip attachment', () => {
  it('writes source.pptx verbatim and a manifest whose fingerprints are those of the written elements', async () => {
    const pptx = await buildPptx({
      slides: [
        { name: 'One', shapes: `${box(2, 'Box 1', 914400)}${box(3, 'Box 2', 2286000)}${picture}`, rels: [['rId2', 'image', '../media/image1.png']] },
        { name: 'Two' },
        { name: 'One' },
      ],
      parts: { 'ppt/media/image1.png': png },
      contentTypes: { defaults: { png: 'image/png' } },
    });
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-manifest-'));
    const input = join(dir, 'deck.pptx');
    await writeFile(input, pptx);

    const { outputPath, assetsDir, exitCode } = await convertPptxToHtml(input);
    expect(exitCode).toBe(0);
    expect(assetsDir).toBe(join(dir, 'deck.assets'));
    expect(Buffer.compare(await readFile(join(assetsDir, 'source.pptx')), pptx)).toBe(0);

    const manifest = JSON.parse(await readFile(join(assetsDir, 'deckflip.json'), 'utf8'));
    expect(manifest).toEqual({
      schemaVersion: 1,
      source: { sha256: createHash('sha256').update(pptx).digest('hex') },
      slides: [
        {
          id: 'slide-1',
          partName: '/ppt/slides/slide1.xml',
          fingerprint: expect.stringMatching(HEX64),
          spids: [],
          shapes: [
            { shapeId: '1-2', spids: [2], fingerprint: expect.stringMatching(HEX64), partRefs: [] },
            { shapeId: '1-3', spids: [3], fingerprint: expect.stringMatching(HEX64), partRefs: [] },
            { shapeId: '1-4', spids: [4], fingerprint: expect.stringMatching(HEX64), partRefs: ['/ppt/media/image1.png'] },
          ],
        },
        { id: 'slide-2', partName: '/ppt/slides/slide2.xml', fingerprint: expect.stringMatching(HEX64), spids: [], shapes: [] },
        { id: 'slide-3', partName: '/ppt/slides/slide3.xml', fingerprint: expect.stringMatching(HEX64), spids: [], shapes: [] },
      ],
    });

    const html = parseHtml(await readFile(outputPath, 'utf8')).find((child): child is HtmlNode => typeof child !== 'string')!;
    const written = Object.fromEntries(findAll(html, (node) => node.attrs['data-shape-id'] !== undefined).map((node) => [node.attrs['data-shape-id'], fingerprint(node)]));
    expect(written).toEqual({ '1-2': manifest.slides[0].shapes[0].fingerprint, '1-3': manifest.slides[0].shapes[1].fingerprint, '1-4': manifest.slides[0].shapes[2].fingerprint });
    // the two boxes differ only in position and name: different fingerprints
    expect(written['1-2']).not.toBe(written['1-3']);
    // the slide fingerprint covers the section shell (title, layout, section, style, notes), not its children
    expect(manifest.slides[0].fingerprint).toBe(manifest.slides[2].fingerprint);
    expect(manifest.slides[0].fingerprint).not.toBe(manifest.slides[1].fingerprint);
  });
});
