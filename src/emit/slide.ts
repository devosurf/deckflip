import type { Deck, Slide } from '../model/index.js';
import { CT, REL, type OpcPackage } from '../ooxml/opc.js';
import { el, serialize, type XmlNode } from '../ooxml/xml.js';
import { buildShape, type ShapeEmissionContext } from './shape.js';

export interface SlideEmissionContext {
  deck: Deck;
  slidePartById: Map<string, string>;
}

export function slidePartName(index: number): string {
  return `/ppt/slides/slide${index}.xml`;
}

export function emitSlide(pkg: OpcPackage, slide: Slide, ctx: SlideEmissionContext): string {
  const partName = slidePartName(slide.index);
  const addRelationship: ShapeEmissionContext['addRelationship'] = (type, target, opts) => pkg.addRelationship(partName, type, target, opts);
  pkg.addRelationship(partName, REL.slideLayout, '../slideLayouts/slideLayout1.xml');

  let nextShapeId = 2;
  const nextId = (): number => nextShapeId++;
  const shapes = slide.elements.flatMap((element) => buildShape(element, {
    deckLang: ctx.deck.lang,
    sourceSlidePart: partName,
    slidePartById: ctx.slidePartById,
    addRelationship,
  }, nextId));

  const xml = serialize(buildSlideXml(slide, shapes));
  pkg.addPart(partName, CT.slide, xml);
  return partName;
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
