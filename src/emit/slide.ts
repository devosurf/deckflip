import type { Deck, Element, GroupElement, Slide } from '../model/index.js';
import { pxToEmu } from '../ooxml/emu.js';
import { CT, REL, type OpcPackage } from '../ooxml/opc.js';
import { el, raw, serialize, type XmlNode } from '../ooxml/xml.js';
import type { MediaStore } from './media.js';
import { buildPicture } from './picture.js';
import { buildShape, type ShapeEmissionContext } from './shape.js';
import { buildTable } from './table.js';

export interface SlideEmissionContext {
  deck: Deck;
  slidePartById: Map<string, string>;
  media: MediaStore;
}

/**
 * What a slide rebuilt over a preserved source keeps (docs/spec/06-round-trip.md): its part name and root
 * attributes, the layout it instantiates, verbatim fragments for untouched elements, the `p:cNvPr` ids of
 * touched ones, and the slide-level pieces around the shape tree.
 */
export interface SlideSplice {
  partName: string;
  /** relative target of the layout relationship */
  layoutTarget: string;
  rootAttrs: Record<string, string>;
  /** ids already taken on this slide: fresh ones start above */
  reservedIds: Iterable<number>;
  /** fragments spliced before every element (the section's own background) */
  leading: XmlNode[];
  /** verbatim replacement for an element, once its relationships are registered; undefined -> build from the IDM */
  fragments(element: Element): XmlNode[] | undefined;
  keepIds(element: Element): number[];
  /** `p:cSld` children before the shape tree (`p:bg`) and after it, and `p:sld` children after `p:cSld`, verbatim */
  before: string[];
  after: string[];
  tail: string[];
  /** relationships copied from the source slide (notes, comments) */
  extraRelationships: Array<{ type: string; target: string; external: boolean }>;
}

export function slidePartName(index: number): string {
  return `/ppt/slides/slide${index}.xml`;
}

export function emitSlide(pkg: OpcPackage, slide: Slide, ctx: SlideEmissionContext, splice?: SlideSplice): string {
  const partName = splice?.partName ?? slidePartName(slide.index);
  const addRelationship: ShapeEmissionContext['addRelationship'] = (type, target, opts) => pkg.addRelationship(partName, type, target, opts);
  pkg.addRelationship(partName, REL.slideLayout, splice?.layoutTarget ?? '../slideLayouts/slideLayout1.xml');
  for (const rel of splice?.extraRelationships ?? []) {
    pkg.addRelationship(partName, rel.type, rel.target, { external: rel.external });
  }

  let nextShapeId = 2;
  for (const id of splice?.reservedIds ?? []) nextShapeId = Math.max(nextShapeId, id + 1);
  const nextFresh = (): number => nextShapeId++;
  const elementCtx: ShapeEmissionContext = {
    deckLang: ctx.deck.lang,
    sourceSlidePart: partName,
    slidePartById: ctx.slidePartById,
    addRelationship,
    media: ctx.media,
    ...(splice === undefined ? {} : { splice: { fragments: (element) => splice.fragments(element), keepIds: (element) => splice.keepIds(element) } }),
  };
  const shapes = [...(splice?.leading ?? []), ...slide.elements.flatMap((element) => buildElement(element, elementCtx, nextFresh))];

  const xml = serialize(buildSlideXml(slide, shapes, splice));
  pkg.addPart(partName, CT.slide, xml);
  return partName;
}

/**
 * An untouched element is its source fragments; a touched one is built, its first ids being the ones it had.
 * An opaque element only exists through the splice (its source fragments, geometry rewritten when moved).
 */
export function buildElement(element: Element, ctx: ShapeEmissionContext, nextFresh: () => number): XmlNode[] {
  const spliced = ctx.splice?.fragments(element);
  if (spliced) return spliced;
  const kept = ctx.splice?.keepIds(element) ?? [];
  let handed = 0;
  const nextId = (): number => (handed < kept.length ? kept[handed++]! : nextFresh());
  switch (element.kind) {
    case 'picture':
      return buildPicture(element, ctx, nextId);
    case 'table':
      return [buildTable(element, ctx, nextId)];
    case 'group':
      return [buildGroup(element, ctx, nextId, nextFresh)];
    case 'opaque':
      return [];
    default:
      return buildShape(element, ctx, nextId);
  }
}

/** `p:grpSp`: `off/ext` place the group, `chOff/chExt` name the child coordinate space, so children keep slide coordinates. */
function buildGroup(group: GroupElement, ctx: ShapeEmissionContext, nextId: () => number, nextFresh: () => number): XmlNode {
  const id = nextId();
  const children = group.children.flatMap((child) => buildElement(child, ctx, nextFresh));
  return el(
    'p:grpSp',
    {},
    el('p:nvGrpSpPr', {}, el('p:cNvPr', { id, name: group.name }), el('p:cNvGrpSpPr'), el('p:nvPr')),
    el(
      'p:grpSpPr',
      {},
      el(
        'a:xfrm',
        { rot: Math.round(group.rotation * 60000) },
        el('a:off', { x: pxToEmu(group.box.x), y: pxToEmu(group.box.y) }),
        el('a:ext', { cx: pxToEmu(group.box.w), cy: pxToEmu(group.box.h) }),
        el('a:chOff', { x: pxToEmu(group.childBox.x), y: pxToEmu(group.childBox.y) }),
        el('a:chExt', { cx: pxToEmu(group.childBox.w), cy: pxToEmu(group.childBox.h) }),
      ),
    ),
    ...children,
  );
}

function buildSlideXml(slide: Slide, shapes: XmlNode[], splice?: SlideSplice): XmlNode {
  const spTree = el('p:spTree', {},
    el('p:nvGrpSpPr', {}, el('p:cNvPr', { id: 1, name: '' }), el('p:cNvGrpSpPr'), el('p:nvPr')),
    el('p:grpSpPr', {}, el('a:xfrm', {}, el('a:off', { x: 0, y: 0 }), el('a:ext', { cx: 0, cy: 0 }), el('a:chOff', { x: 0, y: 0 }), el('a:chExt', { cx: 0, cy: 0 }))),
    ...shapes,
  );
  if (!splice) {
    return el('p:sld', pptNs(), el('p:cSld', { name: slide.name }, spTree), el('p:clrMapOvr', {}, el('a:masterClrMapping')));
  }
  return el(
    'p:sld',
    { ...pptNs(), ...splice.rootAttrs },
    el('p:cSld', { name: slide.name }, ...splice.before.map(raw), spTree, ...splice.after.map(raw)),
    ...splice.tail.map(raw),
  );
}

function pptNs(): Record<string, string> {
  return {
    'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
  };
}
