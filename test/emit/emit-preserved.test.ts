import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { emitPptx } from '../../src/emit/index.js';
import { emitHtml } from '../../src/htmlout/index.js';
import type { Deck, Element, ShapeElement } from '../../src/model/index.js';
import { OpcReader } from '../../src/ooxml/opc.js';
import { parsePptx } from '../../src/parse/index.js';
import { buildManifest, sectionsOf, sha256 } from '../../src/roundtrip/manifest.js';
import { planSplice } from '../../src/roundtrip/plan.js';
import { indexSource } from '../../src/roundtrip/source.js';
import { buildPptx } from '../render/pptx-fixture.js';

const text = (id: number, name: string, x: number, body: string): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="914400"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>`;
const box = (id: number, name: string, x: number): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="2743200"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="2563EB"/></a:solidFill></p:spPr></p:sp>`;
const picture = '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="3657600" y="2743200"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
const background = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFF7ED"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
const timing = (spid: number): string =>
  `<p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const created = new Date('2024-01-02T03:04:05.000Z');

async function entries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files).sort()) {
    if (!zip.files[name]!.dir) out.set(name, await zip.file(name)!.async('uint8array'));
  }
  return out;
}

const textOf = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

function byId(elements: Element[], shapeId: string): Element {
  const found = elements.find((element) => element.shapeId === shapeId);
  if (!found) throw new Error(`no ${shapeId}`);
  return found;
}

describe('emitPptx with a preserved source', () => {
  it('copies untouched slides and the deck skeleton verbatim, splices untouched shapes into edited slides with their relationships, keeps ids and timing, rewrites the slide list', async () => {
    const pptx = await buildPptx({
      slides: [
        { name: 'One', background, shapes: `${text(2, 'Title', 914400, 'Hello')}${box(3, 'Box', 914400)}${picture}`, tail: `<p:transition spd="slow"/>${timing(3)}`, rels: [['rId2', 'image', '../media/image1.png']] },
        { name: 'Two', shapes: box(7, 'Lone', 914400) },
        { name: 'Three', shapes: box(8, 'Gone', 914400) },
      ],
      layouts: { 'slideLayout2.xml': 'Title Only' },
      parts: { 'ppt/media/image1.png': png },
      contentTypes: { defaults: { png: 'image/png' } },
    });
    const sourceEntries = await entries(pptx);
    const deck = await parsePptx(pptx);
    const source = await indexSource(await OpcReader.load(pptx));
    const { html, slides } = emitHtml(deck);
    const manifest = buildManifest(html, slides, source, sha256(pptx));

    // edit the title text, delete slide 3, add a slide on the "Title Only" layout
    const edited = html.replace('Hello', 'Hallo').replace(/<section id="slide-3"[\s\S]*?<\/section>\n/, '').replace('</body>', '<section id="slide-4" data-title="New" data-layout="Title Only"><div style="position: absolute; left: 0; top: 0; width: 10px; height: 10px; background: #000"></div></section>\n</body>');
    const one = deck.slides[0]!.elements;
    const title = structuredClone(byId(one, '1-2')) as ShapeElement;
    const run = title.text!.paragraphs[0]!.runs[0]!;
    if (run.kind === 'text') run.text = 'Hallo';
    const fresh: ShapeElement = { kind: 'shape', selector: 'div', name: 'div', box: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: '000000', alpha: 1 } } };
    const measured: Deck = {
      ...deck,
      slides: [
        { ...deck.slides[0]!, elements: [title, byId(one, '1-3'), byId(one, '1-4')] },
        deck.slides[1]!,
        { index: 3, id: 'slide-4', name: 'New', layout: 'Title Only', elements: [fresh] },
      ],
    };
    const plan = planSplice(measured, sectionsOf(edited), manifest, source);
    expect(plan.entries.map((entry) => entry.code)).toEqual(['PRESERVE_OPAQUE_ANIMATION', 'PRESERVE_OPAQUE_MASTER']);

    const bytes = await emitPptx(measured, { appVersion: 'test', created, preserved: { source, plan } });
    const out = await entries(bytes);

    // untouched slide and the deck skeleton: byte for byte
    for (const part of ['ppt/slides/slide2.xml', 'ppt/slides/_rels/slide2.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/_rels/slideMaster1.xml.rels', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/slideLayout2.xml', 'ppt/theme/theme1.xml', 'docProps/core.xml', 'docProps/app.xml', '_rels/.rels', 'ppt/media/image1.png']) {
      expect(out.get(part), part).toEqual(sourceEntries.get(part));
    }
    expect(out.has('ppt/slides/slide3.xml')).toBe(false);
    expect(out.has('ppt/slides/_rels/slide3.xml.rels')).toBe(false);

    // the edited slide: rebuilt title keeping its id, spliced box and picture, shell pieces and timing kept
    const slide1 = textOf(out.get('ppt/slides/slide1.xml'));
    expect(slide1).toContain('<p:cNvPr id="2" name="Title"');
    expect(slide1).toContain('>Hallo</a:t>');
    expect(slide1).toContain(box(3, 'Box', 914400));
    expect(slide1).toContain(background);
    expect(slide1).toContain('<p:transition spd="slow"/>');
    expect(slide1).toContain(timing(3));
    expect(slide1).toContain('<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>');
    expect(slide1.match(/<p:cNvPr id="(\d+)"/g)).toEqual(['<p:cNvPr id="1"', '<p:cNvPr id="2"', '<p:cNvPr id="3"', '<p:cNvPr id="4"']);
    const embed = /<a:blip r:embed="(rId\d+)"\/>/.exec(slide1)?.[1];
    expect(embed).toBeDefined();
    expect(slide1.replace(`r:embed="${embed}"`, 'r:embed="rId2"')).toContain(picture);
    const reader = await OpcReader.load(bytes);
    const slide1Rels = await reader.relationships('/ppt/slides/slide1.xml');
    expect(slide1Rels.find((rel) => rel.id === embed)).toMatchObject({ target: '/ppt/media/image1.png', external: false });
    expect(slide1Rels.find((rel) => rel.type.endsWith('/slideLayout'))).toMatchObject({ target: '/ppt/slideLayouts/slideLayout1.xml' });

    // the new slide instantiates the named layout on a fresh part
    const slide4Rels = await reader.relationships('/ppt/slides/slide4.xml');
    expect(slide4Rels.map((rel) => rel.target)).toEqual(['/ppt/slideLayouts/slideLayout2.xml']);
    expect(textOf(out.get('ppt/slides/slide4.xml'))).toContain('<p:cSld name="New">');

    // presentation: slide list rewritten, everything else as it was
    const presentation = textOf(out.get('ppt/presentation.xml'));
    expect(presentation).toContain('<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="259" r:id="rId6"/></p:sldIdLst>');
    expect(presentation).toContain('<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>');
    const presentationRels = await reader.relationships('/ppt/presentation.xml');
    expect(presentationRels.map((rel) => [rel.id, rel.target])).toEqual([
      ['rId1', '/ppt/slideMasters/slideMaster1.xml'],
      ['rId2', '/ppt/slides/slide1.xml'],
      ['rId3', '/ppt/slides/slide2.xml'],
      ['rId5', '/ppt/theme/theme1.xml'],
      ['rId6', '/ppt/slides/slide4.xml'],
    ]);
    const contentTypes = textOf(out.get('[Content_Types].xml'));
    expect(contentTypes).toContain('<Override PartName="/ppt/slides/slide4.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>');
    expect(contentTypes).toContain('<Override PartName="/ppt/media/image1.png" ContentType="image/png"/>');
  });
  it('re-emits a moved opaque element from its source with the transform rewritten, reports what it carried and what an edit dropped', async () => {
    const chart = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>';
    const wordArt = '<p:sp><p:nvSpPr><p:cNvPr id="3" name="WordArt 2"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="2743200"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="none"><a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp></a:bodyPr><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>Arch</a:t></a:r></a:p></p:txBody></p:sp>';
    const pptx = await buildPptx({
      slides: [{ name: 'One', shapes: `${chart}${wordArt}${box(4, 'Box', 914400)}`, rels: [['rId2', 'chart', '../charts/chart1.xml']], tail: timing(4) }],
      parts: { 'ppt/charts/chart1.xml': '<c:chartSpace/>' },
      contentTypes: { overrides: { '/ppt/charts/chart1.xml': 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml' } },
      vba: true,
    });
    const deck = await parsePptx(pptx);
    const source = await indexSource(await OpcReader.load(pptx));
    const { html, slides } = emitHtml(deck);
    const manifest = buildManifest(html, slides, source, sha256(pptx));

    // move the chart, edit the WordArt text
    const edited = html.replace('left: 96px; top: 96px; width: 192px; height: 96px', 'left: 300px; top: 100px; width: 200px; height: 100px; transform: rotate(10deg)').replace('Arch', 'Arc');
    expect(edited).not.toBe(html);
    const elements = deck.slides[0]!.elements;
    const chartElement = { ...byId(elements, '1-2'), box: { x: 300, y: 100, w: 200, h: 100 }, rotation: 10 };
    const wordArtElement = structuredClone(byId(elements, '1-3')) as ShapeElement;
    const run = wordArtElement.text!.paragraphs[0]!.runs[0]!;
    if (run.kind === 'text') run.text = 'Arc';
    const measured: Deck = { ...deck, slides: [{ ...deck.slides[0]!, elements: [chartElement, wordArtElement, byId(elements, '1-4')] }] };
    const plan = planSplice(measured, sectionsOf(edited), manifest, source);
    expect(plan.entries.map((entry) => [entry.code, entry.severity, entry.locator])).toEqual([
      ['PRESERVE_OPAQUE_CHART', 'info', { selector: '[data-shape-id="1-2"]' }],
      ['DROPPED_TEXT_EFFECTS', 'warning', { selector: '[data-shape-id="1-3"]' }],
      ['PRESERVE_OPAQUE_ANIMATION', 'info', { selector: '#slide-1' }],
      ['PRESERVE_OPAQUE_MASTER', 'info', undefined],
      ['PRESERVE_OPAQUE_VBA', 'info', undefined],
    ]);

    const bytes = await emitPptx(measured, { appVersion: 'test', created, preserved: { source, plan } });
    const out = await entries(bytes);
    const slide1 = textOf(out.get('ppt/slides/slide1.xml'));
    expect(slide1).toContain(chart.replace('<p:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></p:xfrm>', '<p:xfrm rot="600000"><a:off x="2857500" y="952500"/><a:ext cx="1905000" cy="952500"/></p:xfrm>').replace('r:id="rId2"', 'r:id="rId2"'));
    expect(slide1).not.toContain('prstTxWarp');
    expect(slide1).toContain('>Arc</a:t>');
    expect(slide1).toContain(timing(4));
    expect(out.has('ppt/vbaProject.bin')).toBe(true);
    expect(out.has('ppt/charts/chart1.xml')).toBe(true);
  });
});