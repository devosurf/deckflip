// DrawingML readers shared by shapes, pictures and tables: colours, fills, lines, effects, geometry, transforms.

import type { Box, Color, CornerRadius, Fill, Geometry, GradientStop, ImageFill, Insets, Line, Media, Shadow } from '../model/index.js';
import type { XmlNode } from '../ooxml/xml.js';
import { child, children } from './xml.js';
import { px, exact } from './units.js';

/** Theme colour scheme, `dk1`/`lt1`/`accent1`... -> `RRGGBB`, with the default `p:clrMap` aliases folded in. */
export type ColorScheme = Map<string, string>;

const CLR_MAP_DEFAULTS: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };

export function readColorScheme(theme: XmlNode | undefined): ColorScheme {
  const scheme: ColorScheme = new Map();
  const clrScheme = child(child(theme, 'a:themeElements'), 'a:clrScheme');
  for (const slot of children(clrScheme)) {
    const name = slot.name.replace(/^a:/, '');
    const srgb = child(slot, 'a:srgbClr')?.attrs.val ?? child(slot, 'a:sysClr')?.attrs.lastClr;
    if (srgb) {
      scheme.set(name, srgb.toUpperCase());
    }
  }
  for (const [alias, target] of Object.entries(CLR_MAP_DEFAULTS)) {
    const hex = scheme.get(target);
    if (hex && !scheme.has(alias)) {
      scheme.set(alias, hex);
    }
  }
  return scheme;
}

/** Resolves the media behind an `r:embed` id on the current part; `raster` when the part is a `raster-<hash>` capture (spec 05). */
export interface DrawingContext {
  colors: ColorScheme;
  media(rId: string): Promise<{ media: Media; raster: boolean } | undefined>;
}

/** The locator htmlout writes for a shape: `data-shape-id="<slide number>-<p:cNvPr id>"` (spec 02). */
export function shapeSelector(nvPr: XmlNode | undefined, slide: number): string {
  return `[data-shape-id="${slide}-${child(nvPr, 'p:cNvPr')?.attrs.id ?? ''}"]`;
}

export function shapeName(nvPr: XmlNode | undefined): string {
  return child(nvPr, 'p:cNvPr')?.attrs.name ?? '';
}

/** `a:srgbClr` (with `a:alpha`) or `a:schemeClr` through the theme; `a:lumMod`/`a:lumOff` tints are applied on scheme colours. */
export function readColor(container: XmlNode | undefined, colors: ColorScheme): Color | undefined {
  const srgb = child(container, 'a:srgbClr');
  const scheme = child(container, 'a:schemeClr');
  const node = srgb ?? scheme;
  if (!node) {
    return undefined;
  }
  let hex = srgb ? (srgb.attrs.val ?? '000000').toUpperCase() : colors.get(scheme!.attrs.val ?? '') ?? '000000';
  const lumMod = child(node, 'a:lumMod')?.attrs.val;
  const lumOff = child(node, 'a:lumOff')?.attrs.val;
  if (lumMod !== undefined || lumOff !== undefined) {
    hex = adjustLuminance(hex, Number(lumMod ?? 100000) / 100000, Number(lumOff ?? 0) / 100000);
  }
  const alpha = child(node, 'a:alpha')?.attrs.val;
  return { hex, alpha: alpha === undefined ? 1 : Number(alpha) / 100000 };
}

/** HSL luminance modulation as PowerPoint applies theme tints (`lumMod` scales, `lumOff` shifts). */
function adjustLuminance(hex: string, mod: number, off: number): string {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  let s = 0;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  l = Math.min(1, Math.max(0, l * mod + off));
  const hue = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): string => Math.round((s === 0 ? l : hue(p, q, t)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `${channel(h + 1 / 3)}${channel(h)}${channel(h - 1 / 3)}`;
}

/** The fill among a property container's children: `a:noFill` and absence both mean no fill. */
export async function readFill(container: XmlNode | undefined, ctx: DrawingContext): Promise<Fill | undefined> {
  const solid = child(container, 'a:solidFill');
  if (solid) {
    const color = readColor(solid, ctx.colors);
    return color ? { type: 'solid', color } : undefined;
  }
  const grad = child(container, 'a:gradFill');
  if (grad) {
    return readGradient(grad, ctx.colors);
  }
  const blip = child(container, 'a:blipFill');
  if (blip) {
    return readImageFill(blip, ctx);
  }
  return undefined;
}

function readGradient(grad: XmlNode, colors: ColorScheme): Fill | undefined {
  const stops: GradientStop[] = [];
  for (const gs of children(child(grad, 'a:gsLst'), 'a:gs')) {
    const color = readColor(gs, colors);
    if (color) {
      stops.push({ position: Number(gs.attrs.pos ?? 0) / 100000, color });
    }
  }
  if (stops.length === 0) {
    return undefined;
  }
  const lin = child(grad, 'a:lin');
  if (lin) {
    // DrawingML: 0 = to right, clockwise, 60000ths of a degree. CSS: 0 = to top.
    const angle = (Number(lin.attrs.ang ?? 0) / 60000 + 90) % 360;
    return { type: 'gradient', kind: 'linear', angle, stops };
  }
  return { type: 'gradient', kind: 'radial', stops };
}

async function readImageFill(blip: XmlNode, ctx: DrawingContext): Promise<ImageFill | undefined> {
  const blipNode = child(blip, 'a:blip');
  const loaded = blipNode?.attrs['r:embed'] ? await ctx.media(blipNode.attrs['r:embed']) : undefined;
  if (!loaded) {
    return undefined;
  }
  const media = loaded.media;
  const alpha = child(blipNode, 'a:alphaModFix')?.attrs.amt;
  const opacity = alpha === undefined ? {} : { opacity: Number(alpha) / 100000 };
  const tile = child(blip, 'a:tile');
  if (tile) {
    return {
      type: 'image',
      media,
      ...opacity,
      tile: { x: px(tile.attrs.tx), y: px(tile.attrs.ty), scaleX: Number(tile.attrs.sx ?? 100000) / 100000, scaleY: Number(tile.attrs.sy ?? 100000) / 100000 },
    };
  }
  return { type: 'image', media, ...opacity, crop: readSrcRect(child(blip, 'a:srcRect')) };
}

export function readSrcRect(srcRect: XmlNode | undefined): Insets {
  const fraction = (value: string | undefined): number => Number(value ?? 0) / 100000;
  return { l: fraction(srcRect?.attrs.l), t: fraction(srcRect?.attrs.t), r: fraction(srcRect?.attrs.r), b: fraction(srcRect?.attrs.b) };
}

/** `a:ln` with a visible solid fill; `a:noFill`, absence, or a zero width means no line. */
export function readLine(ln: XmlNode | undefined, colors: ColorScheme): Line | undefined {
  if (!ln || child(ln, 'a:noFill')) {
    return undefined;
  }
  const color = readColor(child(ln, 'a:solidFill'), colors);
  const width = px(ln.attrs.w ?? '9525');
  if (!color || width <= 0) {
    return undefined;
  }
  const preset = child(ln, 'a:prstDash')?.attrs.val;
  const dash: Line['dash'] = preset === undefined || preset === 'solid' ? 'solid' : /dot/i.test(preset) ? 'dot' : 'dash';
  return { width, color, dash };
}

/** The first outer or inner shadow of an `a:effectLst`. */
export function readShadow(effectLst: XmlNode | undefined, colors: ColorScheme): Shadow | undefined {
  const outer = child(effectLst, 'a:outerShdw');
  const inner = child(effectLst, 'a:innerShdw');
  const node = outer ?? inner;
  if (!node) {
    return undefined;
  }
  const color = readColor(node, colors) ?? { hex: '000000', alpha: 1 };
  const dist = px(node.attrs.dist);
  const dir = (Number(node.attrs.dir ?? 0) / 60000) * (Math.PI / 180);
  return {
    inset: node === inner,
    offsetX: exact(dist * Math.cos(dir)),
    offsetY: exact(dist * Math.sin(dir)),
    blur: px(node.attrs.blurRad),
    color,
  };
}

/** `a:xfrm`: the emitted rectangle and rotation, before any stroke inflation. */
export function readTransform(xfrm: XmlNode | undefined): { frame: Box; rotation: number } {
  const off = child(xfrm, 'a:off');
  const ext = child(xfrm, 'a:ext');
  return {
    frame: { x: px(off?.attrs.x), y: px(off?.attrs.y), w: px(ext?.attrs.cx), h: px(ext?.attrs.cy) },
    rotation: exact(Number(xfrm?.attrs.rot ?? 0) / 60000),
  };
}

/**
 * `a:prstGeom` rect/roundRect/ellipse, or the emitter's rounded-rectangle `a:custGeom` (one arc per corner,
 * radii shrunk by half the stroke) read back as roundRect, ellipse or per-corner radii. Any other preset or
 * path keeps the shape at its box as a rectangle (spec 06 represents those as vectors; a later slice). `box`
 * is the border box; `strokeHalf` the half line width the path radii were shrunk by.
 */
export function readGeometry(spPr: XmlNode | undefined, box: Box, strokeHalf: number): Geometry {
  const preset = child(spPr, 'a:prstGeom');
  if (preset) {
    const prst = preset.attrs.prst;
    if (prst === 'ellipse') {
      return { preset: 'ellipse' };
    }
    if (prst === 'roundRect') {
      const adj = children(child(preset, 'a:avLst'), 'a:gd').find((gd) => gd.attrs.name === 'adj')?.attrs.fmla?.match(/val (\d+)/)?.[1];
      const minSide = Math.min(box.w, box.h);
      // `adj` is quantised to 1/50000 of the half side; 1/1000 px is the HTML side's precision and re-emits to the same adj
      return { preset: 'roundRect', radius: Math.round(((adj === undefined ? 16667 : Number(adj)) / 50000) * (minSide / 2) * 1000) / 1000 };
    }
    return { preset: 'rect' };
  }
  const custom = child(spPr, 'a:custGeom');
  return (custom && readRoundedPath(custom, box, strokeHalf)) ?? { preset: 'rect' };
}

const ARC_CORNER: Record<string, 'tl' | 'tr' | 'br' | 'bl'> = { '16200000': 'tr', '0': 'br', '5400000': 'bl', '10800000': 'tl' };

function readRoundedPath(custom: XmlNode, box: Box, strokeHalf: number): Geometry | undefined {
  const paths = children(child(custom, 'a:pathLst'), 'a:path');
  const path = paths[0];
  if (paths.length !== 1 || !path) {
    return undefined;
  }
  const radii: Record<'tl' | 'tr' | 'br' | 'bl', CornerRadius> = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
  for (const segment of children(path)) {
    if (segment.name === 'a:arcTo') {
      const corner = ARC_CORNER[segment.attrs.stAng ?? ''];
      if (!corner || segment.attrs.swAng !== '5400000') {
        return undefined;
      }
      radii[corner] = { x: exact(px(segment.attrs.wR) + strokeHalf), y: exact(px(segment.attrs.hR) + strokeHalf) };
    } else if (!['a:moveTo', 'a:lnTo', 'a:close'].includes(segment.name)) {
      return undefined;
    }
  }
  const all = [radii.tl, radii.tr, radii.br, radii.bl];
  const uniform = all.every((r) => r.x === all[0]!.x && r.y === all[0]!.y);
  if (uniform && all[0]!.x === box.w / 2 && all[0]!.y === box.h / 2) {
    return { preset: 'ellipse' };
  }
  if (uniform && all[0]!.x === all[0]!.y) {
    return all[0]!.x === 0 ? { preset: 'rect' } : { preset: 'roundRect', radius: all[0]!.x };
  }
  return { preset: 'custom', radii };
}
