import { createHash } from 'node:crypto';
import * as fontkit from 'fontkit';
import { parseEot } from '../fonts/eot.js';
import { faceFromFont } from '../fonts/scan.js';
import { OFFICE_FONT_STYLES, textBodiesOf, type Deck, type EmbeddedFont, type EmbeddedFontMetadata, type OfficeFontStyle } from '../model/index.js';
import { REL, type OpcReader, type Relationship } from '../ooxml/opc.js';
import type { XmlNode } from '../ooxml/xml.js';
import { child, children } from './xml.js';

const embeddedByReader = new WeakMap<OpcReader, Promise<EmbeddedFont[]>>();

/** Read slot identity from PresentationML, never infer it from the EOT's internal names. */
export function readEmbeddedFonts(pkg: OpcReader, presentation: XmlNode, rels: Relationship[]): Promise<EmbeddedFont[]> {
  let fonts = embeddedByReader.get(pkg);
  if (!fonts) {
    fonts = readSlots(pkg, presentation, rels);
    embeddedByReader.set(pkg, fonts);
  }
  return fonts;
}

async function readSlots(pkg: OpcReader, presentation: XmlNode, rels: Relationship[]): Promise<EmbeddedFont[]> {
  const fonts: EmbeddedFont[] = [];
  const payloads = new Map<string, EmbeddedFont>();
  for (const node of children(child(presentation, 'p:embeddedFontLst'), 'p:embeddedFont')) {
    const family = child(node, 'p:font')?.attrs.typeface ?? '';
    for (const slot of OFFICE_FONT_STYLES) {
      const relationshipId = child(node, `p:${slot}`)?.attrs['r:id'];
      if (relationshipId === undefined) continue;
      const rel = rels.find((candidate) => candidate.id === relationshipId && candidate.type === REL.font && !candidate.external);
      const part = rel?.target ?? '';
      const cached = payloads.get(part);
      if (cached) {
        fonts.push({
          ...cached, family, slot, relationshipId,
          ...(cached.resolved ? { resolved: { ...cached.resolved, cssFamily: family, office: { family, style: slot } } } : {}),
        });
        continue;
      }
      const data = rel && pkg.hasPart(part) ? await pkg.bytes(part) : undefined;
      const bytes = data ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : undefined;
      const font: EmbeddedFont = {
        family, slot, part, relationshipId,
        // The wrapper is preserved, but only a decoded sfnt can have an asset digest.
        embedding: { status: 'preserved', part },
      };
      try {
        if (!bytes) throw new Error('Embedded font relationship or payload is missing');
        const header = parseEot(bytes);
        font.version = header.version;
        font.flags = header.flags;
        font.fsType = header.fsType;
        font.subset = header.subset;
        font.compressed = header.compressed;
        font.familyName = header.familyName;
        font.styleName = header.styleName;
        font.embedding.subset = header.subset;
        font.embedding.compressed = header.compressed;
        font.kind = header.compressed ? 'mtx' : header.flags & 0x10000000 ? 'xor' : header.subset ? 'subset' : 'complete';
        if (!header.compressed) {
          const payload = bytes.subarray(header.fontDataOffset, header.fontDataOffset + header.fontDataSize);
          const sfnt = header.flags & 0x10000000 ? Buffer.allocUnsafe(payload.length) : payload;
          if (sfnt !== payload) {
            for (let index = 0; index < payload.length; index += 1) sfnt[index] = payload[index]! ^ 0x50;
          }
          const opened = fontkit.create(sfnt);
          if ('fonts' in opened) throw new Error('Embedded EOT does not contain a standalone sfnt face');
          const digest = createHash('sha256').update(sfnt).digest('hex');
          const face = faceFromFont(opened, { sha256: digest, faceIndex: 0, source: { kind: 'embedded', part } });
          if (!face) throw new Error('Embedded sfnt face metadata cannot be read');
          font.sfnt = sfnt;
          font.sha256 = digest;
          font.resolved = {
            cssFamily: family, aliases: face.aliases, asset: face.asset, office: { family, style: slot },
            metrics: face.metrics, fsType: header.fsType, embedding: font.embedding,
          };
        }
      } catch (error) {
        font.formatError = error instanceof Error ? error.message : String(error);
      }
      payloads.set(part, font);
      fonts.push(font);
    }
  }
  return fonts;
}

/** Attach source family slots before local resolution; never normalize PowerPoint's nonstandard slots. */
export function attachEmbeddedFonts(deck: Deck, fonts: EmbeddedFont[]): void {
  if (fonts.length === 0) return;
  deck.embeddedFonts = fonts;
  for (const slide of deck.slides) {
    for (const element of slide.elements) {
      for (const { body } of textBodiesOf(element)) {
        for (const paragraph of body.paragraphs) {
          for (const run of paragraph.runs) {
            if (run.kind !== 'text') continue;
            delete run.style.embeddedFont;
            const slot: OfficeFontStyle = run.style.bold ? (run.style.italic ? 'boldItalic' : 'bold') : (run.style.italic ? 'italic' : 'regular');
            // The emitted HTML names the source family first. An authored primary family wins over it.
            const family = run.style.fontStack[0];
            const candidates = fonts.filter((font) => font.family.toLowerCase() === family?.toLowerCase());
            const font = candidates.find((candidate) => candidate.slot === slot) ?? candidates[0];
            if (!font) continue;
            run.style.embeddedFont = font;
            delete run.style.font;
          }
        }
      }
    }
  }
}

/** JSON-safe source identity; payloads remain in source.pptx and optional browser font assets. */
export function embeddedFontMetadata(font: EmbeddedFont): EmbeddedFontMetadata {
  const { sfnt: _sfnt, resolved: _resolved, ...metadata } = font;
  return metadata;
}
