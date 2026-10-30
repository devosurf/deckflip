// `PRESERVE_OPAQUE_*` (docs/spec/08-report-codes.md): what a round trip carries opaquely. PPTX -> HTML and
// `validate deck.pptx` list everything the source holds; the way back lists what it actually carried.

import { ACCEPTED_EDITABLE_FSTYPE_MASK } from '../fonts/embedding.js';
import { textBodiesOf, type Deck, type Element, type EmbeddedFont, type Slide } from '../model/index.js';
import { REL } from '../ooxml/opc.js';
import { entry as reportEntry } from '../report/codes.js';
import type { Entry, Locator } from '../report/types.js';
import type { SourceIndex, SourceSlide } from './source.js';
import type { SplicePlan } from './plan.js';

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

/** Source payloads are preserved, never advertised as newly embedded complete faces. */
export function embeddedFontEntries(deck: Deck, plan?: SplicePlan): Entry[] {
  const entries: Entry[] = [];
  const edited = editedEmbeddedFonts(deck, plan);
  for (const font of deck.embeddedFonts ?? []) {
    const identity = `${font.family} (${font.slot}, ${font.part})`;
    const fields = (reason: string) => ({ reason, params: { family: font.family } });
    if (font.formatError) {
      entries.push({
        ...reportEntry('FONT_EMBED_FORMAT', fields(`${identity} is preserved, but cannot be read as supported EOT: ${font.formatError}`)),
        severity: 'warning', kind: 'flagged',
        hint: 'Keep source.pptx and deckflip.json together; supply the complete original font for a readable preview without replacing the preserved source payload',
      });
    }
    if (font.fsType !== undefined && (font.fsType & ~ACCEPTED_EDITABLE_FSTYPE_MASK) !== 0) {
      entries.push({
        ...reportEntry('FONT_EMBED_RESTRICTED', fields(`${identity} retains source fsType 0x${font.fsType.toString(16).padStart(4, '0')}, which does not permit editable outline embedding; the original payload is preserved without granting new rights`)),
        severity: 'warning', kind: 'flagged',
        hint: 'Preservation retains the original permission bits and grants no new embedding rights; check the font licence and obtain the rights needed for editing and redistribution',
      });
    }
    if (edited.has(font) && (font.subset || font.compressed)) {
      entries.push(reportEntry('FONT_EMBED_SUBSET', fields(`${identity} is preserved, but edited text coverage cannot be verified; new characters may fall back in PowerPoint`)));
    } else if (font.subset) {
      entries.push(reportEntry('FONT_EMBED_SUBSET', fields(`${identity} is a preserved EOT subset with limited editing; characters outside the original subset can fall back in PowerPoint`)));
    }
    if (font.compressed) {
      entries.push({
        ...reportEntry('FONT_EMBED_FORMAT', fields(`${identity} is preserved verbatim as MTX-compressed EOT; Chromium cannot decode this payload and HTML previews can use a fallback, while the source package retains the original font`)),
        kind: 'preserved', severity: 'warning',
        hint: 'Keep source.pptx and deckflip.json together; supply the complete original font for a faithful HTML preview',
      });
    }
  }
  return entries;
}

/** Only text bodies rebuilt by the splice plan need a new coverage warning. */
function editedEmbeddedFonts(deck: Deck, plan: SplicePlan | undefined): Set<EmbeddedFont> {
  const edited = new Set<EmbeddedFont>();
  if (!plan) return edited;
  for (const [index, slide] of deck.slides.entries()) {
    const slidePlan = plan.slides[index];
    if (slidePlan?.untouched) continue;
    const visit = (element: Element): void => {
      if (slidePlan?.splices.has(element)) return;
      if (element.kind === 'group') {
        element.children.forEach(visit);
        return;
      }
      for (const { body } of textBodiesOf(element)) {
        for (const paragraph of body.paragraphs) {
          for (const run of paragraph.runs) {
            if (run.kind === 'text' && run.style.embeddedFont) edited.add(run.style.embeddedFont);
          }
        }
      }
    };
    slide.elements.forEach(visit);
  }
  return edited;
}
