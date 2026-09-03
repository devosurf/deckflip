// `PRESERVE_OPAQUE_*` (docs/spec/08-report-codes.md): what a round trip carries opaquely. PPTX -> HTML and
// `validate deck.pptx` list everything the source holds; the way back lists what it actually carried.

import type { Deck, Element, Slide } from '../model/index.js';
import { REL } from '../ooxml/opc.js';
import { entry as reportEntry } from '../report/codes.js';
import type { Entry, Locator } from '../report/types.js';
import type { SourceIndex, SourceSlide } from './source.js';

const VBA_REL = /\/vbaProject$/;
const COMMENTS_REL = /\/comments$/;

export function hasVba(source: SourceIndex): boolean {
  return source.presentation.rels.some((rel) => VBA_REL.test(rel.type));
}

export function hasComments(slide: SourceSlide): boolean {
  return slide.rels.some((rel) => COMMENTS_REL.test(rel.type));
}

export function hasTiming(slide: SourceSlide): boolean {
  return slide.pieces.has('p:timing');
}

/** `{shapeId, name}` for PPTX input, the `data-shape-id` selector for HTML input (spec 01). */
export function locatorFor(element: Element, kind: 'pptx' | 'html'): Locator {
  if (kind === 'pptx' && element.shapeId !== undefined) return { shapeId: element.shapeId, name: element.name };
  return { selector: element.selector };
}

export function opaqueEntry(element: Element & { kind: 'opaque' }, slide: number, kind: 'pptx' | 'html'): Entry {
  return reportEntry(`PRESERVE_OPAQUE_${element.class.toUpperCase()}`, { slide, locator: locatorFor(element, kind), reason: `${element.name || 'an element'} is ${element.class === 'ole' ? 'an embedded object' : element.class === 'smartart' ? 'SmartArt' : `a ${element.class === 'vector' ? 'vector drawing' : element.class}`}; carried from the source as it is` });
}

export function textEffectsEntry(element: Element, slide: number, kind: 'pptx' | 'html'): Entry {
  return reportEntry('PRESERVE_OPAQUE_TEXT_EFFECTS', { slide, locator: locatorFor(element, kind), reason: `${element.name || 'a text box'} has text effects; carried while the text is untouched` });
}

export function animationEntry(slide: Slide, kind: 'pptx' | 'html'): Entry {
  return reportEntry('PRESERVE_OPAQUE_ANIMATION', { slide: slide.index, ...(kind === 'html' ? { locator: { selector: `#${slide.id}` } } : {}), reason: `Slide ${slide.index} keeps its animations and transition from the source` });
}

export function commentsEntry(slide: Slide, kind: 'pptx' | 'html'): Entry {
  return reportEntry('PRESERVE_OPAQUE_COMMENTS', { slide: slide.index, ...(kind === 'html' ? { locator: { selector: `#${slide.id}` } } : {}), reason: `Slide ${slide.index} keeps its comments from the source` });
}

export function deckEntries(source: SourceIndex): Entry[] {
  const entries: Entry[] = [];
  if (source.presentation.rels.some((rel) => rel.type === REL.slideMaster)) {
    entries.push(reportEntry('PRESERVE_OPAQUE_MASTER', { reason: 'masters, layouts and themes come from the source; new Slides instantiate the layout they name' }));
  }
  if (hasVba(source)) {
    entries.push(reportEntry('PRESERVE_OPAQUE_VBA', { reason: 'the VBA project is carried; the output stays macro-enabled (.pptm)' }));
  }
  return entries;
}

/** Everything the source holds opaquely, in Slide order then deck level: the PPTX side's report. */
export function sourceEntries(deck: Deck, source: SourceIndex): Entry[] {
  const entries: Entry[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    const visit = (element: Element): void => {
      if (element.kind === 'opaque') entries.push(opaqueEntry(element, slide.index, 'pptx'));
      else if (element.kind === 'shape' && element.preserve === 'text-effects') entries.push(textEffectsEntry(element, slide.index, 'pptx'));
      else if (element.kind === 'group') element.children.forEach(visit);
    };
    slide.elements.forEach(visit);
    const sourceSlide = source.slides[index];
    if (sourceSlide && hasTiming(sourceSlide)) entries.push(animationEntry(slide, 'pptx'));
    if (sourceSlide && hasComments(sourceSlide)) entries.push(commentsEntry(slide, 'pptx'));
  }
  entries.push(...deckEntries(source));
  return entries;
}
