// `p:sld` -> Slide: the shape tree in paint order. `p:sp` becomes a shape, `p:pic` a picture. `p:cxnSp`
// (per-side border lines), `p:grpSp` (groups) and `p:graphicFrame` (tables) are not read yet and are skipped.

import type { Element, PictureElement, ShapeElement, Slide } from '../model/index.js';
import type { XmlNode } from '../ooxml/xml.js';
import { readFill, readGeometry, readLine, readShadow, readSrcRect, readTransform, type DrawingContext } from './drawing.js';
import { readTextBody, type TextContext } from './text.js';
import { exact } from './units.js';
import { child, children } from './xml.js';

export interface SlideContext extends DrawingContext, TextContext {}

export async function readSlide(sld: XmlNode, index: number, ctx: SlideContext): Promise<Slide> {
  const cSld = child(sld, 'p:cSld');
  const elements: Element[] = [];
  for (const node of children(child(cSld, 'p:spTree'))) {
    const element = await readElement(node, ctx);
    if (element) {
      elements.push(element);
    }
  }
  return {
    index,
    id: `slide-${index}`,
    name: cSld?.attrs.name || `Slide ${index}`,
    layout: 'Blank',
    elements,
  };
}

async function readElement(node: XmlNode, ctx: SlideContext): Promise<Element | undefined> {
  if (node.name === 'p:sp') {
    return readShape(node, ctx);
  }
  if (node.name === 'p:pic') {
    return readPicture(node, ctx);
  }
  return undefined;
}

/** The locator htmlout writes for a shape: its `p:cNvPr` id as `data-shape-id`. */
function shapeSelector(nvPr: XmlNode | undefined): string {
  return `[data-shape-id="${child(nvPr, 'p:cNvPr')?.attrs.id ?? ''}"]`;
}

/** `p:sp`: the border box is the emitted frame inflated by half the stroke, since DrawingML centres strokes on the geometry. */
async function readShape(sp: XmlNode, ctx: SlideContext): Promise<ShapeElement | undefined> {
  const nvSpPr = child(sp, 'p:nvSpPr');
  const spPr = child(sp, 'p:spPr');
  const { frame, rotation } = readTransform(child(spPr, 'a:xfrm'));
  const line = readLine(child(spPr, 'a:ln'), ctx.colors);
  const half = (line?.width ?? 0) / 2;
  const box = { x: exact(frame.x - half), y: exact(frame.y - half), w: exact(frame.w + 2 * half), h: exact(frame.h + 2 * half) };
  const geometry = readGeometry(spPr, box, half);
  if (!geometry) {
    return undefined;
  }
  const shape: ShapeElement = {
    kind: 'shape',
    selector: shapeSelector(nvSpPr),
    name: child(nvSpPr, 'p:cNvPr')?.attrs.name ?? '',
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
  const shadow = readShadow(child(spPr, 'a:effectLst'), ctx.colors);
  if (shadow) {
    shape.shadow = shadow;
  }
  const text = readTextBody(child(sp, 'p:txBody'), ctx);
  if (text) {
    // the emitter folded half the stroke into every inset (spec 04); take it back out so re-emission does not double it
    text.padding = { l: exact(text.padding.l - half), t: exact(text.padding.t - half), r: exact(text.padding.r - half), b: exact(text.padding.b - half) };
    shape.text = text;
  }
  return shape;
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
    selector: shapeSelector(nvPicPr),
    name: child(nvPicPr, 'p:cNvPr')?.attrs.name ?? '',
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
