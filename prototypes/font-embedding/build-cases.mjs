// Builds the #33 PowerPoint compatibility cases into out/cases/.
// Inputs: pinned repo assets, sources/ (fetch-sources.mjs), and optionally
// ref/powerpoint-embed-all.pptx (a package PowerPoint itself saved with
// "Embed all characters"; used for the source-package preservation case).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import JSZip from 'jszip';
import { compress as woff2Compress, decompress as woff2Decompress } from 'wawoff2';
import { wrapEot } from './lib/eot.mjs';
import { buildDeck, EMU_PER_PT, partsDigest } from './lib/pptx.mjs';
import { deriveTestFace, names, os2, parseSfnt, sha256, woff1Decode, woff1Encode } from './lib/sfnt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const assets = join(repo, 'fixtures/corpus/fonts/_assets');
const sources = join(here, 'sources');
const outDir = join(here, 'out/cases');
mkdirSync(outDir, { recursive: true });

const IN = 72 * EMU_PER_PT;
const read = (p) => readFileSync(p);
const pinned = (f) => read(join(assets, f));

const BODY = 'the quick brown fox jumps over the lazy dog while vexed nymphs pack my box with five dozen liquor jugs';
// Characters typed during the edit step. None occurs in any original Slide
// text; each box only receives the characters its face actually maps.
const ADDED = {
  common: ' 0123456789 QWZ ÅÄÖ éñ€ß',
  hebrew: ' שלום',
  greekCyrillic: ' Ωλ Жя ő',
};

const CORE = [
  { key: 'heebo-medium', label: 'Heebo Medium', file: 'heebo/Heebo-Medium.ttf', typeface: 'Heebo Medium', slot: 'regular', script: 'hebrew' },
  { key: 'heebo-bold', label: 'Heebo Bold', file: 'heebo/Heebo-Bold.ttf', typeface: 'Heebo', slot: 'bold', script: 'hebrew' },
  { key: 'heebo-extrabold', label: 'Heebo ExtraBold', file: 'heebo/Heebo-ExtraBold.ttf', typeface: 'Heebo ExtraBold', slot: 'regular', script: 'hebrew' },
  { key: 'ss3-regular', label: 'Source Sans Regular', file: 'source-sans-3/SourceSans3-Regular.ttf', otf: 'SourceSans3-Regular.otf', typeface: 'Source Sans 3', slot: 'regular', script: 'greekCyrillic' },
  { key: 'ss3-bold', label: 'Source Sans Bold', file: 'source-sans-3/SourceSans3-Bold.ttf', otf: 'SourceSans3-Bold.otf', typeface: 'Source Sans 3', slot: 'bold', script: 'greekCyrillic' },
  { key: 'ss3-italic', label: 'Source Sans Italic', file: 'source-sans-3/SourceSans3-It.ttf', otf: 'SourceSans3-It.otf', typeface: 'Source Sans 3', slot: 'italic', script: 'greekCyrillic' },
  { key: 'ss3-bolditalic', label: 'Source Sans Bold Italic', file: 'source-sans-3/SourceSans3-BoldIt.ttf', otf: 'SourceSans3-BoldIt.otf', typeface: 'Source Sans 3', slot: 'boldItalic', script: 'greekCyrillic' },
];

const slotStyle = (slot) => ({ bold: slot === 'bold' || slot === 'boldItalic', italic: slot === 'italic' || slot === 'boldItalic' });

function coverage(sfnt, text) {
  const font = fontkit.create(sfnt);
  const chars = [...new Set([...text])];
  return { covered: chars.filter((c) => font.hasGlyphForCodePoint(c.codePointAt(0))).join(''), missing: chars.filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0))).join('') };
}

function addedFor(sfnt, script) {
  const wanted = ADDED.common + (ADDED[script] ?? '');
  const { missing } = coverage(sfnt, wanted);
  return [...wanted].filter((c) => !missing.includes(c)).join('');
}

// Two-column layout: up to 4 boxes per column.
function layoutBoxes(items) {
  return items.map((item, i) => {
    const col = i < 3 ? 0 : 1;
    const row = col === 0 ? i : i - 3;
    return {
      name: item.label,
      x: Math.round((0.45 + col * 6.45) * IN),
      y: Math.round((0.35 + row * 1.7) * IN),
      cx: Math.round(5.95 * IN),
      cy: Math.round(1.55 * IN),
      sizePt: 16,
      runs: [{ text: `${item.label}: ${BODY}`, family: item.typeface, ...slotStyle(item.slot) }],
    };
  });
}

function embeddedList(items, encode, attrs = { pitchFamily: '2', charset: '0' }) {
  const byFamily = new Map();
  for (const item of items) {
    if (!item.payload) continue;
    const entry = byFamily.get(item.typeface) ?? { typeface: item.typeface, attrs, slots: {} };
    if (entry.slots[item.slot]) throw new Error(`duplicate slot ${item.typeface}/${item.slot}`);
    entry.slots[item.slot] = encode(item);
    byFamily.set(item.typeface, entry);
  }
  return [...byFamily.values()];
}

function faceRecord(item) {
  const n = names(item.sfnt);
  const o = os2(item.sfnt);
  return {
    label: item.label,
    typeface: item.typeface,
    slot: item.slot,
    source: item.source,
    sourceSha256: item.sourceSha256,
    sourceFormat: item.sourceFormat,
    decode: item.decode ?? 'none',
    sfntSha256: sha256(item.sfnt),
    sfntFlavor: parseSfnt(item.sfnt).flavor === 0x4f54544f ? 'CFF (OTTO)' : 'TrueType',
    payloadEncoding: item.encoding,
    payloadSha256: item.payload ? sha256(item.payload) : null,
    nameId1: n[1], nameId2: n[2], postscriptName: n[6], fsType: o.fsType, usWeightClass: o.usWeightClass,
    modified: Boolean(item.modified),
    addedText: item.added,
  };
}

function srcItem(item, bytes, { source, format = 'ttf', decode, sfnt = bytes, modified = false } = {}) {
  return { ...item, source, sourceSha256: sha256(bytes), sourceFormat: format, decode, sfnt, modified, added: addedFor(sfnt, item.script) };
}

const cases = [];
async function emit(id, description, items, { encode = 'eot', presentationAttrs = { embedTrueTypeFonts: '1' }, embedded, fontAttrs } = {}) {
  const encoders = { eot: (i) => wrapEot(i.sfnt), raw: (i) => i.sfnt };
  for (const item of items) {
    if (encode === 'none' || item.skipEmbed) continue;
    item.encoding = encode === 'eot' ? 'EOT 0x00020002, flags 0 (uncompressed, full font)' : 'raw sfnt';
    item.payload = encoders[encode](item);
  }
  const list = embedded ?? embeddedList(items, (i) => i.payload, fontAttrs);
  const pptx = await buildDeck({ title: `#33 ${id}`, boxes: layoutBoxes(items), embedded: list, presentationAttrs });
  const file = join(outDir, `${id}.pptx`);
  writeFileSync(file, pptx);
  const record = { id, description, file: relative(here, file), sha256: sha256(pptx), partsDigest: await partsDigest(pptx), bytes: pptx.length, presentationAttrs, faces: items.map(faceRecord) };
  cases.push(record);
  console.log(`${id}: ${pptx.length} bytes ${record.sha256.slice(0, 12)}`);
}

const core = () => CORE.map((c) => srcItem(c, pinned(c.file), { source: `fixtures/corpus/fonts/_assets/${c.file}` }));

// Control: same Slide, no embedded fonts.
await emit('control-no-embedding', 'Same Slide and Office identities with no embedded fonts; shows host fallback when the fonts are unavailable.', core(), { encode: 'none', presentationAttrs: {} });

// A: the candidate contract — uncompressed EOT around the unmodified face.
await emit('a-eot-uncompressed-ttf', 'Seven unmodified pinned static TTF faces, each wrapped in an uncompressed full-font EOT 2.2 container, in Office legacy family/RIBBI slots.', core());

// B: raw sfnt bytes in the font part, no EOT header.
await emit('b-raw-ttf', 'Same faces and slots as A, but the font parts contain the raw TTF bytes without an EOT header.', core(), { encode: 'raw' });

// C: PowerPoint's own payloads copied verbatim (source-package preservation).
async function preservedCase(id, refFile, description) {
  const refPath = join(here, refFile);
  if (!existsSync(refPath)) return;
  const ref = await JSZip.loadAsync(read(refPath));
  const pres = await ref.file('ppt/presentation.xml').async('string');
  const rels = await ref.file('ppt/_rels/presentation.xml.rels').async('string');
  const target = Object.fromEntries([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const embedded = [];
  for (const [, typeface, attrText, slotXml] of pres.matchAll(/<p:embeddedFont><p:font typeface="([^"]+)"([^>]*)\/>(.*?)<\/p:embeddedFont>/g)) {
    const attrs = Object.fromEntries([...attrText.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const slots = {};
    for (const [, slot, rid] of slotXml.matchAll(/<p:(\w+) r:id="(rId\d+)"\/>/g)) slots[slot] = await ref.file(`ppt/${target[rid]}`).async('nodebuffer');
    embedded.push({ typeface, attrs, slots });
  }
  const items = core().map((i) => ({ ...i, skipEmbed: true, encoding: 'PowerPoint-written EOT (MTX), copied verbatim' }));
  await emit(id, description, items, { embedded });
  cases.at(-1).preservedFrom = { file: refFile, sha256: sha256(read(refPath)), embeddedFontLst: embedded.map((e) => ({ typeface: e.typeface, attrs: e.attrs, slots: Object.fromEntries(Object.entries(e.slots).map(([k, v]) => [k, sha256(v)])) })) };
}
await preservedCase('c-powerpoint-mtx-preserved', 'ref/powerpoint-embed-all.pptx', 'PowerPoint-written MTX-compressed EOT parts ("Embed all characters") and its embeddedFontLst, including its slot choices, copied byte-for-byte into the same Slide.');
await preservedCase('c2-powerpoint-subset-preserved', 'ref/powerpoint-embed-subset.pptx', 'PowerPoint-written subset MTX EOT parts ("Embed only the characters used", flags 0x5) from a Deck with different text, copied byte-for-byte into the same Slide.');

// D: CFF-flavoured OpenType (Source Sans 3 OTF of the same 3.052R commit).
await emit('d-eot-otf-cff', 'Heebo TTF as in A; Source Sans 3 from the unmodified 3.052R CFF OTF files in uncompressed EOT.', CORE.map((c) => c.otf
  ? srcItem(c, read(join(sources, c.otf)), { source: `sources/${c.otf}`, format: 'otf' })
  : srcItem(c, pinned(c.file), { source: `fixtures/corpus/fonts/_assets/${c.file}` })));

// E: WOFF2 (Heebo) and WOFF 1.0 (Source Sans 3) sources made from the pinned
// TTFs, decoded back to sfnt before EOT wrapping.
const eItems = [];
for (const c of CORE) {
  const ttf = pinned(c.file);
  if (c.key.startsWith('heebo')) {
    const woff2 = Buffer.from(await woff2Compress(ttf));
    const sfnt = Buffer.from(await woff2Decompress(woff2));
    writeFileSync(join(outDir, `${c.key}.woff2`), woff2);
    eItems.push(srcItem(c, woff2, { source: `out/cases/${c.key}.woff2 (wawoff2 compress of pinned TTF)`, format: 'woff2', decode: 'wawoff2 (google/woff2) decompress', sfnt }));
  } else {
    const woff = woff1Encode(ttf);
    const sfnt = woff1Decode(woff);
    writeFileSync(join(outDir, `${c.key}.woff`), woff);
    eItems.push(srcItem(c, woff, { source: `out/cases/${c.key}.woff (zlib WOFF 1.0 of pinned TTF)`, format: 'woff', decode: 'WOFF 1.0 zlib table inflate', sfnt }));
  }
}
await emit('e-eot-decoded-woff-woff2', 'Heebo faces decoded from WOFF2 and Source Sans 3 faces decoded from WOFF 1.0, then wrapped as in A.', eItems);

// F: OS/2.fsType permission variants of Heebo Medium under unique test names.
const base = pinned('heebo/Heebo-Medium.ttf');
const perm = (kind, fsType) => {
  const family = `DF Perm ${kind}`;
  const sfnt = deriveTestFace(base, { family, postscript: `DFPerm-${kind}`, fsType });
  return srcItem({ key: `perm-${kind}`, label: family, typeface: family, slot: 'regular', script: 'hebrew' }, sfnt, { source: `derived from fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf (name table + OS/2.fsType 0x${fsType.toString(16).padStart(4, '0')})`, modified: true });
};
for (const [kind, fsType] of [['Restricted', 0x0002], ['Preview', 0x0004], ['Editable', 0x0008], ['NoSubset', 0x0100], ['BitmapOnly', 0x0200]]) {
  await emit(`f-fstype-${kind.toLowerCase()}`, `Installable control face plus a Heebo Medium derivative with OS/2.fsType 0x${fsType.toString(16).padStart(4, '0')} (${kind}).`, [perm('Installable', 0x0000), perm(kind, fsType)]);
}

// G: variable font as-is versus a static instance.
const vf = pinned('heebo/Heebo-Variable.ttf');
const inst = read(join(sources, 'Heebo-Variable-wght500.instance.ttf'));
await emit('g-variable', 'Heebo[wght] embedded unmodified under its default-instance name, and a fontTools static wght=500 instance renamed "Heebo VF500".', [
  srcItem({ key: 'vf-raw', label: 'Heebo variable default', typeface: 'Heebo', slot: 'regular', script: 'hebrew' }, vf, { source: 'fixtures/corpus/fonts/_assets/heebo/Heebo-Variable.ttf' }),
  srcItem({ key: 'vf-instance', label: 'Heebo VF static instance', typeface: 'Heebo VF500', slot: 'regular', script: 'hebrew' }, inst, {
    source: 'sources/Heebo-Variable-wght500.instance.ttf (fontTools varLib.instancer wght=500 --static)',
    sfnt: deriveTestFace(inst, { family: 'Heebo VF500', postscript: 'HeeboVF500-Regular' }),
    modified: true,
  }),
]);

// H: one Google Fonts unicode-range subset used as the whole face.
const latin = read(join(sources, 'heebo-500-latin.woff2'));
await emit('h-unicode-range-subset', 'Google Fonts Heebo 500 "latin" unicode-range WOFF2 subset, decoded and embedded as the complete Heebo Medium regular face.', [
  srcItem({ key: 'gf-latin', label: 'Heebo Medium latin subset', typeface: 'Heebo Medium', slot: 'regular', script: 'hebrew' }, latin, {
    source: 'sources/heebo-500-latin.woff2 (fonts.gstatic.com heebo v28)', format: 'woff2', decode: 'wawoff2 (google/woff2) decompress', sfnt: Buffer.from(await woff2Decompress(latin)),
  }),
]);
// The subset case types the full planned text so missing Hebrew is observable.
cases.at(-1).faces[0].addedText = ADDED.common + ADDED.hebrew;
cases.at(-1).faces[0].addedCoverage = coverage(Buffer.from(await woff2Decompress(latin)), ADDED.common + ADDED.hebrew);

// Smallest redistributable reproduction: one unmodified face, one text box,
// and a p:font entry with only the required typeface attribute.
await emit('minimal-heebo-medium', 'Smallest reproduction: unmodified Heebo Medium in uncompressed EOT, one text box, p:font typeface only.', [core()[0]], { fontAttrs: {} });

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ body: BODY, added: ADDED, cases }, null, 2)}\n`);
