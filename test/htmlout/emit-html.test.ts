import { describe, expect, it } from 'vitest';
import { emitHtml } from '../../src/htmlout/index.js';
import type { Deck, Element } from '../../src/model/index.js';

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
});
