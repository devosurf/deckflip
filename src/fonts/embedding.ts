import { textBodiesOf, type Deck, type ResolvedFont } from '../model/index.js';
import { entry } from '../report/codes.js';
import type { Entry } from '../report/types.js';
import { validateEotSource } from './eot.js';
import { countableCodePoints, listCodePoints } from './resolve.js';
import { FontCatalog, fontAssetKey } from './scan.js';
import { sniffFontFormat } from './sfnt.js';

/** Editable/installable usage and the no-subsetting bit are the supported editable embedding permissions. */
export const ACCEPTED_EDITABLE_FSTYPE_MASK = 0x0108;

/** Downgrade a portability-only Report entry when the author explicitly accepts machine-dependent output. */
export function applyEmbeddingOptOut(reportEntry: Entry, embedFonts: boolean): Entry {
  if (!embedFonts) {
    reportEntry.kind = 'flagged';
    reportEntry.severity = 'warning';
  }
  return reportEntry;
}

/** Exact decoded bytes selected for measurement; never a reconstructed or merged face. */
export interface EmbeddableFont {
  font: ResolvedFont;
  sfnt: Buffer;
  subset?: true;
}

/**
 * Assess every used face, retaining the same buffers that declared faces served to Chromium and checking
 * installed files against their scan identity. Eligibility is not successful packaging.
 */
export async function prepareFontEmbedding(
  deck: Deck, catalog: FontCatalog, opts: { embedFonts: boolean },
): Promise<{ fonts: EmbeddableFont[]; entries: Entry[] }> {
  interface UsedFace {
    font: ResolvedFont;
    references: ResolvedFont[];
    points: Set<number>;
    slide: number;
    selector: string;
    sfnt?: Buffer;
    valid: boolean;
  }
  const used = new Map<string, UsedFace>();
  for (const slide of deck.slides) {
    for (const element of slide.elements) {
      for (const { body, selector } of textBodiesOf(element)) {
        for (const paragraph of body.paragraphs) {
          for (const run of paragraph.runs) {
            if (run.kind !== 'text' || run.style.embeddedFont !== undefined || run.style.font === undefined) continue;
            const font = run.style.font;
            delete font.embedding;
            const key = fontAssetKey(font.asset);
            let face = used.get(key);
            if (face === undefined) {
              face = { font, references: [], points: new Set(), slide: slide.index, selector, valid: true };
              used.set(key, face);
            }
            face.references.push(font);
            for (const point of countableCodePoints(run.text)) face.points.add(point);
            run.style.font = face.font;
          }
        }
      }
    }
  }
  const entries: Entry[] = [];
  const report = (code: 'FONT_EMBED_FORMAT' | 'FONT_EMBED_RESTRICTED' | 'FONT_EMBED_COVERAGE', face: UsedFace, reason: string) => {
    face.valid = false;
    entries.push(applyEmbeddingOptOut(entry(code, {
      slide: face.slide, locator: { selector: face.selector }, reason, params: { family: face.font.office.family },
    }), opts.embedFonts));
  };
  const slots = new Map<string, UsedFace[]>();
  for (const face of used.values()) {
    const { font } = face;
    const collection = catalog.collectionKind(font.asset);
    const sfnt = collection === undefined ? await catalog.sfnt(font.asset) : undefined;
    const preserved = deck.embeddedFonts?.find((source) =>
      normalizeName(source.family) === normalizeName(font.office.family) && source.slot === font.office.style);
    const matchesPreserved = sfnt !== undefined && preserved?.sfnt !== undefined && preserved.sha256 === font.asset.sha256;
    if (matchesPreserved && preserved !== undefined) {
      const missing = [...face.points].filter((point) => !catalog.hasGlyph(font, point)).sort((a, b) => a - b);
      if (missing.length > 0) {
        report('FONT_EMBED_COVERAGE', face,
          `${font.office.family} (${font.asset.postscriptName}) preserved at ${preserved.part} has no cmap glyph for ${listCodePoints(missing)}`);
      }
      for (const reference of face.references) reference.embedding = { ...preserved.embedding };
      continue;
    }
    if (preserved !== undefined && !matchesPreserved) {
      report('FONT_EMBED_COVERAGE', face,
        `${font.office.family} (${font.asset.postscriptName}) competes with preserved source font ${preserved.part} for the same Office family/${font.office.style} slot; the source payload cannot establish identity with this measured asset`);
    }
    if (!opts.embedFonts) {
      entries.push(entry('FONT_NOT_EMBEDDED', {
        slide: face.slide, locator: { selector: face.selector },
        reason: `${font.office.family} (${font.asset.postscriptName}) is not embedded; recipients need this exact face installed`,
        params: { family: font.office.family },
      }));
    }
    const restriction = embeddingRestriction(font.fsType);
    if (restriction !== undefined) {
      report('FONT_EMBED_RESTRICTED', face, `${font.office.family} (${font.asset.postscriptName}) has OS/2 fsType 0x${font.fsType.toString(16).padStart(4, '0')}: ${restriction}`);
    }
    const format = sfnt === undefined ? undefined : sniffFontFormat(sfnt);
    if (collection !== undefined) {
      report('FONT_EMBED_FORMAT', face, `${font.office.family} (${font.asset.postscriptName}): ${collection} collection members cannot be embedded without extracting or modifying the measured font`);
    } else if (sfnt === undefined) {
      report('FONT_EMBED_FORMAT', face, `${font.office.family} (${font.asset.postscriptName}): the exact scanned or measured font bytes are unavailable or changed; restore the selected font file and convert again`);
    } else if ((format !== 'ttf' && format !== 'otf') || font.asset.faceIndex !== 0) {
      report('FONT_EMBED_FORMAT', face, `${font.office.family} (${font.asset.postscriptName}): ${format === 'ttc' ? 'TTC collection members' : 'this font format or collection member'} cannot be embedded without extracting or modifying the measured font`);
    } else {
      try {
        validateEotSource(sfnt);
        face.sfnt = sfnt;
      } catch (error) {
        report('FONT_EMBED_FORMAT', face,
          `${font.office.family} (${font.asset.postscriptName}) lacks supported EOT source metadata: ${error instanceof Error ? error.message : 'invalid sfnt tables'}`);
      }
    }
    const slot = `${normalizeName(font.office.family)}\u0000${font.office.style}`;
    const group = slots.get(slot);
    if (group === undefined) slots.set(slot, [face]);
    else group.push(face);
  }
  const fonts: EmbeddableFont[] = [];
  for (const group of slots.values()) {
    const selected = group[0]!;
    const points = new Set(group.flatMap((face) => [...face.points]));
    const selectedFace = { asset: selected.font.asset };
    const missing = [...points].filter((point) => !catalog.hasGlyph(selectedFace, point)).sort((a, b) => a - b);
    if (missing.length > 0 || group.length > 1) {
      const collision = group.length > 1
        ? `; ${group.length} distinct measured assets compete for the same case-insensitive Office family/${selected.font.office.style} slot, which holds only one face; subsets are never merged`
        : '';
      report('FONT_EMBED_COVERAGE', selected,
        `${selected.font.office.family} (${selected.font.asset.postscriptName})${missing.length > 0 ? ` has no cmap glyph for ${listCodePoints(missing)}` : ' cannot preserve every selected asset'}${collision}`);
      for (const face of group) face.valid = false;
    }
    for (const face of group) {
      const subset = face.references.some((font) => font.unicodeRange !== undefined);
      if (!opts.embedFonts || !face.valid) {
        const embedding: NonNullable<ResolvedFont['embedding']> = {
          status: 'not-embedded',
          ...(subset ? { subset: true } : {}),
        };
        for (const font of face.references) font.embedding = embedding;
      }
      if (subset && face.valid) {
        const ranges = [...new Set(face.references.flatMap((font) => font.unicodeRange === undefined ? [] : [font.unicodeRange]))].join('; ');
        entries.push(entry('FONT_EMBED_SUBSET', {
          slide: face.slide, locator: { selector: face.selector },
          reason: `${face.font.office.family} (${face.font.asset.postscriptName}) is a web subset with declared ranges ${ranges}; ${opts.embedFonts ? 'embedding is' : 'its available coverage is'} limited-edit, not complete-family coverage`,
          params: { family: face.font.office.family },
        }));
      }
      if (opts.embedFonts && face.valid && face.sfnt !== undefined) {
        fonts.push({ font: face.font, sfnt: face.sfnt, ...(subset ? { subset: true } : {}) });
      }
    }
  }
  return { fonts, entries };
}

/** Only the editable/installable usage and no-subsetting bits are proven for editable output. */
function embeddingRestriction(fsType: number): string | undefined {
  if ((fsType & ~ACCEPTED_EDITABLE_FSTYPE_MASK) === 0) return undefined;
  if (fsType & 0x0200) return 'bitmap embedding only (0x0200), so its outlines may not be embedded';
  if (fsType & 0x0002) return 'restricted licence embedding (0x0002)';
  if (fsType & 0x0004) return 'preview & print embedding only (0x0004), which makes an embedding Deck read-only';
  return 'unsupported embedding permission bits; only fsType 0, 0x0008, 0x0100 and 0x0108 permit editable output';
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}
