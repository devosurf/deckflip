// `p:txBody` / `a:txBody` -> TextBody: the inverse of emit/text.ts. Insets become padding (the emitter folded
// paragraph gaps, stroke and baseline correction into them; the parser cannot tell those apart), spacing comes
// back from `spcPts`, and bullets, run properties and hyperlinks map one to one.

import type { AutonumScheme, Bullet, Color, Paragraph, Run, RunStyle, TextBody } from '../model/index.js';
import type { XmlNode } from '../ooxml/xml.js';
import { readColor, type ColorScheme, type FontScheme } from './drawing.js';
import { ptHundredthsToPx, px, exact } from './units.js';
import { child, children, textOf } from './xml.js';

/** Where hyperlinks resolve: an external URL, or the `#<slide id>` of a slide relationship. */
export interface TextContext {
  colors: ColorScheme;
  fonts: FontScheme;
  link(rId: string): string | undefined;
}

/** PowerPoint's defaults when `a:bodyPr` or `a:tcPr` omits an inset (EMU). */
export const DEFAULT_INSET = { l: '91440', t: '45720', r: '91440', b: '45720' };
const DEFAULT_SIZE_PX = 24;
const DEFAULT_COLOR: Color = { hex: '000000', alpha: 1 };

export function readTextBody(txBody: XmlNode | undefined, ctx: TextContext): TextBody | undefined {
  if (!txBody) {
    return undefined;
  }
  const bodyPr = child(txBody, 'a:bodyPr');
  const paragraphs = children(txBody, 'a:p').map((p) => readParagraph(p, ctx));
  return {
    padding: {
      l: px(bodyPr?.attrs.lIns ?? DEFAULT_INSET.l),
      t: px(bodyPr?.attrs.tIns ?? DEFAULT_INSET.t),
      r: px(bodyPr?.attrs.rIns ?? DEFAULT_INSET.r),
      b: px(bodyPr?.attrs.bIns ?? DEFAULT_INSET.b),
    },
    firstParagraphGap: 0,
    lastParagraphGap: 0,
    wrap: bodyPr?.attrs.wrap !== 'none',
    rtl: bodyPr?.attrs.rtl === '1',
    trailingGuard: 0,
    paragraphs,
  };
}

function readParagraph(p: XmlNode, ctx: TextContext): Paragraph {
  const pPr = child(p, 'a:pPr');
  const runs: Run[] = [];
  for (const node of children(p)) {
    if (node.name === 'a:r') {
      runs.push({ kind: 'text', text: textOf(child(node, 'a:t')), style: readRunStyle(child(node, 'a:rPr'), ctx) });
    } else if (node.name === 'a:br') {
      runs.push({ kind: 'break' });
    }
  }
  const firstStyle = runs.find((run): run is Extract<Run, { kind: 'text' }> => run.kind === 'text')?.style;
  const size = firstStyle?.size ?? (ptHundredthsToPx(child(p, 'a:endParaRPr')?.attrs.sz) || DEFAULT_SIZE_PX);
  const align = pPr?.attrs.algn;
  const paragraph: Paragraph = {
    align: align === 'ctr' || align === 'r' || align === 'just' ? align : 'l',
    lineHeight: readSpacing(child(pPr, 'a:lnSpc'), size) ?? exact(size * 1.2),
    spaceBefore: readSpacing(child(pPr, 'a:spcBef'), size) ?? 0,
    spaceAfter: readSpacing(child(pPr, 'a:spcAft'), size) ?? 0,
    indent: px(pPr?.attrs.indent),
    marginLeft: px(pPr?.attrs.marL),
    level: Number(pPr?.attrs.lvl ?? 0),
    runs,
  };
  const bullet = readBullet(pPr, firstStyle?.color ?? DEFAULT_COLOR, ctx.colors);
  if (bullet) {
    paragraph.bullet = bullet;
  }
  return paragraph;
}

/** `a:spcPts` in px, or `a:spcPct` as a fraction of the font size's 1.2 line (PowerPoint's single spacing). */
function readSpacing(node: XmlNode | undefined, sizePx: number): number | undefined {
  const pts = child(node, 'a:spcPts');
  if (pts) {
    return ptHundredthsToPx(pts.attrs.val);
  }
  const pct = child(node, 'a:spcPct');
  if (pct) {
    return exact((Number(pct.attrs.val ?? 100000) / 100000) * sizePx * 1.2);
  }
  return undefined;
}

const AUTONUM_SCHEMES = new Set(['arabicPeriod', 'alphaLcPeriod', 'alphaUcPeriod', 'romanLcPeriod', 'romanUcPeriod']);

function readBullet(pPr: XmlNode | undefined, runColor: Color, colors: ColorScheme): Bullet | undefined {
  if (child(pPr, 'a:buNone')) {
    return { type: 'none' };
  }
  const color = readColor(child(pPr, 'a:buClr'), colors) ?? runColor;
  const sizePct = Number(child(pPr, 'a:buSzPct')?.attrs.val ?? 100000) / 1000;
  const char = child(pPr, 'a:buChar');
  if (char) {
    return { type: 'char', char: char.attrs.char ?? '\u2022', color, sizePct };
  }
  const autonum = child(pPr, 'a:buAutoNum');
  if (autonum) {
    const type = autonum.attrs.type ?? '';
    const scheme: AutonumScheme = AUTONUM_SCHEMES.has(type) ? (type as AutonumScheme) : 'arabicPeriod';
    return { type: 'autonum', scheme, startAt: Number(autonum.attrs.startAt ?? 1), color, sizePct };
  }
  return undefined;
}

export function readRunStyle(rPr: XmlNode | undefined, ctx: TextContext): RunStyle {
  const bold = rPr?.attrs.b === '1' || rPr?.attrs.b === 'true';
  const typeface = child(rPr, 'a:latin')?.attrs.typeface;
  const style: RunStyle = {
    fontStack: [resolveTypeface(typeface, ctx.fonts)],
    weight: bold ? 700 : 400,
    size: rPr?.attrs.sz === undefined ? DEFAULT_SIZE_PX : ptHundredthsToPx(rPr.attrs.sz),
    bold,
    italic: rPr?.attrs.i === '1' || rPr?.attrs.i === 'true',
    underline: rPr?.attrs.u !== undefined && rPr.attrs.u !== 'none',
    strike: rPr?.attrs.strike !== undefined && rPr.attrs.strike !== 'noStrike',
    color: readColor(child(rPr, 'a:solidFill'), ctx.colors) ?? DEFAULT_COLOR,
    letterSpacing: ptHundredthsToPx(rPr?.attrs.spc),
    caps: rPr?.attrs.cap === 'small' ? 'small' : 'none',
    baseline: Number(rPr?.attrs.baseline ?? 0),
  };
  const highlight = readColor(child(rPr, 'a:highlight'), ctx.colors);
  if (highlight) {
    style.highlight = highlight;
  }
  const hlink = child(rPr, 'a:hlinkClick');
  const link = hlink?.attrs['r:id'] ? ctx.link(hlink.attrs['r:id']) : undefined;
  if (link) {
    style.link = link;
  }
  return style;
}

/** `+mj-lt`/`+mn-lt` and an absent typeface resolve through the theme (spec 11: inheritance resolved to explicit values). */
function resolveTypeface(typeface: string | undefined, fonts: FontScheme): string {
  if (typeface === undefined || typeface === '' || typeface.startsWith('+mn')) return fonts.minor;
  if (typeface.startsWith('+mj')) return fonts.major;
  return typeface;
}
