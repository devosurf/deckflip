import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { auditVisibleFonts, FontCatalog, resolveDeckFonts } from '../../src/fonts/index.js';
import { loadDeck } from '../../src/html/load.js';
import { measureDeck } from '../../src/html/measure.js';
import { textBodiesOf, type Deck } from '../../src/model/index.js';
import { emitPptx } from '../../src/emit/index.js';
import { emitHtml } from '../../src/htmlout/index.js';
import { parsePptx } from '../../src/parse/index.js';
import { BUNDLED_FONT_MANIFEST, bundledFontFile } from '../../src/bundled-fonts.js';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

function runs(deck: Deck) {
  return deck.slides.flatMap((slide) => slide.elements.flatMap((element) =>
    [...textBodiesOf(element)].flatMap(({ body }) => body.paragraphs.flatMap((paragraph) =>
      paragraph.runs.filter((run) => run.kind === 'text')))));
}

it('keeps authored browser weights when Office regular names a Medium or ExtraBold face', async () => {
  const { deck, fonts } = await measureDeck(await loadDeck('fixtures/corpus/fonts/office-identity/deck.html', {}), { browser });
  const catalog = await FontCatalog.scan({ declared: fonts.declared, system: false });
  expect(runs(deck).map((run) => [run.text, run.style.weight])).toEqual([
    ['Heebo Medium editable', 500], ['Heebo Bold editable', 700], ['Heebo ExtraBold editable', 800],
    ['Source Sans Regular editable', 400], ['Source Sans Bold editable', 700],
    ['Source Sans Italic editable', 400], ['Source Sans Bold Italic editable', 700],
  ]);
  resolveDeckFonts(deck, catalog, { embedFonts: false });
  expect(runs(deck).slice(0, 3).map((run) => [run.style.weight, run.style.font?.office])).toEqual([
    [500, { family: 'Heebo Medium', style: 'regular' }],
    [700, { family: 'Heebo', style: 'bold' }],
    [800, { family: 'Heebo ExtraBold', style: 'regular' }],
  ]);
});

it.each([
  { name: 'root-only authored family', css: 'html { font-family: Brand; }', section: '', inline: '', family: 'Source Sans 3' },
  { name: 'explicit body override', css: 'html { font-family: Brand; } body { font-family: Heebo; font-weight: 500; }', section: '', inline: '', family: 'Heebo Medium' },
  { name: 'explicit Slide override', css: 'html { font-family: Heebo; }', section: 'font-family: Brand', inline: '', family: 'Source Sans 3' },
  { name: 'inline override', css: 'html { font-family: Heebo; }', section: '', inline: 'font-family: Brand', family: 'Source Sans 3' },
  { name: 'Tailwind-style layered root rule', css: '@layer theme, base, components, utilities; @layer base { html { font-family: Brand; } }', section: '', inline: '', family: 'Source Sans 3' },
])('measures and emits the $name ahead of the bundled root default', async ({ css, section, inline, family }) => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-font-cascade-'));
  const regular = pathToFileURL(resolve('fixtures/corpus/fonts/_assets/source-sans-3/SourceSans3-Regular.ttf')).href;
  const medium = pathToFileURL(resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf')).href;
  try {
    const input = join(dir, 'deck.html');
    await writeFile(input, `<!doctype html><html><head><style>
      @font-face { font-family: Brand; src: url('${regular}'); }
      @font-face { font-family: Heebo; font-weight: 500; src: url('${medium}'); }
      ${css}
      p { font-size: 32px; }
      </style></head><body><section style="${section}"><p style="${inline}">Authored text</p></section></body></html>`);
    const measured = await measureDeck(await loadDeck(input, {}), { browser });
    const catalog = await FontCatalog.scan({ declared: measured.fonts.declared, system: false });
    const entries = [...measured.entries, ...resolveDeckFonts(measured.deck, catalog, { embedFonts: false }), ...auditVisibleFonts(measured.visibleText, catalog)];
    expect(entries.filter((entry) => entry.code !== 'FONT_NOT_SAFE')).toEqual([]);
    const [run] = runs(measured.deck);
    expect(run?.style.font?.office).toEqual({ family, style: 'regular' });
    expect(run?.style.fontStack).toEqual([family === 'Source Sans 3' ? 'Brand' : 'Heebo']);
    const pptx = await parsePptx(await emitPptx(measured.deck, { appVersion: 'test' }));
    expect(runs(pptx).map((run) => run.style.fontStack)).toEqual([[family]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('measures all four unstyled faces from checked bundled bytes without installed fonts and emits their Office identities', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-bundled-font-'));
  try {
    const input = join(dir, 'deck.html');
    await writeFile(input, `<!doctype html><html><head><style>p { font-size: 32px; }</style></head><body><section>
      <p>Regular</p><p><b>Bold</b></p><p><i>Italic</i></p><p><b><i>Bold italic</i></b></p>
      </section></body></html>`);
    const measured = await measureDeck(await loadDeck(input, {}), { browser });
    const catalog = await FontCatalog.scan({ declared: measured.fonts.declared, system: false });
    const entries = [...measured.entries, ...resolveDeckFonts(measured.deck, catalog, { embedFonts: false }), ...auditVisibleFonts(measured.visibleText, catalog)];
    expect(entries.filter((entry) => entry.code !== 'FONT_NOT_SAFE')).toEqual([]);
    expect(entries.filter((entry) => entry.code === 'FONT_NOT_SAFE')).toHaveLength(1);
    const selected = runs(measured.deck).map((run) => run.style.font!);
    expect(selected.map((font) => font.office)).toEqual(
      ['regular', 'bold', 'italic', 'boldItalic'].map((style) => ({ family: 'Liberation Sans', style })));
    for (const [index, font] of selected.entries()) {
      const face = BUNDLED_FONT_MANIFEST.fonts[index]!;
      const bytes = await readFile(bundledFontFile(face.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(face.sha256);
      expect(font.asset).toMatchObject({
        sha256: face.sha256, faceIndex: 0,
        source: { kind: 'bundled', family: 'Liberation Sans', version: '2.1.5', file: face.file, format: 'ttf', sha256: face.sha256 },
      });
      expect(font.class).toBe('deck-provided');
      expect(font.fsType).toBe(0);
      const tags = Array.from({ length: bytes.readUInt16BE(4) }, (_, i) => bytes.toString('ascii', 12 + i * 16, 16 + i * 16));
      expect(tags).not.toContain('fvar');
    }
    const pptx = await parsePptx(await emitPptx(measured.deck, { appVersion: 'test' }));
    expect(runs(pptx).map((run) => [run.style.fontStack, run.style.bold, run.style.italic])).toEqual([
      [['Liberation Sans'], false, false], [['Liberation Sans'], true, false],
      [['Liberation Sans'], false, true], [['Liberation Sans'], true, true],
    ]);
    const html = emitHtml(pptx).html;
    expect(html).not.toContain('bundled-fonts.deckflip.invalid');
    expect(html).not.toContain('file://');
    expect(html).toContain('Liberation Sans');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('reports an explicitly missing brand family without appending the bundled default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-missing-brand-'));
  try {
    const input = join(dir, 'deck.html');
    await writeFile(input, '<!doctype html><html style="font-family: MissingBrand35"><head></head><body><section><p>Brand</p></section></body></html>');
    const measured = await measureDeck(await loadDeck(input, {}), { browser });
    const catalog = await FontCatalog.scan({ declared: measured.fonts.declared, system: false });
    expect(resolveDeckFonts(measured.deck, catalog, { embedFonts: false })).toContainEqual(expect.objectContaining({ code: 'FONT_UNRESOLVED' }));
    expect(runs(measured.deck)[0]?.style.fontStack).toEqual(['MissingBrand35']);
    expect(runs(measured.deck)[0]?.style.font).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
