import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as fontkit from 'fontkit';
import type { Font } from 'fontkit';
import { afterEach, expect, it } from 'vitest';
import { FontCatalog, resolveDeckFonts, type DeclaredFontFace } from '../../src/fonts/index.js';
import { faceFromFont } from '../../src/fonts/scan.js';
import type { Deck, RunStyle, ShapeElement } from '../../src/model/index.js';
import { fontCollection, mutateFont, type FontMutation } from './fixture.js';

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
      cssFamily: family, class: 'installed',
      asset: { source: { kind: 'installed', file: medium }, faceIndex: 0, postscriptName: 'Heebo-Medium',
        sha256: 'cba4ce1a4c8ebaf36d0ac34d1941bc4d8a0117e343fac28c46a01635a08a92f1' },
      office: { family: 'Heebo Medium', style: 'regular' },
    });
    expect(entries).toContainEqual(expect.objectContaining({ code: 'FONT_NOT_SAFE' }));
  }
  expect(catalog.find('Arial', 400, false)).toBeUndefined();
});

it('keeps an installed safe preferred family safe when its Office family differs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-safe-font-'));
  directories.push(dir);
  const file = join(dir, 'safe-medium.ttf');
  await mutateFont(medium, file, { preferredFamily: 'Aptos' });
  const catalog = await FontCatalog.scan({ system: [file] });
  for (const family of ['Aptos', 'Heebo Medium']) {
    const { run, entries } = resolveForStack(catalog, [family], 500);
    expect(run.font).toMatchObject({
      cssFamily: family, class: 'safe', asset: { source: { kind: 'installed', file } },
      office: { family: 'Heebo Medium', style: 'regular' },
    });
    expect(entries).toEqual([]);
  }
});

it('does not treat a deck-provided CSS alias as proof of a safe installed face', async () => {
  const catalog = await FontCatalog.scan({ declared: await declaredFace(medium, 'Aptos', 500), system: false });
  const { run, entries } = resolveForStack(catalog, ['Aptos'], 500);
  expect(run.font).toMatchObject({
    cssFamily: 'Aptos', class: 'deck-provided',
    office: { family: 'Heebo Medium', style: 'regular' },
  });
  expect(entries).toContainEqual(expect.objectContaining({ code: 'FONT_NOT_SAFE', severity: 'warning' }));
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
    class: 'deck-provided', asset: { source: { kind: 'file', file: medium } }, office: { family: 'Heebo Medium', style: 'regular' },
  });
});

it.each([
  { fsType: 0x0004, restricted: true, why: 'preview & print embedding only (0x0004)' },
  { fsType: 0x0002, restricted: true, why: 'restricted licence embedding (0x0002)' },
  { fsType: 0x0208, restricted: true, why: 'bitmap embedding only (0x0200)' },
  { fsType: 0x0008, restricted: false },
  { fsType: 0x0100, restricted: false },
])('reports fsType $fsType of a deck-provided face when it rules out editable embedding', async ({ fsType, restricted, why }) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-fstype-'));
  directories.push(dir);
  const file = join(dir, 'permission.ttf');
  await mutateFont(medium, file, { fsType });
  const { entries } = resolveForStack(await FontCatalog.scan({ declared: await declaredFaces([{ file, family: 'Brand', weight: 500 }]), system: false }), ['Brand'], 500);
  const permission = entries.filter((entry) => entry.code === 'FONT_EMBED_RESTRICTED');
  expect(permission).toEqual(restricted ? [expect.objectContaining({ severity: 'warning', reason: expect.stringContaining(why!) })] : []);
});

it('matches declared weights as CSS does, preferring heavier weights up to 500 for a 400 request', async () => {
  const declared = await declaredFaces([
    { file: resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-ExtraBold.ttf'), family: 'Brand', weight: 300 },
    { file: medium, family: 'Brand', weight: 500 },
  ]);
  const { run } = resolveForStack(await FontCatalog.scan({ declared, system: false }), ['Brand'], 400);
  expect(run.font?.office).toEqual({ family: 'Heebo Medium', style: 'regular' });
});

/** Slide 1's `@font-face` rules, each loaded with its file, as the font session records them. */
async function declaredFaces(rules: Array<{ file: string; family: string; weight: number }>): Promise<Map<number, DeclaredFontFace[]>> {
  const faces = await Promise.all(rules.map(async ({ file, family, weight }, order): Promise<DeclaredFontFace> => {
    const bytes = await readFile(file);
    const font = fontkit.create(bytes) as Font;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const face = faceFromFont(font, { sha256, faceIndex: 0, source: { kind: 'file', file, format: 'ttf', sha256 } })!;
    return { family, weight: [weight, weight], italic: false, order, state: 'loaded', loaded: { face, font } };
  }));
  return new Map([[1, faces]]);
}

function declaredFace(file: string, family: string, weight: number): Promise<Map<number, DeclaredFontFace[]>> {
  return declaredFaces([{ file, family, weight }]);
}

function resolveForStack(catalog: FontCatalog, stack: string[], weight = 400) {
  const run: RunStyle = {
    fontStack: stack, weight, size: 16, bold: weight >= 600, italic: false,
    underline: false, strike: false, color: { hex: '000000', alpha: 1 },
    letterSpacing: 0, caps: 'none', baseline: 0,
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
  return { deck, run, entries: resolveDeckFonts(deck, catalog, { embedFonts: false }) };
}
