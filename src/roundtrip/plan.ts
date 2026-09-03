// What the way back re-emits from the source and what it rebuilds from HTML (docs/spec/06-round-trip.md
// "Detecting untouched"): the manifest's fingerprints against the sections the measurer saw. The plan is
// keyed by the measured Deck's own elements, so the emitter can consult it while it walks them.

import type { Box, Deck, Element, Slide } from '../model/index.js';
import { entry as reportEntry } from '../report/codes.js';
import type { Entry } from '../report/types.js';
import { animationEntry, commentsEntry, deckEntries, hasComments, hasTiming, opaqueEntry, textEffectsEntry } from './entries.js';
import type { HtmlNode } from './fingerprint.js';
import { observeSection, type Manifest, type ManifestShape, type ManifestSlide, type ObservedSection } from './manifest.js';
import type { SourceIndex, SourceShape, SourceSlide } from './source.js';

export interface ElementSplice {
  /** the slide part the fragments are read from (their relationship ids resolve against it) */
  source: SourceSlide;
  /** verbatim fragments standing in for the element, in z-order; empty when an earlier element already stands for it */
  fragments: SourceShape[];
  /** an opaque element moved, resized or rotated: the fragments' first transform is rewritten to this */
  geometry?: { box: Box; rotation: number };
}

export interface SlidePlan {
  /** the section id */
  id: string;
  /** the source slide the section came from, when the manifest knows it */
  source?: SourceSlide;
  /** the whole part is copied byte for byte */
  untouched: boolean;
  /** attributes and notes unchanged: `p:bg`, colour map, transition, extensions and notes are kept */
  shellUntouched: boolean;
  /** the section's own shapes (its background), spliced before everything else */
  leading?: ElementSplice;
  /** elements re-emitted verbatim; the rest is built from the IDM */
  splices: Map<Element, ElementSplice>;
  /** `p:cNvPr` ids an element built from the IDM keeps, in the order it allocates them */
  keepIds: Map<Element, number[]>;
  /** `p:timing` still targets shapes that exist */
  keepTiming: boolean;
}

export interface SplicePlan {
  /** every Slide untouched, in the source order, none added or removed: the source package is the output */
  identical: boolean;
  slides: SlidePlan[];
  entries: Entry[];
}

interface Known {
  slide: ManifestSlide;
  shape: ManifestShape;
  source: SourceSlide;
}

export function planSplice(deck: Deck, sections: HtmlNode[], manifest: Manifest, source: SourceIndex): SplicePlan {
  const sourceByPart = new Map(source.slides.map((slide) => [slide.partName, slide] as const));
  const manifestById = new Map(manifest.slides.map((slide) => [slide.id, slide] as const));
  const known = new Map<string, Known>();
  for (const slide of manifest.slides) {
    const sourceSlide = sourceByPart.get(slide.partName);
    if (!sourceSlide) continue;
    for (const shape of slide.shapes) {
      if (!known.has(shape.shapeId)) known.set(shape.shapeId, { slide, shape, source: sourceSlide });
    }
  }

  const entries: Entry[] = [];
  const taken = new Set<ManifestSlide>();
  const slides = deck.slides.map((slide, index) => {
    const section = sections[index];
    const observed = section ? observeSection(section) : undefined;
    // a section id claimed twice: the second is a new Slide (two parts cannot share a name)
    const manifestSlide = manifestById.get(slide.id);
    const claimable = manifestSlide !== undefined && !taken.has(manifestSlide) ? manifestSlide : undefined;
    if (claimable) taken.add(claimable);
    return planSlide(slide, observed, claimable, sourceByPart, known, entries);
  });
  entries.push(...deckEntries(source));

  const sameOrder = slides.length === manifest.slides.length && slides.every((slide, index) => slide.id === manifest.slides[index]!.id);
  return { identical: sameOrder && slides.every((slide) => slide.untouched), slides, entries };
}

function planSlide(
  slide: Slide,
  observed: ObservedSection | undefined,
  manifestSlide: ManifestSlide | undefined,
  sourceByPart: Map<string, SourceSlide>,
  known: Map<string, Known>,
  entries: Entry[],
): SlidePlan {
  const source = manifestSlide ? sourceByPart.get(manifestSlide.partName) : undefined;
  const observedFingerprints = new Map(observed?.shapes.map((shape) => [shape.shapeId, shape.fingerprint] as const) ?? []);
  const duplicates = new Set(observed?.duplicates ?? []);

  const shellUntouched = manifestSlide !== undefined && source !== undefined && observed !== undefined && observed.fingerprint === manifestSlide.fingerprint;
  const topLevel = manifestSlide?.shapes.filter((shape) => shape.nested === undefined) ?? [];
  const sameChildren =
    observed !== undefined &&
    observed.children.length === topLevel.length &&
    observed.children.every((child, index) => child.shapeId !== undefined && child.shapeId === topLevel[index]!.shapeId && observedFingerprints.get(child.shapeId) === topLevel[index]!.fingerprint);
  const untouched = shellUntouched && sameChildren;

  const splices = new Map<Element, ElementSplice>();
  const keepIds = new Map<Element, number[]>();
  const claimed = new Map<string, number>();
  const reported = new Set<string>();
  const survivingIds = new Set<number>();
  const report = (shapeId: string, reason: string): void => {
    if (reported.has(shapeId)) return;
    reported.add(shapeId);
    entries.push(reportEntry('PRESERVE_UNKNOWN_ID', { slide: slide.index, locator: { selector: `[data-shape-id="${shapeId}"]` }, reason }));
  };

  const visit = (element: Element): void => {
    const shapeId = element.shapeId;
    if (shapeId !== undefined) {
      const hit = known.get(shapeId);
      if (duplicates.has(shapeId)) report(shapeId, `data-shape-id="${shapeId}" appears more than once`);
      else if (!hit) report(shapeId, `data-shape-id="${shapeId}" is not in the manifest`);
      else {
        const claim = claimed.get(shapeId) ?? 0;
        claimed.set(shapeId, claim + 1);
        const fragments = hit.shape.spids.map((spid) => hit.source.shapes.get(spid)).filter((shape): shape is SourceShape => shape !== undefined);
        const complete = fragments.length === hit.shape.spids.length;
        if (observedFingerprints.get(shapeId) === hit.shape.fingerprint && complete) {
          splices.set(element, { source: hit.source, fragments: claim === 0 ? fragments : [] });
          if (claim === 0 && hit.source === source) for (const spid of hit.shape.spids) survivingIds.add(spid);
          if (element.kind === 'opaque') entries.push(opaqueEntry(element, slide.index, 'html'));
          else if (element.kind === 'shape' && element.preserve === 'text-effects') entries.push(textEffectsEntry(element, slide.index, 'html'));
          return;
        }
        if (element.kind === 'opaque') {
          // only its geometry is editable: the source fragments follow the box the author gave them
          if (claim === 0 && complete) {
            splices.set(element, { source: hit.source, fragments, geometry: { box: element.box, rotation: element.rotation } });
            if (hit.source === source) for (const spid of hit.shape.spids) survivingIds.add(spid);
            entries.push(opaqueEntry(element, slide.index, 'html'));
          }
          return;
        }
        const own = hit.shape.spids[claim];
        if (own !== undefined && hit.source === source) {
          keepIds.set(element, [own]);
          survivingIds.add(own);
        }
        if (element.kind === 'shape' && element.preserve === 'text-effects') {
          entries.push(reportEntry('DROPPED_TEXT_EFFECTS', { slide: slide.index, locator: { selector: element.selector }, reason: `${element.name} was edited; its text effects cannot be re-emitted from HTML` }));
        }
        if (fragments.some((fragment) => /<(?:p|a):extLst\b/.test(fragment.xml))) {
          entries.push(reportEntry('DROPPED_EXTENSION', { slide: slide.index, locator: { selector: element.selector }, reason: `${element.name} was edited; the extensions on its source shape are not carried` }));
        }
      }
    }
    if (element.kind === 'group') element.children.forEach(visit);
  };
  slide.elements.forEach(visit);

  const leading = shellUntouched && manifestSlide.spids.length > 0 ? { source, fragments: manifestSlide.spids.map((spid) => source.shapes.get(spid)).filter((shape): shape is SourceShape => shape !== undefined) } : undefined;
  if (leading) {
    for (const spid of manifestSlide!.spids) survivingIds.add(spid);
    const background = slide.elements[0];
    if (background && isSectionBackground(background) && !splices.has(background)) splices.set(background, { source: source!, fragments: [] });
  }

  const timing = source?.pieces.get('p:timing');
  const keepTiming = timing !== undefined && (untouched || [...timing.matchAll(/\bspid="(\d+)"/g)].every((match) => survivingIds.has(Number(match[1]))));
  if (source && hasTiming(source)) {
    entries.push(keepTiming ? animationEntry(slide, 'html') : reportEntry('DROPPED_ANIMATION', { slide: slide.index, locator: { selector: `#${slide.id}` }, reason: 'the animation targets a shape that no longer exists' }));
  }
  if (source && hasComments(source) && (untouched || shellUntouched)) {
    entries.push(commentsEntry(slide, 'html'));
  }

  return { id: slide.id, ...(source === undefined ? {} : { source }), untouched, shellUntouched, ...(leading === undefined ? {} : { leading }), splices, keepIds, keepTiming };
}

/** The shape the measurer pushes for a painting section (html/browser-script.ts): text-free, named after the section, at the origin. */
function isSectionBackground(element: Element): boolean {
  return element.kind === 'shape' && !element.text && element.box.x === 0 && element.box.y === 0 && /^section(?:[#.]|$)/.test(element.name);
}
