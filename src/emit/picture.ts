import type { PictureElement, ShapeElement } from '../model/index.js';
import { pxToEmu } from '../ooxml/emu.js';
import { el, type XmlNode } from '../ooxml/xml.js';
import { relateMedia } from './media.js';
import { buildEffects, buildPlaceholder, buildShape, type ShapeEmissionContext } from './shape.js';

const SVG_BLIP_EXT_URI = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
const SVG_NS = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';

/** `p:pic` for the visible frame, plus an outline shape on the border box when the element has a border. */
export function buildPicture(picture: PictureElement, ctx: ShapeEmissionContext, nextId: () => number): XmlNode[] {
  const embed = relateMedia(picture.media, ctx, picture.source === 'raster' ? 'raster-' : '');
  const blipChildren: XmlNode[] = [];
  if (picture.opacity !== undefined) {
    blipChildren.push(el('a:alphaModFix', { amt: Math.round(picture.opacity * 100000) }));
  }
  if (picture.vector) {
    const vectorId = relateMedia(picture.vector, ctx);
    blipChildren.push(el('a:extLst', {}, el('a:ext', { uri: SVG_BLIP_EXT_URI }, el('asvg:svgBlip', { 'xmlns:asvg': SVG_NS, 'r:embed': vectorId }))));
  }
  const crop = picture.crop;
  const srcRect = crop.l || crop.t || crop.r || crop.b
    ? el('a:srcRect', { l: pct(crop.l), t: pct(crop.t), r: pct(crop.r), b: pct(crop.b) })
    : undefined;

  const pic = el(
    'p:pic',
    {},
    el('p:nvPicPr', {}, el('p:cNvPr', { id: nextId(), name: picture.name }), el('p:cNvPicPr', {}, el('a:picLocks', { noChangeAspect: '1' })), el('p:nvPr', {}, buildPlaceholder(picture.placeholder))),
    el('p:blipFill', {}, el('a:blip', { 'r:embed': embed }, blipChildren), srcRect, el('a:stretch', {}, el('a:fillRect'))),
    el(
      'p:spPr',
      {},
      el(
        'a:xfrm',
        { rot: Math.round(picture.rotation * 60000) },
        el('a:off', { x: pxToEmu(picture.box.x), y: pxToEmu(picture.box.y) }),
        el('a:ext', { cx: pxToEmu(picture.box.w), cy: pxToEmu(picture.box.h) }),
      ),
      buildPictureGeometry(picture),
      buildEffects(picture),
    ),
  );

  if (!picture.outline) {
    return [pic];
  }
  const outline: ShapeElement = {
    kind: 'shape',
    selector: picture.selector,
    name: `${picture.name} border`,
    box: picture.outline,
    rotation: picture.rotation,
    geometry: picture.geometry,
    ...(picture.line ? { line: picture.line } : {}),
    ...(picture.borders ? { borders: picture.borders } : {}),
  };
  return [pic, ...buildShape(outline, ctx, nextId)];
}

function buildPictureGeometry(picture: PictureElement): XmlNode {
  const geometry = picture.geometry;
  if (geometry.preset === 'ellipse') {
    return el('a:prstGeom', { prst: 'ellipse' }, el('a:avLst'));
  }
  if (geometry.preset === 'roundRect') {
    const minSide = Math.min(picture.box.w, picture.box.h);
    const adj = minSide > 0 ? Math.min(50000, Math.max(0, Math.round((geometry.radius / (minSide / 2)) * 50000))) : 0;
    return el('a:prstGeom', { prst: 'roundRect' }, el('a:avLst', {}, el('a:gd', { name: 'adj', fmla: `val ${adj}` })));
  }
  return el('a:prstGeom', { prst: 'rect' }, el('a:avLst'));
}

function pct(fraction: number): number {
  return Math.round(fraction * 100000);
}
