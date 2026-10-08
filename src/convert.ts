import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { Browser } from 'playwright-core';
import { emitPptx } from './emit/index.js';
import { FontCatalog, resolveDeckFonts } from './fonts/index.js';
import type { BrowserCensus } from './html/browser-script.js';
import { loadDeck } from './html/load.js';
import { measureDeck, type MeasuredDeckResult } from './html/measure.js';
import { emitHtml } from './htmlout/index.js';
import type { Canvas, Deck } from './model/index.js';
import { OpcReader } from './ooxml/opc.js';
import { parsePptx } from './parse/index.js';
import { chromiumVersion, launchChromium } from './render/chromium.js';
import { entry as reportEntry } from './report/codes.js';
import { buildReport, withEntries, writeSidecar } from './report/index.js';
import { DeckflipError, type Entry, type Report } from './report/types.js';
import { hasVba, sourceEntries } from './roundtrip/entries.js';
import { buildManifest, MANIFEST_FILE, sha256, SOURCE_FILE } from './roundtrip/manifest.js';
import { resolveRoundTrip, type RoundTrip } from './roundtrip/index.js';
import { indexSource } from './roundtrip/source.js';
import { verifyDecks } from './verify/index.js';
import { VERSION } from './version.js';

/** Where Chromium comes from: an explicit binary, the managed build (downloaded unless offline), or a browser the caller already launched. */
export interface ChromiumOptions {
  browserPath?: string;
  offline: boolean;
  /** reuse an already-launched browser (tests, render) */
  browser?: Browser;
}

export interface ConvertOptions extends ChromiumOptions {
  output?: string;
  size?: string;
  embedFonts: false | true | string[];
  rasterDpi: number;
  report?: string;
  strict: boolean;
}

export type ValidateOptions = Omit<ConvertOptions, 'output' | 'strict'>;

export interface VerifyOptions extends ChromiumOptions {
  report?: string;
}

/** `.pptx`/`.pptm` is a PowerPoint package; anything else is an HTML Deck file or directory. */
export function inferKind(path: string): 'html' | 'pptx' {
  const extension = extname(path).toLowerCase();
  return extension === '.pptx' || extension === '.pptm' ? 'pptx' : 'html';
}

async function defaultPptxOutputPath(input: string): Promise<string> {
  const info = await stat(input).catch(() => undefined);
  if (info?.isDirectory()) return join(input, `${basename(input)}.pptx`);
  return replaceExtension(input, '.pptx');
}

function replaceExtension(path: string, ext: string): string {
  const current = extname(path);
  return current.length > 0 ? `${path.slice(0, -current.length)}${ext}` : `${path}${ext}`;
}

function hasError(entries: Entry[]): boolean {
  return entries.some((e) => e.severity === 'error');
}

function reportBase(
  input: string,
  output: string | undefined,
  canvas: Canvas,
  browserVersion: string | undefined,
  command: 'convert' | 'validate' | 'verify',
): Omit<Report, 'summary' | 'schemaVersion' | 'entries'> {
  return {
    tool: { name: 'deckflip', version: VERSION, ...(browserVersion === undefined ? {} : { browser: browserVersion }) },
    command,
    input: { path: input, kind: 'html' },
    ...(output === undefined ? {} : { output: { path: output, kind: 'pptx' } }),
    canvas: { width: canvas.width, height: canvas.height, source: canvas.source },
  };
}

interface PipelineRun {
  report: Report;
  deck?: Deck;
  /** each Slide's census, for Verification; present with `deck` */
  census?: BrowserCensus[];
  /** the round trip's findings when the Deck came from a PPTX whose Asset directory is still there */
  roundTrip?: RoundTrip;
}

/** load -> measure -> fonts -> round trip; the report carries every entry, `deck` is present only when no error stopped the run. */
async function runHtmlPipeline(
  input: string,
  opts: ValidateOptions,
  mode: 'convert' | 'validate',
  outputPath?: string,
): Promise<PipelineRun> {
  const loaded = await loadDeck(input, opts.size === undefined ? {} : { size: opts.size });
  const baseEntries = [...loaded.entries];
  if (loaded.canvasOverridden) {
    baseEntries.push(reportEntry('OVERRIDE_CANVAS_SIZE', { reason: '--size differs from deck meta' }));
  }
  if (hasError(baseEntries)) {
    return { report: buildReport(reportBase(input, outputPath, loaded.canvas, undefined, mode), baseEntries, loaded.documents.length, 0) };
  }

  const browser =
    opts.browser ?? (await launchChromium({ ...(opts.browserPath === undefined ? {} : { browserPath: opts.browserPath }), offline: opts.offline }));
  try {
    const measured = await measureDeck(loaded, { browser, rasterDpi: opts.rasterDpi });
    const catalog = await FontCatalog.scan({ extraFiles: measured.deck.fontFaces.map((face) => face.file) });
    const fontEntries = resolveDeckFonts(measured.deck, catalog, { embedFonts: opts.embedFonts });
    const roundTrip = await resolveRoundTrip(measured.deck, measured.sections, loaded.deckFile);
    const entries = [...baseEntries, ...measured.entries, ...fontEntries, ...roundTrip.entries];
    const native = measured.deck.slides.reduce((n, slide) => n + slide.elements.length, 0);
    const report = buildReport(reportBase(input, outputPath, loaded.canvas, chromiumVersion(browser), mode), entries, measured.deck.slides.length, native);
    return hasError(entries) ? { report } : { report, deck: measured.deck, census: measured.census, roundTrip };
  } finally {
    if (opts.browser === undefined) await browser.close();
  }
}

export async function convertHtmlToPptx(
  input: string,
  opts: ConvertOptions,
): Promise<{ report: Report; outputPath: string; exitCode: 0 | 2 | 4 | 5 }> {
  let outputPath = opts.output ?? (await defaultPptxOutputPath(input));
  const run = await runHtmlPipeline(input, opts, 'convert', outputPath);

  if (run.deck === undefined) {
    const reportPath = opts.report ?? `${outputPath}.report.json`;
    await writeSidecar(run.report, reportPath);
    return { report: run.report, outputPath, exitCode: 2 };
  }

  // a macro-enabled source stays macro-enabled (spec 06 "VBA project"): the default output takes the .pptm extension
  if (opts.output === undefined && run.roundTrip?.preserved !== undefined && hasVba(run.roundTrip.preserved.source)) {
    outputPath = replaceExtension(outputPath, '.pptm');
    if (run.report.output) run.report.output = { ...run.report.output, path: outputPath };
  }
  const reportPath = opts.report ?? `${outputPath}.report.json`;

  const epoch = process.env.SOURCE_DATE_EPOCH;
  const pptx =
    run.roundTrip?.identical ??
    (await emitPptx(run.deck, {
      ...(epoch === undefined ? {} : { created: new Date(Number(epoch) * 1000) }),
      appVersion: VERSION,
      ...(run.roundTrip?.preserved === undefined ? {} : { preserved: run.roundTrip.preserved }),
    }));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, pptx);
  const verified = verifyDecks({ deck: run.deck, census: run.census ?? [] }, await parsePptx(pptx), 'html-to-pptx');
  const report = withEntries(run.report, verified);
  await writeSidecar(report, reportPath);

  return { report, outputPath, exitCode: verified.length > 0 ? 5 : opts.strict && report.entries.length > 0 ? 4 : 0 };
}

export async function validateHtml(input: string, opts: ValidateOptions): Promise<{ report: Report; exitCode: 0 | 2 }> {
  const run = await runHtmlPipeline(input, opts, 'validate');
  if (opts.report !== undefined) await writeSidecar(run.report, opts.report);
  return { report: run.report, exitCode: run.deck === undefined ? 2 : 0 };
}

export interface ConvertToHtmlOptions extends Partial<ChromiumOptions> {
  output?: string;
  report?: string;
  strict?: boolean;
}

/**
 * PPTX -> HTML Deck + Asset directory (spec 02 "Absolute-positioned form", spec 06 "Attachment"). Fonts are
 * resolved on the parsed Deck first, as they are on the HTML side, so the emitted text carries the same
 * baseline correction the emitter applied. Report entries from font resolution are the report. The Asset
 * directory keeps the input verbatim as `source.pptx` and the manifest the way back splices from. Once
 * written, the Deck is laid out in Chromium and verified against the PPTX.
 */
export async function convertPptxToHtml(input: string, opts: ConvertToHtmlOptions = {}): Promise<{ report: Report; outputPath: string; assetsDir: string; exitCode: 0 | 2 | 4 | 5 }> {
  const outputPath = opts.output ?? replaceExtension(input, '.html');
  const reportPath = opts.report ?? `${outputPath}.report.json`;
  const assetsDir = replaceExtension(outputPath, '.assets');
  const bytes = new Uint8Array(await readFile(input));
  const deck = await parsePptx(bytes);
  const source = await indexSource(await OpcReader.load(bytes));
  const catalog = await FontCatalog.scan({ extraFiles: [] });
  const entries = [...resolveDeckFonts(deck, catalog, { embedFonts: false }), ...sourceEntries(deck, source)];
  const native = deck.slides.reduce((n, slide) => n + slide.elements.length, 0);
  const base = { ...reportBase(input, outputPath, deck.canvas, undefined, 'convert'), input: { path: input, kind: 'pptx' as const }, output: { path: outputPath, kind: 'html' as const } };
  if (hasError(entries)) {
    const report = buildReport(base, entries, deck.slides.length, native);
    await writeSidecar(report, reportPath);
    return { report, outputPath, assetsDir, exitCode: 2 };
  }
  const { html, assets, slides } = emitHtml(deck, { assetsDir: basename(assetsDir) });
  const manifest = buildManifest(html, slides, source, sha256(bytes));

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html);
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, SOURCE_FILE), bytes);
  await writeFile(join(assetsDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relative, data] of assets) {
    const path = join(assetsDir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
  const laidOut = await measureHtmlSide(outputPath, { ...opts, offline: opts.offline ?? false });
  // the written Deck failing validation is as much a deckflip defect as a mismatch
  const verified = laidOut.measured ? verifyDecks(laidOut.measured, deck, 'pptx-to-html') : laidOut.errors;
  const report = buildReport({ ...base, tool: { ...base.tool, ...(laidOut.browser === undefined ? {} : { browser: laidOut.browser }) } }, [...entries, ...verified], deck.slides.length, native);
  await writeSidecar(report, reportPath);
  return { report, outputPath, assetsDir, exitCode: verified.length > 0 ? 5 : opts.strict && report.entries.length > 0 ? 4 : 0 };
}

/** `validate deck.pptx` (spec 01): the package parses, and the report lists what a round trip would carry opaquely. */
export async function validatePptx(input: string, opts: { report?: string } = {}): Promise<{ report: Report; exitCode: 0 | 2 }> {
  const bytes = new Uint8Array(await readFile(input));
  const deck = await parsePptx(bytes);
  const source = await indexSource(await OpcReader.load(bytes));
  const catalog = await FontCatalog.scan({ extraFiles: [] });
  const entries = [...resolveDeckFonts(deck, catalog, { embedFonts: false }), ...sourceEntries(deck, source)];
  const native = deck.slides.reduce((n, slide) => n + slide.elements.length, 0);
  const base = { ...reportBase(input, undefined, deck.canvas, undefined, 'validate'), input: { path: input, kind: 'pptx' as const } };
  const report = buildReport(base, entries, deck.slides.length, native);
  if (opts.report !== undefined) await writeSidecar(report, opts.report);
  return { report, exitCode: hasError(entries) ? 2 : 0 };
}

/**
 * `verify <source> <output>` (Verification): one HTML Deck and one PPTX, the source's kind deciding the
 * direction. The HTML side is measured afresh; the report holds `VERIFY_*` entries only and is written only
 * where `--report` asks, so the conversion's own sidecar survives.
 */
export async function verifyConversion(source: string, output: string, opts: VerifyOptions): Promise<{ report: Report; exitCode: 0 | 2 | 5 }> {
  const sourceKind = inferKind(source);
  if (inferKind(output) === sourceKind) {
    throw new DeckflipError(`verify needs one HTML Deck and one PPTX, got two ${sourceKind} inputs`, 3);
  }
  const [htmlPath, pptxPath] = sourceKind === 'html' ? [source, output] : [output, source];
  const pptx = await parsePptx(new Uint8Array(await readFile(pptxPath)));
  const laidOut = await measureHtmlSide(htmlPath, opts);
  const base = {
    ...reportBase(source, output, laidOut.canvas, laidOut.browser, 'verify'),
    input: { path: source, kind: sourceKind },
    output: { path: output, kind: sourceKind === 'html' ? 'pptx' as const : 'html' as const },
  };
  const entries = laidOut.measured ? verifyDecks(laidOut.measured, pptx, sourceKind === 'html' ? 'html-to-pptx' : 'pptx-to-html') : laidOut.errors;
  const report = buildReport(base, entries, pptx.slides.length, pptx.slides.reduce((n, slide) => n + slide.elements.length, 0));
  if (opts.report !== undefined) await writeSidecar(report, opts.report);
  return { report, exitCode: laidOut.measured === undefined ? 2 : entries.length > 0 ? 5 : 0 };
}

/** The HTML side of a conversion laid out in Chromium for Verification, or the validation errors that stopped it. */
async function measureHtmlSide(htmlPath: string, opts: ChromiumOptions): Promise<{ canvas: Canvas; errors: Entry[]; measured?: MeasuredDeckResult; browser?: string }> {
  const loaded = await loadDeck(htmlPath, {});
  if (hasError(loaded.entries)) {
    return { canvas: loaded.canvas, errors: loaded.entries.filter((e) => e.severity === 'error') };
  }
  const browser = opts.browser ?? (await launchChromium({ ...(opts.browserPath === undefined ? {} : { browserPath: opts.browserPath }), offline: opts.offline }));
  try {
    const measured = await measureDeck(loaded, { browser });
    const errors = measured.entries.filter((e) => e.severity === 'error');
    return { canvas: loaded.canvas, errors, ...(errors.length > 0 ? {} : { measured }), browser: chromiumVersion(browser) };
  } finally {
    if (opts.browser === undefined) await browser.close();
  }
}
