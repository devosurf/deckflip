// PowerPoint sections (spec 06 "Sections"): the Deck spells them as `data-section` on the first Slide of each
// section, so the list is regenerated from the Deck on both paths rather than patched from the source.

import { createHash } from 'node:crypto';
import type { Slide } from '../model/index.js';
import { el, type XmlNode } from '../ooxml/xml.js';

const P14_NS = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
/** The `p:ext/@uri` PowerPoint 2010 registered its section list under. */
export const SECTION_EXT_URI = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';
/** What PowerPoint itself names the section holding the Slides ahead of the first one an author marked. */
const DEFAULT_SECTION = 'Default Section';

export interface DeckSection {
  name: string;
  /** `p:sldId/@id` of every Slide the section holds, in Deck order */
  slideIds: number[];
}

/**
 * The Deck's sections: a Slide carrying `data-section` opens one, which holds it and every Slide after it up to
 * the next. A Deck with no `data-section` anywhere has no sections at all; one whose first Slides are unmarked
 * puts them in `Default Section`, because PowerPoint has no notion of a Slide outside every section.
 */
export function deckSections(slides: readonly Slide[], slideIds: readonly number[]): DeckSection[] {
  if (!slides.some((slide) => slide.section !== undefined)) {
    return [];
  }
  const out: DeckSection[] = [];
  for (const [index, slide] of slides.entries()) {
    if (slide.section !== undefined || out.length === 0) {
      out.push({ name: slide.section ?? DEFAULT_SECTION, slideIds: [] });
    }
    out[out.length - 1]!.slideIds.push(slideIds[index]!);
  }
  return out;
}

/** `p:ext` holding the whole list, for a presentation part that has no section extension yet. */
export function sectionExtNode(sections: readonly DeckSection[]): XmlNode {
  return el('p:ext', { uri: SECTION_EXT_URI }, el('p14:sectionLst', { 'xmlns:p14': P14_NS }, sections.map(sectionNode)));
}

export function sectionNode(section: DeckSection, index: number): XmlNode {
  return el(
    'p14:section',
    { name: section.name, id: sectionId(section, index) },
    el('p14:sldIdLst', {}, section.slideIds.map((id) => el('p14:sldId', { id }))),
  );
}

/** A section's `id` is a GUID; derived from its name and place so one Deck always emits the same bytes (spec 11 "Determinism"). */
function sectionId(section: DeckSection, index: number): string {
  const hex = createHash('sha256').update(`${index}:${section.name}`).digest('hex').toUpperCase();
  // shaped as a random UUID: version 4, variant 8
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}}`;
}

/** The `p14:sldId` ids a section node lists, in order. */
export function listedSlideIds(section: XmlNode): number[] {
  const list = section.children.find((child): child is XmlNode => typeof child !== 'string' && child.name === 'p14:sldIdLst');
  const ids: number[] = [];
  for (const child of list?.children ?? []) {
    if (typeof child !== 'string' && child.name === 'p14:sldId') {
      ids.push(Number(child.attrs.id ?? 0));
    }
  }
  return ids;
}
