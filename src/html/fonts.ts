// Deck fonts in Chromium (#34): every stylesheet and `@font-face` source a Slide document loads passes through
// here before Chromium sees it. Stylesheets are read, downloaded or taken from the Asset directory's pins, and
// each `@font-face` src is rewritten to deckflip-served URLs: `local()` entries are dropped, so an installed
// face never stands in for the supplied bytes, and each `url()` is served as the decoded sfnt that identifies it.
// Inline `<style>` rules, which Chromium parses before any request, are rewritten in the CSSOM once the page has
// loaded, and measurement waits until their faces load. What each rule loaded becomes the Slide's declared faces.

import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page, Route } from 'playwright-core';
import { faceFromFont, type DeclaredFontFace, type FontFace } from '../fonts/scan.js';
import { cssUrl, parseFamily, parseItalic, parseSrc, parseUnicodeRange, parseWeightRange, scanStylesheet, replaceRanges } from '../fonts/css.js';
import { decodeDataUrl, FontSources, type AcquiredFont, type AcquisitionFailure, type Acquired, type Fetched } from '../fonts/sources.js';
import { entry } from '../report/codes.js';
import type { Entry } from '../report/types.js';
import { assetsDirFor } from '../roundtrip/index.js';
import type { LoadedDeck } from './load.js';

/** Where rewritten `@font-face` sources point; never resolved, every request is answered here. */
const FONT_ORIGIN = 'https://fonts.deckflip.invalid';
const FETCH_TIMEOUT_MS = 30_000;
/** `format()` hints Chromium loads; entries hinting anything else are skipped by Chromium, and so here. */
const SUPPORTED_FORMATS = new Set(['truetype', 'opentype', 'woff', 'woff2', 'collection', 'truetype-variations', 'opentype-variations', 'woff-variations', 'woff2-variations']);

/** Each Slide's declared faces and the entries for what could not be loaded. */
export interface DeckFonts {
  declared: Map<number, DeclaredFontFace[]>;
  entries: Entry[];
}

/** One `@font-face` rule as deckflip rewrote it. */
interface Declaration {
  family: string;
  weight: [number, number];
  italic: boolean;
  unicodeRange?: Array<[number, number]>;
  /** the rule's stylesheet, or the Slide document for inline rules, in display form */
  stylesheet: string;
  /** the served URLs that replaced its `src`, in order */
  slots: number[];
}

/** One rewritten source: the URL it stands for, or why it cannot load. */
interface Slot {
  declaration: Declaration;
  url?: string;
  failure?: AcquisitionFailure;
}

type SheetItem = { kind: 'import'; url: string } | { kind: 'face'; declaration: Declaration };

/** A page's stylesheet as the CSSOM lists it: inline sheets with their rules, others by URL. */
export interface PageSheet {
  href: string | null;
  items: PageSheetItem[] | null;
}

export type PageSheetItem =
  | { kind: 'import'; href: string }
  | { kind: 'face'; path: number[]; descriptors: Record<string, string> };

export class DeckFontSession {
  private nextSlot = 1;
  private readonly slots = new Map<number, Slot>();
  private readonly outcomes = new Map<number, Acquired<AcquiredFont>>();
  /** the latest rewrite of each stylesheet URL */
  private readonly sheets = new Map<string, SheetItem[]>();
  private readonly sheetFailures = new Map<string, { slide: number; failure: AcquisitionFailure; referrer: string }>();
  /** one catalog face per acquired source, so each keeps its own provenance */
  private readonly faces = new Map<AcquiredFont, FontFace>();
  private readonly declared = new Map<number, DeclaredFontFace[]>();
  private readonly failed = new Map<string, Entry>();
  /** each attached page's Slide document, in display form */
  private readonly documents = new WeakMap<Page, string>();

  private constructor(private readonly sources: FontSources) {}

  static async open(loaded: LoadedDeck): Promise<DeckFontSession> {
    const deckDir = loaded.deckFile !== undefined ? dirname(loaded.deckFile) : resolve(loaded.inputPath);
    return new DeckFontSession(await FontSources.open({ ...(loaded.deckFile === undefined ? {} : { assetsDir: assetsDirFor(loaded.deckFile) }), deckDir }));
  }

  /** Answers the page's stylesheet and font requests; call before navigating. Other requests fall through. */
  async attach(page: Page, slide: number, documentFile: string): Promise<void> {
    const shown = this.sources.display(pathToFileURL(documentFile).href);
    this.documents.set(page, shown);
    await page.route('**/*', (route) => this.handle(page, route, slide, shown));
  }

  /**
   * After `load`: rewrites the inline `@font-face` rules, waits until every face Chromium now needs has loaded,
   * and records the Slide's declared faces in cascade order.
   */
  async settle(page: Page, slide: number): Promise<void> {
    await page.evaluate('globalThis.__name = globalThis.__name || ((fn) => fn)');
    const sheets = await page.evaluate(collectPageSheets);
    const documentUrl = page.url();
    const documentShown = this.documents.get(page) ?? this.sources.display(documentUrl);
    const edits: Array<{ path: number[]; src: string }> = [];
    const inline = new Map<string, Declaration>();
    for (const sheet of sheets) {
      for (const item of sheet.items ?? []) {
        if (item.kind !== 'face') continue;
        const declaration = this.declare(new Map(Object.entries(item.descriptors)), documentUrl, documentShown);
        if (!declaration) continue;
        inline.set(item.path.join('.'), declaration);
        edits.push({ path: item.path, src: this.srcValue(declaration) });
      }
    }
    if (edits.length > 0) await page.evaluate(applyFontFaceSources, edits);
    await page.evaluate(settleFontLoads);

    const ordered: Declaration[] = [];
    const visiting = new Set<string>();
    const walkSheet = (url: string) => {
      if (visiting.has(url)) return;
      visiting.add(url);
      for (const item of this.sheets.get(url) ?? []) {
        if (item.kind === 'import') walkSheet(item.url);
        else ordered.push(item.declaration);
      }
      visiting.delete(url);
    };
    for (const sheet of sheets) {
      if (sheet.items === null) {
        if (sheet.href !== null && this.sheets.has(sheet.href)) walkSheet(sheet.href);
        else if (sheet.href !== null && !this.sheetFailures.has(sheet.href)) this.unreadable(sheet.href, slide, documentShown);
        continue;
      }
      for (const item of sheet.items) {
        if (item.kind === 'import') walkSheet(item.href);
        else {
          const declaration = inline.get(item.path.join('.'));
          if (declaration) ordered.push(declaration);
        }
      }
    }
    this.declared.set(slide, ordered.map((declaration, order) => this.outcome(declaration, order, slide)));
  }

  /** Writes new pins and returns what the Slides declared. */
  async close(): Promise<DeckFonts> {
    await this.sources.persist();
    const entries = [...this.failed.values()];
    for (const [, { slide, failure, referrer }] of this.sheetFailures) {
      entries.push(entry(failure.code, { slide, reason: `Stylesheet ${failure.reason}`, params: { file: referrer } }));
    }
    return { declared: this.declared, entries };
  }

  /**
   * A stylesheet the page lists that never came through here: a `data:` URI, whose `@font-face` rules cannot be
   * rewritten, or a URL Chromium refused to request (one with credentials, say), whose rules are unknown.
   */
  private unreadable(href: string, slide: number, referrer: string): void {
    const key = `unreadable\u0000${href}`;
    if (this.failed.has(key)) return;
    const shown = this.sources.display(href);
    if (/^data:/i.test(href)) {
      const bytes = decodeDataUrl(href);
      if (bytes !== undefined && !scanStylesheet(bytes.toString('utf8')).some((item) => item.kind === 'font-face')) return;
      this.failed.set(key, entry('FONT_ASSET_UNSUPPORTED', {
        slide, reason: `Stylesheet ${shown} in ${referrer} declares fonts deckflip cannot rewrite; save it as a file next to the Deck`, params: { file: referrer },
      }));
      return;
    }
    this.failed.set(key, entry('FONT_ASSET_UNAVAILABLE', {
      slide, reason: `Chromium did not request stylesheet ${shown} in ${referrer} (a URL with credentials is blocked), so its fonts are unknown`, params: { file: referrer },
    }));
  }

  private async handle(page: Page, route: Route, slide: number, referrer: string): Promise<void> {
    const request = route.request();
    const url = request.url();
    if (url.startsWith(`${FONT_ORIGIN}/`)) return this.serveSlot(page, route, Number(url.slice(FONT_ORIGIN.length + 1)));
    const type = request.resourceType();
    // A source this session did not rewrite: an inline rule before `settle`, which loads it again from here.
    if (type === 'font') return route.abort();
    if (type === 'stylesheet' && /^(file|https?):/i.test(url)) return this.serveStylesheet(route, url, slide, referrer);
    return route.fallback();
  }

  private async serveStylesheet(route: Route, url: string, slide: number, referrer: string): Promise<void> {
    const got = await this.sources.stylesheet(url, () => fetchedFrom(route.fetch({ timeout: FETCH_TIMEOUT_MS })));
    if (!got.ok) {
      if (!this.sheetFailures.has(url)) this.sheetFailures.set(url, { slide, failure: got, referrer });
      return route.fulfill({ status: 404, contentType: 'text/css', body: '' });
    }
    const shown = this.sources.display(url);
    const items: SheetItem[] = [];
    const edits: Array<{ start: number; end: number; value: string }> = [];
    for (const item of scanStylesheet(got.value)) {
      if (item.kind === 'import') {
        const imported = absoluteUrl(item.url, url);
        if (imported) items.push({ kind: 'import', url: imported });
        continue;
      }
      const declaration = item.rule.src ? this.declare(item.rule.descriptors, url, shown) : undefined;
      if (!declaration || !item.rule.src) continue;
      items.push({ kind: 'face', declaration });
      edits.push({ ...item.rule.src, value: this.srcValue(declaration) });
    }
    this.sheets.set(url, items);
    return route.fulfill({
      status: 200,
      contentType: 'text/css; charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: replaceRanges(got.value, edits),
    });
  }

  private async serveSlot(page: Page, route: Route, id: number): Promise<void> {
    const slot = this.slots.get(id);
    if (!slot) return route.fulfill({ status: 404, body: '' });
    const userAgent = route.request().headers()['user-agent'];
    const outcome: Acquired<AcquiredFont> = slot.failure
      ? { ok: false, ...slot.failure }
      : await this.sources.font(slot.url!, () => fetchedFrom(page.request.fetch(slot.url!, {
        timeout: FETCH_TIMEOUT_MS,
        ...(userAgent === undefined ? {} : { headers: { 'user-agent': userAgent } }),
      })));
    this.outcomes.set(id, outcome);
    if (!outcome.ok) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    return route.fulfill({
      status: 200,
      contentType: outcome.value.source.format === 'otf' ? 'font/otf' : outcome.value.source.format === 'ttc' ? 'font/collection' : 'font/ttf',
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
      body: outcome.value.sfnt,
    });
  }

  /** A rule's descriptors and rewritten sources; undefined for a rule Chromium ignores (no single family). */
  private declare(descriptors: ReadonlyMap<string, string>, baseUrl: string, stylesheet: string): Declaration | undefined {
    const family = parseFamily(descriptors.get('font-family'));
    const src = descriptors.get('src');
    if (family === undefined || src === undefined) return undefined;
    const unicodeRange = parseUnicodeRange(descriptors.get('unicode-range'));
    const declaration: Declaration = {
      family,
      weight: parseWeightRange(descriptors.get('font-weight')),
      italic: parseItalic(descriptors.get('font-style')),
      ...(unicodeRange === undefined ? {} : { unicodeRange }),
      stylesheet,
      slots: [],
    };
    const sources = parseSrc(src);
    for (const source of sources) {
      if (source.kind === 'local') continue;
      if (source.formats.length > 0 && !source.formats.some((format) => SUPPORTED_FORMATS.has(format))) continue;
      const url = absoluteUrl(source.url, baseUrl);
      if (url) declaration.slots.push(this.slot({ declaration, url }));
    }
    if (declaration.slots.length === 0) {
      const reason = sources.some((source) => source.kind === 'local')
        ? 'lists only local() sources; deckflip measures supplied font files, never installed faces'
        : 'has no url() source in a format deckflip loads (TrueType, OpenType, WOFF, WOFF2)';
      declaration.slots.push(this.slot({ declaration, failure: { code: 'FONT_ASSET_UNSUPPORTED', reason } }));
    }
    return declaration;
  }

  private slot(slot: Slot): number {
    const id = this.nextSlot++;
    this.slots.set(id, slot);
    return id;
  }

  private srcValue(declaration: Declaration): string {
    return declaration.slots.map((id) => cssUrl(`${FONT_ORIGIN}/${id}`)).join(', ');
  }

  /** What a rule loaded: Chromium tries sources in order and keeps the last one it was served. */
  private outcome(declaration: Declaration, order: number, slide: number): DeclaredFontFace {
    const base: DeclaredFontFace = {
      family: declaration.family,
      weight: declaration.weight,
      italic: declaration.italic,
      ...(declaration.unicodeRange === undefined ? {} : { unicodeRange: declaration.unicodeRange }),
      order,
      state: 'unused',
    };
    const tried = declaration.slots.map((id) => this.outcomes.get(id)).filter((outcome): outcome is Acquired<AcquiredFont> => outcome !== undefined);
    const served = tried.filter((outcome) => outcome.ok).at(-1);
    if (served?.ok) {
      const loaded = this.loadedFace(served.value);
      if (loaded) return { ...base, state: 'loaded', loaded };
      this.fail(declaration, slide, { code: 'FONT_ASSET_UNSUPPORTED', reason: 'has no usable family name or metrics' });
      return { ...base, state: 'failed' };
    }
    if (tried.length === 0) return base;
    const failures = tried.filter((outcome): outcome is { ok: false } & AcquisitionFailure => !outcome.ok);
    this.fail(declaration, slide, { code: failures[0]!.code, reason: failures.map((failure) => failure.reason).join('; ') });
    return { ...base, state: 'failed' };
  }

  private loadedFace(acquired: AcquiredFont): DeclaredFontFace['loaded'] {
    const font = 'fonts' in acquired.font ? acquired.font.fonts[0] : acquired.font;
    if (!font) return undefined;
    let face = this.faces.get(acquired);
    if (!face) {
      face = faceFromFont(font, { sha256: acquired.sha256, faceIndex: 0, source: acquired.source });
      if (!face) return undefined;
      this.faces.set(acquired, face);
    }
    return { face, font };
  }

  private fail(declaration: Declaration, slide: number, failure: AcquisitionFailure): void {
    const weight = declaration.weight[0] === declaration.weight[1] ? `${declaration.weight[0]}` : declaration.weight.join('-');
    const key = `${failure.code}\u0000${declaration.family}\u0000${weight}\u0000${declaration.italic}\u0000${failure.reason}`;
    if (this.failed.has(key)) return;
    const reason = `@font-face ${declaration.family} ${weight}${declaration.italic ? ' italic' : ''} in ${declaration.stylesheet}: ${failure.reason}`;
    this.failed.set(key, entry(failure.code, { slide, reason, params: { file: declaration.stylesheet, family: declaration.family } }));
  }
}

function absoluteUrl(url: string, base: string): string | undefined {
  try {
    return new URL(url, base).href;
  } catch {
    return undefined;
  }
}

async function fetchedFrom(pending: Promise<{ status(): number; body(): Promise<Buffer> }>): Promise<Fetched> {
  const response = await pending;
  return { status: response.status(), body: await response.body() };
}

/** Page script: the document's stylesheets in order; inline ones with their `@import` and `@font-face` rules. */
export function collectPageSheets(): PageSheet[] {
  const DESCRIPTORS = ['font-family', 'src', 'font-weight', 'font-style', 'font-stretch', 'unicode-range'];
  const walk = (rules: CSSRuleList, path: number[]): PageSheetItem[] => {
    const items: PageSheetItem[] = [];
    Array.from(rules).forEach((rule, index) => {
      if (rule instanceof CSSImportRule) {
        items.push({ kind: 'import', href: rule.styleSheet?.href ?? new URL(rule.href, document.baseURI).href });
      } else if (rule instanceof CSSFontFaceRule) {
        const descriptors: Record<string, string> = {};
        for (const name of DESCRIPTORS) {
          const value = rule.style.getPropertyValue(name);
          if (value) descriptors[name] = value;
        }
        items.push({ kind: 'face', path: [...path, index], descriptors });
      } else if ('cssRules' in rule) {
        items.push(...walk((rule as CSSGroupingRule).cssRules, [...path, index]));
      }
    });
    return items;
  };
  return Array.from(document.styleSheets).map((sheet, index) => {
    if (sheet.href !== null) return { href: sheet.href, items: null };
    try {
      return { href: null, items: walk(sheet.cssRules, [index]) };
    } catch {
      return { href: null, items: null };
    }
  });
}

/** Page script: replaces `src` of the inline `@font-face` rules at each CSSOM path. */
export function applyFontFaceSources(edits: Array<{ path: number[]; src: string }>): void {
  for (const { path, src } of edits) {
    let rule: CSSRule | CSSStyleSheet | undefined = document.styleSheets[path[0]!];
    for (const index of path.slice(1)) {
      rule = rule && 'cssRules' in rule ? (rule as CSSStyleSheet | CSSGroupingRule).cssRules[index] : undefined;
    }
    if (rule instanceof CSSFontFaceRule) rule.style.setProperty('src', src);
  }
}

/** Page script: lays the page out, which starts the loads of every face it needs, until none is still loading. */
export async function settleFontLoads(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    document.body?.getBoundingClientRect();
    await document.fonts.ready;
    let loading = false;
    document.fonts.forEach((face) => {
      if (face.status === 'loading') loading = true;
    });
    if (!loading) return;
  }
}
