// TextBody -> the inside of a text block, written the way html/browser-script.ts measures it back: one plain
// block is one paragraph (`<br>` for breaks), bulleted paragraphs are `li`s of nested `ul`/`ol`, runs are
// `span`s carrying one class per distinct RunStyle. Distinct styles go to the deck stylesheet (spec 02).

import type { Bullet, Paragraph, Run, RunStyle, TextBody } from '../model/index.js';
import { baselineCorrectionPx } from '../emit/text.js';
import { attr, text as escape } from './escape.js';
import { color, layoutPx, pxv } from './css.js';

/**
 * Per-deck text context: collects `.tN` run classes and `.mN::marker` bullet classes (`rules()` is the
 * stylesheet fragment) and resolves slide jumps to the section ids written.
 */
export class Stylesheet {
  private readonly classes = new Map<string, string>();
  private readonly order: string[] = [];

  constructor(private readonly slideIds: ReadonlyMap<string, string> = new Map()) {}

  classFor(prefix: string, declarations: string, pseudo = ''): string {
    const key = `${prefix}${pseudo}|${declarations}`;
    let name = this.classes.get(key);
    if (name === undefined) {
      name = `${prefix}${this.order.length + 1}`;
      this.classes.set(key, name);
      this.order.push(`.${name}${pseudo} { ${declarations} }`);
    }
    return name;
  }

  /** `#<slide id>` -> `#<section id>`; external links unchanged. */
  href(link: string): string {
    return link.startsWith('#') ? `#${this.slideIds.get(link.slice(1)) ?? link.slice(1)}` : link;
  }

  rules(): string[] {
    return this.order;
  }
}

/** The element that owns a text body; for `ul`/`ol` shapes the list is the element itself. */
export interface TextRoot {
  tag: string;
  attrs: string;
  /** box, decoration and `textBlockCss` declarations */
  css: string[];
}

const ALIGN: Record<Paragraph['align'], string> = { l: 'left', ctr: 'center', r: 'right', just: 'justify' };

/**
 * Block-level declarations for the element that owns the body. PowerPoint's first baseline sits lower than
 * Chromium's by the emit-side correction (spec 04); the parser kept the corrected inset, so the top padding
 * grows back by the same amount (zero until fonts are resolved on the deck).
 */
export function textBlockCss(text: TextBody): string[] {
  const first = text.paragraphs[0] && layoutParagraph(text.paragraphs[0]);
  const top = text.padding.t + text.firstParagraphGap + (first ? baselineCorrectionPx(first) : 0);
  const out = [`padding: ${pxv(top)} ${pxv(text.padding.r)} ${pxv(text.padding.b + text.lastParagraphGap)} ${pxv(text.padding.l)}`];
  if (!text.wrap) {
    out.push('white-space: nowrap');
  }
  if (text.rtl) {
    out.push('direction: rtl');
  }
  if (first) {
    out.push(`text-align: ${ALIGN[first.align]}`, `line-height: ${pxv(first.lineHeight)}`);
    const style = firstStyle(first);
    if (style) {
      out.push(`font-family: ${fontFamily(style)}`, `font-size: ${pxv(style.size)}`);
    }
    if (!first.bullet && first.indent !== 0) {
      out.push(`text-indent: ${pxv(first.indent)}`);
    }
  }
  return out;
}

/** The paragraph with its line box height and gap on the layout grid, as Chromium will measure them again. */
export function layoutParagraph(paragraph: Paragraph): Paragraph {
  return { ...paragraph, lineHeight: layoutPx(paragraph.lineHeight), spaceBefore: layoutPx(paragraph.spaceBefore) };
}

/** The body as HTML: a plain paragraph's runs inside `root`, bullets as nested lists (the root itself when it is a list), otherwise `p` blocks and lists in sequence. */
export function textBodyHtml(text: TextBody, root: TextRoot, sheet: Stylesheet): string {
  const paragraphs = text.paragraphs;
  if ((root.tag === 'ul' || root.tag === 'ol') && paragraphs.every((paragraph) => paragraph.bullet)) {
    return listHtml(paragraphs, 0, 0, sheet, root).html;
  }
  if (paragraphs.length === 1 && !paragraphs[0]!.bullet) {
    return wrap(root, runsHtml(paragraphs[0]!.runs, sheet));
  }
  // the measurer reads each block's gap to the previous one as `spaceBefore` and its offset as `marginLeft`;
  // a block's own font sets its strut; a run of bulleted paragraphs is one list
  let html = '';
  for (let index = 0; index < paragraphs.length; ) {
    const paragraph = paragraphs[index]!;
    if (paragraph.bullet) {
      const list = listHtml(paragraphs, index, paragraph.level, sheet);
      html += list.html;
      index = list.next;
      continue;
    }
    const style = firstStyle(paragraph);
    const css = [`margin: ${pxv(layoutPx(paragraph.spaceBefore))} 0 0 ${pxv(paragraph.marginLeft)}`, `line-height: ${pxv(layoutPx(paragraph.lineHeight))}`, `text-align: ${ALIGN[paragraph.align]}`];
    if (style) {
      css.push(`font-family: ${fontFamily(style)}`, `font-size: ${pxv(style.size)}`);
    }
    html += `<p style="${css.join('; ')}">${runsHtml(paragraph.runs, sheet)}</p>`;
    index += 1;
  }
  return wrap(root, html);
}

function wrap(root: TextRoot, inner: string): string {
  return `<${root.tag}${root.attrs} style="${root.css.join('; ')}">${inner}</${root.tag}>`;
}

export function runsHtml(runs: Run[], sheet: Stylesheet): string {
  let html = '';
  for (const run of runs) {
    if (run.kind === 'break') {
      html += '<br>';
      continue;
    }
    const span = `<span class="${sheet.classFor('t', runCss(run.style))}">${escape(run.text)}</span>`;
    html += run.style.link ? `<a href="${attr(sheet.href(run.style.link))}">${span}</a>` : span;
  }
  return html;
}

/**
 * Paragraphs from `from` at `level` as one list; returns where the run of this level ended. The measurer
 * reads a list's own left padding as every item's `marginLeft` (from the body's left edge), so a nested
 * list's padding is the difference to its parent item, and a root list's is the first item's `marginLeft`.
 */
function listHtml(paragraphs: Paragraph[], from: number, level: number, sheet: Stylesheet, root?: TextRoot): { html: string; next: number } {
  const first = paragraphs[from]!;
  const bullet = first.bullet!;
  const ordered = bullet.type === 'autonum';
  const tag = ordered ? 'ol' : 'ul';
  const parentMargin = level === 0 ? 0 : paragraphs[from - 1]!.marginLeft;
  const attrs = `${root?.attrs ?? ''}${ordered && bullet.startAt !== 1 ? ` start="${bullet.startAt}"` : ''}`;
  const css = root ? root.css.map((declaration) => (declaration.startsWith('padding: ') ? `${declaration.split(' ').slice(0, 4).join(' ')} ${pxv(first.marginLeft)}` : declaration)) : ['margin: 0', `padding: 0 0 0 ${pxv(first.marginLeft - parentMargin)}`];
  css.push(`list-style-type: ${listStyleType(bullet)}`);
  let html = `<${tag}${attrs} style="${css.join('; ')}">`;
  let index = from;
  while (index < paragraphs.length && paragraphs[index]!.level >= level) {
    const paragraph = layoutParagraph(paragraphs[index]!);
    if (paragraph.level > level) {
      // deeper items hang inside the previous item; close its `li` after them
      const nested = listHtml(paragraphs, index, paragraph.level, sheet);
      html = `${html.slice(0, -'</li>'.length)}${nested.html}</li>`;
      index = nested.next;
      continue;
    }
    const style = firstStyle(paragraph);
    const li = [`margin: ${pxv(paragraph.spaceBefore)} 0 0`, `line-height: ${pxv(paragraph.lineHeight)}`, `text-align: ${ALIGN[paragraph.align]}`];
    if (style) {
      li.push(`font-family: ${fontFamily(style)}`, `font-size: ${pxv(style.size)}`);
    }
    const marker = paragraph.bullet && paragraph.bullet.type !== 'none' ? ` class="${sheet.classFor('m', markerCss(paragraph.bullet, style), '::marker')}"` : '';
    html += `<li${marker} style="${li.join('; ')}">${runsHtml(paragraph.runs, sheet)}</li>`;
    index += 1;
  }
  return { html: `${html}</${tag}>`, next: index };
}

const CHAR_TYPES: Record<string, string> = { '\u2022': 'disc', '\u25E6': 'circle', '\u25AA': 'square' };
const SCHEME_TYPES = { arabicPeriod: 'decimal', alphaLcPeriod: 'lower-alpha', alphaUcPeriod: 'upper-alpha', romanLcPeriod: 'lower-roman', romanUcPeriod: 'upper-roman' } as const;

function listStyleType(bullet: Bullet): string {
  if (bullet.type === 'none') {
    return 'none';
  }
  if (bullet.type === 'autonum') {
    return SCHEME_TYPES[bullet.scheme];
  }
  return CHAR_TYPES[bullet.char] ?? `"${bullet.char.replace(/"/g, '\\"')}"`;
}

function markerCss(bullet: Exclude<Bullet, { type: 'none' }>, style: RunStyle | undefined): string {
  const out = [`color: ${color(bullet.color)}`];
  if (style && bullet.sizePct !== 100) {
    out.push(`font-size: ${pxv((style.size * bullet.sizePct) / 100)}`);
  }
  return out.join('; ');
}

export function firstStyle(paragraph: Paragraph): RunStyle | undefined {
  for (const run of paragraph.runs) {
    if (run.kind === 'text') {
      return run.style;
    }
  }
  return undefined;
}

/** Families quoted with single quotes, since the declarations end up inside `style="..."`. */
export function fontFamily(style: RunStyle): string {
  const stack = style.fontStack.length > 0 ? style.fontStack : ['Arial'];
  return stack.map((family) => (/^[A-Za-z-]+$/.test(family) ? family : `'${family.replace(/'/g, "\\'")}'`)).join(', ');
}

/**
 * One class per distinct RunStyle. `line-height: 0` makes the run's inline box zero-height, so the block's
 * strut alone sets the line box: the IDM keeps one measured line height per paragraph and no per-run
 * line-height, and a taller run would otherwise grow the line beyond it.
 */
export function runCss(style: RunStyle): string {
  const out = ['line-height: 0', `font-family: ${fontFamily(style)}`, `font-weight: ${style.weight}`, `font-size: ${pxv(style.size)}`, `color: ${color(style.color)}`, `font-style: ${style.italic ? 'italic' : 'normal'}`];
  const decoration = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  out.push(`text-decoration: ${decoration || 'none'}`);
  if (style.letterSpacing !== 0) {
    out.push(`letter-spacing: ${pxv(style.letterSpacing)}`);
  }
  if (style.caps === 'small') {
    out.push('font-variant-caps: small-caps');
  }
  if (style.baseline > 0) {
    out.push('vertical-align: super');
  } else if (style.baseline < 0) {
    out.push('vertical-align: sub');
  }
  if (style.highlight) {
    out.push(`background-color: ${color(style.highlight)}`);
  }
  return out.join('; ');
}
