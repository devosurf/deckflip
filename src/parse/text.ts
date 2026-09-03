// `p:txBody` / `a:txBody` -> TextBody: the inverse of emit/text.ts. Insets become padding (the emitter folded
// paragraph gaps, stroke and baseline correction into them; the parser cannot tell those apart), spacing comes
// back from `spcPts`, and bullets, run properties and hyperlinks map one to one.

import type { AutonumScheme, Bullet, Color, Paragraph, Run, RunStyle, TextBody } from '../model/index.js';
import type { XmlNode } from '../ooxml/xml.js';
import { readColor, type ColorScheme, type FontScheme } from './drawing.js';
import { ptHundredthsToPx, px, exact } from './units.js';
import { child, children, textOf } from './xml.js';

/** Where hyperlinks resolve, and what the text inherits when it says nothing itself (parse/inherit.ts). */
export interface TextContext {
  colors: ColorScheme;
  fonts: FontScheme;
  link(rId: string): string | undefined;
  /** `a:lvl<N+1>pPr` nodes to fall back on, nearest first; absent for text that inherits nothing */
  levelStyles?(level: number): XmlNode[];
}

/** The first node in the chain that carries `name`, which is how DrawingML inheritance resolves. */
function attrOf(chain: XmlNode[], name: string): string | undefined {
  for (const node of chain) {
    const value = node.attrs[name];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function childOf(chain: XmlNode[], name: string): XmlNode | undefined {
  for (const node of chain) {
    const found = child(node, name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function defined(nodes: Array<XmlNode | undefined>): XmlNode[] {
  return nodes.filter((node): node is XmlNode => node !== undefined);
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
  // the shape's own list style comes before anything the layout, the master or the theme says
  const own = child(txBody, 'a:lstStyle');
  const levelStyles = (level: number): XmlNode[] => defined([child(own, `a:lvl${Math.min(level, 8) + 1}pPr`), ...(ctx.levelStyles?.(level) ?? [])]);
  const paragraphs = children(txBody, 'a:p').map((p) => readParagraph(p, { ...ctx, levelStyles }));
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
  const level = Number(pPr?.attrs.lvl ?? 0);
  const chain = defined([pPr, ...(ctx.levelStyles?.(level) ?? [])]);
  const runDefaults = defined(chain.map((node) => child(node, 'a:defRPr')));
  const runs: Run[] = [];
  for (const node of children(p)) {
    if (node.name === 'a:r') {
      runs.push({ kind: 'text', text: textOf(child(node, 'a:t')), style: readRunStyle(defined([child(node, 'a:rPr'), ...runDefaults]), ctx) });
    } else if (node.name === 'a:br') {
      runs.push({ kind: 'break' });
    }
  }
  const firstStyle = runs.find((run): run is Extract<Run, { kind: 'text' }> => run.kind === 'text')?.style;
  const size = firstStyle?.size ?? (ptHundredthsToPx(attrOf(defined([child(p, 'a:endParaRPr'), ...runDefaults]), 'sz')) || DEFAULT_SIZE_PX);
  const align = attrOf(chain, 'algn');
  const paragraph: Paragraph = {
    align: align === 'ctr' || align === 'r' || align === 'just' ? align : 'l',
    lineHeight: readSpacing(childOf(chain, 'a:lnSpc'), size) ?? exact(size * 1.2),
    spaceBefore: readSpacing(childOf(chain, 'a:spcBef'), size) ?? 0,
    spaceAfter: readSpacing(childOf(chain, 'a:spcAft'), size) ?? 0,
    indent: px(attrOf(chain, 'indent')),
    marginLeft: px(attrOf(chain, 'marL')),
    level,
    runs,
  };
  const bullet = readBullet(chain, firstStyle?.color ?? DEFAULT_COLOR, ctx.colors);
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

function readBullet(chain: XmlNode[], runColor: Color, colors: ColorScheme): Bullet | undefined {
  // the nearest of the four bullet elements wins: whichever node in the chain declares one decides
  const declaring = chain.find((node) => child(node, 'a:buNone') || child(node, 'a:buChar') || child(node, 'a:buAutoNum'));
  if (!declaring || child(declaring, 'a:buNone')) {
    return declaring ? { type: 'none' } : undefined;
  }
  const color = readColor(childOf(chain, 'a:buClr'), colors) ?? runColor;
  const sizePct = Number(childOf(chain, 'a:buSzPct')?.attrs.val ?? 100000) / 1000;
  const char = child(declaring, 'a:buChar');
  if (char) {
    return { type: 'char', char: char.attrs.char ?? '\u2022', color, sizePct };
  }
  const autonum = child(declaring, 'a:buAutoNum')!;
  const type = autonum.attrs.type ?? '';
  const scheme: AutonumScheme = AUTONUM_SCHEMES.has(type) ? (type as AutonumScheme) : 'arabicPeriod';
  return { type: 'autonum', scheme, startAt: Number(autonum.attrs.startAt ?? 1), color, sizePct };
}

export function readRunStyle(chain: XmlNode[], ctx: TextContext): RunStyle {
  const boldValue = attrOf(chain, 'b');
  const bold = boldValue === '1' || boldValue === 'true';
  const italicValue = attrOf(chain, 'i');
  const underline = attrOf(chain, 'u');
  const strike = attrOf(chain, 'strike');
  const size = attrOf(chain, 'sz');
  const style: RunStyle = {
    fontStack: [resolveTypeface(childOf(chain, 'a:latin')?.attrs.typeface, ctx.fonts)],
    weight: bold ? 700 : 400,
    size: size === undefined ? DEFAULT_SIZE_PX : ptHundredthsToPx(size),
    bold,
    italic: italicValue === '1' || italicValue === 'true',
    underline: underline !== undefined && underline !== 'none',
    strike: strike !== undefined && strike !== 'noStrike',
    color: readColor(childOf(chain, 'a:solidFill'), ctx.colors) ?? DEFAULT_COLOR,
    letterSpacing: ptHundredthsToPx(attrOf(chain, 'spc')),
    caps: attrOf(chain, 'cap') === 'small' ? 'small' : 'none',
    baseline: Number(attrOf(chain, 'baseline') ?? 0),
  };
  const highlight = readColor(childOf(chain, 'a:highlight'), ctx.colors);
  if (highlight) {
    style.highlight = highlight;
  }
  const hlink = childOf(chain, 'a:hlinkClick');
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
