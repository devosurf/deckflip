import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as fontkit from 'fontkit';
import type { Font } from 'fontkit';
import { afterEach, expect, it } from 'vitest';
import { auditVisibleFonts, FontCatalog, prepareFontEmbedding, resolveDeckFonts, type DeclaredFontFace } from '../../src/fonts/index.js';
import { faceFromFont } from '../../src/fonts/scan.js';
import { decodeFont, sha256 } from '../../src/fonts/sfnt.js';
import { parseEot, wrapEot } from '../../src/fonts/eot.js';
import type { Deck, RunStyle, ShapeElement } from '../../src/model/index.js';
import { dfontCollection, fontCollection, mutateFont, woffFromSfnt, woff2FromSfnt, type FontMutation } from './fixture.js';

const medium = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf');
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const invalid: Array<{ label: string; mutation: FontMutation }> = [
  { label: 'legacy Regular conflicts with bold style bits', mutation: { fsSelection: 32, macStyle: 1 } },
  { label: 'OS/2 and head disagree', mutation: { macStyle: 1 } },
  { label: 'regular and bold flags are both set', mutation: { fsSelection: 96, macStyle: 1 } },
  { label: 'legacy family is absent despite a preferred family', mutation: { removeNameIds: [1] } },
  { label: 'legacy subfamily is absent', mutation: { removeNameIds: [2] } },
  { label: 'PostScript face identity is absent', mutation: { removeNameIds: [6] } },
];
it.each(invalid)('fails explicitly when $label instead of inventing an Office identity', async ({ mutation }) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-invalid-font-'));
  directories.push(dir);
  const file = join(dir, 'invalid.ttf');
  await mutateFont(medium, file, mutation);
  const catalog = await FontCatalog.scan({ system: [file] });
  const { entries, run } = resolveForStack(catalog, ['Heebo'], 500);
  expect(entries).toContainEqual(expect.objectContaining({ code: 'FONT_IDENTITY_INVALID', severity: 'error', kind: 'error' }));
  expect(run.font).toBeUndefined();
});

it('rejects a generic reached before a concrete match and reports an unresolved stack separately', async () => {
  const catalog = await FontCatalog.scan({ system: [medium] });
  expect(resolveForStack(catalog, ['Missing', 'sans-serif', 'Heebo']).entries).toContainEqual(expect.objectContaining({ code: 'FONT_GENERIC_ONLY' }));
  expect(resolveForStack(catalog, ['Missing', 'Also Missing']).entries).toContainEqual(expect.objectContaining({ code: 'FONT_UNRESOLVED' }));
});

it('resolves preferred and legacy installed aliases from a controlled catalog, not the test host', async () => {
  const catalog = await FontCatalog.scan({ system: [medium] });
  for (const family of ['Heebo', 'hEeBo mEdIuM']) {
    const { run, entries } = resolveForStack(catalog, ['Missing', family], 500);
    expect(run.font).toMatchObject({
      cssFamily: family,
      asset: { source: { kind: 'installed', file: medium }, faceIndex: 0, postscriptName: 'Heebo-Medium',
        sha256: 'cba4ce1a4c8ebaf36d0ac34d1941bc4d8a0117e343fac28c46a01635a08a92f1' },
      office: { family: 'Heebo Medium', style: 'regular' },
    });
    expect(entries).toEqual([]);
  }
  expect(catalog.find('Arial', 400, false)).toBeUndefined();
});

it.each(['woff', 'woff2'])('hashes installed %s assets from their decoded sfnt at the catalog seam', async (format) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-installed-webfont-'));
  directories.push(dir);
  const file = join(dir, `medium.${format}`);
  const sfnt = await readFile(medium);
  const container = format === 'woff' ? woffFromSfnt(sfnt) : await woff2FromSfnt(sfnt);
  await writeFile(file, container);
  const decoded = await decodeFont(container);
  const catalog = await FontCatalog.scan({ system: [file] });
  const { run } = resolveForStack(catalog, ['Heebo'], 500);
  expect(catalog.skipped).toBe(0);
  expect(run.font?.asset).toMatchObject({
    sha256: sha256(decoded.sfnt), faceIndex: 0, source: { kind: 'installed', file },
  });
  expect(run.font?.asset.sha256).not.toBe(sha256(container));
  const face = catalog.find('Heebo', 500, false);
  expect(face && catalog.hasGlyph(face, 0x41)).toBe(true);
});

it('treats formerly whitelisted preferred names as installed provenance, not portability', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-safe-font-'));
  directories.push(dir);
  const file = join(dir, 'safe-medium.ttf');
  await mutateFont(medium, file, { preferredFamily: 'Aptos' });
  const catalog = await FontCatalog.scan({ system: [file] });
  for (const family of ['Aptos', 'Heebo Medium']) {
    const { run, entries } = resolveForStack(catalog, [family], 500);
    expect(run.font).toMatchObject({
      cssFamily: family, asset: { source: { kind: 'installed', file } },
      office: { family: 'Heebo Medium', style: 'regular' },
    });
    expect(entries).toEqual([]);
  }
});

it('keeps deck-provided CSS aliases distinct from installed provenance', async () => {
  const catalog = await FontCatalog.scan({ declared: await declaredFace(medium, 'Aptos', 500), system: false });
  const { run, entries } = resolveForStack(catalog, ['Aptos'], 500);
  expect(run.font).toMatchObject({
    cssFamily: 'Aptos', asset: { source: { kind: 'file' } },
    office: { family: 'Heebo Medium', style: 'regular' },
  });
  expect(entries).toEqual([]);
});

it('rejects a variable instance instead of labeling it with the default face identity', async () => {
  const file = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-Variable.ttf');
  const catalog = await FontCatalog.scan({ system: [file] });
  const { run, entries } = resolveForStack(catalog, ['Heebo'], 800);
  expect(entries).toContainEqual(expect.objectContaining({ code: 'FONT_IDENTITY_INVALID', severity: 'error' }));
  expect(run.font).toBeUndefined();
});

it('keeps collection face identity distinct even when the asset file is shared', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-collection-'));
  directories.push(dir);
  const file = join(dir, 'source-sans.ttc');
  await fontCollection([
    'fixtures/corpus/fonts/_assets/source-sans-3/SourceSans3-Regular.ttf',
    'fixtures/corpus/fonts/_assets/source-sans-3/SourceSans3-Bold.ttf',
  ], file);
  const catalog = await FontCatalog.scan({ system: [file] });
  const regular = resolveForStack(catalog, ['Source Sans 3'], 400).run.font;
  const bold = resolveForStack(catalog, ['Source Sans 3'], 700).run.font;
  expect(regular).toMatchObject({ asset: { source: { file }, faceIndex: 0, postscriptName: 'SourceSans3-Regular' }, office: { style: 'regular' } });
  expect(bold).toMatchObject({ asset: { source: { file }, faceIndex: 1, postscriptName: 'SourceSans3-Bold' }, office: { style: 'bold' } });
  expect(regular?.asset.sha256).toBe(bold?.asset.sha256);
});

it('uses the CSS declaration for matching but the asset metadata for Office identity', async () => {
  const catalog = await FontCatalog.scan({
    declared: await declaredFace(medium, 'Heebo', 800), system: [resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-ExtraBold.ttf')],
  });
  const { run } = resolveForStack(catalog, ['Heebo'], 800);
  expect(run.weight).toBe(800);
  expect(run.font).toMatchObject({
    asset: { source: { kind: 'file', file: medium } }, office: { family: 'Heebo Medium', style: 'regular' },
  });
});

it.each([
  { fsType: 0x0004, restricted: true, why: 'preview & print embedding only (0x0004)' },
  { fsType: 0x0002, restricted: true, why: 'restricted licence embedding (0x0002)' },
  { fsType: 0x0208, restricted: true, why: 'bitmap embedding only (0x0200)' },
  { fsType: 0x000a, restricted: true, why: 'restricted licence embedding (0x0002)' },
  { fsType: 0x000c, restricted: true, why: 'preview & print embedding only (0x0004)' },
  { fsType: 0x0010, restricted: true, why: 'unsupported embedding permission bits' },
  { fsType: 0x0400, restricted: true, why: 'unsupported embedding permission bits' },
  { fsType: 0x8408, restricted: true, why: 'unsupported embedding permission bits' },
  { fsType: 0x0000, restricted: false },
  { fsType: 0x0008, restricted: false },
  { fsType: 0x0100, restricted: false },
  { fsType: 0x0108, restricted: false },
])('assesses fsType $fsType for editable embedding only during preparation', async ({ fsType, restricted, why }) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-fstype-'));
  directories.push(dir);
  const file = join(dir, 'permission.ttf');
  await mutateFont(medium, file, { fsType });
  const catalog = await FontCatalog.scan({ declared: await declaredFaces([{ file, family: 'Brand', weight: 500 }]), system: false });
  const { deck, run, entries: resolution } = resolveForStack(catalog, ['Brand'], 500);
  expect(run.font?.fsType).toBe(fsType);
  expect(resolution).toEqual([]);
  const { entries, fonts } = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  const permission = entries.filter((entry) => entry.code === 'FONT_EMBED_RESTRICTED');
  expect(permission).toEqual(restricted ? [expect.objectContaining({ severity: 'error', reason: expect.stringContaining(why!) })] : []);
  expect(fonts).toHaveLength(restricted ? 0 : 1);
  const optout = await prepareFontEmbedding(deck, catalog, { embedFonts: false });
  expect(optout.fonts).toEqual([]);
  expect(optout.entries).toContainEqual(expect.objectContaining({
    code: 'FONT_NOT_EMBEDDED', severity: 'warning', reason: expect.stringContaining('recipients need this exact face installed'),
  }));
  expect(optout.entries.filter((entry) => entry.code === 'FONT_EMBED_RESTRICTED'))
    .toEqual(restricted ? [expect.objectContaining({ severity: 'warning' })] : []);
});

it('matches declared weights as CSS does, preferring heavier weights up to 500 for a 400 request', async () => {
  const declared = await declaredFaces([
    { file: resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-ExtraBold.ttf'), family: 'Brand', weight: 300 },
    { file: medium, family: 'Brand', weight: 500 },
  ]);
  const { run } = resolveForStack(await FontCatalog.scan({ declared, system: false }), ['Brand'], 400);
  expect(run.font?.office).toEqual({ family: 'Heebo Medium', style: 'regular' });
});

it.each([
  { widths: [75, 125], requested: 100, selected: 75 },
  { widths: [75, 100], requested: 90, selected: 75 },
  { widths: [100, 125], requested: 110, selected: 125 },
  { widths: [87.5, 112.5], requested: 105, selected: 112.5 },
  { widths: [62.5, 75], requested: 80, selected: 75 },
  { widths: [125, 150], requested: 110, selected: 125 },
  { widths: [75, 100], requested: undefined, selected: 100 },
])('matches declared widths $widths for request $requested to $selected', async ({ widths, requested, selected }) => {
  const bold = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-ExtraBold.ttf');
  const rules = widths.map((width, index): DeclaredRule => ({
    file: index === 0 ? medium : bold, family: 'Brand', weight: 400, stretch: [width, width],
  }));
  const catalog = await FontCatalog.scan({ declared: await declaredFaces(rules), system: false });
  const { run } = resolveForStack(catalog, ['Brand'], 400, requested === undefined ? {} : { stretch: requested });
  expect(run.font?.asset.source).toMatchObject({ file: widths[0] === selected ? medium : bold });
});

it('matches stretch before style, and style before weight, for declared faces', async () => {
  const bold = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-ExtraBold.ttf');
  const catalog = await FontCatalog.scan({
    declared: await declaredFaces([
      { file: medium, family: 'Width first', stretch: [75, 75], italic: true, weight: 700 },
      { file: bold, family: 'Width first', italic: false, weight: 400 },
      { file: medium, family: 'Style first', italic: false, weight: 700 },
      { file: bold, family: 'Style first', italic: true, weight: 400 },
    ]),
    system: false,
  });
  expect(resolveForStack(catalog, ['Width first'], 400, { stretch: 75 }).run.font?.asset.source).toMatchObject({ file: medium });
  expect(resolveForStack(catalog, ['Style first'], 400).run.font?.asset.source).toMatchObject({ file: medium });
});

it('matches a containing declared stretch range before a narrower face, without consulting asset width', async () => {
  const bold = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-ExtraBold.ttf');
  const catalog = await FontCatalog.scan({
    declared: await declaredFaces([
      { file: medium, family: 'Brand', stretch: [75, 125], weight: 400 },
      { file: bold, family: 'Brand', stretch: [90, 90], weight: 400 },
    ]),
    system: false,
  });
  expect(resolveForStack(catalog, ['Brand'], 400).run.font?.asset.source).toMatchObject({ file: medium });
  expect(resolveForStack(catalog, ['Brand'], 400, { stretch: 100 }).run.font)
    .toEqual(resolveForStack(catalog, ['Brand'], 400).run.font);
});

it('matches installed OS/2 widths before style and weight and separates width requests in the deck cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-installed-width-'));
  directories.push(dir);
  const condensed = join(dir, 'condensed-italic.ttf');
  const normal = resolve('fixtures/corpus/fonts/_assets/source-sans-3/SourceSans3-Regular.ttf');
  await mutateFont(resolve('fixtures/corpus/fonts/_assets/source-sans-3/SourceSans3-BoldIt.ttf'), condensed, { widthClass: 3 });
  const catalog = await FontCatalog.scan({ system: [normal, condensed] });
  const first = resolveForStack(catalog, ['Source Sans 3'], 400, { stretch: 75 });
  expect(first.run.font?.asset.source).toMatchObject({ file: condensed });
  const shape = first.deck.slides[0]!.elements[0]!;
  if (shape.kind !== 'shape' || !shape.text) throw new Error('Expected fixture text shape');
  const normalRun: RunStyle = { ...first.run };
  delete normalRun.stretch;
  shape.text.paragraphs[0]!.runs.push({ kind: 'text', text: 'Normal width', style: normalRun });
  resolveDeckFonts(first.deck, catalog);
  expect(first.run.font?.asset.source).toMatchObject({ file: condensed });
  expect(normalRun.font?.asset.source).toMatchObject({ file: normal });
  expect(catalog.find('Source Sans 3', 400, false)?.stretch).toBeUndefined();
  expect(catalog.find('Source Sans 3', 400, false, 75)?.stretch).toBe(75);
});

interface DeclaredRule {
  file: string;
  family: string;
  weight: number;
  italic?: boolean;
  stretch?: readonly [number, number];
}

/** Slide 1's `@font-face` rules, each loaded with its file, as the font session records them. */
async function declaredFaces(rules: DeclaredRule[]): Promise<Map<number, DeclaredFontFace[]>> {
  const faces = await Promise.all(rules.map(async ({ file, family, weight, italic = false, stretch }, order): Promise<DeclaredFontFace> => {
    const bytes = await readFile(file);
    const font = fontkit.create(bytes) as Font;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const face = faceFromFont(font, { sha256, faceIndex: 0, source: { kind: 'file', file, format: 'ttf', sha256 } })!;
    return { family, weight: [weight, weight], italic, ...(stretch === undefined ? {} : { stretch }), order, state: 'loaded', loaded: { face, font, sfnt: bytes } };
  }));
  return new Map([[1, faces]]);
}

function declaredFace(file: string, family: string, weight: number): Promise<Map<number, DeclaredFontFace[]>> {
  return declaredFaces([{ file, family, weight }]);
}

function resolveForStack(catalog: FontCatalog, stack: string[], weight = 400, style: Partial<Pick<RunStyle, 'stretch' | 'italic'>> = {}) {
  const run: RunStyle = {
    fontStack: stack, weight, size: 16, bold: weight >= 600, italic: false,
    underline: false, strike: false, color: { hex: '000000', alpha: 1 },
    letterSpacing: 0, caps: 'none', baseline: 0,
    ...style,
  };
  const shape: ShapeElement = {
    kind: 'shape', selector: '#text', name: 'text', box: { x: 0, y: 0, w: 100, h: 100 }, rotation: 0,
    geometry: { preset: 'rect' },
    text: {
      padding: { l: 0, t: 0, r: 0, b: 0 }, firstParagraphGap: 0, lastParagraphGap: 0,
      wrap: true, rtl: false, trailingGuard: 0,
      paragraphs: [{ align: 'l', lineHeight: 16, spaceBefore: 0, spaceAfter: 0, indent: 0,
        marginLeft: 0, level: 0, runs: [{ kind: 'text', text: 'Font identity', style: run }] }],
    },
  };
  const deck: Deck = {
    title: 'font identity', lang: 'en', canvas: { width: 1280, height: 720, source: 'default' },
    slides: [{ index: 1, id: 'slide-1', name: 'Slide 1', layout: 'Blank', elements: [shape] }],
  };
  return { deck, run, entries: resolveDeckFonts(deck, catalog) };
}

it('retains the exact declared measurement buffer even after its source file disappears', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-retained-font-'));
  directories.push(dir);
  const file = join(dir, 'medium.ttf');
  await writeFile(file, await readFile(medium));
  const declared = await declaredFace(file, 'Brand', 500);
  const buffer = declared.get(1)![0]!.loaded!.sfnt;
  const catalog = await FontCatalog.scan({ declared, system: false });
  const { deck, run } = resolveForStack(catalog, ['Brand'], 500);
  await rm(file);
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(prepared.entries).toEqual([]);
  expect(prepared.fonts).toHaveLength(1);
  expect(prepared.fonts[0]!.sfnt).toBe(buffer);
  expect(prepared.fonts[0]!.font).toBe(run.font);
  expect(run.font?.embedding).toBeUndefined();
});

it.each(['ttf', 'woff', 'woff2'])('returns exact installed %s decoded bytes and refuses a changed scanned file', async (format) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-scan-identity-'));
  directories.push(dir);
  const file = join(dir, `medium.${format}`);
  const original = await readFile(medium);
  const bytes = format === 'woff' ? woffFromSfnt(original) : format === 'woff2' ? await woff2FromSfnt(original) : original;
  await writeFile(file, bytes);
  const catalog = await FontCatalog.scan({ system: [file] });
  const { deck } = resolveForStack(catalog, ['Heebo'], 500);
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(prepared.entries).toEqual([]);
  expect(prepared.fonts[0]!.sfnt).toEqual((await decodeFont(bytes)).sfnt);
  const freshCatalog = await FontCatalog.scan({ system: [file] });
  const freshDeck = resolveForStack(freshCatalog, ['Heebo'], 500).deck;
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
  await writeFile(file, changed);
  const failed = await prepareFontEmbedding(freshDeck, freshCatalog, { embedFonts: true });
  expect(failed.fonts).toEqual([]);
  expect(failed.entries).toContainEqual(expect.objectContaining({
    code: 'FONT_EMBED_FORMAT', severity: 'error', reason: expect.stringContaining('unavailable or changed'),
  }));
});

it.each(['ttf', 'woff', 'woff2'])('retains one verified installed %s snapshot across coverage and embedding', async (format) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-used-font-snapshot-'));
  directories.push(dir);
  const file = join(dir, `medium.${format}`);
  const original = await readFile(medium);
  const bytes = format === 'woff' ? woffFromSfnt(original) : format === 'woff2' ? await woff2FromSfnt(original) : original;
  await writeFile(file, bytes);
  const catalog = await FontCatalog.scan({ system: [file] });
  const face = catalog.find('Heebo', 500, false)!;
  expect(catalog.hasGlyph(face, 0x41)).toBe(true);
  await rm(file);
  const { deck } = resolveForStack(catalog, ['Heebo'], 500);
  const first = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(first.entries).toEqual([]);
  expect(first.fonts).toHaveLength(1);
  expect(first.fonts[0]!.sfnt).toEqual((await decodeFont(bytes)).sfnt);
  const second = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(second.entries).toEqual([]);
  expect(second.fonts[0]!.sfnt).toBe(first.fonts[0]!.sfnt);
});

it('names a dfont collection rather than claiming its unchanged installed bytes are unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-dfont-embedding-'));
  directories.push(dir);
  const file = join(dir, 'heebo.dfont');
  await dfontCollection(medium, file);
  const catalog = await FontCatalog.scan({ system: [file] });
  const { deck, run, entries } = resolveForStack(catalog, ['Heebo'], 500);
  expect(catalog.skipped).toBe(0);
  expect(entries).toEqual([]);
  expect(run.font?.asset).toMatchObject({ faceIndex: 0, postscriptName: 'Heebo-Medium' });
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(prepared.fonts).toEqual([]);
  expect(prepared.entries).toEqual([expect.objectContaining({
    code: 'FONT_EMBED_FORMAT', severity: 'error', reason: expect.stringContaining('dfont collection members'),
  })]);
  expect(prepared.entries[0]!.reason).not.toContain('unavailable or changed');
});

it('returns successful embedding plans without claiming a final packaging status', async () => {
  const catalog = await FontCatalog.scan({ declared: await declaredFace(medium, 'Brand', 500), system: false });
  const { deck, run } = resolveForStack(catalog, ['Brand'], 500);
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(prepared.entries).toEqual([]);
  expect(prepared.fonts).toHaveLength(1);
  expect(prepared.fonts[0]!.font).toBe(run.font);
  expect(run.font?.embedding).toBeUndefined();
});

it.each([
  { label: 'missing cmap glyph', text: 'Brand 漢', postScriptName: 'Heebo-Medium', reason: 'U+6F22 漢' },
  { label: 'unaccounted platform font despite full cmap coverage', text: 'Brand', postScriptName: 'Other-Font', reason: 'Chromium also drew the text with Other-Font' },
])('reports $label as a portability error by default and a warning only under optout', async ({ text, postScriptName, reason }) => {
  const catalog = await FontCatalog.scan({ declared: await declaredFace(medium, 'Brand', 500), system: false });
  const visible = [{
    slide: 1, selector: '#text', fontStack: ['Brand'], weight: 500, italic: false, text,
    fonts: [{ familyName: 'Heebo Medium', postScriptName, isCustomFont: true, glyphCount: 5 }],
  }];
  expect(auditVisibleFonts(visible, catalog, { embedFonts: true })).toEqual([expect.objectContaining({
    code: 'FONT_GLYPH_FALLBACK', kind: 'error', severity: 'error', reason: expect.stringContaining(reason),
  })]);
  expect(auditVisibleFonts(visible, catalog, { embedFonts: false })).toEqual([expect.objectContaining({
    code: 'FONT_GLYPH_FALLBACK', kind: 'flagged', severity: 'warning', reason: expect.stringContaining(reason),
  })]);
});

it('rejects collection members only for portability, retaining installed face resolution', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-collection-embedding-'));
  directories.push(dir);
  const file = join(dir, 'source-sans.ttc');
  await fontCollection(['fixtures/corpus/fonts/_assets/source-sans-3/SourceSans3-Regular.ttf'], file);
  const catalog = await FontCatalog.scan({ system: [file] });
  const { deck, entries } = resolveForStack(catalog, ['Source Sans 3']);
  expect(entries).toEqual([]);
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(prepared.fonts).toEqual([]);
  expect(prepared.entries).toContainEqual(expect.objectContaining({
    code: 'FONT_EMBED_FORMAT', severity: 'error', reason: expect.stringContaining('TTC collection members'),
  }));
  const optout = await prepareFontEmbedding(deck, catalog, { embedFonts: false });
  expect(optout.entries.filter((entry) => entry.code === 'FONT_EMBED_FORMAT'))
    .toEqual([expect.objectContaining({ severity: 'warning' })]);
});

it('reports every missing cmap character and marks a covering web subset as limited-edit', async () => {
  const declared = await declaredFace(medium, 'Brand', 500);
  declared.get(1)![0]!.unicodeRange = [[0, 0x10ffff]];
  const catalog = await FontCatalog.scan({ declared, system: false });
  const { deck, run } = resolveForStack(catalog, ['Brand'], 500);
  const covering = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(covering.fonts).toHaveLength(1);
  expect(covering.entries).toEqual([expect.objectContaining({
    code: 'FONT_EMBED_SUBSET', severity: 'warning', reason: expect.stringContaining('U+0-10FFFF'),
  })]);
  expect(covering.fonts[0]!.subset).toBe(true);
  expect(run.font?.embedding).toBeUndefined();
  const shape = deck.slides[0]!.elements[0]!;
  if (shape.kind !== 'shape' || shape.text === undefined) throw new Error('Expected text fixture');
  const text = shape.text.paragraphs[0]!.runs[0]!;
  if (text.kind !== 'text') throw new Error('Expected text run');
  text.text = '漢字語龍風雨雪雲雷電';
  const uncovered = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(uncovered.fonts).toEqual([]);
  const coverage = uncovered.entries.find((entry) => entry.code === 'FONT_EMBED_COVERAGE')!;
  expect(coverage.severity).toBe('error');
  for (const character of text.text) expect(coverage.reason).toContain(character);
  expect(coverage.hint).toContain('complete font file');
});

it('canonicalizes repeated asset references for packaging status and warns once per opt-out face', async () => {
  const catalog = await FontCatalog.scan({ system: [medium] });
  const { deck } = resolveForStack(catalog, ['Heebo'], 500);
  const shape = deck.slides[0]!.elements[0]!;
  if (shape.kind !== 'shape' || shape.text === undefined) throw new Error('Expected text fixture');
  const first = shape.text.paragraphs[0]!.runs[0]!;
  if (first.kind !== 'text') throw new Error('Expected text run');
  const style = { ...first.style };
  shape.text.paragraphs[0]!.runs.push({ kind: 'text', text: 'Again', style });
  resolveDeckFonts(deck, catalog);
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(prepared.entries).toEqual([]);
  expect(prepared.fonts).toHaveLength(1);
  expect(style.font).toBe(first.style.font);
  const optout = await prepareFontEmbedding(deck, catalog, { embedFonts: false });
  expect(optout.entries).toEqual([expect.objectContaining({ code: 'FONT_NOT_EMBEDDED', severity: 'warning' })]);
  expect(style.font?.embedding).toEqual({ status: 'not-embedded' });
});

it('applies restricted rights to installed faces even when they were formerly whitelisted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-installed-rights-'));
  directories.push(dir);
  const file = join(dir, 'restricted.ttf');
  await mutateFont(medium, file, { preferredFamily: 'Aptos', fsType: 0x0002 });
  const catalog = await FontCatalog.scan({ system: [file] });
  const { deck, run, entries } = resolveForStack(catalog, ['Aptos'], 500);
  expect(entries).toEqual([]);
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(prepared.fonts).toEqual([]);
  expect(prepared.entries).toEqual([expect.objectContaining({ code: 'FONT_EMBED_RESTRICTED', severity: 'error' })]);
  expect(run.font?.embedding).toEqual({ status: 'not-embedded' });
});

it.each([false, true])('honors declared measured bytes over a preserved family slot (changed: %s)', async (changed) => {
  const original = await readFile(medium);
  const payload = wrapEot(original);
  const header = parseEot(payload);
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-declared-preserved-'));
  directories.push(dir);
  const file = join(dir, 'measured.ttf');
  if (changed) await mutateFont(medium, file, { fsType: 0x0008 });
  else await writeFile(file, original);
  const catalog = await FontCatalog.scan({
    declared: await declaredFace(file, 'Heebo Medium', 500), system: false,
  });
  const { deck, run } = resolveForStack(catalog, ['Heebo Medium'], 500);
  const preserved: NonNullable<Deck['embeddedFonts']>[number] = {
    family: 'Heebo Medium', slot: 'regular', part: '/ppt/fonts/font1.fntdata',
    relationshipId: 'rIdFont1', sha256: sha256(original), version: header.version, flags: header.flags,
    fsType: header.fsType, subset: header.subset, compressed: header.compressed,
    familyName: header.familyName, styleName: header.styleName, sfnt: original,
    embedding: { status: 'preserved', part: '/ppt/fonts/font1.fntdata' },
  };
  deck.embeddedFonts = [preserved];
  run.embeddedFont = preserved;
  expect(resolveDeckFonts(deck, catalog)).toEqual([]);
  expect(run.embeddedFont).toBeUndefined();
  expect(run.font?.asset.sha256).toBe(sha256(await readFile(file)));
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
  expect(prepared.fonts).toEqual([]);
  if (changed) {
    expect(prepared.entries).toEqual([expect.objectContaining({
      code: 'FONT_EMBED_COVERAGE', severity: 'error', reason: expect.stringContaining('competes with preserved source font'),
    })]);
    expect(run.font?.embedding?.status).toBe('not-embedded');
  } else {
    expect(prepared.entries).toEqual([]);
    expect(run.font?.embedding).toEqual({ status: 'preserved', part: '/ppt/fonts/font1.fntdata' });
  }
});

it('does not report matching preserved source bytes as unembedded when new embedding is disabled', async () => {
  const original = await readFile(medium);
  const header = parseEot(wrapEot(original));
  const catalog = await FontCatalog.scan({ declared: await declaredFace(medium, 'Brand', 500), system: false });
  const { deck, run } = resolveForStack(catalog, ['Brand'], 500);
  deck.embeddedFonts = [{
    family: 'Heebo Medium', slot: 'regular', part: '/ppt/fonts/font1.fntdata',
    relationshipId: 'rIdFont1', sha256: sha256(original), version: header.version, flags: header.flags,
    fsType: header.fsType, subset: header.subset, compressed: header.compressed,
    familyName: header.familyName, styleName: header.styleName, sfnt: original,
    embedding: { status: 'preserved', part: '/ppt/fonts/font1.fntdata' },
  }];
  const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: false });
  expect(prepared.fonts).toEqual([]);
  expect(prepared.entries).toEqual([]);
  expect(run.font?.embedding).toEqual({ status: 'preserved', part: '/ppt/fonts/font1.fntdata' });
});

it.each([0x0010, 0x0400, 0x8408])('retains every raw fsType bit in installed standalone and collection faces: %s', async (fsType) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-raw-installed-rights-'));
  directories.push(dir);
  const standalone = join(dir, 'permission.ttf');
  const collection = join(dir, 'permission.ttc');
  await mutateFont(medium, standalone, { fsType });
  await fontCollection([standalone], collection);
  for (const file of [standalone, collection]) {
    const catalog = await FontCatalog.scan({ system: [file] });
    const { deck, run, entries } = resolveForStack(catalog, ['Heebo'], 500);
    expect(entries).toEqual([]);
    expect(run.font?.fsType).toBe(fsType);
    const prepared = await prepareFontEmbedding(deck, catalog, { embedFonts: true });
    expect(prepared.fonts).toEqual([]);
    expect(prepared.entries).toContainEqual(expect.objectContaining({
      code: 'FONT_EMBED_RESTRICTED', severity: 'error',
      reason: expect.stringContaining(`fsType 0x${fsType.toString(16).padStart(4, '0')}`),
    }));
  }
});
