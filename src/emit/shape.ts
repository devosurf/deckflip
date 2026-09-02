import type { ShapeElement, TextBody } from '../model/index.js';
import { pxToEmu } from '../ooxml/emu.js';
import { el, type XmlNode } from '../ooxml/xml.js';
import { baselineCorrectionPx, buildTextBody, solidFillNode, type TextEmissionContext } from './text.js';

export interface ShapeEmissionContext extends TextEmissionContext {}

export function buildShape(shape: ShapeElement, ctx: ShapeEmissionContext, shapeId: number): XmlNode {
  const guard = planGuard(shape);
  const xfrm = buildTransform(shape, guard);
  const geometry = buildGeometry(shape);
  const fill = buildFill(shape);
  const line = buildLine(shape);
  const text = shape.text ? buildText(shape.text, shape, ctx, guard) : undefined;

  return el(
    'p:sp',
    {},
    el(
      'p:nvSpPr',
      {},
      el('p:cNvPr', { id: shapeId, name: shape.name }),
      el('p:cNvSpPr', shape.text && !shape.fill && !shape.line ? { txBox: '1' } : {}),
      el('p:nvPr'),
    ),
    el('p:spPr', {}, xfrm, geometry, fill, line),
    text,
  );
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
  if (!text || text.trailingGuard <= 0) {
    return plan;
  }
  const lineInset = shape.line ? shape.line.width / 2 : 0;
  const align = text.paragraphs[0]?.align;
  const wantL = align === 'ctr' ? text.trailingGuard / 2 : align === 'r' || text.rtl ? text.trailingGuard : 0;
  const wantR = text.trailingGuard - wantL;
  plan.insetL = Math.min(wantL, text.padding.l + lineInset);
  plan.insetR = Math.min(wantR, text.padding.r + lineInset);
  plan.shift = wantL - plan.insetL;
  plan.widen = plan.shift + (wantR - plan.insetR);
  return plan;
}

function buildTransform(shape: ShapeElement, guard: GuardPlan): XmlNode {
  const strokeInset = shape.line ? shape.line.width / 2 : 0;
  const x = shape.box.x + strokeInset;
  const y = shape.box.y + strokeInset;
  const w = Math.max(0, shape.box.w - (shape.line?.width ?? 0));
  const h = Math.max(0, shape.box.h - (shape.line?.width ?? 0));

  return el(
    'a:xfrm',
    { rot: Math.round(shape.rotation * 60000) },
    el('a:off', { x: pxToEmu(x - guard.shift), y: pxToEmu(y) }),
    el('a:ext', { cx: pxToEmu(w + guard.widen), cy: pxToEmu(h) }),
  );
}

function buildGeometry(shape: ShapeElement): XmlNode {
  if (shape.geometry.preset === 'ellipse') {
    return el('a:prstGeom', { prst: 'ellipse' }, el('a:avLst'));
  }
  if (shape.geometry.preset === 'roundRect') {
    const minSide = Math.min(shape.box.w, shape.box.h);
    const adj = minSide > 0 ? clamp(Math.round((shape.geometry.radius / (minSide / 2)) * 50000), 0, 50000) : 0;
    return el('a:prstGeom', { prst: 'roundRect' }, el('a:avLst', {}, el('a:gd', { name: 'adj', fmla: `val ${adj}` })));
  }
  return el('a:prstGeom', { prst: 'rect' }, el('a:avLst'));
}

function buildFill(shape: ShapeElement): XmlNode {
  if (!shape.fill) {
    return el('a:noFill');
  }
  return solidFillNode(shape.fill.color);
}

function buildLine(shape: ShapeElement): XmlNode {
  if (!shape.line) {
    return el('a:ln', {}, el('a:noFill'));
  }
  const children: XmlNode[] = [solidFillNode(shape.line.color)];
  if (shape.line.dash === 'dash') {
    children.push(el('a:prstDash', { val: 'dash' }));
  } else if (shape.line.dash === 'dot') {
    children.push(el('a:prstDash', { val: 'sysDot' }));
  }
  return el('a:ln', { w: pxToEmu(shape.line.width) }, children);
}

function buildText(text: TextBody, shape: ShapeElement, ctx: ShapeEmissionContext, guard: GuardPlan): XmlNode {
  const lineInset = shape.line ? shape.line.width / 2 : 0;
  const firstParagraph = text.paragraphs[0];
  const baseline = firstParagraph ? baselineCorrectionPx(firstParagraph) : 0;
  const bodyPrAttrs: Record<string, string | number | undefined> = {
    wrap: text.wrap ? 'square' : 'none',
    anchor: 't',
    vert: 'horz',
    rtl: text.rtl ? '1' : undefined,
    lIns: pxToEmu(text.padding.l + lineInset - guard.insetL),
    rIns: pxToEmu(text.padding.r + lineInset - guard.insetR),
    tIns: pxToEmu(text.padding.t + lineInset + text.firstParagraphGap - baseline),
    bIns: pxToEmu(text.padding.b + lineInset + text.lastParagraphGap),
  };
  return buildTextBody(text, ctx, bodyPrAttrs);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
