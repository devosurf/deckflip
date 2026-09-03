// `aside.notes` -> `Slide.notes` (docs/spec/06-round-trip.md "Speaker notes"): the notes markup htmlout
// writes and an agent edits, read back structurally. The stylesheet hides notes, so no browser ever measures
// them: a notes run carries the emphasis and link its markup shows, and the notes master governs the rest.

import type { Paragraph, Run, RunStyle, TextBody } from '../model/index.js';
import { hasTextParagraphs } from '../model/notes.js';
import type { HtmlChild, HtmlNode } from '../roundtrip/fingerprint.js';

/** What emit leaves out for unmeasured text; the fields still have to hold something the IDM accepts. */
const NOTES_STYLE: RunStyle = {
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

const EMPHASIS: Record<string, Partial<RunStyle>> = {
  strong: { bold: true, weight: 700 },
  b: { bold: true, weight: 700 },
  em: { italic: true },
  i: { italic: true },
  u: { underline: true },
  ins: { underline: true },
  s: { strike: true },
  strike: { strike: true },
  del: { strike: true },
};

export function readNotes(section: HtmlNode): TextBody | undefined {
  const aside = section.children.find((child): child is HtmlNode => typeof child !== 'string' && isNotes(child));
  if (!aside) {
    return undefined;
  }
  const paragraphs: Paragraph[] = [];
  readBlocks(aside, 0, paragraphs);
  // an aside with no block of its own is one paragraph of whatever it holds
  if (paragraphs.length === 0) {
    paragraphs.push(paragraphOf(aside));
  }
  return hasTextParagraphs(paragraphs) ? body(paragraphs) : undefined;
}

const BLOCKS = new Set(['p', 'ul', 'ol', 'li']);
const BULLET_CHAR = ['\u2022', '\u25E6', '\u25AA'];

/** `p` is a paragraph, `ul`/`ol` items are bulleted paragraphs at their nesting level (spec 02 "Speaker notes"). */
function readBlocks(node: HtmlNode, level: number, out: Paragraph[]): void {
  for (const child of node.children) {
    if (typeof child === 'string' || !BLOCKS.has(child.tag)) {
      continue;
    }
    if (child.tag === 'ul' || child.tag === 'ol') {
      for (const item of child.children) {
        if (typeof item === 'string' || item.tag !== 'li') continue;
        const paragraph = paragraphOf(item);
        paragraph.level = level;
        paragraph.bullet = child.tag === 'ol'
          ? { type: 'autonum', scheme: 'arabicPeriod', startAt: Number(child.attrs.start ?? 1) || 1, color: NOTES_STYLE.color, sizePct: 100 }
          : { type: 'char', char: BULLET_CHAR[Math.min(level, BULLET_CHAR.length - 1)]!, color: NOTES_STYLE.color, sizePct: 100 };
        out.push(paragraph);
        // a nested list hangs inside its item, one level deeper
        readBlocks(item, level + 1, out);
      }
      continue;
    }
    out.push(paragraphOf(child));
  }
}

function isNotes(node: HtmlNode): boolean {
  return node.tag === 'aside' && (node.attrs.class ?? '').split(/\s+/).includes('notes');
}

function body(paragraphs: Paragraph[]): TextBody {
  return {
    padding: { l: 0, t: 0, r: 0, b: 0 },
    firstParagraphGap: 0,
    lastParagraphGap: 0,
    wrap: true,
    rtl: false,
    trailingGuard: 0,
    paragraphs,
  };
}

function paragraphOf(block: HtmlNode): Paragraph {
  const runs: Run[] = [];
  collect(block.children, NOTES_STYLE, runs);
  return { align: 'l', lineHeight: 0, spaceBefore: 0, spaceAfter: 0, indent: 0, marginLeft: 0, level: 0, runs: trimEdges(runs) };
}

/** Whitespace collapses the way the browser would render it, since the markup is authored, not measured. */
function collect(children: HtmlChild[], style: RunStyle, out: Run[]): void {
  for (const child of children) {
    if (typeof child === 'string') {
      const text = child.replace(/\s+/g, ' ');
      if (text !== '') {
        out.push({ kind: 'text', text, style });
      }
      continue;
    }
    if (child.tag === 'br') {
      out.push({ kind: 'break' });
      continue;
    }
    // blocks are paragraphs of their own (readBlocks), never runs of the block they hang in
    if (BLOCKS.has(child.tag)) {
      continue;
    }
    const href = child.tag === 'a' ? child.attrs.href : undefined;
    collect(child.children, { ...style, ...EMPHASIS[child.tag], ...(href === undefined ? {} : { link: href }) }, out);
  }
}

/** A block's own edges swallow whitespace, as do the edges of a line the author broke. */
function trimEdges(runs: Run[]): Run[] {
  const out = runs.map((run) => ({ ...run }));
  for (const [index, run] of out.entries()) {
    if (run.kind !== 'text') {
      continue;
    }
    const first = index === 0 || out[index - 1]!.kind === 'break';
    const last = index === out.length - 1 || out[index + 1]!.kind === 'break';
    if (first) run.text = run.text.replace(/^ /, '');
    if (last) run.text = run.text.replace(/ $/, '');
  }
  return out.filter((run) => run.kind !== 'text' || run.text !== '');
}
