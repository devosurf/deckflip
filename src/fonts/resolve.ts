import { textBodiesOf, type Deck, type DeckFontFace, type ResolvedFont } from '../model/index.js';
import type { Entry, EntryKind, Severity } from '../report/types.js';
import { FontCatalog, type FontFace } from './scan.js';

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
  'FONT_GENERIC_ONLY' | 'FONT_UNRESOLVED' | 'FONT_NOT_SAFE',
  { kind: EntryKind; severity: Severity; hint: string }
> = {
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
    hint: 'Use a safe font, or pass --embed-fonts',
  },
};

type Resolution =
  | { kind: 'resolved'; font: FontFace }
  | { kind: 'error'; code: 'FONT_GENERIC_ONLY' | 'FONT_UNRESOLVED'; stackKey: string; family: string; generic?: string };

export function resolveDeckFonts(deck: Deck, catalog: FontCatalog, opts: { embedFonts: false | true | string[] }): Entry[] {
  const deckProvidedFamilies = familySetFromDeckFaces(deck.fontFaces);
  const deckProvidedFiles = fileSetFromDeckFaces(deck.fontFaces);
  const embeddedFamilies = opts.embedFonts === true ? new Set<string>() : familySetFromList(opts.embedFonts === false ? [] : opts.embedFonts);
  const embedAll = opts.embedFonts === true;
  const warnings = new Set<string>();
  const emittedStacks = new Set<string>();
  const resolvedFontCache = new Map<string, FontFace | undefined>();
  const stackCache = new Map<string, Resolution>();
  const entries: Entry[] = [];

  for (const slide of deck.slides) {
    for (const element of slide.elements) {
      for (const { body, selector } of textBodiesOf(element)) {
        for (const paragraph of body.paragraphs) {
          for (const run of paragraph.runs) {
            if (run.kind !== 'text') continue;
            const normalizedStack = normalizeStack(run.style.fontStack);
            const outcome = resolveStack(normalizedStack, run.style.weight, run.style.italic, catalog, stackCache, resolvedFontCache);
            if (outcome.kind === 'error') {
              if (emittedStacks.has(outcome.stackKey)) continue;
              emittedStacks.add(outcome.stackKey);
              entries.push(buildEntry(outcome, slide.index, selector));
              continue;
            }
  
            const resolvedFamilyKey = normalizeName(outcome.font.family);
            const resolvedFont: ResolvedFont = {
              family: outcome.font.family,
              file: outcome.font.file,
              class: deckProvidedFamilies.has(resolvedFamilyKey) || deckProvidedFiles.has(outcome.font.file)
                ? 'deck-provided'
                : SAFE_FAMILIES.has(resolvedFamilyKey)
                  ? 'safe'
                  : 'installed',
              metrics: { ...outcome.font.metrics },
              fsType: outcome.font.fsType,
            };
            run.style.font = resolvedFont;
  
            if (resolvedFont.class === 'safe') continue;
            if (embedAll) continue;
  
            const isEmbedded = stackContainsEmbeddedFamily(normalizedStack, resolvedFamilyKey, embeddedFamilies);
            if (isEmbedded || warnings.has(resolvedFamilyKey)) continue;
            warnings.add(resolvedFamilyKey);
            entries.push(buildEntryForSafeWarning(slide.index, selector, outcome.font.family));
          }
        }
      }
    }
  }

  return entries;
}

function resolveStack(
  stack: readonly string[],
  weight: number,
  italic: boolean,
  catalog: FontCatalog,
  stackCache: Map<string, Resolution>,
  resolvedFontCache: Map<string, FontFace | undefined>,
): Resolution {
  const stackKey = stack.join('\u0001');
  const memoKey = `${stackKey}|${weight}|${italic}`;
  const cached = stackCache.get(memoKey);
  if (cached) return cached;

  for (let index = 0; index < stack.length; index += 1) {
    const family = stack[index];
    if (!family) continue;

    if (GENERIC_FAMILIES.has(normalizeName(family))) {
      // Chromium always resolves a generic, so the layout is machine-dependent whatever follows it.
      const error: Resolution = { kind: 'error', code: 'FONT_GENERIC_ONLY', stackKey, generic: family, family };
      stackCache.set(memoKey, error);
      return error;
    }

    const face = lookupFace(catalog, resolvedFontCache, family, weight, italic);
    if (face) {
      const resolved: Resolution = { kind: 'resolved', font: face };
      stackCache.set(memoKey, resolved);
      return resolved;
    }
  }

  const unresolved: Resolution = {
    kind: 'error',
    code: 'FONT_UNRESOLVED',
    stackKey,
    family: firstConcreteFamily(stack) ?? stack[0] ?? '',
  };
  stackCache.set(memoKey, unresolved);
  return unresolved;
}

function lookupFace(
  catalog: FontCatalog,
  resolvedFontCache: Map<string, FontFace | undefined>,
  family: string,
  weight: number,
  italic: boolean,
): FontFace | undefined {
  const key = `${normalizeName(family)}|${weight}|${italic}`;
  if (resolvedFontCache.has(key)) return resolvedFontCache.get(key);

  const face = catalog.find(family, weight, italic);
  resolvedFontCache.set(key, face);
  return face;
}

function stackContainsEmbeddedFamily(stack: readonly string[], resolvedFamilyKey: string, embeddedFamilies: ReadonlySet<string>): boolean {
  if (embeddedFamilies.has(resolvedFamilyKey)) return true;
  for (const family of stack) {
    if (embeddedFamilies.has(normalizeName(family))) return true;
  }
  return false;
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
    reason: outcome.code === 'FONT_GENERIC_ONLY'
      ? `Generic family ${outcome.generic ?? outcome.family} appears before any resolvable concrete family`
      : `No deck-provided or installed family resolved in stack ${outcome.stackKey}`,
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

function familySetFromDeckFaces(faces: readonly DeckFontFace[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const face of faces) {
    const family = normalizeName(face.family);
    if (family) names.add(family);
  }
  return names;
}

function fileSetFromDeckFaces(faces: readonly DeckFontFace[]): ReadonlySet<string> {
  const files = new Set<string>();
  for (const face of faces) {
    const file = face.file.trim();
    if (file) files.add(file);
  }
  return files;
}

function familySetFromList(list: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const family of list) {
    const normalized = normalizeName(family);
    if (normalized) names.add(normalized);
  }
  return names;
}

function firstConcreteFamily(stack: readonly string[]): string | undefined {
  for (const family of stack) {
    if (!GENERIC_FAMILIES.has(normalizeName(family))) return family;
  }
  return undefined;
}
