import { describe, expect, it } from 'vitest';
import { emitPptx } from '../../src/emit/index.js';
import type { Deck, Element, Paragraph, PictureElement, RunStyle, ShapeElement } from '../../src/model/index.js';
import { parsePptx } from '../../src/parse/index.js';
import { buildBlankPptx } from '../render/pptx-fixture.js';

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
      selector: '[data-shape-id="2"]',
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
      selector: '[data-shape-id="2"]',
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
});
