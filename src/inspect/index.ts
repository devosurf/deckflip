// IDM -> inspect JSON (docs/spec/09-inspect.md). Structure only: an agent checks bounds, kinds and provenance
// without rendering. The full schema is frozen in milestone 5; today's shape is the subset convert already knows.

import type { Deck, Element, ResolvedFont, TextBody } from '../model/index.js';
import { textBodiesOf } from '../model/index.js';

export interface InspectElement {
  kind: 'group' | 'picture' | 'table' | 'shape' | 'text';
  /** `raster` for captured subtrees (spec 05), else `native` */
  source: 'native' | 'raster';
  /** raster pictures: whether `data-raster` asked for the capture */
  explicit?: boolean;
  selector: string;
  box: Element['box'];
  text?: string;
  children?: InspectElement[];
}

export interface InspectDocument {
  schemaVersion: 1;
  canvas: Deck['canvas'];
  slides: Array<{ index: number; id: string; name: string; elements: InspectElement[] }>;
  fonts: ResolvedFont[];
}

export function inspectDeck(deck: Deck): InspectDocument {
  return {
    schemaVersion: 1,
    canvas: deck.canvas,
    slides: deck.slides.map((slide) => ({
      index: slide.index,
      id: slide.id,
      name: slide.name,
      elements: slide.elements.map(inspectElement),
    })),
    fonts: uniqueFonts(deck),
  };
}

function inspectElement(element: Element): InspectElement {
  if (element.kind === 'group') {
    return { kind: 'group', source: 'native', selector: element.selector, box: element.box, children: element.children.map(inspectElement) };
  }
  if (element.kind === 'picture') {
    return element.source === 'raster'
      ? { kind: 'picture', source: 'raster', explicit: element.explicit === true, selector: element.selector, box: element.box }
      : { kind: 'picture', source: 'native', selector: element.selector, box: element.box };
  }
  if (element.kind === 'table') {
    return { kind: 'table', source: 'native', selector: element.selector, box: element.box };
  }
  return {
    kind: element.text === undefined ? 'shape' : 'text',
    source: 'native',
    selector: element.selector,
    box: element.box,
    ...(element.text === undefined ? {} : { text: previewText(element.text) }),
  };
}

function previewText(body: TextBody): string {
  let text = '';
  for (const paragraph of body.paragraphs) {
    for (const run of paragraph.runs) {
      text += run.kind === 'text' ? run.text : '\n';
    }
    text += '\n';
  }
  return text.trimEnd().slice(0, 120);
}

function uniqueFonts(deck: Deck): ResolvedFont[] {
  const fonts = new Map<string, ResolvedFont>();
  for (const slide of deck.slides) {
    for (const element of slide.elements) {
      for (const { body } of textBodiesOf(element)) {
        for (const paragraph of body.paragraphs) {
          for (const run of paragraph.runs) {
            if (run.kind !== 'text' || run.style.font === undefined) {
              continue;
            }
            fonts.set(run.style.font.file, run.style.font);
          }
        }
      }
    }
  }
  return [...fonts.values()];
}
