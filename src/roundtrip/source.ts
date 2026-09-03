// The source package as the round trip sees it (docs/spec/06-round-trip.md, ADR 0004): every slide part in
// presentation order with its shapes as byte-exact XML fragments (what an untouched shape is re-emitted from),
// the relationship ids each fragment uses, the parts they reach, and the slide-level pieces (`p:bg`, timing,
// transition, extensions) a touched slide keeps. Nothing here interprets DrawingML; parse/ does that.

import { SaxesParser } from 'saxes';
import { OpcReader, REL, type Relationship } from '../ooxml/opc.js';
import { parseXml, type XmlNode } from '../ooxml/xml.js';

export interface SourceShape {
  /** `p:cNvPr/@id` */
  id: number;
  /** the element's exact text in the slide part */
  xml: string;
  /** every `p:cNvPr/@id` inside, the shape's own first (a group's children follow) */
  ids: number[];
  /** relationship ids referenced anywhere inside, in document order */
  rIds: string[];
  /** internal parts those relationships reach */
  partRefs: string[];
}

export interface SourceSlide {
  partName: string;
  /** `p:sldIdLst/p:sldId` */
  sldId: { id: number; rId: string };
  xml: string;
  rels: Relationship[];
  /** the layout part the slide instantiates */
  layout?: string;
  /** `p:sld` attributes (namespace declarations, `show`, ...) */
  rootAttrs: Record<string, string>;
  /** `p:cSld/@name` */
  name?: string;
  /** `p:spTree` children ids in z-order */
  topLevel: number[];
  /** every shape at any depth by id, groups included */
  shapes: Map<number, SourceShape>;
  /** slide-level elements other than the shape tree, by path (`p:cSld/p:bg`, `p:clrMapOvr`, `p:transition`, `p:timing`, `p:extLst`) */
  pieces: Map<string, string>;
}

export interface SourceIndex {
  reader: OpcReader;
  presentation: { partName: string; xml: string; rels: Relationship[] };
  slides: SourceSlide[];
  /** layout name (`p:cSld/@name`) -> layout part, first master first */
  layouts: Map<string, string>;
  contentType(partName: string): string | undefined;
}

const SHAPE_TAGS = new Set(['p:sp', 'p:pic', 'p:grpSp', 'p:graphicFrame', 'p:cxnSp', 'p:contentPart', 'mc:AlternateContent']);
const SHAPE_PARENTS = new Set(['p:spTree', 'p:grpSp']);

export async function indexSource(reader: OpcReader): Promise<SourceIndex> {
  const officeDocument = await reader.related('/', REL.officeDocument);
  if (!officeDocument) throw new Error('Package has no presentation part');
  const presentationPart = officeDocument.target;
  const presentationXml = new TextDecoder().decode(await reader.bytes(presentationPart));
  const presentationRels = await reader.relationships(presentationPart);
  const presentation = parseXml(presentationXml);

  const slides: SourceSlide[] = [];
  for (const sldId of elements(element(presentation, 'p:sldIdLst'), 'p:sldId')) {
    const rId = sldId.attrs['r:id'] ?? '';
    const rel = presentationRels.find((candidate) => candidate.id === rId);
    if (!rel) continue;
    const xml = new TextDecoder().decode(await reader.bytes(rel.target));
    const rels = await reader.relationships(rel.target);
    const layout = rels.find((candidate) => candidate.type === REL.slideLayout)?.target;
    slides.push({ partName: rel.target, sldId: { id: Number(sldId.attrs.id), rId }, xml, rels, ...(layout === undefined ? {} : { layout }), ...scanSlide(xml, rels) });
  }

  const layouts = new Map<string, string>();
  for (const master of presentationRels.filter((rel) => rel.type === REL.slideMaster)) {
    for (const layout of (await reader.relationships(master.target)).filter((rel) => rel.type === REL.slideLayout)) {
      const name = element(await reader.xml(layout.target), 'p:cSld')?.attrs.name;
      if (name !== undefined && !layouts.has(name)) layouts.set(name, layout.target);
    }
  }

  return { reader, presentation: { partName: presentationPart, xml: presentationXml, rels: presentationRels }, slides, layouts, contentType: await reader.contentTypes() };
}

function element(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((child): child is XmlNode => typeof child !== 'string' && child.name === name);
}

function elements(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((child): child is XmlNode => typeof child !== 'string' && child.name === name) ?? [];
}

interface Frame {
  name: string;
  start: number;
  /** set on frames that become a `SourceShape` */
  shape?: { id?: number; ids: number[]; rIds: string[] };
}

/** One pass over the slide text with positions: fragments are substrings, never re-serialised. */
function scanSlide(xml: string, rels: Relationship[]): Pick<SourceSlide, 'rootAttrs' | 'name' | 'topLevel' | 'shapes' | 'pieces'> {
  const parser = new SaxesParser({ xmlns: false, position: true });
  const stack: Frame[] = [];
  const shapes = new Map<number, SourceShape>();
  const topLevel: number[] = [];
  const pieces = new Map<string, string>();
  let rootAttrs: Record<string, string> = {};
  let name: string | undefined;
  let error: Error | undefined;

  const innermostShape = (): Frame | undefined => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index]!.shape) return stack[index];
    }
    return undefined;
  };

  parser.on('opentagstart', (tag) => {
    const parent = stack[stack.length - 1];
    const frame: Frame = { name: tag.name, start: xml.lastIndexOf('<', parser.position - 1) };
    if (parent && SHAPE_TAGS.has(tag.name) && SHAPE_PARENTS.has(parent.name)) frame.shape = { ids: [], rIds: [] };
    stack.push(frame);
  });
  parser.on('opentag', (tag) => {
    if (stack.length === 1) rootAttrs = { ...tag.attributes };
    if (stack.length === 2 && tag.name === 'p:cSld') name = tag.attributes.name;
    if (tag.name === 'p:cNvPr') {
      const id = Number(tag.attributes.id);
      const owner = innermostShape();
      if (owner?.shape && owner.shape.id === undefined) owner.shape.id = id;
      for (const frame of stack) {
        if (frame.shape) frame.shape.ids.push(id);
      }
    }
    for (const [attr, value] of Object.entries(tag.attributes)) {
      if (!attr.startsWith('r:')) continue;
      for (const frame of stack) {
        if (frame.shape && !frame.shape.rIds.includes(value)) frame.shape.rIds.push(value);
      }
    }
  });
  parser.on('closetag', () => {
    const frame = stack.pop()!;
    const end = parser.position;
    const depth = stack.length;
    if (frame.shape?.id !== undefined) {
      const partRefs: string[] = [];
      for (const rId of frame.shape.rIds) {
        const rel = rels.find((candidate) => candidate.id === rId);
        if (rel && !rel.external && !partRefs.includes(rel.target)) partRefs.push(rel.target);
      }
      shapes.set(frame.shape.id, { id: frame.shape.id, xml: xml.slice(frame.start, end), ids: frame.shape.ids, rIds: frame.shape.rIds, partRefs });
      if (stack[depth - 1]?.name === 'p:spTree') topLevel.push(frame.shape.id);
    } else if (depth === 1 && frame.name !== 'p:cSld') {
      pieces.set(frame.name, xml.slice(frame.start, end));
    } else if (depth === 2 && stack[1]!.name === 'p:cSld' && frame.name !== 'p:spTree') {
      pieces.set(`p:cSld/${frame.name}`, xml.slice(frame.start, end));
    }
  });
  parser.on('error', (err) => {
    error = err;
  });
  parser.write(xml).close();
  if (error) throw error;
  return { rootAttrs, ...(name === undefined ? {} : { name }), topLevel, shapes, pieces };
}
