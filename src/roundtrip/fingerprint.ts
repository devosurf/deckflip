// Fingerprints (docs/spec/06-round-trip.md "Detecting untouched"): the SHA-256 of an element's canonical
// serialisation. The canonical form is computed over a small DOM-shaped tree so the same rules apply to what
// htmlout wrote (read back with `parseHtml`) and to what the measurer saw in Chromium (walked with `htmlTree`
// in html/browser-script.ts). An agent reformatting the file, reordering attributes or style declarations
// must not count as an edit; anything that renders differently must.

import { createHash } from 'node:crypto';

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlChild[];
}

export type HtmlChild = HtmlNode | string;

/** Locator and preservation markers: the manifest keys on them, so they are not part of what is fingerprinted. */
const EXCLUDED_ATTRS = new Set(['data-shape-id', 'data-preserve', 'data-placeholder']);

/** Elements whose edges swallow adjacent whitespace when rendered (block-level boxes and forced breaks). */
const BOUNDARY = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'br', 'caption', 'col', 'colgroup', 'dd', 'details', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

export function fingerprint(node: HtmlNode): string {
  return createHash('sha256').update(canonicalHtml(node)).digest('hex');
}

export function canonicalHtml(node: HtmlNode): string {
  const out: string[] = [];
  writeNode(node, out, false);
  return out.join('');
}

function writeNode(node: HtmlNode, out: string[], preformatted: boolean): void {
  out.push('<', node.tag);
  for (const name of Object.keys(node.attrs).sort()) {
    if (EXCLUDED_ATTRS.has(name)) continue;
    const value = node.attrs[name]!;
    out.push(' ', name, '="', escape(name === 'style' ? canonicalStyle(value) : name === 'class' ? collapse(value).trim() : value), '"');
  }
  out.push('>');
  const pre = preformatted || node.tag === 'pre';
  for (const child of renderedChildren(node, pre)) {
    if (typeof child === 'string') out.push(escape(child));
    else writeNode(child, out, pre);
  }
  out.push('</', node.tag, '>');
}

/** Text as CSS `white-space: normal` renders it: runs collapsed, edges against block boundaries trimmed. */
function renderedChildren(node: HtmlNode, preformatted: boolean): HtmlChild[] {
  const merged: HtmlChild[] = [];
  for (const child of node.children) {
    const last = merged[merged.length - 1];
    if (typeof child === 'string' && typeof last === 'string') merged[merged.length - 1] = last + child;
    else merged.push(child);
  }
  if (preformatted) return merged;
  const parentIsBoundary = BOUNDARY.has(node.tag);
  const boundaryAt = (index: number): boolean => {
    const sibling = merged[index];
    return sibling === undefined ? parentIsBoundary : typeof sibling !== 'string' && BOUNDARY.has(sibling.tag);
  };
  const out: HtmlChild[] = [];
  merged.forEach((child, index) => {
    if (typeof child !== 'string') {
      out.push(child);
      return;
    }
    let text = collapse(child);
    if (boundaryAt(index - 1)) text = text.replace(/^ /, '');
    if (boundaryAt(index + 1)) text = text.replace(/ $/, '');
    if (text !== '') out.push(text);
  });
  return out;
}

function collapse(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, ' ');
}

/** Declarations sorted by property, each `prop: value` with whitespace normalised; `;` inside `url()`/quotes is not a separator. */
function canonicalStyle(style: string): string {
  const declarations: string[] = [];
  for (const declaration of splitDeclarations(style)) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = collapse(declaration.slice(colon + 1)).trim();
    if (property !== '') declarations.push(`${property}: ${value}`);
  }
  return declarations.sort().join('; ');
}

function splitDeclarations(style: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < style.length; index += 1) {
    const ch = style[index]!;
    if (quote !== undefined) {
      if (ch === '\\') index += 1;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(style.slice(start, index));
      start = index + 1;
    }
  }
  out.push(style.slice(start));
  return out;
}

function escape(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
}

/**
 * Parses the HTML htmlout writes (and the SVG payloads Chromium serialised into it) into the tree Chromium
 * builds from it: lowercase HTML names, entities decoded, void elements, self-closing tags inside `svg`, the
 * newline after `<pre>` dropped, comments and the doctype ignored. Not a general HTML parser: it relies on the
 * well-formed nesting htmlout produces (no implied end tags).
 */
export function parseHtml(text: string): HtmlChild[] {
  const root: HtmlChild[] = [];
  const stack: HtmlNode[] = [];
  const append = (child: HtmlChild): void => {
    const parent = stack[stack.length - 1];
    (parent ? parent.children : root).push(child);
  };
  const inSvg = (): boolean => stack.some((node) => node.tag === 'svg');

  let index = 0;
  while (index < text.length) {
    const lt = text.indexOf('<', index);
    if (lt === -1) {
      append(decode(text.slice(index)));
      break;
    }
    if (lt > index) append(decode(text.slice(index, lt)));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<!', lt) || text.startsWith('<?', lt)) {
      const end = text.indexOf('>', lt);
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt);
      const name = text.slice(lt + 2, end === -1 ? text.length : end).trim();
      const tag = inSvg() ? name : name.toLowerCase();
      const open = stack.map((node) => node.tag).lastIndexOf(tag);
      if (open !== -1) stack.length = open;
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    const tag = parseStartTag(text, lt, inSvg());
    append(tag.node);
    index = tag.end;
    const foreign = tag.node.tag === 'svg' || inSvg();
    if (foreign ? tag.selfClosing : VOID.has(tag.node.tag)) continue;
    stack.push(tag.node);
    if (tag.node.tag === 'pre' || tag.node.tag === 'textarea' || tag.node.tag === 'listing') {
      if (text.startsWith('\r\n', index)) index += 2;
      else if (text.startsWith('\n', index)) index += 1;
    }
  }
  return root;
}

function parseStartTag(text: string, start: number, foreign: boolean): { node: HtmlNode; end: number; selfClosing: boolean } {
  let index = start + 1;
  const nameMatch = /^[^\s/>]+/.exec(text.slice(index));
  const rawName = nameMatch?.[0] ?? '';
  index += rawName.length;
  const attrs: Record<string, string> = {};
  let selfClosing = false;
  for (;;) {
    while (index < text.length && /\s/.test(text[index]!)) index += 1;
    if (index >= text.length) break;
    if (text[index] === '>') {
      index += 1;
      break;
    }
    if (text[index] === '/') {
      selfClosing = text[index + 1] === '>';
      index += 1;
      continue;
    }
    const attrMatch = /^[^\s=/>]+/.exec(text.slice(index));
    const rawAttr = attrMatch?.[0] ?? '';
    index += Math.max(1, rawAttr.length);
    let value = '';
    let after = index;
    while (after < text.length && /\s/.test(text[after]!)) after += 1;
    if (text[after] === '=') {
      after += 1;
      while (after < text.length && /\s/.test(text[after]!)) after += 1;
      const quote = text[after];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, after + 1);
        value = text.slice(after + 1, close === -1 ? text.length : close);
        index = close === -1 ? text.length : close + 1;
      } else {
        const unquoted = /^[^\s>]*/.exec(text.slice(after))?.[0] ?? '';
        value = unquoted;
        index = after + unquoted.length;
      }
    }
    if (rawAttr !== '') attrs[foreign || rawName.toLowerCase() === 'svg' ? rawAttr : rawAttr.toLowerCase()] = decode(value);
  }
  const tag = foreign ? rawName : rawName.toLowerCase();
  return { node: { tag, attrs, children: [] }, end: index, selfClosing };
}

function decode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[ref.toLowerCase()] ?? match;
  });
}
