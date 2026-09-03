// IDM -> HTML Deck (docs/spec/02-deck-dialect.md "Absolute-positioned form"): the inverse of html/. One
// document, deterministic; assets (media) are returned as paths relative to the Deck's Asset directory.
// Nothing here knows about OOXML.

import type { Deck, ShapeElement, Slide } from '../model/index.js';
import { baseStylesheet } from '../html/base.css.js';
import { borderCss, fillCss, geometryCss, shadowCss } from './css.js';
import { elementsHtml, nameParts, type ElementContext } from './elements.js';
import { attr, text } from './escape.js';
import { Stylesheet } from './text.js';

export interface HtmlDeck {
  html: string;
  /** `<name>.assets/`-relative path -> bytes */
  assets: Map<string, Uint8Array>;
  /** what the written elements stand for beyond their own `data-shape-id`, per Slide (the manifest's `spids`) */
  slides: HtmlSlide[];
}

export interface HtmlSlide {
  /** the section id */
  id: string;
  /** the shape id of the background shape the section itself carries */
  background?: string;
  /** written `data-shape-id` -> every shape id the element stands for, in paint order */
  merged: Record<string, string[]>;
}

export interface EmitHtmlOptions {
  /** the Asset directory as referenced from the HTML; default `deck.assets` */
  assetsDir?: string;
}

export function emitHtml(deck: Deck, opts: EmitHtmlOptions = {}): HtmlDeck {
  const ids = new Map(deck.slides.map((slide) => [slide.id, sectionId(slide)] as const));
  const ctx: Omit<ElementContext, 'merged'> = { sheet: new Stylesheet(ids), assetsDir: opts.assetsDir ?? 'deck.assets', assets: new Map() };
  const slides: HtmlSlide[] = [];
  const sections = deck.slides.map((slide) => {
    const emitted = emitSlide(slide, ids.get(slide.id)!, { ...ctx, merged: new Map() });
    slides.push(emitted.record);
    return emitted.html;
  });
  const html = [
    '<!doctype html>',
    `<html lang="${attr(deck.lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta name="deckflip:canvas" content="${deck.canvas.width}x${deck.canvas.height}">`,
    `<title>${text(deck.title)}</title>`,
    '<style>',
    baseStylesheet(deck.canvas.width, deck.canvas.height),
    ...ctx.sheet.rules(),
    '</style>',
    '</head>',
    '<body>',
    ...sections,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return { html, assets: ctx.assets, slides };
}

/**
 * A text-free shape named after the section is the section's own background (the measurer pushes one when
 * the section paints); its decoration goes on the section so it measures back in the same position.
 */
function sectionBackground(slide: Slide): { shape?: ShapeElement; rest: Slide['elements'] } {
  const first = slide.elements[0];
  if (first?.kind === 'shape' && nameParts(first.name).tag === 'section' && !first.text && first.box.x === 0 && first.box.y === 0) {
    return { shape: first, rest: slide.elements.slice(1) };
  }
  return { rest: slide.elements };
}

/** The author's section id survives in the background shape's name (`section#id`); slide jumps are rewritten to it. */
function sectionId(slide: Slide): string {
  const background = sectionBackground(slide).shape;
  const id = background && /^section#([^\s.#]+)/.exec(background.name)?.[1];
  return id ?? slide.id;
}

function emitSlide(slide: Slide, id: string, ctx: ElementContext): { html: string; record: HtmlSlide } {
  const { shape, rest } = sectionBackground(slide);
  const attrs = [`id="${attr(id)}"`, `data-title="${attr(slide.name)}"`, `data-layout="${attr(slide.layout)}"`];
  if (slide.section !== undefined) {
    attrs.push(`data-section="${attr(slide.section)}"`);
  }
  if (shape) {
    const css = [...geometryCss(shape.geometry), ...(shape.fill && shape.fill.type !== 'image' ? fillCss(shape.fill) : []), ...borderCss(shape.line, shape.borders), ...shadowCss(shape.shadow)];
    attrs.push(`style="${css.join('; ')}"`);
  }
  const elements = elementsHtml(rest, { x: 0, y: 0 }, ctx);
  const html = [`<section ${attrs.join(' ')}>`, ...elements, '</section>'].join('\n');
  const record: HtmlSlide = { id, ...(shape?.shapeId === undefined ? {} : { background: shape.shapeId }), merged: Object.fromEntries(ctx.merged) };
  return { html, record };
}
