import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { Deck, Paragraph, ResolvedFont, RunStyle } from '../../src/model/index.js';
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

async function zipEntries(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => !name.endsWith('/'));
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

  it('emits list paragraphs with marL, negative indent and bullet properties', async () => {
    const listDeck = deck();
    const base = listDeck.slides[0]!.elements[1]!;
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
      paragraph({ indent: 0, marginLeft: 0, bullet: { type: 'none' } }),
    ];

    const zip = await JSZip.loadAsync(await emitPptx(listDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const pPrs = slideXml.match(/<a:pPr[^>]*>.*?<\/a:pPr>/g)!;

    expect(pPrs[0]).toContain('marL="381000"');
    expect(pPrs[0]).toContain('indent="-143542"');
    expect(pPrs[0]).toContain('lvl="0"');
    // bullet children follow spacing, in schema order: buClr, buSzPct, buFontTx, buChar
    expect(pPrs[0]).toMatch(/<a:spcBef>.*<\/a:spcBef><a:buClr><a:srgbClr val="FF0000"\/><\/a:buClr><a:buFontTx\/><a:buChar char="•"\/>/);
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
    const rect = gradientDeck.slides[0]!.elements[0]!;
    rect.fill = {
      type: 'gradient',
      kind: 'linear',
      angle: 135,
      stops: [
        { position: 0, color: { hex: '2563EB', alpha: 1 } },
        { position: 1, color: { hex: '7C3AED', alpha: 0.5 } },
      ],
    };
    const text = gradientDeck.slides[0]!.elements[1]!;
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

  it('emits outer and inner shadows as an effect list after the line', async () => {
    const shadowDeck = deck();
    shadowDeck.slides[0]!.elements[0]!.shadow = { inset: false, offsetX: 4, offsetY: 6, blur: 12, color: { hex: '000000', alpha: 0.3 } };
    shadowDeck.slides[0]!.elements[1]!.shadow = { inset: true, offsetX: 0, offsetY: 2, blur: 4, color: { hex: '000000', alpha: 1 } };

    const zip = await JSZip.loadAsync(await emitPptx(shadowDeck, { created, appVersion: '1.2.3' }));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');

    // dist = hypot(4, 6) px = 7.2111 px = 68686 EMU; dir = atan2(6, 4) = 56.3099deg = 3378596
    expect(slideXml).toContain('</a:ln><a:effectLst><a:outerShdw blurRad="114300" dist="68686" dir="3378596" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:outerShdw></a:effectLst>');
    expect(slideXml).toContain('</a:ln><a:effectLst><a:innerShdw blurRad="38100" dist="19050" dir="5400000"><a:srgbClr val="000000"/></a:innerShdw></a:effectLst>');
  });

  it('emits per-side borders as connector lines centred on each border edge, with unique ids', async () => {
    const borderDeck = deck();
    const rect = borderDeck.slides[0]!.elements[0]!;
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
    radiiDeck.slides[0]!.elements[0]!.geometry = { preset: 'custom', radii: { tl: { x: 20, y: 20 }, tr: { x: 0, y: 0 }, br: { x: 40, y: 40 }, bl: { x: 10, y: 5 } } };

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
