import JSZip from 'jszip';
import path from 'node:path';
import { el, parseXml, serialize, type XmlNode } from './xml.js';

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
  id: string;
  type: string;
  target: string;
  external: boolean;
}

const DEFAULT_DATE = new Date('1980-01-01T00:00:00.000Z');

export class OpcPackage {
  readonly parts = new Map<string, PartRecord>();
  readonly relationships = new Map<string, RelationshipRecord[]>();
  /** relationship parts written byte for byte (an untouched source part keeps its own) */
  private readonly rawRelationships = new Map<string, string | Uint8Array>();

  addPart(name: string, contentType: string, data: string | Uint8Array): void {
    this.parts.set(normalizePartName(name), { contentType, data });
  }

  /** Registers a relationship and returns its id: `opts.id` when given, else the next `rId<n>` above every id the part has. */
  addRelationship(source: string, type: string, target: string, opts?: { external?: boolean; id?: string }): string {
    const key = normalizeSource(source);
    if (this.rawRelationships.has(key)) {
      throw new Error(`${source} keeps its relationships verbatim`);
    }
    const list = this.relationships.get(key) ?? [];
    if (!this.relationships.has(key)) {
      this.relationships.set(key, list);
    }
    const id = opts?.id ?? `rId${list.reduce((max, rel) => Math.max(max, Number(/^rId(\d+)$/.exec(rel.id)?.[1] ?? 0)), 0) + 1}`;
    list.push({ id, type, target, external: opts?.external ?? false });
    return id;
  }

  /** The part's `.rels` as given, instead of one built from `addRelationship` calls. */
  setRawRelationships(source: string, xml: string | Uint8Array): void {
    const key = normalizeSource(source);
    if (this.relationships.has(key)) {
      throw new Error(`${source} already has built relationships`);
    }
    this.rawRelationships.set(key, xml);
  }

  hasPart(name: string): boolean {
    return this.parts.has(normalizePartName(name));
  }

  async toBuffer(opts?: { compression?: 'DEFLATE' | 'STORE'; date?: Date }): Promise<Buffer> {
    const zip = new JSZip();
    const date = opts?.date ?? DEFAULT_DATE;
    const compression = opts?.compression ?? 'DEFLATE';

    zip.file('[Content_Types].xml', buildContentTypesXml(this.parts), { date, compression, createFolders: false });

    const rootRelationships = this.rawRelationships.get('/') ?? (this.relationships.get('/')?.length ? buildRelationshipsXml(this.relationships.get('/')!) : undefined);
    if (rootRelationships !== undefined) {
      zip.file('_rels/.rels', rootRelationships, { date, compression, createFolders: false });
    }

    for (const [name, part] of this.parts) {
      zip.file(zipPath(name), part.data, { date, compression, createFolders: false });
      const raw = this.rawRelationships.get(name);
      const rels = this.relationships.get(name) ?? [];
      if (raw !== undefined) {
        zip.file(relsPath(name), raw, { date, compression, createFolders: false });
      } else if (rels.length) {
        zip.file(relsPath(name), buildRelationshipsXml(rels), { date, compression, createFolders: false });
      }
    }

    return zip.generateAsync({ type: 'nodebuffer', compression, platform: 'UNIX' });
  }
}

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

/** Read side of an OPC package: parts by absolute name, relationships per source part, targets resolved. */
export class OpcReader {
  private constructor(private readonly zip: JSZip) {}

  static async load(bytes: Uint8Array): Promise<OpcReader> {
    return new OpcReader(await JSZip.loadAsync(bytes));
  }

  /** Absolute part names (`/ppt/...`), excluding `[Content_Types].xml` and relationship parts. */
  partNames(): string[] {
    return Object.keys(this.zip.files)
      .filter((name) => !this.zip.files[name]!.dir && name !== '[Content_Types].xml' && !name.endsWith('.rels'))
      .map(normalizePartName);
  }

  hasPart(name: string): boolean {
    return this.zip.file(zipPath(name)) !== null;
  }

  async bytes(name: string): Promise<Uint8Array> {
    const file = this.zip.file(zipPath(name));
    if (!file) {
      throw new Error(`Missing package part ${name}`);
    }
    return file.async('uint8array');
  }

  async xml(name: string): Promise<XmlNode> {
    const file = this.zip.file(zipPath(name));
    if (!file) {
      throw new Error(`Missing package part ${name}`);
    }
    return parseXml(await file.async('string'));
  }

  /** The relationships of a part (`/` for the package), with internal targets resolved to absolute part names. */
  async relationships(source: string): Promise<Relationship[]> {
    const file = this.zip.file(source === '/' ? '_rels/.rels' : relsPath(source));
    if (!file) {
      return [];
    }
    const base = source === '/' ? '/' : path.posix.dirname(normalizePartName(source));
    const root = parseXml(await file.async('string'));
    return root.children.flatMap((child) => {
      if (typeof child === 'string' || child.name !== 'Relationship') {
        return [];
      }
      const external = child.attrs.TargetMode === 'External';
      const target = child.attrs.Target ?? '';
      return [{ id: child.attrs.Id ?? '', type: child.attrs.Type ?? '', target: external ? target : path.posix.resolve(base, target), external }];
    });
  }

  /** The single relationship of `type` from `source`, resolved; undefined when absent. */
  async related(source: string, type: string): Promise<Relationship | undefined> {
    return (await this.relationships(source)).find((rel) => rel.type === type);
  }

  /** `[Content_Types].xml`: the content type of a part by override, else by extension default; undefined when neither names it. */
  async contentTypes(): Promise<(partName: string) => string | undefined> {
    const file = this.zip.file('[Content_Types].xml');
    const defaults = new Map<string, string>();
    const overrides = new Map<string, string>();
    if (file) {
      for (const child of parseXml(await file.async('string')).children) {
        if (typeof child === 'string') continue;
        if (child.name === 'Default' && child.attrs.Extension !== undefined) defaults.set(child.attrs.Extension.toLowerCase(), child.attrs.ContentType ?? '');
        if (child.name === 'Override' && child.attrs.PartName !== undefined) overrides.set(child.attrs.PartName, child.attrs.ContentType ?? '');
      }
    }
    return (partName) => {
      const name = normalizePartName(partName);
      const override = overrides.get(name);
      if (override !== undefined) return override;
      const extension = path.posix.extname(name).slice(1).toLowerCase();
      return this.hasPart(name) ? defaults.get(extension) : undefined;
    };
  }
}

function buildContentTypesXml(parts: Map<string, PartRecord>): string {
  const defaults = [
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['svg', 'image/svg+xml'],
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
      ...rels.map((rel) =>
        el('Relationship', {
          Id: rel.id,
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
