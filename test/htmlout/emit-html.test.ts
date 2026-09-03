import { describe, expect, it } from 'vitest';
import { emitHtml } from '../../src/htmlout/index.js';
import type { Deck, Element, PictureElement, ShapeElement } from '../../src/model/index.js';

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
});
