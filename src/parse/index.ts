// PPTX -> IDM (docs/spec/11-architecture.md `parse/`): the inverse of emit/, reading only what the IDM models.
// Nothing here knows about the DOM; everything the IDM cannot hold is left for the opaque records of spec 06.

import type { Deck, Media, Slide, TextBody } from '../model/index.js';
import { REL, OpcReader, type Relationship } from '../ooxml/opc.js';
import type { XmlNode } from '../ooxml/xml.js';
import { readColorScheme, readFontScheme } from './drawing.js';
import { inheritanceReader } from './inherit.js';
import { readNotes } from './notes.js';
import { readSlide } from './slide.js';
import type { TextContext } from './text.js';
import { px } from './units.js';
import { child, children, textOf } from './xml.js';

const DEFAULT_LANG = 'en';

export async function parsePptx(bytes: Uint8Array): Promise<Deck> {
  const pkg = await OpcReader.load(bytes);
  const presentationRel = await pkg.related('/', REL.officeDocument);
  if (!presentationRel) {
    throw new Error('Not a PresentationML package: no officeDocument relationship');
  }
  const presentationPart = presentationRel.target;
  const presentation = await pkg.xml(presentationPart);
  const core = await coreProperties(pkg);

  const size = child(presentation, 'p:sldSz');
  const canvas: Deck['canvas'] = {
    width: px(size?.attrs.cx),
    height: px(size?.attrs.cy),
    source: 'deck-meta',
  };

  const presentationRels = await pkg.relationships(presentationPart);
  const themeRel = presentationRels.find((rel) => rel.type === REL.theme);
  const theme = themeRel && pkg.hasPart(themeRel.target) ? await pkg.xml(themeRel.target) : undefined;
  const colors = readColorScheme(theme);
  const fonts = readFontScheme(theme);

  const slideParts: string[] = [];
  const sldIds: string[] = [];
  for (const sldId of children(child(presentation, 'p:sldIdLst'), 'p:sldId')) {
    const rel = presentationRels.find((candidate) => candidate.id === sldId.attrs['r:id']);
    if (rel) {
      slideParts.push(rel.target);
      sldIds.push(sldId.attrs.id ?? '');
    }
  }
  const slideIdByPart = new Map(slideParts.map((part, index) => [part, `slide-${index + 1}`] as const));
  const sections = readSections(presentation, sldIds);

  const partTrees = new Map<string, Promise<XmlNode>>();
  /** Layouts and masters are read again for every Slide that names them; the memo lives here, so `OpcReader` stays a plain reader for `roundtrip/` and `emit/preserved.ts`. */
  const readPart = async (part: string | undefined): Promise<XmlNode | undefined> => {
    if (part === undefined || !pkg.hasPart(part)) {
      return undefined;
    }
    let tree = partTrees.get(part);
    if (tree === undefined) {
      tree = pkg.xml(part);
      partTrees.set(part, tree);
    }
    return tree;
  };
  const inherited = inheritanceReader(pkg, presentation, readPart);
  /** the name the layout part carries, which is what `data-layout` names and a new Slide instantiates */
  const layoutName = async (part: string | undefined): Promise<string> => child(await readPart(part), 'p:cSld')?.attrs.name?.trim() || 'Blank';

  const slides: Slide[] = [];
  for (const [position, part] of slideParts.entries()) {
    const rels = await pkg.relationships(part);
    const slide = await readSlide(await pkg.xml(part), position + 1, {
      slide: position + 1,
      layout: await layoutName(rels.find((rel) => rel.type === REL.slideLayout && !rel.external)?.target),
      inherited: await inherited(rels),
      colors,
      fonts,
      media: (rId) => loadMedia(pkg, rels, rId),
      link: (rId) => resolveLink(rels, rId, slideIdByPart),
      partOf: (rId) => {
        const rel = rels.find((candidate) => candidate.id === rId);
        return rel && !rel.external ? rel.target : undefined;
      },
    });
    const section = sections.get(position);
    if (section !== undefined) {
      slide.section = section;
    }
    const notes = await readSlideNotes(pkg, rels, { colors, fonts }, slideIdByPart);
    if (notes) {
      slide.notes = notes;
    }
    slides.push(slide);
  }

  return {
    title: core.title,
    lang: core.lang,
    canvas,
    slides,
    fontFaces: [],
  };
}

/**
 * `p14:sectionLst` (spec 06 "Sections") by the position of the first Slide each section holds, which is where
 * `data-section` goes; `sldIds` are the `p:sldId/@id`s in presentation order.
 */
function readSections(presentation: XmlNode, sldIds: string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const section of findAll(presentation, 'p14:section')) {
    const name = section.attrs.name;
    if (!name) {
      continue;
    }
    const held = new Set(children(child(section, 'p14:sldIdLst'), 'p14:sldId').map((node) => node.attrs.id ?? ''));
    const first = sldIds.findIndex((id) => held.has(id));
    if (first !== -1 && !out.has(first)) {
      out.set(first, name);
    }
  }
  return out;
}

function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const child of children(node)) {
    if (child.name === name) {
      out.push(child);
    } else {
      findAll(child, name, out);
    }
  }
  return out;
}

/** The notes slide the slide relates to, as the text of its body placeholder; its own rels resolve links in it. */
async function readSlideNotes(pkg: OpcReader, rels: Relationship[], text: Omit<TextContext, 'link'>, slideIdByPart: Map<string, string>): Promise<TextBody | undefined> {
  const rel = rels.find((candidate) => candidate.type === REL.notesSlide && !candidate.external);
  if (!rel || !pkg.hasPart(rel.target)) {
    return undefined;
  }
  const notesRels = await pkg.relationships(rel.target);
  return readNotes(await pkg.xml(rel.target), { ...text, link: (rId) => resolveLink(notesRels, rId, slideIdByPart) });
}

/** `dc:title` and `dc:language`; the core-properties relationship is matched by its type suffix since some writers put it in the officeDocument namespace. */
async function coreProperties(pkg: OpcReader): Promise<{ title: string; lang: string }> {
  const rel = (await pkg.relationships('/')).find((candidate) => candidate.type.endsWith('/metadata/core-properties'));
  if (!rel || !pkg.hasPart(rel.target)) {
    return { title: '', lang: DEFAULT_LANG };
  }
  const core = await pkg.xml(rel.target);
  return {
    title: textOf(child(core, 'dc:title')),
    lang: textOf(child(core, 'dc:language')) || DEFAULT_LANG,
  };
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, Media['contentType']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/** The bytes of an image relationship; undefined for unknown ids, external targets and formats the IDM does not carry. */
async function loadMedia(pkg: OpcReader, rels: Relationship[], rId: string): Promise<{ media: Media; raster: boolean } | undefined> {
  const rel = rels.find((candidate) => candidate.id === rId);
  if (!rel || rel.external || !pkg.hasPart(rel.target)) {
    return undefined;
  }
  const contentType = CONTENT_TYPE_BY_EXTENSION[rel.target.slice(rel.target.lastIndexOf('.') + 1).toLowerCase()];
  if (!contentType) {
    return undefined;
  }
  return { media: { data: await pkg.bytes(rel.target), contentType }, raster: rel.target.slice(rel.target.lastIndexOf('/') + 1).startsWith('raster-') };
}

/** An external hyperlink target, or `#<slide id>` for a slide relationship (`ppaction://hlinksldjump`). */
function resolveLink(rels: Relationship[], rId: string, slideIdByPart: Map<string, string>): string | undefined {
  const rel = rels.find((candidate) => candidate.id === rId);
  if (!rel) {
    return undefined;
  }
  if (rel.external) {
    return rel.target;
  }
  const slideId = slideIdByPart.get(rel.target);
  return slideId === undefined ? undefined : `#${slideId}`;
}
