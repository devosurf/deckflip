// Acquisition of the bytes a Deck's CSS points at (#34): local files are read where they are, `data:` URIs
// decoded, and anything downloaded is frozen into the Asset directory's `fonts/` so a repeat conversion,
// offline or not, measures the same bytes. A pin is never refreshed: delete it to fetch the source again.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import type { Font as FontKitFont, FontCollection as FontKitCollection } from 'fontkit';
import type { FontFormat, FontSource } from '../model/index.js';
import { BUNDLED_FONT_MANIFEST, BUNDLED_FONT_ORIGIN, BUNDLED_STYLESHEET_URL, bundledFontFile, bundledFontStylesheet, bundledFontUrl } from '../bundled-fonts.js';
import { decodeFont, sha256, sniffFontFormat, type DecodedFont } from './sfnt.js';

/** The Asset directory's font pins: the frozen downloads and `sources.json`, which maps each URL to its copy. */
export const FONT_PINS_DIR = 'fonts';
export const FONT_PINS_FILE = 'sources.json';

export type AcquisitionCode = 'FONT_ASSET_UNAVAILABLE' | 'FONT_ASSET_UNSUPPORTED' | 'VALIDATE_MISSING_ASSET';

export interface AcquisitionFailure {
  code: AcquisitionCode;
  /** what failed, naming the source by its display form only */
  reason: string;
}

export type Acquired<T> = { ok: true; value: T } | ({ ok: false } & AcquisitionFailure);

export interface AcquiredFont {
  /** of `sfnt`: the asset identity */
  sha256: string;
  sfnt: Buffer;
  font: FontKitFont | FontKitCollection;
  source: Exclude<FontSource, { kind: 'installed' }>;
}

/** What the browser's request for a remote URL returned. */
export interface Fetched {
  status: number;
  body: Buffer;
  /** final response URL after redirects; absent for local test fetchers */
  url?: string;
}

export type Fetcher = () => Promise<Fetched>;

/** A source's raw bytes and where they were read from. */
interface SourceBytes {
  bytes: Buffer;
  kind: 'file' | 'remote' | 'data' | 'bundled';
  /** `file`: the local path */
  file?: string;
  /** `bundled`: the package asset's basename, never its absolute path */
  bundledFile?: string;
  /** `remote`: the frozen copy, when there is an Asset directory */
  pinned?: string;
  /** final response base for a stylesheet, stripped of secrets */
  base?: string;
}

export interface AcquiredStylesheet {
  text: string;
  baseUrl: string;
}

type PinRecord = {
  /** SHA-256 of the full URL: credentials never reach disk */
  key: string;
  /** the URL's display form */
  url: string;
  type: 'stylesheet' | 'font';
} & (
  | { state: 'pinned'; file: string; sha256: string; base?: string }
  | { state: 'failed'; failure: AcquisitionFailure }
);

interface PinFile {
  schemaVersion: 1;
  sources: PinRecord[];
}

export class FontSources {
  private readonly fonts = new Map<string, Promise<Acquired<AcquiredFont>>>();
  private readonly sheets = new Map<string, Promise<Acquired<AcquiredStylesheet>>>();
  private dirty = false;

  private constructor(
    /** `<name>.assets/fonts`; undefined without a Deck file, when downloads stay in memory */
    private readonly pinDir: string | undefined,
    private readonly pins: Map<string, PinRecord>,
    /** what local paths in reasons are relative to */
    private readonly deckDir: string,
  ) {}

  static async open(opts: { assetsDir?: string; deckDir: string }): Promise<FontSources> {
    const pinDir = opts.assetsDir === undefined ? undefined : join(opts.assetsDir, FONT_PINS_DIR);
    const pins = new Map<string, PinRecord>();
    if (pinDir !== undefined) {
      const text = await readFile(join(pinDir, FONT_PINS_FILE), 'utf8').catch(() => undefined);
      for (const record of text === undefined ? [] : parsePins(text)) pins.set(record.key, record);
    }
    return new FontSources(pinDir, pins, opts.deckDir);
  }

  /** A stylesheet's text; `fetch` is the browser's own request, used only for a remote URL not pinned yet. */
  stylesheet(url: string, fetch: Fetcher): Promise<Acquired<AcquiredStylesheet>> {
    if (url === BUNDLED_STYLESHEET_URL) return Promise.resolve({ ok: true, value: { text: bundledFontStylesheet(), baseUrl: url } });
    let pending = this.sheets.get(url);
    if (!pending) {
      pending = this.bytes(url, 'stylesheet', fetch).then((got) => (got.ok ? { ok: true, value: { text: decodeCss(got.value.bytes), baseUrl: got.value.base ?? url } } : got));
      this.sheets.set(url, pending);
    }
    return pending;
  }

  /** A font source decoded to sfnt and parsed; `fetch` is used only for a remote URL not pinned yet. */
  font(url: string, fetch: Fetcher): Promise<Acquired<AcquiredFont>> {
    let pending = this.fonts.get(url);
    if (!pending) {
      pending = this.bytes(url, 'font', fetch).then((got) => (got.ok ? parseFont(got.value, this.display(url)) : got));
      this.fonts.set(url, pending);
    }
    return pending;
  }

  /** How reasons name a source: a path relative to the Deck, a URL without credentials or query values, or `data:`. */
  display(url: string): string {
    return displaySource(url, this.deckDir);
  }

  /** Freeze earlier remote failures only after the declaration successfully loaded a later pinned source. */
  freezeFailure(url: string, failure: AcquisitionFailure): void {
    if (this.pinDir === undefined || !/^https?:/i.test(url)) return;
    const key = sha256(Buffer.from(url, 'utf8'));
    if (this.pins.has(key)) return;
    this.pins.set(key, { key, url: this.display(url), type: 'font', state: 'failed', failure });
    this.dirty = true;
  }

  /** Writes `sources.json` when this run pinned something new. */
  async persist(): Promise<void> {
    if (!this.dirty || this.pinDir === undefined) return;
    const file: PinFile = { schemaVersion: 1, sources: [...this.pins.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) };
    await writeAtomic(join(this.pinDir, FONT_PINS_FILE), `${JSON.stringify(file, null, 2)}\n`);
    this.dirty = false;
  }

  private async bytes(url: string, type: PinRecord['type'], fetch: Fetcher): Promise<Acquired<SourceBytes>> {
    const shown = this.display(url);
    if (url.startsWith(`${BUNDLED_FONT_ORIGIN}/`)) {
      const face = BUNDLED_FONT_MANIFEST.fonts.find((face) => bundledFontUrl(face.file) === url);
      if (type !== 'font' || face === undefined) {
        return { ok: false, code: 'FONT_ASSET_UNAVAILABLE', reason: `${shown} is not a bundled font asset` };
      }
      const bytes = await readFile(bundledFontFile(face.file)).catch(() => undefined);
      if (bytes === undefined || sha256(bytes) !== face.sha256) {
        return { ok: false, code: 'FONT_ASSET_UNAVAILABLE', reason: `Bundled default ${BUNDLED_FONT_MANIFEST.family} ${BUNDLED_FONT_MANIFEST.version}/${face.file} is missing or does not match its manifest SHA-256; reinstall deckflip` };
      }
      return { ok: true, value: { bytes, kind: 'bundled', bundledFile: face.file } };
    }
    const scheme = url.slice(0, url.indexOf(':') + 1).toLowerCase();
    if (scheme === 'file:') {
      const file = fileURLToPath(url);
      try {
        return { ok: true, value: { bytes: await readFile(file), kind: 'file', file } };
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? { ok: false, code: 'VALIDATE_MISSING_ASSET', reason: `${shown} does not exist` }
          : { ok: false, code: 'FONT_ASSET_UNAVAILABLE', reason: `${shown} could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'})` };
      }
    }
    if (scheme === 'data:') {
      const bytes = decodeDataUrl(url);
      return bytes === undefined
        ? { ok: false, code: 'FONT_ASSET_UNSUPPORTED', reason: `${shown} is not a valid data URI` }
        : { ok: true, value: { bytes, kind: 'data' } };
    }
    if (scheme !== 'http:' && scheme !== 'https:') {
      return { ok: false, code: 'FONT_ASSET_UNSUPPORTED', reason: `${shown} uses an unsupported URL scheme` };
    }

    const key = sha256(Buffer.from(url, 'utf8'));
    const pin = this.pins.get(key);
    if (pin !== undefined && this.pinDir !== undefined) {
      if (pin.state === 'failed') return { ok: false, ...pin.failure };
      const pinned = join(this.pinDir, pin.file);
      const bytes = await readFile(pinned).catch(() => undefined);
      if (bytes === undefined || sha256(bytes) !== pin.sha256) {
        return { ok: false, code: 'FONT_ASSET_UNAVAILABLE', reason: `The pinned copy of ${shown} is missing or was modified; remove its entry from ${FONT_PINS_DIR}/${FONT_PINS_FILE} to download it again` };
      }
      return { ok: true, value: { bytes, kind: 'remote', pinned, ...(pin.base === undefined ? {} : { base: pin.base }) } };
    }

    let fetched: Fetched;
    try {
      fetched = await fetch();
    } catch {
      // Fetch errors quote the full URL, credentials included: never forward them.
      return { ok: false, code: 'FONT_ASSET_UNAVAILABLE', reason: `${shown} could not be downloaded and is not pinned in the Asset directory` };
    }
    if (fetched.status < 200 || fetched.status >= 300) {
      return { ok: false, code: 'FONT_ASSET_UNAVAILABLE', reason: `${shown} returned HTTP ${fetched.status} and is not pinned in the Asset directory` };
    }
    const base = type === 'stylesheet' ? stylesheetBase(fetched.url ?? url) : undefined;
    if (this.pinDir === undefined) return { ok: true, value: { bytes: fetched.body, kind: 'remote', ...(base === undefined ? {} : { base }) } };

    const digest = sha256(fetched.body);
    const format = type === 'font' ? sniffFontFormat(fetched.body) : undefined;
    const name = `${digest}.${type === 'stylesheet' ? 'css' : (format ?? 'bin')}`;
    const pinned = join(this.pinDir, name);
    try {
      await writeAtomic(pinned, fetched.body);
    } catch (error) {
      return { ok: false, code: 'FONT_ASSET_UNAVAILABLE', reason: `${shown} could not be pinned in the Asset directory (${(error as NodeJS.ErrnoException).code ?? 'error'})` };
    }
    this.pins.set(key, { key, url: shown, type, state: 'pinned', file: name, sha256: digest, ...(base === undefined ? {} : { base }) });
    this.dirty = true;
    return { ok: true, value: { bytes: fetched.body, kind: 'remote', pinned, ...(base === undefined ? {} : { base }) } };
  }
}

/** A URL as reports and pins may show it: never userinfo, query values or fragments, never a data URI's payload. */
export function displaySource(url: string, deckDir: string): string {
  if (/^data:/i.test(url)) {
    const type = /^data:([^;,]*)/i.exec(url)?.[1];
    return type ? `data:${type}` : 'data:';
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '(invalid URL)';
  }
  if (parsed.protocol === 'file:') {
    const file = fileURLToPath(parsed);
    const rel = relative(deckDir, file);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : file;
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search ? '?…' : ''}`;
}

async function parseFont(got: SourceBytes, shown: string): Promise<Acquired<AcquiredFont>> {
  let decoded: DecodedFont;
  try {
    decoded = await decodeFont(got.bytes);
  } catch {
    return { ok: false, code: 'FONT_ASSET_UNSUPPORTED', reason: `${shown} is not a TrueType, OpenType, WOFF or WOFF2 font deckflip can decode` };
  }
  let font: FontKitFont | FontKitCollection;
  try {
    font = fontkit.create(decoded.sfnt);
  } catch {
    return { ok: false, code: 'FONT_ASSET_UNSUPPORTED', reason: `${shown} could not be parsed as a ${decoded.format.toUpperCase()} font` };
  }
  const acquired = sha256(got.bytes);
  const format: FontFormat = decoded.format;
  const source: AcquiredFont['source'] =
    got.kind === 'file' ? { kind: 'file', file: got.file!, format, sha256: acquired }
      : got.kind === 'data' ? { kind: 'data', format, sha256: acquired }
        : got.kind === 'bundled' ? { kind: 'bundled', family: BUNDLED_FONT_MANIFEST.family, version: BUNDLED_FONT_MANIFEST.version, file: got.bundledFile!, format, sha256: acquired }
          : { kind: 'remote', url: shown, format, sha256: acquired, ...(got.pinned === undefined ? {} : { pinned: got.pinned }) };
  return { ok: true, value: { sha256: sha256(decoded.sfnt), sfnt: decoded.sfnt, font, source } };
}

/** The payload of a `data:` URI as bytes; undefined when it has no `,`. */
export function decodeDataUrl(url: string): Buffer | undefined {
  const comma = url.indexOf(',');
  if (comma === -1) return undefined;
  const meta = url.slice(5, comma);
  const payload = percentDecode(url.slice(comma + 1));
  return /;\s*base64\s*$/i.test(meta) ? Buffer.from(payload.toString('latin1').replace(/\s+/g, ''), 'base64') : payload;
}

/** `%XX` escapes as their bytes, everything else as UTF-8: a `data:` payload is bytes, not necessarily UTF-8. */
function percentDecode(text: string): Buffer {
  const bytes = Buffer.allocUnsafe(Buffer.byteLength(text));
  let at = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '%' || !/^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) continue;
    at += bytes.write(text.slice(start, i), at, 'utf8');
    bytes[at++] = parseInt(text.slice(i + 1, i + 3), 16);
    i += 2;
    start = i + 1;
  }
  at += bytes.write(text.slice(start), at, 'utf8');
  return bytes.subarray(0, at);
}

function decodeCss(bytes: Buffer): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parsePins(text: string): PinRecord[] {
  try {
    const parsed = JSON.parse(text) as Partial<PinFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sources)) return [];
    return parsed.sources.filter((record): record is PinRecord => {
      if (typeof record?.key !== 'string' || typeof record.url !== 'string' || (record.type !== 'stylesheet' && record.type !== 'font')) return false;
      if (record.state === 'failed') return record.type === 'font' && typeof record.failure?.reason === 'string' &&
        ['FONT_ASSET_UNAVAILABLE', 'FONT_ASSET_UNSUPPORTED', 'VALIDATE_MISSING_ASSET'].includes(record.failure.code);
      return record.state === 'pinned' && typeof record.file === 'string' && typeof record.sha256 === 'string' &&
        (record.base === undefined || typeof record.base === 'string') && !record.file.includes('/') && !record.file.includes('\\');
    });
  } catch {
    return [];
  }
}

/** A repeatable redirect base without credentials, query or fragment. */
function stylesheetBase(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, file);
}
