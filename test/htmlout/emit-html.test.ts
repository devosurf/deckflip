import { describe, expect, it } from 'vitest';
import { emitHtml } from '../../src/htmlout/index.js';
import type { Deck, Element, OpaqueElement, PictureElement, Paragraph, RunStyle, ShapeElement, TextBody } from '../../src/model/index.js';

function runStyle(overrides: Partial<RunStyle> = {}): RunStyle {
  return { fontStack: ['Arial'], weight: 400, size: 12, bold: false, italic: false, underline: false, strike: false, color: { hex: '000000', alpha: 1 }, letterSpacing: 0, caps: 'none', baseline: 0, ...overrides };
}

function notes(...paragraphs: Array<Paragraph['runs']>): TextBody {
  return {
    padding: { l: 0, t: 0, r: 0, b: 0 },
    firstParagraphGap: 0,
    lastParagraphGap: 0,
    wrap: true,
    rtl: false,
    trailingGuard: 0,
    paragraphs: paragraphs.map((runs) => ({ align: 'l', lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent: 0, marginLeft: 0, level: 0, runs })),
  };
}

function deckWith(elements: Element[], slides: Partial<Deck['slides'][number]>[] = [{}]): Deck {
  return {
    title: 'Quarterly <review>',
    lang: 'sv-SE',
    canvas: { width: 960, height: 540, source: 'deck-meta' },
    fontFaces: [],
    slides: slides.map((slide, index) => ({ index: index + 1, id: `slide-${index + 1}`, name: `Slide ${index + 1}`, layout: 'Blank', elements: index === 0 ? elements : [], ...slide })),
  };
}

describe('emitHtml', () => {
  it('writes the deck head, canvas meta and one section per slide with its id, title and layout', () => {
    const { html, assets } = emitHtml(deckWith([], [{ name: 'Opening "act"' }, { name: 'Closing', layout: 'Title Only', section: 'Wrap-up' }]));
    expect(assets.size).toBe(0);
    expect(html.startsWith('<!doctype html>\n<html lang="sv-SE">')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="deckflip:canvas" content="960x540">');
    expect(html).toContain('<title>Quarterly &lt;review&gt;</title>');
    expect(html).toContain('body > section { position: relative; box-sizing: border-box; overflow: hidden; width: 960px; height: 540px; }');
    expect(html).toContain('<section id="slide-1" data-title="Opening &quot;act&quot;" data-layout="Blank">');
    expect(html).toContain('<section id="slide-2" data-title="Closing" data-layout="Title Only" data-section="Wrap-up">');
    expect(html.match(/<section /g)).toHaveLength(2);
  });

  it('writes data-shape-id on every element from a shape and records which shapes a section or a merged element stands for', () => {
    const box = { x: 10, y: 10, w: 100, h: 50 };
    const background: ShapeElement = { kind: 'shape', shapeId: '1-2', selector: '[data-shape-id="1-2"]', name: 'section#intro', box: { x: 0, y: 0, w: 960, h: 540 }, rotation: 0, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: 'EEEEEE', alpha: 1 } } };
    const picture: PictureElement = { kind: 'picture', shapeId: '1-3', selector: '[data-shape-id="1-3"]', name: 'img.photo', box, rotation: 0, crop: { l: 0, t: 0, r: 0, b: 0 }, geometry: { preset: 'rect' }, media: { data: new Uint8Array([1, 2, 3]), contentType: 'image/png' } };
    const border: ShapeElement = { kind: 'shape', shapeId: '1-4', selector: '[data-shape-id="1-4"]', name: 'img.photo border', box, rotation: 0, geometry: { preset: 'rect' }, line: { width: 2, color: { hex: '000000', alpha: 1 }, dash: 'solid' } };
    const card: ShapeElement = { kind: 'shape', shapeId: '1-5', selector: '[data-shape-id="1-5"]', name: 'div.card', box: { ...box, y: 100 }, rotation: 0, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: '2563EB', alpha: 1 } } };
    const plain: ShapeElement = { kind: 'shape', selector: '#new', name: 'div.new', box: { ...box, y: 200 }, rotation: 0, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: '000000', alpha: 1 } } };
    const { html, slides } = emitHtml(deckWith([background, picture, border, card, plain]));
    expect(html).toContain('<section id="intro"');
    expect(html).toMatch(/<img class="photo" data-shape-id="1-3" /);
    expect(html).not.toContain('data-shape-id="1-4"');
    expect(html).toMatch(/<div class="card" data-shape-id="1-5" /);
    expect(html).toMatch(/<div class="new" style=/);
    expect(html.match(/data-shape-id/g)).toHaveLength(2);
    expect(slides).toEqual([{ id: 'intro', background: '1-2', merged: { '1-3': ['1-3', '1-4'] } }]);
  });

  it('writes opaque content as an empty data-preserve box with its label, and marks text effects on their shape', () => {
    const chart: OpaqueElement = { kind: 'opaque', class: 'chart', shapeId: '1-2', selector: '[data-shape-id="1-2"]', name: 'Chart 1', box: { x: 96, y: 96, w: 192, h: 96 }, rotation: 15, parts: ['/ppt/charts/chart1.xml'] };
    const wordArt: ShapeElement = { kind: 'shape', shapeId: '1-3', preserve: 'text-effects', selector: '[data-shape-id="1-3"]', name: 'WordArt 2', box: { x: 0, y: 200, w: 100, h: 50 }, rotation: 0, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: '000000', alpha: 1 } } };
    const { html, slides } = emitHtml(deckWith([chart, wordArt]));
    expect(html).toContain('<div data-preserve="chart" data-shape-id="1-2" title="Chart 1" style="position: absolute; left: 96px; top: 96px; width: 192px; height: 96px; transform: rotate(15deg)"></div>');
    expect(html).toMatch(/<div data-shape-id="1-3" data-preserve="text-effects" style=/);
    expect(html).toContain('[data-preserve]');
    expect(slides).toEqual([{ id: 'slide-1', merged: {} }]);
  });

  it('writes speaker notes as an aside the stylesheet hides, one paragraph each, with emphasis and links as markup', () => {
    const body = notes(
      [{ kind: 'text', text: 'Speak slowly & ', style: runStyle() }, { kind: 'text', text: 'pause', style: runStyle({ bold: true, italic: true }) }],
      [{ kind: 'text', text: 'Then ', style: runStyle() }, { kind: 'text', text: 'slide two', style: runStyle({ link: '#slide-2' }) }, { kind: 'break' }, { kind: 'text', text: 'aloud', style: runStyle({ underline: true }) }],
    );
    const { html } = emitHtml(deckWith([], [{ notes: body }, {}]));

    expect(html).toContain('<aside class="notes">\n<p>Speak slowly &amp; <strong><em>pause</em></strong></p>\n<p>Then <a href="#slide-2">slide two</a><br>\n<u>aloud</u></p>\n</aside>');
    expect(html).toContain('aside.notes { display: none !important; }');
    // a Slide without notes gets no aside
    expect(html.match(/<aside/g)).toHaveLength(1);
  });

  it('writes bulleted notes paragraphs as the lists the notes dialect allows, nesting deeper levels', () => {
    const body = notes([{ kind: 'text', text: 'Cover', style: runStyle() }]);
    const item = (text: string, level: number, bullet: NonNullable<Paragraph['bullet']>): Paragraph => ({
      align: 'l', lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent: 0, marginLeft: 0, level, bullet, runs: [{ kind: 'text', text, style: runStyle() }],
    });
    const disc = { type: 'char', char: '\u2022', color: { hex: '000000', alpha: 1 }, sizePct: 100 } as const;
    body.paragraphs.push(
      item('first', 0, disc),
      item('nested', 1, { type: 'char', char: '\u25E6', color: { hex: '000000', alpha: 1 }, sizePct: 100 }),
      item('second', 0, disc),
      item('then this', 0, { type: 'autonum', scheme: 'arabicPeriod', startAt: 3, color: { hex: '000000', alpha: 1 }, sizePct: 100 }),
    );
    const { html } = emitHtml(deckWith([], [{ notes: body }]));

    expect(html).toContain([
      '<aside class="notes">',
      '<p>Cover</p>',
      '<ul>',
      '<li>first<ul>',
      '<li>nested</li>',
      '</ul></li>',
      '<li>second</li>',
      '</ul>',
      '<ol start="3">',
      '<li>then this</li>',
      '</ol>',
      '</aside>',
    ].join('\n'));
  });

  it('marks the placeholder a shape or picture fills with data-placeholder', () => {
    const box = { x: 10, y: 10, w: 100, h: 50 };
    const title: ShapeElement = { kind: 'shape', shapeId: '1-2', placeholder: 'title', selector: '[data-shape-id="1-2"]', name: 'div.title', box, rotation: 0, geometry: { preset: 'rect' }, fill: { type: 'solid', color: { hex: 'EEEEEE', alpha: 1 } } };
    const photo: PictureElement = { kind: 'picture', shapeId: '1-3', placeholder: 'pic:3', selector: '[data-shape-id="1-3"]', name: 'img.photo', box: { ...box, y: 100 }, rotation: 0, crop: { l: 0, t: 0, r: 0, b: 0 }, geometry: { preset: 'rect' }, media: { data: new Uint8Array([1, 2, 3]), contentType: 'image/png' } };
    const { html } = emitHtml(deckWith([title, photo]));

    expect(html).toMatch(/<div class="title" data-shape-id="1-2" data-placeholder="title" style=/);
    expect(html).toMatch(/<img class="photo" data-shape-id="1-3" data-placeholder="pic:3" /);
  });
});
