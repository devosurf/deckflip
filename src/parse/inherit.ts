// Placeholder inheritance, resolved to explicit values (docs/spec/11-architecture.md `parse/`): a run's
// properties come from the run, then its paragraph, then the shape's own list style, then the placeholder it
// fills on the layout and on the master, then the master's text styles, then `p:defaultTextStyle`. Chromium
// inherits nothing from PowerPoint, so whatever the HTML does not say explicitly is lost - hence this walk.

import { REL, type OpcReader } from '../ooxml/opc.js';
import type { XmlNode } from '../ooxml/xml.js';
import { child, children } from './xml.js';

/** The `a:lvl<N+1>pPr` nodes a shape falls back on, nearest first; `placeholder` is `<type>[:<idx>]`. */
export type InheritedStyles = (placeholder: string | undefined, level: number) => XmlNode[];

const TITLE_TYPES = new Set(['title', 'ctrTitle']);
const BODY_TYPES = new Set(['body', 'subTitle', 'obj']);

export async function readInheritedStyles(pkg: OpcReader, slidePart: string, presentation: XmlNode): Promise<InheritedStyles> {
  const layoutPart = (await pkg.relationships(slidePart)).find((rel) => rel.type === REL.slideLayout && !rel.external)?.target;
  const layout = layoutPart && pkg.hasPart(layoutPart) ? await pkg.xml(layoutPart) : undefined;
  const masterPart = layoutPart ? (await pkg.relationships(layoutPart)).find((rel) => rel.type === REL.slideMaster && !rel.external)?.target : undefined;
  const master = masterPart && pkg.hasPart(masterPart) ? await pkg.xml(masterPart) : undefined;
  const txStyles = child(master, 'p:txStyles');
  const defaultTextStyle = child(presentation, 'p:defaultTextStyle');

  return (placeholder, level) => {
    const [type = 'body', idx] = placeholder === undefined ? [undefined, undefined] : placeholder.split(':', 2);
    const chain: Array<XmlNode | undefined> = [];
    if (placeholder !== undefined) {
      chain.push(levelOf(placeholderStyle(layout, type, idx), level));
      chain.push(levelOf(placeholderStyle(master, masterType(type), undefined), level));
    }
    chain.push(levelOf(child(txStyles, styleKind(placeholder === undefined ? undefined : type)), level));
    chain.push(levelOf(defaultTextStyle, level));
    return chain.filter((node): node is XmlNode => node !== undefined);
  };
}

/** `p:titleStyle` for titles, `p:bodyStyle` for body placeholders, `p:otherStyle` for everything else. */
function styleKind(type: string | undefined): string {
  if (type !== undefined && TITLE_TYPES.has(type)) {
    return 'p:titleStyle';
  }
  return type !== undefined && BODY_TYPES.has(type) ? 'p:bodyStyle' : 'p:otherStyle';
}

/** A master carries one title and one body placeholder, so the slide's type collapses onto those. */
function masterType(type: string): string {
  if (TITLE_TYPES.has(type)) {
    return 'title';
  }
  return BODY_TYPES.has(type) ? 'body' : type;
}

/** The `a:lstStyle` of the placeholder a shape fills: same type and index, else same index, else same type. */
function placeholderStyle(part: XmlNode | undefined, type: string, idx: string | undefined): XmlNode | undefined {
  const shapes = children(child(child(part, 'p:cSld'), 'p:spTree'), 'p:sp');
  const candidates = shapes.map((sp) => ({ sp, ph: child(child(child(sp, 'p:nvSpPr'), 'p:nvPr'), 'p:ph') })).filter((candidate) => candidate.ph !== undefined);
  const match =
    candidates.find((candidate) => (candidate.ph!.attrs.type ?? 'body') === type && candidate.ph!.attrs.idx === idx) ??
    (idx === undefined ? undefined : candidates.find((candidate) => candidate.ph!.attrs.idx === idx)) ??
    candidates.find((candidate) => (candidate.ph!.attrs.type ?? 'body') === type);
  return match && child(child(match.sp, 'p:txBody'), 'a:lstStyle');
}

function levelOf(styles: XmlNode | undefined, level: number): XmlNode | undefined {
  return child(styles, `a:lvl${Math.min(level, 8) + 1}pPr`);
}
