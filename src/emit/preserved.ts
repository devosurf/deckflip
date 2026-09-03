// A Deck emitted over its preserved source (docs/spec/06-round-trip.md, ADR 0004): the deck skeleton
// (root relationships, docProps, masters, layouts, themes, notes master, everything the presentation
// reaches) is copied byte for byte; untouched slides are copied with their relationships and everything
// they reach; touched slides are rebuilt with their untouched shapes spliced in verbatim; the presentation
// part is the source's with its slide list rewritten.

import path from 'node:path';
import type { Deck, Slide } from '../model/index.js';
import { OpcPackage, REL, type OpcReader } from '../ooxml/opc.js';
import { el, parseXml, serialize, type XmlNode } from '../ooxml/xml.js';
import type { ElementSplice, SlidePlan, SplicePlan } from '../roundtrip/plan.js';
import type { SourceIndex, SourceShape, SourceSlide } from '../roundtrip/source.js';
import { MediaStore } from './media.js';
import { emitSlide, type SlideSplice } from './slide.js';
import { raw } from '../ooxml/xml.js';

export interface PreservedSource {
  source: SourceIndex;
  plan: SplicePlan;
}

const COMMENTS_REL = /\/(comments|commentAuthors)$/;

interface SlideIdentity {
  id: number;
  rId: string;
  partName: string;
}

export async function emitPreservedPptx(deck: Deck, preserved: PreservedSource, created: Date): Promise<Buffer> {
  const { source, plan } = preserved;
  const reader = source.reader;
  const pkg = new OpcPackage();
  const slideParts = new Set(source.slides.map((slide) => slide.partName));
  const copied = new Set<string>();

  const copyRelationships = async (part: string): Promise<void> => {
    const rels = relsName(part);
    if (!reader.hasPart(rels)) return;
    pkg.setRawRelationships(part, await reader.bytes(rels));
    for (const rel of await reader.relationships(part)) {
      if (!rel.external && !slideParts.has(rel.target)) await copy(rel.target);
    }
  };
  /** a part, its relationships and everything they reach; slide parts only when named directly (the plan decides them) */
  const copy = async (part: string): Promise<void> => {
    if (copied.has(part) || !reader.hasPart(part)) return;
    copied.add(part);
    pkg.addPart(part, source.contentType(part) ?? 'application/octet-stream', await reader.bytes(part));
    await copyRelationships(part);
  };

  // package root: docProps, thumbnail, custom XML; the presentation is rewritten below
  pkg.setRawRelationships('/', await reader.bytes('/_rels/.rels'));
  for (const rel of await reader.relationships('/')) {
    if (!rel.external && rel.target !== source.presentation.partName) await copy(rel.target);
  }

  const identities = assignSlideIdentities(plan, source, reader);
  await emitPresentation(pkg, source, plan, identities, copy);

  const slidePartById = new Map(deck.slides.map((slide, index) => [slide.id, identities.get(plan.slides[index]!)!.partName] as const));
  const media = new MediaStore(pkg);
  for (const [index, slide] of deck.slides.entries()) {
    const slidePlan = plan.slides[index]!;
    const identity = identities.get(slidePlan)!;
    if (slidePlan.untouched && slidePlan.source) {
      await copy(slidePlan.source.partName);
      continue;
    }
    const splice = await prepareSplice(pkg, slide, slidePlan, identity, source, copy);
    emitSlide(pkg, slide, { deck, slidePartById, media }, splice);
  }

  return pkg.toBuffer({ date: created, compression: 'DEFLATE' });
}

function relsName(part: string): string {
  return part === '/' ? '/_rels/.rels' : `${path.posix.dirname(part)}/_rels/${path.posix.basename(part)}.rels`;
}

/** Kept slides keep their `p:sldId`, relationship id and part name; new ones get the next of each. */
function assignSlideIdentities(plan: SplicePlan, source: SourceIndex, reader: OpcReader): Map<SlidePlan, SlideIdentity> {
  let nextId = source.slides.reduce((max, slide) => Math.max(max, slide.sldId.id), 255) + 1;
  let nextRel = source.presentation.rels.reduce((max, rel) => Math.max(max, Number(/^rId(\d+)$/.exec(rel.id)?.[1] ?? 0)), 0) + 1;
  let nextNumber = reader.partNames().reduce((max, part) => Math.max(max, Number(/^\/ppt\/slides\/slide(\d+)\.xml$/.exec(part)?.[1] ?? 0)), 0) + 1;
  const identities = new Map<SlidePlan, SlideIdentity>();
  for (const slide of plan.slides) {
    if (slide.source) {
      identities.set(slide, { id: slide.source.sldId.id, rId: slide.source.sldId.rId, partName: slide.source.partName });
    } else {
      identities.set(slide, { id: nextId++, rId: `rId${nextRel++}`, partName: `/ppt/slides/slide${nextNumber++}.xml` });
    }
  }
  return identities;
}

/** The source presentation part with `p:sldIdLst` (and a `p14:sectionLst`) following the Deck's slides; every other relationship kept under its id. */
async function emitPresentation(pkg: OpcPackage, source: SourceIndex, plan: SplicePlan, identities: Map<SlidePlan, SlideIdentity>, copy: (part: string) => Promise<void>): Promise<void> {
  const part = source.presentation.partName;
  const ordered = plan.slides.map((slide) => identities.get(slide)!);
  const tree = parseXml(source.presentation.xml);
  const list = find(tree, 'p:sldIdLst');
  if (list) list.children = ordered.map((identity) => el('p:sldId', { id: identity.id, 'r:id': identity.rId }));
  rewriteSections(tree, plan, ordered);
  pkg.addPart(part, source.contentType(part) ?? 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', serialize(tree));

  const kept = new Set(ordered.filter((identity, index) => plan.slides[index]!.source).map((identity) => identity.partName));
  const dir = path.posix.dirname(part);
  for (const rel of source.presentation.rels) {
    const isSlide = rel.type === REL.slide;
    if (isSlide && !kept.has(rel.target)) continue;
    const target = rel.external ? rel.target : path.posix.relative(dir, rel.target);
    pkg.addRelationship(part, rel.type, target, { external: rel.external, id: rel.id });
    if (!rel.external && !isSlide) await copy(rel.target);
  }
  for (const [index, identity] of ordered.entries()) {
    if (plan.slides[index]!.source) continue;
    pkg.addRelationship(part, REL.slide, path.posix.relative(dir, identity.partName), { id: identity.rId });
  }
}

/** Removed slides leave their sections; a new slide joins the section of the slide before it. */
function rewriteSections(tree: XmlNode, plan: SplicePlan, ordered: SlideIdentity[]): void {
  const sections = findAll(tree, 'p14:section');
  if (sections.length === 0) return;
  const lists = sections.map((section) => find(section, 'p14:sldIdLst') ?? section);
  const survivors = new Set(ordered.filter((_, index) => plan.slides[index]!.source).map((identity) => String(identity.id)));
  for (const list of lists) {
    list.children = list.children.filter((child) => typeof child === 'string' || child.name !== 'p14:sldId' || survivors.has(child.attrs.id ?? ''));
  }
  const sectionOf = (id: string): XmlNode | undefined => lists.find((list) => list.children.some((child) => typeof child !== 'string' && child.attrs.id === id));
  let current = lists[0]!;
  for (const [index, identity] of ordered.entries()) {
    if (plan.slides[index]!.source) {
      current = sectionOf(String(identity.id)) ?? current;
      continue;
    }
    const previous = current.children.findIndex((child) => typeof child !== 'string' && child.attrs.id === String(ordered[index - 1]?.id));
    current.children.splice(previous === -1 ? current.children.length : previous + 1, 0, el('p14:sldId', { id: identity.id }));
  }
}

function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (child.name === name) return child;
    const nested = find(child, name);
    if (nested) return nested;
  }
  return undefined;
}

function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    if (child.name === name) out.push(child);
    findAll(child, name, out);
  }
  return out;
}

const DEFAULT_CLR_MAP = '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>';

/** Everything a rebuilt slide takes from the source, with the parts its fragments reach already copied. */
async function prepareSplice(pkg: OpcPackage, slide: Slide, plan: SlidePlan, identity: SlideIdentity, source: SourceIndex, copy: (part: string) => Promise<void>): Promise<SlideSplice> {
  const partName = identity.partName;
  const dir = path.posix.dirname(partName);
  const layoutPart = source.layouts.get(slide.layout) ?? plan.source?.layout ?? source.layouts.get('Blank') ?? [...source.layouts.values()][0];
  if (layoutPart === undefined) throw new Error('The preserved source has no slide layout');
  await copy(layoutPart);

  // relationships the fragments carry, registered once per source relationship on this slide
  const registered = new Map<string, string>();
  const remap = (fragment: SourceShape, from: SourceSlide): XmlNode => {
    const mapping = new Map<string, string>();
    for (const rId of fragment.rIds) {
      const rel = from.rels.find((candidate) => candidate.id === rId);
      if (!rel) continue;
      const key = `${from.partName}\u0000${rId}`;
      let id = registered.get(key);
      if (id === undefined) {
        id = pkg.addRelationship(partName, rel.type, rel.external ? rel.target : path.posix.relative(dir, rel.target), { external: rel.external });
        registered.set(key, id);
      }
      mapping.set(rId, id);
    }
    return raw(fragment.xml.replace(/(\sr:[A-Za-z]+=")(rId\d+)(")/g, (_match, before: string, id: string, after: string) => `${before}${mapping.get(id) ?? id}${after}`));
  };
  const splices: ElementSplice[] = [...(plan.leading ? [plan.leading] : []), ...plan.splices.values()];
  for (const splice of splices) {
    for (const fragment of splice.fragments) {
      for (const part of fragment.partRefs) await copy(part);
    }
  }

  const reservedIds = new Set<number>(plan.source ? plan.source.shapes.keys() : []);
  for (const splice of splices) {
    for (const fragment of splice.fragments) fragment.ids.forEach((id) => reservedIds.add(id));
  }
  for (const ids of plan.keepIds.values()) ids.forEach((id) => reservedIds.add(id));

  const before: string[] = [];
  const after: string[] = [];
  const tail: string[] = [];
  const pieces = plan.source?.pieces ?? new Map<string, string>();
  for (const [key, xml] of pieces) {
    if (key.startsWith('p:cSld/')) {
      if (!plan.shellUntouched) continue;
      (key === 'p:cSld/p:bg' ? before : after).push(xml);
    } else if (key === 'p:clrMapOvr') {
      tail.push(plan.shellUntouched ? xml : DEFAULT_CLR_MAP);
    } else if (key === 'p:timing') {
      if (plan.keepTiming) tail.push(xml);
    } else if (key === 'p:transition' || key === 'mc:AlternateContent' || plan.shellUntouched) {
      tail.push(xml);
    }
  }
  if (!pieces.has('p:clrMapOvr')) tail.unshift(DEFAULT_CLR_MAP);

  const extraRelationships: SlideSplice['extraRelationships'] = [];
  if (plan.shellUntouched && plan.source) {
    for (const rel of plan.source.rels) {
      if (rel.type !== REL.notesSlide && !COMMENTS_REL.test(rel.type)) continue;
      await copy(rel.target);
      extraRelationships.push({ type: rel.type, target: path.posix.relative(dir, rel.target), external: false });
    }
  }

  return {
    partName,
    layoutTarget: path.posix.relative(dir, layoutPart),
    rootAttrs: plan.source?.rootAttrs ?? {},
    reservedIds,
    leading: plan.leading ? plan.leading.fragments.map((fragment) => remap(fragment, plan.leading!.source)) : [],
    fragments: (element) => {
      const splice = plan.splices.get(element);
      return splice ? splice.fragments.map((fragment) => remap(fragment, splice.source)) : undefined;
    },
    keepIds: (element) => plan.keepIds.get(element) ?? [],
    before,
    after,
    tail,
    extraRelationships,
  };
}
