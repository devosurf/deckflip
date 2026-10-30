import { textBodiesOf, type Deck, type FontClass, type ResolvedFont } from '../model/index.js';
import { CODES, entry } from '../report/codes.js';
import type { Entry, EntryKind, Severity } from '../report/types.js';
import { FontCatalog, compareScores, fontAssetKey, matchScore, type DeclaredFontFace, type FontFace } from './scan.js';

export const SAFE_FAMILIES: ReadonlySet<string> = new Set([
  'arial',
  'courier new',
  'georgia',
  'times new roman',
  'trebuchet ms',
  'verdana',
  'aptos',
  'aptos display',
  'aptos narrow',
  'aptos mono',
  'aptos serif',
  'calibri',
  'cambria',
  'candara',
  'consolas',
  'constantia',
  'corbel',
  'franklin gothic',
  'century gothic',
]);

export const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'cursive',
  'fantasy',
  'math',
  'emoji',
  'fangsong',
]);

const FONT_ENTRY_SPECS: Record<
  'FONT_GENERIC_ONLY' | 'FONT_UNRESOLVED' | 'FONT_NOT_SAFE' | 'FONT_IDENTITY_INVALID',
  { kind: EntryKind; severity: Severity; hint: string }
> = {
  FONT_IDENTITY_INVALID: CODES.FONT_IDENTITY_INVALID,
  FONT_GENERIC_ONLY: {
    kind: 'error',
    severity: 'error',
    hint: 'Put a concrete family before {generic}',
  },
  FONT_UNRESOLVED: {
    kind: 'error',
    severity: 'error',
    hint: 'Install {family} or add a safe family such as Arial to the stack',
  },
  FONT_NOT_SAFE: {
    kind: 'substituted',
    severity: 'warning',
    hint: 'Use a safe font, or install the Resolved font on every viewing machine; font embedding is not supported',
  },
};

/** What a run, or a text node Chromium drew, asks of fonts. */
export interface FontRequest {
  slide: number;
  /** computed `font-family`, quotes stripped */
  stack: readonly string[];
  weight: number;
  /** computed `font-stretch` percentage; absent at normal (100) */
  stretch?: number;
  italic: boolean;
  /** the characters shown, after `text-transform` */
  text: string;
}

export type Resolution =
  | { kind: 'resolved'; font: ResolvedFont; face: FontFace }
  | { kind: 'error'; code: 'FONT_GENERIC_ONLY' | 'FONT_UNRESOLVED' | 'FONT_IDENTITY_INVALID'; stackKey: string; family: string; generic?: string; reason?: string }
  /** a declared face Chromium needed did not load: its acquisition entry is the report */
  | { kind: 'unavailable' };

/**
 * The Resolved font CSS selects for `request`. A family the Slide's document declares with `@font-face` matches
 * only those rules, by their descriptors, and among faces whose descriptors tie (unicode-range subsets) the face
 * covering most of the text; any other family matches installed faces by name.
 */
export function resolveFont(request: FontRequest, catalog: FontCatalog, installedCache = new Map<string, FontFace | undefined>()): Resolution {
  const stack = normalizeStack(request.stack);
  const stackKey = stack.join('\u0001');
  let codePoints: number[] | undefined;
  for (const family of stack) {
    if (GENERIC_FAMILIES.has(normalizeName(family))) {
      // Chromium always resolves a generic, so the layout is machine-dependent whatever follows it.
      return { kind: 'error', code: 'FONT_GENERIC_ONLY', stackKey, generic: family, family };
    }

    const declared = catalog.declared(request.slide, family);
    if (declared.length > 0) {
      codePoints ??= countableCodePoints(request.text);
      const pick = selectDeclared(declared, request.weight, request.italic, codePoints, request.stretch ?? 100);
      if (pick === 'unavailable') return { kind: 'unavailable' };
      if (pick === undefined) continue;
      return resolved(pick.loaded!.face, family, 'deck-provided', stackKey, request, pick.unicodeRange);
    }

    const key = `${normalizeName(family)}|${request.stretch ?? 100}|${request.weight}|${request.italic}`;
    if (!installedCache.has(key)) installedCache.set(key, catalog.find(family, request.weight, request.italic, request.stretch));
    const face = installedCache.get(key);
    if (face) return resolved(face, family, face.aliases.some((alias) => SAFE_FAMILIES.has(alias)) ? 'safe' : 'installed', stackKey, request);
  }
  return { kind: 'error', code: 'FONT_UNRESOLVED', stackKey, family: firstConcreteFamily(stack) ?? stack[0] ?? '' };
}

export function resolveDeckFonts(deck: Deck, catalog: FontCatalog, opts: { embedFonts: false | true | string[] }): Entry[] {
  const warnings = new Set<string>();
  const restricted = new Set<string>();
  const emittedStacks = new Set<string>();
  const installedCache = new Map<string, FontFace | undefined>();
  const entries: Entry[] = [];
  if (opts.embedFonts !== false) {
    entries.push(entry('FONT_EMBED_UNSUPPORTED', { reason: 'Font embedding is not supported; no font faces were embedded' }));
  }

  for (const slide of deck.slides) {
    for (const element of slide.elements) {
      for (const { body, selector } of textBodiesOf(element)) {
        for (const paragraph of body.paragraphs) {
          for (const run of paragraph.runs) {
            if (run.kind !== 'text') continue;
            delete run.style.font;
            const outcome = resolveFont({ slide: slide.index, stack: run.style.fontStack, weight: run.style.weight, stretch: run.style.stretch ?? 100, italic: run.style.italic, text: run.text }, catalog, installedCache);
            if (outcome.kind === 'unavailable') continue;
            if (outcome.kind === 'error') {
              if (emittedStacks.has(outcome.stackKey)) continue;
              emittedStacks.add(outcome.stackKey);
              entries.push(buildEntry(outcome, slide.index, selector));
              continue;
            }

            const resolvedFont = outcome.font;
            run.style.font = resolvedFont;
            const assetKey = fontAssetKey(resolvedFont.asset);
            const permission = resolvedFont.class === 'deck-provided' ? embeddingRestriction(resolvedFont.fsType) : undefined;
            if (permission !== undefined && !restricted.has(assetKey)) {
              restricted.add(assetKey);
              entries.push(entry('FONT_EMBED_RESTRICTED', {
                slide: slide.index,
                locator: { selector },
                reason: `${resolvedFont.office.family} (${resolvedFont.asset.postscriptName}) has OS/2 fsType 0x${resolvedFont.fsType.toString(16).padStart(4, '0')}: ${permission}`,
                params: { family: resolvedFont.office.family },
              }));
            }

            if (resolvedFont.class === 'safe') continue;
            const resolvedFamilyKey = normalizeName(resolvedFont.office.family);
            if (warnings.has(resolvedFamilyKey)) continue;
            warnings.add(resolvedFamilyKey);
            entries.push(buildEntryForSafeWarning(slide.index, selector, resolvedFont.office.family));
          }
        }
      }
    }
  }

  return entries;
}

/** Each selected face once, with the last run's CSS match: the provenance inspect and the Conversion report list. */
export function resolvedFontsOf(deck: Deck): ResolvedFont[] {
  const fonts = new Map<string, ResolvedFont>();
  for (const slide of deck.slides) {
    for (const element of slide.elements) {
      for (const { body } of textBodiesOf(element)) {
        for (const paragraph of body.paragraphs) {
          for (const run of paragraph.runs) {
            if (run.kind !== 'text' || run.style.font === undefined) continue;
            const { asset } = run.style.font;
            fonts.set(fontAssetKey(asset), run.style.font);
          }
        }
      }
    }
  }
  return [...fonts.values()];
}

/** Code points whose glyphs matter for coverage: whitespace, controls, joiners and variation selectors are left out. */
export function countableCodePoints(text: string): number[] {
  const seen = new Set<number>();
  for (const char of text) {
    if (/[\s\p{Cc}\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u.test(char)) continue;
    seen.add(char.codePointAt(0)!);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Whether a declared face's `unicode-range` includes `codePoint`. */
export function inUnicodeRange(face: Pick<DeclaredFontFace, 'unicodeRange'>, codePoint: number): boolean {
  return face.unicodeRange === undefined || face.unicodeRange.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);
}

/** Canonical `unicode-range` serialization: `U+0-FF, U+131`. */
export function formatUnicodeRange(ranges: ReadonlyArray<readonly [number, number]>): string {
  const hex = (value: number) => value.toString(16).toUpperCase();
  return ranges.map(([lo, hi]) => (lo === hi ? `U+${hex(lo)}` : `U+${hex(lo)}-${hex(hi)}`)).join(', ');
}

/**
 * Of the declared faces whose stretch, style and weight descriptors match best, the loaded one covering most code points
 * (the later rule on a tie, as Chromium tries later rules first). Undefined when none covers any, so CSS moves on
 * to the next family; `unavailable` when a face that would have covered them failed to load.
 */
function selectDeclared(faces: readonly DeclaredFontFace[], weight: number, italic: boolean, codePoints: readonly number[], stretch: number): DeclaredFontFace | 'unavailable' | undefined {
  const scored = faces.map((face) => ({ face, score: matchScore(face.weight, face.italic, weight, italic, face.stretch, stretch) }));
  const best = scored.reduce((min, { score }) => (compareScores(score, min) < 0 ? score : min), scored[0]!.score);
  const group = scored.filter(({ score }) => compareScores(score, best) === 0).map(({ face }) => face);
  const loaded = group.filter((face) => face.state === 'loaded').sort((a, b) => b.order - a.order);

  if (codePoints.length === 0) {
    const space = loaded.find((face) => inUnicodeRange(face, 0x20)) ?? loaded[0];
    if (space) return space;
    return group.some((face) => face.state === 'failed') ? 'unavailable' : undefined;
  }

  let pick: DeclaredFontFace | undefined;
  let pickCount = 0;
  for (const face of loaded) {
    const count = codePoints.filter((codePoint) => inUnicodeRange(face, codePoint) && face.loaded!.font.hasGlyphForCodePoint(codePoint)).length;
    if (count > pickCount) {
      pick = face;
      pickCount = count;
    }
  }
  if (pick) return pick;
  return group.some((face) => face.state === 'failed' && codePoints.some((codePoint) => inUnicodeRange(face, codePoint))) ? 'unavailable' : undefined;
}

function resolved(face: FontFace, cssFamily: string, fontClass: FontClass, stackKey: string, request: FontRequest, unicodeRange?: DeclaredFontFace['unicodeRange']): Resolution {
  if ('error' in face.office) {
    return {
      kind: 'error', code: 'FONT_IDENTITY_INVALID', stackKey: `${stackKey}|${request.stretch ?? 100}|${request.weight}|${request.italic}`, family: cssFamily,
      reason: `${cssFamily}: ${face.office.error}`,
    };
  }
  return {
    kind: 'resolved',
    face,
    font: {
      cssFamily,
      aliases: face.aliases,
      asset: face.asset,
      office: face.office,
      class: fontClass,
      metrics: { ...face.metrics },
      fsType: face.fsType,
      ...(unicodeRange === undefined ? {} : { unicodeRange: formatUnicodeRange(unicodeRange) }),
    },
  };
}

/**
 * Why `fsType` rules out editable embedding (#33), or undefined when it allows it: installable (0) and editable
 * (0x0008) usage, with or without no-subsetting (0x0100), are usable; restricted (0x0002) and preview & print
 * (0x0004) are not, nor is any bitmap-only (0x0200) face. Of several usage bits the least restrictive applies.
 */
function embeddingRestriction(fsType: number): string | undefined {
  if (fsType & 0x0200) return 'bitmap embedding only (0x0200), so its outlines may not be embedded';
  if (fsType & 0x0008) return undefined;
  if (fsType & 0x0004) return 'preview & print embedding only (0x0004), which makes an embedding Deck read-only';
  if (fsType & 0x0002) return 'restricted licence embedding (0x0002)';
  return undefined;
}

function buildEntry(outcome: Extract<Resolution, { kind: 'error' }>, slide: number, selector: string): Entry {
  const spec = FONT_ENTRY_SPECS[outcome.code];
  const params = outcome.code === 'FONT_GENERIC_ONLY' ? { generic: outcome.generic ?? outcome.family } : { family: outcome.family };
  return {
    code: outcome.code,
    kind: spec.kind,
    severity: spec.severity,
    slide,
    locator: { selector },
    reason: outcome.reason ?? (outcome.code === 'FONT_GENERIC_ONLY'
      ? `Generic family ${outcome.generic ?? outcome.family} appears before any resolvable concrete family`
      : `No deck-provided or installed family resolved in stack ${outcome.stackKey}`),
    hint: substituteHint(spec.hint, params),
  };
}

function buildEntryForSafeWarning(slide: number, selector: string, family: string): Entry {
  const spec = FONT_ENTRY_SPECS.FONT_NOT_SAFE;
  return {
    code: 'FONT_NOT_SAFE',
    kind: spec.kind,
    severity: spec.severity,
    slide,
    locator: { selector },
    reason: `Resolved font ${family} is not in the safe set`,
    hint: spec.hint,
  };
}

function substituteHint(template: string, params: { family?: string; generic?: string }): string {
  return template
    .replace('{family}', params.family ?? '')
    .replace('{generic}', params.generic ?? '');
}

/** Trimmed, empties dropped; casing is kept so messages quote the author's spelling (matching is case-insensitive downstream). */
function normalizeStack(stack: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const entry of stack) {
    const name = entry.trim();
    if (name) normalized.push(name);
  }
  return normalized;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function firstConcreteFamily(stack: readonly string[]): string | undefined {
  for (const family of stack) {
    if (!GENERIC_FAMILIES.has(normalizeName(family))) return family;
  }
  return undefined;
}
