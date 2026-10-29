// The font audit (#34): every text node Chromium drew, checked against the face deckflip selected for it. The
// selected face's character map says which characters it lacks; Chromium's own record of the platform fonts it
// drew the node with (CSS.getPlatformFontsForNode) says what it used instead. That record names fonts, not
// files, so it is evidence of fallback, not an identity: the selected face's PostScript name must account for
// every glyph.

import { entry } from '../report/codes.js';
import type { Entry } from '../report/types.js';
import { countableCodePoints, inUnicodeRange, resolveFont } from './resolve.js';
import type { FontCatalog, FontFace } from './scan.js';

/** One font Chromium drew glyphs of a text node with. */
export interface PlatformFontUsage {
  familyName: string;
  postScriptName: string;
  /** a web font from `@font-face`, not an installed one */
  isCustomFont: boolean;
  glyphCount: number;
}

/** A text node Chromium drew on a Slide: what it asks of fonts, and the fonts Chromium drew it with. */
export interface RenderedText {
  slide: number;
  /** the text's owner, as the Census names it */
  selector: string;
  fontStack: string[];
  weight: number;
  italic: boolean;
  text: string;
  fonts: PlatformFontUsage[];
}

const MAX_LISTED = 8;

/** `FONT_GLYPH_FALLBACK` once per owner and selected face whose text Chromium drew with anything but that face. */
export function auditRenderedFonts(rendered: readonly RenderedText[], catalog: FontCatalog): Entry[] {
  const entries: Entry[] = [];
  const reported = new Set<string>();
  const installedCache = new Map<string, FontFace | undefined>();
  for (const node of rendered) {
    const outcome = resolveFont({ slide: node.slide, stack: node.fontStack, weight: node.weight, italic: node.italic, text: node.text }, catalog, installedCache);
    if (outcome.kind !== 'resolved') continue;
    const { face, font } = outcome;
    const declared = font.class === 'deck-provided' ? catalog.declared(node.slide, font.cssFamily) : [];
    const range = declared.find((candidate) => candidate.loaded?.face === face);
    const missing = countableCodePoints(node.text).filter((codePoint) =>
      (range !== undefined && !inUnicodeRange(range, codePoint)) || !catalog.hasGlyph(face, codePoint));
    const others = node.fonts.filter((used) => used.glyphCount > 0 &&
      !(used.postScriptName === face.asset.postscriptName && used.isCustomFont === (font.class === 'deck-provided')));
    if (missing.length === 0 && others.length === 0) continue;

    const key = `${node.slide}\u0000${node.selector}\u0000${face.asset.sha256}:${face.asset.faceIndex}`;
    if (reported.has(key)) continue;
    reported.add(key);
    // PostScript names: family names come localized (PingFang SC is `蘋方-簡` on some hosts).
    const drawn = others.map((used) => ({ name: used.postScriptName || used.familyName, count: used.glyphCount }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, count }) => `${name} (${count} glyph${count === 1 ? '' : 's'})`).join(', ');
    const selected = `${font.office.family} (${font.cssFamily})`;
    const reason = missing.length === 0 ? `${selected}: Chromium also drew the text with ${drawn}`
      : `${selected} has no glyph for ${listCodePoints(missing)}${others.length > 0 ? `; Chromium drew them with ${drawn}` : ''}`;
    entries.push(entry('FONT_GLYPH_FALLBACK', {
      slide: node.slide,
      locator: { selector: node.selector },
      reason,
      params: { family: font.cssFamily },
    }));
  }
  return entries;
}

function listCodePoints(codePoints: readonly number[]): string {
  const shown = codePoints.slice(0, MAX_LISTED).map((codePoint) => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} ${String.fromCodePoint(codePoint)}`);
  return codePoints.length > MAX_LISTED ? `${shown.join(', ')} and ${codePoints.length - MAX_LISTED} more` : shown.join(', ');
}
