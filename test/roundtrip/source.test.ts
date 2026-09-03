import { describe, expect, it } from 'vitest';
import { OpcReader } from '../../src/ooxml/opc.js';
import { indexSource } from '../../src/roundtrip/source.js';
import { buildPptx } from '../render/pptx-fixture.js';

const title = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rId4"/></a:rPr><a:t>A &amp; B</a:t></a:r></a:p></p:txBody></p:sp>';
const picture = '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture 2"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic>';
const inner = '<p:sp><p:nvSpPr><p:cNvPr id="5" name="Inner"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm></p:spPr></p:sp>';
const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group 3"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:grpSp>`;
const chart = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Chart 5"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>';
const background = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
const timing = '<p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';

describe('indexSource', () => {
  it('lists slides in presentation order with byte-exact shape fragments, nested ids, part references and slide-level pieces', async () => {
    const pptx = await buildPptx({
      slides: [
        {
          file: 'slide7.xml',
          name: 'Opening',
          background,
          shapes: `${title}${picture}${group}${chart}`,
          tail: `<p:transition spd="slow"/>${timing}`,
          rels: [
            ['rId2', 'image', '../media/image1.png'],
            ['rId3', 'chart', '../charts/chart1.xml'],
            ['rId4', 'hyperlink', 'https://example.com/'],
          ],
        },
        { file: 'slide2.xml' },
      ],
      parts: { 'ppt/media/image1.png': new Uint8Array([1, 2, 3]), 'ppt/charts/chart1.xml': '<c:chartSpace/>' },
    });

    const source = await indexSource(await OpcReader.load(pptx));
    expect(source.slides.map((slide) => slide.partName)).toEqual(['/ppt/slides/slide7.xml', '/ppt/slides/slide2.xml']);
    expect(source.slides.map((slide) => slide.sldId)).toEqual([{ id: 256, rId: 'rId2' }, { id: 257, rId: 'rId3' }]);

    const slide = source.slides[0]!;
    expect(slide.topLevel).toEqual([2, 3, 4, 6]);
    expect([...slide.shapes.keys()].sort()).toEqual([2, 3, 4, 5, 6]);
    expect(slide.shapes.get(2)).toEqual({ id: 2, xml: title, ids: [2], rIds: ['rId4'], partRefs: [] });
    expect(slide.shapes.get(3)).toEqual({ id: 3, xml: picture, ids: [3], rIds: ['rId2'], partRefs: ['/ppt/media/image1.png'] });
    expect(slide.shapes.get(4)).toEqual({ id: 4, xml: group, ids: [4, 5], rIds: [], partRefs: [] });
    expect(slide.shapes.get(5)).toEqual({ id: 5, xml: inner, ids: [5], rIds: [], partRefs: [] });
    expect(slide.shapes.get(6)).toEqual({ id: 6, xml: chart, ids: [6], rIds: ['rId3'], partRefs: ['/ppt/charts/chart1.xml'] });

    expect(slide.rootAttrs).toMatchObject({ 'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main' });
    expect(slide.name).toBe('Opening');
    expect(slide.pieces).toEqual(new Map([
      ['p:cSld/p:bg', background],
      ['p:clrMapOvr', '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'],
      ['p:transition', '<p:transition spd="slow"/>'],
      ['p:timing', timing],
    ]));
    expect(slide.layout).toBe('/ppt/slideLayouts/slideLayout1.xml');

    const empty = source.slides[1]!;
    expect(empty.topLevel).toEqual([]);
    expect(empty.name).toBeUndefined();
    expect(empty.pieces).toEqual(new Map([['p:clrMapOvr', '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>']]));
  });

  it('names layouts by their cSld name and knows the package content types', async () => {
    const pptx = await buildPptx({ layouts: { 'slideLayout2.xml': 'Title Only' }, parts: { 'ppt/media/a.emf': new Uint8Array([0]) }, contentTypes: { defaults: { emf: 'image/x-emf' } } });
    const source = await indexSource(await OpcReader.load(pptx));
    expect(source.layouts).toEqual(new Map([['Blank', '/ppt/slideLayouts/slideLayout1.xml'], ['Title Only', '/ppt/slideLayouts/slideLayout2.xml']]));
    expect(source.contentType('/ppt/media/a.emf')).toBe('image/x-emf');
    expect(source.contentType('/ppt/slides/slide1.xml')).toBe('application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
    expect(source.contentType('/ppt/missing.bin')).toBeUndefined();
  });
});
