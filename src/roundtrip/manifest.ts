// The manifest (`deckflip.json`, docs/spec/06-round-trip.md "Attachment"): what PPTX -> HTML wrote, keyed by
// `data-shape-id`, with the fingerprints the way back compares against. `observeSection` is the one reading
// of a section tree both sides share: htmlout's output parsed back when the manifest is written, Chromium's
// DOM when it is checked.

import { createHash } from 'node:crypto';
import type { HtmlSlide } from '../htmlout/index.js';
import { fingerprint, parseHtml, type HtmlNode } from './fingerprint.js';
import type { SourceIndex } from './source.js';

export const MANIFEST_FILE = 'deckflip.json';
export const SOURCE_FILE = 'source.pptx';
export const MANIFEST_SCHEMA_VERSION = 1;

export interface Manifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  source: { sha256: string };
  slides: ManifestSlide[];
}

export interface ManifestSlide {
  /** the section id */
  id: string;
  partName: string;
  /** of the section shell: its attributes but `id`, and its notes */
  fingerprint: string;
  /** shapes the section itself stands for (its background) */
  spids: number[];
  /** the section's direct children that came from shapes, in z-order, and every nested one after its group */
  shapes: ManifestShape[];
}

export interface ManifestShape {
  /** `data-shape-id` as written */
  shapeId: string;
  fingerprint: string;
  /** `p:cNvPr` ids of the source shapes the element stands for, in z-order */
  spids: number[];
  /** internal parts those shapes reference */
  partRefs: string[];
  /** inside a group (only direct children of the section decide whether a Slide is untouched) */
  nested?: true;
}

export interface ObservedShape {
  shapeId: string;
  fingerprint: string;
  /** a direct child of the section (only those count for slide identity) */
  topLevel: boolean;
}

export interface ObservedSection {
  id: string;
  fingerprint: string;
  /** direct children of the section in order; `shapeId` undefined for children without a (unique) `data-shape-id` */
  children: Array<{ shapeId?: string }>;
  /** every `data-shape-id` element at any depth, document order, first occurrence of a duplicate only */
  shapes: ObservedShape[];
  /** `data-shape-id` values that appear more than once (spec 06: ignored, `PRESERVE_UNKNOWN_ID`) */
  duplicates: string[];
}

const SKIPPED_CHILDREN = new Set(['script', 'style', 'template']);

function isNotes(node: HtmlNode): boolean {
  return node.tag === 'aside' && (node.attrs.class ?? '').split(/\s+/).includes('notes');
}

/** Reads a section the way the manifest and the way back both need it. */
export function observeSection(section: HtmlNode): ObservedSection {
  const { id, ...attrs } = section.attrs;
  const shell: HtmlNode = { tag: section.tag, attrs, children: section.children.filter((child): child is HtmlNode => typeof child !== 'string' && isNotes(child)) };

  const seen = new Map<string, number>();
  const collect = (node: HtmlNode, topLevel: boolean, out: ObservedShape[]): void => {
    const shapeId = node.attrs['data-shape-id'];
    if (shapeId !== undefined && shapeId !== '') {
      seen.set(shapeId, (seen.get(shapeId) ?? 0) + 1);
      if (seen.get(shapeId) === 1) out.push({ shapeId, fingerprint: fingerprint(node), topLevel });
    }
    for (const child of node.children) {
      if (typeof child !== 'string') collect(child, false, out);
    }
  };
  const shapes: ObservedShape[] = [];
  const children: Array<{ shapeId?: string }> = [];
  for (const child of section.children) {
    if (typeof child === 'string' || isNotes(child) || SKIPPED_CHILDREN.has(child.tag)) continue;
    collect(child, true, shapes);
    const shapeId = child.attrs['data-shape-id'];
    children.push(shapeId ? { shapeId } : {});
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([shapeId]) => shapeId);
  for (const child of children) {
    if (child.shapeId !== undefined && duplicates.includes(child.shapeId)) delete child.shapeId;
  }
  return {
    id: id ?? '',
    fingerprint: fingerprint(shell),
    children,
    shapes: shapes.filter((shape) => !duplicates.includes(shape.shapeId)),
    duplicates,
  };
}

/** The `body > section` trees of a document as htmlout wrote it. */
export function sectionsOf(html: string): HtmlNode[] {
  const root = parseHtml(html).find((child): child is HtmlNode => typeof child !== 'string' && child.tag === 'html');
  const body = root?.children.find((child): child is HtmlNode => typeof child !== 'string' && child.tag === 'body');
  return body?.children.filter((child): child is HtmlNode => typeof child !== 'string' && child.tag === 'section') ?? [];
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `<n>-<spid>` -> spid */
function spidOf(shapeId: string): number {
  return Number(shapeId.slice(shapeId.indexOf('-') + 1));
}

export function buildManifest(html: string, written: HtmlSlide[], source: SourceIndex, sourceSha256: string): Manifest {
  const sections = sectionsOf(html);
  const slides = written.map((slide, index): ManifestSlide => {
    const section = sections[index];
    const sourceSlide = source.slides[index];
    if (!section || !sourceSlide) throw new Error(`Slide ${index + 1} has no section or source part`);
    const observed = observeSection(section);
    const spidsOf = (shapeId: string): number[] => (slide.merged[shapeId] ?? [shapeId]).map(spidOf);
    const partRefsOf = (spids: number[]): string[] => [...new Set(spids.flatMap((spid) => sourceSlide.shapes.get(spid)?.partRefs ?? []))];
    return {
      id: slide.id,
      partName: sourceSlide.partName,
      fingerprint: observed.fingerprint,
      spids: slide.background === undefined ? [] : [spidOf(slide.background)],
      shapes: observed.shapes.map((shape) => {
        const spids = spidsOf(shape.shapeId);
        return { shapeId: shape.shapeId, fingerprint: shape.fingerprint, spids, partRefs: partRefsOf(spids), ...(shape.topLevel ? {} : { nested: true as const }) };
      }),
    };
  });
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, source: { sha256: sourceSha256 }, slides };
}

export function parseManifest(text: string): Manifest | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const manifest = parsed as Manifest;
    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION || typeof manifest.source?.sha256 !== 'string' || !Array.isArray(manifest.slides)) return undefined;
    return manifest;
  } catch {
    return undefined;
  }
}
