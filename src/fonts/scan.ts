import * as fontkit from 'fontkit';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Font as FontKitFont, FontCollection as FontKitCollection, Os2Table } from 'fontkit';
import type { DeckFontFace, FontAsset, FontMetrics, OfficeFontIdentity, OfficeFontStyle } from '../model/index.js';

export interface FontFace {
  aliases: string[];
  asset: FontAsset;
  office: OfficeFontIdentity | { error: string };
  weight: number;
  italic: boolean;
  fsType: number;
  metrics: FontMetrics;
  format: 'ttf' | 'otf' | 'woff' | 'woff2' | 'ttc';
}

type FontExtension = '.ttf' | '.otf' | '.ttc' | '.woff' | '.woff2';
type FaceSource = 'deck' | 'system';

type FontLike = FontKitFont & {
  head?: {
    macStyle?: {
      italic?: boolean;
      bold?: boolean;
    };
  };
};

interface CatalogFace extends FontFace {
  source: FaceSource;
  order: number;
  declaredFamily?: string;
}

interface ScanResult {
  faces: CatalogFace[];
  skipped: number;
}

interface BuiltFace {
  face: FontFace;
  aliases: string[];
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

  private constructor(private readonly faces: readonly CatalogFace[], skipped: number) {
    this.skipped = skipped;
  }

  /** Omit `system` for host discovery; false or explicit system files isolate a catalog. */
  static async scan(opts: { extraFiles?: string[]; deckFaces?: readonly DeckFontFace[]; system?: boolean | readonly string[] } = {}): Promise<FontCatalog> {
    const [system, extra] = await Promise.all([
      typeof opts.system === 'object' ? scanFiles(opts.system, 'system')
        : opts.system === false ? { faces: [], skipped: 0 } : scanSystemFaces(),
      scanExtraFiles([...(opts.extraFiles ?? []), ...(opts.deckFaces ?? []).map((face) => face.file)]),
    ]);
    const declared = (opts.deckFaces ?? []).flatMap((declaration, index) =>
      extra.faces.filter((face) => face.asset.file === path.resolve(declaration.file)).map((face) => ({
        ...face,
        aliases: [...new Set([...face.aliases, normalizeName(declaration.family)])],
        declaredFamily: normalizeName(declaration.family),
        weight: declaration.weight ?? 400,
        italic: declaration.italic ?? false,
        order: -index,
      })),
    );
    return new FontCatalog([...declared, ...extra.faces, ...system.faces], extra.skipped + system.skipped);
  }

  find(family: string, weight: number, italic: boolean): FontFace | undefined {
    const familyKey = normalizeName(family);
    if (!familyKey) return undefined;

    const declared = this.faces.filter((face) => face.declaredFamily === familyKey);
    const matches = declared.length > 0 ? declared : this.faces.filter((face) => face.declaredFamily === undefined && face.aliases.includes(familyKey));
    if (matches.length === 0) return undefined;

    const sorted = [...matches].sort((left, right) => compareFaces(left, right, weight, italic));
    return cloneFace(sorted[0]!);
  }
}

async function scanSystemFaces(): Promise<ScanResult> {
  if (!systemScanPromise) {
    systemScanPromise = loadSystemFaces();
  }
  return systemScanPromise;
}

async function loadSystemFaces(): Promise<ScanResult> {
  return scanFiles(collectSystemFontFiles(), 'system');
}

async function scanExtraFiles(files: string[]): Promise<ScanResult> {
  return scanFiles(files, 'deck');
}

function scanFiles(files: readonly string[], source: FaceSource): ScanResult {
  const faces: CatalogFace[] = [];
  let skipped = 0;
  let order = 0;
  const seen = new Set<string>();

  for (const file of files) {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const ext = path.extname(resolved).toLowerCase();
    if (ext === DFONT_EXTENSION || !isFontExtension(ext)) {
      skipped += 1;
      continue;
    }

    const parsed = scanFontFile(resolved, ext);
    skipped += parsed.skipped;
    for (const face of parsed.faces) {
      faces.push({ ...face.face, aliases: face.aliases, source, order: order++ });
    }
  }

  return { faces, skipped };
}

function scanFontFile(file: string, ext: FontExtension): { faces: BuiltFace[]; skipped: number } {
  try {
    const bytes = readFileSync(file);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const opened = fontkit.create(bytes);
    if (isCollection(opened)) {
      if (opened.type === 'DFont') {
        return { faces: [], skipped: 1 };
      }

      const faces: BuiltFace[] = [];
      for (const [faceIndex, font] of opened.fonts.entries()) {
        const built = buildFace(font, { file, sha256, faceIndex }, ext);
        if (built) faces.push(built);
      }
      return { faces, skipped: faces.length === 0 ? 1 : 0 };
    }

    const built = buildFace(opened, { file, sha256, faceIndex: 0 }, ext);
    return built ? { faces: [built], skipped: 0 } : { faces: [], skipped: 1 };
  } catch {
    return { faces: [], skipped: 1 };
  }
}

function isCollection(value: FontKitFont | FontKitCollection): value is FontKitCollection {
  return 'fonts' in value;
}

function buildFace(font: FontLike, asset: Omit<FontAsset, 'postscriptName'>, ext: FontExtension): BuiltFace | undefined {
  const familyName = cleanName(font.familyName);
  const preferredFamily = cleanName(font.getName('preferredFamily', 'en')) ?? cleanName(font.getName('preferredFamily', 'und'));
  const family = preferredFamily ?? familyName;
  if (!family) return undefined;

  const subfamily = cleanName(font.subfamilyName) ?? '';
  const os2 = font['OS/2'];
  const weight = normalizeWeight(os2.usWeightClass, subfamily);
  const italic = normalizeItalic(os2.fsSelection.italic, font.head?.macStyle?.italic, subfamily);
  const fsType = normalizeFsType(os2.fsType);
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
      italic,
      fsType,
      metrics: {
        ascender: font.hhea.ascent / unitsPerEm,
        descender: Math.abs(font.hhea.descent) / unitsPerEm,
      },
      format: ext.slice(1) as FontFace['format'],
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

function normalizeFsType(fsType: Os2Table['fsType']): number {
  return (
    (fsType.noEmbedding ? 0b10 : 0) |
    (fsType.viewOnly ? 0b100 : 0) |
    (fsType.editable ? 0b1000 : 0) |
    (fsType.noSubsetting ? 0x100 : 0) |
    (fsType.bitmapOnly ? 0x200 : 0)
  );
}

function cloneFace(face: CatalogFace): FontFace {
  return {
    aliases: [...face.aliases],
    asset: face.asset,
    office: face.office,
    weight: face.weight,
    italic: face.italic,
    fsType: face.fsType,
    metrics: { ...face.metrics },
    format: face.format,
  };
}

function compareFaces(left: CatalogFace, right: CatalogFace, requestedWeight: number, requestedItalic: boolean): number {
  const leftSource = left.source === 'deck' ? 0 : 1;
  const rightSource = right.source === 'deck' ? 0 : 1;
  if (leftSource !== rightSource) return leftSource - rightSource;

  const leftItalic = left.italic === requestedItalic ? 0 : 1;
  const rightItalic = right.italic === requestedItalic ? 0 : 1;
  if (leftItalic !== rightItalic) return leftItalic - rightItalic;

  const leftWeight = weightScore(left.weight, requestedWeight);
  const rightWeight = weightScore(right.weight, requestedWeight);
  if (leftWeight[0] !== rightWeight[0]) return leftWeight[0] - rightWeight[0];
  if (leftWeight[1] !== rightWeight[1]) return leftWeight[1] - rightWeight[1];

  if (left.order !== right.order) return left.order - right.order;
  return left.asset.file.localeCompare(right.asset.file);
}

function weightScore(candidate: number, requested: number): [number, number] {
  if (requested <= 500) {
    return candidate <= requested ? [0, requested - candidate] : [1, candidate - requested];
  }
  return candidate >= requested ? [0, candidate - requested] : [1, requested - candidate];
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
    if (!isFontExtension(ext)) continue;
    seen.add(resolved);
    files.push(resolved);
  }
}
