import JSZip from 'jszip';
import path from 'node:path';
import { el, serialize } from './xml.js';

export interface PartOptions {
  contentType: string;
}

export const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  coreProperties: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProperties: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  font: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font',
} as const;

export const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  fontData: 'application/vnd.openxmlformats-officedocument.obfuscatedFont',
} as const;

interface PartRecord {
  contentType: string;
  data: string | Uint8Array;
}

interface RelationshipRecord {
  type: string;
  target: string;
  external: boolean;
}

const DEFAULT_DATE = new Date('1980-01-01T00:00:00.000Z');

export class OpcPackage {
  readonly parts = new Map<string, PartRecord>();
  readonly relationships = new Map<string, RelationshipRecord[]>();

  addPart(name: string, contentType: string, data: string | Uint8Array): void {
    this.parts.set(normalizePartName(name), { contentType, data });
  }

  addRelationship(source: string, type: string, target: string, opts?: { external?: boolean }): string {
    const key = normalizeSource(source);
    const list = this.relationships.get(key) ?? [];
    if (!this.relationships.has(key)) {
      this.relationships.set(key, list);
    }
    const id = `rId${list.length + 1}`;
    list.push({ type, target, external: opts?.external ?? false });
    return id;
  }

  async toBuffer(opts?: { compression?: 'DEFLATE' | 'STORE'; date?: Date }): Promise<Buffer> {
    const zip = new JSZip();
    const date = opts?.date ?? DEFAULT_DATE;
    const compression = opts?.compression ?? 'DEFLATE';

    zip.file('[Content_Types].xml', buildContentTypesXml(this.parts), { date, compression });

    const rootRelationships = this.relationships.get('/') ?? [];
    if (rootRelationships.length) {
      zip.file('_rels/.rels', buildRelationshipsXml(rootRelationships), { date, compression });
    }

    for (const [name, part] of this.parts) {
      zip.file(zipPath(name), part.data, { date, compression });
      const rels = this.relationships.get(name) ?? [];
      if (rels.length) {
        zip.file(relsPath(name), buildRelationshipsXml(rels), { date, compression });
      }
    }

    return zip.generateAsync({ type: 'nodebuffer', compression, platform: 'UNIX' });
  }
}

function buildContentTypesXml(parts: Map<string, PartRecord>): string {
  const defaults = [
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['fntdata', CT.fontData],
  ];

  return serialize(
    el(
      'Types',
      { xmlns: 'http://schemas.openxmlformats.org/package/2006/content-types' },
      ...defaults.map(([extension, contentType]) =>
        el('Default', { Extension: extension, ContentType: contentType }),
      ),
      ...[...parts.entries()].map(([name, part]) =>
        el('Override', { PartName: name, ContentType: part.contentType }),
      ),
    ),
  );
}

function buildRelationshipsXml(rels: RelationshipRecord[]): string {
  return serialize(
    el(
      'Relationships',
      { xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships' },
      ...rels.map((rel, index) =>
        el('Relationship', {
          Id: `rId${index + 1}`,
          Type: rel.type,
          Target: rel.target,
          TargetMode: rel.external ? 'External' : undefined,
        }),
      ),
    ),
  );
}

function normalizeSource(source: string): string {
  if (source === '/') {
    return source;
  }
  return source.startsWith('/') ? source : `/${source}`;
}

function normalizePartName(name: string): string {
  return name.startsWith('/') ? name : `/${name}`;
}

function zipPath(partName: string): string {
  return partName.startsWith('/') ? partName.slice(1) : partName;
}

function relsPath(partName: string): string {
  const zipName = zipPath(partName);
  return `${path.posix.dirname(zipName)}/_rels/${path.posix.basename(zipName)}.rels`;
}
