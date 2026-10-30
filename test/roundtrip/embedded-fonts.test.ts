import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { convertHtmlToPptx, convertPptxToHtml } from '../../src/convert.js';
import { launchChromium } from '../../src/render/chromium.js';
import { emitPptx } from '../../src/emit/index.js';
import { FontCatalog, prepareFontEmbedding, resolveDeckFonts } from '../../src/fonts/index.js';
import { wrapEot } from '../../src/fonts/eot.js';
import { emitHtml } from '../../src/htmlout/index.js';
import { inspectDeck } from '../../src/inspect/index.js';
import { textBodiesOf } from '../../src/model/index.js';
import { OpcReader, REL } from '../../src/ooxml/opc.js';
import { parsePptx } from '../../src/parse/index.js';
import { embeddedFontEntries } from '../../src/roundtrip/entries.js';
import { resolveRoundTrip } from '../../src/roundtrip/index.js';
import { buildManifest, MANIFEST_FILE, sectionsOf, sha256, SOURCE_FILE } from '../../src/roundtrip/manifest.js';
import { indexSource } from '../../src/roundtrip/source.js';
import { buildPptx } from '../render/pptx-fixture.js';

const family = 'Unavailable Source Family ExtraBold';
const shape = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="2743200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"><a:latin typeface="${family}"/></a:rPr><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp>`;
const fontList = `<p:embeddedFontLst><p:embeddedFont><p:font typeface="${family}" pitchFamily="34" charset="1"/><p:bold r:id="rId20"/><p:italic r:id="rId21"/></p:embeddedFont></p:embeddedFontLst>`;
const fontPart = '/ppt/fonts/original.fntdata';

/** Opaque synthetic MTX bytes exercise preservation, not the PowerPoint rendering proof. */
function syntheticMtx(subset: boolean, fsType: number): Buffer {
  const name = (value: string, padding: boolean): Buffer => {
    const bytes = Buffer.from(value, 'utf16le');
    const prefix = Buffer.alloc(padding ? 4 : 2);
    prefix.writeUInt16LE(bytes.length, prefix.length - 2);
    return Buffer.concat([prefix, bytes]);
  };
  const fixed = Buffer.alloc(82);
  fixed.writeUInt32LE(0x00010000, 8);
  fixed.writeUInt32LE(subset ? 5 : 4, 12);
  fixed.writeUInt16LE(fsType, 32);
  fixed.writeUInt16LE(0x504c, 34);
  const payload = Buffer.from([0x4d, 0x54, 0x58, 1, 2, 3]);
  const eot = Buffer.concat([fixed, name('Internal family 3', false), name('Regular', true), name('Version 1', true), name('Internal face 3', true), payload]);
  eot.writeUInt32LE(eot.length, 0);
  eot.writeUInt32LE(payload.length, 4);
  return eot;
}

async function fixture(payload?: Buffer): Promise<Buffer> {
  payload ??= await readFile(new URL('../fixtures/fonts/powerpoint-mtx-subset.fntdata', import.meta.url));
  const zip = await JSZip.loadAsync(await buildPptx({ slides: [{ shapes: shape }], presentationTail: fontList, contentTypes: { defaults: { fntdata: 'application/x-fontdata' } } }));
  const rels = zip.file('ppt/_rels/presentation.xml.rels')!;
  zip.file('ppt/_rels/presentation.xml.rels', (await rels.async('string')).replace('</Relationships>', `<Relationship Id="rId20" Type="${REL.font}" Target="fonts/original.fntdata"/><Relationship Id="rId21" Type="${REL.font}" Target="fonts/original.fntdata"/></Relationships>`));
  zip.file('ppt/presentation.xml', (await zip.file('ppt/presentation.xml')!.async('string')).replace('<p:presentation ', '<p:presentation embedTrueTypeFonts="1" saveSubsetFonts="1" '));
  zip.file(fontPart.slice(1), payload);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function roundTripFixture(payload?: Buffer) {
  const bytes = await fixture(payload);
  const deck = await parsePptx(bytes);
  const source = await indexSource(await OpcReader.load(bytes));
  const emitted = emitHtml(deck);
  const manifest = buildManifest(emitted.html, emitted.slides, source, sha256(bytes));
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-embedded-preserve-'));
  const htmlPath = join(dir, 'deck.html');
  const assets = join(dir, 'deck.assets');
  await mkdir(assets);
  await writeFile(htmlPath, emitted.html);
  await writeFile(join(assets, SOURCE_FILE), bytes);
  await writeFile(join(assets, MANIFEST_FILE), JSON.stringify(manifest));
  return { bytes, deck, source, emitted, dir, htmlPath };
}

describe('existing embedded package fonts', () => {
  it('inspects presentation slots, EOT rights and internal identity without requiring decoded MTX', async () => {
    const deck = await parsePptx(await fixture());
    const inspected = inspectDeck(deck);
    expect(inspected.embeddedFonts).toHaveLength(2);
    expect(inspected.embeddedFonts?.[0]).toMatchObject({ family, slot: 'bold', part: fontPart, kind: 'mtx', fsType: 0, flags: 5, subset: true, compressed: true, familyName: 'Heebo Medium', styleName: 'Regular' });
    expect(inspected.embeddedFonts?.[0]).not.toHaveProperty('embedding');
    expect(inspected.embeddedFonts?.[0]).not.toHaveProperty('sha256');
    expect(inspected.embeddedFonts?.[0]).not.toHaveProperty('sfnt');
    expect(inspected.fonts).toEqual([]);
    expect(embeddedFontEntries(deck).filter((entry) => entry.code === 'FONT_EMBED_SUBSET')).toHaveLength(2);
  });

  it.each([
    { edited: false, subset: false }, { edited: true, subset: false },
    { edited: false, subset: true }, { edited: true, subset: true },
  ])('preserves PowerPoint-written MTX and original slots when edited=$edited, subset=$subset', async ({ edited, subset }) => {
    const payload = await readFile(new URL(`../fixtures/fonts/powerpoint-mtx-${subset ? 'subset' : 'all'}.fntdata`, import.meta.url));
    const f = await roundTripFixture(payload);
    try {
      const html = edited ? f.emitted.html.replace('Hello', 'Hello again') : f.emitted.html;
      if (edited) {
        for (const element of f.deck.slides[0]!.elements) {
          for (const { body } of textBodiesOf(element)) {
            const run = body.paragraphs[0]?.runs[0];
            if (run?.kind === 'text') run.text = 'Hello again';
          }
        }
      }
      // Simulate a measured Deck: package-only metadata is reattached from the verified source.
      delete f.deck.embeddedFonts;
      for (const element of f.deck.slides[0]!.elements) for (const { body } of textBodiesOf(element)) for (const paragraph of body.paragraphs) for (const run of paragraph.runs) if (run.kind === 'text') delete run.style.embeddedFont;
      const roundTrip = await resolveRoundTrip(f.deck, sectionsOf(html), f.htmlPath);
      const catalog = await FontCatalog.scan({ system: false });
      expect(resolveDeckFonts(f.deck, catalog)).toEqual([]);
      expect((await prepareFontEmbedding(f.deck, catalog, { embedFonts: true })).fonts).toEqual([]);
      expect(roundTrip.identical !== undefined).toBe(!edited);
      const output = roundTrip.identical ?? await emitPptx(f.deck, { appVersion: 'test', preserved: roundTrip.preserved!, embedFonts: true });
      const reader = await OpcReader.load(output);
      expect(await reader.bytes(fontPart)).toEqual(await f.source.reader.bytes(fontPart));
      const presentation = new TextDecoder().decode(await reader.bytes('/ppt/presentation.xml'));
      expect(presentation).toContain(fontList);
      expect(presentation).toContain('embedTrueTypeFonts="1"');
      expect((await reader.relationships('/ppt/presentation.xml')).filter((rel) => rel.type === REL.font).map((rel) => [rel.id, rel.target])).toEqual([['rId20', fontPart], ['rId21', fontPart]]);
      const parsed = await parsePptx(output);
      expect(inspectDeck(parsed).embeddedFonts).toEqual(inspectDeck(f.deck).embeddedFonts);
      expect(new TextDecoder().decode(await reader.bytes('/ppt/slides/slide1.xml'))).toContain(edited ? 'Hello again' : 'Hello');
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });

  it.each([false, true])('preserves every source font part, relationship and setting under opt-out when edited=%s', async (edited) => {
    const f = await roundTripFixture();
    try {
      const html = edited ? f.emitted.html.replace('Hello', 'Hello again') : f.emitted.html;
      const roundTrip = await resolveRoundTrip(f.deck, sectionsOf(html), f.htmlPath);
      expect(roundTrip.identical !== undefined).toBe(!edited);
      const output = await emitPptx(f.deck, { appVersion: 'test', preserved: roundTrip.preserved!, embedFonts: false });
      const reader = await OpcReader.load(output);
      expect(await reader.bytes(fontPart)).toEqual(await f.source.reader.bytes(fontPart));
      expect((await reader.relationships('/ppt/presentation.xml')).filter((rel) => rel.type === REL.font)).toEqual(f.source.presentation.rels.filter((rel) => rel.type === REL.font));
      const presentation = new TextDecoder().decode(await reader.bytes('/ppt/presentation.xml'));
      expect(presentation).toContain(fontList);
      expect(presentation).toContain('embedTrueTypeFonts="1"');
      expect(presentation).toContain('saveSubsetFonts="1"');
      expect(embeddedFontEntries(f.deck).some((entry) => entry.code === 'FONT_NOT_EMBEDDED')).toBe(false);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });

  it.each([false, true])('warns that edited text coverage cannot be verified for preserved MTX subset=%s', async (subset) => {
    const f = await roundTripFixture(syntheticMtx(subset, 0));
    try {
      const roundTrip = await resolveRoundTrip(f.deck, sectionsOf(f.emitted.html.replace('Hello', 'Hello Ω')), f.htmlPath);
      expect(embeddedFontEntries(f.deck, roundTrip.preserved?.plan)).toContainEqual(expect.objectContaining({
        code: 'FONT_EMBED_SUBSET', severity: 'warning', reason: expect.stringMatching(/edited text.*coverage cannot be verified.*new characters may fall back/i),
      }));
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });

  it('does not label Untouched text coverage as edited after an unrelated shape is added', async () => {
    const f = await roundTripFixture();
    try {
      const html = f.emitted.html.replace('</section>', '<div style="position:absolute;left:0;top:0;width:10px;height:10px;background:red"></div></section>');
      const roundTrip = await resolveRoundTrip(f.deck, sectionsOf(html), f.htmlPath);
      expect(roundTrip.identical).toBeUndefined();
      expect(embeddedFontEntries(f.deck, roundTrip.preserved?.plan).filter((entry) => entry.code === 'FONT_EMBED_SUBSET')).toHaveLength(2);
      expect(embeddedFontEntries(f.deck, roundTrip.preserved?.plan).some((entry) => /edited text/i.test(entry.reason))).toBe(false);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });

  it('inspects decoded sfnt identity and actual used embedded faces rather than the EOT wrapper digest', async () => {
    const sfnt = await readFile(new URL('../../assets/fonts/liberation-sans-2.1.5/LiberationSans-Regular.ttf', import.meta.url));
    const deck = await parsePptx(await fixture(wrapEot(sfnt)));
    const inspected = inspectDeck(deck);
    expect(inspected.embeddedFonts?.[0]).toMatchObject({ sha256: sha256(sfnt), kind: 'complete' });
    expect(inspected.fonts).toHaveLength(1);
    expect(inspected.fonts[0]).toMatchObject({ cssFamily: family, asset: { sha256: sha256(sfnt), postscriptName: 'LiberationSans', source: { kind: 'embedded', part: fontPart } } });
    expect(inspected.fonts[0]).not.toHaveProperty('embedding');
    expect(inspected.embeddedFonts?.[0]).not.toHaveProperty('embedding');
    expect(deck.embeddedFonts?.[0]?.embedding.status).toBe('preserved');
  });

  it('decodes a valid XOR EOT payload for inspection and HTML while preserving the original wrapper', async () => {
    const sfnt = await readFile(new URL('../../assets/fonts/liberation-sans-2.1.5/LiberationSans-Regular.ttf', import.meta.url));
    const eot = wrapEot(sfnt);
    eot.writeUInt32LE(0x10000000, 12);
    for (let offset = eot.length - sfnt.length; offset < eot.length; offset += 1) eot[offset] = eot[offset]! ^ 0x50;
    const f = await roundTripFixture(eot);
    try {
      expect(f.deck.embeddedFonts?.[0]?.sfnt).toEqual(sfnt);
      expect(inspectDeck(f.deck).embeddedFonts?.[0]).toMatchObject({ kind: 'xor', sha256: sha256(sfnt) });
      expect(inspectDeck(f.deck).fonts[0]?.asset.sha256).toBe(sha256(sfnt));
      expect([...f.emitted.assets.values()]).toEqual([sfnt]);
      const roundTrip = await resolveRoundTrip(f.deck, sectionsOf(f.emitted.html), f.htmlPath);
      const output = await emitPptx(f.deck, { appVersion: 'test', preserved: roundTrip.preserved!, embedFonts: false });
      expect(await (await OpcReader.load(output)).bytes(fontPart)).toEqual(new Uint8Array(eot.buffer, eot.byteOffset, eot.byteLength));
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });

  it('reuses decoded payload identity between parsing and source indexing on one package reader', async () => {
    const sfnt = await readFile(new URL('../../assets/fonts/liberation-sans-2.1.5/LiberationSans-Regular.ttf', import.meta.url));
    const reader = await OpcReader.load(await fixture(wrapEot(sfnt)));
    const deck = await parsePptx(reader);
    const source = await indexSource(reader);
    expect(deck.embeddedFonts?.[0]?.sfnt).toBe(source.embeddedFonts[0]?.sfnt);
    expect(deck.embeddedFonts?.[1]?.sfnt).toBe(source.embeddedFonts[0]?.sfnt);
  });

  it('skips embedded font payloads when parsing for structural Verification', async () => {
    const deck = await parsePptx(await fixture(), { embeddedFonts: false });
    expect(deck.embeddedFonts).toBeUndefined();
    expect(inspectDeck(deck).slides[0]?.elements.some((element) => element.text === 'Hello')).toBe(true);
  });

  it('exposes a full uncompressed source sfnt to HTML without rewriting its EOT part', async () => {
    const sfnt = await readFile(new URL('../../assets/fonts/liberation-sans-2.1.5/LiberationSans-Regular.ttf', import.meta.url));
    const eot = wrapEot(sfnt);
    const f = await roundTripFixture(eot);
    try {
      const fonts = f.deck.embeddedFonts!;
      expect(fonts[0]!.sfnt).toEqual(sfnt);
      expect(fonts[1]!.sfnt).toBe(fonts[0]!.sfnt);
      expect(f.emitted.html).toContain('@font-face');
      expect([...f.emitted.assets.values()]).toEqual([sfnt]);
      const roundTrip = await resolveRoundTrip(f.deck, sectionsOf(f.emitted.html), f.htmlPath);
      const output = await emitPptx(f.deck, { appVersion: 'test', preserved: roundTrip.preserved!, embedFonts: true });
      expect(Buffer.from(await (await OpcReader.load(output)).bytes(fontPart))).toEqual(eot);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });

  it.each([0x0002, 0x0004, 0x0200, 0x0400])('retains restricted fsType %i and reports it rather than treating preservation as editable permission', async (fsType) => {
    const deck = await parsePptx(await fixture(syntheticMtx(false, fsType)));
    expect(deck.embeddedFonts?.[0]?.fsType).toBe(fsType);
    expect(embeddedFontEntries(deck).find((entry) => entry.code === 'FONT_EMBED_RESTRICTED')?.severity).toBe('warning');
  });
});

const browserAvailable = await launchChromium({ offline: true }).then(async (browser) => {
  await browser.close();
  return true;
}).catch(() => false);

describe.skipIf(!browserAvailable)('embedded font round trip through convert', () => {
  it('keeps a PowerPoint-written subset payload through untouched, edited and opted-out conversions', async () => {
    const browser = await launchChromium({ offline: true });
    const dir = await mkdtemp(join(tmpdir(), 'deckflip-real-mtx-'));
    try {
      const payload = await readFile(new URL('../fixtures/fonts/powerpoint-mtx-subset.fntdata', import.meta.url));
      const input = join(dir, 'source.pptx');
      await writeFile(input, await fixture(payload));
      const html = join(dir, 'deck.html');
      const toHtml = await convertPptxToHtml(input, { output: html, offline: true, browser });
      expect(toHtml.exitCode, JSON.stringify(toHtml.report.entries)).toBe(0);
      expect(toHtml.report.embeddedFonts?.[0]).toMatchObject({ subset: true, compressed: true, embedding: { status: 'preserved' } });
      for (const edited of [false, true]) {
        if (edited) await writeFile(html, (await readFile(html, 'utf8')).replace('Hello', 'Hello again'));
        const output = join(dir, `${edited ? 'edited' : 'untouched'}.pptx`);
        const converted = await convertHtmlToPptx(html, { output, embedFonts: true, rasterDpi: 96, offline: true, browser });
        expect(converted.exitCode, JSON.stringify(converted.report.entries)).toBe(0);
        const reader = await OpcReader.load(await readFile(output));
        expect(Buffer.from(await reader.bytes(fontPart))).toEqual(payload);
        expect(converted.report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_EMBED_SUBSET', severity: 'warning' }));
        expect(converted.report.entries.some((entry) => entry.code === 'FONT_UNRESOLVED')).toBe(false);
      }
      const output = join(dir, 'not-embedded.pptx');
      const optedOut = await convertHtmlToPptx(html, { output, embedFonts: false, rasterDpi: 96, offline: true, browser });
      expect(optedOut.exitCode, JSON.stringify(optedOut.report.entries)).toBe(0);
      expect((await OpcReader.load(await readFile(output))).hasPart(fontPart)).toBe(true);
      expect(optedOut.report.entries.filter((entry) => entry.code === 'FONT_NOT_EMBEDDED')).toHaveLength(0);
    } finally {
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
