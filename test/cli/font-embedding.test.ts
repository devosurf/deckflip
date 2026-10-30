import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium, type Browser } from 'playwright-core';
import JSZip from 'jszip';
import woff2Decompress from 'wawoff2/decompress.js';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { convertHtmlToPptx, validateHtml } from '../../src/convert.js';
import { wrapEot } from '../../src/fonts/eot.js';
import { OpcReader } from '../../src/ooxml/opc.js';
import type { XmlNode } from '../../src/ooxml/xml.js';
import type { Report } from '../../src/report/types.js';
import { fontCollection, mutateFont, woff2FromSfnt } from '../fonts/fixture.js';
import { buildPptx } from '../render/pptx-fixture.js';

const MEDIUM = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-Medium.ttf');
const BOLD = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-Bold.ttf');
const EXTRABOLD = resolve('fixtures/corpus/fonts/_assets/heebo/Heebo-ExtraBold.ttf');
const FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';
const run = promisify(execFile);
const cleanup: Array<() => Promise<void>> = [];
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });
afterEach(async () => { await Promise.all(cleanup.splice(0).map((done) => done())); });

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-embedding-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Async subprocesses let the in-process font CDN answer Chromium and acquisition. */
async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await run(process.execPath, ['--import', 'tsx', 'src/cli/main.ts', ...args, ...(args[0] === 'inspect' ? [] : ['--quiet'])], {
      encoding: 'utf8', timeout: 60_000, env: { ...process.env, DECKFLIP_OFFLINE: '1', SOURCE_DATE_EPOCH: '1700000000' },
    });
    return { code: 0, ...result };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'number' || !('stdout' in error) || !('stderr' in error)) throw error;
    return { code: error.code, stdout: String(error.stdout), stderr: String(error.stderr) };
  }
}

function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap((child) => typeof child === 'string' ? [] : [
    ...(child.name === name ? [child] : []), ...descendants(child, name),
  ]);
}

function face(file: string, weight = 500, family = 'Brand', extra = ''): string {
  return `@font-face { font-family: ${family}; font-weight: ${weight}; src: url('${pathToFileURL(file).href}'); ${extra} }`;
}

async function deck(dir: string, css = face(MEDIUM), content = '<p>Portable editable text</p>'): Promise<string> {
  const input = join(dir, 'deck.html');
  await writeFile(input, `<!doctype html><html><head><meta charset="utf-8"><style>
    ${css}
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { font: 500 24px/36px Brand }
    p { position: relative; margin: 20px; width: 1100px; }
    </style></head><body><section>${content}</section></body></html>`);
  return input;
}

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

/** Read the proven uncompressed EOT layout independently of the production writer. */
function unwrapEot(bytes: Buffer): Buffer {
  expect(bytes.readUInt32LE(0)).toBe(bytes.length);
  expect(bytes.readUInt32LE(8)).toBe(0x00020002);
  expect(bytes.readUInt32LE(12)).toBe(0);
  expect(bytes.readUInt16LE(34)).toBe(0x504c);
  let offset = 82;
  for (let name = 0; name < 5; name++) {
    const length = bytes.readUInt16LE(offset);
    offset += 2 + length;
    if (name < 4) offset += 2;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x50475342);
  offset += 20;
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - offset);
  return bytes.subarray(offset);
}

async function packaged(output: string, report: Report): Promise<OpcReader> {
  const opc = await OpcReader.load(await readFile(output));
  const rels = (await opc.relationships('/ppt/presentation.xml')).filter((rel) => rel.type === FONT_REL);
  const fontParts = opc.partNames().filter((name) => name.startsWith('/ppt/fonts/'));
  expect(fontParts.sort()).toEqual(rels.map((rel) => rel.target).sort());
  expect(new Set(rels.map((rel) => rel.target)).size).toBe(rels.length);
  const contentType = await opc.contentTypes();
  for (const font of report.fonts ?? []) {
    expect(font.embedding).toMatchObject({ status: 'embedded', part: expect.stringMatching(/^\/ppt\/fonts\/font\d+\.fntdata$/) });
    const part = font.embedding!.part!;
    expect(contentType(part)).toBe('application/x-fontdata');
    expect(rels.some((rel) => rel.target === part && !rel.external)).toBe(true);
    expect(hash(unwrapEot(Buffer.from(await opc.bytes(part))))).toBe(font.asset.sha256);
  }
  const presentation = await opc.xml('/ppt/presentation.xml');
  expect(presentation.attrs.embedTrueTypeFonts).toBe('1');
  expect(presentation.attrs.saveSubsetFonts).toBeUndefined();
  const children = presentation.children.filter((child): child is XmlNode => typeof child !== 'string');
  expect(children.findIndex((child) => child.name === 'p:embeddedFontLst')).toBeGreaterThan(children.findIndex((child) => child.name === 'p:notesSz'));
  return opc;
}

it('CLI embeds exact local Heebo 500/700/800 faces in their Office RIBBI slots, sharing duplicate faces', async () => {
  const dir = await workspace();
  const input = await deck(dir, face(MEDIUM) + face(BOLD, 700) + face(EXTRABOLD, 800) + face(MEDIUM, 500, 'Alias'),
    '<p>Medium</p><p style="font-weight: 700">Bold</p><p style="font-weight: 800">ExtraBold</p><p style="font-family: Alias">Same face</p>');
  const output = join(dir, 'portable.pptx');
  const result = await cli('convert', input, '-o', output, '--strict', '--json');
  expect(result.code, result.stderr || result.stdout).toBe(0);
  const report: Report = JSON.parse(result.stdout);
  expect(report.entries).toEqual([]);
  const opc = await packaged(output, report);
  expect(opc.partNames().filter((name) => name.startsWith('/ppt/fonts/'))).toHaveLength(3);
  expect(new Set(report.fonts?.map((font) => font.asset.sha256))).toEqual(new Set(await Promise.all([MEDIUM, BOLD, EXTRABOLD].map(async (file) => hash(await readFile(file))))));
  const inspected = await cli('inspect', input);
  expect(inspected.code, inspected.stderr || inspected.stdout).toBe(0);
  const inspection: { fonts: Array<{ asset: { sha256: string }; office: { family: string; style: string } }> } = JSON.parse(inspected.stdout);
  expect(inspection.fonts).toHaveLength(3);
  expect(new Set(inspection.fonts.map((font) => font.asset.sha256))).toEqual(
    new Set(await Promise.all([MEDIUM, BOLD, EXTRABOLD].map(async (file) => hash(await readFile(file))))),
  );
  expect(inspection.fonts.map((font) => font.office)).toEqual(expect.arrayContaining([
    { family: 'Heebo Medium', style: 'regular' }, { family: 'Heebo', style: 'bold' }, { family: 'Heebo ExtraBold', style: 'regular' },
  ]));
  const rels = await opc.relationships('/ppt/presentation.xml');
  const embedded = descendants(await opc.xml('/ppt/presentation.xml'), 'p:embeddedFont');
  expect(embedded.map((font) => ({
    family: descendants(font, 'p:font')[0]!.attrs.typeface,
    slots: font.children.flatMap((child) => typeof child !== 'string' && child.name !== 'p:font' ? [child.name] : []),
  }))).toEqual(expect.arrayContaining([
    { family: 'Heebo Medium', slots: ['p:regular'] },
    { family: 'Heebo', slots: ['p:bold'] },
    { family: 'Heebo ExtraBold', slots: ['p:regular'] },
  ]));
  expect(embedded).toHaveLength(3);
  for (const font of embedded) {
    const slot = font.children.find((child): child is XmlNode => typeof child !== 'string' && child.name !== 'p:font')!;
    expect(rels.some((rel) => rel.id === slot.attrs['r:id'] && rel.type === FONT_REL)).toBe(true);
  }
  const again = join(dir, 'again.pptx');
  const repeated = await cli('convert', input, '-o', again, '--strict', '--json');
  expect(repeated.code, repeated.stderr).toBe(0);
  expect(await readFile(again)).toEqual(await readFile(output));
  expect(JSON.parse(repeated.stdout).fonts).toEqual(report.fonts);
});

it('CLI embeds the decoded Google Fonts-style WOFF2 asset served by an in-process HTTP host', async () => {
  const dir = await workspace();
  const woff2 = await woff2FromSfnt(await readFile(MEDIUM));
  const decoded = Buffer.from(await woff2Decompress(woff2));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    if (request.url?.startsWith('/css2?')) response.writeHead(200, { 'content-type': 'text/css' }).end(
      "@font-face { font-family: Brand; font-weight: 500; src: url('/s/heebo/v28/latin.woff2') format('woff2'); unicode-range: U+0-FF; }");
    else if (request.url === '/s/heebo/v28/latin.woff2') response.writeHead(200, { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' }).end(woff2);
    else response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => server.close(() => done())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const input = await deck(dir);
  await writeFile(input, `<!doctype html><html><head><link rel="stylesheet" href="${origin}/css2?family=Heebo:wght@500"><style>
    body { font: 500 24px/36px Brand } p { margin: 40px }
    </style></head><body><section><p>Hosted editable Latin</p></section></body></html>`);
  const output = join(dir, 'hosted.pptx');
  const result = await cli('convert', input, '-o', output, '--json');
  expect(result.code, result.stderr || result.stdout).toBe(0);
  const report: Report = JSON.parse(result.stdout);
  expect(report.fonts).toHaveLength(1);
  expect(report.fonts![0]).toMatchObject({ asset: { sha256: hash(decoded), source: { kind: 'remote', format: 'woff2' } }, embedding: { status: 'embedded', subset: true } });
  expect(report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_EMBED_SUBSET', severity: 'warning', reason: expect.stringMatching(/subset/i) }));
  await packaged(output, report);
  expect(requests).toContain('/css2?family=Heebo:wght@500');
  expect(requests).toContain('/s/heebo/v28/latin.woff2');
});

it.each([0x0002, 0x0004, 0x0200])('rejects fsType %i by default but explicitly warns and emits no fonts under the opt-out', async (fsType) => {
  const dir = await workspace();
  const restricted = join(dir, 'restricted.ttf');
  await mutateFont(MEDIUM, restricted, { fsType });
  const input = await deck(dir, face(restricted));
  const output = join(dir, 'kept.pptx');
  await writeFile(output, 'Existing Deck');
  for (const command of ['convert', 'validate']) {
    const failed = await cli(command, input, ...(command === 'convert' ? ['-o', output] : []), '--strict', '--json');
    expect(failed.code, failed.stderr || failed.stdout).toBe(2);
    const report: Report = JSON.parse(failed.stdout);
    expect(report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_EMBED_RESTRICTED', kind: 'error', severity: 'error' }));
    expect(report.fonts![0]!.fsType).toBe(fsType);
    expect(report.fonts![0]!.embedding?.status).not.toBe('embedded');
    expect(await readFile(output, 'utf8')).toBe('Existing Deck');
  }
  const optedOut = await cli('convert', input, '-o', output, '--no-embed-fonts', '--json');
  expect(optedOut.code, optedOut.stderr || optedOut.stdout).toBe(0);
  const report: Report = JSON.parse(optedOut.stdout);
  expect(report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_EMBED_RESTRICTED', severity: 'warning' }));
  expect(report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_NOT_EMBEDDED', severity: 'warning', reason: expect.stringMatching(/install/i) }));
  expect(report.fonts![0]!.embedding).toMatchObject({ status: 'not-embedded' });
  const opc = await OpcReader.load(await readFile(output));
  expect(opc.partNames().filter((part) => part.startsWith('/ppt/fonts/'))).toEqual([]);
  expect((await opc.relationships('/ppt/presentation.xml')).filter((rel) => rel.type === FONT_REL)).toEqual([]);
  expect((await opc.xml('/ppt/presentation.xml')).attrs.embedTrueTypeFonts).toBeUndefined();
});

it('validate describes eligibility, never completed packaging, and the opt-out reports every used face', async () => {
  const dir = await workspace();
  const input = await deck(dir, face(MEDIUM) + face(BOLD, 700), '<p>Medium</p><p style="font-weight:700">Bold</p>');
  const result = await cli('validate', input, '--strict', '--json');
  expect(result.code, result.stderr || result.stdout).toBe(0);
  const report: Report = JSON.parse(result.stdout);
  expect(report.entries).toEqual([]);
  expect(report.fonts).toHaveLength(2);
  for (const font of report.fonts!) {
    expect(font.embedding).toMatchObject({ status: 'eligible' });
    expect(font.embedding?.part).toBeUndefined();
  }
  await expect(stat(join(dir, 'deck.pptx'))).rejects.toMatchObject({ code: 'ENOENT' });
  const optedOut = await cli('validate', input, '--no-embed-fonts', '--strict', '--json');
  expect(optedOut.code, optedOut.stderr).toBe(4);
  const warnings: Report = JSON.parse(optedOut.stdout);
  expect(warnings.entries.filter((entry) => entry.code === 'FONT_NOT_EMBEDDED')).toHaveLength(2);
  expect(warnings.fonts!.every((font) => font.embedding?.status === 'not-embedded')).toBe(true);
  const output = join(dir, 'machine-dependent.pptx');
  const converted = await cli('convert', input, '-o', output, '--no-embed-fonts', '--json');
  expect(converted.code, converted.stderr).toBe(0);
  const convertedReport: Report = JSON.parse(converted.stdout);
  expect(convertedReport.entries.filter((entry) => entry.code === 'FONT_NOT_EMBEDDED')).toHaveLength(2);
  expect(convertedReport.fonts!.every((font) => font.embedding?.status === 'not-embedded')).toBe(true);
  const opc = await OpcReader.load(await readFile(output));
  expect(opc.partNames().filter((part) => part.startsWith('/ppt/fonts/'))).toEqual([]);
  expect((await opc.relationships('/ppt/presentation.xml')).filter((rel) => rel.type === FONT_REL)).toEqual([]);
});

function pptxText(family: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="5486400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"/><a:p><a:r><a:rPr sz="1800"><a:latin typeface="${family}"/></a:rPr><a:t>Source text</a:t></a:r></a:p></p:txBody></p:sp>`;
}

it('PPTX convert and validate do not apply new font embedding eligibility to plain Arial text', async () => {
  const dir = await workspace();
  const input = join(dir, 'source.pptx');
  const output = join(dir, 'source.html');
  await writeFile(input, await buildPptx({ slides: [{ shapes: pptxText('Arial') }] }));
  for (const command of ['convert', 'validate']) {
    const result = await cli(command, input, ...(command === 'convert' ? ['-o', output] : []), '--strict=warning', '--json');
    expect(result.code, result.stderr || result.stdout).toBe(0);
    const report: Report = JSON.parse(result.stdout);
    expect(report.entries.filter((entry) => entry.code.startsWith('FONT_EMBED_') || entry.code === 'FONT_NOT_EMBEDDED')).toEqual([]);
    expect(report.fonts).not.toHaveLength(0);
    expect(report.fonts?.every((font) => font.embedding === undefined)).toBe(true);
  }
  expect(await readFile(output, 'utf8')).toContain('Source text');
});

it('PPTX restricted source EOT remains preserved with matching nonfatal convert and validate warnings', async () => {
  const dir = await workspace();
  const restricted = join(dir, 'restricted.ttf');
  await mutateFont(MEDIUM, restricted, { fsType: 0x0002 });
  const payload = wrapEot(await readFile(restricted));
  const family = 'Heebo Medium';
  const fontList = `<p:embeddedFontLst><p:embeddedFont><p:font typeface="${family}"/><p:regular r:id="rId20"/></p:embeddedFont></p:embeddedFontLst>`;
  const zip = await JSZip.loadAsync(await buildPptx({
    slides: [{ shapes: pptxText(family) }], presentationTail: fontList,
    contentTypes: { defaults: { fntdata: 'application/x-fontdata' } },
    parts: { 'ppt/fonts/original.fntdata': payload },
  }));
  const rels = zip.file('ppt/_rels/presentation.xml.rels')!;
  zip.file('ppt/_rels/presentation.xml.rels', (await rels.async('string')).replace('</Relationships>',
    `<Relationship Id="rId20" Type="${FONT_REL}" Target="fonts/original.fntdata"/></Relationships>`));
  const input = join(dir, 'restricted.pptx');
  await writeFile(input, await zip.generateAsync({ type: 'nodebuffer' }));
  for (const strict of [undefined, '--strict=warning']) {
    const reports: Report[] = [];
    for (const command of ['convert', 'validate']) {
      const output = join(dir, `restricted-${strict === undefined ? 'default' : 'strict'}.html`);
      const result = await cli(command, input, ...(command === 'convert' ? ['-o', output] : []), ...(strict === undefined ? [] : [strict]), '--json');
      expect(result.code, result.stderr || result.stdout).toBe(strict === undefined ? 0 : 4);
      const report: Report = JSON.parse(result.stdout);
      expect(report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_EMBED_RESTRICTED', kind: 'flagged', severity: 'warning' }));
      expect(report.entries.some((entry) => entry.severity === 'error' || entry.code === 'FONT_NOT_EMBEDDED')).toBe(false);
      expect(report.embeddedFonts).toEqual([expect.objectContaining({
        family, slot: 'regular', fsType: 0x0002, embedding: expect.objectContaining({ status: 'preserved' }),
      })]);
      reports.push(report);
      if (command === 'convert') {
        expect(await readFile(output, 'utf8')).toContain('Source text');
        expect(await readFile(join(dir, `restricted-${strict === undefined ? 'default' : 'strict'}.assets`, 'source.pptx'))).toEqual(await readFile(input));
      }
    }
    expect(reports[0]!.entries).toEqual(reports[1]!.entries);
  }
});

it.each(['convert', 'validate'])('rejects --no-embed-fonts for PPTX input before reading it in %s', async (command) => {
  const dir = await workspace();
  for (const extension of ['pptx', 'PPTM']) {
    const input = join(dir, `not-opened.${extension}`);
    const result = await cli(command, input, '--no-embed-fonts', '--json');
    expect(result.code, result.stderr).toBe(3);
    expect(result.stderr).toContain('--no-embed-fonts is only supported for HTML input');
    expect(result.stdout).toBe('');
    await expect(stat(input)).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

it.each(['convert', 'validate'])('rejects obsolete embedding flags as bad invocation in %s', async (command) => {
  for (const flag of ['--embed-fonts', '--embed-fonts=Heebo']) {
    const result = await cli(command, 'not-opened.html', flag, '--json');
    expect(result.code, result.stderr).toBe(3);
    expect(result.stderr).toContain('unknown option');
    expect(result.stdout).toBe('');
  }
});

it.each(['convert', 'validate'])('documents portable defaults and the sole machine-dependent opt-out in %s help', async (command) => {
  const result = await cli(command, '--help');
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain('--no-embed-fonts');
  expect(result.stdout).toContain('machine-dependent');
  expect(result.stdout).toContain('HTML input only');
  expect(result.stdout.replace(/\s+/g, ' ')).toContain('source embedded fonts are preserved');
  expect(result.stdout).not.toMatch(/--embed-fonts(?:\s|=)/);
  expect(result.stdout).not.toContain('unsupported:');
  if (command === 'validate') expect(result.stdout).toMatch(/eligibility\s+is\s+not\s+completed\s+embedding/);
});

it.each([0, 0x0008, 0x0100])('convert embeds the complete exact sfnt when editable fsType is %i', async (fsType) => {
  const dir = await workspace();
  const permitted = join(dir, 'permitted.ttf');
  await mutateFont(MEDIUM, permitted, { fsType });
  const input = await deck(dir, face(permitted));
  const output = join(dir, 'editable.pptx');
  const result = await convertHtmlToPptx(input, { browser, output, embedFonts: true, strict: 'info', rasterDpi: 96, offline: true });
  expect(result.exitCode).toBe(0);
  expect(result.report.entries).toEqual([]);
  expect(result.report.fonts![0]!.fsType).toBe(fsType);
  expect(result.report.fonts![0]!.asset.sha256).toBe(hash(await readFile(permitted)));
  await packaged(output, result.report);
});

it('convert rejects collection data rather than extracting or changing the measured face', async () => {
  const dir = await workspace();
  const collection = join(dir, 'collection.ttc');
  await fontCollection([MEDIUM, BOLD], collection);
  const input = await deck(dir, face(collection));
  const output = join(dir, 'collection.pptx');
  const result = await convertHtmlToPptx(input, { browser, output, embedFonts: true, rasterDpi: 96, offline: true });
  expect(result.exitCode).toBe(2);
  expect(result.report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_EMBED_FORMAT', severity: 'error', hint: expect.stringMatching(/standalone|ttf|otf/i) }));
  await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  const optedOut = await convertHtmlToPptx(input, { browser, output, embedFonts: false, rasterDpi: 96, offline: true });
  expect(optedOut.exitCode).toBe(0);
  expect(optedOut.report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_EMBED_FORMAT', severity: 'warning' }));
  expect((await OpcReader.load(await readFile(output))).partNames().filter((part) => part.startsWith('/ppt/fonts/'))).toEqual([]);
});

/** Limit a temporary fixture's cmap to one character; all outlines and identities stay intact. */
async function singleCharacterFont(source: string, destination: string, codePoint: number): Promise<void> {
  const bytes = await readFile(source);
  let cmap = 0;
  for (let index = 0; index < bytes.readUInt16BE(4); index++) {
    const record = 12 + index * 16;
    if (bytes.toString('ascii', record, record + 4) === 'cmap') cmap = bytes.readUInt32BE(record + 8);
  }
  if (!cmap) throw new Error('Fixture has no cmap');
  const visited = new Set<number>();
  for (let index = 0; index < bytes.readUInt16BE(cmap + 2); index++) {
    const table = cmap + bytes.readUInt32BE(cmap + 4 + index * 8 + 4);
    if (visited.has(table)) continue;
    visited.add(table);
    const format = bytes.readUInt16BE(table);
    if (format !== 4) throw new Error(`Expected the pinned Heebo format-4 cmap, got ${format}`);
    const segments = bytes.readUInt16BE(table + 6) / 2;
    const ends = table + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const offsets = deltas + segments * 2;
    for (let segment = 0; segment < segments; segment++) {
      const start = bytes.readUInt16BE(starts + segment * 2);
      const end = bytes.readUInt16BE(ends + segment * 2);
      const rangeOffset = bytes.readUInt16BE(offsets + segment * 2);
      if (rangeOffset === 0) {
        // Keep only the requested character in a direct-mapped segment; empty it otherwise.
        if (start <= codePoint && codePoint <= end) {
          bytes.writeUInt16BE(codePoint, starts + segment * 2);
          bytes.writeUInt16BE(codePoint, ends + segment * 2);
        } else if (start !== 0xffff) {
          bytes.writeUInt16BE(end, starts + segment * 2);
          bytes.writeUInt16BE((-end) & 0xffff, deltas + segment * 2);
        }
      } else {
        for (let point = start; point <= end; point++) {
          if (point !== codePoint) bytes.writeUInt16BE(0, offsets + segment * 2 + rangeOffset + (point - start) * 2);
        }
      }
    }
  }
  await writeFile(destination, bytes);
  // Reuse the fixture writer to repair table checksums after changing the cmap.
  await mutateFont(destination, destination, {});
}

it('convert embeds a covering web subset but rejects competing subsets in one Office slot with uncovered characters', async () => {
  const dir = await workspace();
  const latin = join(dir, 'latin.ttf');
  const hebrew = join(dir, 'hebrew.ttf');
  await singleCharacterFont(MEDIUM, latin, 0x41);
  await singleCharacterFont(MEDIUM, hebrew, 0x5d0);
  const input = await deck(dir, face(latin, 500, 'Brand', 'unicode-range: U+41;'), '<p>A</p>');
  const output = join(dir, 'subset.pptx');
  const covering = await convertHtmlToPptx(input, { browser, output, embedFonts: true, rasterDpi: 96, offline: true });
  expect(covering.exitCode).toBe(0);
  expect(covering.report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_EMBED_SUBSET', severity: 'warning' }));
  expect(covering.report.fonts![0]!.embedding).toMatchObject({ status: 'embedded', subset: true });
  expect(covering.report.fonts![0]!.unicodeRange).toBe('U+41');
  await packaged(output, covering.report);
  await deck(dir, face(latin, 500, 'Brand', 'unicode-range: U+41;') + face(hebrew, 500, 'Brand', 'unicode-range: U+5D0;'),
    '<p id="latin">A</p><p id="hebrew">א</p>');
  const failedOutput = join(dir, 'competing.pptx');
  const failed = await convertHtmlToPptx(input, { browser, output: failedOutput, embedFonts: true, rasterDpi: 96, offline: true });
  expect(failed.exitCode).toBe(2);
  expect(failed.report.fonts).toHaveLength(2);
  expect(failed.report.fonts!.map((font) => font.asset.sha256)).toEqual([hash(await readFile(latin)), hash(await readFile(hebrew))]);
  expect(failed.report.fonts!.map((font) => font.office)).toEqual([
    { family: 'Heebo Medium', style: 'regular' }, { family: 'Heebo Medium', style: 'regular' },
  ]);
  const coverage = {
    code: 'FONT_EMBED_COVERAGE', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#latin' },
    reason: 'Heebo Medium (Heebo-Medium) has no cmap glyph for U+05D0 א; 2 distinct measured assets compete for the same case-insensitive Office family/regular slot, which holds only one face; subsets are never merged',
    hint: 'Supply the complete font file for Heebo Medium covering every listed character; web subsets cannot be merged into one Office family/style slot',
  };
  expect(failed.report.entries.filter((entry) => entry.code === 'FONT_EMBED_COVERAGE')).toEqual([coverage]);
  await expect(stat(failedOutput)).rejects.toMatchObject({ code: 'ENOENT' });
  const optedOut = await validateHtml(input, { browser, embedFonts: false, rasterDpi: 96, offline: true });
  expect(optedOut.exitCode).toBe(0);
  expect(optedOut.report.entries.filter((entry) => entry.code === 'FONT_EMBED_COVERAGE')).toEqual([
    { ...coverage, kind: 'flagged', severity: 'warning' },
  ]);
});

it('CLI rejects visible glyph fallback by default and warns only under the explicit machine-dependent opt-out', async () => {
  const dir = await workspace();
  const input = await deck(dir, face(MEDIUM), '<p id="fallback">Brand 漢字</p>');
  for (const command of ['convert', 'validate']) {
    const output = join(dir, `${command}.pptx`);
    const failed = await cli(command, input, ...(command === 'convert' ? ['-o', output] : []), '--json');
    expect(failed.code, failed.stderr || failed.stdout).toBe(2);
    const report: Report = JSON.parse(failed.stdout);
    expect(report.entries).toContainEqual(expect.objectContaining({
      code: 'FONT_GLYPH_FALLBACK', kind: 'error', severity: 'error', slide: 1, locator: { selector: '#fallback' },
      reason: expect.stringContaining('U+5B57 字, U+6F22 漢'),
    }));
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    const optedOut = await cli(command, input, ...(command === 'convert' ? ['-o', output] : []), '--no-embed-fonts', '--json');
    expect(optedOut.code, optedOut.stderr || optedOut.stdout).toBe(0);
    const warnings: Report = JSON.parse(optedOut.stdout);
    expect(warnings.entries).toContainEqual(expect.objectContaining({
      code: 'FONT_GLYPH_FALLBACK', kind: 'flagged', severity: 'warning', locator: { selector: '#fallback' },
    }));
    expect(warnings.entries.some((entry) => entry.severity === 'error')).toBe(false);
    if (command === 'convert') expect((await stat(output)).size).toBeGreaterThan(0);
  }
});

it('portability warnings cannot mask authoring errors or Verification failures', async () => {
  const dir = await workspace();
  const invalid = await deck(dir, face(MEDIUM), '<p>A</p><iframe></iframe>');
  const output = join(dir, 'invalid.pptx');
  const rejected = await cli('convert', invalid, '-o', output, '--no-embed-fonts', '--strict', '--json');
  expect(rejected.code, rejected.stderr).toBe(2);
  expect(JSON.parse(rejected.stdout).entries).toContainEqual(expect.objectContaining({ code: 'VALIDATE_ELEMENT', severity: 'error' }));
  await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
  const input = await deck(dir, face(MEDIUM) + '.ghost { visibility: hidden } #shown { visibility: visible }',
    '<p>Kept</p><div class="ghost"><p id="shown">LOST_SENTINEL</p></div>');
  const verifiedOutput = join(dir, 'verified.pptx');
  const verified = await convertHtmlToPptx(input, { browser, output: verifiedOutput, embedFonts: false, strict: 'info', rasterDpi: 96, offline: true });
  expect(verified.exitCode).toBe(5);
  expect(verified.report.entries).toContainEqual(expect.objectContaining({ code: 'FONT_NOT_EMBEDDED', severity: 'warning' }));
  expect(verified.report.entries.some((entry) => entry.code.startsWith('VERIFY_') && entry.severity === 'error')).toBe(true);
  expect((await stat(verifiedOutput)).size).toBeGreaterThan(0);
});
