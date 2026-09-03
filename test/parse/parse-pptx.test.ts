import { describe, expect, it } from 'vitest';
import { emitPptx } from '../../src/emit/index.js';
import type { Deck, Element, Paragraph, PictureElement, RunStyle, ShapeElement, TableCell, TableElement, TextBody } from '../../src/model/index.js';
import { parsePptx } from '../../src/parse/index.js';
import { buildBlankPptx, buildPptx } from '../render/pptx-fixture.js';

const created = new Date('2024-01-02T03:04:05.000Z');

function style(overrides: Partial<RunStyle> = {}): RunStyle {
  return {
    fontStack: ['Georgia'],
    weight: 400,
    size: 24,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: { hex: '111827', alpha: 1 },
    letterSpacing: 0,
    caps: 'none',
    baseline: 0,
    ...overrides,
  };
}

function paragraph(overrides: Partial<Paragraph> = {}): Paragraph {
  return { align: 'l', lineHeight: 33.6, spaceBefore: 0, spaceAfter: 0, indent: 0, marginLeft: 0, level: 0, runs: [], ...overrides };
}

function deckWith(elements: Element[]): Deck {
  return {
    title: 'Parse round trip',
    lang: 'sv-SE',
    canvas: { width: 960, height: 720, source: 'deck-meta' },
    fontFaces: [],
    slides: [
      { index: 1, id: 'slide-1', name: 'Opening', layout: 'Blank', elements },
      { index: 2, id: 'slide-2', name: 'Closing', layout: 'Blank', elements: [] },
    ],
  };
}

async function roundTrip(deck: Deck): Promise<Deck> {
  return parsePptx(await emitPptx(deck, { created, appVersion: '0.0.0' }));
}

describe('parsePptx', () => {
  it('reads a foreign blank deck into a Deck with its canvas and one empty Slide', async () => {
    const deck = await parsePptx(await buildBlankPptx());
    expect(deck).toEqual({
      title: 'deckflip',
      lang: 'en',
      canvas: { width: 1280, height: 720, source: 'deck-meta' },
      fontFaces: [],
      slides: [{ index: 1, id: 'slide-1', name: 'Slide 1', layout: 'Blank', elements: [] }],
    });
  });

  it('reads what the IDM cannot hold as opaque records with their box, class and parts, and marks text effects', async () => {
    const chart = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>';
    const smartArt = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Diagram 2"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/></a:graphicData></a:graphic></p:graphicFrame>';
    const ole = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Object 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="1828800"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"><p:oleObj r:id="rId7" progId="Excel.Sheet.12"/></a:graphicData></a:graphic></p:graphicFrame>';
    const connector = '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Straight Connector 4"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm rot="5400000"><a:off x="1828800" y="1828800"/><a:ext cx="914400" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>';
    const wordArt = '<p:sp><p:nvSpPr><p:cNvPr id="6" name="WordArt 5"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="2743200"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="none"><a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp></a:bodyPr><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>Arch</a:t></a:r></a:p></p:txBody></p:sp>';
    const metafile = '<p:pic><p:nvPicPr><p:cNvPr id="7" name="Picture 6"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId8"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="2743200" y="2743200"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    const pptx = await buildPptx({
      slides: [{
        shapes: `${chart}${smartArt}${ole}${connector}${wordArt}${metafile}`,
        rels: [
          ['rId2', 'chart', '../charts/chart1.xml'],
          ['rId3', 'diagramData', '../diagrams/data1.xml'],
          ['rId4', 'diagramLayout', '../diagrams/layout1.xml'],
          ['rId5', 'diagramQuickStyle', '../diagrams/quickStyle1.xml'],
          ['rId6', 'diagramColors', '../diagrams/colors1.xml'],
          ['rId7', 'oleObject', '../embeddings/oleObject1.xlsx'],
          ['rId8', 'image', '../media/image1.emf'],
        ],
      }],
      parts: {
        'ppt/charts/chart1.xml': '<c:chartSpace/>',
        'ppt/diagrams/data1.xml': '<dgm:dataModel/>',
        'ppt/diagrams/layout1.xml': '<dgm:layoutDef/>',
        'ppt/diagrams/quickStyle1.xml': '<dgm:styleDef/>',
        'ppt/diagrams/colors1.xml': '<dgm:colorsDef/>',
        'ppt/embeddings/oleObject1.xlsx': new Uint8Array([1]),
        'ppt/media/image1.emf': new Uint8Array([1]),
      },
    });
    const deck = await parsePptx(pptx);
    const elements = deck.slides[0]!.elements;
    expect(elements.map((element) => [element.kind, element.shapeId, element.name])).toEqual([
      ['opaque', '1-2', 'Chart 1'],
      ['opaque', '1-3', 'Diagram 2'],
      ['opaque', '1-4', 'Object 3'],
      ['opaque', '1-5', 'Straight Connector 4'],
      ['shape', '1-6', 'WordArt 5'],
      ['opaque', '1-7', 'Picture 6'],
    ]);
    expect(elements[0]).toEqual({ kind: 'opaque', class: 'chart', shapeId: '1-2', selector: '[data-shape-id="1-2"]', name: 'Chart 1', box: { x: 96, y: 96, w: 192, h: 96 }, rotation: 0, parts: ['/ppt/charts/chart1.xml'] });
    expect(elements[1]).toMatchObject({ class: 'smartart', parts: ['/ppt/diagrams/data1.xml', '/ppt/diagrams/layout1.xml', '/ppt/diagrams/quickStyle1.xml', '/ppt/diagrams/colors1.xml'] });
    expect(elements[2]).toMatchObject({ class: 'ole', parts: ['/ppt/embeddings/oleObject1.xlsx'] });
    expect(elements[3]).toMatchObject({ class: 'vector', box: { x: 192, y: 192, w: 96, h: 0 }, rotation: 90, parts: [] });
    expect(elements[4]).toMatchObject({ kind: 'shape', preserve: 'text-effects' });
    expect(elements[5]).toMatchObject({ class: 'vector', parts: ['/ppt/media/image1.emf'] });
  });

  it('reads shapes back with their border box, rotation, geometry, fills, line, shadow and text body', async () => {
    const source = deckWith([
      {
        kind: 'shape',
        selector: '#rect',
        name: 'div.card',
        box: { x: 80, y: 20, w: 100, h: 50 },
        rotation: 15,
        geometry: { preset: 'roundRect', radius: 8 },
        fill: { type: 'solid', color: { hex: 'FF0000', alpha: 0.5 } },
        line: { width: 4, color: { hex: '0F172A', alpha: 1 }, dash: 'dash' },
        shadow: { inset: false, offsetX: 3, offsetY: 4, blur: 6, color: { hex: '000000', alpha: 0.25 } },
      },
      {
        kind: 'shape',
        selector: '#pill',
        name: 'div.pill',
        box: { x: 200, y: 20, w: 100, h: 50 },
        rotation: 0,
        geometry: { preset: 'ellipse' },
        fill: { type: 'gradient', kind: 'linear', angle: 90, stops: [{ position: 0, color: { hex: '2563EB', alpha: 1 } }, { position: 0.5, color: { hex: '5146EC', alpha: 1 } }, { position: 1, color: { hex: '7C3AED', alpha: 1 } }] },
      },
      {
        kind: 'shape',
        selector: '#text',
        name: 'p',
        box: { x: 30, y: 140, w: 200, h: 80 },
        rotation: 0,
        geometry: { preset: 'rect' },
        text: {
          padding: { l: 4, t: 3, r: 4, b: 5 },
          firstParagraphGap: 0,
          lastParagraphGap: 0,
          wrap: true,
          rtl: false,
          trailingGuard: 0,
          paragraphs: [
            paragraph({ runs: [{ kind: 'text', text: 'Alpha ', style: style() }, { kind: 'text', text: 'beta', style: style({ bold: true, weight: 700, italic: true, underline: true, strike: true, caps: 'small', baseline: 30000, letterSpacing: 1, highlight: { hex: 'FDE68A', alpha: 1 }, link: 'https://example.com/' }) }] }),
            paragraph({ align: 'ctr', lineHeight: 20, spaceBefore: 8, spaceAfter: 4, indent: -18, marginLeft: 40, level: 1, bullet: { type: 'autonum', scheme: 'arabicPeriod', startAt: 3, color: { hex: '111827', alpha: 1 }, sizePct: 100 }, runs: [{ kind: 'text', text: 'one', style: style({ size: 12 }) }, { kind: 'break' }, { kind: 'text', text: 'two', style: style({ size: 12, link: '#slide-2' }) }] }),
          ],
        },
      },
    ]);

    const deck = await roundTrip(source);
    expect(deck.title).toBe('Parse round trip');
    expect(deck.lang).toBe('sv-SE');
    expect(deck.canvas).toEqual({ width: 960, height: 720, source: 'deck-meta' });
    expect(deck.slides.map((slide) => slide.name)).toEqual(['Opening', 'Closing']);

    const [card, pill, text] = deck.slides[0]!.elements as ShapeElement[];
    // the emitter deflates a stroked box by half the line and centres the stroke; the parser inflates it back;
    // the locator names the shape by its `p:cNvPr` id, which htmlout writes as `data-shape-id`
    expect(card).toEqual({
      kind: 'shape',
      shapeId: '1-2', selector: '[data-shape-id="1-2"]',
      name: 'div.card',
      box: { x: 80, y: 20, w: 100, h: 50 },
      rotation: 15,
      geometry: { preset: 'roundRect', radius: 8 },
      fill: { type: 'solid', color: { hex: 'FF0000', alpha: 0.5 } },
      line: { width: 4, color: { hex: '0F172A', alpha: 1 }, dash: 'dash' },
      shadow: { inset: false, offsetX: 3, offsetY: 4, blur: 6, color: { hex: '000000', alpha: 0.25 } },
    });
    expect(pill).toMatchObject({ geometry: { preset: 'ellipse' }, fill: source.slides[0]!.elements[1]!.kind === 'shape' && source.slides[0]!.elements[1]!.fill });
    expect(pill).not.toHaveProperty('line');

    expect(text!.text).toEqual({
      padding: { l: 4, t: 3, r: 4, b: 5 },
      firstParagraphGap: 0,
      lastParagraphGap: 0,
      wrap: true,
      rtl: false,
      trailingGuard: 0,
      paragraphs: [
        paragraph({ runs: [{ kind: 'text', text: 'Alpha ', style: style() }, { kind: 'text', text: 'beta', style: style({ bold: true, weight: 700, italic: true, underline: true, strike: true, caps: 'small', baseline: 30000, letterSpacing: 1, highlight: { hex: 'FDE68A', alpha: 1 }, link: 'https://example.com/' }) }] }),
        paragraph({ align: 'ctr', lineHeight: 20, spaceBefore: 8, spaceAfter: 4, indent: -18, marginLeft: 40, level: 1, bullet: { type: 'autonum', scheme: 'arabicPeriod', startAt: 3, color: { hex: '111827', alpha: 1 }, sizePct: 100 }, runs: [{ kind: 'text', text: 'one', style: style({ size: 12 }) }, { kind: 'break' }, { kind: 'text', text: 'two', style: style({ size: 12, link: '#slide-2' }) }] }),
      ],
    });
  });

  it('reads a Slide back with the notes its notes slide carries', async () => {
    const source = deckWith([]);
    source.slides[0]!.notes = {
      padding: { l: 0, t: 0, r: 0, b: 0 },
      firstParagraphGap: 0,
      lastParagraphGap: 0,
      wrap: true,
      rtl: false,
      trailingGuard: 0,
      paragraphs: [
        paragraph({ runs: [{ kind: 'text', text: 'Speak slowly here', style: style() }] }),
        paragraph({ align: 'ctr', level: 1, runs: [{ kind: 'text', text: 'Then pause', style: style({ bold: true, weight: 700 }) }] }),
      ],
    };

    const deck = await roundTrip(source);
    // the notes page governs everything a browser would have measured, so text, emphasis, links and paragraph shape are what come back
    expect(deck.slides[0]!.notes?.paragraphs.map((p) => [p.align, p.level, p.runs.map((run) => (run.kind === 'text' ? [run.text, run.style.bold, run.style.italic] : ['break']))])).toEqual([
      ['l', 0, [['Speak slowly here', false, false]]],
      ['ctr', 1, [['Then pause', true, false]]],
    ]);
    expect(deck.slides[1]!.notes).toBeUndefined();
  });

  it('carries no notes for a foreign notes slide whose body placeholder holds no text', async () => {
    // PowerPoint leaves a notes slide behind as soon as the notes pane is opened, empty body and all
    const emptyBody = '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>';
    const slideNumber = '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld></a:p></p:txBody></p:sp>';
    const deck = await parsePptx(await buildPptx({ slides: [{ notes: `${emptyBody}${slideNumber}` }] }));
    expect(deck.slides[0]!.notes).toBeUndefined();
  });

  it('reads a foreign notes slide, resolving the links in it against the notes slide own relationships', async () => {
    const runs = '<a:r><a:rPr lang="en-US" sz="1200"/><a:t>Cite </a:t></a:r><a:r><a:rPr lang="en-US" sz="1200"><a:hlinkClick r:id="rId3"/></a:rPr><a:t>the source</a:t></a:r>';
    const body = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${runs}</a:p></p:txBody></p:sp>`;
    const deck = await parsePptx(await buildPptx({
      slides: [{}, { notes: body, notesRels: [['rId3', 'hyperlink', 'https://example.com/paper']] }],
    }));

    expect(deck.slides[0]!.notes).toBeUndefined();
    expect(deck.slides[1]!.notes?.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => (run.kind === 'text' ? [run.text, run.style.link] : ['break'])))).toEqual([
      ['Cite ', undefined],
      ['the source', 'https://example.com/paper'],
    ]);
  });

  it('reads each Slide layout by the name its layout part carries', async () => {
    const deck = await parsePptx(await buildPptx({
      slides: [{ layout: 'slideLayout2.xml' }, {}, { layout: 'slideLayout3.xml' }],
      layouts: { 'slideLayout2.xml': 'Title and Content', 'slideLayout3.xml': 'Two Content' },
    }));
    expect(deck.slides.map((slide) => slide.layout)).toEqual(['Title and Content', 'Blank', 'Two Content']);
  });

  it('reads a section name onto the first Slide of each PowerPoint section', async () => {
    const section = (name: string, ids: number[]): string =>
      `<p14:section name="${name}" id="{6DC5${ids[0]}-0000-0000-0000-000000000000}"><p14:sldIdLst>${ids.map((id) => `<p14:sldId id="${id}"/>`).join('')}</p14:sldIdLst></p14:section>`;
    const deck = await parsePptx(await buildPptx({
      slides: [{}, {}, {}],
      presentationTail: `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${section('Intro', [256, 257])}${section('Body', [258])}</p14:sectionLst></p:ext></p:extLst>`,
    }));
    expect(deck.slides.map((slide) => slide.section)).toEqual(['Intro', undefined, 'Body']);
  });

  it('reads the placeholder a shape or picture fills, type and index as `data-placeholder` spells it', async () => {
    const sp = (id: number, name: string, ph: string): string =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${name}</a:t></a:r></a:p></p:txBody></p:sp>`;
    const pic = '<p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture 4"/><p:cNvPicPr/><p:nvPr><p:ph type="pic" idx="3"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636000010000050001', 'hex');
    const deck = await parsePptx(await buildPptx({
      slides: [{
        shapes: `${sp(2, 'Title 1', '<p:ph type="title"/>')}${sp(3, 'Body 2', '<p:ph type="body" idx="1"/>')}${sp(4, 'Free 3', '')}${pic}`,
        rels: [['rId2', 'image', '../media/image1.png']],
      }],
      parts: { 'ppt/media/image1.png': png },
    }));

    expect(deck.slides[0]!.elements.map((element) => (element.kind === 'shape' || element.kind === 'picture' ? element.placeholder : 'other'))).toEqual([
      'title',
      'body:1',
      undefined,
      'pic:3',
    ]);
  });

  it('resolves what a placeholder run inherits from the layout, the master and the theme into explicit values', async () => {
    // the layout's title box overrides the size, the weight and the colour; the master's title style names the theme font
    const layoutTitle = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4000" b="1"><a:solidFill><a:srgbClr val="B91C1C"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>';
    const txStyles = '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2800" i="1"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:otherStyle></p:txStyles>';
    // the slide's own run says nothing but its text: every property comes from the chain
    const slideTitle = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Agenda</a:t></a:r></a:p></p:txBody></p:sp>';
    const deck = await parsePptx(await buildPptx({
      slides: [{ shapes: slideTitle }],
      layouts: { 'slideLayout1.xml': { name: 'Title Slide', shapes: layoutTitle } },
      master: { txStyles },
    }));

    const shape = deck.slides[0]!.elements[0] as ShapeElement;
    const paragraph = shape.text!.paragraphs[0]!;
    const run = paragraph.runs[0]!;
    expect(run.kind === 'text' && run.style).toMatchObject({
      bold: true,
      weight: 700,
      // the master still decides what the layout leaves open
      italic: true,
      color: { hex: 'B91C1C', alpha: 1 },
      // `+mj-lt` resolved through the theme's major font
      fontStack: ['Arial'],
    });
    // 40 pt from the layout, not the master's 28
    expect(run.kind === 'text' && run.style.size).toBeCloseTo(53.333, 3);
    expect(paragraph.align).toBe('ctr');
  });

  it('inherits body placeholder bullets and run sizes from the master', async () => {
    const txStyles = '<p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="\u25AA"/><a:defRPr sz="2400"/></a:lvl1pPr><a:lvl2pPr marL="742950" indent="-285750"><a:buChar char="\u2013"/><a:defRPr sz="2000"/></a:lvl2pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles>';
    const body = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Content 1"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>First</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Deeper</a:t></a:r></a:p></p:txBody></p:sp>';
    const deck = await parsePptx(await buildPptx({
      slides: [{ shapes: body }],
      master: { txStyles },
    }));

    const content = deck.slides[0]!.elements[0] as ShapeElement;
    expect(content.text!.paragraphs.map((paragraph) => [paragraph.level, paragraph.bullet, paragraph.marginLeft, paragraph.indent])).toEqual([
      [0, { type: 'char', char: '\u25AA', color: { hex: '000000', alpha: 1 }, sizePct: 100 }, 36, -36],
      [1, { type: 'char', char: '\u2013', color: { hex: '000000', alpha: 1 }, sizePct: 100 }, 78, -30],
    ]);
    expect(content.text!.paragraphs.map((paragraph) => (paragraph.runs[0]!.kind === 'text' ? paragraph.runs[0]!.style.size : 0))).toEqual([32, 26.666666666666668]);
  });

  it('reads a paragraph whose nearest bullet declaration is a:buNone as a plain paragraph, not a marker-less list item', async () => {
    // the master hands the body placeholder a square bullet; `a:buNone` on the paragraph turns it off, and a
    // paragraph PowerPoint paints no marker for is no list item (the IDM carries `bullet` on those only)
    const txStyles = '<p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:buChar char="\u25AA"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles>';
    const body = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Content 1"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>Plain</a:t></a:r></a:p></p:txBody></p:sp>';
    const deck = await parsePptx(await buildPptx({
      slides: [{ shapes: body }],
      master: { txStyles },
    }));

    const content = deck.slides[0]!.elements[0] as ShapeElement;
    expect(content.text!.paragraphs[0]!.bullet).toBeUndefined();
  });

  it('lets a layout level declaring a:buBlip win over the master bullet, as the nearest declaration', async () => {
    // the layout's body placeholder paints a picture bullet, so the master's square never reaches the slide;
    // HTML has no picture marker, so the walk stops there and flattens it to the default character bullet
    const txStyles = '<p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:buChar char="\u25AA"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr/></p:otherStyle></p:txStyles>';
    const layoutBody = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Content Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:buBlip><a:blip r:embed="rId9"/></a:buBlip></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>';
    const body = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Content 1"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Item</a:t></a:r></a:p></p:txBody></p:sp>';
    const deck = await parsePptx(await buildPptx({
      slides: [{ shapes: body }],
      layouts: { 'slideLayout1.xml': { name: 'Blank', shapes: layoutBody } },
      master: { txStyles },
    }));

    const content = deck.slides[0]!.elements[0] as ShapeElement;
    expect(content.text!.paragraphs[0]!.bullet).toEqual({ type: 'char', char: '\u2022', color: { hex: '000000', alpha: 1 }, sizePct: 100 });
  });

  it('inherits unresolved non-placeholder run properties from the default text style after other style', async () => {
    const free = '<p:sp><p:nvSpPr><p:cNvPr id="3" name="TextBox 2"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>Loose</a:t></a:r></a:p></p:txBody></p:sp>';
    const deck = await parsePptx(await buildPptx({
      slides: [{ shapes: free }],
      master: {
        txStyles: '<p:txStyles><p:titleStyle><a:lvl1pPr/></p:titleStyle><p:bodyStyle><a:lvl1pPr/></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:otherStyle></p:txStyles>',
      },
      defaultTextStyle: '<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1400" i="1"/></a:lvl1pPr></p:defaultTextStyle>',
    }));

    const textbox = deck.slides[0]!.elements[0] as ShapeElement;
    const run = textbox.text!.paragraphs[0]!.runs[0]!;
    expect(run.kind === 'text' && run.style).toMatchObject({
      size: 16,
      italic: true,
    });
  });

  it('reads pictures back with their media bytes, crop, rotation, opacity and SVG vector, and image fills on shapes', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636000010000050001', 'hex');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', 'utf8');
    const source = deckWith([
      {
        kind: 'picture',
        selector: '#photo',
        name: 'img.photo',
        box: { x: 44, y: 304, w: 152, h: 92 },
        rotation: 90,
        crop: { l: 0.1875, t: 0, r: 0.1875, b: 0 },
        geometry: { preset: 'roundRect', radius: 12 },
        opacity: 0.5,
        media: { data: png, contentType: 'image/png' },
      },
      {
        kind: 'picture',
        selector: '#icon',
        name: 'svg.icon',
        box: { x: 0, y: 0, w: 80, h: 80 },
        rotation: 0,
        crop: { l: 0, t: 0, r: 0, b: 0 },
        geometry: { preset: 'rect' },
        media: { data: png, contentType: 'image/png' },
        vector: { data: svg, contentType: 'image/svg+xml' },
      },
      {
        kind: 'shape',
        selector: '#bg',
        name: 'section#bg',
        box: { x: 0, y: 0, w: 960, h: 720 },
        rotation: 0,
        geometry: { preset: 'rect' },
        fill: { type: 'image', media: { data: png, contentType: 'image/png' }, tile: { x: 20, y: 10, scaleX: 0.5, scaleY: 0.5 } },
      },
    ]);

    const deck = await roundTrip(source);
    const [photo, icon, background] = deck.slides[0]!.elements as [PictureElement, PictureElement, ShapeElement];
    expect(photo).toEqual({
      kind: 'picture',
      shapeId: '1-2', selector: '[data-shape-id="1-2"]',
      name: 'img.photo',
      box: { x: 44, y: 304, w: 152, h: 92 },
      rotation: 90,
      crop: { l: 0.1875, t: 0, r: 0.1875, b: 0 },
      geometry: { preset: 'roundRect', radius: 12 },
      opacity: 0.5,
      media: { data: new Uint8Array(png), contentType: 'image/png' },
    });
    expect(icon.media).toEqual({ data: new Uint8Array(png), contentType: 'image/png' });
    expect(icon.vector).toEqual({ data: new Uint8Array(svg), contentType: 'image/svg+xml' });
    expect(background.fill).toEqual({ type: 'image', media: { data: new Uint8Array(png), contentType: 'image/png' }, tile: { x: 20, y: 10, scaleX: 0.5, scaleY: 0.5 } });
  });

  it('reads per-side border lines back as `borders` on their shape, with the text insets un-folded', async () => {
    const top = { width: 2, color: { hex: '2563EB', alpha: 1 }, dash: 'solid' as const };
    const bottom = { width: 6, color: { hex: 'DC2626', alpha: 1 }, dash: 'dot' as const };
    const source = deckWith([
      {
        kind: 'shape',
        selector: '#ruled',
        name: 'div.ruled',
        box: { x: 40, y: 60, w: 300, h: 100 },
        rotation: 0,
        geometry: { preset: 'rect' },
        fill: { type: 'solid', color: { hex: 'F8FAFC', alpha: 1 } },
        borders: { top, bottom },
        text: {
          padding: { l: 12, t: 8, r: 12, b: 8 },
          firstParagraphGap: 0,
          lastParagraphGap: 0,
          wrap: true,
          rtl: false,
          trailingGuard: 0,
          paragraphs: [paragraph({ runs: [{ kind: 'text', text: 'Ruled', style: style() }] })],
        },
      },
      { kind: 'shape', selector: '#after', name: 'div.after', box: { x: 0, y: 200, w: 10, h: 10 }, rotation: 0, geometry: { preset: 'rect' } },
    ]);

    const deck = await roundTrip(source);
    const [ruled, after] = deck.slides[0]!.elements as ShapeElement[];
    expect(deck.slides[0]!.elements).toHaveLength(2);
    expect(ruled!.borders).toEqual({ top, bottom });
    expect(ruled).not.toHaveProperty('line');
    expect(ruled!.box).toEqual({ x: 40, y: 60, w: 300, h: 100 });
    expect(ruled!.text!.padding).toEqual({ l: 12, t: 8, r: 12, b: 8 });
    expect(after!.name).toBe('div.after');
  });

  it('reads groups back with their placement, child space, rotation and nested children in paint order', async () => {
    const line = { width: 1, color: { hex: '94A3B8', alpha: 1 }, dash: 'solid' as const };
    const source = deckWith([
      {
        kind: 'group',
        selector: '#cluster',
        name: 'div.cluster',
        box: { x: 100, y: 50, w: 400, h: 200 },
        childBox: { x: 100, y: 50, w: 400, h: 200 },
        rotation: 10,
        children: [
          { kind: 'shape', selector: '#a', name: 'div.a', box: { x: 100, y: 50, w: 150, h: 200 }, rotation: 0, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: '0EA5E9', alpha: 1 } } },
          {
            kind: 'group',
            selector: '#inner',
            name: 'div.inner',
            box: { x: 300, y: 50, w: 200, h: 200 },
            childBox: { x: 300, y: 50, w: 200, h: 200 },
            rotation: 0,
            children: [{ kind: 'shape', selector: '#b', name: 'div.b', box: { x: 300, y: 50, w: 200, h: 200 }, rotation: 0, geometry: { preset: 'rect' }, borders: { left: line } }],
          },
        ],
      },
    ]);

    const deck = await roundTrip(source);
    expect(deck.slides[0]!.elements).toEqual([
      {
        kind: 'group',
        shapeId: '1-2', selector: '[data-shape-id="1-2"]',
        name: 'div.cluster',
        box: { x: 100, y: 50, w: 400, h: 200 },
        childBox: { x: 100, y: 50, w: 400, h: 200 },
        rotation: 10,
        children: [
          { kind: 'shape', shapeId: '1-3', selector: '[data-shape-id="1-3"]', name: 'div.a', box: { x: 100, y: 50, w: 150, h: 200 }, rotation: 0, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: '0EA5E9', alpha: 1 } } },
          {
            kind: 'group',
            shapeId: '1-4', selector: '[data-shape-id="1-4"]',
            name: 'div.inner',
            box: { x: 300, y: 50, w: 200, h: 200 },
            childBox: { x: 300, y: 50, w: 200, h: 200 },
            rotation: 0,
            children: [{ kind: 'shape', shapeId: '1-5', selector: '[data-shape-id="1-5"]', name: 'div.b', box: { x: 300, y: 50, w: 200, h: 200 }, rotation: 0, geometry: { preset: 'rect' }, borders: { left: line } }],
          },
        ],
      },
    ]);
  });

  it('reads tables back with their grid, spans, per-edge borders, cell insets, anchors, fills and cell text', async () => {
    const rule = { width: 1, color: { hex: 'CBD5E1', alpha: 1 }, dash: 'solid' as const };
    const thick = { width: 3, color: { hex: '0F172A', alpha: 1 }, dash: 'dash' as const };
    const body = (text: string, size = 16, lineHeight = 19.2): TextBody => ({
      padding: { l: 0, t: 0, r: 0, b: 0 },
      firstParagraphGap: 0,
      lastParagraphGap: 0,
      wrap: true,
      rtl: false,
      trailingGuard: 0,
      paragraphs: [paragraph({ lineHeight, runs: [{ kind: 'text', text, style: style({ size }) }] })],
    });
    const cell = (overrides: Partial<TableCell>): TableCell => ({ colSpan: 1, rowSpan: 1, borders: {}, padding: { l: 8, t: 4, r: 8, b: 4 }, anchor: 't', text: body('cell'), ...overrides });
    const source = deckWith([
      {
        kind: 'table',
        selector: '#grid',
        name: 'table.grid',
        box: { x: 50, y: 60, w: 300, h: 90 },
        columns: [100, 120, 80],
        rows: [
          {
            height: 40,
            cells: [
              cell({ colSpan: 2, borders: { top: thick, bottom: rule, left: thick }, fill: { type: 'solid', color: { hex: 'F1F5F9', alpha: 1 } }, anchor: 'ctr', text: body('Header', 20, 24) }),
              cell({ merged: 'h', text: body('', 20, 24) }),
              cell({ rowSpan: 2, borders: { top: thick, right: thick }, anchor: 'b', text: body('Tall') }),
            ],
          },
          {
            height: 50,
            cells: [
              cell({ borders: { bottom: rule }, text: body('a') }),
              cell({ borders: { bottom: rule }, padding: { l: 2, t: 2, r: 2, b: 2 }, text: body('b', 12, 14.4) }),
              cell({ merged: 'v', text: body('') }),
            ],
          },
        ],
      },
    ]);

    const deck = await roundTrip(source);
    const [table] = deck.slides[0]!.elements as [TableElement];
    const expected = source.slides[0]!.elements[0] as TableElement;
    expect(table).toMatchObject({ kind: 'table', shapeId: '1-2', selector: '[data-shape-id="1-2"]', name: 'table.grid', box: { x: 50, y: 60, w: 300, h: 90 }, columns: [100, 120, 80] });
    expect(table.rows.map((row) => row.height)).toEqual([40, 50]);
    expect(table.rows[0]!.cells[0]).toEqual(expected.rows[0]!.cells[0]);
    expect(table.rows[0]!.cells[2]).toEqual(expected.rows[0]!.cells[2]);
    expect(table.rows[1]!.cells[0]).toEqual(expected.rows[1]!.cells[0]);
    expect(table.rows[1]!.cells[1]).toEqual(expected.rows[1]!.cells[1]);

    // a continuation cell carries no content of its own: only the end-paragraph size survives, so it reads
    // back as the html side produces it, one empty run at that size (its typeface the theme's minor font,
    // as any run without `a:latin`), with no insets or borders
    const continuation = (merged: 'h' | 'v', size: number, lineHeight: number): TableCell => ({
      colSpan: 1,
      rowSpan: 1,
      merged,
      borders: {},
      padding: { l: 0, t: 0, r: 0, b: 0 },
      anchor: 't',
      text: {
        ...body(''),
        paragraphs: [paragraph({ lineHeight, runs: [{ kind: 'text', text: '', style: { ...style({ size }), fontStack: ['Arial'], color: { hex: '000000', alpha: 1 } } }] })],
      },
    });
    expect(table.rows[0]!.cells[1]).toEqual(continuation('h', 20, 24));
    expect(table.rows[1]!.cells[2]).toEqual(continuation('v', 16, 19.2));
  });
});
