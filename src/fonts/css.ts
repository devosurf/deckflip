// Just enough CSS to find what a stylesheet declares about fonts: `@import` targets and `@font-face` rules at any
// nesting depth (inside `@media`, `@supports`, `@layer`, ...), with the text range of each `src` so it can be
// rewritten. Tokenization follows CSS Syntax 3 for comments, strings, escapes and unquoted `url()`; everything
// else is copied through untouched.

export interface CssFontFaceRule {
  /** raw descriptor values, comments removed, by lowercase descriptor name */
  descriptors: Map<string, string>;
  /** where the last `src` value lies in the stylesheet text */
  src?: { start: number; end: number };
}

export type CssItem = { kind: 'import'; url: string } | { kind: 'font-face'; rule: CssFontFaceRule };

export type FontFaceSource = { kind: 'url'; url: string; formats: string[] } | { kind: 'local'; name: string };

/** `@import` and `@font-face` rules in source order. */
export function scanStylesheet(text: string): CssItem[] {
  const items: CssItem[] = [];
  let i = 0;
  while (i < text.length) {
    const skipped = skipOpaque(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    if (text[i] !== '@') {
      i += 1;
      continue;
    }
    const name = readIdent(text, i + 1);
    const lower = name.toLowerCase();
    const after = i + 1 + name.length;
    if (lower === 'import') {
      const end = preludeEnd(text, after);
      const url = importUrl(text.slice(after, end));
      if (url !== undefined) items.push({ kind: 'import', url });
      i = end + 1;
    } else if (lower === 'font-face') {
      const open = preludeEnd(text, after);
      if (text[open] !== '{') {
        i = open + 1;
        continue;
      }
      const close = blockEnd(text, open + 1);
      items.push({ kind: 'font-face', rule: readDeclarations(text, open + 1, close) });
      i = close + 1;
    } else {
      i = after;
    }
  }
  return items;
}

/** `text` with each range replaced; ranges must not overlap. */
export function replaceRanges(text: string, edits: ReadonlyArray<{ start: number; end: number; value: string }>): string {
  let out = '';
  let at = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    out += text.slice(at, edit.start) + edit.value;
    at = edit.end;
  }
  return out + text.slice(at);
}

/** The `src` descriptor's entries in order; entries that are neither `url()` nor `local()` are left out. */
export function parseSrc(value: string): FontFaceSource[] {
  const sources: FontFaceSource[] = [];
  for (const part of splitTopLevel(stripComments(value), ',')) {
    const tokens = componentTokens(part);
    const head = tokens[0];
    if (head?.kind !== 'function') continue;
    if (head.name === 'url') {
      const url = functionString(head.body);
      if (url === undefined) continue;
      const formats = tokens.slice(1).filter((token) => token.kind === 'function' && token.name === 'format')
        .flatMap((token) => (token.kind === 'function' ? splitTopLevel(token.body, ',').map((format) => unquote(format.trim()).toLowerCase()) : []));
      sources.push({ kind: 'url', url, formats });
    } else if (head.name === 'local') {
      sources.push({ kind: 'local', name: functionString(head.body) ?? '' });
    }
  }
  return sources;
}

/** One family name, or undefined when the value is empty or lists several. */
export function parseFamily(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parts = splitTopLevel(stripComments(value), ',');
  if (parts.length !== 1) return undefined;
  const raw = parts[0]!.trim();
  const family = raw.startsWith('"') || raw.startsWith("'") ? unquote(raw) : cssUnescape(raw).replace(/\s+/g, ' ');
  return family.trim() || undefined;
}

/** `font-weight` descriptor as an inclusive range; `normal`, an absent or unparseable value are 400. */
export function parseWeightRange(value: string | undefined): [number, number] {
  const words = stripComments(value ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const weights = words.map((word) => (word === 'normal' ? 400 : word === 'bold' ? 700 : Number(word)));
  if (weights.length === 0 || weights.length > 2 || weights.some((w) => !Number.isFinite(w) || w < 1 || w > 1000)) return [400, 400];
  const [a, b = a] = weights as [number, number?];
  return [Math.min(a, b!), Math.max(a, b!)];
}

/** `font-style` descriptor: italic and every oblique angle are italic for matching. */
export function parseItalic(value: string | undefined): boolean {
  return /^(italic|oblique)\b/i.test(stripComments(value ?? '').trim());
}

/** `unicode-range` as inclusive code point ranges; undefined when absent, meaning every code point. */
export function parseUnicodeRange(value: string | undefined): Array<[number, number]> | undefined {
  if (value === undefined) return undefined;
  const ranges: Array<[number, number]> = [];
  for (const part of stripComments(value).split(',')) {
    const match = /^\s*u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
    if (!match) continue;
    const first = match[1]!;
    const lo = parseInt(first.replace(/\?/g, '0'), 16);
    const hi = match[2] !== undefined ? parseInt(match[2], 16) : parseInt(first.replace(/\?/g, 'f'), 16);
    if (lo <= hi && hi <= 0x10ffff) ranges.push([lo, Math.min(hi, 0x10ffff)]);
  }
  return ranges.length > 0 ? ranges : undefined;
}

/** CSS-serialized `url("...")`. */
export function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n]/g, (char) => (char === '\n' ? '\\a ' : `\\${char}`))}")`;
}

type ComponentToken = { kind: 'function'; name: string; body: string } | { kind: 'other'; text: string };

/** Top-level functions and words of one src entry; `url(` with an unquoted body is one function token. */
function componentTokens(text: string): ComponentToken[] {
  const tokens: ComponentToken[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      i += 1;
      continue;
    }
    const name = readIdent(text, i);
    if (name && text[i + name.length] === '(') {
      const open = i + name.length + 1;
      const close = name.toLowerCase() === 'url' && !/^\s*["']/.test(text.slice(open)) ? unquotedUrlEnd(text, open) : parenEnd(text, open);
      tokens.push({ kind: 'function', name: name.toLowerCase(), body: text.slice(open, close) });
      i = close + 1;
      continue;
    }
    let end = i;
    while (end < text.length && !/\s/.test(text[end]!)) end = skipOpaque(text, end) === end ? end + 1 : skipOpaque(text, end);
    tokens.push({ kind: 'other', text: text.slice(i, end) });
    i = end;
  }
  return tokens;
}

function functionString(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('"') || trimmed.startsWith("'") ? unquote(trimmed) : cssUnescape(trimmed);
}

function importUrl(prelude: string): string | undefined {
  const tokens = componentTokens(stripComments(prelude));
  const first = tokens[0];
  if (first?.kind === 'function' && first.name === 'url') return functionString(first.body);
  if (first?.kind === 'other' && (first.text.startsWith('"') || first.text.startsWith("'"))) return unquote(first.text);
  return undefined;
}

function readDeclarations(text: string, start: number, end: number): CssFontFaceRule {
  const rule: CssFontFaceRule = { descriptors: new Map() };
  let at = start;
  while (at < end) {
    const stop = Math.min(declarationEnd(text, at, end), end);
    const colon = findTopLevel(text, at, stop, ':');
    if (colon !== -1) {
      const name = stripComments(text.slice(at, colon)).trim().toLowerCase();
      let valueStart = colon + 1;
      let valueEnd = stop;
      while (valueStart < valueEnd && /\s/.test(text[valueStart]!)) valueStart += 1;
      while (valueEnd > valueStart && /\s/.test(text[valueEnd - 1]!)) valueEnd -= 1;
      if (name) {
        rule.descriptors.set(name, stripComments(text.slice(valueStart, valueEnd)).trim());
        if (name === 'src') rule.src = { start: valueStart, end: valueEnd };
      }
    }
    at = stop + 1;
  }
  return rule;
}

/** Index of the `;` ending the declaration at `start`, or `end`. */
function declarationEnd(text: string, start: number, end: number): number {
  const found = findTopLevel(text, start, end, ';');
  return found === -1 ? end : found;
}

function findTopLevel(text: string, start: number, end: number, char: string): number {
  let depth = 0;
  let i = start;
  while (i < end) {
    const skipped = skipOpaque(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = text[i]!;
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === char && depth <= 0) return i;
    i += 1;
  }
  return -1;
}

/** Index of the `;` or `{` that ends an at-rule prelude, or the text length. */
function preludeEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const skipped = skipOpaque(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = text[i]!;
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if ((c === ';' || c === '{') && depth <= 0) return i;
    else if (c === '}' && depth <= 0) return i;
    i += 1;
  }
  return text.length;
}

/** Index of the `}` closing the block whose content starts at `start`, or the text length. */
function blockEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const skipped = skipOpaque(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = text[i]!;
    if (c === '{') depth += 1;
    else if (c === '}') {
      if (depth === 0) return i;
      depth -= 1;
    }
    i += 1;
  }
  return text.length;
}

function parenEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const skipped = skipOpaque(text, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = text[i]!;
    if (c === '(') depth += 1;
    else if (c === ')') {
      if (depth === 0) return i;
      depth -= 1;
    }
    i += 1;
  }
  return text.length;
}

/** The `)` of an unquoted `url(`, honouring escapes. */
function unquotedUrlEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && text[i] !== ')') i += text[i] === '\\' ? 2 : 1;
  return Math.min(i, text.length);
}

/** Past a comment, string or unquoted `url(...)` starting at `i`; `i` itself when none starts there. */
function skipOpaque(text: string, i: number): number {
  const c = text[i];
  if (c === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, text.length);
  }
  if ((c === 'u' || c === 'U') && /^url\(/i.test(text.slice(i, i + 4)) && !isIdentChar(text[i - 1])) {
    let j = i + 4;
    while (j < text.length && /\s/.test(text[j]!)) j += 1;
    if (text[j] !== '"' && text[j] !== "'") return unquotedUrlEnd(text, j) + 1;
  }
  return i;
}

function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      out += ' ';
      continue;
    }
    const skipped = skipOpaque(text, i);
    if (skipped !== i) {
      out += text.slice(i, skipped);
      i = skipped;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const found = findTopLevel(text, at, text.length, separator);
    if (found === -1) break;
    parts.push(text.slice(at, found));
    at = found + 1;
  }
  parts.push(text.slice(at));
  return parts.filter((part) => part.trim() !== '');
}

function readIdent(text: string, start: number): string {
  let end = start;
  if (text[end] === '-') end += 1;
  while (end < text.length && (isIdentChar(text[end]) || text[end] === '\\')) end += text[end] === '\\' ? 2 : 1;
  const ident = text.slice(start, end);
  return /^-?[A-Za-z_\u0080-\uffff\\]/.test(ident) ? ident : '';
}

function isIdentChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_\-\u0080-\uffff]/.test(c);
}

function unquote(text: string): string {
  const quote = text[0];
  if (quote !== '"' && quote !== "'") return cssUnescape(text);
  const body = text.endsWith(quote) && text.length > 1 ? text.slice(1, -1) : text.slice(1);
  return cssUnescape(body.replace(/\\\r?\n/g, ''));
}

function cssUnescape(text: string): string {
  return text.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n])/g, (_match, hex: string | undefined, char: string | undefined) => {
    if (hex === undefined) return char ?? '';
    const code = parseInt(hex, 16);
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\ufffd' : String.fromCodePoint(code);
  });
}
