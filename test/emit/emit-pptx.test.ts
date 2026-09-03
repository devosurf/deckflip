import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { Deck, Element, Line, Paragraph, ResolvedFont, RunStyle, ShapeElement, TableCell, TextBody } from '../../src/model/index.js';
import { emitPptx } from '../../src/emit/index.js';

const sofficeAvailable = Boolean(spawnSync('soffice', ['--version'], { stdio: 'ignore' }).status === 0);
const created = new Date('2024-01-02T03:04:05.000Z');

function resolvedFont(): ResolvedFont {
  return {
    family: 'Resolved',
    file: '/fonts/resolved.ttf',
    class: 'installed',
    metrics: { ascender: 1854 / 2048, descender: 434 / 2048 },
    fsType: 0,
  };
}

function runStyle(overrides: Partial<RunStyle> = {}, includeResolvedFont = true): RunStyle {
  const base: RunStyle = {
    fontStack: ['Resolved', 'Arial'],
    weight: 400,
    size: 24,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: { hex: '000000', alpha: 1 },
    letterSpacing: 0,
    caps: 'none',
    baseline: 0,
  };
  if (includeResolvedFont) {
    base.font = resolvedFont();
  }
  return { ...base, ...overrides };
}

function deck(): Deck {
  const firstParagraph: Paragraph = {
    align: 'l',
    lineHeight: 33.6,
    spaceBefore: 0,
    spaceAfter: 0,
    indent: 0,
    marginLeft: 0,
    level: 0,
    runs: [{ kind: 'text', text: 'Alpha', style: runStyle() }],
  };
  const secondParagraph: Paragraph = {
    align: 'ctr',
    lineHeight: 20,
    spaceBefore: 0,
    spaceAfter: 0,
    indent: 0,
    marginLeft: 0,
    level: 0,
    runs: [{ kind: 'text', text: 'Beta', style: runStyle({ fontStack: ['Arial'], size: 12, color: { hex: '333333', alpha: 1 } }, false) }],
  };

  return {
    title: 'Emit smoke test',
    lang: 'en-US',
    canvas: { width: 1280, height: 720, source: 'default' },
    fontFaces: [],
    slides: [
      {
        index: 1,
        id: 'slide-1',
        name: 'Slide 1',
        layout: 'Blank',
        elements: [
          {
            kind: 'shape',
            selector: '#rect',
            name: 'rect',
            box: { x: 80, y: 20, w: 100, h: 50 },
            rotation: 0,
            geometry: { preset: 'rect' },
            fill: { type: 'solid', color: { hex: 'FF0000', alpha: 1 } },
          },
          {
            kind: 'shape',
            selector: '#text',
            name: 'textbox',
            box: { x: 30, y: 40, w: 200, h: 80 },
            rotation: 0,
            geometry: { preset: 'rect' },
            text: {
              padding: { l: 4, t: 3, r: 4, b: 5 },
              firstParagraphGap: 2,
              lastParagraphGap: 1,
              wrap: true,
              rtl: false,
              trailingGuard: 0,
              paragraphs: [firstParagraph, secondParagraph],
            },
          },
        ],
      },
    ],
  };
}

function shapeAt(target: Deck, index: number): ShapeElement {
  const element = target.slides[0]!.elements[index]!;
  if (element.kind !== 'shape') {
    throw new Error(`element ${index} is a ${element.kind}`);
  }
  return element;
}

async function zipEntries(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => !name.endsWith('/'));
}

function notes(text: string): TextBody {
  return {
    padding: { l: 0, t: 0, r: 0, b: 0 },
    firstParagraphGap: 0,
    lastParagraphGap: 0,
    wrap: true,
    rtl: false,
    trailingGuard: 0,
    paragraphs: [{ align: 'l', lineHeight: 16, spaceBefore: 0, spaceAfter: 0, indent: 0, marginLeft: 0, level: 0, runs: [{ kind: 'text', text, style: runStyle() }] }],
  };
}

describe('emitPptx', () => {
  it('emits reproducible PPTX bytes and the expected slide XML', async () => {
    const pptx = await emitPptx(deck(), { created, appVersion: '1.2.3' });
    const again = await emitPptx(deck(), { created, appVersion: '1.2.3' });

    expect(Buffer.compare(pptx, again)).toBe(0);
    expect(await zipEntries(pptx)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'docProps/app.xml',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/theme/theme1.xml',
    ]);

    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    expect(slideXml).toContain('p:cNvPr id="2" name="rect"');
    expect(slideXml).toContain('a:off x="762000" y="190500"');
    expect(slideXml).toContain('a:spcPts val="2520"');
    // Arial 24px in a 33.6px line: Chromium baseline 25.3, PowerPoint 26.611 -> correction 1.311; tIns = (3 + 2 - 1.311) px = 35138 EMU
    expect(slideXml).toContain('tIns="35138"');
    expect(slideXml).toContain('p:cNvSpPr txBox="1"');
  });

  it('emits a notes slide on a notes master for each Slide that carries notes', async () => {
    const notesDeck = deck();
    notesDeck.slides[0]!.notes = notes('Remember the margin');
    notesDeck.slides.push({ index: 2, id: 'slide-2', name: 'Slide 2', layout: 'Blank', elements: [] });

    const pptx = await emitPptx(notesDeck, { created, appVersion: '1.2.3' });
    // the second Slide has no notes, so it gets no notes slide
    expect((await zipEntries(pptx)).filter((name) => name.toLowerCase().includes('notes'))).toEqual([
      'ppt/notesMasters/notesMaster1.xml',
      'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      'ppt/notesSlides/notesSlide1.xml',
      'ppt/notesSlides/_rels/notesSlide1.xml.rels',
    ]);

    const zip = await JSZip.loadAsync(pptx);
    const notesXml = await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string');
    expect(notesXml).toContain('<a:t xml:space="preserve">Remember the margin</a:t>');
    // PowerPoint's notes pane reads the body placeholder, and needs the slide image placeholder beside it
    expect(notesXml).toContain('<p:ph type="body" idx="1"/>');
    expect(notesXml).toContain('<p:ph type="sldImg"/>');
    expect(await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')).toContain('../notesSlides/notesSlide1.xml');
    expect(await zip.file('ppt/notesSlides/_rels/notesSlide1.xml.rels')!.async('string')).toContain('../notesMasters/notesMaster1.xml');
    expect(await zip.file('ppt/presentation.xml')!.async('string')).toContain('<p:notesMasterIdLst>');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain(
      '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>',
    );
  });

  it('emits notes as unmeasured text: the notes master carries the metrics, the runs carry the emphasis', async () => {
    const notesDeck = deck();
    const body = notes('Remember the margin');
    body.paragraphs[0]!.spaceBefore = 8;
    body.paragraphs[0]!.spaceAfter = 4;
    body.paragraphs.push({ ...body.paragraphs[0]!, align: 'ctr', runs: [{ kind: 'text', text: 'Loudly', style: runStyle({ bold: true, italic: true, link: 'https://example.com/' }) }] });
    notesDeck.slides[0]!.notes = body;

    const zip = await JSZip.loadAsync(await emitPptx(notesDeck, { created, appVersion: '1.2.3' }));
    const notesXml = await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string');
    // nothing in a notes body was ever measured in a browser: an exact line, a fixed gap, a typeface or a
    // size here would override the notes page the deck was authored on
    for (const unmeasured of ['a:lnSpc', 'a:spcBef', 'a:spcAft', 'a:latin', 'a:solidFill', 'sz="']) {
      expect(notesXml, unmeasured).not.toContain(unmeasured);
    }
    // text, emphasis, alignment and links are what the notes pane edits
    expect(notesXml).toContain('<a:t xml:space="preserve">Remember the margin</a:t>');
    expect(notesXml).toContain('<a:rPr lang="en-US" b="1" i="1"><a:hlinkClick r:id="rId3"/></a:rPr>');
    expect(notesXml).toContain('algn="ctr"');
    // the master gives that text PowerPoint's own notes size
    expect(await zip.file('ppt/notesMasters/notesMaster1.xml')!.async('string')).toContain('<p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle>');
  });

  it('emits a notes list item with its marker but no bullet colour, which the notes master governs', async () => {
    const notesDeck = deck();
    const body = notes('Remember the margin');
    // html/notes.ts has to put some colour in the model for a notes `li`; no browser measured it, so it is
    // the tool's invention, not something the notes markup showed
    body.paragraphs[0]!.bullet = { type: 'char', char: '\u2022', color: { hex: 'FF0000', alpha: 1 }, sizePct: 100 };
    notesDeck.slides[0]!.notes = body;

    const zip = await JSZip.loadAsync(await emitPptx(notesDeck, { created, appVersion: '1.2.3' }));
    const notesXml = await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string');
    // the item stays an item: the notes pane shows the marker its markup asked for
    expect(notesXml).toContain('<a:buFontTx/><a:buChar char="\u2022"/>');
    expect(notesXml).not.toContain('a:buClr');
  });

  it('writes a touched placeholder body explicitly: no bullets, no gaps, no autofit to inherit', async () => {
    const phDeck = deck();
    // a `body` placeholder the agent edited: `p:ph` keeps it the layout box (spec 06 "Placeholders"), so
    // everything the emitter leaves out comes from the master's `p:bodyStyle` and the layout's autofit
    shapeAt(phDeck, 1).placeholder = 'body:1';

    const zip = await JSZip.loadAsync(await emitPptx(phDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const placeholder = slideXml.split('<p:sp>').find((fragment) => fragment.includes('<p:ph type="body" idx="1"/>'))!;

    // the HTML showed plain paragraphs: no marker, no gap between them
    for (const pPr of placeholder.match(/<a:pPr[^>]*>.*?<\/a:pPr>/g)!) {
      expect(pPr).toContain('<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/>');
    }
    // Chromium measured the box, so the layout's `a:normAutofit` must not shrink the text (spec 04)
    expect(placeholder).toContain('<a:noAutofit/>');
  });

  it('emits list paragraphs with marL, negative indent and bullet properties', async () => {
    const listDeck = deck();
    const base = shapeAt(listDeck, 1);
    const paragraph = (overrides: Partial<Paragraph>): Paragraph => ({
      align: 'l',
      lineHeight: 28.8,
      spaceBefore: 6,
      spaceAfter: 0,
      indent: -15.07,
      marginLeft: 40,
      level: 0,
      runs: [{ kind: 'text', text: 'Item', style: runStyle() }],
      ...overrides,
    });
    base.text!.paragraphs = [
      paragraph({ bullet: { type: 'char', char: '•', color: { hex: 'FF0000', alpha: 1 }, sizePct: 100 } }),
      paragraph({ level: 1, marginLeft: 80, bullet: { type: 'char', char: '◦', color: { hex: '000000', alpha: 1 }, sizePct: 80 } }),
      paragraph({ bullet: { type: 'autonum', scheme: 'alphaLcPeriod', startAt: 3, color: { hex: '000000', alpha: 1 }, sizePct: 100 } }),
      paragraph({ indent: 0, marginLeft: 0 }),
    ];

    const zip = await JSZip.loadAsync(await emitPptx(listDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const pPrs = slideXml.match(/<a:pPr[^>]*>.*?<\/a:pPr>/g)!;

    expect(pPrs[0]).toContain('marL="381000"');
    expect(pPrs[0]).toContain('indent="-143542"');
    expect(pPrs[0]).toContain('lvl="0"');
    // bullet children follow the spacing, in schema order: buClr, buSzPct, buFontTx, buChar
    expect(pPrs[0]).toMatch(/<a:spcBef>.*<\/a:spcBef><a:spcAft><a:spcPts val="0"\/><\/a:spcAft><a:buClr><a:srgbClr val="FF0000"\/><\/a:buClr><a:buFontTx\/><a:buChar char="•"\/>/);
    expect(pPrs[0]).not.toContain('a:buSzPct');

    expect(pPrs[1]).toContain('marL="762000"');
    expect(pPrs[1]).toContain('lvl="1"');
    expect(pPrs[1]).toContain('<a:buSzPct val="80000"/>');
    expect(pPrs[1]).toContain('<a:buChar char="◦"/>');

    expect(pPrs[2]).toContain('<a:buAutoNum type="alphaLcPeriod" startAt="3"/>');

    expect(pPrs[3]).toContain('marL="0"');
    expect(pPrs[3]).toContain('indent="0"');
    expect(pPrs[3]).toContain('<a:buNone/>');
  });

  it('emits linear and radial gradient fills', async () => {
    const gradientDeck = deck();
    const rect = shapeAt(gradientDeck, 0);
    rect.fill = {
      type: 'gradient',
      kind: 'linear',
      angle: 135,
      stops: [
        { position: 0, color: { hex: '2563EB', alpha: 1 } },
        { position: 1, color: { hex: '7C3AED', alpha: 0.5 } },
      ],
    };
    const text = shapeAt(gradientDeck, 1);
    text.fill = { type: 'gradient', kind: 'radial', stops: [{ position: 0, color: { hex: 'FFFFFF', alpha: 1 } }, { position: 0.3, color: { hex: '000000', alpha: 1 } }] };

    const zip = await JSZip.loadAsync(await emitPptx(gradientDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    // CSS 135deg (to bottom-right) is DrawingML 45deg: ang counts clockwise from "to right".
    // Two-stop gradients get an interpolated midpoint: PowerPoint for Mac renders exactly two stops with the wrong colours.
    expect(slideXml).toContain(
      '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="2563EB"/></a:gs><a:gs pos="50000"><a:srgbClr val="514FEC"><a:alpha val="75000"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="7C3AED"><a:alpha val="50000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill>',
    );
    expect(slideXml).toContain(
      '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="15000"><a:srgbClr val="808080"/></a:gs><a:gs pos="30000"><a:srgbClr val="000000"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>',
    );
  });

  it('emits image fills as a:blipFill: stretched with a srcRect, or tiled, with one shared media part', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636000010000050001', 'hex');
    const imageDeck = deck();
    // a contain-style placement: the image ends 60 % above the bottom edge, so the bottom crop is negative
    shapeAt(imageDeck, 0).fill = { type: 'image', media: { data: png, contentType: 'image/png' }, opacity: 0.5, crop: { l: 0.1875, t: 0, r: 0.1875, b: -0.6 } };
    // tiles at half the natural size, the first one offset by 20x10 px
    shapeAt(imageDeck, 1).fill = { type: 'image', media: { data: png, contentType: 'image/png' }, tile: { x: 20, y: 10, scaleX: 0.5, scaleY: 0.5 } };

    const pptx = await emitPptx(imageDeck, { created, appVersion: '1.2.3' });
    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');

    expect((await zipEntries(pptx)).filter((name) => name.startsWith('ppt/media/'))).toHaveLength(1);
    expect(rels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"');
    expect(slideXml).toContain('<a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="50000"/></a:blip><a:srcRect l="18750" t="0" r="18750" b="-60000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>');
    expect(slideXml).toContain('<a:blipFill><a:blip r:embed="rId3"/><a:tile tx="190500" ty="95250" sx="50000" sy="50000" flip="none" algn="tl"/></a:blipFill>');
  });

  it('emits outer and inner shadows as an effect list after the line', async () => {
    const shadowDeck = deck();
    shapeAt(shadowDeck, 0).shadow = { inset: false, offsetX: 4, offsetY: 6, blur: 12, color: { hex: '000000', alpha: 0.3 } };
    shapeAt(shadowDeck, 1).shadow = { inset: true, offsetX: 0, offsetY: 2, blur: 4, color: { hex: '000000', alpha: 1 } };

    const zip = await JSZip.loadAsync(await emitPptx(shadowDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    // dist = hypot(4, 6) px = 7.2111 px = 68686 EMU; dir = atan2(6, 4) = 56.3099deg = 3378596
    expect(slideXml).toContain('</a:ln><a:effectLst><a:outerShdw blurRad="114300" dist="68686" dir="3378596" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:outerShdw></a:effectLst>');
    expect(slideXml).toContain('</a:ln><a:effectLst><a:innerShdw blurRad="38100" dist="19050" dir="5400000"><a:srgbClr val="000000"/></a:innerShdw></a:effectLst>');
  });

  it('emits per-side borders as connector lines centred on each border edge, with unique ids', async () => {
    const borderDeck = deck();
    const rect = shapeAt(borderDeck, 0);
    rect.borders = {
      top: { width: 4, color: { hex: 'FF0000', alpha: 1 }, dash: 'solid' },
      left: { width: 2, color: { hex: '0000FF', alpha: 1 }, dash: 'dash' },
    };

    const zip = await JSZip.loadAsync(await emitPptx(borderDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    // the shape itself keeps its full border box and no line
    expect(slideXml).toContain('<p:cNvPr id="2" name="rect"/>');
    expect(slideXml).toContain('<a:off x="762000" y="190500"/><a:ext cx="952500" cy="476250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln><a:noFill/></a:ln>');
    // top: 100 px wide at y = 20 + 4/2 px; left: 50 px tall at x = 80 + 2/2 px
    expect(slideXml).toContain(
      '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3" name="rect border-top"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="762000" y="209550"/><a:ext cx="952500" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr></p:cxnSp>',
    );
    expect(slideXml).toContain(
      '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="rect border-left"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="771525" y="190500"/><a:ext cx="0" cy="476250"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr></p:cxnSp>',
    );
    expect(slideXml).toContain('<p:cNvPr id="5" name="textbox"/>');
  });

  it('emits per-corner radii as a custom geometry path', async () => {
    const radiiDeck = deck();
    shapeAt(radiiDeck, 0).geometry = { preset: 'custom', radii: { tl: { x: 20, y: 20 }, tr: { x: 0, y: 0 }, br: { x: 40, y: 40 }, bl: { x: 10, y: 5 } } };

    const zip = await JSZip.loadAsync(await emitPptx(radiiDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    expect(slideXml).toContain(
      '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="952500" h="476250">'
        + '<a:moveTo><a:pt x="190500" y="0"/></a:moveTo>'
        + '<a:lnTo><a:pt x="952500" y="0"/></a:lnTo>'
        + '<a:lnTo><a:pt x="952500" y="95250"/></a:lnTo><a:arcTo wR="381000" hR="381000" stAng="0" swAng="5400000"/>'
        + '<a:lnTo><a:pt x="95250" y="476250"/></a:lnTo><a:arcTo wR="95250" hR="47625" stAng="5400000" swAng="5400000"/>'
        + '<a:lnTo><a:pt x="0" y="190500"/></a:lnTo><a:arcTo wR="190500" hR="190500" stAng="10800000" swAng="5400000"/>'
        + '<a:close/></a:path></a:pathLst></a:custGeom>',
    );
  });

  it('emits pictures with content-hashed media parts, srcRect crop, svgBlip and an outline shape', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636000010000050001', 'hex');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', 'utf8');
    const pictureDeck = deck();
    pictureDeck.slides[0]!.elements = [
      {
        kind: 'picture',
        selector: '#photo',
        name: 'img.photo',
        box: { x: 44, y: 304, w: 152, h: 92 },
        rotation: 90,
        crop: { l: 0.1875, t: 0, r: 0.1875, b: 0 },
        geometry: { preset: 'roundRect', radius: 12 },
        outline: { x: 40, y: 300, w: 160, h: 100 },
        line: { width: 4, color: { hex: '000000', alpha: 1 }, dash: 'solid' },
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
    ];

    const pptx = await emitPptx(pictureDeck, { created, appVersion: '1.2.3' });
    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    const contentTypes = await zip.file('[Content_Types].xml')!.async('string');

    // the same PNG bytes are one media part; the svg is a second one
    const media = (await zipEntries(pptx)).filter((name) => name.startsWith('ppt/media/'));
    expect(media).toHaveLength(2);
    expect(media[0]).toMatch(/^ppt\/media\/[0-9a-f]{16}\.png$/);
    expect(media[1]).toMatch(/^ppt\/media\/[0-9a-f]{16}\.svg$/);
    expect(rels).toContain(`Target="../media/${media[0]!.slice('ppt/media/'.length)}"`);
    expect(contentTypes).toContain('<Default Extension="svg" ContentType="image/svg+xml"/>');

    expect(slideXml).toContain(
      '<p:pic><p:nvPicPr><p:cNvPr id="2" name="img.photo"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
        + '<p:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="50000"/></a:blip><a:srcRect l="18750" t="0" r="18750" b="0"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        + '<p:spPr><a:xfrm rot="5400000"><a:off x="419100" y="2895600"/><a:ext cx="1447800" cy="876300"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 13043"/></a:avLst></a:prstGeom></p:spPr></p:pic>',
    );
    // the outline follows the border box, stroke centred on the CSS border: 4 px line deflates by 2 px
    expect(slideXml).toContain('<p:cNvPr id="3" name="img.photo border"/>');
    expect(slideXml).toContain('<a:xfrm rot="5400000"><a:off x="400050" y="2876550"/><a:ext cx="1485900" cy="914400"/></a:xfrm>');
    expect(slideXml).toContain('<a:noFill/><a:ln w="38100"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>');

    expect(slideXml).toContain(
      '<a:blip r:embed="rId3"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId4"/></a:ext></a:extLst></a:blip>',
    );
  });

  it('emits raster pictures as raster-<hash>.png media parts, shared when the captures are identical', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636000010000050001', 'hex');
    const rasterDeck = deck();
    const raster = (selector: string): Element => ({
      kind: 'picture',
      source: 'raster',
      explicit: false,
      selector,
      name: 'div.badge',
      box: { x: 100, y: 50, w: 200, h: 100 },
      rotation: 0,
      crop: { l: 0, t: 0, r: 0, b: 0 },
      geometry: { preset: 'rect' },
      media: { data: png, contentType: 'image/png' },
    });
    rasterDeck.slides[0]!.elements = [raster('#a'), raster('#b')];

    const pptx = await emitPptx(rasterDeck, { created, appVersion: '1.2.3' });
    const media = (await zipEntries(pptx)).filter((name) => name.startsWith('ppt/media/'));
    expect(media).toHaveLength(1);
    expect(media[0]).toMatch(/^ppt\/media\/raster-[0-9a-f]{16}\.png$/);
    const rels = await (await JSZip.loadAsync(pptx)).file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    expect(rels.match(new RegExp(`Target="../media/${media[0]!.slice('ppt/media/'.length)}"`, 'g'))).toHaveLength(2);
  });

  it('emits slide jumps as hlinksldjump over a slide relationship and external links over a hyperlink relationship', async () => {
    const linkDeck = deck();
    linkDeck.slides.push({ ...linkDeck.slides[0]!, index: 2, id: 'closing', name: 'Closing', elements: [] });
    const textbox = shapeAt(linkDeck, 1);
    textbox.text!.paragraphs[0]!.runs = [
      { kind: 'text', text: 'jump', style: runStyle({ link: '#closing' }) },
      { kind: 'text', text: 'out', style: runStyle({ link: 'https://example.com/' }) },
    ];

    const pptx = await emitPptx(linkDeck, { created, appVersion: '1.2.3' });
    const zip = await JSZip.loadAsync(pptx);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    expect(slideXml).toContain('<a:hlinkClick r:id="rId2" action="ppaction://hlinksldjump"/>');
    expect(rels).toContain('<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slide2.xml"/>');
    expect(slideXml).toContain('<a:hlinkClick r:id="rId3"/>');
    expect(rels).toContain('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>');
  });

  it('emits tables as a graphic frame with grid columns, merged cells, per-edge borders and cell insets', async () => {
    const body = (text: string): TextBody => ({
      padding: { l: 0, t: 0, r: 0, b: 0 },
      firstParagraphGap: 0,
      lastParagraphGap: 0,
      wrap: true,
      rtl: false,
      trailingGuard: 0,
      paragraphs: [{ align: 'l', lineHeight: 24, spaceBefore: 0, spaceAfter: 0, indent: 0, marginLeft: 0, level: 0, runs: [{ kind: 'text', text, style: runStyle({ size: 20 }) }] }],
    });
    const line: Line = { width: 1, color: { hex: '94A3B8', alpha: 1 }, dash: 'solid' };
    const cell = (text: string, overrides: Partial<TableCell> = {}): TableCell => ({
      colSpan: 1,
      rowSpan: 1,
      borders: { top: line, right: line, bottom: line, left: line },
      padding: { l: 12, t: 8, r: 12, b: 8 },
      anchor: 't',
      text: body(text),
      ...overrides,
    });
    const tableDeck = deck();
    tableDeck.slides[0]!.elements = [
      {
        kind: 'table',
        selector: '#grid',
        name: 'table.grid',
        box: { x: 40, y: 40, w: 300, h: 100 },
        columns: [100, 200],
        rows: [
          { height: 40, cells: [cell('A', { fill: { type: 'solid', color: { hex: 'E2E8F0', alpha: 1 } } }), cell('B', { anchor: 'b', borders: {} })] },
          { height: 60, cells: [cell('Wide', { colSpan: 2, borders: { top: { width: 3, color: { hex: '0F172A', alpha: 1 }, dash: 'dash' } } }), cell('', { merged: 'h' })] },
        ],
      },
    ];

    const zip = await JSZip.loadAsync(await emitPptx(tableDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    expect(slideXml).toContain(
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="table.grid"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
        + '<p:xfrm><a:off x="381000" y="381000"/><a:ext cx="2857500" cy="952500"/></p:xfrm>'
        + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="952500"/><a:gridCol w="1905000"/></a:tblGrid>',
    );
    expect(slideXml).toContain('<a:tr h="381000"><a:tc>');
    // cell A: text body, then tcPr with insets (marT carries the 0.41 px baseline correction for Arial 20px in a 24px line), anchor, four borders in lnL/lnR/lnT/lnB order, then fill
    expect(slideXml).toMatch(
      /<a:tc><a:txBody><a:bodyPr\/><a:lstStyle\/><a:p>.*?<a:t xml:space="preserve">A<\/a:t>.*?<\/a:p><\/a:txBody><a:tcPr marL="114300" marR="114300" marT="72291" marB="76200" anchor="t"><a:lnL w="9525"><a:solidFill><a:srgbClr val="94A3B8"\/><\/a:solidFill><\/a:lnL><a:lnR w="9525">.*?<\/a:lnR><a:lnT w="9525">.*?<\/a:lnT><a:lnB w="9525">.*?<\/a:lnB><a:solidFill><a:srgbClr val="E2E8F0"\/><\/a:solidFill><\/a:tcPr><\/a:tc>/,
    );
    // cell B: bottom anchor, explicit noFill borders so the table style draws nothing
    expect(slideXml).toMatch(/<a:t xml:space="preserve">B<\/a:t>.*?<a:tcPr marL="114300" marR="114300" marT="76200" marB="76200" anchor="b"><a:lnL><a:noFill\/><\/a:lnL><a:lnR><a:noFill\/><\/a:lnR><a:lnT><a:noFill\/><\/a:lnT><a:lnB><a:noFill\/><\/a:lnB><\/a:tcPr>/);
    // spanning cell and its horizontal continuation
    expect(slideXml).toContain('<a:tr h="571500"><a:tc gridSpan="2">');
    expect(slideXml).toContain('<a:lnT w="28575"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:prstDash val="dash"/></a:lnT>');
    expect(slideXml).toMatch(/<a:tc hMerge="1"><a:txBody><a:bodyPr\/><a:lstStyle\/><a:p><a:endParaRPr lang="en-US" sz="1500"\/><\/a:p><\/a:txBody><a:tcPr\/>/);
  });

  it('emits groups as p:grpSp with child coordinate space and nested ids in document order', async () => {
    const groupDeck = deck();
    const [rect, textbox] = [shapeAt(groupDeck, 0), shapeAt(groupDeck, 1)];
    groupDeck.slides[0]!.elements = [
      {
        kind: 'group',
        selector: '#g',
        name: 'div.card',
        box: { x: 103.02, y: 22.9, w: 100, h: 100 },
        childBox: { x: 30, y: 20, w: 200, h: 100 },
        rotation: 20,
        children: [rect, { kind: 'group', selector: '#n', name: 'div.nested', box: { x: 30, y: 40, w: 200, h: 80 }, childBox: { x: 30, y: 40, w: 200, h: 80 }, rotation: 0, children: [textbox] }],
      },
    ];

    const zip = await JSZip.loadAsync(await emitPptx(groupDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    expect(slideXml).toContain(
      '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="div.card"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        + '<p:grpSpPr><a:xfrm rot="1200000"><a:off x="981266" y="218123"/><a:ext cx="952500" cy="952500"/><a:chOff x="285750" y="190500"/><a:chExt cx="1905000" cy="952500"/></a:xfrm></p:grpSpPr>'
        + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="rect"/>',
    );
    expect(slideXml).toContain('<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="div.nested"/>');
    expect(slideXml).toContain('<p:cNvPr id="5" name="textbox"/>');
    expect(slideXml.match(/<\/p:grpSp>/g)).toHaveLength(2);
  });

  it('emits text-bearing rounded shapes as a custom path with a full text rectangle', async () => {
    const roundedDeck = deck();
    shapeAt(roundedDeck, 0).geometry = { preset: 'roundRect', radius: 10 };
    shapeAt(roundedDeck, 1).geometry = { preset: 'roundRect', radius: 20 };

    const zip = await JSZip.loadAsync(await emitPptx(roundedDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    // text-free: the preset keeps the shape editable as a rounded rectangle
    expect(slideXml).toContain('<p:cNvPr id="2" name="rect"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="0"><a:off x="762000" y="190500"/><a:ext cx="952500" cy="476250"/></a:xfrm><a:prstGeom prst="roundRect">');
    // with text: PowerPoint insets a preset roundRect\'s text rectangle by the radius, which changes wrapping
    expect(slideXml).toContain('<p:cNvPr id="3" name="textbox"/>');
    expect(slideXml).toContain('<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="1905000" h="762000"><a:moveTo><a:pt x="190500" y="0"/></a:moveTo>');
    expect(slideXml).not.toContain('<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/>');
  });

  it.skipIf(!sofficeAvailable)('opens in LibreOffice and converts to PDF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-emit-'));
    const pptxPath = join(dir, 'deck.pptx');
    await writeFile(pptxPath, await emitPptx(deck(), { created, appVersion: '1.2.3' }));

    const result = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, pptxPath], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const pdfPath = join(dir, 'deck.pdf');
    const info = await stat(pdfPath);
    expect(info.size).toBeGreaterThan(0);
    expect((await readFile(pdfPath)).length).toBeGreaterThan(0);
  });
});
