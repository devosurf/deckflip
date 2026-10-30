import path from 'node:path';
import type { EmbeddableFont } from '../fonts/index.js';
import { wrapEot } from '../fonts/eot.js';
import { fontAssetKey } from '../fonts/scan.js';
import { OFFICE_FONT_STYLES, type OfficeFontStyle } from '../model/index.js';
import { CT, OpcPackage, REL } from '../ooxml/opc.js';
import { el, type XmlNode } from '../ooxml/xml.js';

export interface PlannedFont extends EmbeddableFont {
  readonly part: string;
}

/** Allocate deterministic package identities before reporting or writing any font payloads. */
export function planFontParts(fonts: readonly EmbeddableFont[], occupiedParts: Iterable<string>): PlannedFont[] {
  const occupied = new Set(occupiedParts);
  const assets = new Map<string, string>();
  let nextPart = 1;
  return [...fonts].sort((left, right) => {
    const a = fontAssetKey(left.font.asset);
    const b = fontAssetKey(right.font.asset);
    return a < b ? -1 : a > b ? 1 : 0;
  }).map((font) => {
    const key = fontAssetKey(font.font.asset);
    let part = assets.get(key);
    if (part === undefined) {
      while (occupied.has(`/ppt/fonts/font${nextPart}.fntdata`)) nextPart += 1;
      part = `/ppt/fonts/font${nextPart++}.fntdata`;
      assets.set(key, part);
      occupied.add(part);
    }
    return { ...font, part };
  });
}

/** One part per measured asset, one family entry with Office RIBBI slots. Source parts may already occupy names. */
export function emitEmbeddedFontList(pkg: OpcPackage, presentationPart: string, fonts: readonly PlannedFont[]): XmlNode | undefined {
  if (fonts.length === 0) return undefined;
  const assets = new Map<string, string>();
  const families = new Map<string, { family: string; slots: Map<OfficeFontStyle, string> }>();
  for (const { font, sfnt, part } of fonts) {
    const key = fontAssetKey(font.asset);
    let rId = assets.get(key);
    if (rId === undefined) {
      pkg.addPart(part, CT.fontData, wrapEot(sfnt));
      rId = pkg.addRelationship(presentationPart, REL.font, path.posix.relative(path.posix.dirname(presentationPart), part));
      assets.set(key, rId);
    }
    const familyKey = font.office.family.toLowerCase();
    let family = families.get(familyKey);
    if (family === undefined) {
      family = { family: font.office.family, slots: new Map() };
      families.set(familyKey, family);
    }
    family.slots.set(font.office.style, rId);
  }
  return el('p:embeddedFontLst', {}, ...[...families.values()]
    .sort((a, b) => a.family < b.family ? -1 : a.family > b.family ? 1 : 0)
    .map(({ family, slots }) => el('p:embeddedFont', {},
      el('p:font', { typeface: family }),
      ...OFFICE_FONT_STYLES.flatMap((slot) => {
        const rId = slots.get(slot);
        return rId === undefined ? [] : [el(`p:${slot}`, { 'r:id': rId })];
      }),
    )));
}
