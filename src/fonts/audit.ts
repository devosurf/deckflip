// The font audit (#34): every text node Chromium drew, checked against the face deckflip selected for it. The
// selected face's character map says which characters it lacks; Chromium's own record of the platform fonts it
// drew the node with (CSS.getPlatformFontsForNode) says what it used instead. That record names fonts, not
// files, so it is evidence of fallback, not an identity: the selected face's PostScript name must account for
// every glyph.

import { entry } from '../report/codes.js';
import type { Entry } from '../report/types.js';
import { applyEmbeddingOptOut } from './embedding.js';
import { countableCodePoints, inUnicodeRange, listCodePoints, resolveFont } from './resolve.js';
import type { FontCatalog, FontFace } from './scan.js';
import { fontAssetKey } from './scan.js';

/** One font Chromium drew glyphs of a text node with. */
export interface PlatformFontUsage {
  familyName: string;
  postScriptName: string;
  /** a web font from `@font-face`, not an installed one */
  isCustomFont: boolean;
  glyphCount: number;
}

/** A text node Chromium drew on a Slide: what it asks of fonts, and the fonts Chromium drew it with. */
export interface VisibleText {
  slide: number;
  /** the text's owner, as the Census names it */
  selector: string;
  fontStack: string[];
  weight: number;
  italic: boolean;
  /** Computed CSS width percentage, omitted at normal (100%). */
  stretch?: number;
  text: string;
  fonts: PlatformFontUsage[];
}

/** `FONT_GLYPH_FALLBACK` once per owner and selected face whose text Chromium drew with anything but that face. */
export function auditVisibleFonts(visible: readonly VisibleText[], catalog: FontCatalog, opts: { embedFonts: boolean }): Entry[] {
  const entries: Entry[] = [];
  const reported = new Set<string>();
  const installedCache = new Map<string, FontFace | undefined>();
  for (const node of visible) {
    const outcome = resolveFont({
      slide: node.slide, stack: node.fontStack, weight: node.weight, italic: node.italic,
      ...(node.stretch === undefined ? {} : { stretch: node.stretch }), text: node.text,
    }, catalog, installedCache);
    if (outcome.kind !== 'resolved') continue;
    const { face, font } = outcome;
    const custom = font.asset.source.kind !== 'installed';
    const declared = custom ? catalog.declared(node.slide, font.cssFamily) : [];
    const range = declared.find((candidate) => candidate.loaded?.face === face);
    const missing = countableCodePoints(node.text).filter((codePoint) =>
      (range !== undefined && !inUnicodeRange(range, codePoint)) || !catalog.hasGlyph(face, codePoint));
    const others = node.fonts.filter((used) => used.glyphCount > 0 &&
      !(used.postScriptName === face.asset.postscriptName && used.isCustomFont === custom));
    if (missing.length === 0 && others.length === 0) continue;

    const key = `${node.slide}\u0000${node.selector}\u0000${fontAssetKey(face.asset)}`;
    if (reported.has(key)) continue;
    reported.add(key);
    // PostScript names: family names come localized (PingFang SC is `蘋方-簡` on some hosts).
    const drawn = others.map((used) => ({ name: used.postScriptName || used.familyName, count: used.glyphCount }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, count }) => `${name} (${count} glyph${count === 1 ? '' : 's'})`).join(', ');
    const selected = `${font.office.family} (${font.cssFamily})`;
    const reason = missing.length === 0 ? `${selected}: Chromium also drew the text with ${drawn}`
      : `${selected} has no glyph for ${listCodePoints(missing)}${others.length > 0 ? `; Chromium drew them with ${drawn}` : ''}`;
    const reportEntry = entry('FONT_GLYPH_FALLBACK', {
      slide: node.slide,
      locator: { selector: node.selector },
      reason,
      params: { family: font.cssFamily },
    });
    entries.push(applyEmbeddingOptOut(reportEntry, opts.embedFonts));
  }
  return entries;
}

