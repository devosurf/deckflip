import type { CornerRadius, Element, Geometry, GradientStop, ImageFill, Insets, Line, ShapeElement, TextBody } from '../model/index.js';
import { pxToEmu } from '../ooxml/emu.js';
import { el, type XmlNode } from '../ooxml/xml.js';
import { relateMedia, type MediaEmissionContext } from './media.js';
import { baselineCorrectionPx, buildTextBody, colorNode, solidFillNode, type TextEmissionContext } from './text.js';

export interface ShapeEmissionContext extends TextEmissionContext, MediaEmissionContext {
  /** the round trip's say over each element: verbatim fragments for untouched ones, the ids touched ones keep */
  splice?: {
    fragments(element: Element): XmlNode[] | undefined;
    keepIds(element: Element): number[];
  };
}

/** The shape plus one connector line per side when borders differ; ids come from `nextId` in emission order. */
export function buildShape(shape: ShapeElement, ctx: ShapeEmissionContext, nextId: () => number): XmlNode[] {
  const guard = planGuard(shape);
  const frame = shapeFrame(shape, guard);
  const xfrm = buildTransform(shape, frame);
  const geometry = buildGeometry(shape, frame);
  const fill = buildFill(shape, ctx);
  const line = buildLine(shape.line);
  const effects = buildEffects(shape);
  const text = shape.text ? buildText(shape.text, shape, ctx, guard) : undefined;

  const sp = el(
    'p:sp',
    {},
    el(
      'p:nvSpPr',
      {},
      el('p:cNvPr', { id: nextId(), name: shape.name }),
      el('p:cNvSpPr', shape.text && !shape.fill && !shape.line && !shape.borders ? { txBox: '1' } : {}),
      el('p:nvPr', {}, buildPlaceholder(shape.placeholder)),
    ),
    el('p:spPr', {}, xfrm, geometry, fill, line, effects),
    text,
  );
  return [sp, ...buildBorderLines(shape, nextId)];
}

/**
 * `p:ph` for a shape or picture that fills a layout placeholder (spec 06 "Placeholders"): `data-placeholder`
 * spells it `<type>[:<idx>]`. A touched placeholder keeps its `p:ph` and gets its properties written
 * explicitly, so PowerPoint still treats it as the layout box while the deck renders what the HTML showed.
 */
export function buildPlaceholder(placeholder: string | undefined): XmlNode | undefined {
  if (placeholder === undefined) {
    return undefined;
  }
  const [type, idx] = placeholder.split(':', 2);
  return el('p:ph', { type: type || 'body', idx });
}

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Stroke thickness the text insets must absorb: half a uniform line (the box is deflated by the other half) or a full border side. */
function strokeInsets(shape: ShapeElement): Insets {
  if (shape.line) {
    const half = shape.line.width / 2;
    return { l: half, t: half, r: half, b: half };
  }
  const b = shape.borders;
  return { l: b?.left?.width ?? 0, t: b?.top?.width ?? 0, r: b?.right?.width ?? 0, b: b?.bottom?.width ?? 0 };
}

/** The emitted rectangle: the border box deflated by half a uniform stroke (DrawingML strokes are centred), plus the guard. */
function shapeFrame(shape: ShapeElement, guard: GuardPlan): Frame {
  const stroke = shape.line?.width ?? 0;
  return {
    x: shape.box.x + stroke / 2 - guard.shift,
    y: shape.box.y + stroke / 2,
    w: Math.max(0, shape.box.w - stroke) + guard.widen,
    h: Math.max(0, shape.box.h - stroke),
  };
}

function buildBorderLines(shape: ShapeElement, nextId: () => number): XmlNode[] {
  const borders = shape.borders;
  if (!borders) {
    return [];
  }
  const { x, y, w, h } = shape.box;
  const sides: Array<[string, Line | undefined, Frame]> = [
    ['top', borders.top, { x, y: y + (borders.top?.width ?? 0) / 2, w, h: 0 }],
    ['right', borders.right, { x: x + w - (borders.right?.width ?? 0) / 2, y, w: 0, h }],
    ['bottom', borders.bottom, { x, y: y + h - (borders.bottom?.width ?? 0) / 2, w, h: 0 }],
    ['left', borders.left, { x: x + (borders.left?.width ?? 0) / 2, y, w: 0, h }],
  ];
  const lines: XmlNode[] = [];
  for (const [side, line, frame] of sides) {
    if (!line) {
      continue;
    }
    lines.push(
      el(
        'p:cxnSp',
        {},
        el('p:nvCxnSpPr', {}, el('p:cNvPr', { id: nextId(), name: `${shape.name} border-${side}` }), el('p:cNvCxnSpPr'), el('p:nvPr')),
        el(
          'p:spPr',
          {},
          el('a:xfrm', {}, el('a:off', { x: pxToEmu(frame.x), y: pxToEmu(frame.y) }), el('a:ext', { cx: pxToEmu(frame.w), cy: pxToEmu(frame.h) })),
          el('a:prstGeom', { prst: 'line' }, el('a:avLst')),
          buildLine(line),
        ),
      ),
    );
  }
  return lines;
}

export function buildEffects(shape: { shadow?: ShapeElement['shadow'] }): XmlNode | undefined {
  const shadow = shape.shadow;
  if (!shadow) {
    return undefined;
  }
  const dist = pxToEmu(Math.hypot(shadow.offsetX, shadow.offsetY));
  const degrees = (Math.atan2(shadow.offsetY, shadow.offsetX) * 180) / Math.PI;
  const dir = Math.round((((degrees % 360) + 360) % 360) * 60000);
  const blurRad = pxToEmu(shadow.blur);
  const node = shadow.inset
    ? el('a:innerShdw', { blurRad, dist, dir }, colorNode(shadow.color))
    : el('a:outerShdw', { blurRad, dist, dir, algn: 'ctr', rotWithShape: '0' }, colorNode(shadow.color));
  return el('a:effectLst', {}, node);
}

interface GuardPlan {
  /** extra width on the shape, CSS px */
  widen: number;
  /** leftward shift of the shape, CSS px */
  shift: number;
  /** reduction of lIns / rIns, CSS px */
  insetL: number;
  insetR: number;
}

/**
 * Wrap-width guard (spec 04): give PowerPoint up to 1 px more wrap width on the trailing side. Insets absorb it
 * when they can (no visible change at all); only when an inset would go negative is the shape itself widened
 * (and shifted, so the text does not move), which moves a stroked border by the guard.
 */
function planGuard(shape: ShapeElement): GuardPlan {
  const plan: GuardPlan = { widen: 0, shift: 0, insetL: 0, insetR: 0 };
  const text = shape.text;
  if (!text || text.trailingGuard === 0) {
    return plan;
  }
  const align = text.paragraphs[0]?.align;
  const wantL = align === 'ctr' ? text.trailingGuard / 2 : align === 'r' || text.rtl ? text.trailingGuard : 0;
  const wantR = text.trailingGuard - wantL;
  if (text.trailingGuard < 0) {
    // narrowing: insets can always grow, the shape never moves
    plan.insetL = wantL;
    plan.insetR = wantR;
    return plan;
  }
  const stroke = strokeInsets(shape);
  plan.insetL = Math.min(wantL, text.padding.l + stroke.l);
  plan.insetR = Math.min(wantR, text.padding.r + stroke.r);
  plan.shift = wantL - plan.insetL;
  plan.widen = plan.shift + (wantR - plan.insetR);
  return plan;
}

function buildTransform(shape: ShapeElement, frame: Frame): XmlNode {
  return el(
    'a:xfrm',
    { rot: Math.round(shape.rotation * 60000) },
    el('a:off', { x: pxToEmu(frame.x), y: pxToEmu(frame.y) }),
    el('a:ext', { cx: pxToEmu(frame.w), cy: pxToEmu(frame.h) }),
  );
}

function buildGeometry(shape: ShapeElement, frame: Frame): XmlNode {
  const geometry = shape.geometry;
  const strokeHalf = (shape.line?.width ?? 0) / 2;
  if (geometry.preset === 'custom') {
    return buildRoundedPath(geometry.radii, frame, strokeHalf);
  }
  // Preset roundRect/ellipse inset their text rectangle (by the corner, or to the inscribed rectangle), which
  // changes wrapping; a custom path with a full text rect keeps Chromium's line breaks. Text-free shapes keep
  // the preset so they stay editable as such.
  if (shape.text && geometry.preset !== 'rect') {
    const radius: CornerRadius = geometry.preset === 'ellipse' ? { x: shape.box.w / 2, y: shape.box.h / 2 } : { x: geometry.radius, y: geometry.radius };
    return buildRoundedPath({ tl: radius, tr: radius, br: radius, bl: radius }, frame, strokeHalf);
  }
  if (geometry.preset === 'ellipse') {
    return el('a:prstGeom', { prst: 'ellipse' }, el('a:avLst'));
  }
  if (geometry.preset === 'roundRect') {
    const minSide = Math.min(shape.box.w, shape.box.h);
    const adj = minSide > 0 ? clamp(Math.round((geometry.radius / (minSide / 2)) * 50000), 0, 50000) : 0;
    return el('a:prstGeom', { prst: 'roundRect' }, el('a:avLst', {}, el('a:gd', { name: 'adj', fmla: `val ${adj}` })));
  }
  return el('a:prstGeom', { prst: 'rect' }, el('a:avLst'));
}

/**
 * Rectangle with independent corner radii as a `custGeom` path, clockwise from the top-left corner's end.
 * `arcTo` continues from the current point on an ellipse of the given radii; `stAng` names that point.
 * Radii shrink by half the uniform stroke because the path is the stroke's centre line.
 */
function buildRoundedPath(radii: Extract<Geometry, { preset: 'custom' }>['radii'], frame: Frame, strokeHalf: number): XmlNode {
  const r = (radius: CornerRadius): CornerRadius => ({ x: Math.max(0, radius.x - strokeHalf), y: Math.max(0, radius.y - strokeHalf) });
  const tl = r(radii.tl);
  const tr = r(radii.tr);
  const br = r(radii.br);
  const bl = r(radii.bl);
  const W = pxToEmu(frame.w);
  const H = pxToEmu(frame.h);
  const pt = (x: number, y: number): XmlNode => el('a:pt', { x: Math.round(x), y: Math.round(y) });
  const arc = (radius: CornerRadius, stAng: number): XmlNode | undefined =>
    radius.x > 0 && radius.y > 0 ? el('a:arcTo', { wR: pxToEmu(radius.x), hR: pxToEmu(radius.y), stAng, swAng: 5400000 }) : undefined;
  const path = el(
    'a:path',
    { w: W, h: H },
    el('a:moveTo', {}, pt(pxToEmu(tl.x), 0)),
    el('a:lnTo', {}, pt(W - pxToEmu(tr.x), 0)),
    arc(tr, 16200000),
    el('a:lnTo', {}, pt(W, H - pxToEmu(br.y))),
    arc(br, 0),
    el('a:lnTo', {}, pt(pxToEmu(bl.x), H)),
    arc(bl, 5400000),
    el('a:lnTo', {}, pt(0, pxToEmu(tl.y))),
    arc(tl, 10800000),
    el('a:close'),
  );
  return el('a:custGeom', {}, el('a:avLst'), el('a:gdLst'), el('a:ahLst'), el('a:cxnLst'), el('a:rect', { l: 0, t: 0, r: 'r', b: 'b' }), el('a:pathLst', {}, path));
}

function buildFill(shape: ShapeElement, ctx: ShapeEmissionContext): XmlNode {
  const fill = shape.fill;
  if (!fill) {
    return el('a:noFill');
  }
  if (fill.type === 'solid') {
    return solidFillNode(fill.color);
  }
  if (fill.type === 'image') {
    return buildImageFill(fill, ctx);
  }
  const stops = el('a:gsLst', {}, withMidpoint(fill.stops).map((stop) => el('a:gs', { pos: Math.round(stop.position * 100000) }, colorNode(stop.color))));
  if (fill.kind === 'radial') {
    return el('a:gradFill', { rotWithShape: '1' }, stops, el('a:path', { path: 'circle' }, el('a:fillToRect', { l: 50000, t: 50000, r: 50000, b: 50000 })));
  }
  // CSS: 0deg = to top, clockwise. DrawingML: 0 = to right, clockwise, in 60000ths of a degree.
  const ang = (((fill.angle - 90) % 360) + 360) % 360;
  return el('a:gradFill', { rotWithShape: '1' }, stops, el('a:lin', { ang: Math.round(ang * 60000), scaled: '0' }));
}

/**
 * `a:blipFill` on a shape: a stretched image with its crop (negative values leave a margin), or tiles from the
 * given offset. `a:tile` scales against the image's natural size, which PowerPoint reads at 96 DPI when the
 * file carries no density, matching CSS px; a JPEG tagged 72 DPI tiles 4/3 larger than Chromium painted it.
 */
function buildImageFill(fill: ImageFill, ctx: ShapeEmissionContext): XmlNode {
  const embed = relateMedia(fill.media, ctx);
  const blip = el('a:blip', { 'r:embed': embed }, fill.opacity === undefined ? undefined : el('a:alphaModFix', { amt: Math.round(fill.opacity * 100000) }));
  if ('tile' in fill) {
    const { x, y, scaleX, scaleY } = fill.tile;
    return el('a:blipFill', {}, blip, el('a:tile', { tx: pxToEmu(x), ty: pxToEmu(y), sx: pct(scaleX), sy: pct(scaleY), flip: 'none', algn: 'tl' }));
  }
  const { l, t, r, b } = fill.crop;
  const srcRect = l || t || r || b ? el('a:srcRect', { l: pct(l), t: pct(t), r: pct(r), b: pct(b) }) : undefined;
  return el('a:blipFill', {}, blip, srcRect, el('a:stretch', {}, el('a:fillRect')));
}

function pct(fraction: number): number {
  return Math.round(fraction * 100000);
}

/**
 * PowerPoint for Mac renders a gradient with exactly two stops in the wrong colours (measured: `f59e0b -> b45309`
 * came out `ea5900 -> 791700`); with a third stop it matches Chromium within 1/255. Interpolating the midpoint
 * in sRGB, as CSS does, changes nothing visually.
 */
function withMidpoint(stops: GradientStop[]): GradientStop[] {
  if (stops.length !== 2) {
    return stops;
  }
  const [a, b] = stops as [GradientStop, GradientStop];
  const channel = (offset: number): string =>
    Math.round((parseInt(a.color.hex.slice(offset, offset + 2), 16) + parseInt(b.color.hex.slice(offset, offset + 2), 16)) / 2)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  const mid: GradientStop = {
    position: (a.position + b.position) / 2,
    color: { hex: `${channel(0)}${channel(2)}${channel(4)}`, alpha: (a.color.alpha + b.color.alpha) / 2 },
  };
  return [a, mid, b];
}

function buildLine(line: Line | undefined): XmlNode {
  if (!line) {
    return el('a:ln', {}, el('a:noFill'));
  }
  const children: XmlNode[] = [solidFillNode(line.color)];
  if (line.dash === 'dash') {
    children.push(el('a:prstDash', { val: 'dash' }));
  } else if (line.dash === 'dot') {
    children.push(el('a:prstDash', { val: 'sysDot' }));
  }
  return el('a:ln', { w: pxToEmu(line.width) }, children);
}

function buildText(text: TextBody, shape: ShapeElement, ctx: ShapeEmissionContext, guard: GuardPlan): XmlNode {
  const stroke = strokeInsets(shape);
  const firstParagraph = text.paragraphs[0];
  const baseline = firstParagraph ? baselineCorrectionPx(firstParagraph) : 0;
  const bodyPrAttrs: Record<string, string | number | undefined> = {
    wrap: text.wrap ? 'square' : 'none',
    anchor: 't',
    vert: 'horz',
    rtl: text.rtl ? '1' : undefined,
    lIns: pxToEmu(text.padding.l + stroke.l - guard.insetL),
    rIns: pxToEmu(text.padding.r + stroke.r - guard.insetR),
    tIns: pxToEmu(text.padding.t + stroke.t + text.firstParagraphGap - baseline),
    bIns: pxToEmu(text.padding.b + stroke.b + text.lastParagraphGap),
  };
  return buildTextBody(text, ctx, bodyPrAttrs);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
