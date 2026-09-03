import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Canvas } from '../model/index.js';
import type { Entry } from '../report/types.js';
import { baseStylesheet } from './base.css.js';
import { staticEntries } from './validate.js';

export interface SlideDocument {
  index: number;
  html: string;
  baseUrl: string;
  sourceFile: string;
  inlineSection?: true;
}

export interface LoadedDeck {
  inputPath: string;
  /** the Deck file, absolute; absent in the per-file directory form (spec 02). Its `<name>.assets/` sibling is the round trip's Asset directory. */
  deckFile?: string;
  title: string;
  lang: string;
  canvas: Canvas;
  documents: SlideDocument[];
  entries: Entry[];
  canvasOverridden: boolean;
}

const UNKNOWN_META_HINT = 'Remove it or check the spelling; known names: deckflip:canvas';
const STRAY_CONTENT_HINT = 'Move it into a <section>; only sections are Slides';

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

export async function loadDeck(inputPath: string, opts: { size?: string }): Promise<LoadedDeck> {
  const resolved = resolve(inputPath);
  const info = await stat(resolved);
  if (info.isDirectory()) {
    const deckFile = await findDeckFile(resolved);
    if (deckFile) {
      return loadDeckFile(deckFile, inputPath, opts.size);
    }
    return loadPerFileDirectory(resolved, inputPath, opts.size);
  }

  if (extname(resolved).toLowerCase() === '.html') {
    return loadDeckFile(resolved, inputPath, opts.size);
  }

  throw new Error(`Unsupported input path: ${inputPath}`);
}

interface HtmlDocumentSource {
  doctype: string;
  htmlAttrs: string;
  headInner: string;
  bodyInner: string;
  title: string;
  lang: string;
  canvas: Canvas;
  html: string;
  entries: Entry[];
}

async function loadDeckFile(file: string, inputPath: string, size?: string): Promise<LoadedDeck> {
  const source = await readDocument(file, { validateMeta: true });
  const { sections, stray } = splitTopLevelSections(source.bodyInner);
  const entries = [...source.entries, ...staticEntries(source.headInner)];
  if (stray) {
    entries.push(errorEntry('VALIDATE_STRAY_CONTENT', 'Found non-section content in the deck body', STRAY_CONTENT_HINT));
  }

  const documents: SlideDocument[] = [];
  let index = 1;
  for (const sectionHtml of sections) {
    const dataSrc = extractAttr(sectionHtml, 'data-src');
    if (dataSrc) {
      const sourceFile = resolve(dirname(file), dataSrc);
      const slideDoc = await readDocument(sourceFile, { validateMeta: true });
      entries.push(...staticEntries(slideDoc.html, index));
      documents.push({ index, html: slideDoc.html, baseUrl: pathToFileURL(sourceFile).href, sourceFile });
    } else {
      entries.push(...staticEntries(sectionHtml, index));
      documents.push({
        index,
        html: assembleDocument({ doctype: source.doctype, htmlAttrs: source.htmlAttrs, headInner: source.headInner, bodyInner: sectionHtml, lang: source.lang }),
        baseUrl: pathToFileURL(file).href,
        sourceFile: file,
        inlineSection: true,
      });
    }
    index += 1;
  }

  const canvas = applyCanvasOverride(source.canvas, size);
  return {
    inputPath,
    deckFile: file,
    title: source.title,
    lang: source.lang,
    canvas,
    documents,
    entries: dedupeEntries(entries),
    canvasOverridden: didOverride(source.canvas, size),
  };
}

async function loadPerFileDirectory(dir: string, inputPath: string, size?: string): Promise<LoadedDeck> {
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => join(dir, entry.name))
    .sort(bytewiseCompare);

  const documents: SlideDocument[] = [];
  const entries: Entry[] = [];
  let canvas = defaultCanvas();
  let lang = 'en';
  let index = 1;
  for (const file of files) {
    const doc = await readDocument(file, { validateMeta: true });
    if (index === 1) {
      canvas = doc.canvas;
      lang = doc.lang;
    }
    documents.push({ index, html: doc.html, baseUrl: pathToFileURL(file).href, sourceFile: file });
    entries.push(...doc.entries, ...staticEntries(doc.html, index));
    index += 1;
  }

  const resolvedCanvas = applyCanvasOverride(canvas, size);
  return {
    inputPath,
    title: basename(dir),
    lang,
    canvas: resolvedCanvas,
    documents,
    entries: dedupeEntries(entries),
    canvasOverridden: didOverride(canvas, size),
  };
}

async function readDocument(file: string, opts: { validateMeta: boolean }): Promise<HtmlDocumentSource> {
  const html = await readFile(file, 'utf8');
  const { doctype, htmlAttrs, headInner, bodyInner } = splitDocument(html);
  const lang = extractHtmlLang(htmlAttrs) ?? 'en';
  const canvasInfo = extractCanvas(headInner);
  const entries = opts.validateMeta ? extractUnknownMetaEntries(headInner) : [];
  return {
    doctype,
    htmlAttrs,
    headInner,
    bodyInner,
    title: extractTitle(headInner) ?? basename(file, '.html'),
    lang,
    canvas: canvasInfo.canvas,
    html: assembleDocument({ doctype, htmlAttrs, headInner, bodyInner, lang }),
    entries,
  };
}

function assembleDocument(opts: { doctype: string; htmlAttrs: string; headInner: string; bodyInner: string; lang: string }): string {
  const canvas = extractCanvas(opts.headInner).canvas;
  const head = `<style>${baseStylesheet(canvas.width, canvas.height)}</style>${opts.headInner}`;
  return `${opts.doctype}<html${ensureLangAttr(opts.htmlAttrs, opts.lang)}><head>${head}</head><body>${opts.bodyInner}</body></html>`;
}

function ensureLangAttr(htmlAttrs: string, lang: string): string {
  if (/\blang\s*=/.test(htmlAttrs)) {
    return htmlAttrs;
  }
  return `${htmlAttrs}${htmlAttrs.trim() ? ' ' : ' '}lang="${escapeAttr(lang)}"`;
}

function extractCanvas(headInner: string): { canvas: Canvas } {
  const meta = findMeta(headInner, 'deckflip:canvas');
  if (!meta) {
    return { canvas: defaultCanvas() };
  }
  const parsed = parseCanvasSpec(meta.content.trim());
  return { canvas: parsed ?? defaultCanvas() };
}

function defaultCanvas(): Canvas {
  return { width: 1280, height: 720, source: 'default' };
}

function applyCanvasOverride(canvas: Canvas, size?: string): Canvas {
  if (!size) {
    return canvas;
  }
  const parsed = parseCanvasSpec(size);
  return { ...(parsed ?? canvas), source: 'flag' };
}

function didOverride(canvas: Canvas, size?: string): boolean {
  if (!size) {
    return false;
  }
  const parsed = parseCanvasSpec(size);
  if (!parsed) {
    return true;
  }
  return parsed.width !== canvas.width || parsed.height !== canvas.height;
}

function parseCanvasSpec(value: string): Canvas | undefined {
  const trimmed = value.trim();
  if (trimmed === '16:9') {
    return { width: 1280, height: 720, source: 'deck-meta' };
  }
  if (trimmed === '4:3') {
    return { width: 960, height: 720, source: 'deck-meta' };
  }
  const match = trimmed.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return undefined;
  }
  return { width: Number(match[1]), height: Number(match[2]), source: 'deck-meta' };
}

function splitDocument(html: string): { doctype: string; htmlAttrs: string; headInner: string; bodyInner: string } {
  const doctype = html.match(/^(\s*<!doctype[^>]*>)/i)?.[1] ?? '<!doctype html>';
  const htmlAttrs = html.match(/<html\b([^>]*)>/i)?.[1] ?? '';
  const headInner = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const bodyInner = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
  return { doctype, htmlAttrs, headInner, bodyInner };
}

function extractTitle(headInner: string): string | undefined {
  const match = headInner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities((match[1] ?? '').trim()) : undefined;
}

function extractHtmlLang(htmlAttrs: string): string | undefined {
  const match = htmlAttrs.match(/\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return match?.[1] || match?.[2] || match?.[3] || undefined;
}

function extractUnknownMetaEntries(headInner: string): Entry[] {
  const entries: Entry[] = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRe.exec(headInner))) {
    const name = extractAttr(match[0], 'name');
    if (!name || !name.toLowerCase().startsWith('deckflip:')) {
      continue;
    }
    if (name.toLowerCase() === 'deckflip:canvas') {
      continue;
    }
    entries.push(errorEntry('VALIDATE_UNKNOWN_META', `Unknown deck meta ${name}`, UNKNOWN_META_HINT));
  }
  return entries;
}

function findMeta(headInner: string, name: string): { content: string } | undefined {
  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRe.exec(headInner))) {
    const metaName = extractAttr(match[0], 'name');
    if (metaName?.toLowerCase() === name.toLowerCase()) {
      return { content: extractAttr(match[0], 'content') ?? '' };
    }
  }
  return undefined;
}

function extractSectionAttrs(sectionHtml: string): { dataSrc?: string } {
  const dataSrc = extractAttr(sectionHtml, 'data-src');
  return dataSrc ? { dataSrc } : {};
}

function extractAttr(tag: string, attr: string): string | undefined {
  const re = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(re);
  return match?.[1] || match?.[2] || match?.[3] || undefined;
}

function splitTopLevelSections(bodyInner: string): { sections: string[]; stray: boolean } {
  const sections: string[] = [];
  let stray = false;
  const stack: { name: string; topLevel: boolean }[] = [];
  let currentSectionStart: number | undefined;
  let i = 0;

  while (i < bodyInner.length) {
    const lt = bodyInner.indexOf('<', i);
    if (lt === -1) {
      if (stack.length === 0 && hasMeaningfulText(bodyInner.slice(i))) {
        stray = true;
      }
      break;
    }

    if (stack.length === 0 && hasMeaningfulText(bodyInner.slice(i, lt))) {
      stray = true;
    }

    if (bodyInner.startsWith('<!--', lt)) {
      const end = bodyInner.indexOf('-->', lt + 4);
      i = end === -1 ? bodyInner.length : end + 3;
      continue;
    }

    const close = parseCloseTag(bodyInner, lt);
    if (close) {
      const open = stack.pop();
      if (open?.name === close.name && open.name === 'section' && open.topLevel && currentSectionStart !== undefined && stack.length === 0) {
        sections.push(bodyInner.slice(currentSectionStart, close.end));
        currentSectionStart = undefined;
      }
      i = close.end;
      continue;
    }

    const open = parseOpenTag(bodyInner, lt);
    if (!open) {
      i = lt + 1;
      continue;
    }

    if (stack.length === 0 && open.name !== 'section') {
      stray = true;
    }
    if (stack.length === 0 && open.name === 'section') {
      currentSectionStart = lt;
    }
    if (!open.selfClosing && !VOID_TAGS.has(open.name)) {
      stack.push({ name: open.name, topLevel: stack.length === 0 });
    } else if (open.name === 'section' && stack.length === 0 && currentSectionStart !== undefined) {
      sections.push(bodyInner.slice(currentSectionStart, open.end));
      currentSectionStart = undefined;
    }
    i = open.end;
  }

  return { sections, stray };
}

function parseOpenTag(source: string, start: number): { name: string; end: number; selfClosing: boolean } | undefined {
  const match = source.slice(start).match(/^<([A-Za-z][A-Za-z0-9:-]*)([\s\S]*?)>/);
  if (!match) {
    return undefined;
  }
  const full = match[0];
  const name = (match[1] ?? '').toLowerCase();
  return { name, end: start + full.length, selfClosing: /\/>\s*$/.test(full) };
}

function parseCloseTag(source: string, start: number): { name: string; end: number } | undefined {
  const match = source.slice(start).match(/^<\/\s*([A-Za-z][A-Za-z0-9:-]*)\s*>/);
  if (!match) {
    return undefined;
  }
  return { name: (match[1] ?? '').toLowerCase(), end: start + match[0].length };
}

function hasMeaningfulText(value: string): boolean {
  return /[^\s]/.test(value);
}

async function findDeckFile(dir: string): Promise<string | undefined> {
  for (const name of ['deck.html', 'index.html']) {
    const file = join(dir, name);
    try {
      const info = await stat(file);
      if (info.isFile()) {
        return file;
      }
    } catch {
      // ignore missing
    }
  }
  return undefined;
}

function bytewiseCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function dedupeEntries(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  const result: Entry[] = [];
  for (const entry of entries) {
    const key = `${entry.code}\u0000${entry.reason}\u0000${entry.slide ?? ''}\u0000${entry.locator ? JSON.stringify(entry.locator) : ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function errorEntry(code: string, reason: string, hint: string): Entry {
  return { code, kind: 'error', severity: 'error', reason, hint };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, '\u00A0');
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
