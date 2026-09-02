import type { Deck, Element, GroupElement, Slide } from '../model/index.js';
import { pxToEmu } from '../ooxml/emu.js';
import { CT, REL, type OpcPackage } from '../ooxml/opc.js';
import { el, serialize, type XmlNode } from '../ooxml/xml.js';
import { buildPicture, type MediaStore, type PictureEmissionContext } from './picture.js';
import { buildShape } from './shape.js';
import { buildTable } from './table.js';

export interface SlideEmissionContext {
  deck: Deck;
  slidePartById: Map<string, string>;
  media: MediaStore;
}

export function slidePartName(index: number): string {
  return `/ppt/slides/slide${index}.xml`;
}

export function emitSlide(pkg: OpcPackage, slide: Slide, ctx: SlideEmissionContext): string {
  const partName = slidePartName(slide.index);
  const addRelationship: PictureEmissionContext['addRelationship'] = (type, target, opts) => pkg.addRelationship(partName, type, target, opts);
  pkg.addRelationship(partName, REL.slideLayout, '../slideLayouts/slideLayout1.xml');

  let nextShapeId = 2;
  const nextId = (): number => nextShapeId++;
  const elementCtx: PictureEmissionContext = {
    deckLang: ctx.deck.lang,
    sourceSlidePart: partName,
    slidePartById: ctx.slidePartById,
    addRelationship,
    media: ctx.media,
  };
  const shapes = slide.elements.flatMap((element) => buildElement(element, elementCtx, nextId));

  const xml = serialize(buildSlideXml(slide, shapes));
  pkg.addPart(partName, CT.slide, xml);
  return partName;
}

export function buildElement(element: Element, ctx: PictureEmissionContext, nextId: () => number): XmlNode[] {
  switch (element.kind) {
    case 'picture':
      return buildPicture(element, ctx, nextId);
    case 'table':
      return [buildTable(element, ctx, nextId)];
    case 'group':
      return [buildGroup(element, ctx, nextId)];
    default:
      return buildShape(element, ctx, nextId);
  }
}

/** `p:grpSp`: `off/ext` place the group, `chOff/chExt` name the child coordinate space, so children keep slide coordinates. */
function buildGroup(group: GroupElement, ctx: PictureEmissionContext, nextId: () => number): XmlNode {
  const id = nextId();
  const children = group.children.flatMap((child) => buildElement(child, ctx, nextId));
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

function buildSlideXml(slide: Slide, shapes: XmlNode[]): XmlNode {
  return el(
    'p:sld',
    pptNs(),
    el('p:cSld', { name: slide.name }, el('p:spTree', {},
      el('p:nvGrpSpPr', {}, el('p:cNvPr', { id: 1, name: '' }), el('p:cNvGrpSpPr'), el('p:nvPr')),
      el('p:grpSpPr', {}, el('a:xfrm', {}, el('a:off', { x: 0, y: 0 }), el('a:ext', { cx: 0, cy: 0 }), el('a:chOff', { x: 0, y: 0 }), el('a:chExt', { cx: 0, cy: 0 }))),
      ...shapes,
    )),
    el('p:clrMapOvr', {}, el('a:masterClrMapping')),
  );
}

function pptNs(): Record<string, string> {
  return {
    'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
  };
}
