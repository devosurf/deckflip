import * as fontkit from 'fontkit';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Font as FontKitFont, FontCollection as FontKitCollection } from 'fontkit';
import type { FontAsset, FontMetrics, OfficeFontIdentity, OfficeFontStyle } from '../model/index.js';
import { decodeFont, sha256, sniffFontFormat } from './sfnt.js';

export interface FontFace {
  aliases: string[];
  asset: FontAsset;
  office: OfficeFontIdentity | { error: string };
  weight: number;
  /** CSS width percentage from OS/2.usWidthClass; absent at normal (100). */
  stretch?: number;
  italic: boolean;
  fsType: number;
  metrics: FontMetrics;
}

/**
 * One `@font-face` rule of a Slide document as Chromium used it (#34): its descriptors, and the face it loaded.
 * Matching uses the descriptors, never the face's own names, as CSS does.
 */
export interface DeclaredFontFace {
  family: string;
  /** inclusive `font-weight` descriptor range */
  weight: readonly [number, number];
  /** inclusive `font-stretch` descriptor range; absent at normal ([100, 100]) */
  stretch?: readonly [number, number];
  italic: boolean;
  /** inclusive code point ranges; absent for every code point */
  unicodeRange?: ReadonlyArray<readonly [number, number]>;
  /** position among the document's rules: of faces with equal descriptors the later one is tried first */
  order: number;
  /** `failed`: Chromium needed the face and none of its sources loaded; `unused`: Chromium never asked for it */
  state: 'loaded' | 'failed' | 'unused';
  /** the loaded face, with `font` for coverage; present exactly when `state` is `loaded` */
  loaded?: { face: FontFace; font: FontKitFont; sfnt: Buffer };
}

type FontExtension = '.ttf' | '.otf' | '.ttc' | '.woff' | '.woff2';

type FontLike = FontKitFont & {
  /** Fontkit keeps each decoded sfnt's table offsets and backing bytes, including collection members. */
  directory?: { tables: Record<string, { offset: number; length: number }> };
  stream?: { buffer: Uint8Array };
  head?: {
    macStyle?: {
      italic?: boolean;
      bold?: boolean;
    };
  };
};

interface CatalogFace extends FontFace {
  order: number;
  file: string;
  /** Source-file identity at scan time, before decoding webfont containers. */
  fileSha256: string;
  collection?: 'TTC' | 'dfont';
}

interface ScanResult {
  faces: CatalogFace[];
  skipped: number;
}

interface InstalledSnapshot {
  bytes: Buffer;
  decoded?: Promise<Buffer | undefined>;
}

const FONT_EXTENSIONS: Record<FontExtension, true> = {
  '.ttf': true,
  '.otf': true,
  '.ttc': true,
  '.woff': true,
  '.woff2': true,
};
const DFONT_EXTENSION = '.dfont';

let systemScanPromise: Promise<ScanResult> | undefined;

export class FontCatalog {
  readonly skipped: number;
  /** opened lazily for installed faces, registered up front for declared ones */
  private readonly fonts = new Map<string, FontKitFont | undefined>();
  private readonly declaredBytes = new Map<string, Buffer>();
  /** Only used files are retained; the first read is checked against scan identity. */
  private readonly installedSnapshots = new Map<string, InstalledSnapshot | undefined>();

  private constructor(
    private readonly installed: readonly CatalogFace[],
    private readonly declaredBySlide: ReadonlyMap<number, ReadonlyMap<string, readonly DeclaredFontFace[]>>,
    skipped: number,
  ) {
    this.skipped = skipped;
    for (const families of declaredBySlide.values()) {
      for (const faces of families.values()) {
        for (const face of faces) {
          if (face.loaded) {
            const key = fontAssetKey(face.loaded.face.asset);
            this.fonts.set(key, face.loaded.font);
            this.declaredBytes.set(key, face.loaded.sfnt);
          }
        }
      }
    }
  }

  /**
   * `declared`: each Slide's `@font-face` rules; they shadow installed faces of the same family name. Omit `system`
   * for host discovery; false or explicit system files isolate a catalog.
   */
  static async scan(opts: { declared?: ReadonlyMap<number, readonly DeclaredFontFace[]>; system?: boolean | readonly string[] } = {}): Promise<FontCatalog> {
    const system = typeof opts.system === 'object' ? await scanFiles(opts.system)
      : opts.system === false ? { faces: [], skipped: 0 } : await scanSystemFaces();
    const bySlide = new Map<number, Map<string, DeclaredFontFace[]>>();
    for (const [slide, faces] of opts.declared ?? []) {
      const families = new Map<string, DeclaredFontFace[]>();
      for (const face of faces) {
        const key = normalizeName(face.family);
        const family = families.get(key);
        if (family) family.push(face);
        else families.set(key, [face]);
      }
      bySlide.set(slide, families);
    }
    return new FontCatalog(system.faces, bySlide, system.skipped);
  }

  /** The installed face CSS matching selects for `family` among its preferred and legacy family names. */
  find(family: string, weight: number, italic: boolean, stretch = 100): FontFace | undefined {
    const familyKey = normalizeName(family);
    if (!familyKey) return undefined;
    let best: CatalogFace | undefined;
    for (const face of this.installed) {
      if (!face.aliases.includes(familyKey)) continue;
      if (!best || compareFaces(face, best, weight, italic, stretch) < 0) best = face;
    }
    return best && cloneFace(best);
  }

  /** The `@font-face` rules declaring `family` in Slide `slide`'s document; empty when it declares none. */
  declared(slide: number, family: string): readonly DeclaredFontFace[] {
    return this.declaredBySlide.get(slide)?.get(normalizeName(family)) ?? [];
  }

  /** Whether the selected face has a glyph for `codePoint`; installed fonts are opened on first use. */
  hasGlyph(face: Pick<FontFace, 'asset'>, codePoint: number): boolean {
    const key = fontAssetKey(face.asset);
    if (!this.fonts.has(key)) {
      const scanned = this.installed.find((candidate) => fontAssetKey(candidate.asset) === key);
      const snapshot = scanned === undefined ? undefined : this.installedSnapshot(scanned);
      this.fonts.set(key, snapshot === undefined ? undefined : openFace(snapshot.bytes, face.asset.faceIndex));
    }
    return this.fonts.get(key)?.hasGlyphForCodePoint(codePoint) ?? false;
  }

  /** Collection identity is retained at scan time, before a dfont could be mistaken for an undecodable sfnt. */
  collectionKind(asset: FontAsset): 'TTC' | 'dfont' | undefined {
    const key = fontAssetKey(asset);
    if (asset.source.kind === 'installed') {
      return this.installed.find((candidate) => fontAssetKey(candidate.asset) === key)?.collection;
    }
    const bytes = this.declaredBytes.get(key);
    return bytes !== undefined && sniffFontFormat(bytes) === 'ttc' ? 'TTC' : undefined;
  }

  /** The trusted measured buffer, or one verified installed snapshot decoded exactly as during scanning. */
  async sfnt(asset: FontAsset): Promise<Buffer | undefined> {
    const key = fontAssetKey(asset);
    if (asset.source.kind !== 'installed') return this.declaredBytes.get(key);
    const file = asset.source.file;
    const scanned = this.installed.find((face) => face.file === file && fontAssetKey(face.asset) === key);
    if (scanned === undefined) return undefined;
    const snapshot = this.installedSnapshot(scanned);
    if (snapshot === undefined || scanned.collection === 'dfont') return undefined;
    snapshot.decoded ??= decodeFont(snapshot.bytes).then(({ sfnt }) => sfnt, () => undefined);
    const sfnt = await snapshot.decoded;
    if (sfnt !== undefined && !this.fonts.has(key)) this.fonts.set(key, openFace(sfnt, asset.faceIndex));
    return sfnt;
  }

  private installedSnapshot(scanned: CatalogFace): InstalledSnapshot | undefined {
    if (!this.installedSnapshots.has(scanned.file)) {
      let snapshot: InstalledSnapshot | undefined;
      try {
        const bytes = readFileSync(scanned.file);
        if (sha256(bytes) === scanned.fileSha256) snapshot = { bytes };
      } catch {
        // An unavailable or changed file cannot establish the selected scan identity.
      }
      this.installedSnapshots.set(scanned.file, snapshot);
    }
    return this.installedSnapshots.get(scanned.file);
  }
}

/** The catalog face for one parsed font: metadata names, weight/style, metrics, permissions and Office identity. */
export function faceFromFont(font: FontKitFont, asset: Omit<FontAsset, 'postscriptName'>): FontFace | undefined {
  return buildFace(font, asset)?.face;
}

/** CSS font matching's stretch, style and weight steps (CSS Fonts 4 §5.2): lower sorts first. */
export function matchScore(
  weight: readonly [number, number], italic: boolean, requestedWeight: number, requestedItalic: boolean,
  stretch: readonly [number, number] = [100, 100], requestedStretch = 100,
): [number, number, number, number, number] {
  return [...stretchScore(stretch, requestedStretch), italic === requestedItalic ? 0 : 1, ...weightScore(weight, requestedWeight)];
}

/** Lexicographic comparison shared by installed and declared CSS face matching. */
export function compareScores(left: readonly number[], right: readonly number[]): number {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return 0;
}

/** Identity of a selected member face, independent of its source or CSS aliases. */
export function fontAssetKey(asset: Pick<FontAsset, 'sha256' | 'faceIndex'>): string {
  return `${asset.sha256}:${asset.faceIndex}`;
}

function openFace(bytes: Buffer, faceIndex: number): FontKitFont | undefined {
  try {
    const opened = fontkit.create(bytes);
    return isCollection(opened) ? opened.fonts[faceIndex] : opened;
  } catch {
    return undefined;
  }
}

async function scanSystemFaces(): Promise<ScanResult> {
  if (!systemScanPromise) {
    systemScanPromise = scanFiles(collectSystemFontFiles());
  }
  return systemScanPromise;
}

async function scanFiles(files: readonly string[]): Promise<ScanResult> {
  const faces: CatalogFace[] = [];
  let skipped = 0;
  let order = 0;
  const seen = new Set<string>();

  for (const file of files) {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const ext = path.extname(resolved).toLowerCase();
    if (!isFontExtension(ext) && ext !== DFONT_EXTENSION) {
      skipped += 1;
      continue;
    }

    const parsed = await scanFontFile(resolved);
    skipped += parsed.skipped;
    for (const face of parsed.faces) {
      faces.push({
        ...face.face, aliases: face.aliases, order: order++, file: resolved, fileSha256: parsed.fileSha256!,
        ...(parsed.collection === undefined ? {} : { collection: parsed.collection }),
      });
    }
  }

  return { faces, skipped };
}

async function scanFontFile(file: string): Promise<{ faces: BuiltFace[]; skipped: number; fileSha256?: string; collection?: 'TTC' | 'dfont' }> {
  try {
    const bytes = readFileSync(file);
    const fileSha256 = sha256(bytes);
    const sfnt = path.extname(file).toLowerCase() === DFONT_EXTENSION ? bytes : (await decodeFont(bytes)).sfnt;
    const digest = sfnt === bytes ? fileSha256 : sha256(sfnt);
    const source = { kind: 'installed' as const, file };
    const opened = fontkit.create(sfnt);
    if (isCollection(opened)) {
      const faces: BuiltFace[] = [];
      for (const [faceIndex, font] of opened.fonts.entries()) {
        const built = buildFace(font, { sha256: digest, faceIndex, source });
        if (built) faces.push(built);
      }
      const collection = path.extname(file).toLowerCase() === DFONT_EXTENSION ? 'dfont' : 'TTC';
      return { faces, skipped: faces.length === 0 ? 1 : 0, fileSha256, collection };
    }

    const built = buildFace(opened, { sha256: digest, faceIndex: 0, source });
    return built ? { faces: [built], skipped: 0, fileSha256 } : { faces: [], skipped: 1 };
  } catch {
    return { faces: [], skipped: 1 };
  }
}

interface BuiltFace {
  face: FontFace;
  aliases: string[];
}

function isCollection(value: FontKitFont | FontKitCollection): value is FontKitCollection {
  return 'fonts' in value;
}

function buildFace(font: FontLike, asset: Omit<FontAsset, 'postscriptName'>): BuiltFace | undefined {
  const familyName = cleanName(font.familyName);
  const preferredFamily = cleanName(font.getName('preferredFamily', 'en')) ?? cleanName(font.getName('preferredFamily', 'und'));
  const family = preferredFamily ?? familyName;
  if (!family) return undefined;

  const subfamily = cleanName(font.subfamilyName) ?? '';
  const os2 = font['OS/2'];
  const weight = normalizeWeight(os2.usWeightClass, subfamily);
  const stretch = WIDTH_CLASS_STRETCH[os2.usWidthClass] ?? 100;
  const italic = normalizeItalic(os2.fsSelection.italic, font.head?.macStyle?.italic, subfamily);
  const fsType = rawFsType(font);
  if (fsType === undefined) return undefined;
  const unitsPerEm = Number(font.unitsPerEm);
  if (!Number.isFinite(unitsPerEm) || unitsPerEm <= 0) return undefined;

  const aliases = new Set<string>();
  aliases.add(family.toLowerCase());
  if (familyName) aliases.add(familyName.toLowerCase());

  return {
    face: {
      aliases: [...aliases],
      asset: { ...asset, postscriptName: cleanName(font.postscriptName) ?? '' },
      office: officeIdentity(font),
      weight,
      ...(stretch === 100 ? {} : { stretch }),
      italic,
      fsType,
      metrics: {
        ascender: font.hhea.ascent / unitsPerEm,
        descender: Math.abs(font.hhea.descent) / unitsPerEm,
      },
    },
    aliases: [...aliases],
  };
}

const OFFICE_STYLES: Readonly<Record<string, OfficeFontStyle>> = {
  regular: 'regular', normal: 'regular', roman: 'regular', book: 'regular',
  bold: 'bold', italic: 'italic', oblique: 'italic',
  bolditalic: 'boldItalic', boldoblique: 'boldItalic',
};

function officeIdentity(font: FontLike): FontFace['office'] {
  if (Object.keys(font.variationAxes).length > 0) {
    return { error: 'Variable font instances do not have a supported Office style-linking identity; use a static face' };
  }
  const family = cleanName(font.familyName);
  const subfamily = cleanName(font.subfamilyName);
  if (!family || !subfamily || !cleanName(font.postscriptName)) {
    return { error: 'Missing legacy family/subfamily (name IDs 1/2) or PostScript face name (name ID 6)' };
  }
  const key = subfamily.toLowerCase().replace(/[\s-]/g, '');
  const style = Object.hasOwn(OFFICE_STYLES, key) ? OFFICE_STYLES[key] : undefined;
  if (!style) return { error: `Legacy subfamily "${subfamily}" does not identify a supported Office RIBBI style` };
  const selection = font['OS/2']?.fsSelection;
  const macStyle = font.head?.macStyle;
  const bold = style === 'bold' || style === 'boldItalic';
  const italic = style === 'italic' || style === 'boldItalic';
  if (!selection || !macStyle) return { error: 'Missing OS/2.fsSelection or head.macStyle style-linking metadata' };
  if (selection.bold !== bold || selection.italic !== italic || macStyle.bold !== bold || macStyle.italic !== italic ||
      (selection.regular && (bold || italic))) {
    return { error: 'Legacy subfamily, OS/2.fsSelection and head.macStyle disagree about Office RIBBI style' };
  }
  return { family, style };
}

/** OpenType OS/2.usWidthClass values correspond to CSS's named width percentages. */
const WIDTH_CLASS_STRETCH: Readonly<Record<number, number>> = {
  1: 50, 2: 62.5, 3: 75, 4: 87.5, 5: 100, 6: 112.5, 7: 125, 8: 150, 9: 200,
};

function normalizeWeight(weight: number | undefined, subfamily: string): number {
  if (weight !== undefined && Number.isFinite(weight) && weight >= 1 && weight <= 1000) {
    return weight;
  }

  const lower = subfamily.toLowerCase();
  if (/extra\s*light|ultra\s*light/.test(lower)) return 200;
  if (/thin|hairline/.test(lower)) return 100;
  if (/light/.test(lower)) return 300;
  if (/semi\s*bold|demi\s*bold/.test(lower)) return 600;
  if (/extra\s*bold|ultra\s*bold/.test(lower)) return 800;
  if (/black|heavy/.test(lower)) return 900;
  if (/bold/.test(lower)) return 700;
  if (/medium/.test(lower)) return 500;
  if (/regular|normal|book|roman/.test(lower)) return 400;
  return 400;
}

function normalizeItalic(fsSelectionItalic: boolean | undefined, macStyleItalic: boolean | undefined, subfamily: string): boolean {
  if (fsSelectionItalic !== undefined) return fsSelectionItalic;
  if (macStyleItalic !== undefined) return macStyleItalic;
  return /italic|oblique/i.test(subfamily);
}

/** Preserve reserved/unknown bits too: fontkit's named flag object omits them. */
function rawFsType(font: FontLike): number | undefined {
  const table = font.directory?.tables['OS/2'];
  const bytes = font.stream?.buffer;
  if (table === undefined || bytes === undefined || table.length < 10 ||
      !Number.isInteger(table.offset) || table.offset < 0 || table.offset + 10 > bytes.length) return undefined;
  return (bytes[table.offset + 8]! << 8) | bytes[table.offset + 9]!;
}

function cloneFace(face: CatalogFace): FontFace {
  return {
    aliases: [...face.aliases],
    asset: face.asset,
    office: face.office,
    weight: face.weight,
    ...(face.stretch === undefined ? {} : { stretch: face.stretch }),
    italic: face.italic,
    fsType: face.fsType,
    metrics: { ...face.metrics },
  };
}

function compareFaces(left: CatalogFace, right: CatalogFace, requestedWeight: number, requestedItalic: boolean, requestedStretch: number): number {
  const leftStretch = left.stretch ?? 100;
  const rightStretch = right.stretch ?? 100;
  const leftScore = matchScore([left.weight, left.weight], left.italic, requestedWeight, requestedItalic, [leftStretch, leftStretch], requestedStretch);
  const rightScore = matchScore([right.weight, right.weight], right.italic, requestedWeight, requestedItalic, [rightStretch, rightStretch], requestedStretch);
  return compareScores(leftScore, rightScore) || left.order - right.order || left.file.localeCompare(right.file);
}

/** At or below normal prefer narrower widths first; above normal prefer wider widths first. */
function stretchScore([lo, hi]: readonly [number, number], requested: number): [number, number] {
  if (lo <= requested && requested <= hi) return [0, 0];
  const above = lo > requested;
  return [above === (requested > 100) ? 1 : 2, above ? lo - requested : requested - hi];
}

/**
 * CSS Fonts 4 weight matching for a face's weight range: a range containing the request matches exactly; for
 * 400-500 the heavier weights up to 500 come next, then lighter ones, then the heavier ones beyond 500; below 400
 * lighter weights come first, above 500 heavier ones. Returns [tier, distance].
 */
function weightScore([lo, hi]: readonly [number, number], requested: number): [number, number] {
  if (lo <= requested && requested <= hi) return [0, 0];
  const above = lo > requested;
  const distance = above ? lo - requested : requested - hi;
  if (requested >= 400 && requested <= 500) {
    if (above) return lo <= 500 ? [1, distance] : [3, distance];
    return [2, distance];
  }
  if (requested < 400) return above ? [2, distance] : [1, distance];
  return above ? [1, distance] : [2, distance];
}

function cleanName(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function isFontExtension(ext: string): ext is FontExtension {
  return ext in FONT_EXTENSIONS;
}

function collectSystemFontFiles(): string[] {
  if (process.platform === 'darwin') {
    return collectFontFiles(['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts')]);
  }

  if (process.platform === 'win32') {
    const windir = process.env.WINDIR ?? 'C:\\Windows';
    const roots = [path.join(windir, 'Fonts')];
    if (process.env.LOCALAPPDATA) {
      roots.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
    }
    return collectFontFiles(roots);
  }

  if (process.platform === 'linux') {
    const fcList = listFcListFiles();
    if (fcList) return fcList;
    return collectFontFiles(["/usr/share/fonts", path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local', 'share', 'fonts')]);
  }

  return collectFontFiles(["/usr/share/fonts", path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local', 'share', 'fonts')]);
}

function listFcListFiles(): string[] | undefined {
  try {
    const stdout = execFileSync('fc-list', ['--format', '%{file}\n'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const seen = new Set<string>();
    const uniqueFiles: string[] = [];
    for (const file of files) {
      const resolved = path.resolve(file);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      uniqueFiles.push(resolved);
    }
    return uniqueFiles;
  } catch {
    return undefined;
  }
}

function collectFontFiles(roots: string[]): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    walkFontRoot(root, files, seen);
  }

  return files;
}

function walkFontRoot(root: string, files: string[], seen: Set<string>): void {
  if (!existsSync(root)) return;

  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFontRoot(fullPath, files, seen);
      continue;
    }
    if (!entry.isFile()) continue;
    const resolved = path.resolve(fullPath);
    if (seen.has(resolved)) continue;
    const ext = path.extname(resolved).toLowerCase();
    if (!isFontExtension(ext) && ext !== DFONT_EXTENSION) continue;
    seen.add(resolved);
    files.push(resolved);
  }
}
