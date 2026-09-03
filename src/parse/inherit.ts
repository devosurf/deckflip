// Placeholder inheritance, resolved to explicit values (docs/spec/11-architecture.md `parse/`): a run's
// properties come from the run, then its paragraph, then the shape's own list style, then the placeholder it
// fills on the layout and on the master, then the master's text styles, then `p:defaultTextStyle`. Chromium
// inherits nothing from PowerPoint, so whatever the HTML does not say explicitly is lost - hence this walk.

import { REL, type OpcReader, type Relationship } from '../ooxml/opc.js';
import type { XmlNode } from '../ooxml/xml.js';
import { readPlaceholder } from './drawing.js';
import { child, children, defined } from './xml.js';

/** The `a:lvl<N+1>pPr` nodes a shape falls back on, nearest first; `placeholder` is `<type>[:<idx>]`. */
export type InheritedStyles = (placeholder: string | undefined, level: number) => XmlNode[];

const TITLE_TYPES = new Set(['title', 'ctrTitle']);
const BODY_TYPES = new Set(['body', 'subTitle', 'obj']);

/** A part's parsed XML, or undefined when the package has no such part; the deck-wide memo of parse/index.ts. */
export type PartReader = (part: string | undefined) => Promise<XmlNode | undefined>;

/**
 * One resolver per deck: every Slide on the same layout shares its resolved styles, so the layout and the
 * master are read and searched for placeholders once per part however many Slides name them (`OpcReader`
 * holds no cache of its own). `slideRels` are the Slide's relationships, which the caller read anyway.
 */
export function inheritanceReader(pkg: OpcReader, presentation: XmlNode, readPart: PartReader): (slideRels: Relationship[]) => Promise<InheritedStyles> {
  const byLayout = new Map<string, Promise<InheritedStyles>>();
  return (slideRels) => {
    const layoutPart = slideRels.find((rel) => rel.type === REL.slideLayout && !rel.external)?.target ?? '';
    let styles = byLayout.get(layoutPart);
    if (styles === undefined) {
      styles = readInheritedStyles(pkg, layoutPart, presentation, readPart);
      byLayout.set(layoutPart, styles);
    }
    return styles;
  };
}

async function readInheritedStyles(pkg: OpcReader, layoutPart: string, presentation: XmlNode, readPart: PartReader): Promise<InheritedStyles> {
  const layout = await readPart(layoutPart);
  const masterPart = layout ? (await pkg.relationships(layoutPart)).find((rel) => rel.type === REL.slideMaster && !rel.external)?.target : undefined;
  const master = await readPart(masterPart);
  const txStyles = child(master, 'p:txStyles');
  const defaultTextStyle = child(presentation, 'p:defaultTextStyle');
  const layoutPlaceholders = placeholderStyles(layout);
  const masterPlaceholders = placeholderStyles(master);

  return (placeholder, level) => {
    if (placeholder === undefined) {
      return defined([levelOf(child(txStyles, 'p:otherStyle'), level), levelOf(defaultTextStyle, level)]);
    }
    const [type = 'body', idx] = placeholder.split(':', 2);
    return defined([
      levelOf(layoutPlaceholders(type, idx), level),
      levelOf(masterPlaceholders(masterType(type), undefined), level),
      levelOf(child(txStyles, styleKind(type)), level),
      levelOf(defaultTextStyle, level),
    ]);
  };
}

/** `p:titleStyle` for titles, `p:bodyStyle` for body placeholders, `p:otherStyle` for everything else. */
function styleKind(type: string): string {
  if (TITLE_TYPES.has(type)) {
    return 'p:titleStyle';
  }
  return BODY_TYPES.has(type) ? 'p:bodyStyle' : 'p:otherStyle';
}

/** A master carries one title and one body placeholder, so the slide's type collapses onto those. */
function masterType(type: string): string {
  if (TITLE_TYPES.has(type)) {
    return 'title';
  }
  return BODY_TYPES.has(type) ? 'body' : type;
}

/**
 * The `a:lstStyle` of the placeholder a shape fills, by (type, idx): same type and index, else same index,
 * else same type. The part's shape tree is read once, and each answer is kept, because every paragraph of
 * every Slide on this layout asks again.
 */
function placeholderStyles(part: XmlNode | undefined): (type: string, idx: string | undefined) => XmlNode | undefined {
  const candidates = children(child(child(part, 'p:cSld'), 'p:spTree'), 'p:sp').flatMap((sp) => {
    const placeholder = readPlaceholder(child(sp, 'p:nvSpPr'));
    if (placeholder === undefined) {
      return [];
    }
    const [type = 'body', idx] = placeholder.split(':', 2);
    return [{ type, idx, style: child(child(sp, 'p:txBody'), 'a:lstStyle') }];
  });
  const resolved = new Map<string, XmlNode | undefined>();
  return (type, idx) => {
    const key = `${type}:${idx ?? ''}`;
    if (!resolved.has(key)) {
      const match =
        candidates.find((candidate) => candidate.type === type && candidate.idx === idx) ??
        (idx === undefined ? undefined : candidates.find((candidate) => candidate.idx === idx)) ??
        candidates.find((candidate) => candidate.type === type);
      resolved.set(key, match?.style);
    }
    return resolved.get(key);
  };
}

function levelOf(styles: XmlNode | undefined, level: number): XmlNode | undefined {
  return child(styles, `a:lvl${Math.min(level, 8) + 1}pPr`);
}
