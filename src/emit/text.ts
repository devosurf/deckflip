import path from 'node:path';
import type { Bullet, Color, Paragraph, RunStyle, TextBody } from '../model/index.js';
import { pxToEmu, pxToHundredthsPt } from '../ooxml/emu.js';
import { el, type XmlNode } from '../ooxml/xml.js';
import { REL } from '../ooxml/opc.js';

export interface RelationshipAdder {
  (type: string, target: string, opts?: { external?: boolean }): string;
}

export interface TextEmissionContext {
  deckLang: string;
  sourceSlidePart: string;
  slidePartById: Map<string, string>;
  addRelationship: RelationshipAdder;
}

export function firstTextRunStyle(paragraph: Paragraph): RunStyle | undefined {
  for (const run of paragraph.runs) {
    if (run.kind === 'text') {
      return run.style;
    }
  }
  return undefined;
}

/**
 * First-line baseline correction, CSS px, subtracted from `tIns`.
 *
 * Chromium puts the first baseline at `(L - (A + D)) / 2 + A` below the line-box top, with `A`/`D` the hhea
 * ascender/descender rounded to whole px (Chromium's SimpleFontData rounds them). PowerPoint with exact
 * spacing (`spcPts` = L) puts it at `0.7276 * L + 0.0539 * f + 0.87`, independent of the font: a least-squares
 * fit over 35 (f, L) pairs x Arial/Georgia/Times New Roman/Verdana measured against PowerPoint for Mac 16
 * (rms 1.07 px; the spike's `L * asc / (asc + desc)` model gives 2.89 px, no correction 5.88 px).
 * See docs/spec/04-text-mapping.md.
 */
export function baselineCorrectionPx(paragraph: Paragraph): number {
  const style = firstTextRunStyle(paragraph);
  if (!style?.font) {
    return 0;
  }
  const L = paragraph.lineHeight;
  const f = style.size;
  const A = Math.round(style.font.metrics.ascender * f);
  const D = Math.round(style.font.metrics.descender * f);
  const chromiumBaseline = (L - (A + D)) / 2 + A;
  const powerpointBaseline = 0.7276 * L + 0.0539 * f + 0.87;
  return powerpointBaseline - chromiumBaseline;
}

/** `p:txBody` for shapes; table cells pass `a:txBody`. */
export function buildTextBody(text: TextBody, ctx: TextEmissionContext, bodyPrAttrs: Record<string, string | number | undefined>, elementName: 'p:txBody' | 'a:txBody' = 'p:txBody'): XmlNode {
  let previousTextStyle: RunStyle | undefined;
  const paragraphs = text.paragraphs.map((paragraph) => {
    const firstStyle = firstTextRunStyle(paragraph);
    const paragraphNodes: XmlNode[] = [
      el(
        'a:pPr',
        {
          marL: pxToEmu(paragraph.marginLeft),
          algn: paragraph.align,
          lvl: paragraph.level,
          indent: pxToEmu(paragraph.indent),
        },
        el('a:lnSpc', {}, el('a:spcPts', { val: pxToHundredthsPt(paragraph.lineHeight) })),
        paragraph.spaceBefore > 0 ? el('a:spcBef', {}, el('a:spcPts', { val: pxToHundredthsPt(paragraph.spaceBefore) })) : undefined,
        paragraph.spaceAfter > 0 ? el('a:spcAft', {}, el('a:spcPts', { val: pxToHundredthsPt(paragraph.spaceAfter) })) : undefined,
        ...buildBulletNodes(paragraph.bullet),
      ),
    ];

    if (!paragraph.runs.some((run) => run.kind === 'text')) {
      const style = previousTextStyle ?? firstStyle;
      const size = style?.size ?? paragraph.lineHeight;
      paragraphNodes.push(buildEndParaRPr(size, ctx.deckLang));
      return el('a:p', {}, paragraphNodes);
    }

    for (const run of paragraph.runs) {
      if (run.kind === 'break') {
        const style = previousTextStyle ?? firstStyle;
        paragraphNodes.push(el('a:br', {}, buildRunProperties(style, ctx)));
        continue;
      }
      paragraphNodes.push(
        el(
          'a:r',
          {},
          buildRunProperties(run.style, ctx),
          el('a:t', { 'xml:space': 'preserve' }, run.text),
        ),
      );
      previousTextStyle = run.style;
    }

    if (!previousTextStyle && firstStyle) {
      previousTextStyle = firstStyle;
    }

    return el('a:p', {}, paragraphNodes);
  });

  return el(
    elementName,
    {},
    el('a:bodyPr', bodyPrAttrs),
    el('a:lstStyle'),
    ...paragraphs,
  );
}

/** CT_TextParagraphProperties order after spacing: buClr, buSzPct, buFontTx, then buNone | buAutoNum | buChar. */
function buildBulletNodes(bullet: Bullet | undefined): XmlNode[] {
  if (!bullet) {
    return [];
  }
  if (bullet.type === 'none') {
    return [el('a:buNone')];
  }
  const nodes: XmlNode[] = [el('a:buClr', {}, colorNode(bullet.color))];
  if (bullet.sizePct !== 100) {
    nodes.push(el('a:buSzPct', { val: Math.round(bullet.sizePct * 1000) }));
  }
  nodes.push(el('a:buFontTx'));
  nodes.push(bullet.type === 'char' ? el('a:buChar', { char: bullet.char }) : el('a:buAutoNum', { type: bullet.scheme, startAt: bullet.startAt === 1 ? undefined : bullet.startAt }));
  return nodes;
}

export function buildRunProperties(style: RunStyle | undefined, ctx: TextEmissionContext): XmlNode {
  const effectiveStyle = style ?? fallbackStyle();
  const typeface = effectiveTypeface(effectiveStyle);
  const attrs: Record<string, string | number> = {
    lang: ctx.deckLang,
    sz: pxToHundredthsPt(effectiveStyle.size),
  };
  if (effectiveStyle.bold) {
    attrs.b = 1;
  }
  if (effectiveStyle.italic) {
    attrs.i = 1;
  }
  if (effectiveStyle.underline) {
    attrs.u = 'sng';
  }
  if (effectiveStyle.strike) {
    attrs.strike = 'sngStrike';
  }
  if (effectiveStyle.caps === 'small') {
    attrs.cap = 'small';
  }
  attrs.baseline = effectiveStyle.baseline;
  if (effectiveStyle.letterSpacing !== 0) {
    attrs.spc = pxToHundredthsPt(effectiveStyle.letterSpacing);
  }

  const children: XmlNode[] = [solidFillNode(effectiveStyle.color)];
  if (effectiveStyle.highlight) {
    children.push(el('a:highlight', {}, colorNode(effectiveStyle.highlight)));
  }
  children.push(el('a:latin', { typeface }), el('a:ea', { typeface }), el('a:cs', { typeface }));

  if (effectiveStyle.link) {
    const hyperlink = buildHyperlink(effectiveStyle.link, ctx);
    if (hyperlink) {
      children.push(hyperlink);
    }
  }

  return el('a:rPr', attrs, children);
}

export function buildEndParaRPr(sizePx: number, deckLang: string): XmlNode {
  return el('a:endParaRPr', { lang: deckLang, sz: pxToHundredthsPt(sizePx) });
}

export function effectiveTypeface(style: RunStyle): string {
  return style.font?.family ?? style.fontStack[0] ?? 'Arial';
}

export function colorNode(color: Color): XmlNode {
  return el('a:srgbClr', { val: color.hex }, color.alpha < 1 ? el('a:alpha', { val: Math.round(color.alpha * 100000) }) : undefined);
}

export function solidFillNode(color: Color): XmlNode {
  return el('a:solidFill', {}, colorNode(color));
}

function buildHyperlink(link: string, ctx: TextEmissionContext): XmlNode | undefined {
  if (link.startsWith('#')) {
    const slideId = link.slice(1);
    const targetPart = ctx.slidePartById.get(slideId);
    if (!targetPart) {
      // Unreachable after measure: an unknown target is VALIDATE_LINK_TARGET and stops conversion before emit.
      throw new Error(`Unknown slide link target ${link}`);
    }
    // A slide jump is an internal relationship of type `slide`; PowerPoint repairs a `hyperlink` relationship pointing at a part.
    const target = path.posix.relative(path.posix.dirname(ctx.sourceSlidePart), targetPart);
    const rId = ctx.addRelationship(REL.slide, target);
    return el('a:hlinkClick', { 'r:id': rId, action: 'ppaction://hlinksldjump' });
  }
  const rId = ctx.addRelationship(REL.hyperlink, link, { external: true });
  return el('a:hlinkClick', { 'r:id': rId });
}

function fallbackStyle(): RunStyle {
  return {
    fontStack: ['Arial'],
    weight: 400,
    size: 12,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: { hex: '000000', alpha: 1 },
    letterSpacing: 0,
    caps: 'none',
    baseline: 0,
  };
}
