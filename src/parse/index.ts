// PPTX -> IDM (docs/spec/11-architecture.md `parse/`): the inverse of emit/, reading only what the IDM models.
// Nothing here knows about the DOM; everything the IDM cannot hold is left for the opaque records of spec 06.

import type { Deck, Media, Slide } from '../model/index.js';
import { REL, OpcReader, type Relationship } from '../ooxml/opc.js';
import { readColorScheme } from './drawing.js';
import { readSlide } from './slide.js';
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
  const colors = readColorScheme(themeRel && pkg.hasPart(themeRel.target) ? await pkg.xml(themeRel.target) : undefined);

  const slideParts: string[] = [];
  for (const sldId of children(child(presentation, 'p:sldIdLst'), 'p:sldId')) {
    const rel = presentationRels.find((candidate) => candidate.id === sldId.attrs['r:id']);
    if (rel) {
      slideParts.push(rel.target);
    }
  }
  const slideIdByPart = new Map(slideParts.map((part, index) => [part, `slide-${index + 1}`] as const));

  const slides: Slide[] = [];
  for (const [position, part] of slideParts.entries()) {
    const rels = await pkg.relationships(part);
    slides.push(await readSlide(await pkg.xml(part), position + 1, {
      slide: position + 1,
      colors,
      media: (rId) => loadMedia(pkg, rels, rId),
      link: (rId) => resolveLink(rels, rId, slideIdByPart),
    }));
  }

  return {
    title: core.title,
    lang: core.lang,
    canvas,
    slides,
    fontFaces: [],
  };
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
