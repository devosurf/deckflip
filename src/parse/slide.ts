// `p:sld` -> Slide: the shape tree in paint order. `p:sp` becomes a shape (with the `p:cxnSp` per-side border
// lines the emitter wrote after it folded back in), `p:pic` a picture, `p:grpSp` a group of the same and a
// `p:graphicFrame` holding an `a:tbl` a table. Everything else the IDM cannot hold (charts, SmartArt, OLE,
// connectors, ink, metafile pictures, alternate content) is an opaque record (spec 06): its box and the parts
// it lives in, carried by the round trip.

import type { Element, GroupElement, Insets, Line, OpaqueClass, OpaqueElement, PictureElement, ShapeElement, Slide } from '../model/index.js';
import type { XmlNode } from '../ooxml/xml.js';
import { identityOf, readFill, readGeometry, readLine, readShadow, readSrcRect, readTransform, shapeIdentity, shapeName, type ColorScheme, type DrawingContext } from './drawing.js';
import { readTable } from './table.js';
import { readTextBody, type TextContext } from './text.js';
import { exact, px } from './units.js';
import { child, children } from './xml.js';

export interface SlideContext extends DrawingContext, TextContext {
  /** 1-based slide number, the first half of every `data-shape-id` */
  slide: number;
  /** the internal part a relationship id targets; undefined for unknown ids and external targets */
  partOf(rId: string): string | undefined;
}

const OPAQUE_TAGS = new Set(['p:cxnSp', 'p:contentPart', 'mc:AlternateContent']);

export async function readSlide(sld: XmlNode, index: number, ctx: SlideContext): Promise<Slide> {
  const cSld = child(sld, 'p:cSld');
  return {
    index,
    id: `slide-${index}`,
    name: cSld?.attrs.name || `Slide ${index}`,
    layout: 'Blank',
    elements: await readElements(children(child(cSld, 'p:spTree')), ctx),
  };
}

/** Sibling shape nodes in paint order (a group's non-visual and property children fall through); a shape consumes the border lines that follow it. */
async function readElements(nodes: XmlNode[], ctx: SlideContext): Promise<Element[]> {
  const elements: Element[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.name === 'p:sp') {
      const borders = readBorderLines(nodes, index + 1, shapeName(child(node, 'p:nvSpPr')), ctx.colors);
      index += borders.count;
      elements.push(await readShape(node, borders.sides, ctx));
    } else if (node.name === 'p:pic') {
      elements.push((await readPicture(node, ctx)) ?? readOpaque(node, 'vector', ctx));
    } else if (node.name === 'p:grpSp') {
      elements.push(await readGroup(node, ctx));
    } else if (node.name === 'p:graphicFrame') {
      elements.push((await readTable(node, ctx)) ?? readOpaque(node, graphicFrameClass(node), ctx));
    } else if (OPAQUE_TAGS.has(node.name)) {
      elements.push(readOpaque(node, 'vector', ctx));
    }
  }
  return elements;
}

const GRAPHIC_CLASSES: Array<[uri: string, cls: OpaqueClass]> = [
  ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart'],
  ['http://schemas.microsoft.com/office/drawing/2014/chartex', 'chart'],
  ['http://schemas.openxmlformats.org/drawingml/2006/diagram', 'smartart'],
  ['http://schemas.openxmlformats.org/presentationml/2006/ole', 'ole'],
];

function graphicFrameClass(frame: XmlNode): OpaqueClass {
  const uri = child(child(frame, 'a:graphic'), 'a:graphicData')?.attrs.uri ?? '';
  return GRAPHIC_CLASSES.find(([known]) => known === uri)?.[1] ?? 'vector';
}

/** The box comes from the first transform in the subtree, the parts from every relationship it references. */
function readOpaque(node: XmlNode, cls: OpaqueClass, ctx: SlideContext): OpaqueElement {
  const nvPr = descendant(node, (candidate) => candidate.name === 'p:cNvPr');
  const xfrm = descendant(node, (candidate) => candidate.name === 'a:xfrm' || candidate.name === 'p:xfrm');
  const { frame, rotation } = readTransform(xfrm);
  const parts: string[] = [];
  walk(node, (candidate) => {
    for (const [attr, value] of Object.entries(candidate.attrs)) {
      if (!attr.startsWith('r:')) continue;
      const part = ctx.partOf(value);
      if (part !== undefined && !parts.includes(part)) parts.push(part);
    }
  });
  return { kind: 'opaque', class: cls, ...identityOf(nvPr, ctx.slide), name: nvPr?.attrs.name ?? '', box: frame, rotation, parts };
}

function walk(node: XmlNode, visit: (node: XmlNode) => void): void {
  visit(node);
  for (const candidate of node.children) {
    if (typeof candidate !== 'string') walk(candidate, visit);
  }
}

function descendant(node: XmlNode, matches: (node: XmlNode) => boolean): XmlNode | undefined {
  for (const candidate of node.children) {
    if (typeof candidate === 'string') continue;
    if (matches(candidate)) return candidate;
    const nested = descendant(candidate, matches);
    if (nested) return nested;
  }
  return undefined;
}

/** WordArt and 3D (spec 06 "text with 3D or a:scene3d"): a warp, a 3D scene or bevel anywhere on the shape. */
function hasTextEffects(sp: XmlNode): boolean {
  return descendant(sp, (node) => node.name === 'a:scene3d' || node.name === 'a:sp3d' || (node.name === 'a:prstTxWarp' && node.attrs.prst !== 'textNoShape')) !== undefined;
}

const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;
type BorderSide = (typeof BORDER_SIDES)[number];

/**
 * The `p:cxnSp` run the emitter wrote right after a shape for its per-side borders, recognised by the
 * `<shape name> border-<side>` names it gives them (emit/shape.ts `buildBorderLines`); `count` is how many
 * sibling nodes they take.
 */
function readBorderLines(nodes: XmlNode[], from: number, name: string, colors: ColorScheme): { sides: ShapeElement['borders']; count: number } {
  const sides: Record<BorderSide, Line | undefined> = { top: undefined, right: undefined, bottom: undefined, left: undefined };
  let count = 0;
  for (let index = from; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const side = node.name === 'p:cxnSp' ? BORDER_SIDES.find((candidate) => shapeName(child(node, 'p:nvCxnSpPr')) === `${name} border-${candidate}`) : undefined;
    if (!side) {
      break;
    }
    sides[side] = readLine(child(child(node, 'p:spPr'), 'a:ln'), colors);
    count += 1;
  }
  if (count === 0) {
    return { sides: undefined, count };
  }
  const borders: NonNullable<ShapeElement['borders']> = {};
  for (const side of BORDER_SIDES) {
    if (sides[side]) {
      borders[side] = sides[side];
    }
  }
  return { sides: borders, count };
}

/**
 * `p:sp`: the border box is the emitted frame inflated by half the stroke, since DrawingML centres strokes on
 * the geometry. Per-side borders are separate lines on the border box, so they leave the frame alone.
 */
async function readShape(sp: XmlNode, borders: ShapeElement['borders'], ctx: SlideContext): Promise<ShapeElement> {
  const nvSpPr = child(sp, 'p:nvSpPr');
  const spPr = child(sp, 'p:spPr');
  const { frame, rotation } = readTransform(child(spPr, 'a:xfrm'));
  const line = readLine(child(spPr, 'a:ln'), ctx.colors);
  const half = (line?.width ?? 0) / 2;
  const box = { x: exact(frame.x - half), y: exact(frame.y - half), w: exact(frame.w + 2 * half), h: exact(frame.h + 2 * half) };
  const geometry = readGeometry(spPr, box, half);
  const shape: ShapeElement = {
    kind: 'shape',
    ...shapeIdentity(nvSpPr, ctx.slide),
    name: shapeName(nvSpPr),
    box,
    rotation,
    geometry,
  };
  const fill = await readFill(spPr, ctx);
  if (fill) {
    shape.fill = fill;
  }
  if (line) {
    shape.line = line;
  }
  if (borders) {
    shape.borders = borders;
  }
  const shadow = readShadow(child(spPr, 'a:effectLst'), ctx.colors);
  if (shadow) {
    shape.shadow = shadow;
  }
  const text = readTextBody(child(sp, 'p:txBody'), ctx);
  if (text) {
    // the emitter folded the stroke into every inset (spec 04): half a uniform line, or the full border side;
    // take it back out so re-emission does not double it
    const stroke = strokeInsets(line, borders);
    text.padding = { l: exact(text.padding.l - stroke.l), t: exact(text.padding.t - stroke.t), r: exact(text.padding.r - stroke.r), b: exact(text.padding.b - stroke.b) };
    shape.text = text;
  }
  if (hasTextEffects(sp)) {
    shape.preserve = 'text-effects';
  }
  return shape;
}

/** Mirror of emit/shape.ts `strokeInsets`: half a uniform line on every side, or each border side's full width. */
function strokeInsets(line: Line | undefined, borders: ShapeElement['borders']): Insets {
  if (line) {
    const half = line.width / 2;
    return { l: half, t: half, r: half, b: half };
  }
  return { l: borders?.left?.width ?? 0, t: borders?.top?.width ?? 0, r: borders?.right?.width ?? 0, b: borders?.bottom?.width ?? 0 };
}

/** `p:grpSp`: `off/ext` place the group, `chOff/chExt` name the child coordinate space (emit/slide.ts `buildGroup`). */
async function readGroup(grpSp: XmlNode, ctx: SlideContext): Promise<GroupElement> {
  const nvGrpSpPr = child(grpSp, 'p:nvGrpSpPr');
  const xfrm = child(child(grpSp, 'p:grpSpPr'), 'a:xfrm');
  const { frame, rotation } = readTransform(xfrm);
  const chOff = child(xfrm, 'a:chOff');
  const chExt = child(xfrm, 'a:chExt');
  return {
    kind: 'group',
    ...shapeIdentity(nvGrpSpPr, ctx.slide),
    name: shapeName(nvGrpSpPr),
    box: frame,
    childBox: { x: px(chOff?.attrs.x), y: px(chOff?.attrs.y), w: px(chExt?.attrs.cx), h: px(chExt?.attrs.cy) },
    rotation,
    children: await readElements(children(grpSp), ctx),
  };
}

/** `p:pic`: the frame is the visible picture box; the blip's `alphaModFix` is the opacity, an `asvg:svgBlip` the vector payload. */
async function readPicture(pic: XmlNode, ctx: SlideContext): Promise<PictureElement | undefined> {
  const nvPicPr = child(pic, 'p:nvPicPr');
  const blipFill = child(pic, 'p:blipFill');
  const blip = child(blipFill, 'a:blip');
  const loaded = blip?.attrs['r:embed'] ? await ctx.media(blip.attrs['r:embed']) : undefined;
  if (!loaded) {
    return undefined;
  }
  const spPr = child(pic, 'p:spPr');
  const { frame, rotation } = readTransform(child(spPr, 'a:xfrm'));
  const picture: PictureElement = {
    kind: 'picture',
    ...(loaded.raster ? { source: 'raster' as const } : {}),
    ...shapeIdentity(nvPicPr, ctx.slide),
    name: shapeName(nvPicPr),
    box: frame,
    rotation,
    crop: readSrcRect(child(blipFill, 'a:srcRect')),
    geometry: readGeometry(spPr, frame, 0),
    media: loaded.media,
  };
  const alpha = child(blip, 'a:alphaModFix')?.attrs.amt;
  if (alpha !== undefined) {
    picture.opacity = Number(alpha) / 100000;
  }
  const svgBlip = children(child(blip, 'a:extLst'), 'a:ext').map((ext) => child(ext, 'asvg:svgBlip')).find(Boolean);
  const vector = svgBlip?.attrs['r:embed'] ? await ctx.media(svgBlip.attrs['r:embed']) : undefined;
  if (vector) {
    picture.vector = vector.media;
  }
  const shadow = readShadow(child(spPr, 'a:effectLst'), ctx.colors);
  if (shadow) {
    picture.shadow = shadow;
  }
  return picture;
}
