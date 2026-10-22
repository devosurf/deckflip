import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FontCatalog, resolveDeckFonts } from '../../src/fonts/index.js';
import type { Deck, DeckFontFace, RunStyle, ShapeElement } from '../../src/model/index.js';
import { fontCollection, malformedFont, type FontMutation } from './fixture.js';

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
  await malformedFont(medium, file, mutation);
  const catalog = await FontCatalog.scan({ extraFiles: [file], system: false });
  const { entries, run } = resolveForStack(catalog, ['Heebo'], [], 500);
  expect(entries).toContainEqual(expect.objectContaining({ code: 'FONT_IDENTITY_INVALID', severity: 'error', kind: 'error' }));
  expect(run.font).toBeUndefined();
});

it('rejects a generic reached before a concrete match and reports an unresolved stack separately', async () => {
  const catalog = await FontCatalog.scan({ extraFiles: [medium], system: false });
  expect(resolveForStack(catalog, ['Missing', 'sans-serif', 'Heebo']).entries).toContainEqual(expect.objectContaining({ code: 'FONT_GENERIC_ONLY' }));
  expect(resolveForStack(catalog, ['Missing', 'Also Missing']).entries).toContainEqual(expect.objectContaining({ code: 'FONT_UNRESOLVED' }));
});

it('resolves preferred and legacy installed aliases from a controlled catalog, not the test host', async () => {
  const catalog = await FontCatalog.scan({ system: [medium] });
  for (const family of ['Heebo', 'hEeBo mEdIuM']) {
    const { run, entries } = resolveForStack(catalog, ['Missing', family], [], 500);
    expect(run.font).toMatchObject({
      cssFamily: family, class: 'installed',
      asset: { file: medium, faceIndex: 0, postscriptName: 'Heebo-Medium',
        sha256: 'cba4ce1a4c8ebaf36d0ac34d1941bc4d8a0117e343fac28c46a01635a08a92f1' },
      office: { family: 'Heebo Medium', style: 'regular' },
    });
    expect(entries).toContainEqual(expect.objectContaining({ code: 'FONT_NOT_SAFE' }));
  }
  expect(catalog.find('Arial', 400, false)).toBeUndefined();
});

it('rejects a variable instance instead of labeling it with the default face identity', async () => {
  const file = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-Variable.ttf');
  const catalog = await FontCatalog.scan({ extraFiles: [file], system: false });
  const { run, entries } = resolveForStack(catalog, ['Heebo'], [], 800);
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
  const regular = resolveForStack(catalog, ['Source Sans 3'], [], 400).run.font;
  const bold = resolveForStack(catalog, ['Source Sans 3'], [], 700).run.font;
  expect(regular).toMatchObject({ asset: { file, faceIndex: 0, postscriptName: 'SourceSans3-Regular' }, office: { style: 'regular' } });
  expect(bold).toMatchObject({ asset: { file, faceIndex: 1, postscriptName: 'SourceSans3-Bold' }, office: { style: 'bold' } });
  expect(regular?.asset.sha256).toBe(bold?.asset.sha256);
});

it('uses the CSS declaration for matching but the asset metadata for Office identity', async () => {
  const fontFaces: DeckFontFace[] = [{ family: 'Heebo', file: medium, weight: 800 }];
  const catalog = await FontCatalog.scan({
    deckFaces: fontFaces, system: [resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-ExtraBold.ttf')],
  });
  const { run } = resolveForStack(catalog, ['Heebo'], fontFaces, 800);
  expect(run.weight).toBe(800);
  expect(run.font).toMatchObject({
    class: 'deck-provided', asset: { file: medium }, office: { family: 'Heebo Medium', style: 'regular' },
  });
});

function resolveForStack(catalog: FontCatalog, stack: string[], fontFaces: DeckFontFace[] = [], weight = 400) {
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
    title: 'font identity', lang: 'en', canvas: { width: 1280, height: 720, source: 'default' }, fontFaces,
    slides: [{ index: 1, id: 'slide-1', name: 'Slide 1', layout: 'Blank', elements: [shape] }],
  };
  return { deck, run, entries: resolveDeckFonts(deck, catalog, { embedFonts: false }) };
}
