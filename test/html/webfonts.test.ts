import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { auditVisibleFonts, FontCatalog, resolveDeckFonts, resolvedFontsOf } from '../../src/fonts/index.js';
import { loadDeck } from '../../src/html/load.js';
import { measureDeck } from '../../src/html/measure.js';
import { textBodiesOf, type Deck } from '../../src/model/index.js';
import type { Entry } from '../../src/report/types.js';
import { woff2FromSfnt, woffFromSfnt } from '../fonts/fixture.js';

const ASSETS = resolve('fixtures/corpus/fonts/_assets');
const MEDIUM = join(ASSETS, 'heebo/Heebo-Medium.ttf');
const BOLD = join(ASSETS, 'heebo/Heebo-Bold.ttf');
const EXTRABOLD = join(ASSETS, 'heebo/Heebo-ExtraBold.ttf');
/** SHA-256 of the pinned Heebo-Medium.ttf (fixtures/corpus/fonts/_assets/manifest.json) */
const MEDIUM_SHA256 = 'cba4ce1a4c8ebaf36d0ac34d1941bc4d8a0117e343fac28c46a01635a08a92f1';
const SECRET = 's3cret-token';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((done) => done())); });

interface FontHost {
  origin: string;
  /** every path requested so far */
  requests: string[];
  close(): Promise<void>;
}

/** A local stand-in for a font CDN: fixed bodies by path, 404 otherwise. */
async function host(files: Record<string, { type: string; body: string | Buffer; redirect?: string }>): Promise<FontHost> {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    requests.push(request.url ?? '');
    const file = files[(request.url ?? '').split('?')[0]!];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    if (file.redirect) {
      response.writeHead(302, { location: file.redirect }).end();
      return;
    }
    response.writeHead(200, { 'content-type': file.type, 'access-control-allow-origin': '*' }).end(file.body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  let open = true;
  const close = async () => {
    if (!open) return;
    open = false;
    await new Promise<void>((done) => server.close(() => done()));
  };
  cleanup.push(close);
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close };
}

/** A temporary Deck directory holding `files`. */
async function deckDir(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deckflip-webfonts-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

function page(head: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${head}</head><body><section>${body}</section></body></html>`;
}

/** One unwrapped line at a fixed position: its box width is the text's advance width. */
function line(top: number, style: string, text: string): string {
  return `<p style="position: absolute; left: 40px; top: ${top}px; margin: 0; white-space: nowrap; font-size: 40px; ${style}">${text}</p>`;
}

/** What convert derives from a measurement: resolved runs, font entries and the audit, against an isolated install. */
async function measureFonts(input: string, system: readonly string[] | false = false) {
  const measured = await measureDeck(await loadDeck(input, {}), { browser });
  const catalog = await FontCatalog.scan({ declared: measured.fonts.declared, system });
  const entries: Entry[] = [
    ...measured.entries,
    ...resolveDeckFonts(measured.deck, catalog),
    ...auditVisibleFonts(measured.visibleText, catalog, { embedFonts: false }),
  ];
  return { deck: measured.deck, entries, fonts: resolvedFontsOf(measured.deck) };
}

function runs(deck: Deck) {
  return deck.slides.flatMap((slide) => slide.elements.flatMap((element) =>
    [...textBodiesOf(element)].flatMap(({ body }) => body.paragraphs.flatMap((paragraph) =>
      paragraph.runs.flatMap((run) => (run.kind === 'text' ? [{ text: run.text, font: run.style.font, box: element.box }] : []))))));
}

function withoutPortability(entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.code !== 'FONT_NOT_EMBEDDED');
}

it('loads the same pinned faces through local and hosted stylesheets and lays text out alike', async () => {
  const boldWoff2 = await woff2FromSfnt(await readFile(BOLD));
  const cdn = await host({
    '/css2': {
      type: 'text/css',
      body: `@font-face { font-family: 'Brand'; font-style: normal; font-weight: 500; src: url(/s/heebo-medium.ttf) format('truetype'); }
        @font-face { font-family: 'Brand'; font-style: normal; font-weight: 700; src: url(/s/heebo-bold.woff2) format('woff2'); }`,
    },
    '/s/heebo-medium.ttf': { type: 'font/ttf', body: await readFile(MEDIUM) },
    '/s/heebo-bold.woff2': { type: 'font/woff2', body: boldWoff2 },
  });
  const body = line(80, 'font-family: Brand, Arial; font-weight: 500', 'Medium brand line') + line(200, 'font-family: Brand, Arial; font-weight: 700', 'Bold brand line');
  const local = await deckDir({
    'deck.html': page('<link rel="stylesheet" href="css/fonts.css">', body),
    // URLs resolve against each stylesheet, through an import and grouping rules.
    'css/fonts.css': '@import url("type/brand.css") screen;\n/* @font-face { font-family: Brand; src: url(nowhere.ttf) } */\n',
    'css/type/brand.css': `@media screen { @supports (display: grid) {
        @font-face { font-family: "Brand"; font-weight: 500; src: url("../../fonts/Heebo-Medium.ttf") format("truetype"); } } }
      @font-face { font-family: "Brand"; font-weight: 700; src: url('../../fonts/Heebo-Bold.ttf'); }`,
    'fonts/Heebo-Medium.ttf': await readFile(MEDIUM),
    'fonts/Heebo-Bold.ttf': await readFile(BOLD),
  });
  const hosted = await deckDir({ 'deck.html': page(`<link rel="stylesheet" href="${cdn.origin}/css2?family=Brand:wght@500;700&key=${SECRET}">`, body) });

  const fromFiles = await measureFonts(join(local, 'deck.html'));
  const fromHost = await measureFonts(join(hosted, 'deck.html'));
  expect(withoutPortability(fromFiles.entries)).toEqual([]);
  expect(withoutPortability(fromHost.entries)).toEqual([]);
  const [localRuns, hostedRuns] = [runs(fromFiles.deck), runs(fromHost.deck)];
  expect(hostedRuns.map((run) => run.box)).toEqual(localRuns.map((run) => run.box));
  expect(hostedRuns.map((run) => run.font?.office)).toEqual([{ family: 'Heebo Medium', style: 'regular' }, { family: 'Heebo', style: 'bold' }]);
  expect(localRuns.map((run) => run.font?.office)).toEqual(hostedRuns.map((run) => run.font?.office));
  // Identical bytes are one asset wherever they come from; a WOFF2 is identified by the sfnt it decodes to.
  expect(localRuns[0]!.font?.asset).toMatchObject({ sha256: MEDIUM_SHA256, source: { kind: 'file', format: 'ttf', file: join(local, 'fonts/Heebo-Medium.ttf') } });
  expect(hostedRuns[0]!.font?.asset).toMatchObject({ sha256: MEDIUM_SHA256, source: { kind: 'remote', format: 'ttf', url: `${cdn.origin}/s/heebo-medium.ttf` } });
  const boldSource = createHash('sha256').update(boldWoff2).digest('hex');
  expect(hostedRuns[1]!.font?.asset.source).toEqual({
    kind: 'remote', format: 'woff2', url: `${cdn.origin}/s/heebo-bold.woff2`, sha256: boldSource,
    pinned: join(hosted, 'deck.assets', 'fonts', `${boldSource}.woff2`),
  });
  expect(hostedRuns[1]!.font?.asset.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(hostedRuns[1]!.font?.asset.sha256).not.toBe(boldSource);
  expect(JSON.stringify([fromHost.fonts, fromHost.entries])).not.toContain(SECRET);
});

it('never lets local() or an installed face of the same family stand in for the supplied bytes', async () => {
  const body = line(80, 'font-family: Heebo, Arial; font-weight: 500', 'Supplied Heebo Medium');
  const dir = await deckDir({
    'local-first.html': page('<style>@font-face { font-family: Heebo; font-weight: 500; src: local("Arial"), local("Helvetica"), url("fonts/Heebo-Medium.ttf"); }</style>', body),
    'url-only.html': page('<style>@font-face { font-family: Heebo; font-weight: 500; src: url("fonts/Heebo-Medium.ttf"); }</style>', body),
    'fonts/Heebo-Medium.ttf': await readFile(MEDIUM),
  });
  const urlOnly = await measureFonts(join(dir, 'url-only.html'));
  // An installed Heebo of another weight is in the catalog; the declared family shadows it, as in Chromium.
  const localFirst = await measureFonts(join(dir, 'local-first.html'), [EXTRABOLD]);
  expect(runs(localFirst.deck).map((run) => run.box)).toEqual(runs(urlOnly.deck).map((run) => run.box));
  expect(runs(localFirst.deck)[0]!.font).toMatchObject({ asset: { sha256: MEDIUM_SHA256, source: { kind: 'file' } }, office: { family: 'Heebo Medium' } });
  expect(withoutPortability(localFirst.entries)).toEqual([]);
});

it('reports a declared face that fails to load only when text needs it', async () => {
  const cdn = await host({});
  const dir = await deckDir({
    'deck.html': page(`<link rel="stylesheet" href="css/missing.css"><link rel="stylesheet" href="http://deck:${SECRET}@127.0.0.1:${new URL(cdn.origin).port}/fonts.css"><style>
        @font-face { font-family: MissingFile; src: url("fonts/none.woff2") format("woff2"); }
        @font-face { font-family: Gone; src: url("${cdn.origin}/s/gone.woff2") format("woff2"); }
        @font-face { font-family: LocalOnly; src: local("Arial"); }
        @font-face { font-family: NotAFont; src: url("fonts/notes.ttf"); }
        @font-face { font-family: Unused; src: url("fonts/unused.ttf"); }
      </style>`,
    line(40, 'font-family: MissingFile, Arial', 'Missing file') + line(120, 'font-family: Gone, Arial', 'Gone remote') +
      line(200, 'font-family: LocalOnly, Arial', 'Local only') + line(280, 'font-family: NotAFont, Arial', 'Not a font')),
    'fonts/notes.ttf': 'These are notes, not a font.',
  });
  const { entries, deck } = await measureFonts(join(dir, 'deck.html'));
  expect(entries.map((entry) => [entry.code, entry.severity, entry.reason])).toEqual(expect.arrayContaining([
    ['VALIDATE_MISSING_ASSET', 'error', 'Stylesheet css/missing.css does not exist'],
    ['FONT_ASSET_UNAVAILABLE', 'error', `Chromium did not request stylesheet ${cdn.origin}/fonts.css in deck.html (a URL with credentials is blocked), so its fonts are unknown`],
    ['VALIDATE_MISSING_ASSET', 'error', '@font-face MissingFile 400 in deck.html: fonts/none.woff2 does not exist'],
    ['FONT_ASSET_UNAVAILABLE', 'error', `@font-face Gone 400 in deck.html: ${cdn.origin}/s/gone.woff2 returned HTTP 404 and is not pinned in the Asset directory`],
    ['FONT_ASSET_UNSUPPORTED', 'error', expect.stringContaining('@font-face LocalOnly 400 in deck.html: lists only local() sources')],
    ['FONT_ASSET_UNSUPPORTED', 'error', expect.stringContaining('@font-face NotAFont 400 in deck.html: fonts/notes.ttf is not a TrueType, OpenType, WOFF or WOFF2 font')],
  ]));
  expect(entries.map((entry) => entry.reason).join('\n')).not.toContain('Unused');
  expect(JSON.stringify(entries)).not.toContain(SECRET);
  // A run whose declared face did not load is not passed off as the next family in its stack.
  expect(runs(deck).map((run) => run.font)).toEqual([undefined, undefined, undefined, undefined]);
});

it('loads a data: URI @font-face as a Deck-provided face of its own', async () => {
  const uri = `data:font/woff2;base64,${(await woff2FromSfnt(await readFile(MEDIUM))).toString('base64')}`;
  const dir = await deckDir({
    'deck.html': page(`<style>@font-face { font-family: Inline; font-weight: 500; src: url("${uri}") format("woff2"); }</style>`,
      line(80, 'font-family: Inline, Arial; font-weight: 500', 'Inline data face')),
  });
  const { deck, entries } = await measureFonts(join(dir, 'deck.html'));
  expect(withoutPortability(entries)).toEqual([]);
  expect(runs(deck)[0]!.font).toMatchObject({ office: { family: 'Heebo Medium' }, asset: { source: { kind: 'data', format: 'woff2' } } });
  expect(JSON.stringify(entries)).not.toContain('base64');
});

it('selects unicode-range subsets by the characters a run uses and flags what none covers', async () => {
  const medium = await readFile(MEDIUM);
  const cdn = await host({
    '/css2': {
      type: 'text/css',
      body: `/* hebrew */ @font-face { font-family: 'Remote Heebo'; font-weight: 500; src: url(/s/hebrew.woff) format('woff'); unicode-range: U+0590-05FF; }
        /* latin */ @font-face { font-family: 'Remote Heebo'; font-weight: 500; src: url(/s/latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131; }`,
    },
    '/s/latin.woff2': { type: 'font/woff2', body: await woff2FromSfnt(medium) },
    '/s/hebrew.woff': { type: 'font/woff', body: woffFromSfnt(medium) },
  });
  const style = "font-family: 'Remote Heebo', Arial; font-weight: 500";
  const dir = await deckDir({
    'deck.html': page(`<link rel="stylesheet" href="${cdn.origin}/css2?family=Heebo">`,
      line(40, style, 'Latin café') + line(120, style, 'שלום') + line(200, style, 'Outside ő')),
  });
  const { deck, entries } = await measureFonts(join(dir, 'deck.html'));
  const [latin, hebrew, outside] = runs(deck);
  expect(latin!.font).toMatchObject({ unicodeRange: 'U+0-FF, U+131', asset: { source: { kind: 'remote', format: 'woff2', url: `${cdn.origin}/s/latin.woff2` } } });
  expect(hebrew!.font).toMatchObject({ unicodeRange: 'U+590-5FF', asset: { source: { kind: 'remote', format: 'woff', url: `${cdn.origin}/s/hebrew.woff` } } });
  expect(outside!.font?.asset.sha256).toBe(latin!.font?.asset.sha256);
  const fallbacks = entries.filter((entry) => entry.code === 'FONT_GLYPH_FALLBACK');
  expect(fallbacks).toHaveLength(1);
  expect(fallbacks[0]).toMatchObject({ severity: 'warning', locator: { selector: 'section:nth-of-type(1) > p:nth-child(3)' } });
  expect(fallbacks[0]!.reason).toContain('has no glyph for U+0151 ő; Chromium drew them with ');
});

it('flags glyphs the selected face lacks even though Chromium drew them', async () => {
  const dir = await deckDir({
    'deck.html': page('<style>@font-face { font-family: Brand; font-weight: 500; src: url("fonts/Heebo-Medium.ttf"); }</style>',
      line(80, 'font-family: Brand, Arial; font-weight: 500', 'Brand 漢字')),
    'fonts/Heebo-Medium.ttf': await readFile(MEDIUM),
  });
  const { entries } = await measureFonts(join(dir, 'deck.html'));
  expect(entries).toContainEqual(expect.objectContaining({
    code: 'FONT_GLYPH_FALLBACK', kind: 'flagged', severity: 'warning',
    reason: expect.stringMatching(/^Heebo Medium \(Brand\) has no glyph for U\+5B57 字, U\+6F22 漢; Chromium drew them with \S/),
  }));
});

it('reuses pinned downloads when the host is unreachable and fails when nothing was pinned', async () => {
  const cdn = await host({
    '/css2': { type: 'text/css', body: "@font-face { font-family: Brand; font-weight: 500; src: url(/s/medium.woff2) format('woff2'); }" },
    '/s/medium.woff2': { type: 'font/woff2', body: await woff2FromSfnt(await readFile(MEDIUM)) },
  });
  const html = page(`<link rel="stylesheet" href="${cdn.origin}/css2?family=Brand&key=${SECRET}">`, line(80, 'font-family: Brand, Arial; font-weight: 500', 'Pinned brand line'));
  const pinned = await deckDir({ 'deck.html': html });
  const unpinned = await deckDir({ 'deck.html': html });

  const online = await measureFonts(join(pinned, 'deck.html'));
  expect(cdn.requests.map((path) => path.split('?')[0])).toEqual(['/css2', '/s/medium.woff2']);
  const pins = join(pinned, 'deck.assets', 'fonts');
  const files = await readdir(pins);
  expect(files).toHaveLength(3);
  expect(files).toEqual(expect.arrayContaining([expect.stringMatching(/^[0-9a-f]{64}\.css$/), expect.stringMatching(/^[0-9a-f]{64}\.woff2$/), 'sources.json']));
  expect(await readFile(join(pins, 'sources.json'), 'utf8')).not.toContain(SECRET);

  const requested = cdn.requests.length;
  const repeated = await measureFonts(join(pinned, 'deck.html'));
  expect(cdn.requests).toHaveLength(requested);
  expect(withoutPortability(repeated.entries)).toEqual([]);
  expect(runs(repeated.deck).map((run) => [run.box, run.font?.asset])).toEqual(runs(online.deck).map((run) => [run.box, run.font?.asset]));

  await cdn.close();
  const offline = await measureFonts(join(pinned, 'deck.html'));
  expect(withoutPortability(offline.entries)).toEqual([]);
  expect(runs(offline.deck).map((run) => [run.box, run.font?.asset])).toEqual(runs(online.deck).map((run) => [run.box, run.font?.asset]));

  const missing = await measureFonts(join(unpinned, 'deck.html'));
  expect(missing.entries).toContainEqual(expect.objectContaining({
    code: 'FONT_ASSET_UNAVAILABLE', severity: 'error',
    reason: `Stylesheet ${cdn.origin}/css2?… could not be downloaded and is not pinned in the Asset directory`,
  }));
});

it('matches declared stretch before weight and carries non-normal computed stretch', async () => {
  const dir = await deckDir({
    'deck.html': page(`<style>
      @font-face { font-family: Brand; font-weight: 400; src: url("medium.ttf"); }
      @font-face { font-family: Brand; font-weight: 700; font-stretch: condensed; src: url("bold.ttf"); }
      </style>`,
    line(60, 'font-family: Brand, Arial; font-weight: 700', 'Normal width synthetic bold') +
    line(160, 'font-family: Brand, Arial; font-weight: 700; font-stretch: condensed', 'Condensed width bold')),
    'medium.ttf': await readFile(MEDIUM),
    'bold.ttf': await readFile(BOLD),
  });
  const measured = await measureFonts(join(dir, 'deck.html'));
  expect(measured.entries.filter((entry) => entry.code.startsWith('FONT_'))).toEqual([]);
  expect(runs(measured.deck).map((run) => run.font?.office)).toEqual([
    { family: 'Heebo Medium', style: 'regular' }, { family: 'Heebo', style: 'bold' },
  ]);
});

it('reports imported stylesheets Chromium never requests with the importing sheet as referrer', async () => {
  const cdn = await host({});
  const data = `data:text/css,${encodeURIComponent('@font-face { font-family: Brand; src: local("Arial"); }')}`;
  const blocked = `http://deck:${SECRET}@127.0.0.1:${new URL(cdn.origin).port}/blocked.css`;
  const dir = await deckDir({
    'deck.html': page('<link rel="stylesheet" href="fonts.css">', line(60, 'font-family: Brand, Arial', 'Unrewritable import')),
    'fonts.css': `@import url("${data}"); @import url("${blocked}");`,
  });
  const { entries } = await measureFonts(join(dir, 'deck.html'));
  expect(entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'FONT_ASSET_UNSUPPORTED', reason: expect.stringContaining('Stylesheet data:text/css in fonts.css declares fonts') }),
    expect.objectContaining({ code: 'FONT_ASSET_UNAVAILABLE', reason: expect.stringContaining(`stylesheet ${cdn.origin}/blocked.css in fonts.css`) }),
  ]));
  expect(JSON.stringify(entries)).not.toContain(SECRET);
});

it('freezes failed earlier remote sources only when a later source was pinned', async () => {
  const files: Parameters<typeof host>[0] = {
    '/second.ttf': { type: 'font/ttf', body: await readFile(MEDIUM) },
  };
  const cdn = await host(files);
  const html = page(`<style>@font-face { font-family: Brand; font-weight: 500; src: url("${cdn.origin}/first.ttf"), url("${cdn.origin}/second.ttf"); }</style>`,
    line(60, 'font-family: Brand, Arial; font-weight: 500', 'Frozen source order'));
  const pinned = await deckDir({ 'deck.html': html });
  const first = await measureFonts(join(pinned, 'deck.html'));
  expect(withoutPortability(first.entries)).toEqual([]);
  files['/first.ttf'] = { type: 'font/ttf', body: await readFile(BOLD) };
  const requested = cdn.requests.length;
  const second = await measureFonts(join(pinned, 'deck.html'));
  expect(cdn.requests).toHaveLength(requested);
  expect(withoutPortability(second.entries)).toEqual([]);
  expect(runs(second.deck).map((run) => [run.box, run.font?.asset])).toEqual(runs(first.deck).map((run) => [run.box, run.font?.asset]));

  delete files['/first.ttf'];
  delete files['/second.ttf'];
  const recovering = await deckDir({ 'deck.html': html });
  const failed = await measureFonts(join(recovering, 'deck.html'));
  expect(failed.entries).toContainEqual(expect.objectContaining({ code: 'FONT_ASSET_UNAVAILABLE' }));
  files['/first.ttf'] = { type: 'font/ttf', body: await readFile(MEDIUM) };
  const recovered = await measureFonts(join(recovering, 'deck.html'));
  expect(withoutPortability(recovered.entries)).toEqual([]);
  expect(runs(recovered.deck)[0]!.font?.office.family).toBe('Heebo Medium');
});

it('resolves redirected stylesheet imports and fonts against the final URL online and offline', async () => {
  const cdn = await host({
    '/fonts.css': { type: 'text/css', body: '', redirect: '/v3/css/fonts.css?token=hidden' },
    '/v3/css/fonts.css': { type: 'text/css', body: '@import "./nested.css"; @font-face { font-family: Direct; font-weight: 500; src: url("../fonts/medium.ttf"); }' },
    '/v3/css/nested.css': { type: 'text/css', body: '@font-face { font-family: Imported; font-weight: 700; src: url("../fonts/bold.ttf"); }' },
    '/v3/fonts/medium.ttf': { type: 'font/ttf', body: await readFile(MEDIUM) },
    '/v3/fonts/bold.ttf': { type: 'font/ttf', body: await readFile(BOLD) },
  });
  const dir = await deckDir({
    'deck.html': page(`<link rel="stylesheet" href="${cdn.origin}/fonts.css">`,
      line(60, 'font-family: Direct, Arial; font-weight: 500', 'Redirected direct face') +
      line(160, 'font-family: Imported, Arial; font-weight: 700', 'Redirected imported face')),
  });
  const online = await measureFonts(join(dir, 'deck.html'));
  expect(withoutPortability(online.entries)).toEqual([]);
  expect(runs(online.deck).map((run) => run.font?.office.family)).toEqual(['Heebo Medium', 'Heebo']);
  expect(cdn.requests).toEqual(expect.arrayContaining(['/v3/css/nested.css', '/v3/fonts/medium.ttf', '/v3/fonts/bold.ttf']));
  const pins = JSON.parse(await readFile(join(dir, 'deck.assets/fonts/sources.json'), 'utf8'));
  expect(pins.sources).toContainEqual(expect.objectContaining({ url: `${cdn.origin}/fonts.css`, base: `${cdn.origin}/v3/css/fonts.css` }));
  expect(JSON.stringify(pins)).not.toContain('hidden');
  await cdn.close();
  const offline = await measureFonts(join(dir, 'deck.html'));
  expect(withoutPortability(offline.entries)).toEqual([]);
  expect(runs(offline.deck).map((run) => [run.box, run.font?.asset])).toEqual(runs(online.deck).map((run) => [run.box, run.font?.asset]));
});
